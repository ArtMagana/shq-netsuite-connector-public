import crypto from 'node:crypto'

import { DOMParser } from '@xmldom/xmldom'
import { PDFParse } from 'pdf-parse'

import { cacheInventoryCertificateFile } from './inventoryCertificates.js'
import { loadLocalEnv } from './loadLocalEnv.js'

const SOAP_VERSION = '2025_2'
const SOAP_ENDPOINT_SUFFIX = `/services/NetSuitePort_${SOAP_VERSION}`
const SOAP_RETRY_DELAYS_MS = [500, 1500, 3000, 5000]

type SoapTbaConfig = {
  accountId: string
  baseUrl: string
  consumerKey: string
  consumerSecret: string
  tokenId: string
  tokenSecret: string
}

type InvoiceAttachmentSearchRow = {
  invoiceInternalId: string
  invoiceDocument: string | null
  fileId: string
  name: string | null
  url: string | null
  fileType: string | null
}

type FileRecordContent = {
  fileId: string
  name: string | null
  url: string | null
  fileType: string | null
  mediaTypeName: string | null
  fileSize: number | null
  isInactive: boolean | null
  contentBase64: string | null
}

type PaymentReceiptSignals = {
  transferAmount: number | null
  amountCandidates: number[]
  referenceNumber: string | null
  bankName: string | null
  operationDateText: string | null
  paymentConcept: string | null
  sourceAccountHint: string | null
  destinationAccountHint: string | null
}

type AttachmentInspectionOptions = {
  includeText?: boolean
  fileId?: string | null
}

export class NetSuiteAttachmentInspectionError extends Error {
  constructor(
    message: string,
    readonly status = 503,
  ) {
    super(message)
    this.name = 'NetSuiteAttachmentInspectionError'
  }
}

export async function inspectNetSuiteInvoiceAttachments(
  invoiceInternalId: string,
  options?: AttachmentInspectionOptions,
) {
  const normalizedInvoiceInternalId = invoiceInternalId.trim()
  if (!normalizedInvoiceInternalId) {
    throw new NetSuiteAttachmentInspectionError('invoiceInternalId is required.', 400)
  }

  const attachmentRows = await searchInvoiceAttachmentRows(normalizedInvoiceInternalId)
  const filteredRows =
    typeof options?.fileId === 'string' && options.fileId.trim()
      ? attachmentRows.filter((row) => row.fileId === options.fileId?.trim())
      : attachmentRows

  const attachments = await Promise.all(
    filteredRows.map((row) =>
      inspectNetSuiteFile({
        fileId: row.fileId,
        includeText: options?.includeText ?? false,
        invoiceInternalId: row.invoiceInternalId,
        invoiceDocument: row.invoiceDocument,
        searchRow: row,
      }),
    ),
  )

  return {
    inspectedAtUtc: new Date().toISOString(),
    source: 'invoice',
    invoiceInternalId: normalizedInvoiceInternalId,
    invoiceDocument: attachmentRows[0]?.invoiceDocument ?? null,
    attachmentCount: attachments.length,
    attachments,
  }
}

export async function inspectNetSuiteFileFromReference(options: {
  fileId?: string | null
  mediaUrl?: string | null
  includeText?: boolean
}) {
  const fileId = resolveFileId(options.fileId ?? null, options.mediaUrl ?? null)
  if (!fileId) {
    throw new NetSuiteAttachmentInspectionError('fileId or mediaUrl is required.', 400)
  }

  const attachment = await inspectNetSuiteFile({
    fileId,
    includeText: options.includeText ?? false,
  })

  return {
    inspectedAtUtc: new Date().toISOString(),
    source: 'file',
    fileId,
    attachment,
  }
}

