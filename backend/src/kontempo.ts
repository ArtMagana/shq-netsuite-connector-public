import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import XLSX from 'xlsx'

import { loadOrSyncNetSuiteEntityCatalog } from './netsuiteEntityStore.js'
import { NetSuiteClient } from './netsuiteClient.js'
import {
  getKontempoStorePath,
  listKontempoStoreStatus,
  loadKontempoCustomerHomologations,
  loadKontempoInvoiceRecognitions,
  recordKontempoImportRun,
  type StoredKontempoCustomerHomologation,
  type StoredKontempoImportRun,
  type StoredKontempoInvoiceRecognition,
  upsertKontempoCustomerHomologations,
  upsertKontempoInvoiceRecognitions,
} from './kontempoStore.js'
import type { FacturaKContext, NetSuiteEntityCatalogItem } from './types.js'

type SuiteQlCollectionResponse = {
  items?: Array<Record<string, unknown>>
  hasMore?: boolean
}

type KontempoSheetKind = 'orders' | 'transfers'

type KontempoWorkbookRow = {
  rowNumber: number
  values: Record<string, unknown>
}

type NormalizedKontempoOrderRow = {
  rowNumber: number
  createdAt: string | null
  approvedAt: string | null
  orderId: string
  merchantBranch: string | null
  kontempoCustomerId: string | null
  kontempoBuyerId: string | null
  companyName: string | null
  customerName: string | null
  originalAmount: number | null
  approvedAmount: number | null
  finalAmount: number | null
  customerPaidAmount: number | null
  paymentType: string | null
  orderStatus: string | null
  totalCommissions: number | null
  transferIdFragment: string | null
  netDisbursementAmount: number | null
  transferStatus: string | null
  customerPaymentStatus: string | null
}

type NormalizedKontempoTransferRow = {
  rowNumber: number
  transferDate: string | null
  transferId: string
  transferAmount: number | null
  transferStatus: string | null
  currency: string | null
  orderId: string
  merchantBranch: string | null
  orderStatus: string | null
  orderCurrency: string | null
  orderAmount: number | null
  totalCommissions: number | null
}

type KontempoCustomerFingerprint = {
  matchKey: string
  kontempoCustomerId: string | null
  kontempoBuyerId: string | null
  companyName: string | null
  normalizedCompanyName: string | null
  compactCompanyName: string | null
  customerName: string | null
  normalizedCustomerName: string | null
  compactCustomerName: string | null
  orderIds: string[]
  orderAmounts: number[]
}

type KontempoCustomerMatch = {
  netsuiteCustomerId: string
  netsuiteCustomerName: string
  netsuiteCustomerEntityId: string | null
  confidence: string
}

type OpenInvoiceRow = {
  internalId: string
  tranId: string | null
  transactionDate: string | null
  createdFromId: string | null
  createdFromName: string | null
  customerId: string | null
  customerName: string | null
  postingPeriodId: string | null
  postingPeriodName: string | null
  currencyId: string | null
  currencyName: string | null
  total: number | null
  amountRemaining: number | null
}

type SalesOrderRow = {
  internalId: string
  tranId: string | null
  transactionDate: string | null
  customerId: string | null
  customerName: string | null
  currencyId: string | null
  currencyName: string | null
  total: number | null
}

type KontempoJournalCandidate = {
  transactionId: string
  tranId: string | null
  transactionDate: string | null
  postingPeriodId: string | null
  postingPeriodName: string | null
  memo: string | null
  maxDebit: number | null
  maxCredit: number | null
  bankDebit: number | null
}

type ResolvedOrderInvoiceMatch = {
  invoice: OpenInvoiceRow
  salesOrder: SalesOrderRow | null
}

type ResolvedInvoiceAllocation = ResolvedOrderInvoiceMatch & {
  allocatedGrossAmount: number
  allocatedCommissionAmount: number
  allocatedNetDisbursementAmount: number
}

type KontempoRecognitionStatus = StoredKontempoInvoiceRecognition['status']

type KontempoTransferGroup = {
  transferId: string
  transferDate: string | null
  transferAmount: number | null
  transferCurrency: string | null
  transferStatus: string | null
  orderIds: string[]
  orderRows: NormalizedKontempoOrderRow[]
  transferRows: NormalizedKontempoTransferRow[]
  groupedGrossAmount: number | null
  groupedCommissionAmount: number | null
  groupedNetDisbursementAmount: number | null
}

export type KontempoFacturaSummaryInput = {
  internalId: string
  tranId: string | null
  transactionDate: string | null
  customerId: string | null
  customerName: string | null
  total: number | null
  amountRemaining: number | null
  createdFromId: string | null
  createdFromName: string | null
}

const SUITEQL_BATCH_LIMIT = 1000
const SUITEQL_IN_CHUNK_SIZE = 120
const AMOUNT_TOLERANCE = 0.01
const KONTEMPO_ROUNDING_TOLERANCE_MXN = 1
const KONTEMPO_TOKEN_BLOCK_TOLERANCE_MXN = 50
const KONTEMPO_YEAR = 2026
const KONTEMPO_MEMO_TOKENS = ['kontempo', 'rapyd']

const ORDERS_REQUIRED_HEADERS = [
  'creada el',
  'id de la orden',
  'id del cliente',
  'id de cliente kontempo',
  'nombre de la empresa (cliente)',
  'nombre del cliente',
  'monto total pagado por el cliente',
  'id de la transferencia',
  'importe del desembolso a tu negocio',
]

const TRANSFERS_REQUIRED_HEADERS = [
  'fecha de transferencia',
  'id de la transferencia',
  'importe de la transferencia',
  'id de la orden',
  'importe de la orden',
  'total de comisiones',
]

export class KontempoError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'KontempoError'
    this.status = status
  }
}

