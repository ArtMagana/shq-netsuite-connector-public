import { NetSuiteClient } from './netsuiteClient.js'

type SearchEntityKind = 'supplier' | 'customer'
type SearchTransactionTypeId = 'invoice'

type SearchTransactionEntityOption = {
  internalId: string
  displayName: string
  entityId: string | null
  altName: string | null
  companyName: string | null
  rfc: string | null
}

type SearchTransactionBootstrapPeriod = {
  internalId: string
  name: string
  startDate: string | null
  endDate: string | null
}

type SearchTransactionBootstrapResponse = {
  generatedAtUtc: string
  entityKinds: Array<{
    id: SearchEntityKind
    label: string
  }>
  transactionTypes: Array<{
    id: SearchTransactionTypeId
    label: string
    description: string
    supportedEntityKinds: SearchEntityKind[]
  }>
  postingPeriods: SearchTransactionBootstrapPeriod[]
}

type SearchTransactionsRequest = {
  entityKind: SearchEntityKind
  transactionTypeId: SearchTransactionTypeId
  postingPeriodStartId: string
  postingPeriodEndId: string
  entityInternalId: string | null
  limit: number
}

type SearchTransactionSummaryRow = {
  internalId: string
  tranId: string | null
  transactionNumber: string | null
  transactionDate: string | null
  postingPeriodId: string | null
  postingPeriodName: string | null
  entityId: string | null
  entityName: string | null
  currencyName: string | null
}

type SearchTransactionEntitiesResponse = {
  generatedAtUtc: string
  entityKind: SearchEntityKind
  entityLabel: string
  count: number
  items: SearchTransactionEntityOption[]
}

type SearchTransactionLineResult = {
  lineNumber: number
  source: 'item' | 'expense'
  satCode: string | null
  description: string | null
  subtotalBeforeTax: number | null
  taxes: number | null
  totalWithTax: number | null
}

type SearchTransactionResult = {
  internalId: string
  recordType: 'invoice' | 'vendorBill'
  entityKind: SearchEntityKind
  transactionTypeId: SearchTransactionTypeId
  transactionTypeLabel: string
  transactionNumber: string | null
  tranId: string | null
  transactionDate: string | null
  entityInternalId: string | null
  entityName: string | null
  postingPeriodId: string | null
  postingPeriodName: string | null
  currencyName: string | null
  folioFiscal: string | null
  subtotalBeforeTax: number | null
  taxes: number | null
  totalWithTax: number | null
  satLineCodes: SearchTransactionLineResult[]
}

type SearchTransactionsResponse = {
  generatedAtUtc: string
  filters: {
    entityKind: SearchEntityKind
    entityLabel: string
    transactionTypeId: SearchTransactionTypeId
    transactionTypeLabel: string
    postingPeriodStartId: string
    postingPeriodStartName: string
    postingPeriodEndId: string
    postingPeriodEndName: string
    postingPeriodIds: string[]
    entityInternalId: string | null
    entityDisplayName: string | null
    limit: number
  }
  summary: {
    transactions: number
    transactionsWithFolioFiscal: number
    satLines: number
  }
  results: SearchTransactionResult[]
}

type SearchTransactionRecordConfig = {
  entityKind: SearchEntityKind
  entityLabel: string
  suiteQlTransactionType: 'CustInvc' | 'VendBill'
  recordType: 'invoice' | 'vendorBill'
  transactionTypeId: SearchTransactionTypeId
  transactionTypeLabel: string
}

export class SearchTransactionsError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'SearchTransactionsError'
  }
}

const SEARCH_TRANSACTION_TYPES: SearchTransactionBootstrapResponse['transactionTypes'] = [
  {
    id: 'invoice',
    label: 'Factura',
    description: 'Busca facturas de cliente o proveedor en NetSuite, segun la entidad seleccionada.',
    supportedEntityKinds: ['customer', 'supplier'],
  },
]

const SEARCH_ENTITY_KINDS: SearchTransactionBootstrapResponse['entityKinds'] = [
  { id: 'supplier', label: 'Proveedor' },
  { id: 'customer', label: 'Cliente' },
]