async function inspectNetSuiteFile(options: {
  fileId: string
  includeText: boolean
  invoiceInternalId?: string | null
  invoiceDocument?: string | null
  searchRow?: InvoiceAttachmentSearchRow | null
}) {
  const fileRecord = await fetchSoapFileRecord(options.fileId)
  const fileBuffer =
    typeof fileRecord.contentBase64 === 'string' && fileRecord.contentBase64
      ? Buffer.from(fileRecord.contentBase64, 'base64')
      : null

  const isPdf = normalizeFileType(fileRecord.fileType ?? options.searchRow?.fileType) === '_pdf'
  let parsedText: string | null = null
  let parseError: string | null = null

  if (isPdf && fileBuffer) {
    const resolvedFileName =
      fileRecord.name ?? options.searchRow?.name ?? `netsuite-file-${options.fileId}.pdf`
    await cacheInventoryCertificateFile(resolvedFileName, fileBuffer).catch(() => undefined)

    try {
      parsedText = await extractPdfText(fileBuffer)
    } catch (error) {
      parseError = error instanceof Error ? error.message : 'Unknown PDF parse error.'
    }
  }

  const detectedSignals = parsedText ? extractPaymentReceiptSignals(parsedText) : null
  const textExcerpt = parsedText ? createTextExcerpt(parsedText, 1200) : null

  return {
    invoiceInternalId: options.invoiceInternalId ?? null,
    invoiceDocument: options.invoiceDocument ?? null,
    fileId: fileRecord.fileId,
    name: fileRecord.name ?? options.searchRow?.name ?? null,
    fileType: fileRecord.fileType ?? options.searchRow?.fileType ?? null,
    mediaTypeName: fileRecord.mediaTypeName ?? null,
    fileSize: fileRecord.fileSize ?? null,
    url: fileRecord.url ?? options.searchRow?.url ?? null,
    isInactive: fileRecord.isInactive,
    textExtractionSupported: isPdf,
    textExtractionStatus: parsedText
      ? 'parsed'
      : isPdf && fileBuffer
        ? 'failed'
        : isPdf
          ? 'missing_content'
          : 'unsupported',
    parseError,
    detectedSignals,
    parsedTextExcerpt: textExcerpt,
    parsedText: options.includeText ? parsedText : null,
  }
}

async function searchInvoiceAttachmentRows(invoiceInternalId: string) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:platformMsgs="urn:messages_${SOAP_VERSION}.platform.webservices.netsuite.com"
  xmlns:platformCore="urn:core_${SOAP_VERSION}.platform.webservices.netsuite.com"
  xmlns:platformCommon="urn:common_${SOAP_VERSION}.platform.webservices.netsuite.com"
  xmlns:tranSales="urn:sales_${SOAP_VERSION}.transactions.webservices.netsuite.com"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soapenv:Header>
    ${buildSoapTokenPassportHeader()}
    <platformMsgs:searchPreferences>
      <platformMsgs:bodyFieldsOnly>false</platformMsgs:bodyFieldsOnly>
      <platformMsgs:returnSearchColumns>true</platformMsgs:returnSearchColumns>
      <platformMsgs:pageSize>50</platformMsgs:pageSize>
    </platformMsgs:searchPreferences>
  </soapenv:Header>
  <soapenv:Body>
    <platformMsgs:search>
      <platformMsgs:searchRecord xsi:type="tranSales:TransactionSearchAdvanced">
        <tranSales:criteria>
          <tranSales:basic>
            <platformCommon:internalId operator="anyOf">
              <platformCore:searchValue internalId="${escapeXml(invoiceInternalId)}" xsi:type="platformCore:RecordRef"/>
            </platformCommon:internalId>
          </tranSales:basic>
        </tranSales:criteria>
        <tranSales:columns>
          <tranSales:basic>
            <platformCommon:internalId/>
            <platformCommon:tranId/>
          </tranSales:basic>
          <tranSales:fileJoin>
            <platformCommon:internalId/>
            <platformCommon:name/>
            <platformCommon:url/>
            <platformCommon:fileType/>
          </tranSales:fileJoin>
        </tranSales:columns>
      </platformMsgs:searchRecord>
    </platformMsgs:search>
  </soapenv:Body>