export async function importKontempoSourceFiles(
  client: NetSuiteClient,
  params: {
    filePaths?: unknown
    exampleJournalDocument?: unknown
  },
) {
  const filePaths = normalizeFilePaths(params.filePaths)
  if (filePaths.length === 0) {
    throw new KontempoError('Debes enviar al menos un archivo Kontempo para analizar.', 400)
  }

  const workbookFiles = filePaths.map(readKontempoWorkbookFile)
  const ordersFile = workbookFiles.find((file) => file.kind === 'orders')
  const transfersFile = workbookFiles.find((file) => file.kind === 'transfers')

  if (!ordersFile || !transfersFile) {
    throw new KontempoError(
      'Necesito un archivo de ordenes y otro de transferencias; los reconozco por sus encabezados, no por el nombre.',
      400,
    )
  }

  const orderRows = ordersFile.rows.map(normalizeKontempoOrderRow).filter((row): row is NormalizedKontempoOrderRow => row !== null)
  const transferRows = transfersFile.rows
    .map(normalizeKontempoTransferRow)
    .filter((row): row is NormalizedKontempoTransferRow => row !== null)
  const orderRows2026 = orderRows.filter((row) => belongsToKontempoYear(row.createdAt, row.approvedAt))

  const customerFingerprints = buildCustomerFingerprints(orderRows2026)
  const customerCatalog = await loadOrSyncNetSuiteEntityCatalog('customers')
  const openInvoices = await fetchKontempoOpenInvoices(client)
  const salesOrdersById = await fetchSalesOrdersById(
    client,
    uniqueValues(openInvoices.map((item) => item.createdFromId)),
  )
  const journals = await fetchKontempoJournalCandidates(client, transferRows)
  const storedHomologations = loadKontempoCustomerHomologations()
  const transferGroups = buildTransferGroups(orderRows2026, transferRows)
  const transferGroupByOrderId = new Map<string, KontempoTransferGroup>()

  transferGroups.forEach((group) => {
    group.orderIds.forEach((orderId) => {
      if (!transferGroupByOrderId.has(orderId)) {
        transferGroupByOrderId.set(orderId, group)
      }
    })
  })

  const customerMatchByKey = new Map<string, KontempoCustomerMatch>()
  const homologationInputs: Array<Omit<StoredKontempoCustomerHomologation, 'createdAtUtc' | 'updatedAtUtc'>> = []

  customerFingerprints.forEach((fingerprint) => {
    const match = resolveKontempoCustomerMatch(fingerprint, storedHomologations, customerCatalog, openInvoices)
    if (!match) {
      return
    }

    customerMatchByKey.set(fingerprint.matchKey, match)
    homologationInputs.push({
      matchKey: fingerprint.matchKey,
      kontempoCustomerId: fingerprint.kontempoCustomerId,
      kontempoBuyerId: fingerprint.kontempoBuyerId,
      companyName: fingerprint.companyName,
      normalizedCompanyName: fingerprint.normalizedCompanyName,
      customerName: fingerprint.customerName,
      normalizedCustomerName: fingerprint.normalizedCustomerName,
      netsuiteCustomerId: match.netsuiteCustomerId,
      netsuiteCustomerName: match.netsuiteCustomerName,
      netsuiteCustomerEntityId: match.netsuiteCustomerEntityId,
      confidence: match.confidence,
      evidenceOrderIds: fingerprint.orderIds,
    })
  })

  const invoiceRecognitionInputs: Array<Omit<StoredKontempoInvoiceRecognition, 'createdAtUtc' | 'updatedAtUtc'>> = []
  const matchedInvoiceIds = new Set<string>()
  const matchedJournalsByTransferId = new Map<string, KontempoJournalCandidate | null>()

  transferGroups.forEach((group) => {
    matchedJournalsByTransferId.set(group.transferId, resolveKontempoJournalMatch(group, journals))
  })

  orderRows2026.forEach((orderRow) => {
    const fingerprint = buildCustomerFingerprintFromRow(orderRow)
    const customerMatch = customerMatchByKey.get(fingerprint.matchKey)
    if (!customerMatch) {
      return
    }

    const orderTransferGroup =
      transferGroupByOrderId.get(orderRow.orderId) ?? resolveTransferGroupByFragment(orderRow, transferGroups)
    const orderTransferRow =
      orderTransferGroup?.transferRows.find((transferRow) => transferRow.orderId === orderRow.orderId) ?? null
    const orderInvoiceAllocations = resolveOpenInvoiceAllocations(
      orderRow,
      orderTransferRow,
      customerMatch,
      openInvoices,
      salesOrdersById,
    )
    const matchedJournal = orderTransferGroup
      ? (matchedJournalsByTransferId.get(orderTransferGroup.transferId) ?? null)
      : resolveKontempoJournalMatchWithoutTransfer(orderRow, orderInvoiceAllocations, journals)

    if (orderInvoiceAllocations.length === 0) {
      return
    }

    const recognitionStatus = resolveKontempoRecognitionStatus(
      orderRow,
      orderInvoiceAllocations,
      Boolean(matchedJournal),
    )

    orderInvoiceAllocations.forEach((allocation) => {
      matchedInvoiceIds.add(allocation.invoice.internalId)

      invoiceRecognitionInputs.push({
        recognitionKey: buildRecognitionKey(orderRow.orderId, allocation.invoice.internalId, orderTransferGroup?.transferId),
        orderId: orderRow.orderId,
        transferId: orderTransferGroup?.transferId ?? null,
        transferIdFragment: orderRow.transferIdFragment,
        transferDate: orderTransferGroup?.transferDate ?? null,
        transferAmount: orderTransferGroup?.transferAmount ?? null,
        transferCurrency: orderTransferGroup?.transferCurrency ?? null,
        groupedOrderCount: orderTransferGroup?.orderIds.length ?? 1,
        groupedOrderIds: orderTransferGroup?.orderIds ?? [orderRow.orderId],
        groupedGrossAmount:
          orderTransferGroup?.groupedGrossAmount ?? resolveKontempoOrderMatchAmount(orderRow, orderTransferRow),
        groupedCommissionAmount:
          orderTransferGroup?.groupedCommissionAmount ?? resolveKontempoOrderCommissionAmount(orderRow, orderTransferRow),
        groupedNetDisbursementAmount:
          orderTransferGroup?.groupedNetDisbursementAmount ?? orderRow.netDisbursementAmount,
        kontempoCustomerId: orderRow.kontempoCustomerId,
        kontempoBuyerId: orderRow.kontempoBuyerId,
        companyName: orderRow.companyName,
        customerName: orderRow.customerName,
        netsuiteCustomerId: customerMatch.netsuiteCustomerId,
        netsuiteCustomerName: customerMatch.netsuiteCustomerName,
        invoiceInternalId: allocation.invoice.internalId,
        invoiceDocument: allocation.invoice.tranId,
        invoiceDate: allocation.invoice.transactionDate,
        invoiceAmount: allocation.invoice.total ?? allocation.invoice.amountRemaining,
        salesOrderInternalId: allocation.invoice.createdFromId,
        salesOrderDocument: allocation.invoice.createdFromName ?? allocation.salesOrder?.tranId ?? null,
        salesOrderDate: allocation.salesOrder?.transactionDate ?? null,
        salesOrderAmount: allocation.salesOrder?.total ?? null,
        orderGrossAmount: allocation.allocatedGrossAmount,
        orderCommissionAmount: allocation.allocatedCommissionAmount,
        orderNetDisbursementAmount: allocation.allocatedNetDisbursementAmount,
        journalTransactionId: matchedJournal?.transactionId ?? null,
        journalDocument: matchedJournal?.tranId ?? null,
        journalDate: matchedJournal?.transactionDate ?? null,
        journalPeriodId: matchedJournal?.postingPeriodId ?? null,
        journalPeriodName: matchedJournal?.postingPeriodName ?? null,
        journalAmount:
          matchedJournal?.bankDebit ?? matchedJournal?.maxDebit ?? matchedJournal?.maxCredit ?? null,
        journalMemo: matchedJournal?.memo ?? null,
        status: recognitionStatus,
        sourceOrdersDigest: ordersFile.digest,
        sourceTransfersDigest: transfersFile.digest,
      })
    })
  })

  const homologationResult = upsertKontempoCustomerHomologations(homologationInputs)
  const recognitionResult = upsertKontempoInvoiceRecognitions(invoiceRecognitionInputs)
  const nowUtc = new Date().toISOString()
  const run: StoredKontempoImportRun = {
    id: `${ordersFile.digest.slice(0, 12)}-${transfersFile.digest.slice(0, 12)}`,
    sourceOrdersPath: ordersFile.filePath,
    sourceTransfersPath: transfersFile.filePath,
    sourceOrdersDigest: ordersFile.digest,
    sourceTransfersDigest: transfersFile.digest,
    generatedAtUtc: nowUtc,
    counts: {
      orderRows: orderRows.length,
      orderRows2026: orderRows2026.length,
      transferRows: transferRows.length,
      transferGroups: transferGroups.length,
      customerMatched: homologationInputs.length,
      invoiceMatched: matchedInvoiceIds.size,
      journalMatched: recognitionResult.items.filter((item) => item.status === 'matched').length,
      recognizedInvoices: recognitionResult.items.length,
    },
  }
  recordKontempoImportRun(run)

  const exampleJournalDocument = normalizeOptionalString(params.exampleJournalDocument) ?? '29245'
  const exampleRecognitions = recognitionResult.items.filter((item) => item.journalDocument === exampleJournalDocument)
  const exampleTransferId = exampleRecognitions[0]?.transferId ?? null
  const exampleTransferGroup =
    exampleTransferId ? transferGroups.find((group) => group.transferId === exampleTransferId) ?? null : null

  return {
    generatedAtUtc: nowUtc,
    files: {
      orders: {
        path: ordersFile.filePath,
        digest: ordersFile.digest,
        detectedKind: ordersFile.kind,
        rowCount: orderRows.length,
        rowCount2026: orderRows2026.length,
      },
      transfers: {
        path: transfersFile.filePath,
        digest: transfersFile.digest,
        detectedKind: transfersFile.kind,
        rowCount: transferRows.length,
        transferGroupCount: transferGroups.length,
      },
    },
    counts: run.counts,
    persistence: {
      storePath: getKontempoStorePath(),
      homologations: {
        inserted: homologationResult.inserted,
        updated: homologationResult.updated,
      },
      recognitions: {
        inserted: recognitionResult.inserted,
        updated: recognitionResult.updated,
      },
    },
    example: exampleTransferGroup
      ? {
          journalDocument: exampleJournalDocument,
          transferId: exampleTransferGroup.transferId,
          transferDate: exampleTransferGroup.transferDate,
          transferAmount: exampleTransferGroup.transferAmount,
          groupedGrossAmount: exampleTransferGroup.groupedGrossAmount,
          groupedCommissionAmount: exampleTransferGroup.groupedCommissionAmount,
          groupedNetDisbursementAmount: exampleTransferGroup.groupedNetDisbursementAmount,
          orderRows: exampleTransferGroup.orderRows.map((item) => ({
            rowNumber: item.rowNumber,
            orderId: item.orderId,
            companyName: item.companyName,
            customerName: item.customerName,
            customerPaidAmount: item.customerPaidAmount,
            commissionAmount: item.totalCommissions,
            netDisbursementAmount: item.netDisbursementAmount,
            transferIdFragment: item.transferIdFragment,
          })),
          transferRows: exampleTransferGroup.transferRows.map((item) => ({
            rowNumber: item.rowNumber,
            transferId: item.transferId,
            orderId: item.orderId,
            transferAmount: item.transferAmount,
            orderAmount: item.orderAmount,
            commissionAmount: item.totalCommissions,
          })),
          invoiceMatches: exampleRecognitions.map((item) => ({
            invoiceInternalId: item.invoiceInternalId,
            invoiceDocument: item.invoiceDocument,
            salesOrderInternalId: item.salesOrderInternalId,
            salesOrderDocument: item.salesOrderDocument,
            invoiceAmount: item.invoiceAmount,
            orderId: item.orderId,
            journalTransactionId: item.journalTransactionId,
            journalDocument: item.journalDocument,
            journalAmount: item.journalAmount,
            status: item.status,
          })),
        }
      : null,
    store: listKontempoStoreStatus(),
  }
}