const SEARCH_RECORD_CONFIG: Record<SearchEntityKind, SearchTransactionRecordConfig> = {
  supplier: {
    entityKind: 'supplier',
    entityLabel: 'Proveedor',
    suiteQlTransactionType: 'VendBill',
    recordType: 'vendorBill',
    transactionTypeId: 'invoice',
    transactionTypeLabel: 'Factura',
  },
  customer: {
    entityKind: 'customer',
    entityLabel: 'Cliente',
    suiteQlTransactionType: 'CustInvc',
    recordType: 'invoice',
    transactionTypeId: 'invoice',
    transactionTypeLabel: 'Factura',
  },
}

const MAX_SEARCH_LIMIT = 40
const DEFAULT_SEARCH_LIMIT = 25
const SEARCH_FETCH_CONCURRENCY = 3
const POSTING_PERIOD_CACHE_TTL_MS = 5 * 60 * 1000
const ENTITY_OPTIONS_CACHE_TTL_MS = 5 * 60 * 1000

let entityOptionsCache: Partial<
  Record<
    SearchEntityKind,
    {
      storedAtMs: number
      items: SearchTransactionEntityOption[]
    }
  >
> = {}

let postingPeriodCache:
  | {
      storedAtMs: number
      periods: SearchTransactionBootstrapPeriod[]
    }
  | null = null

export async function fetchSearchTransactionsBootstrap(
  client: NetSuiteClient,
): Promise<SearchTransactionBootstrapResponse> {
  return {
    generatedAtUtc: new Date().toISOString(),
    entityKinds: SEARCH_ENTITY_KINDS,
    transactionTypes: SEARCH_TRANSACTION_TYPES,
    postingPeriods: await fetchPostingPeriods(client),
  }
}

export async function fetchSearchTransactionEntities(
  client: NetSuiteClient,
  rawEntityKind: unknown,
): Promise<SearchTransactionEntitiesResponse> {
  const entityKind = normalizeEntityKind(rawEntityKind)
  const config = resolveRecordConfig(entityKind, 'invoice')
  const items = await fetchEntityOptions(client, entityKind)

  return {
    generatedAtUtc: new Date().toISOString(),
    entityKind,
    entityLabel: config.entityLabel,
    count: items.length,
    items,
  }
}

export async function searchTransactions(
  client: NetSuiteClient,
  rawRequest: unknown,
): Promise<SearchTransactionsResponse> {
  const request = normalizeSearchTransactionsRequest(rawRequest)
  const postingPeriods = await fetchPostingPeriods(client)
  const periodRange = resolvePostingPeriodRange(
    postingPeriods,
    request.postingPeriodStartId,
    request.postingPeriodEndId,
  )
  const config = resolveRecordConfig(request.entityKind, request.transactionTypeId)
  const summaryRows = await fetchSearchTransactionSummaryRows(
    client,
    config,
    periodRange.postingPeriodIds,
    request.entityInternalId,
  )
  const selectedRows = summaryRows.slice(0, request.limit)
  const selectedEntity =
    request.entityInternalId && summaryRows.length > 0
      ? {
          internalId: summaryRows[0].entityId,
          displayName: summaryRows[0].entityName,
        }
      : null

  const results = await mapWithConcurrency(
    selectedRows,
    SEARCH_FETCH_CONCURRENCY,
    async (summary) => {
      const rawRecord = await fetchSearchTransactionRecord(client, config.recordType, summary.internalId)
      return normalizeSearchTransactionResult(config, summary, rawRecord)
    },
  )

  return {
    generatedAtUtc: new Date().toISOString(),
    filters: {
      entityKind: config.entityKind,
      entityLabel: config.entityLabel,
      transactionTypeId: config.transactionTypeId,
      transactionTypeLabel: config.transactionTypeLabel,
      postingPeriodStartId: periodRange.start.internalId,
      postingPeriodStartName: periodRange.start.name,
      postingPeriodEndId: periodRange.end.internalId,
      postingPeriodEndName: periodRange.end.name,
      postingPeriodIds: periodRange.postingPeriodIds,
      entityInternalId: request.entityInternalId,
      entityDisplayName: selectedEntity?.displayName ?? null,
      limit: request.limit,
    },
    summary: {
      transactions: results.length,
      transactionsWithFolioFiscal: results.filter((item) => Boolean(item.folioFiscal)).length,
      satLines: results.reduce((total, item) => total + item.satLineCodes.length, 0),
    },
    results,
  }
}