</soapenv:Envelope>`

  const document = await postSoapRequest('search', xml)
  const rows = getDescendantsByLocalName(document, 'searchRow')
  const deduped = new Map<string, InvoiceAttachmentSearchRow>()

  for (const row of rows) {
    const basic = getFirstChildByLocalName(row, 'basic')
    const fileJoin = getFirstChildByLocalName(row, 'fileJoin')
    if (!basic || !fileJoin) {
      continue
    }

    const fileId = getSearchColumnInternalId(fileJoin, 'internalId')
    if (!fileId) {
      continue
    }

    deduped.set(fileId, {
      invoiceInternalId: getSearchColumnInternalId(basic, 'internalId') ?? invoiceInternalId,
      invoiceDocument: getSearchColumnValue(basic, 'tranId'),
      fileId,
      name: getSearchColumnValue(fileJoin, 'name'),
      url: getSearchColumnValue(fileJoin, 'url'),
      fileType: getSearchColumnValue(fileJoin, 'fileType'),
    })
  }

  return Array.from(deduped.values()).sort((left, right) =>
    (left.name ?? left.fileId).localeCompare(right.name ?? right.fileId),
  )
}

async function fetchSoapFileRecord(fileId: string) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:platformMsgs="urn:messages_${SOAP_VERSION}.platform.webservices.netsuite.com"
  xmlns:platformCore="urn:core_${SOAP_VERSION}.platform.webservices.netsuite.com"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soapenv:Header>
    ${buildSoapTokenPassportHeader()}
  </soapenv:Header>
  <soapenv:Body>
    <platformMsgs:get>
      <platformMsgs:baseRef internalId="${escapeXml(fileId)}" type="file" xsi:type="platformCore:RecordRef"/>
    </platformMsgs:get>
  </soapenv:Body>
</soapenv:Envelope>`

  const document = await postSoapRequest('get', xml)
  const record = getFirstDescendantByLocalName(document, 'record')

  if (!record) {
    throw new NetSuiteAttachmentInspectionError(`NetSuite SOAP did not return a File record for ${fileId}.`)
  }

  return {
    fileId: record.getAttribute('internalId')?.trim() || fileId,
    name: getFirstDescendantText(record, 'name'),
    url: getFirstDescendantText(record, 'url'),
    fileType: getFirstDescendantText(record, 'fileType'),
    mediaTypeName: getFirstDescendantText(record, 'mediaTypeName'),
    fileSize: toNullableNumber(getFirstDescendantText(record, 'fileSize')),
    isInactive: parseSoapBoolean(getFirstDescendantText(record, 'isInactive')),
    contentBase64: compactBase64(getFirstDescendantText(record, 'content')),
  } satisfies FileRecordContent
}

async function extractPdfText(fileBuffer: Buffer) {
  const parser = new PDFParse({ data: fileBuffer })

  try {
    const result = await parser.getText()
    return result.text?.trim() || null
  } finally {
    await parser.destroy().catch(() => undefined)
  }
}

function extractPaymentReceiptSignals(text: string): PaymentReceiptSignals {
  const lines = normalizeTextLines(text)
  const amountCandidates = extractCurrencyAmounts(text)

  return {
    transferAmount: findLabeledAmount(lines, [
      'cantidad a transferir',
      'monto',
      'importe',
      'cantidad transferida',
    ]),
    amountCandidates,
    referenceNumber: findLabeledValue(lines, ['numero de referencia', 'referencia']),
    bankName: findLabeledValue(lines, ['banco']),
    operationDateText: findLabeledValue(lines, ['fecha de operacion spei', 'fecha solicita']),
    paymentConcept: findLabeledValue(lines, ['concepto de pago', 'concepto']),
    sourceAccountHint: findLabeledValue(lines, ['cuenta origen']),
    destinationAccountHint: findLabeledValue(lines, ['cuenta destino']),
  }
}