export function getKontempoStatus() {
  return listKontempoStoreStatus()
}

export function buildKontempoContextByInvoiceId(
  summaryRows: KontempoFacturaSummaryInput[],
): Map<string, FacturaKContext> {
  const result = new Map<string, FacturaKContext>()
  const summaryByInvoiceId = new Map(summaryRows.map((summary) => [summary.internalId, summary]))
  const recognitions = loadKontempoInvoiceRecognitions()
  if (recognitions.length === 0) {
    return result
  }

  recognitions.forEach((recognition) => {
    const summary = summaryByInvoiceId.get(recognition.invoiceInternalId)
    if (!summary) {
      return
    }

    const groupedRecognitions =
      recognition.transferId
        ? recognitions.filter((item) => item.transferId === recognition.transferId)
        : [recognition]

    const journalComponents = groupedRecognitions
      .map((item) => {
        const grossAmount = item.orderGrossAmount ?? item.invoiceAmount
        const commissionAmount =
          item.orderCommissionAmount ??
          (grossAmount !== null && item.orderNetDisbursementAmount !== null
            ? roundCurrency(grossAmount - item.orderNetDisbursementAmount)
            : null)
        const netAmount =
          item.orderNetDisbursementAmount ??
          (grossAmount !== null && commissionAmount !== null ? roundCurrency(grossAmount - commissionAmount) : null)

        if (
          grossAmount === null ||
          commissionAmount === null ||
          netAmount === null ||
          grossAmount <= 0
        ) {
          return null
        }

        return {
          invoiceInternalId: item.invoiceInternalId,
          invoiceDocument: item.invoiceDocument,
          customerId: item.netsuiteCustomerId,
          customerName: item.netsuiteCustomerName,
          salesOrderInternalId: item.salesOrderInternalId,
          salesOrderDocument: item.salesOrderDocument,
          grossAmount: roundCurrency(grossAmount),
          commissionAmount: roundCurrency(commissionAmount),
          netAmount: roundCurrency(netAmount),
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)

    const requiresManualIntervention =
      recognition.status === 'manual_review' ||
      !recognitionHasDeterministicSalesOrderTraceability(recognition)
    const manualReason = requiresManualIntervention
      ? 'Caso Kontempo sin trazabilidad deterministica entre Transferencia, Orden Kontempo, OV NetSuite y factura(s); requiere intervencion manual y, si aplica, desaplicacion manual de nota de credito sin eliminarla.'
      : null

    result.set(recognition.invoiceInternalId, {
      status: recognition.status,
      requiresManualIntervention,
      manualReason,
      recognitionKey: recognition.recognitionKey,
      orderId: recognition.orderId,
      transferId: recognition.transferId,
      transferIdFragment: recognition.transferIdFragment,
      transferDate: parseIsoDate(recognition.transferDate),
      transferAmount: recognition.transferAmount,
      transferCurrency: recognition.transferCurrency,
      groupedOrderCount: recognition.groupedOrderCount,
      groupedOrderIds: [...recognition.groupedOrderIds],
      groupedGrossAmount: recognition.groupedGrossAmount,
      groupedCommissionAmount: recognition.groupedCommissionAmount,
      groupedNetDisbursementAmount: recognition.groupedNetDisbursementAmount,
      kontempoCustomerId: recognition.kontempoCustomerId,
      kontempoBuyerId: recognition.kontempoBuyerId,
      companyName: recognition.companyName,
      customerName: recognition.customerName,
      netsuiteCustomerId: recognition.netsuiteCustomerId,
      netsuiteCustomerName: recognition.netsuiteCustomerName,
      invoiceInternalId: recognition.invoiceInternalId,
      invoiceDocument: summary.tranId ?? recognition.invoiceDocument,
      invoiceDate: parseIsoDate(recognition.invoiceDate ?? summary.transactionDate),
      invoiceAmount: recognition.invoiceAmount ?? summary.total ?? summary.amountRemaining,
      salesOrderInternalId: recognition.salesOrderInternalId ?? summary.createdFromId,
      salesOrderDocument: recognition.salesOrderDocument ?? summary.createdFromName,
      salesOrderDate: parseIsoDate(recognition.salesOrderDate),
      salesOrderAmount: recognition.salesOrderAmount,
      orderGrossAmount: recognition.orderGrossAmount,
      orderCommissionAmount: recognition.orderCommissionAmount,
      orderNetDisbursementAmount: recognition.orderNetDisbursementAmount,
      journalTransactionId: recognition.journalTransactionId,
      journalDocument: recognition.journalDocument,
      journalDate: parseIsoDate(recognition.journalDate),
      journalPeriodId: recognition.journalPeriodId,
      journalPeriodName: recognition.journalPeriodName,
      journalAmount: recognition.journalAmount,
      journalMemo: recognition.journalMemo,
      matchedInvoiceInternalIds: uniqueValues(groupedRecognitions.map((item) => item.invoiceInternalId)),
      matchedInvoiceDocuments: journalComponents.map((item) => item.invoiceDocument),
      journalComponents,
    })
  })

  return result
}

function resolveKontempoRecognitionStatus(
  orderRow: NormalizedKontempoOrderRow,
  allocations: ResolvedInvoiceAllocation[],
  hasMatchedJournal: boolean,
): KontempoRecognitionStatus {
  const hasDeterministicSalesOrderTraceability =
    allocations.length > 0 &&
    allocations.every((allocation) =>
      allocationHasDeterministicSalesOrderTraceability(orderRow.orderId, allocation),
    )

  if (!hasDeterministicSalesOrderTraceability) {
    return 'manual_review'
  }

  return hasMatchedJournal ? 'matched' : 'pending_journal'
}

function allocationHasDeterministicSalesOrderTraceability(
  orderId: string,
  allocation: ResolvedInvoiceAllocation,
) {
  const orderTokens = extractKontempoOrderTokens(orderId)
  const candidateTexts = [allocation.invoice.createdFromName, allocation.salesOrder?.tranId]
    .map((value) => normalizeComparableText(value)?.toUpperCase() ?? '')
    .filter((value) => value.length > 0)

  if (orderTokens.length > 0 && orderTokens.some((token) => candidateTexts.some((text) => text.includes(token)))) {
    return true
  }

  const expectedGrossAmount = allocation.allocatedGrossAmount
  return (
    amountsMatchWithinTolerance(allocation.salesOrder?.total, expectedGrossAmount, KONTEMPO_ROUNDING_TOLERANCE_MXN) ||
    amountsMatchWithinTolerance(allocation.invoice.total, expectedGrossAmount, KONTEMPO_ROUNDING_TOLERANCE_MXN) ||
    amountsMatchWithinTolerance(
      allocation.invoice.amountRemaining,
      expectedGrossAmount,
      KONTEMPO_ROUNDING_TOLERANCE_MXN,
    )
  )
}

function recognitionHasDeterministicSalesOrderTraceability(
  recognition: StoredKontempoInvoiceRecognition,
) {
  const orderTokens = extractKontempoOrderTokens(recognition.orderId)
  const candidateTexts = [recognition.salesOrderDocument]
    .map((value) => normalizeComparableText(value)?.toUpperCase() ?? '')
    .filter((value) => value.length > 0)

  if (orderTokens.length > 0 && orderTokens.some((token) => candidateTexts.some((text) => text.includes(token)))) {
    return true
  }

  return (
    amountsMatchWithinTolerance(
      recognition.salesOrderAmount,
      recognition.orderGrossAmount,
      KONTEMPO_ROUNDING_TOLERANCE_MXN,
    ) ||
    amountsMatchWithinTolerance(
      recognition.invoiceAmount,
      recognition.orderGrossAmount,
      KONTEMPO_ROUNDING_TOLERANCE_MXN,
    )
  )
}

function normalizeFilePaths(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[]
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0)
}

function readKontempoWorkbookFile(filePath: string): {
  filePath: string
  digest: string
  kind: KontempoSheetKind
  rows: KontempoWorkbookRow[]
} {
  const resolvedPath = path.resolve(filePath)
  if (!fs.existsSync(resolvedPath)) {
    throw new KontempoError(`No encontré el archivo ${resolvedPath}.`, 404)
  }

  const workbook = XLSX.readFile(resolvedPath, { raw: false, cellDates: false })
  const sheetName = workbook.SheetNames[0]
  const sheet = sheetName ? workbook.Sheets[sheetName] : null
  if (!sheet) {
    throw new KontempoError(`El archivo ${resolvedPath} no trae hojas legibles.`, 400)
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: false })
  const headerRows = XLSX.utils.sheet_to_json<Array<unknown>>(sheet, { header: 1, blankrows: false, raw: false })
  const headerRow = Array.isArray(headerRows[0]) ? headerRows[0].map((cell) => String(cell ?? '')) : []
  const kind = detectKontempoSheetKind(headerRow)
  if (!kind) {
    throw new KontempoError(
      `No pude reconocer el tipo del archivo ${resolvedPath}; necesito encabezados de ordenes o transferencias de Kontempo.`,
      400,
    )
  }

  const digest = crypto.createHash('sha256').update(fs.readFileSync(resolvedPath)).digest('hex')
  const rows = rawRows.map((values, index) => ({
    rowNumber: index + 2,
    values,
  }))

  return {
    filePath: resolvedPath,
    digest,
    kind,
    rows,
  }
}