async function fetchPostingPeriods(client: NetSuiteClient) {
  const cache = postingPeriodCache
  if (cache && Date.now() - cache.storedAtMs < POSTING_PERIOD_CACHE_TTL_MS) {
    return cache.periods
  }

  const response = await client.suiteql(
    `
SELECT
  transaction.postingperiod AS internalId,
  BUILTIN.DF(transaction.postingperiod) AS name,
  MIN(transaction.trandate) AS startDate,
  MAX(transaction.trandate) AS endDate
FROM transaction
WHERE transaction.type IN ('CustInvc', 'VendBill')
  AND transaction.postingperiod IS NOT NULL
GROUP BY
  transaction.postingperiod,
  BUILTIN.DF(transaction.postingperiod)
    `.trim(),
    300,
    0,
  )

  const json = response.json as {
    items?: Array<Record<string, unknown>>
  }

  const periods = (json.items ?? [])
    .map(toSearchTransactionBootstrapPeriod)
    .filter((period): period is SearchTransactionBootstrapPeriod => period !== null)
    .sort(comparePostingPeriodsDesc)

  postingPeriodCache = {
    storedAtMs: Date.now(),
    periods,
  }

  return periods
}

async function fetchEntityOptions(
  client: NetSuiteClient,
  entityKind: SearchEntityKind,
) {
  const cache = entityOptionsCache[entityKind]
  if (cache && Date.now() - cache.storedAtMs < ENTITY_OPTIONS_CACHE_TTL_MS) {
    return cache.items
  }

  const recordType = entityKind === 'customer' ? 'customer' : 'vendor'
  const items = await fetchAllSuiteQlRows(
    client,
    `
SELECT
  entityrecord.id AS internalId,
  entityrecord.entityid AS entityId,
  entityrecord.altname AS altName,
  entityrecord.companyname AS companyName,
  entityrecord.custentity_mx_rfc AS rfc
FROM ${recordType} entityrecord
WHERE entityrecord.isinactive = 'F'
ORDER BY entityrecord.id ASC
    `.trim(),
  )

  const parsedItems = items
    .map(toSearchTransactionEntityOption)
    .filter((item): item is SearchTransactionEntityOption => item !== null)
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'es'))

  entityOptionsCache[entityKind] = {
    storedAtMs: Date.now(),
    items: parsedItems,
  }

  return parsedItems
}

function resolvePostingPeriodRange(
  postingPeriods: SearchTransactionBootstrapPeriod[],
  postingPeriodStartId: string,
  postingPeriodEndId: string,
) {
  const orderedPeriods = [...postingPeriods].sort(comparePostingPeriodsAsc)
  const startIndex = orderedPeriods.findIndex((period) => period.internalId === postingPeriodStartId)
  const endIndex = orderedPeriods.findIndex((period) => period.internalId === postingPeriodEndId)

  if (startIndex < 0) {
    throw new SearchTransactionsError(
      `El periodo inicial ${postingPeriodStartId} no existe en el catalogo de periodos contables.`,
    )
  }

  if (endIndex < 0) {
    throw new SearchTransactionsError(
      `El periodo final ${postingPeriodEndId} no existe en el catalogo de periodos contables.`,
    )
  }

  const lowerIndex = Math.min(startIndex, endIndex)
  const upperIndex = Math.max(startIndex, endIndex)
  const selectedPeriods = orderedPeriods.slice(lowerIndex, upperIndex + 1)

  return {
    start: selectedPeriods[0],
    end: selectedPeriods[selectedPeriods.length - 1],
    postingPeriodIds: selectedPeriods.map((period) => period.internalId),
  }
}