function normalizeTextLines(text: string) {
  return text
    .replace(/\r/g, '\n')
    .split(/\n+/)
    .map((line) => line.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function findLabeledAmount(lines: string[], labels: string[]) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const normalizedLine = normalizeForMatch(line)

    if (!labels.some((label) => normalizedLine.includes(normalizeForMatch(label)))) {
      continue
    }

    const sameLineAmounts = extractCurrencyAmounts(line)
    if (sameLineAmounts.length > 0) {
      return sameLineAmounts[0]
    }

    const nearbyLines = [lines[index - 1], lines[index + 1], lines[index + 2]].filter(
      (value): value is string => typeof value === 'string',
    )

    for (const nearbyLine of nearbyLines) {
      const nearbyAmounts = extractCurrencyAmounts(nearbyLine)
      if (nearbyAmounts.length > 0) {
        return nearbyAmounts[0]
      }
    }
  }

  return null
}

function findLabeledValue(lines: string[], labels: string[]) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const normalizedLine = normalizeForMatch(line)
    const matchedLabel = labels.find((label) => normalizedLine.includes(normalizeForMatch(label)))
    if (!matchedLabel) {
      continue
    }

    const valueInSameLine = stripLabelFromLine(line, matchedLabel)
    if (valueInSameLine) {
      return valueInSameLine
    }

    const nearbyLines = [lines[index - 1], lines[index + 1], lines[index + 2]].filter(
      (value): value is string => typeof value === 'string',
    )

    for (const nearbyLine of nearbyLines) {
      if (!labels.some((label) => nearbyLine.toLowerCase().includes(label))) {
        return nearbyLine
      }
    }
  }

  return null
}

function stripLabelFromLine(line: string, label: string) {
  const normalizedLabel = normalizeForMatch(label)
  const normalizedLine = normalizeForMatch(line)
  if (!normalizedLine.includes(normalizedLabel)) {
    return null
  }

  const labelTokens = new Set(normalizedLabel.split(/\s+/).filter(Boolean))
  const filteredTokens = line
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => {
      const normalizedToken = normalizeForMatch(token).replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}$]+$/gu, '')
      return normalizedToken && !labelTokens.has(normalizedToken)
    })

  const value = filteredTokens.join(' ').replace(/[:\-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return value || null
}

function normalizeForMatch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function extractCurrencyAmounts(text: string) {
  const matches = text.match(/\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})|\$\s?\d+(?:\.\d{2})/g) ?? []
  const amounts = matches
    .map((match) => Number.parseFloat(match.replace(/\$/g, '').replace(/,/g, '').trim()))
    .filter((amount) => Number.isFinite(amount))

  return Array.from(new Set(amounts))
}