function detectKontempoSheetKind(headers: string[]) {
  const normalizedHeaders = headers.map((header) => normalizeHeader(header))
  const matchesOrders = ORDERS_REQUIRED_HEADERS.every((header) => normalizedHeaders.includes(normalizeHeader(header)))
  const matchesTransfers = TRANSFERS_REQUIRED_HEADERS.every((header) =>
    normalizedHeaders.includes(normalizeHeader(header)),
  )

  if (matchesOrders && !matchesTransfers) {
    return 'orders' as const
  }

  if (matchesTransfers && !matchesOrders) {
    return 'transfers' as const
  }

  if (matchesOrders) {
    return 'orders' as const
  }

  if (matchesTransfers) {
    return 'transfers' as const
  }

  return null
}

function normalizeKontempoOrderRow(row: KontempoWorkbookRow): NormalizedKontempoOrderRow | null {
  const values = row.values
  const orderId = cleanIdentifier(readCell(values, 'ID de la Orden'))
  if (!orderId) {
    return null
  }

  return {
    rowNumber: row.rowNumber,
    createdAt: normalizeDateValue(readCell(values, 'Creada el')),
    approvedAt: normalizeDateValue(readCell(values, 'Aprobada el')),
    orderId,
    merchantBranch: normalizeOptionalString(readCell(values, 'Merchant Branch')),
    kontempoCustomerId: normalizeOptionalString(readCell(values, 'ID del Cliente')),
    kontempoBuyerId: normalizeOptionalString(readCell(values, 'ID de Cliente Kontempo')),
    companyName: normalizeOptionalString(readCell(values, 'Nombre de la Empresa (Cliente)')),
    customerName: normalizeOptionalString(readCell(values, 'Nombre del Cliente')),
    originalAmount: normalizeCurrencyValue(readCell(values, 'Importe Original')),
    approvedAmount: normalizeCurrencyValue(readCell(values, 'Importe Aprobado')),
    finalAmount: normalizeCurrencyValue(readCell(values, 'Importe Final')),
    customerPaidAmount: normalizeCurrencyValue(readCell(values, 'Monto total pagado por el cliente')),
    paymentType: normalizeOptionalString(readCell(values, 'Tipo de pago')),
    orderStatus: normalizeOptionalString(readCell(values, 'Estado actual de la orden')),
    totalCommissions: normalizeCurrencyValue(readCell(values, 'Total de comisiones (IVA incluido)')),
    transferIdFragment: normalizeOptionalString(readCell(values, 'ID de la transferencia')),
    netDisbursementAmount: normalizeCurrencyValue(readCell(values, 'Importe del desembolso a tu negocio')),
    transferStatus: normalizeOptionalString(readCell(values, 'Estado actual del desembolso')),
    customerPaymentStatus: normalizeOptionalString(readCell(values, 'Estado del pago del cliente')),
  }
}

function normalizeKontempoTransferRow(row: KontempoWorkbookRow): NormalizedKontempoTransferRow | null {
  const values = row.values
  const transferId = cleanIdentifier(readCell(values, 'ID de la Transferencia'))
  const orderId = cleanIdentifier(readCell(values, 'ID de la orden'))
  if (!transferId || !orderId) {
    return null
  }

  return {
    rowNumber: row.rowNumber,
    transferDate: normalizeDateValue(readCell(values, 'Fecha de Transferencia')),
    transferId,
    transferAmount: normalizeCurrencyValue(readCell(values, 'Importe de la transferencia')),
    transferStatus: normalizeOptionalString(readCell(values, 'Estatus de la transferencia')),
    currency: normalizeOptionalString(readCell(values, 'Currency')),
    orderId,
    merchantBranch: normalizeOptionalString(readCell(values, 'Merchant Branch')),
    orderStatus: normalizeOptionalString(readCell(values, 'Estado de la orden')),
    orderCurrency: normalizeOptionalString(readCell(values, 'Moneda de pedido')),
    orderAmount: normalizeCurrencyValue(readCell(values, 'Importe de la orden')),
    totalCommissions: normalizeCurrencyValue(readCell(values, 'Total de Comisiones')),
  }
}

function buildCustomerFingerprints(rows: NormalizedKontempoOrderRow[]) {
  const byKey = new Map<string, KontempoCustomerFingerprint>()

  rows.forEach((row) => {
    const fingerprint = buildCustomerFingerprintFromRow(row)
    const existing = byKey.get(fingerprint.matchKey)
    if (existing) {
      existing.orderIds = [...new Set([...existing.orderIds, row.orderId])]
      if (row.customerPaidAmount !== null) {
        existing.orderAmounts = [...existing.orderAmounts, row.customerPaidAmount]
      }
      return
    }

    byKey.set(fingerprint.matchKey, {
      ...fingerprint,
      orderIds: [row.orderId],
      orderAmounts: row.customerPaidAmount === null ? [] : [row.customerPaidAmount],
    })
  })

  return [...byKey.values()]
}

function buildCustomerFingerprintFromRow(row: NormalizedKontempoOrderRow): KontempoCustomerFingerprint {
  const normalizedCompanyName = normalizeComparableText(row.companyName)
  const normalizedCustomerName = normalizeComparableText(row.customerName)
  return {
    matchKey: [
      row.kontempoCustomerId ?? '',
      row.kontempoBuyerId ?? '',
      normalizedCompanyName ?? '',
      normalizedCustomerName ?? '',
    ].join('|'),
    kontempoCustomerId: row.kontempoCustomerId,
    kontempoBuyerId: row.kontempoBuyerId,
    companyName: row.companyName,
    normalizedCompanyName,
    compactCompanyName: compactComparableText(row.companyName),
    customerName: row.customerName,
    normalizedCustomerName,
    compactCustomerName: compactComparableText(row.customerName),
    orderIds: [],
    orderAmounts: [],
  }
}