async function fetchSearchTransactionSummaryRows(
  client: NetSuiteClient,
  config: SearchTransactionRecordConfig,
  postingPeriodIds: string[],
  entityInternalId: string | null,
) {
  if (postingPeriodIds.length === 0) {
    return [] as SearchTransactionSummaryRow[]
  }

  const entityFilter = entityInternalId
    ? `\n  AND transaction.entity = ${formatSuiteQlLiteral(entityInternalId)}`
    : ''

  const response = await client.suiteql(
    `
SELECT
  transaction.id AS internalId,
  transaction.tranid AS tranId,
  transaction.transactionnumber AS transactionNumber,
  transaction.trandate AS transactionDate,
  transaction.postingperiod AS postingPeriodId,
  BUILTIN.DF(transaction.postingperiod) AS postingPeriodName,
  transaction.entity AS entityId,
  BUILTIN.DF(transaction.entity) AS entityName,
  BUILTIN.DF(transaction.currency) AS currencyName
FROM transaction
WHERE transaction.type = ${formatSuiteQlLiteral(config.suiteQlTransactionType)}
  AND transaction.postingperiod IN (${joinSuiteQlLiterals(postingPeriodIds)})
${entityFilter}
ORDER BY transaction.trandate DESC, transaction.id DESC
    `.trim(),
    MAX_SEARCH_LIMIT,
    0,
  )

  const json = response.json as {
    items?: Array<Record<string, unknown>>
  }

  return (json.items ?? []).map(toSearchTransactionSummaryRow)
}

async function fetchSearchTransactionRecord(
  client: NetSuiteClient,
  recordType: SearchTransactionRecordConfig['recordType'],
  internalId: string,
) {
  const response = await client.getRecord(recordType, internalId, {
    expandSubResources: true,
  })

  return response.json as Record<string, unknown>
}

function normalizeSearchTransactionResult(
  config: SearchTransactionRecordConfig,
  summary: SearchTransactionSummaryRow,
  rawRecord: Record<string, unknown>,
): SearchTransactionResult {
  const satLineCodes = extractSearchTransactionLines(rawRecord)
  const lineSubtotal = sumNullableNumbers(satLineCodes.map((line) => line.subtotalBeforeTax))
  const lineTaxes = sumNullableNumbers(satLineCodes.map((line) => line.taxes))
  const subtotalBeforeTax = firstNumber(rawRecord, ['subtotal', 'subTotal', 'usertotal']) ?? lineSubtotal
  const taxes =
    firstNumber(rawRecord, ['taxTotal', 'taxtotal', 'taxAmount', 'tax1Total', 'totalTax']) ??
    lineTaxes
  const totalWithTax =
    firstNumber(rawRecord, ['total', 'foreignTotal', 'foreigntotal']) ??
    (subtotalBeforeTax !== null || taxes !== null ? (subtotalBeforeTax ?? 0) + (taxes ?? 0) : null)

  return {
    internalId: summary.internalId,
    recordType: config.recordType,
    entityKind: config.entityKind,
    transactionTypeId: config.transactionTypeId,
    transactionTypeLabel: config.transactionTypeLabel,
    transactionNumber:
      asOptionalString(rawRecord.transactionNumber) ??
      asOptionalString(rawRecord.tranid) ??
      summary.transactionNumber,
    tranId: asOptionalString(rawRecord.tranId) ?? summary.tranId,
    transactionDate: asOptionalString(rawRecord.tranDate) ?? summary.transactionDate,
    entityInternalId: getReferenceId(rawRecord.entity) ?? summary.entityId,
    entityName: getReferenceRefName(rawRecord.entity) ?? summary.entityName,
    postingPeriodId: getReferenceId(rawRecord.postingPeriod) ?? summary.postingPeriodId,
    postingPeriodName: getReferenceRefName(rawRecord.postingPeriod) ?? summary.postingPeriodName,
    currencyName: getReferenceRefName(rawRecord.currency) ?? summary.currencyName,
    folioFiscal: extractFolioFiscal(rawRecord),
    subtotalBeforeTax,
    taxes,
    totalWithTax,
    satLineCodes,
  }
}

function extractSearchTransactionLines(rawRecord: Record<string, unknown>) {
  const itemLines = extractSublistLines(rawRecord.item, 'item')
  const expenseLines = extractSublistLines(rawRecord.expense, 'expense')
  return [...itemLines, ...expenseLines]
}