function createTextExcerpt(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength).trim()}...`
}

function buildSoapFailureError(status: number, responseText: string) {
  return new NetSuiteAttachmentInspectionError(
    normalizeSoapFailureMessage(
      `NetSuite SOAP HTTP ${status}: ${createTextExcerpt(responseText, 400)}`,
    ),
    status >= 500 ? 503 : status,
  )
}

function normalizeSoapFailureMessage(message: string) {
  if (isSuiteTalkConcurrencyMessage(message)) {
    return 'NetSuite bloqueo temporalmente la lectura del CoA por limite concurrente de SuiteTalk. Reintenta en unos segundos.'
  }

  return message
}

function isRetryableSoapError(message: string) {
  return isSuiteTalkConcurrencyMessage(message)
}

function isSuiteTalkConcurrencyMessage(message: string) {
  const normalized = normalizeForMatch(message)

  return (
    normalized.includes('suitetalk concurrent request limit exceeded') ||
    normalized.includes('concurrent request limit exceeded') ||
    (normalized.includes('concurrent request') && normalized.includes('request blocked'))
  )
}

function waitForMs(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function postSoapRequest(soapAction: string, body: string) {
  const config = getSoapTbaConfig()
  let lastError: NetSuiteAttachmentInspectionError | null = null

  for (let attemptIndex = 0; attemptIndex <= SOAP_RETRY_DELAYS_MS.length; attemptIndex += 1) {
    try {
      return await postSoapRequestOnce(config, soapAction, body)
    } catch (error) {
      const normalizedError =
        error instanceof NetSuiteAttachmentInspectionError
          ? error
          : new NetSuiteAttachmentInspectionError(
              error instanceof Error ? error.message : 'Unknown NetSuite SOAP error.',
            )

      lastError = normalizedError
      if (
        !isRetryableSoapError(normalizedError.message) ||
        attemptIndex >= SOAP_RETRY_DELAYS_MS.length
      ) {
        throw normalizedError
      }

      await waitForMs(SOAP_RETRY_DELAYS_MS[attemptIndex])
    }
  }

  throw lastError ?? new NetSuiteAttachmentInspectionError('Unknown NetSuite SOAP error.')
}

async function postSoapRequestOnce(config: SoapTbaConfig, soapAction: string, body: string) {
  const response = await fetch(config.baseUrl + SOAP_ENDPOINT_SUFFIX, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: soapAction,
    },
    body,
  })

  const responseText = await response.text()
  if (!response.ok) {
    throw buildSoapFailureError(response.status, responseText)
  }

  const document = new DOMParser().parseFromString(responseText, 'text/xml')
  const fault = getFirstDescendantByLocalName(document, 'Fault')
  if (fault) {
    const faultMessage =
      getFirstDescendantText(fault, 'faultstring') ||
      getFirstDescendantText(fault, 'message') ||
      'Unknown NetSuite SOAP fault.'
    throw new NetSuiteAttachmentInspectionError(
      normalizeSoapFailureMessage(`NetSuite SOAP fault: ${faultMessage}`),
    )
  }

  const status = getFirstDescendantByLocalName(document, 'status')
  const isSuccess = status?.getAttribute('isSuccess')
  if (isSuccess === 'false') {
    const details = getDescendantsByLocalName(document, 'statusDetail')
      .map((detail) => getFirstDescendantText(detail, 'message'))
      .filter((message): message is string => Boolean(message))
    throw new NetSuiteAttachmentInspectionError(
      normalizeSoapFailureMessage(
        `NetSuite SOAP status error: ${details.join(' | ') || 'Unknown status failure.'}`,
      ),
    )
  }

  return document
}

function buildSoapTokenPassportHeader() {
  const config = getSoapTbaConfig()
  const nonce = crypto.randomBytes(12).toString('hex')
  const timestamp = String(Math.floor(Date.now() / 1000))
  const baseString = [config.accountId, config.consumerKey, config.tokenId, nonce, timestamp].join('&')
  const signingKey = `${encodeURIComponent(config.consumerSecret)}&${encodeURIComponent(config.tokenSecret)}`
  const signature = crypto.createHmac('sha256', signingKey).update(baseString).digest('base64')

  return `<platformMsgs:tokenPassport>
      <platformCore:account>${escapeXml(config.accountId)}</platformCore:account>
      <platformCore:consumerKey>${escapeXml(config.consumerKey)}</platformCore:consumerKey>
      <platformCore:token>${escapeXml(config.tokenId)}</platformCore:token>
      <platformCore:nonce>${escapeXml(nonce)}</platformCore:nonce>
      <platformCore:timestamp>${escapeXml(timestamp)}</platformCore:timestamp>
      <platformCore:signature algorithm="HMAC_SHA256">${escapeXml(signature)}</platformCore:signature>
    </platformMsgs:tokenPassport>`
}

function getSoapTbaConfig(): SoapTbaConfig {
  loadLocalEnv()

  const accountId = process.env.NETSUITE_ACCOUNT_ID?.trim() ?? ''
  const restBaseUrl = process.env.NETSUITE_BASE_URL?.trim().replace(/\/+$/, '') ?? ''
  const consumerKey = process.env.NETSUITE_CONSUMER_KEY?.trim() ?? ''
  const consumerSecret = process.env.NETSUITE_CONSUMER_SECRET?.trim() ?? ''
  const tokenId = process.env.NETSUITE_TOKEN_ID?.trim() ?? ''
  const tokenSecret = process.env.NETSUITE_TOKEN_SECRET?.trim() ?? ''

  const missing = [
    ['NETSUITE_ACCOUNT_ID', accountId],
    ['NETSUITE_BASE_URL', restBaseUrl],
    ['NETSUITE_CONSUMER_KEY', consumerKey],
    ['NETSUITE_CONSUMER_SECRET', consumerSecret],
    ['NETSUITE_TOKEN_ID', tokenId],
    ['NETSUITE_TOKEN_SECRET', tokenSecret],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (missing.length > 0) {
    throw new NetSuiteAttachmentInspectionError(
      `Missing NetSuite TBA configuration for SOAP attachment inspection: ${missing.join(', ')}`,
      503,
    )
  }

  return {
    accountId,
    baseUrl: restBaseUrl,
    consumerKey,
    consumerSecret,
    tokenId,
    tokenSecret,
  }
}

function resolveFileId(fileId: string | null, mediaUrl: string | null) {
  if (typeof fileId === 'string' && fileId.trim()) {
    return fileId.trim()
  }

  if (!mediaUrl?.trim()) {
    return null
  }

  try {
    const absoluteUrl = mediaUrl.startsWith('http') ? mediaUrl : `https://dummy.local${mediaUrl}`
    const parsedUrl = new URL(absoluteUrl)
    const id = parsedUrl.searchParams.get('id')?.trim()
    return id || null
  } catch {
    return null
  }
}