function resolveKontempoCustomerMatch(
  fingerprint: KontempoCustomerFingerprint,
  storedHomologations: StoredKontempoCustomerHomologation[],
  customerCatalog: NetSuiteEntityCatalogItem[],
  openInvoices: OpenInvoiceRow[],
): KontempoCustomerMatch | null {
  const storedMatch = findStoredCustomerMatch(fingerprint, storedHomologations)
  if (storedMatch) {
    return {
      netsuiteCustomerId: storedMatch.netsuiteCustomerId,
      netsuiteCustomerName: storedMatch.netsuiteCustomerName,
      netsuiteCustomerEntityId: storedMatch.netsuiteCustomerEntityId,
      confidence: storedMatch.confidence,
    }
  }

  const openInvoicesByCustomerId = new Map<string, OpenInvoiceRow[]>()
  openInvoices.forEach((invoice) => {
    if (!invoice.customerId) {
      return
    }

    const bucket = openInvoicesByCustomerId.get(invoice.customerId) ?? []
    bucket.push(invoice)
    openInvoicesByCustomerId.set(invoice.customerId, bucket)
  })

  const scoredCandidates = customerCatalog
    .map((candidate) => ({
      candidate,
      score: scoreCustomerCandidate(fingerprint, candidate, openInvoicesByCustomerId.get(candidate.internalId) ?? []),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.candidate.displayName.localeCompare(right.candidate.displayName, 'es'))

  const [top, second] = scoredCandidates
  if (!top) {
    return null
  }

  if (top.score < 100) {
    return null
  }

  if (second && top.score === second.score) {
    return null
  }

  return {
    netsuiteCustomerId: top.candidate.internalId,
    netsuiteCustomerName: top.candidate.displayName,
    netsuiteCustomerEntityId: top.candidate.entityId || null,
    confidence: `catalog_score_${top.score}`,
  }
}

function findStoredCustomerMatch(
  fingerprint: KontempoCustomerFingerprint,
  storedHomologations: StoredKontempoCustomerHomologation[],
) {
  return (
    storedHomologations.find(
      (item) =>
        fingerprint.kontempoCustomerId &&
        item.kontempoCustomerId &&
        fingerprint.kontempoCustomerId === item.kontempoCustomerId,
    ) ??
    storedHomologations.find(
      (item) =>
        fingerprint.kontempoBuyerId && item.kontempoBuyerId && fingerprint.kontempoBuyerId === item.kontempoBuyerId,
    ) ??
    storedHomologations.find(
      (item) =>
        fingerprint.normalizedCompanyName &&
        item.normalizedCompanyName &&
        fingerprint.normalizedCompanyName === item.normalizedCompanyName,
    ) ??
    storedHomologations.find(
      (item) =>
        fingerprint.normalizedCustomerName &&
        item.normalizedCustomerName &&
        fingerprint.normalizedCustomerName === item.normalizedCustomerName,
    ) ??
    null
  )
}

function scoreCustomerCandidate(
  fingerprint: KontempoCustomerFingerprint,
  candidate: NetSuiteEntityCatalogItem,
  candidateOpenInvoices: OpenInvoiceRow[],
) {
  const candidateFields = [
    candidate.displayName,
    candidate.companyName,
    candidate.altName,
    candidate.entityId,
  ]
  const normalizedCandidateFields = candidateFields.map((field) => normalizeComparableText(field)).filter(Boolean)
  const compactCandidateFields = candidateFields.map((field) => compactComparableText(field)).filter(Boolean)
  let score = 0

  if (fingerprint.normalizedCompanyName && normalizedCandidateFields.includes(fingerprint.normalizedCompanyName)) {
    score = Math.max(score, 120)
  }

  if (fingerprint.compactCompanyName && compactCandidateFields.includes(fingerprint.compactCompanyName)) {
    score = Math.max(score, 118)
  }

  if (fingerprint.normalizedCustomerName && normalizedCandidateFields.includes(fingerprint.normalizedCustomerName)) {
    score = Math.max(score, 112)
  }

  if (
    fingerprint.normalizedCompanyName &&
    normalizedCandidateFields.some(
      (field) => field && (field.includes(fingerprint.normalizedCompanyName!) || fingerprint.normalizedCompanyName!.includes(field)),
    )
  ) {
    score = Math.max(score, 90)
  }

  if (
    fingerprint.normalizedCustomerName &&
    normalizedCandidateFields.some(
      (field) => field && (field.includes(fingerprint.normalizedCustomerName!) || fingerprint.normalizedCustomerName!.includes(field)),
    )
  ) {
    score = Math.max(score, 84)
  }

  if (
    fingerprint.orderAmounts.some((amount) =>
      candidateOpenInvoices.some((invoice) =>
        amountsMatch(invoice.total ?? invoice.amountRemaining, amount),
      ),
    )
  ) {
    score += 15
  }

  return score
}

function resolveOpenInvoiceAllocations(
  orderRow: NormalizedKontempoOrderRow,
  transferRow: NormalizedKontempoTransferRow | null,
  customerMatch: KontempoCustomerMatch,
  openInvoices: OpenInvoiceRow[],
  salesOrdersById: Map<string, SalesOrderRow>,
) {
  const targetAmount = resolveKontempoOrderMatchAmount(orderRow, transferRow)
  if (targetAmount === null || targetAmount <= 0) {
    return [] as ResolvedInvoiceAllocation[]
  }

  const customerInvoices = openInvoices
    .filter((invoice) => invoice.customerId === customerMatch.netsuiteCustomerId)
    .filter((invoice) => belongsToKontempoYear(invoice.transactionDate, null))
    .map((invoice) => ({
      invoice,
      salesOrder: invoice.createdFromId ? (salesOrdersById.get(invoice.createdFromId) ?? null) : null,
    }))

  const candidateInvoices = customerInvoices
    .map((candidate) => ({
      ...candidate,
      score: scoreOpenInvoiceMatch(orderRow, transferRow, candidate.invoice, candidate.salesOrder),
    }))
    .filter((item) => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || (left.invoice.tranId ?? '').localeCompare(right.invoice.tranId ?? '', 'es'),
    )

  const [top, second] = candidateInvoices
  if (top && top.score >= 100 && (!second || second.score < top.score)) {
    const singleAllocation = allocateKontempoAmountAcrossInvoices(orderRow, [
      { invoice: top.invoice, salesOrder: top.salesOrder },
    ], transferRow)
    if (singleAllocation.length === 1) {
      return singleAllocation
    }
  }

  const orderTokens = extractKontempoOrderTokens(orderRow.orderId)
  if (orderTokens.length === 0) {
    return [] as ResolvedInvoiceAllocation[]
  }

  const tokenCandidates = customerInvoices.filter((candidate) =>
    kontempoOrderMatchesInvoiceTokens(orderTokens, candidate.invoice, candidate.salesOrder),
  )
  if (tokenCandidates.length === 0) {
    return [] as ResolvedInvoiceAllocation[]
  }

  const directAllocation = allocateKontempoAmountAcrossInvoices(orderRow, tokenCandidates, transferRow)
  if (directAllocation.length > 0) {
    return directAllocation
  }

  const subset = findInvoiceSubsetMatchingAmount(
    tokenCandidates,
    targetAmount,
    resolveKontempoAllocationTolerance(orderRow, tokenCandidates),
  )
  if (!subset) {
    return [] as ResolvedInvoiceAllocation[]
  }

  return allocateKontempoAmountAcrossInvoices(orderRow, subset, transferRow)
}

function scoreOpenInvoiceMatch(
  orderRow: NormalizedKontempoOrderRow,
  transferRow: NormalizedKontempoTransferRow | null,
  invoice: OpenInvoiceRow,
  salesOrder: SalesOrderRow | null,
) {
  const targetAmount = resolveKontempoOrderMatchAmount(orderRow, transferRow)
  if (targetAmount === null) {
    return 0
  }

  let score = 0

  if (amountsMatch(invoice.total, targetAmount)) {
    score = Math.max(score, 130)
  }

  if (amountsMatch(invoice.amountRemaining, targetAmount)) {
    score = Math.max(score, 125)
  }

  if (amountsMatch(salesOrder?.total, targetAmount)) {
    score = Math.max(score, 118)
  }

  const orderTokens = extractKontempoOrderTokens(orderRow.orderId)
  if (orderTokens.length > 0 && kontempoOrderMatchesInvoiceTokens(orderTokens, invoice, salesOrder)) {
    score += orderTokens.length > 1 ? 40 : 24
  }

  const orderDate = parseIsoDate(orderRow.approvedAt ?? orderRow.createdAt)
  const invoiceDate = parseIsoDate(invoice.transactionDate)
  const salesOrderDate = parseIsoDate(salesOrder?.transactionDate ?? null)

  if (orderDate && invoiceDate) {
    const diffDays = Math.abs(getDateOnlyValue(orderDate) - getDateOnlyValue(invoiceDate)) / 86_400_000
    if (diffDays <= 14) {
      score += Math.max(0, 14 - diffDays)
    }
  }

  if (orderDate && salesOrderDate) {
    const diffDays = Math.abs(getDateOnlyValue(orderDate) - getDateOnlyValue(salesOrderDate)) / 86_400_000
    if (diffDays <= 14) {
      score += Math.max(0, 10 - diffDays)
    }
  }

  return score
}

function resolveKontempoOrderMatchAmount(
  orderRow: NormalizedKontempoOrderRow,
  transferRow: NormalizedKontempoTransferRow | null,
) {
  return transferRow?.orderAmount ?? orderRow.approvedAmount ?? orderRow.originalAmount ?? orderRow.finalAmount ?? orderRow.customerPaidAmount
}

function extractKontempoOrderTokens(value: string | null) {
  const normalized = normalizeComparableText(value)?.toUpperCase() ?? ''
  if (!normalized) {
    return [] as string[]
  }

  const rawTokens = normalized.match(/[A-Z]*\d+/g) ?? []
  const expanded = rawTokens.flatMap((token) => {
    const withoutOvPrefix = token.replace(/^OV/u, '')
    const compactToken = withoutOvPrefix.replace(/^0+/u, '') || withoutOvPrefix || token
    const digits = compactToken.replace(/\D/g, '')
    return digits.length > 0 && digits !== compactToken ? [compactToken, digits] : [compactToken]
  })

  return uniqueValues(expanded.filter((token) => token.length >= 3))
}

function kontempoOrderMatchesInvoiceTokens(
  orderTokens: string[],
  invoice: OpenInvoiceRow,
  salesOrder: SalesOrderRow | null,
) {
  if (orderTokens.length === 0) {
    return false
  }

  const candidateTexts = [invoice.createdFromName, invoice.tranId, salesOrder?.tranId]
    .map((value) => normalizeComparableText(value)?.toUpperCase() ?? '')
    .filter((value) => value.length > 0)

  return orderTokens.some((token) => candidateTexts.some((text) => text.includes(token)))
}

function resolveKontempoAllocationTolerance(
  orderRow: NormalizedKontempoOrderRow,
  matches: Array<ResolvedOrderInvoiceMatch>,
) {
  const orderTokens = extractKontempoOrderTokens(orderRow.orderId)
  if (
    orderTokens.length > 1 &&
    matches.length > 0 &&
    matches.every((match) => kontempoOrderMatchesInvoiceTokens(orderTokens, match.invoice, match.salesOrder))
  ) {
    return KONTEMPO_TOKEN_BLOCK_TOLERANCE_MXN
  }

  return KONTEMPO_ROUNDING_TOLERANCE_MXN
}

function allocateKontempoAmountAcrossInvoices(
  orderRow: NormalizedKontempoOrderRow,
  matches: Array<ResolvedOrderInvoiceMatch>,
  transferRow: NormalizedKontempoTransferRow | null,
) {
  if (matches.length === 0) {
    return [] as ResolvedInvoiceAllocation[]
  }

  const targetGrossAmount = resolveKontempoOrderMatchAmount(orderRow, transferRow)
  const totalCommissionAmount = resolveKontempoOrderCommissionAmount(orderRow, transferRow)
  if (targetGrossAmount === null || totalCommissionAmount === null) {
    return [] as ResolvedInvoiceAllocation[]
  }

  const normalizedMatches = matches
    .map((match) => ({
      ...match,
      baseGrossAmount: resolveKontempoInvoiceGrossAmount(match.invoice),
    }))
    .filter((match) => match.baseGrossAmount !== null) as Array<
    ResolvedOrderInvoiceMatch & {
      baseGrossAmount: number
    }
  >

  if (normalizedMatches.length !== matches.length) {
    return [] as ResolvedInvoiceAllocation[]
  }

  const allocationTolerance = resolveKontempoAllocationTolerance(orderRow, normalizedMatches)
  const totalGross = roundCurrency(
    normalizedMatches.reduce((sum, match) => sum + match.baseGrossAmount, 0),
  )
  if (!amountsMatchWithinTolerance(totalGross, targetGrossAmount, allocationTolerance)) {
    return [] as ResolvedInvoiceAllocation[]
  }

  if (normalizedMatches.length === 1) {
    return [
      {
        invoice: normalizedMatches[0].invoice,
        salesOrder: normalizedMatches[0].salesOrder,
        allocatedGrossAmount: roundCurrency(normalizedMatches[0].baseGrossAmount),
        allocatedCommissionAmount: roundCurrency(totalCommissionAmount),
        allocatedNetDisbursementAmount: roundCurrency(normalizedMatches[0].baseGrossAmount - totalCommissionAmount),
      },
    ]
  }

  let remainingCommission = roundCurrency(totalCommissionAmount)
  return normalizedMatches.map((match, index) => {
    const isLast = index === normalizedMatches.length - 1
    const allocatedCommissionAmount = isLast
      ? remainingCommission
      : roundCurrency((match.baseGrossAmount / totalGross) * totalCommissionAmount)
    remainingCommission = roundCurrency(remainingCommission - allocatedCommissionAmount)

    return {
      invoice: match.invoice,
      salesOrder: match.salesOrder,
      allocatedGrossAmount: roundCurrency(match.baseGrossAmount),
      allocatedCommissionAmount,
      allocatedNetDisbursementAmount: roundCurrency(match.baseGrossAmount - allocatedCommissionAmount),
    }
  })
}

function resolveKontempoOrderCommissionAmount(
  orderRow: NormalizedKontempoOrderRow,
  transferRow: NormalizedKontempoTransferRow | null,
) {
  const transferCommissionAmount = transferRow?.totalCommissions ?? null
  if (transferCommissionAmount !== null) {
    return roundCurrency(transferCommissionAmount)
  }

  if (orderRow.totalCommissions !== null) {
    return roundCurrency(orderRow.totalCommissions)
  }

  const grossAmount = resolveKontempoOrderMatchAmount(orderRow, transferRow)
  const netDisbursementAmount = orderRow.netDisbursementAmount
  if (grossAmount === null || netDisbursementAmount === null) {
    return null
  }

  return roundCurrency(grossAmount - netDisbursementAmount)
}

function resolveKontempoInvoiceGrossAmount(invoice: OpenInvoiceRow) {
  if (invoice.amountRemaining !== null && invoice.amountRemaining > 0) {
    return roundCurrency(invoice.amountRemaining)
  }

  if (invoice.total !== null && invoice.total > 0) {
    return roundCurrency(invoice.total)
  }

  return null
}

function findInvoiceSubsetMatchingAmount(
  matches: Array<ResolvedOrderInvoiceMatch>,
  targetAmount: number,
  tolerance: number,
) {
  if (matches.length <= 1 || matches.length > 6) {
    return null
  }

  const grossMatches = matches
    .map((match) => ({
      match,
      grossAmount: resolveKontempoInvoiceGrossAmount(match.invoice),
    }))
    .filter((item) => item.grossAmount !== null) as Array<{
    match: ResolvedOrderInvoiceMatch
    grossAmount: number
  }>

  if (grossMatches.length !== matches.length) {
    return null
  }

  let best: Array<ResolvedOrderInvoiceMatch> | null = null

  const visit = (index: number, selected: Array<ResolvedOrderInvoiceMatch>, accumulated: number) => {
    if (amountsMatchWithinTolerance(accumulated, targetAmount, tolerance)) {
      best = [...selected]
      return
    }

    if (best || accumulated > targetAmount + tolerance || index >= grossMatches.length) {
      return
    }

    visit(index + 1, [...selected, grossMatches[index].match], accumulated + grossMatches[index].grossAmount)
    if (!best) {
      visit(index + 1, selected, accumulated)
    }
  }

  visit(0, [], 0)
  return best
}

function buildTransferGroups(
  orderRows: NormalizedKontempoOrderRow[],
  transferRows: NormalizedKontempoTransferRow[],
) {
  const orderRowsByOrderId = new Map(orderRows.map((row) => [row.orderId, row]))
  const grouped = new Map<string, KontempoTransferGroup>()

  transferRows.forEach((transferRow) => {
    const existing = grouped.get(transferRow.transferId)
    if (existing) {
      existing.transferRows.push(transferRow)
      if (!existing.orderIds.includes(transferRow.orderId)) {
        existing.orderIds.push(transferRow.orderId)
      }
      const orderRow = orderRowsByOrderId.get(transferRow.orderId)
      if (orderRow && !existing.orderRows.some((item) => item.orderId === orderRow.orderId)) {
        existing.orderRows.push(orderRow)
      }
      existing.groupedGrossAmount = roundCurrency(
        (existing.groupedGrossAmount ?? 0) + (transferRow.orderAmount ?? 0),
      )
      existing.groupedCommissionAmount = roundCurrency(
        (existing.groupedCommissionAmount ?? 0) + (transferRow.totalCommissions ?? 0),
      )
      existing.groupedNetDisbursementAmount = transferRow.transferAmount
      return
    }

    const orderRow = orderRowsByOrderId.get(transferRow.orderId)
    grouped.set(transferRow.transferId, {
      transferId: transferRow.transferId,
      transferDate: transferRow.transferDate,
      transferAmount: transferRow.transferAmount,
      transferCurrency: transferRow.currency,
      transferStatus: transferRow.transferStatus,
      orderIds: [transferRow.orderId],
      orderRows: orderRow ? [orderRow] : [],
      transferRows: [transferRow],
      groupedGrossAmount: transferRow.orderAmount,
      groupedCommissionAmount: transferRow.totalCommissions,
      groupedNetDisbursementAmount: transferRow.transferAmount,
    })
  })

  return [...grouped.values()].sort((left, right) => {
    const leftDate = left.transferDate ?? ''
    const rightDate = right.transferDate ?? ''
    if (leftDate !== rightDate) {
      return rightDate.localeCompare(leftDate)
    }

    return left.transferId.localeCompare(right.transferId, 'es')
  })
}

function resolveTransferGroupByFragment(
  orderRow: NormalizedKontempoOrderRow,
  transferGroups: KontempoTransferGroup[],
) {
  if (!orderRow.transferIdFragment) {
    return null
  }

  const matchingGroups = transferGroups.filter((group) => group.transferId.endsWith(orderRow.transferIdFragment!))
  return matchingGroups.length === 1 ? matchingGroups[0] : null
}

function resolveKontempoJournalMatchWithoutTransfer(
  orderRow: NormalizedKontempoOrderRow,
  allocations: ResolvedInvoiceAllocation[],
  journals: KontempoJournalCandidate[],
) {
  if (orderRow.transferIdFragment || allocations.length === 0) {
    return null
  }

  if (
    !allocations.every((allocation) =>
      allocationHasDeterministicSalesOrderTraceability(orderRow.orderId, allocation),
    )
  ) {
    return null
  }

  const targetNetAmount =
    orderRow.netDisbursementAmount ??
    roundCurrency(allocations.reduce((sum, allocation) => sum + allocation.allocatedNetDisbursementAmount, 0))
  if (targetNetAmount === null || targetNetAmount <= 0) {
    return null
  }

  const orderDate = parseIsoDate(orderRow.approvedAt ?? orderRow.createdAt)
  const exactCandidates = journals
    .filter((journal) =>
      amountsMatch(journal.bankDebit ?? journal.maxDebit ?? journal.maxCredit, targetNetAmount),
    )
    .filter((journal) => {
      if (!orderDate) {
        return true
      }

      const journalDate = parseIsoDate(journal.transactionDate)
      if (!journalDate) {
        return false
      }

      const daysAfterOrder = (getDateOnlyValue(journalDate) - getDateOnlyValue(orderDate)) / 86_400_000
      return daysAfterOrder >= 0 && daysAfterOrder <= 45
    })
    .sort((left, right) => {
      const leftDate = left.transactionDate ?? ''
      const rightDate = right.transactionDate ?? ''
      if (leftDate !== rightDate) {
        return rightDate.localeCompare(leftDate)
      }

      return (left.tranId ?? '').localeCompare(right.tranId ?? '', 'es')
    })

  return exactCandidates.length === 1 ? exactCandidates[0] : null
}

function resolveKontempoJournalMatch(
  transferGroup: KontempoTransferGroup,
  journals: KontempoJournalCandidate[],
) {
  if (!transferGroup.transferAmount) {
    return null
  }

  const transferDate = parseIsoDate(transferGroup.transferDate)
  const exactCandidates = journals
    .filter((journal) =>
      amountsMatch(journal.bankDebit ?? journal.maxDebit ?? journal.maxCredit, transferGroup.transferAmount),
    )
    .map((journal) => ({
      journal,
      dateDistance:
        transferDate && parseIsoDate(journal.transactionDate)
          ? Math.abs(getDateOnlyValue(transferDate) - getDateOnlyValue(parseIsoDate(journal.transactionDate)!))
          : Number.MAX_SAFE_INTEGER,
    }))
    .sort(
      (left, right) =>
        left.dateDistance - right.dateDistance ||
        (left.journal.tranId ?? '').localeCompare(right.journal.tranId ?? '', 'es'),
    )

  if (exactCandidates.length === 0) {
    return null
  }

  if (exactCandidates.length === 1) {
    return exactCandidates[0].journal
  }

  const [top, second] = exactCandidates
  if (top.dateDistance < second.dateDistance) {
    return top.journal
  }

  return null
}

async function fetchKontempoOpenInvoices(client: NetSuiteClient) {
  const query = `
SELECT
  transaction.id AS internalId,
  transaction.tranid AS tranId,
  transaction.trandate AS transactionDate,
  mainLine.createdfrom AS createdFromId,
  BUILTIN.DF(mainLine.createdfrom) AS createdFromName,
  transaction.entity AS customerId,
  BUILTIN.DF(transaction.entity) AS customerName,
  transaction.postingperiod AS postingPeriodId,
  BUILTIN.DF(transaction.postingperiod) AS postingPeriodName,
  transaction.currency AS currencyId,
  BUILTIN.DF(transaction.currency) AS currencyName,
  transaction.foreigntotal AS total,
  MAX(ABS(tal.amountunpaid)) AS amountRemaining
FROM transaction
INNER JOIN transactionline mainLine
  ON mainLine.transaction = transaction.id
  AND mainLine.mainline = 'T'
INNER JOIN transactionaccountingline tal
  ON tal.transaction = transaction.id
  AND tal.posting = 'T'
  AND tal.accounttype = 'AcctRec'
WHERE transaction.type = 'CustInvc'
  AND transaction.trandate >= TO_DATE('${KONTEMPO_YEAR}-01-01', 'YYYY-MM-DD')
GROUP BY
  transaction.id,
  transaction.tranid,
  transaction.trandate,
  mainLine.createdfrom,
  BUILTIN.DF(mainLine.createdfrom),
  transaction.entity,
  BUILTIN.DF(transaction.entity),
  transaction.postingperiod,
  BUILTIN.DF(transaction.postingperiod),
  transaction.currency,
  BUILTIN.DF(transaction.currency),
  transaction.foreigntotal
ORDER BY transaction.trandate DESC, transaction.id DESC
  `.trim()

  return (await fetchAllSuiteQlRows(client, query)).map(toOpenInvoiceRow)
}

async function fetchSalesOrdersById(client: NetSuiteClient, salesOrderIds: string[]) {
  const result = new Map<string, SalesOrderRow>()
  if (salesOrderIds.length === 0) {
    return result
  }

  for (const chunk of chunkValues(salesOrderIds, SUITEQL_IN_CHUNK_SIZE)) {
    const query = `
SELECT
  transaction.id AS internalId,
  transaction.tranid AS tranId,
  transaction.trandate AS transactionDate,
  transaction.entity AS customerId,
  BUILTIN.DF(transaction.entity) AS customerName,
  transaction.currency AS currencyId,
  BUILTIN.DF(transaction.currency) AS currencyName,
  transaction.foreigntotal AS total
FROM transaction
WHERE transaction.id IN (${joinSuiteQlLiterals(chunk)})
    `.trim()

    const rows = (await fetchAllSuiteQlRows(client, query)).map(toSalesOrderRow)
    rows.forEach((row) => result.set(row.internalId, row))
  }

  return result
}

async function fetchKontempoJournalCandidates(
  client: NetSuiteClient,
  transferRows: NormalizedKontempoTransferRow[],
) {
  const minDate = transferRows
    .map((row) => row.transferDate)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right))[0] ?? `${KONTEMPO_YEAR}-01-01`
  const maxDate =
    transferRows
      .map((row) => row.transferDate)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => right.localeCompare(left))[0] ?? `${KONTEMPO_YEAR}-12-31`

  const query = `
SELECT
  transaction.id AS transactionId,
  transaction.tranid AS tranId,
  transaction.trandate AS transactionDate,
  transaction.postingperiod AS postingPeriodId,
  BUILTIN.DF(transaction.postingperiod) AS postingPeriodName,
  transaction.memo AS memo,
  MAX(COALESCE(tal.debit, 0)) AS maxDebit,
  MAX(COALESCE(tal.credit, 0)) AS maxCredit,
  MAX(CASE WHEN LOWER(BUILTIN.DF(tal.account)) LIKE '%higo%' THEN COALESCE(tal.debit, 0) ELSE 0 END) AS bankDebit
FROM transaction
INNER JOIN transactionaccountingline tal
  ON tal.transaction = transaction.id
  AND tal.posting = 'T'
WHERE transaction.type = 'Journal'
  AND transaction.trandate BETWEEN TO_DATE(${formatSuiteQlLiteral(minDate)}, 'YYYY-MM-DD')
    AND TO_DATE(${formatSuiteQlLiteral(maxDate)}, 'YYYY-MM-DD')
  AND (
    LOWER(transaction.memo) LIKE '%kontempo%'
    OR LOWER(transaction.memo) LIKE '%rapyd%'
  )
GROUP BY
  transaction.id,
  transaction.tranid,
  transaction.trandate,
  transaction.postingperiod,
  BUILTIN.DF(transaction.postingperiod),
  transaction.memo
ORDER BY transaction.trandate DESC, transaction.id DESC
  `.trim()

  return (await fetchAllSuiteQlRows(client, query)).map(toKontempoJournalCandidate)
}