function extractSublistLines(
  sublist: unknown,
  source: SearchTransactionLineResult['source'],
) {
  const collection = getNullableRecord(sublist)
  const items = Array.isArray(collection?.items) ? collection.items : []

  return items
    .map((item) => getNullableRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((line, index): SearchTransactionLineResult => {
      const subtotalBeforeTax = firstNumber(line, [
        'amount',
        'grossamt',
        'grossAmount',
        'debit',
        'credit',
      ])
      const taxes = firstNumber(line, ['tax1amt', 'taxAmount', 'taxAmt', 'tax1Amt'])
      const totalWithTax =
        firstNumber(line, ['grossamt', 'grossAmount']) ??
        (subtotalBeforeTax !== null || taxes !== null ? (subtotalBeforeTax ?? 0) + (taxes ?? 0) : null)

      return {
        lineNumber: normalizeLineNumber(line.line, index),
        source,
        satCode: extractSatCodeFromLine(line),
        description:
          asOptionalString(line.description) ??
          getReferenceRefName(line.item) ??
          getReferenceRefName(line.account),
        subtotalBeforeTax,
        taxes,
        totalWithTax,
      }
    })
}

function extractFolioFiscal(rawRecord: Record<string, unknown>) {
  const directCandidates = [
    rawRecord.custbody_mx_cfdi_uuid,
    rawRecord.custbody_mx_inbound_bill_uuid,
    rawRecord.custbody_psg_ei_uuid,
    rawRecord.custbody_mx_uuid,
    rawRecord.custbody_uuid,
    rawRecord.uuid,
  ]

  for (const candidate of directCandidates) {
    const value = normalizePotentialUuid(candidate)
    if (value) {
      return value
    }
  }

  for (const [key, value] of Object.entries(rawRecord)) {
    const normalizedKey = key.toLowerCase()
    if (
      normalizedKey.includes('uuid') ||
      normalizedKey.includes('foliofiscal') ||
      normalizedKey.includes('folio_fiscal') ||
      (normalizedKey.includes('cfdi') && normalizedKey.includes('body'))
    ) {
      const candidate = normalizePotentialUuid(value)
      if (candidate) {
        return candidate
      }
    }
  }

  return null
}

function extractSatCodeFromLine(line: Record<string, unknown>) {
  const directCandidates = [
    line.custcol_mx_item_sat_item_code,
    line.custcol_mx_sat_item_code,
    line.custcol_sat_item_code,
    line.custcol_claveprodserv,
    line.custcol_clave_prod_serv,
    line.custcol_mx_claveprodserv,
    line.custcol_mx_clave_prod_serv,
    line.custcol_psg_ei_sat_item_code,
    line.claveProdServ,
    line.satItemCode,
  ]

  for (const candidate of directCandidates) {
    const value = normalizeSatCodeValue(candidate)
    if (value) {
      return value
    }
  }

  for (const [key, value] of Object.entries(line)) {
    const normalizedKey = key.toLowerCase()
    if (
      normalizedKey.includes('claveprodserv') ||
      normalizedKey.includes('prodserv') ||
      (normalizedKey.includes('sat') && normalizedKey.includes('code')) ||
      (normalizedKey.includes('sat') && normalizedKey.includes('item'))
    ) {
      const candidate = normalizeSatCodeValue(value)
      if (candidate) {
        return candidate
      }
    }
  }

  return extractSatCodeFromItemReference(line.item)
}

function normalizeSearchTransactionsRequest(rawRequest: unknown): SearchTransactionsRequest {
  const request = getNullableRecord(rawRequest)
  const entityKind = normalizeEntityKind(request?.entityKind)
  const transactionTypeId = normalizeTransactionTypeId(request?.transactionTypeId)
  const postingPeriodStartId = normalizeRequiredString(
    request?.postingPeriodStartId,
    'Define el periodo contable inicial para la busqueda.',
  )
  const postingPeriodEndId = normalizeRequiredString(
    request?.postingPeriodEndId,
    'Define el periodo contable final para la busqueda.',
  )
  const rawLimit = parseNumber(request?.limit)
  const limit =
    rawLimit !== null && rawLimit > 0
      ? Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.trunc(rawLimit)))
      : DEFAULT_SEARCH_LIMIT
  const entityInternalId = asOptionalString(request?.entityInternalId)

  return {
    entityKind,
    transactionTypeId,
    postingPeriodStartId,
    postingPeriodEndId,
    entityInternalId,
    limit,
  }
}