function getSearchColumnValue(parent: any, localName: string) {
  const field = getFirstChildByLocalName(parent, localName)
  if (!field) {
    return null
  }

  const searchValue = getFirstDescendantByLocalName(field, 'searchValue')
  const text = searchValue?.textContent?.trim()
  return text || null
}

function getSearchColumnInternalId(parent: any, localName: string) {
  const field = getFirstChildByLocalName(parent, localName)
  if (!field) {
    return null
  }

  const searchValue = getFirstDescendantByLocalName(field, 'searchValue')
  const internalId = searchValue?.getAttribute('internalId')?.trim()
  return internalId || null
}

function compactBase64(value: string | null) {
  const compacted = value?.replace(/\s+/g, '').trim() ?? ''
  return compacted || null
}

function normalizeFileType(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? null
}

function toNullableNumber(value: string | null) {
  if (!value) {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseSoapBoolean(value: string | null) {
  if (!value) {
    return null
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'true' || normalized === 't') {
    return true
  }

  if (normalized === 'false' || normalized === 'f') {
    return false
  }

  return null
}

function getFirstDescendantText(node: any, localName: string) {
  return getFirstDescendantByLocalName(node, localName)?.textContent?.trim() || null
}

function getFirstChildByLocalName(node: any, localName: string) {
  for (const child of getChildElements(node)) {
    if (child.localName === localName) {
      return child
    }
  }

  return null
}

function getFirstDescendantByLocalName(node: any, localName: string): any | null {
  for (const child of getChildElements(node)) {
    if (child.localName === localName) {
      return child
    }

    const nestedMatch = getFirstDescendantByLocalName(child, localName)
    if (nestedMatch) {
      return nestedMatch
    }
  }

  return null
}

function getDescendantsByLocalName(node: any, localName: string): any[] {
  const matches: any[] = []

  for (const child of getChildElements(node)) {
    if (child.localName === localName) {
      matches.push(child)
    }

    matches.push(...getDescendantsByLocalName(child, localName))
  }

  return matches
}

function getChildElements(node: any) {
  const children: any[] = []
  const nodeList = node?.childNodes

  if (!nodeList) {
    return children
  }

  for (let index = 0; index < nodeList.length; index += 1) {
    const child = nodeList.item(index)
    if (child?.nodeType === 1) {
      children.push(child)
    }
  }

  return children
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