async function fetchAllSuiteQlRows(client: NetSuiteClient, query: string) {
  const items: Array<Record<string, unknown>> = []
  let offset = 0

  while (true) {
    const response = await client.suiteql(query, SUITEQL_BATCH_LIMIT, offset)
    const json = response.json as SuiteQlCollectionResponse
    const pageItems = (json.items ?? []) as Array<Record<string, unknown>>
    if (pageItems.length === 0) {
      break
    }

    items.push(...pageItems)
    offset += pageItems.length

    if (!json.hasMore) {
      break
    }
  }

  return items
}

function readCell(values: Record<string, unknown>, header: string) {
  return values[header] ?? values[Object.keys(values).find((key) => normalizeHeader(key) === normalizeHeader(header)) ?? '']
}

function toOpenInvoiceRow(row: Record<string, unknown>): OpenInvoiceRow {
  const normalizedRow = lowerCaseKeys(row)
  return {
    internalId: String(normalizedRow.internalid ?? ''),
    tranId: normalizeOptionalString(normalizedRow.tranid),
    transactionDate: normalizeDateValue(normalizedRow.transactiondate),
    createdFromId: normalizeOptionalString(normalizedRow.createdfromid),
    createdFromName: normalizeOptionalString(normalizedRow.createdfromname),
    customerId: normalizeOptionalString(normalizedRow.customerid),
    customerName: normalizeOptionalString(normalizedRow.customername),
    postingPeriodId: normalizeOptionalString(normalizedRow.postingperiodid),
    postingPeriodName: normalizeOptionalString(normalizedRow.postingperiodname),
    currencyId: normalizeOptionalString(normalizedRow.currencyid),
    currencyName: normalizeOptionalString(normalizedRow.currencyname),
    total: normalizeCurrencyValue(normalizedRow.total),
    amountRemaining: normalizeCurrencyValue(normalizedRow.amountremaining),
  }
}