function normalizeEntityKind(value: unknown): SearchEntityKind {
  const normalizedValue = asOptionalString(value)?.toLowerCase()
  if (normalizedValue === 'supplier' || normalizedValue === 'customer') {
    return normalizedValue
  }

  throw new SearchTransactionsError('La entidad debe ser proveedor o cliente.')
}

function normalizeTransactionTypeId(value: unknown): SearchTransactionTypeId {
  const normalizedValue = asOptionalString(value)?.toLowerCase()
  if (normalizedValue === 'invoice') {
    return normalizedValue
  }

  throw new SearchTransactionsError('El tipo de transaccion solicitado todavia no esta soportado.')
}

function resolveRecordConfig(
  entityKind: SearchEntityKind,
  transactionTypeId: SearchTransactionTypeId,
) {
  const config = SEARCH_RECORD_CONFIG[entityKind]
  if (!config || config.transactionTypeId !== transactionTypeId) {
    throw new SearchTransactionsError(
      'La combinacion de entidad y tipo de transaccion no esta soportada en Search / Find.',
    )
  }

  return config
}

function toSearchTransactionBootstrapPeriod(row: Record<string, unknown>) {
  const normalizedRow = normalizeSuiteQlRow(row)
  const internalId = asOptionalString(normalizedRow.internalid)
  const name = asOptionalString(normalizedRow.name)

  if (!internalId || !name) {
    return null
  }

  return {
    internalId,
    name,
    startDate: asOptionalString(normalizedRow.startdate),
    endDate: asOptionalString(normalizedRow.enddate),
  } satisfies SearchTransactionBootstrapPeriod
}

function toSearchTransactionSummaryRow(row: Record<string, unknown>): SearchTransactionSummaryRow {
  const normalizedRow = normalizeSuiteQlRow(row)

  return {
    internalId: String(normalizedRow.internalid ?? ''),
    tranId: asOptionalString(normalizedRow.tranid),
    transactionNumber: asOptionalString(normalizedRow.transactionnumber),
    transactionDate: asOptionalString(normalizedRow.transactiondate),
    postingPeriodId: asOptionalString(normalizedRow.postingperiodid),
    postingPeriodName: asOptionalString(normalizedRow.postingperiodname),
    entityId: asOptionalString(normalizedRow.entityid),
    entityName: asOptionalString(normalizedRow.entityname),
    currencyName: asOptionalString(normalizedRow.currencyname),
  }
}

function toSearchTransactionEntityOption(row: Record<string, unknown>) {
  const normalizedRow = normalizeSuiteQlRow(row)
  const internalId = asOptionalString(normalizedRow.internalid)
  const entityId = asOptionalString(normalizedRow.entityid)
  const altName = asOptionalString(normalizedRow.altname)
  const companyName = asOptionalString(normalizedRow.companyname)
  const rfc = asOptionalString(normalizedRow.rfc)
  const displayName = formatEntityDisplayName(entityId, altName, companyName)

  if (!internalId || !displayName) {
    return null
  }

  return {
    internalId,
    displayName,
    entityId,
    altName,
    companyName,
    rfc,
  } satisfies SearchTransactionEntityOption
}

function comparePostingPeriodsAsc(
  left: SearchTransactionBootstrapPeriod,
  right: SearchTransactionBootstrapPeriod,
) {
  const leftDate = parseDateValue(left.startDate)
  const rightDate = parseDateValue(right.startDate)
  if (leftDate !== rightDate) {
    return leftDate - rightDate
  }

  return left.name.localeCompare(right.name, 'es')
}

function comparePostingPeriodsDesc(
  left: SearchTransactionBootstrapPeriod,
  right: SearchTransactionBootstrapPeriod,
) {
  return comparePostingPeriodsAsc(right, left)
}

function normalizeSuiteQlRow(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]),
  ) as Record<string, unknown>
}