function toSalesOrderRow(row: Record<string, unknown>): SalesOrderRow {
  const normalizedRow = lowerCaseKeys(row)
  return {
    internalId: String(normalizedRow.internalid ?? ''),
    tranId: normalizeOptionalString(normalizedRow.tranid),
    transactionDate: normalizeDateValue(normalizedRow.transactiondate),
    customerId: normalizeOptionalString(normalizedRow.customerid),
    customerName: normalizeOptionalString(normalizedRow.customername),
    currencyId: normalizeOptionalString(normalizedRow.currencyid),
    currencyName: normalizeOptionalString(normalizedRow.currencyname),
    total: normalizeCurrencyValue(normalizedRow.total),
  }
}

function toKontempoJournalCandidate(row: Record<string, unknown>): KontempoJournalCandidate {
  const normalizedRow = lowerCaseKeys(row)
  return {
    transactionId: String(normalizedRow.transactionid ?? ''),
    tranId: normalizeOptionalString(normalizedRow.tranid),
    transactionDate: normalizeDateValue(normalizedRow.transactiondate),
    postingPeriodId: normalizeOptionalString(normalizedRow.postingperiodid),
    postingPeriodName: normalizeOptionalString(normalizedRow.postingperiodname),
    memo: normalizeOptionalString(normalizedRow.memo),
    maxDebit: normalizeCurrencyValue(normalizedRow.maxdebit),
    maxCredit: normalizeCurrencyValue(normalizedRow.maxcredit),
    bankDebit: normalizeCurrencyValue(normalizedRow.bankdebit),
  }
}