async function fetchAllSuiteQlRows(client: NetSuiteClient, query: string) {
  const items: Array<Record<string, unknown>> = []
  const limit = 1000
  let offset = 0

  while (true) {
    const response = await client.suiteql(query, limit, offset)
    const json = response.json as {
      items?: Array<Record<string, unknown>>
      hasMore?: boolean
    }
    const pageItems = json.items ?? []
    if (pageItems.length === 0) {
      break
    }

    items.push(...pageItems)
    offset += pageItems.length

    if (!json.hasMore || pageItems.length < limit) {
      break
    }
  }

  return items
}

function normalizeRequiredString(value: unknown, message: string) {
  const normalizedValue = asOptionalString(value)
  if (!normalizedValue) {
    throw new SearchTransactionsError(message)
  }

  return normalizedValue
}

function normalizePotentialUuid(value: unknown) {
  const rawValue = getReferenceRefName(value) ?? asOptionalString(value) ?? getReferenceId(value)
  if (!rawValue) {
    return null
  }

  const match = rawValue.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)
  return match ? match[0].toUpperCase() : null
}

function normalizeSatCodeValue(value: unknown) {
  const rawValue = getReferenceRefName(value) ?? asOptionalString(value) ?? getReferenceId(value)
  if (!rawValue) {
    return null
  }

  const numericMatch = rawValue.match(/\b\d{8}\b/)
  if (numericMatch) {
    return numericMatch[0]
  }

  return rawValue.trim()
}

function extractSatCodeFromItemReference(value: unknown) {
  const rawValue = getReferenceRefName(value)
  if (!rawValue) {
    return null
  }

  const numericMatch = rawValue.match(/\b\d{8}\b/)
  return numericMatch ? numericMatch[0] : null
}

function normalizeLineNumber(value: unknown, fallbackIndex: number) {
  const parsed = parseNumber(value)
  if (parsed !== null && Number.isFinite(parsed) && parsed > 0) {
    return Math.trunc(parsed)
  }

  return fallbackIndex + 1
}

function parseDateValue(value: string | null) {
  if (!value) {
    return Number.MAX_SAFE_INTEGER
  }

  const dotDateMatch = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (dotDateMatch) {
    const [, day, month, year] = dotDateMatch
    return Date.UTC(Number(year), Number(month) - 1, Number(day))
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? Number.MAX_SAFE_INTEGER : parsed.getTime()
}

function firstNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = parseNumber(record[key])
    if (value !== null) {
      return value
    }
  }

  return null
}

function parseNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string' && value.trim()) {
    const normalized = Number(value)
    return Number.isFinite(normalized) ? normalized : null
  }

  return null
}

function asOptionalString(value: unknown) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value)
  }

  return null
}

function getNullableRecord(value: unknown) {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return null
}

function getReferenceId(value: unknown) {
  const record = getNullableRecord(value)
  if (!record) {
    return asOptionalString(value)
  }

  return asOptionalString(record.id)
}

function getReferenceRefName(value: unknown) {
  const record = getNullableRecord(value)
  if (!record) {
    return asOptionalString(value)
  }

  return asOptionalString(record.refName) ?? asOptionalString(record.name)
}

function sumNullableNumbers(values: Array<number | null>) {
  let total = 0
  let hasValue = false

  for (const value of values) {
    if (value === null) {
      continue
    }

    total += value
    hasValue = true
  }

  return hasValue ? total : null
}

function joinSuiteQlLiterals(values: string[]) {
  return values.map((value) => formatSuiteQlLiteral(value)).join(', ')
}

function formatSuiteQlLiteral(value: string) {
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return value
  }

  return `'${value.replace(/'/g, "''")}'`
}

function formatEntityDisplayName(
  entityId: string | null,
  altName: string | null,
  companyName: string | null,
) {
  const preferredName = companyName ?? altName ?? entityId
  if (!preferredName) {
    return null
  }

  if (entityId && /^\d+$/.test(entityId) && preferredName !== entityId) {
    return `${entityId} ${preferredName}`.trim()
  }

  return preferredName.trim()
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
) {
  const results = new Array<TOutput>(items.length)
  const workerCount = Math.max(1, Math.min(concurrency, items.length))
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}