function buildRecognitionKey(orderId: string, invoiceInternalId: string, transferId: string | null | undefined) {
  return [orderId, invoiceInternalId, transferId ?? 'sin-transferencia'].join('|')
}

function belongsToKontempoYear(primaryDate: string | null, secondaryDate: string | null) {
  const date = parseIsoDate(primaryDate) ?? parseIsoDate(secondaryDate)
  return date ? date.getUTCFullYear() === KONTEMPO_YEAR : false
}

function parseIsoDate(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const normalized = value.trim()
  if (!normalized) {
    return null
  }

  const asDate = new Date(`${normalized}T00:00:00Z`)
  if (!Number.isNaN(asDate.getTime())) {
    return asDate
  }

  return null
}

function normalizeDateValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed?.y && parsed?.m && parsed?.d) {
      return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
    }
  }

  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  if (!normalized) {
    return null
  }

  const compactDate = normalized.split('|')[0]?.trim() ?? normalized

  const isoLike = compactDate.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoLike) {
    return `${isoLike[1]}-${isoLike[2]}-${isoLike[3]}`
  }

  const ddmmyyyy = compactDate.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/)
  if (ddmmyyyy) {
    return `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}`
  }

  const ddMonYyyy = compactDate.match(/^(\d{1,2})-([A-Za-z]{3,9})-(\d{4})$/)
  if (ddMonYyyy) {
    const month = parseEnglishMonth(ddMonYyyy[2])
    if (month) {
      return `${ddMonYyyy[3]}-${month}-${ddMonYyyy[1].padStart(2, '0')}`
    }
  }

  const asDate = new Date(compactDate)
  if (!Number.isNaN(asDate.getTime())) {
    return asDate.toISOString().slice(0, 10)
  }

  return null
}

function parseEnglishMonth(value: string) {
  const normalized = value.trim().toLowerCase()
  const months: Record<string, string> = {
    jan: '01',
    january: '01',
    feb: '02',
    february: '02',
    mar: '03',
    march: '03',
    apr: '04',
    april: '04',
    may: '05',
    jun: '06',
    june: '06',
    jul: '07',
    july: '07',
    aug: '08',
    august: '08',
    sep: '09',
    sept: '09',
    september: '09',
    oct: '10',
    october: '10',
    nov: '11',
    november: '11',
    dec: '12',
    december: '12',
  }

  return months[normalized] ?? null
}

function normalizeCurrencyValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return roundCurrency(value)
  }

  if (typeof value !== 'string') {
    return null
  }

  const normalized = value
    .replace(/MX\$/gi, '')
    .replace(/\$/g, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .trim()
  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? roundCurrency(parsed) : null
}

function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function cleanIdentifier(value: unknown) {
  const normalized = normalizeOptionalString(value)
  return normalized ? normalized.replace(/\s+/g, '') : null
}

function normalizeHeader(value: string) {
  return normalizeComparableText(value) ?? ''
}

function normalizeComparableText(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
  return normalized.length > 0 ? normalized : null
}

function compactComparableText(value: string | null | undefined) {
  const normalized = normalizeComparableText(value)
  return normalized ? normalized.replace(/[^a-z0-9]/g, '') : null
}

function lowerCaseKeys(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key.toLowerCase(), entry]))
}

function uniqueValues(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim().length > 0)))]
}

function chunkValues<T>(values: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

function joinSuiteQlLiterals(values: string[]) {
  return values.map((value) => formatSuiteQlLiteral(value)).join(', ')
}

function formatSuiteQlLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function amountsMatch(left: number | null | undefined, right: number | null | undefined) {
  if (left === null || left === undefined || right === null || right === undefined) {
    return false
  }

  return Math.abs(left - right) <= AMOUNT_TOLERANCE
}

function amountsMatchWithinTolerance(
  left: number | null | undefined,
  right: number | null | undefined,
  tolerance: number,
) {
  if (left === null || left === undefined || right === null || right === undefined) {
    return false
  }

  return Math.abs(left - right) <= tolerance
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100
}

function getDateOnlyValue(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}
