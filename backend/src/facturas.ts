import { NetSuiteClient } from './netsuiteClient.js'
import { buildKontempoContextByInvoiceId } from './kontempo.js'
import { ruleDefinitions } from './ruleDefinitions.js'
import type {
  Factura,
  FacturaA4Context,
  FacturaA8Context,
  FacturaB1Context,
  FacturaB3Context,
  FacturaAplicacionA1ItemResult,
  FacturaAplicacionA1Response,
  FacturaAplicacionCandidata,
  FacturaEstado,
  FacturaImpuesto,
  FacturaKJournalComponent,
  FacturaKContext,
  FacturaLinea,
  FacturaN1Context,
  FacturaResumenTipoTransaccion,
  FacturaSchemaField,
  FacturaSchemaSnapshot,
  FacturaSituacion,
  FacturaSituacionCobro,
  FacturasAbiertasResponse,
} from './types.js'

type SuiteQlCollectionResponse = {
  items?: Array<Record<string, unknown>>
  totalResults?: number
  hasMore?: boolean
  count?: number
}

type InvoiceSchemaDocument = {
  properties?: Record<string, SchemaNode>
}

type SchemaNode = {
  title?: string
  type?: string
  format?: string
  nullable?: boolean
  properties?: Record<string, SchemaNode>
  items?: SchemaNode
  'x-ns-custom-field'?: boolean
}

type FacturaOpenSummaryRow = {
  internalId: string
  tranId: string | null
  transactionNumber: string | null
  transactionDate: string | null
  dueDate: string | null
  customerId: string | null
  customerName: string | null
  postingPeriodId: string | null
  postingPeriodName: string | null
  satPaymentTermId: string | null
  satPaymentTermName: string | null
  currencyId: string | null
  currencyName: string | null
  exchangeRate: number | null
  subtotal: number | null
  discountTotal: number | null
  taxTotal: number | null
  total: number | null
  amountPaid: number | null
  amountRemaining: number | null
  statusId: string | null
  statusName: string | null
  referenceNumber: string | null
  memo: string | null
  termsId: string | null
  termsName: string | null
  createdFromId: string | null
  createdFromName: string | null
}

type ClientesAccountRow = {
  internalId: string | null
  displayName: string | null
}

type CreditoAplicableRow = {
  transactionId: string
  tranId: string | null
  transactionType: string | null
  transactionDate: string | null
  postingPeriodId: string | null
  postingPeriodName: string | null
  currencyId: string | null
  currencyName: string | null
  customerId: string | null
  customerName: string | null
  creditAmount: number | null
  appliedAmount: number | null
  availableAmount: number | null
}

type N1AnticipoCandidateRow = {
  facturaAnticipoInternalId: string
  facturaAnticipoDocumento: string | null
  facturaAnticipoFecha: string | null
  facturaAnticipoPeriodoContableId: string | null
  facturaAnticipoPeriodoContableNombre: string | null
  facturaAnticipoClienteId: string | null
  facturaAnticipoClienteNombre: string | null
  facturaAnticipoTotal: number | null
  facturaAnticipoMetodoPagoId: string | null
  facturaAnticipoMetodoPagoNombre: string | null
  pagoAplicadoMonto: number | null
  pagoTransactionId: string | null
  pagoDocumento: string | null
  pagoTipoTransaccion: string | null
  pagoFecha: string | null
  pagoPeriodoContableId: string | null
  pagoPeriodoContableNombre: string | null
  pagoCuentaBancoId: string | null
  pagoCuentaBancoNombre: string | null
  notaCreditoId: string | null
  notaCreditoDocumento: string | null
  notaCreditoFecha: string | null
  notaCreditoEstadoId: string | null
  notaCreditoEstadoNombre: string | null
}

type N1AnticipoCandidate = FacturaN1Context & {
  facturaAnticipoClienteId: string | null
  facturaAnticipoClienteNombre: string | null
}

type A4SalesOrderRow = {
  internalId: string
  tranId: string | null
  customerId: string | null
  customerName: string | null
  currencyId: string | null
  currencyName: string | null
  total: number | null
}

type SalesOrderInvoiceAuditRow = {
  internalId: string
  tranId: string | null
  transactionDate: string | null
  statusName: string | null
  total: number | null
  amountRemaining: number | null
}

type GroupApplyOutcome = {
  items: FacturaAplicacionA1ItemResult[]
  warnings: string[]
}

type LinkedCustomerPaymentRow = {
  transactionId: string
  tranId: string | null
  transactionDate: string | null
  amount: number | null
  accountId: string | null
  accountName: string | null
}

type CustomerPaymentAppliedInvoiceRow = {
  internalId: string
  documento: string | null
  amount: number | null
}

type KontempoCustomerPaymentCollision = {
  payment: LinkedCustomerPaymentRow
  appliedInvoices: CustomerPaymentAppliedInvoiceRow[]
}

type KontempoJournalPaymentInstruction = {
  paymentAmount: number
  bridgeGrossAmount: number
  journalTransactionId: string
  journalDocument: string | null
  journalTransactionDate: string
  bridgeBankAccountId: string
  bridgeBankAccountName: string
}

type JournalAvailableCreditLineRow = {
  transactionId: string
  tranId: string | null
  lineId: number | null
  accountId: string | null
  accountName: string | null
  customerId: string | null
  customerName: string | null
  creditAmount: number | null
  appliedAmount: number | null
  availableAmount: number | null
}

type Ppd1OpenInvoicePeerRow = {
  internalId: string
  tranId: string | null
  transactionDate: string | null
  amountRemaining: number | null
}

type Ppd1SourceBankConfig = {
  accountNumber: string
  accountName: string
  recipientAccount: string | null
  recipientRfc: string | null
  useNetSuiteDefaults: boolean
}

type Ppd1JournalPaymentInstruction = {
  paymentAmount: number
  journalTransactionId: string
  journalDocument: string | null
  journalTransactionDate: string
  bridgeBankAccountId: string
  bridgeBankAccountName: string
  sourceBankAccountId: string
  sourceBankAccountName: string
  recipientAccount: string | null
  recipientRfc: string | null
  useNetSuiteDefaults: boolean
}

const OPEN_AMOUNT_TOLERANCE = 0.005
const DEFAULT_PAGE_LIMIT = 50
const MAX_PAGE_LIMIT = 50
const SUITEQL_BATCH_LIMIT = 1000
const SUITEQL_IN_CHUNK_SIZE = 120
const CREDITOS_APLICABLES_CUSTOMER_CHUNK_SIZE = 24
const FACTURA_RAW_FETCH_CONCURRENCY = 1
const FACTURAS_READ_ANALYSIS_CACHE_TTL_MS = 60_000
const CLIENTES_ACCOUNT_NUMBER = '105-01-00'
const CLIENTES_ACCOUNT_DISPLAY_NAME = '105-01-00 Clientes : Clientes nacionales'
const ROUNDING_ACCOUNT_DISPLAY_NAME = 'Ganancias/pérdidas por redondeo'
const B1_BRIDGE_BANK_ACCOUNT_NUMBER = '100'
const B1_BRIDGE_BANK_ACCOUNT_DISPLAY_NAME = '100 Cheque Account : Bancos Nacional'
const K_CUSTOMER_PAYMENT_TEMPLATE_ID = '105'
const K_CUSTOMER_PAYMENT_TEMPLATE_NAME = 'SoluciÃ³n Factible V4 outbound customer payment template'
const K_SENDING_METHOD_ID = '4'
const K_SENDING_METHOD_NAME = 'SoluciÃ³n Factible Sending Method'
const K_E_DOC_STANDARD_ID = '2'
const K_E_DOC_STANDARD_NAME = 'SoluciÃ³n Factible E-Document Package'
const K_E_DOC_STATUS_PENDING_ID = '1'
const K_E_DOC_STATUS_PENDING_NAME = 'Para generaciÃ³n'
const K_SAT_PAYMENT_METHOD_ID = '3'
const K_SAT_PAYMENT_METHOD_NAME = '03 - Transferencia ElectrÃ³nica de Fondos'
const K_PAYMENT_STRING_TYPE_ID = '1'
const K_PAYMENT_STRING_TYPE_NAME = '01 - SPEI'
const K_RECIPIENT_ACCOUNT = '646180569300100001'
const K_RECIPIENT_RFC = 'STP081030FE6'
const K_PAYMENT_MEXICO_UTC_TIME = '06:00:00Z'
const K_VENDOR_ACCOUNT_ID = '592'
const K_VENDOR_ACCOUNT_NAME = '201-02-00 Proveedores : Proveedores nacionales'
const K_JOURNAL_ROUNDING_TOLERANCE_MXN = 1
const K_JOURNAL_GROUPED_DIFFERENCE_TOLERANCE_MXN = 50
const PPD1_CUSTOMER_PAYMENT_TEMPLATE_ID = K_CUSTOMER_PAYMENT_TEMPLATE_ID
const PPD1_CUSTOMER_PAYMENT_TEMPLATE_NAME = K_CUSTOMER_PAYMENT_TEMPLATE_NAME
const PPD1_SENDING_METHOD_ID = K_SENDING_METHOD_ID
const PPD1_SENDING_METHOD_NAME = K_SENDING_METHOD_NAME
const PPD1_E_DOC_STANDARD_ID = K_E_DOC_STANDARD_ID
const PPD1_E_DOC_STANDARD_NAME = K_E_DOC_STANDARD_NAME
const PPD1_E_DOC_STATUS_PENDING_ID = K_E_DOC_STATUS_PENDING_ID
const PPD1_E_DOC_STATUS_PENDING_NAME = K_E_DOC_STATUS_PENDING_NAME
const PPD1_SAT_PAYMENT_METHOD_ID = K_SAT_PAYMENT_METHOD_ID
const PPD1_SAT_PAYMENT_METHOD_NAME = K_SAT_PAYMENT_METHOD_NAME
const PPD1_PAYMENT_STRING_TYPE_ID = K_PAYMENT_STRING_TYPE_ID
const PPD1_PAYMENT_STRING_TYPE_NAME = K_PAYMENT_STRING_TYPE_NAME
const PPD1_PAYMENT_MEXICO_UTC_TIME = K_PAYMENT_MEXICO_UTC_TIME
const PPD1_SOURCE_BANK_CONFIGS: Ppd1SourceBankConfig[] = [
  {
    accountNumber: '102-01-06',
    accountName: '102-01-06 Bancos : Bancos Nacionales : Higo',
    recipientAccount: '646180569300100001',
    recipientRfc: 'STP081030FE6',
    useNetSuiteDefaults: false,
  },
  {
    accountNumber: '102-01-08',
    accountName: '102-01-08 Bancos : Bancos Nacionales : Clara Corriente',
    recipientAccount: '646180261125900001',
    recipientRfc: 'STP081030FE6',
    useNetSuiteDefaults: false,
  },
  {
    accountNumber: '102-01-01',
    accountName: '102-01-01 Bancos : Bancos Nacionales : BBVA-SHQ-1624',
    recipientAccount: null,
    recipientRfc: null,
    useNetSuiteDefaults: true,
  },
]
const SAT_PAYMENT_TERM_PUE = 'pue - pago en una sola exhibicion'
const SAT_PAYMENT_TERM_PPD = 'ppd - pago en parcialidades o diferido'
const CONTRA_ENTREGA_TERMS_ID = '4'
const CONTRA_ENTREGA_TERMS_NAME = 'Contra Entrega'
const A2_MAX_DIFFERENCE_MXN = 1
const A3_MAX_DIFFERENCE_MXN = 25
const A5_SALES_ORDER_TOLERANCE_MXN = 1
const A8_SUPPORTED_CREDIT_TYPES = new Set(['Journal', 'CustCred'])
const MXN_CURRENCY_NAME = 'mxn'
const N1_ANTICIPO_ITEM_ID = '31522'
const N1_ANTICIPO_ITEM_NAME = 'factura por anticipo de adquisicion de materia prima'
const N1_ALLOWED_PAYMENT_TRANSACTION_TYPES = new Set(['Journal', 'CustPymt'])
const N1_ALLOWED_BANK_ACCOUNT_NAMES = new Set([
  '102-01-06 Bancos : Bancos Nacionales : Higo',
  '102-01-08 Bancos : Bancos Nacionales : Clara Corriente',
  '102-01-01 Bancos : Bancos Nacionales : BBVA-SHQ-1624',
  '102-01-05 Bancos : Bancos Nacionales : Mercado Pago SHQ',
  '102-01-02 Bancos : Bancos Nacionales : Albo',
  '102-01-10 Bancos : Bancos Nacionales : Santander',
  '102-01-04 Bancos : Bancos Nacionales : Fondeadora',
])
const N1_ALLOWED_BANK_ACCOUNT_NUMBERS = new Set([
  '102-01-06',
  '102-01-08',
  '102-01-01',
  '102-01-05',
  '102-01-02',
  '102-01-10',
  '102-01-04',
])
const N1_CREDIT_MEMO_CFDI_SERIE = 'NC'
const N1_CREDIT_MEMO_TEMPLATE_ID = '104'
const N1_CREDIT_MEMO_TEMPLATE_NAME = 'Solución Factible V4 outbound credit memo template'
const N1_SENDING_METHOD_ID = '4'
const N1_SENDING_METHOD_NAME = 'Solución Factible Sending Method'
const N1_CF_DI_USAGE_ID = '2'
const N1_CF_DI_USAGE_NAME = 'G02 - Devoluciones, Descuentos o Bonificaciones'
const N1_PAYMENT_TERM_ID = '3'
const N1_PAYMENT_TERM_NAME = 'PUE - Pago en una Sola Exhibición'
const N1_EXPORT_TYPE_ID = '1'
const N1_EXPORT_TYPE_NAME = '01 - No aplica'
const N1_RECURRENCE_ID = '4'
const N1_RECURRENCE_NAME = 'Mensual'
const N1_OPERATION_TYPE_ID = '25'
const N1_OPERATION_TYPE_NAME = '30 - Aplicación de Anticipos'
const N1_E_DOC_STANDARD_ID = '2'
const N1_E_DOC_STANDARD_NAME = 'Solución Factible E-Document Package'
const N1_E_DOC_STATUS_PENDING_ID = '1'
const N1_E_DOC_STATUS_PENDING_NAME = 'Para generación'
const N1_RELATED_CFDI_RECORD_TYPE = 'customrecord_mx_related_cfdi_subl'
const N1_RELATED_CFDI_RELATION_TYPE_ID = '1'
const N1_RELATED_CFDI_RELATION_TYPE_NAME = '01 - Nota de Crédito de los Documentos Relacionados'
const N1_RELATED_CFDI_QUERY_LIMIT = 20

type FacturasAnalysisState = {
  summaryRows: FacturaOpenSummaryRow[]
  orderedSummaryRows: FacturaOpenSummaryRow[]
  situacionesByInvoiceId: Map<string, FacturaSituacion>
}

type FetchFacturasAbiertasOptions = {
  includeRaw?: boolean
  forceRefresh?: boolean
}

type MonthWindow = {
  startDate: string
  endDate: string
  year: number
  monthNumber: number
  monthName: string
}

type ApplyA1Options = {
  dryRun?: boolean
  invoiceInternalId?: string | null
  limit?: number | null
}

type InvoiceCfdiReference = {
  invoiceInternalId: string
  invoiceDocument: string | null
  uuid: string | null
}

type RelatedCfdiRecord = {
  id: string
  originalTransactionId: string | null
  relatedTransactionId: string | null
  relatedDocument: string | null
  relationTypeId: string | null
  relationTypeName: string | null
  uuid: string | null
  isInactive: boolean
}

type CreditMemoElectronicDocumentState = {
  statusId: string | null
  statusName: string | null
  generatedDocumentId: string | null
  certifiedDocumentId: string | null
  generatedPdfId: string | null
  uuid: string | null
  hasContent: boolean
}

let facturaSchemaCache: FacturaSchemaSnapshot | null = null
let facturaSchemaDocumentCache: InvoiceSchemaDocument | null = null
let clientesAccountIdCache: string | null = null
let b1BridgeBankAccountIdCache: string | null = null
let roundingAccountIdCache: string | null = null
let facturasReadAnalysisCache: {
  createdAtMs: number
  analysis: FacturasAnalysisState
} | null = null

export function invalidateFacturasReadAnalysisCache() {
  facturasReadAnalysisCache = null
}

export async function fetchFacturasAbiertas(
  client: NetSuiteClient,
  rawLimit?: unknown,
  rawOffset?: unknown,
  options?: FetchFacturasAbiertasOptions,
): Promise<FacturasAbiertasResponse> {
  const limit = normalizePageValue(rawLimit, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT)
  const offset = normalizePageValue(rawOffset, 0, Number.MAX_SAFE_INTEGER)
  const includeRaw = options?.includeRaw ?? false

  const schema = await getFacturaSchemaSnapshot(client)
  const schemaDocument = includeRaw ? await getFacturaSchemaDocument(client) : null
  const analysis = await analyzeFacturasAbiertasForRead(client, Boolean(options?.forceRefresh))
  const tableOrderedSummaryRows = [...analysis.summaryRows].sort((left, right) =>
    compareFacturaTableSummaryRows(left, right, analysis.situacionesByInvoiceId),
  )
  const pagedSummaryRows = tableOrderedSummaryRows.slice(offset, offset + limit)

  const facturas = includeRaw
    ? await mapWithConcurrency(
        pagedSummaryRows,
        FACTURA_RAW_FETCH_CONCURRENCY,
        async (summary) => {
          const raw = await fetchFacturaRaw(client, summary.internalId, schemaDocument as InvoiceSchemaDocument)
          return normalizeFactura(
            raw,
            summary,
            analysis.situacionesByInvoiceId.get(summary.internalId) ??
              buildFacturaSituacion([], null, null, null, null, null),
          )
        },
      )
    : pagedSummaryRows.map((summary) =>
        normalizeFacturaFromSummary(
          summary,
          analysis.situacionesByInvoiceId.get(summary.internalId) ??
            buildFacturaSituacion([], null, null, null, null, null),
        ),
      )

  return {
    generatedAtUtc: new Date().toISOString(),
    page: {
      limit,
      offset,
      count: facturas.length,
      totalResults: tableOrderedSummaryRows.length,
      reconciliableResults: countReconciliableFacturas(analysis.summaryRows, analysis.situacionesByInvoiceId),
      deferredCurrentPpdCount: countDeferredCurrentPpdFacturas(
        analysis.summaryRows,
        analysis.situacionesByInvoiceId,
      ),
      kCount: countSituaciones(analysis.situacionesByInvoiceId, 'K'),
      ppd1Count: countSituaciones(analysis.situacionesByInvoiceId, 'PPD1'),
      a1Count: countSituaciones(analysis.situacionesByInvoiceId, 'A1'),
      a4Count: countSituaciones(analysis.situacionesByInvoiceId, 'A4'),
      a5Count: countSituaciones(analysis.situacionesByInvoiceId, 'A5'),
      a6Count: countSituaciones(analysis.situacionesByInvoiceId, 'A6'),
      a7Count: countSituaciones(analysis.situacionesByInvoiceId, 'A7'),
      a8Count: countSituaciones(analysis.situacionesByInvoiceId, 'A8'),
      b1Count: countSituaciones(analysis.situacionesByInvoiceId, 'B1'),
      b2Count: countSituaciones(analysis.situacionesByInvoiceId, 'B2'),
      b3Count: countSituaciones(analysis.situacionesByInvoiceId, 'B3'),
      n1Count: countSituaciones(analysis.situacionesByInvoiceId, 'N1'),
      hasMore: offset + facturas.length < tableOrderedSummaryRows.length,
    },
    summary: {
      transactionTypes: buildResumenTiposTransaccion(analysis.situacionesByInvoiceId),
    },
    schema,
    facturas,
  }
}

export async function applyTransaccionesA1(
  client: NetSuiteClient,
  options?: ApplyA1Options,
): Promise<FacturaAplicacionA1Response> {
  const dryRun = Boolean(options?.dryRun)
  const invoiceInternalId = normalizeOptionalString(options?.invoiceInternalId)
  const limit =
    typeof options?.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
      ? Math.floor(options.limit)
      : null
  const analysis = await analyzeFacturasAbiertas(client)
  const allA1Summaries = analysis.orderedSummaryRows.filter((summary) => {
    if (analysis.situacionesByInvoiceId.get(summary.internalId)?.codigo !== 'A1') {
      return false
    }

    if (invoiceInternalId && summary.internalId !== invoiceInternalId) {
      return false
    }

    return true
  })
  const a1Summaries = limit ? allA1Summaries.slice(0, limit) : allA1Summaries

  const items: FacturaAplicacionA1ItemResult[] = []

  for (const summary of a1Summaries) {
    const situacion =
      analysis.situacionesByInvoiceId.get(summary.internalId) ??
      buildFacturaSituacion([], null, null, null, null, null)
    items.push(await applyFacturaA1(client, summary, situacion, { dryRun }))

    if (!dryRun) {
      await sleep(250)
    }
  }

  return {
    executedAtUtc: new Date().toISOString(),
    ruleCode: 'A1',
    totals: {
      eligible: a1Summaries.length,
      applied: items.filter((item) => item.status === 'applied').length,
      dryRun: items.filter((item) => item.status === 'dry_run').length,
      skipped: items.filter((item) => item.status === 'skipped').length,
      failed: items.filter((item) => item.status === 'failed').length,
    },
    items,
  }
}

export async function applyTransaccionesK(
  client: NetSuiteClient,
  options?: ApplyA1Options,
): Promise<FacturaAplicacionA1Response> {
  const dryRun = Boolean(options?.dryRun)
  const invoiceInternalId = normalizeOptionalString(options?.invoiceInternalId)
  const limit =
    typeof options?.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
      ? Math.floor(options.limit)
      : null
  const analysis = await analyzeFacturasAbiertas(client)
  const allKSummaries = analysis.orderedSummaryRows.filter((summary) => {
    if (analysis.situacionesByInvoiceId.get(summary.internalId)?.codigo !== 'K') {
      return false
    }

    if (invoiceInternalId && summary.internalId !== invoiceInternalId) {
      return false
    }

    return true
  })
  const kSummaries = limit ? allKSummaries.slice(0, limit) : allKSummaries

  const items: FacturaAplicacionA1ItemResult[] = []

  for (const summary of kSummaries) {
    const situacion =
      analysis.situacionesByInvoiceId.get(summary.internalId) ??
      buildFacturaSituacion([], null, null, null, null, null)
    items.push(await applyFacturaK(client, summary, situacion, { dryRun }))

    if (!dryRun) {
      await sleep(250)
    }
  }

  return {
    executedAtUtc: new Date().toISOString(),
    ruleCode: 'K',
    totals: {
      eligible: kSummaries.length,
      applied: items.filter((item) => item.status === 'applied').length,
      dryRun: items.filter((item) => item.status === 'dry_run').length,
      skipped: items.filter((item) => item.status === 'skipped').length,
      failed: items.filter((item) => item.status === 'failed').length,
    },
    items,
  }
}

export async function applyTransaccionesPpd1(
  client: NetSuiteClient,
  options?: ApplyA1Options,
): Promise<FacturaAplicacionA1Response> {
  const dryRun = Boolean(options?.dryRun)
  const invoiceInternalId = normalizeOptionalString(options?.invoiceInternalId)
  const limit =
    typeof options?.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
      ? Math.floor(options.limit)
      : null
  const analysis = await analyzeFacturasAbiertas(client)
  const allPpd1Summaries = analysis.orderedSummaryRows.filter((summary) => {
    if (analysis.situacionesByInvoiceId.get(summary.internalId)?.codigo !== 'PPD1') {
      return false
    }

    if (invoiceInternalId && summary.internalId !== invoiceInternalId) {
      return false
    }

    return true
  })
  const ppd1Summaries = limit ? allPpd1Summaries.slice(0, limit) : allPpd1Summaries

  const items: FacturaAplicacionA1ItemResult[] = []

  for (const summary of ppd1Summaries) {
    const situacion =
      analysis.situacionesByInvoiceId.get(summary.internalId) ??
      buildFacturaSituacion([], null, null, null, null, null)
    items.push(await applyFacturaPpd1(client, summary, situacion, { dryRun }))

    if (!dryRun) {
      await sleep(250)
    }
  }

  return {
    executedAtUtc: new Date().toISOString(),
    ruleCode: 'PPD1',
    totals: {
      eligible: ppd1Summaries.length,
      applied: items.filter((item) => item.status === 'applied').length,
      dryRun: items.filter((item) => item.status === 'dry_run').length,
      skipped: items.filter((item) => item.status === 'skipped').length,
      failed: items.filter((item) => item.status === 'failed').length,
    },
    items,
  }
}

export async function applyTransaccionesA2(
  client: NetSuiteClient,
  options?: ApplyA1Options,
): Promise<FacturaAplicacionA1Response> {
  const dryRun = Boolean(options?.dryRun)
  const invoiceInternalId = normalizeOptionalString(options?.invoiceInternalId)
  const limit =
    typeof options?.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
      ? Math.floor(options.limit)
      : null
  const analysis = await analyzeFacturasAbiertas(client)
  const allA2Summaries = analysis.orderedSummaryRows.filter((summary) => {
    if (analysis.situacionesByInvoiceId.get(summary.internalId)?.codigo !== 'A2') {
      return false
    }

    if (invoiceInternalId && summary.internalId !== invoiceInternalId) {
      return false
    }

    return true
  })
  const a2Summaries = limit ? allA2Summaries.slice(0, limit) : allA2Summaries

  const items: FacturaAplicacionA1ItemResult[] = []

  for (const summary of a2Summaries) {
    const situacion =
      analysis.situacionesByInvoiceId.get(summary.internalId) ??
      buildFacturaSituacion([], null, null, null, null, null)
    items.push(await applyFacturaA2(client, summary, situacion, { dryRun }))

    if (!dryRun) {
      await sleep(250)
    }
  }

  return {
    executedAtUtc: new Date().toISOString(),
    ruleCode: 'A2',
    totals: {
      eligible: a2Summaries.length,
      applied: items.filter((item) => item.status === 'applied').length,
      dryRun: items.filter((item) => item.status === 'dry_run').length,
      skipped: items.filter((item) => item.status === 'skipped').length,
      failed: items.filter((item) => item.status === 'failed').length,
    },
    items,
  }
}

export async function applyTransaccionesA3(
  client: NetSuiteClient,
  options?: ApplyA1Options,
): Promise<FacturaAplicacionA1Response> {
  const dryRun = Boolean(options?.dryRun)
  const invoiceInternalId = normalizeOptionalString(options?.invoiceInternalId)
  const limit =
    typeof options?.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
      ? Math.floor(options.limit)
      : null
  const analysis = await analyzeFacturasAbiertas(client)
  const allA3Summaries = analysis.orderedSummaryRows.filter((summary) => {
    if (analysis.situacionesByInvoiceId.get(summary.internalId)?.codigo !== 'A3') {
      return false
    }

    if (invoiceInternalId && summary.internalId !== invoiceInternalId) {
      return false
    }

    return true
  })
  const a3Summaries = limit ? allA3Summaries.slice(0, limit) : allA3Summaries

  const items: FacturaAplicacionA1ItemResult[] = []

  for (const summary of a3Summaries) {
    const situacion =
      analysis.situacionesByInvoiceId.get(summary.internalId) ??
      buildFacturaSituacion([], null, null, null, null, null)
    items.push(await applyFacturaA3(client, summary, situacion, { dryRun }))

    if (!dryRun) {
      await sleep(250)
    }
  }

  return {
    executedAtUtc: new Date().toISOString(),
    ruleCode: 'A3',
    totals: {
      eligible: a3Summaries.length,
      applied: items.filter((item) => item.status === 'applied').length,
      dryRun: items.filter((item) => item.status === 'dry_run').length,
      skipped: items.filter((item) => item.status === 'skipped').length,
      failed: items.filter((item) => item.status === 'failed').length,
    },
    items,
  }
}

export async function applyTransaccionesA4(
  client: NetSuiteClient,
  options?: ApplyA1Options,
): Promise<FacturaAplicacionA1Response> {
  return applyTransaccionesGroupedOrder(client, options, 'A4')
}

export async function applyTransaccionesA5(
  client: NetSuiteClient,
  options?: ApplyA1Options,
): Promise<FacturaAplicacionA1Response> {
  return applyTransaccionesGroupedOrder(client, options, 'A5')
}

export async function applyTransaccionesA6(
  client: NetSuiteClient,
  options?: ApplyA1Options,
): Promise<FacturaAplicacionA1Response> {
  const dryRun = Boolean(options?.dryRun)
  const invoiceInternalId = normalizeOptionalString(options?.invoiceInternalId)
  const limit =
    typeof options?.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
      ? Math.floor(options.limit)
      : null
  const analysis = await analyzeFacturasAbiertas(client)
  const allA6Summaries = analysis.orderedSummaryRows.filter((summary) => {
    if (analysis.situacionesByInvoiceId.get(summary.internalId)?.codigo !== 'A6') {
      return false
    }

    if (invoiceInternalId && summary.internalId !== invoiceInternalId) {
      return false
    }

    return true
  })
  const a6Summaries = limit ? allA6Summaries.slice(0, limit) : allA6Summaries

  const items: FacturaAplicacionA1ItemResult[] = []

  for (const summary of a6Summaries) {
    const situacion =
      analysis.situacionesByInvoiceId.get(summary.internalId) ??
      buildFacturaSituacion([], null, null, null, null, null)
    items.push(await applyFacturaA6(client, summary, situacion, { dryRun }))

    if (!dryRun) {
      await sleep(250)
    }
  }

  return {
    executedAtUtc: new Date().toISOString(),
    ruleCode: 'A6',
    totals: {
      eligible: a6Summaries.length,
      applied: items.filter((item) => item.status === 'applied').length,
      dryRun: items.filter((item) => item.status === 'dry_run').length,
      skipped: items.filter((item) => item.status === 'skipped').length,
      failed: items.filter((item) => item.status === 'failed').length,
    },
    items,
  }
}

export async function applyTransaccionesB1(
  client: NetSuiteClient,
  options?: ApplyA1Options,
): Promise<FacturaAplicacionA1Response> {
  const dryRun = Boolean(options?.dryRun)
  const invoiceInternalId = normalizeOptionalString(options?.invoiceInternalId)
  const limit =
    typeof options?.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
      ? Math.floor(options.limit)
      : null
  const analysis = await analyzeFacturasAbiertas(client)
  const allB1Summaries = analysis.orderedSummaryRows.filter((summary) => {
    if (analysis.situacionesByInvoiceId.get(summary.internalId)?.codigo !== 'B1') {
      return false
    }

    if (invoiceInternalId && summary.internalId !== invoiceInternalId) {
      return false
    }

    return true
  })
  const b1Summaries = limit ? allB1Summaries.slice(0, limit) : allB1Summaries

  const items: FacturaAplicacionA1ItemResult[] = []

  for (const summary of b1Summaries) {
    const situacion =
      analysis.situacionesByInvoiceId.get(summary.internalId) ??
      buildFacturaSituacion([], null, null, null, null, null)
    items.push(await applyFacturaB1(client, summary, situacion, { dryRun }))

    if (!dryRun) {
      await sleep(250)
    }
  }

  return {
    executedAtUtc: new Date().toISOString(),
    ruleCode: 'B1',
    totals: {
      eligible: b1Summaries.length,
      applied: items.filter((item) => item.status === 'applied').length,
      dryRun: items.filter((item) => item.status === 'dry_run').length,
      skipped: items.filter((item) => item.status === 'skipped').length,
      failed: items.filter((item) => item.status === 'failed').length,
    },
    items,
  }
}

export async function applyTransaccionesB2(
  client: NetSuiteClient,
  options?: ApplyA1Options,
): Promise<FacturaAplicacionA1Response> {
  const dryRun = Boolean(options?.dryRun)
  const invoiceInternalId = normalizeOptionalString(options?.invoiceInternalId)
  const limit =
    typeof options?.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
      ? Math.floor(options.limit)
      : null
  const analysis = await analyzeFacturasAbiertas(client)
  const allB2Summaries = analysis.orderedSummaryRows.filter((summary) => {
    if (analysis.situacionesByInvoiceId.get(summary.internalId)?.codigo !== 'B2') {
      return false
    }

    if (invoiceInternalId && summary.internalId !== invoiceInternalId) {
      return false
    }

    return true
  })
  const b2Summaries = limit ? allB2Summaries.slice(0, limit) : allB2Summaries

  const items: FacturaAplicacionA1ItemResult[] = []

  for (const summary of b2Summaries) {
    const situacion =
      analysis.situacionesByInvoiceId.get(summary.internalId) ??
      buildFacturaSituacion([], null, null, null, null, null)
    items.push(await applyFacturaB2(client, summary, situacion, { dryRun }))

    if (!dryRun) {
      await sleep(250)
    }
  }

  return {
    executedAtUtc: new Date().toISOString(),
    ruleCode: 'B2',
    totals: {
      eligible: b2Summaries.length,
      applied: items.filter((item) => item.status === 'applied').length,
      dryRun: items.filter((item) => item.status === 'dry_run').length,
      skipped: items.filter((item) => item.status === 'skipped').length,
      failed: items.filter((item) => item.status === 'failed').length,
    },
    items,
  }
}

export async function applyTransaccionesB3(
  client: NetSuiteClient,
  options?: ApplyA1Options,
): Promise<FacturaAplicacionA1Response> {
  const dryRun = Boolean(options?.dryRun)
  const invoiceInternalId = normalizeOptionalString(options?.invoiceInternalId)
  const limit =
    typeof options?.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
      ? Math.floor(options.limit)
      : null
  const analysis = await analyzeFacturasAbiertas(client)
  const allB3Summaries = analysis.orderedSummaryRows.filter((summary) => {
    const situacion = analysis.situacionesByInvoiceId.get(summary.internalId)
    if (situacion?.codigo !== 'B3') {
      return false
    }

    if (invoiceInternalId) {
      return situacion.b3?.invoices.some((invoice) => invoice.internalId === invoiceInternalId) ?? false
    }

    return true
  })

  const groups = new Map<
    string,
    {
      context: FacturaB3Context
      summaries: FacturaOpenSummaryRow[]
    }
  >()
  const summariesById = new Map(analysis.summaryRows.map((summary) => [summary.internalId, summary]))

  allB3Summaries.forEach((summary) => {
    const context = analysis.situacionesByInvoiceId.get(summary.internalId)?.b3
    if (!context || groups.has(context.groupKey)) {
      return
    }

    const groupSummaries = context.invoices
      .map((invoice) => summariesById.get(invoice.internalId))
      .filter((value): value is FacturaOpenSummaryRow => Boolean(value))

    groups.set(context.groupKey, {
      context,
      summaries: groupSummaries,
    })
  })

  const selectedGroups = limit ? [...groups.values()].slice(0, limit) : [...groups.values()]
  const items: FacturaAplicacionA1ItemResult[] = []
  const warnings: string[] = []

  for (const group of selectedGroups) {
    const outcome = await applyFacturaB3Group(client, group.summaries, group.context, { dryRun })
    items.push(...outcome.items)
    warnings.push(...outcome.warnings)

    if (!dryRun) {
      await sleep(250)
    }
  }

  return {
    executedAtUtc: new Date().toISOString(),
    ruleCode: 'B3',
    totals: {
      eligible: selectedGroups.reduce((sum, group) => sum + group.summaries.length, 0),
      applied: items.filter((item) => item.status === 'applied').length,
      dryRun: items.filter((item) => item.status === 'dry_run').length,
      skipped: items.filter((item) => item.status === 'skipped').length,
      failed: items.filter((item) => item.status === 'failed').length,
    },
    items,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

export async function applyTransaccionesA7(
  client: NetSuiteClient,
  options?: ApplyA1Options,
): Promise<FacturaAplicacionA1Response> {
  return applyTransaccionesGroupedOrder(client, options, 'A7')
}

export async function applyTransaccionesA8(
  client: NetSuiteClient,
  options?: ApplyA1Options,
): Promise<FacturaAplicacionA1Response> {
  const dryRun = Boolean(options?.dryRun)
  const invoiceInternalId = normalizeOptionalString(options?.invoiceInternalId)
  const limit =
    typeof options?.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
      ? Math.floor(options.limit)
      : null
  const analysis = await analyzeFacturasAbiertas(client)
  const allA8Summaries = analysis.orderedSummaryRows.filter((summary) => {
    const situacion = analysis.situacionesByInvoiceId.get(summary.internalId)
    if (situacion?.codigo !== 'A8') {
      return false
    }

    if (invoiceInternalId && summary.internalId !== invoiceInternalId) {
      return false
    }

    return true
  })

  const groups = new Map<
    string,
    {
      summaries: FacturaOpenSummaryRow[]
      contexts: Map<string, FacturaA8Context>
    }
  >()
  const summariesById = new Map(analysis.summaryRows.map((summary) => [summary.internalId, summary]))

  allA8Summaries.forEach((summary) => {
    const context = analysis.situacionesByInvoiceId.get(summary.internalId)?.a8
    if (!context) {
      return
    }

    const existingGroup = groups.get(context.bucketKey)
    if (existingGroup) {
      return
    }

    const groupSummaries = context.invoices
      .map((invoice) => summariesById.get(invoice.internalId))
      .filter((value): value is FacturaOpenSummaryRow => Boolean(value))
    const contexts = new Map<string, FacturaA8Context>()
    groupSummaries.forEach((groupSummary) => {
      const groupContext = analysis.situacionesByInvoiceId.get(groupSummary.internalId)?.a8
      if (groupContext) {
        contexts.set(groupSummary.internalId, groupContext)
      }
    })

    groups.set(context.bucketKey, {
      summaries: groupSummaries,
      contexts,
    })
  })

  const selectedGroups = limit ? [...groups.values()].slice(0, limit) : [...groups.values()]
  const items: FacturaAplicacionA1ItemResult[] = []

  for (const group of selectedGroups) {
    items.push(...(await applyFacturaA8Group(client, group.summaries, group.contexts, { dryRun })))

    if (!dryRun) {
      await sleep(250)
    }
  }

  return {
    executedAtUtc: new Date().toISOString(),
    ruleCode: 'A8',
    totals: {
      eligible: selectedGroups.reduce((sum, group) => sum + group.summaries.length, 0),
      applied: items.filter((item) => item.status === 'applied').length,
      dryRun: items.filter((item) => item.status === 'dry_run').length,
      skipped: items.filter((item) => item.status === 'skipped').length,
      failed: items.filter((item) => item.status === 'failed').length,
    },
    items,
  }
}

async function applyTransaccionesGroupedOrder(
  client: NetSuiteClient,
  options: ApplyA1Options | undefined,
  ruleCode: 'A4' | 'A5' | 'A7',
): Promise<FacturaAplicacionA1Response> {
  const dryRun = Boolean(options?.dryRun)
  const invoiceInternalId = normalizeOptionalString(options?.invoiceInternalId)
  const limit =
    typeof options?.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
      ? Math.floor(options.limit)
      : null
  const analysis = await analyzeFacturasAbiertas(client)
  const allGroupedSummaries = analysis.orderedSummaryRows.filter((summary) => {
    const situacion = analysis.situacionesByInvoiceId.get(summary.internalId)
    if (situacion?.codigo !== ruleCode) {
      return false
    }

    if (invoiceInternalId) {
      const context =
        ruleCode === 'A4' ? situacion.a4 : ruleCode === 'A5' ? situacion.a5 : situacion.a7
      return context?.invoices.some((invoice) => invoice.internalId === invoiceInternalId) ?? false
    }

    return true
  })

  const groups = new Map<
    string,
    {
      context: FacturaA4Context
      summaries: FacturaOpenSummaryRow[]
    }
  >()
  const summariesById = new Map(analysis.summaryRows.map((summary) => [summary.internalId, summary]))

  allGroupedSummaries.forEach((summary) => {
    const situacion = analysis.situacionesByInvoiceId.get(summary.internalId)
    const context =
      ruleCode === 'A4' ? situacion?.a4 : ruleCode === 'A5' ? situacion?.a5 : situacion?.a7
    if (!context || groups.has(context.groupKey)) {
      return
    }

    const groupSummaries = context.invoices
      .map((invoice) => summariesById.get(invoice.internalId))
      .filter((value): value is FacturaOpenSummaryRow => Boolean(value))

    groups.set(context.groupKey, {
      context,
      summaries: groupSummaries,
    })
  })

  const selectedGroups = limit ? [...groups.values()].slice(0, limit) : [...groups.values()]
  const items: FacturaAplicacionA1ItemResult[] = []
  const warnings: string[] = []

  for (const group of selectedGroups) {
    const outcome = await applyFacturaA4Group(client, group.summaries, group.context, { dryRun, ruleCode })
    items.push(...outcome.items)
    warnings.push(...outcome.warnings)

    if (!dryRun) {
      await sleep(250)
    }
  }

  return {
    executedAtUtc: new Date().toISOString(),
    ruleCode,
    totals: {
      eligible: selectedGroups.reduce((sum, group) => sum + group.summaries.length, 0),
      applied: items.filter((item) => item.status === 'applied').length,
      dryRun: items.filter((item) => item.status === 'dry_run').length,
      skipped: items.filter((item) => item.status === 'skipped').length,
      failed: items.filter((item) => item.status === 'failed').length,
    },
    items,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

export async function applyTransaccionesN1(
  client: NetSuiteClient,
  options?: ApplyA1Options,
): Promise<FacturaAplicacionA1Response> {
  const dryRun = Boolean(options?.dryRun)
  const invoiceInternalId = normalizeOptionalString(options?.invoiceInternalId)
  const limit =
    typeof options?.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
      ? Math.floor(options.limit)
      : null
  const analysis = await analyzeFacturasAbiertas(client)
  const allN1Summaries = analysis.orderedSummaryRows.filter((summary) => {
    if (analysis.situacionesByInvoiceId.get(summary.internalId)?.codigo !== 'N1') {
      return false
    }

    if (invoiceInternalId && summary.internalId !== invoiceInternalId) {
      return false
    }

    return true
  })
  const n1Summaries = limit ? allN1Summaries.slice(0, limit) : allN1Summaries

  const items: FacturaAplicacionA1ItemResult[] = []

  for (const summary of n1Summaries) {
    const situacion =
      analysis.situacionesByInvoiceId.get(summary.internalId) ??
      buildFacturaSituacion([], null, null, null, null, null)
    items.push(await applyFacturaN1(client, summary, situacion, { dryRun }))

    if (!dryRun) {
      await sleep(250)
    }
  }

  return {
    executedAtUtc: new Date().toISOString(),
    ruleCode: 'N1',
    totals: {
      eligible: n1Summaries.length,
      applied: items.filter((item) => item.status === 'applied').length,
      dryRun: items.filter((item) => item.status === 'dry_run').length,
      skipped: items.filter((item) => item.status === 'skipped').length,
      failed: items.filter((item) => item.status === 'failed').length,
    },
    items,
  }
}

async function getFacturaSchemaSnapshot(client: NetSuiteClient) {
  if (facturaSchemaCache) {
    return facturaSchemaCache
  }

  const schema = await getFacturaSchemaDocument(client)
  const topLevelFields = extractSchemaFields(schema.properties)
  const itemLineFields = extractSchemaFields(
    schema.properties?.item?.properties?.items?.items?.properties,
  )

  facturaSchemaCache = {
    recordType: 'invoice',
    topLevelFieldCount: topLevelFields.length,
    customFieldCount: topLevelFields.filter((field) => field.custom).length,
    topLevelFields,
    itemLineFieldCount: itemLineFields.length,
    itemLineFields,
  }

  return facturaSchemaCache
}

async function getFacturaSchemaDocument(client: NetSuiteClient) {
  if (facturaSchemaDocumentCache) {
    return facturaSchemaDocumentCache
  }

  const response = await client.getRecordSchema('invoice')
  facturaSchemaDocumentCache = response.json as InvoiceSchemaDocument
  return facturaSchemaDocumentCache
}

async function fetchFacturaRaw(
  client: NetSuiteClient,
  internalId: string,
  _schema: InvoiceSchemaDocument,
) {
  const response = await client.getRecord('invoice', internalId, {
    expandSubResources: true,
  })
  return response.json as Record<string, unknown>
}

async function fetchFacturaOpenSummaryRows(client: NetSuiteClient) {
  const items = await fetchAllSuiteQlRows(client, buildFacturasAbiertasQuery())
  return items.map(toFacturaOpenSummaryRow)
}

async function analyzeFacturasAbiertas(client: NetSuiteClient): Promise<FacturasAnalysisState> {
  let summaryRows = await fetchFacturaOpenSummaryRows(client)
  const dueDateRepairsApplied = await remediateFacturasWithoutDueDate(client, summaryRows)

  if (dueDateRepairsApplied > 0) {
    summaryRows = await fetchFacturaOpenSummaryRows(client)
  }

  const situacionesByInvoiceId = await buildSituacionesByFactura(client, summaryRows)
  const orderedSummaryRows = [...summaryRows].sort((left, right) =>
    compareFacturaSummaryRows(left, right, situacionesByInvoiceId),
  )

  return {
    summaryRows,
    orderedSummaryRows,
    situacionesByInvoiceId,
  }
}

async function analyzeFacturasAbiertasForRead(
  client: NetSuiteClient,
  forceRefresh: boolean,
): Promise<FacturasAnalysisState> {
  const now = Date.now()
  if (
    !forceRefresh &&
    facturasReadAnalysisCache &&
    now - facturasReadAnalysisCache.createdAtMs < FACTURAS_READ_ANALYSIS_CACHE_TTL_MS
  ) {
    return facturasReadAnalysisCache.analysis
  }

  const analysis = await analyzeFacturasAbiertas(client)
  facturasReadAnalysisCache = {
    createdAtMs: Date.now(),
    analysis,
  }

  return analysis
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

async function remediateFacturasWithoutDueDate(
  client: NetSuiteClient,
  summaryRows: FacturaOpenSummaryRow[],
) {
  const missingDueDateRows = summaryRows.filter((summary) => !summary.dueDate)
  let repairedCount = 0

  for (const summary of missingDueDateRows) {
    try {
      const repaired = await repairFacturaWithoutDueDate(client, summary)
      if (repaired) {
        repairedCount += 1
        await sleep(150)
      }
    } catch (error) {
      console.warn(
        `[facturas/open] No se pudo corregir vencimiento para factura ${summary.tranId ?? summary.internalId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  return repairedCount
}

async function repairFacturaWithoutDueDate(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
) {
  const invoiceResponse = await client.getRecord('invoice', summary.internalId)
  const invoiceRecord = invoiceResponse.json as Record<string, unknown>
  const existingDueDate = getNullableString(invoiceRecord.dueDate)

  if (existingDueDate) {
    return false
  }

  if (summary.customerId) {
    await ensureCustomerTermsForMissingDueDate(client, summary.customerId)
  }

  const dueDateSource =
    parseNetSuiteDate(getNullableString(invoiceRecord.createdDate)) ??
    parseNetSuiteDate(getNullableString(invoiceRecord.tranDate)) ??
    parseNetSuiteDate(summary.transactionDate)

  if (!dueDateSource) {
    throw new Error('La factura no trae fecha de creacion ni fecha de transaccion para reconstruir el vencimiento.')
  }

  await client.patchRecord('invoice', summary.internalId, {
    dueDate: toIsoDate(dueDateSource),
  })

  return true
}

async function ensureCustomerTermsForMissingDueDate(
  client: NetSuiteClient,
  customerId: string,
) {
  const customerResponse = await client.getRecord('customer', customerId)
  const customerRecord = customerResponse.json as Record<string, unknown>
  const existingTermsId = getReferenceId(customerRecord.terms) ?? getNullableString(customerRecord.terms)

  if (existingTermsId) {
    return false
  }

  await client.patchRecord('customer', customerId, {
    terms: {
      id: CONTRA_ENTREGA_TERMS_ID,
      refName: CONTRA_ENTREGA_TERMS_NAME,
    },
  })

  return true
}

async function buildSituacionesByFactura(
  client: NetSuiteClient,
  summaryRows: FacturaOpenSummaryRow[],
) {
  const result = new Map<string, FacturaSituacion>()
  if (summaryRows.length === 0) {
    return result
  }

  const creditos = await fetchCreditosAplicables(client, summaryRows)
  const creditosByCustomerId = new Map<string, CreditoAplicableRow[]>()
  const candidatosByInvoiceId = new Map<string, FacturaAplicacionCandidata[]>()

  creditos.forEach((credito) => {
    if (!credito.customerId) {
      return
    }

    const bucket = creditosByCustomerId.get(credito.customerId) ?? []
    bucket.push(credito)
    creditosByCustomerId.set(credito.customerId, bucket)
  })

  summaryRows.forEach((summary) => {
    const customerCredits = summary.customerId
      ? (creditosByCustomerId.get(summary.customerId) ?? [])
      : []

    const candidatos = customerCredits
      .map((credito) => toFacturaAplicacionCandidata(summary, credito))
      .sort(compareFacturaAplicacionCandidatas)

    candidatosByInvoiceId.set(summary.internalId, candidatos)
  })

  const summaryByInvoiceId = new Map(summaryRows.map((summary) => [summary.internalId, summary]))
  const kContextByInvoiceId = new Map(
    [...buildKontempoContextByInvoiceId(summaryRows).entries()].filter(([invoiceInternalId]) => {
      const summary = summaryByInvoiceId.get(invoiceInternalId)
      return Boolean(summary && isFacturaPpd(summary))
    }),
  )
  const { a4ContextByInvoiceId, a5ContextByInvoiceId } = await buildA4AndA5ContextByInvoiceId(
    client,
    summaryRows,
    creditos,
    candidatosByInvoiceId,
  )
  const a6ContextByInvoiceId = await buildA6ContextByInvoiceId(client, summaryRows, creditos, candidatosByInvoiceId)
  const a7ContextByInvoiceId = await buildA7ContextByInvoiceId(summaryRows, creditos, candidatosByInvoiceId)
  const a8ContextByInvoiceId = await buildA8ContextByInvoiceId(
    summaryRows,
    creditos,
    candidatosByInvoiceId,
    new Set([
      ...a4ContextByInvoiceId.keys(),
      ...a5ContextByInvoiceId.keys(),
      ...a6ContextByInvoiceId.keys(),
      ...a7ContextByInvoiceId.keys(),
    ]),
  )
  const b3ContextByInvoiceId = await buildB3ContextByInvoiceId(
    client,
    summaryRows,
    creditos,
    candidatosByInvoiceId,
    new Set([
      ...a4ContextByInvoiceId.keys(),
      ...a5ContextByInvoiceId.keys(),
      ...a6ContextByInvoiceId.keys(),
      ...a7ContextByInvoiceId.keys(),
      ...a8ContextByInvoiceId.keys(),
    ]),
  )
  const b1ContextByInvoiceId = await buildB1ContextByInvoiceId(summaryRows, creditos, candidatosByInvoiceId)
  const b2ContextByInvoiceId = await buildB2ContextByInvoiceId(summaryRows, creditos, candidatosByInvoiceId)
  const n1EligibleSummaries = summaryRows.filter((summary) => {
    if (!isFacturaPue(summary)) {
      return false
    }

    const candidatos = candidatosByInvoiceId.get(summary.internalId) ?? []
    if (candidatos.some((candidate) => candidate.cumpleA1 || candidate.cumpleA2 || candidate.cumpleA3)) {
      return false
    }

    return !(
      a4ContextByInvoiceId.has(summary.internalId) ||
      a5ContextByInvoiceId.has(summary.internalId) ||
      a6ContextByInvoiceId.has(summary.internalId) ||
      a7ContextByInvoiceId.has(summary.internalId) ||
      a8ContextByInvoiceId.has(summary.internalId) ||
      kContextByInvoiceId.has(summary.internalId) ||
      b1ContextByInvoiceId.has(summary.internalId) ||
      b2ContextByInvoiceId.has(summary.internalId) ||
      b3ContextByInvoiceId.has(summary.internalId)
    )
  })
  const n1ContextByInvoiceId = await buildN1ContextByInvoiceId(client, n1EligibleSummaries)

  summaryRows.forEach((summary) => {
    const candidatos = candidatosByInvoiceId.get(summary.internalId) ?? []
    const kContext = kContextByInvoiceId.get(summary.internalId) ?? null
    const a4Context = a4ContextByInvoiceId.get(summary.internalId) ?? null
    const a5Context = a5ContextByInvoiceId.get(summary.internalId) ?? null
    const a6Context = a6ContextByInvoiceId.get(summary.internalId) ?? null
    const a7Context = a7ContextByInvoiceId.get(summary.internalId) ?? null
    const a8Context = a8ContextByInvoiceId.get(summary.internalId) ?? null
    const b1Context = b1ContextByInvoiceId.get(summary.internalId) ?? null
    const b2Context = b2ContextByInvoiceId.get(summary.internalId) ?? null
    const b3Context = b3ContextByInvoiceId.get(summary.internalId) ?? null
    const n1Context = n1ContextByInvoiceId.get(summary.internalId) ?? null
    result.set(
      summary.internalId,
      buildFacturaSituacion(
        candidatos,
        kContext,
        a4Context,
        a5Context,
        b1Context,
        n1Context,
        a6Context,
        a7Context,
        a8Context,
        b2Context,
        b3Context,
      ),
    )
  })

  return result
}

async function fetchCreditosAplicables(
  client: NetSuiteClient,
  summaryRows: FacturaOpenSummaryRow[],
) {
  const customerIds = uniqueValues(summaryRows.map((summary) => summary.customerId))

  if (customerIds.length === 0) {
    return [] as CreditoAplicableRow[]
  }

  const accountId = await resolveClientesAccountId(client)
  const deduped = new Map<string, CreditoAplicableRow>()

  for (const customerChunk of chunkValues(customerIds, CREDITOS_APLICABLES_CUSTOMER_CHUNK_SIZE)) {
    const query = buildCreditosAplicablesQuery(accountId, customerChunk)
    const rawRows = await fetchAllSuiteQlRows(client, query)

    rawRows.map(toCreditoAplicableRow).forEach((credito) => {
      const dedupeKey = [
        credito.transactionId,
        credito.customerId ?? '',
        credito.postingPeriodId ?? '',
        credito.currencyId ?? '',
        credito.availableAmount ?? credito.creditAmount ?? '',
      ].join('|')

      if (!deduped.has(dedupeKey)) {
        deduped.set(dedupeKey, credito)
      }
    })
  }

  return [...deduped.values()].sort(compareCreditoAplicableRows)
}

async function buildA4AndA5ContextByInvoiceId(
  client: NetSuiteClient,
  summaryRows: FacturaOpenSummaryRow[],
  creditos: CreditoAplicableRow[],
  candidatosByInvoiceId: Map<string, FacturaAplicacionCandidata[]>,
) {
  const a4ContextByInvoiceId = new Map<string, FacturaA4Context>()
  const a5ContextByInvoiceId = new Map<string, FacturaA4Context>()
  const eligibleRows = summaryRows.filter((summary) => {
    const targetAmount = getFacturaTargetAmount(summary)
    return Boolean(
      isFacturaPue(summary) &&
        summary.customerId &&
        summary.createdFromId &&
        summary.postingPeriodId &&
        summary.currencyId &&
        targetAmount !== null &&
        targetAmount > OPEN_AMOUNT_TOLERANCE,
    )
  })

  if (eligibleRows.length === 0) {
    return { a4ContextByInvoiceId, a5ContextByInvoiceId }
  }

  const rowsByGroupKey = new Map<string, FacturaOpenSummaryRow[]>()
  eligibleRows.forEach((summary) => {
    const groupKey = buildA4InvoiceGroupKey(summary)
    if (!groupKey) {
      return
    }

    const bucket = rowsByGroupKey.get(groupKey) ?? []
    bucket.push(summary)
    rowsByGroupKey.set(groupKey, bucket)
  })

  const salesOrderIds = uniqueValues(eligibleRows.map((summary) => summary.createdFromId))
  const salesOrdersById = await fetchA4SalesOrdersById(client, salesOrderIds)

  rowsByGroupKey.forEach((groupRows) => {
    if (groupRows.length === 0) {
      return
    }

    const [first] = groupRows
    if (!first.customerId || !first.createdFromId || !first.postingPeriodId || !first.currencyId) {
      return
    }

    const hasIndividualMatch = groupRows.some((summary) =>
      (candidatosByInvoiceId.get(summary.internalId) ?? []).some(
        (candidate) => candidate.cumpleA1 || candidate.cumpleA2 || candidate.cumpleA3,
      ),
    )
    if (hasIndividualMatch) {
      return
    }

    const groupTotal = groupRows.reduce((sum, summary) => sum + (getFacturaTargetAmount(summary) ?? 0), 0)
    const salesOrder = salesOrdersById.get(first.createdFromId)

    if (salesOrder) {
      if (salesOrder.customerId && salesOrder.customerId !== first.customerId) {
        return
      }

      if (!matchesByIdentity(first.currencyId, salesOrder.currencyId, first.currencyName, salesOrder.currencyName)) {
        return
      }

    }

    const sortedRows = [...groupRows].sort((left, right) =>
      (left.tranId ?? left.transactionNumber ?? left.internalId).localeCompare(
        right.tranId ?? right.transactionNumber ?? right.internalId,
        'es',
      ),
    )

    const matchingA4Credits = dedupeCreditosByTransaction(
      creditos.filter((credito) => {
        if (credito.customerId !== first.customerId) {
          return false
        }

        if (!matchesByIdentity(first.postingPeriodId, credito.postingPeriodId, first.postingPeriodName, credito.postingPeriodName)) {
          return false
        }

        if (!matchesByIdentity(first.currencyId, credito.currencyId, first.currencyName, credito.currencyName)) {
          return false
        }

        return amountsMatchExactly(credito.availableAmount, groupTotal)
      }),
    )

    if (
      groupRows.length >= 2 &&
      matchingA4Credits.length === 1 &&
      (!salesOrder || amountsMatchExactly(salesOrder.total, groupTotal))
    ) {
      const context = buildGroupedOrderContext('A4', first, sortedRows, salesOrder, matchingA4Credits[0], groupTotal)
      sortedRows.forEach((summary) => a4ContextByInvoiceId.set(summary.internalId, context))
      return
    }

    if (!salesOrder || salesOrder.total === null) {
      return
    }

    const matchingA5Credits = dedupeCreditosByTransaction(
      creditos.filter((credito) => {
        if (credito.customerId !== first.customerId) {
          return false
        }

        if (!matchesByIdentity(first.postingPeriodId, credito.postingPeriodId, first.postingPeriodName, credito.postingPeriodName)) {
          return false
        }

        if (!matchesByIdentity(first.currencyId, credito.currencyId, first.currencyName, credito.currencyName)) {
          return false
        }

        if (
          !amountMatchesA5SalesOrderTotal(
            credito.availableAmount,
            salesOrder.total,
            first.currencyId,
            first.currencyName,
          )
        ) {
          return false
        }

        return (credito.availableAmount ?? 0) - groupTotal > OPEN_AMOUNT_TOLERANCE
      }),
    )

    if (matchingA5Credits.length !== 1) {
      return
    }

    const context = buildGroupedOrderContext('A5', first, sortedRows, salesOrder, matchingA5Credits[0], groupTotal)
    sortedRows.forEach((summary) => a5ContextByInvoiceId.set(summary.internalId, context))
  })

  return { a4ContextByInvoiceId, a5ContextByInvoiceId }
}

async function buildA6ContextByInvoiceId(
  client: NetSuiteClient,
  summaryRows: FacturaOpenSummaryRow[],
  creditos: CreditoAplicableRow[],
  candidatosByInvoiceId: Map<string, FacturaAplicacionCandidata[]>,
) {
  const result = new Map<string, FacturaA4Context>()
  const eligibleRows = summaryRows.filter((summary) => {
    const targetAmount = getFacturaTargetAmount(summary)
    return Boolean(
      isFacturaPue(summary) &&
        summary.customerId &&
        summary.createdFromId &&
        summary.postingPeriodId &&
        summary.currencyId &&
        targetAmount !== null &&
        targetAmount > OPEN_AMOUNT_TOLERANCE,
    )
  })

  if (eligibleRows.length === 0) {
    return result
  }

  const salesOrderIds = uniqueValues(eligibleRows.map((summary) => summary.createdFromId))
  const salesOrdersById = await fetchA4SalesOrdersById(client, salesOrderIds)
  const pueRowsByBucket = new Map<string, FacturaOpenSummaryRow[]>()

  eligibleRows.forEach((summary) => {
    const bucketKey = buildA6EligibilityBucketKey(summary)
    if (!bucketKey) {
      return
    }

    const bucket = pueRowsByBucket.get(bucketKey) ?? []
    bucket.push(summary)
    pueRowsByBucket.set(bucketKey, bucket)
  })

  eligibleRows.forEach((summary) => {
    const targetAmount = getFacturaTargetAmount(summary)
    if (
      !summary.customerId ||
      !summary.createdFromId ||
      !summary.postingPeriodId ||
      !summary.currencyId ||
      targetAmount === null ||
      targetAmount <= OPEN_AMOUNT_TOLERANCE
    ) {
      return
    }

    const bucketKey = buildA6EligibilityBucketKey(summary)
    const sameBucketRows = bucketKey ? (pueRowsByBucket.get(bucketKey) ?? []) : []
    if (sameBucketRows.length !== 1 || sameBucketRows[0]?.internalId !== summary.internalId) {
      return
    }

    const salesOrder = salesOrdersById.get(summary.createdFromId)
    if (!salesOrder || !amountsMatchExactly(salesOrder.total, targetAmount)) {
      return
    }

    if (salesOrder.customerId && salesOrder.customerId !== summary.customerId) {
      return
    }

    if (!matchesByIdentity(summary.currencyId, salesOrder.currencyId, summary.currencyName, salesOrder.currencyName)) {
      return
    }

    const candidatos = candidatosByInvoiceId.get(summary.internalId) ?? []
    if (candidatos.some((candidate) => candidate.cumpleA1 || candidate.cumpleA2 || candidate.cumpleA3)) {
      return
    }

    const coveringJournalCredits = dedupeCreditosByTransaction(
      creditos.filter((credito) => {
        if (credito.customerId !== summary.customerId) {
          return false
        }

        if (credito.transactionType !== 'Journal') {
          return false
        }

        if (
          !matchesByIdentity(
            summary.postingPeriodId,
            credito.postingPeriodId,
            summary.postingPeriodName,
            credito.postingPeriodName,
          )
        ) {
          return false
        }

        if (!matchesByIdentity(summary.currencyId, credito.currencyId, summary.currencyName, credito.currencyName)) {
          return false
        }

        return (credito.availableAmount ?? 0) - targetAmount > OPEN_AMOUNT_TOLERANCE
      }),
    )

    if (coveringJournalCredits.length !== 1) {
      return
    }

    result.set(
      summary.internalId,
      buildGroupedOrderContext('A6', summary, [summary], salesOrder, coveringJournalCredits[0], targetAmount),
    )
  })

  return result
}

async function buildA7ContextByInvoiceId(
  summaryRows: FacturaOpenSummaryRow[],
  creditos: CreditoAplicableRow[],
  candidatosByInvoiceId: Map<string, FacturaAplicacionCandidata[]>,
) {
  const result = new Map<string, FacturaA4Context>()
  const eligibleRows = summaryRows.filter((summary) => {
    const targetAmount = getFacturaTargetAmount(summary)
    return Boolean(
      isFacturaPue(summary) &&
        isMxnCurrency(summary.currencyId, summary.currencyName) &&
        summary.customerId &&
        summary.postingPeriodId &&
        summary.currencyId &&
        targetAmount !== null &&
        targetAmount > OPEN_AMOUNT_TOLERANCE,
    )
  })

  if (eligibleRows.length === 0) {
    return result
  }

  const pueRowsByBucket = new Map<string, FacturaOpenSummaryRow[]>()

  eligibleRows.forEach((summary) => {
    const bucketKey = buildA6EligibilityBucketKey(summary)
    if (!bucketKey) {
      return
    }

    const bucket = pueRowsByBucket.get(bucketKey) ?? []
    bucket.push(summary)
    pueRowsByBucket.set(bucketKey, bucket)
  })

  pueRowsByBucket.forEach((bucketRows) => {
    if (bucketRows.length < 2) {
      return
    }

    const [first] = bucketRows
    if (!first.customerId || !first.postingPeriodId || !first.currencyId) {
      return
    }

    const hasIndividualMatch = bucketRows.some((summary) =>
      (candidatosByInvoiceId.get(summary.internalId) ?? []).some(
        (candidate) => candidate.cumpleA1 || candidate.cumpleA2 || candidate.cumpleA3,
      ),
    )
    if (hasIndividualMatch) {
      return
    }

    const samePeriodCredits = dedupeCreditosByTransaction(
      creditos.filter((credito) => {
        if (credito.customerId !== first.customerId) {
          return false
        }

        if (
          !matchesByIdentity(
            first.postingPeriodId,
            credito.postingPeriodId,
            first.postingPeriodName,
            credito.postingPeriodName,
          )
        ) {
          return false
        }

        return matchesByIdentity(first.currencyId, credito.currencyId, first.currencyName, credito.currencyName)
      }),
    )

    if (samePeriodCredits.length === 0 || samePeriodCredits.some((credito) => credito.transactionType !== 'Journal')) {
      return
    }

    const sortedRows = [...bucketRows].sort((left, right) =>
      (left.tranId ?? left.transactionNumber ?? left.internalId).localeCompare(
        right.tranId ?? right.transactionNumber ?? right.internalId,
        'es',
      ),
    )
    const groupTotal = sortedRows.reduce((sum, summary) => sum + (getFacturaTargetAmount(summary) ?? 0), 0)
    const coveringJournalCredits = samePeriodCredits.filter(
      (credito) => (credito.availableAmount ?? 0) - groupTotal > OPEN_AMOUNT_TOLERANCE,
    )

    if (coveringJournalCredits.length !== 1) {
      return
    }

    const context = buildGroupedCustomerPeriodContext(
      'A7',
      first,
      sortedRows,
      coveringJournalCredits[0],
      groupTotal,
    )
    sortedRows.forEach((summary) => result.set(summary.internalId, context))
  })

  return result
}

async function buildA8ContextByInvoiceId(
  summaryRows: FacturaOpenSummaryRow[],
  creditos: CreditoAplicableRow[],
  candidatosByInvoiceId: Map<string, FacturaAplicacionCandidata[]>,
  excludedInvoiceIds: Set<string>,
) {
  const result = new Map<string, FacturaA8Context>()
  const eligibleRows = summaryRows.filter((summary) => {
    const targetAmount = getFacturaTargetAmount(summary)
    return Boolean(
      isFacturaPue(summary) &&
        isMxnCurrency(summary.currencyId, summary.currencyName) &&
        summary.customerId &&
        summary.postingPeriodId &&
        summary.currencyId &&
        !excludedInvoiceIds.has(summary.internalId) &&
        targetAmount !== null &&
        targetAmount > OPEN_AMOUNT_TOLERANCE,
    )
  })

  if (eligibleRows.length === 0) {
    return result
  }

  const pueRowsByBucket = new Map<string, FacturaOpenSummaryRow[]>()

  eligibleRows.forEach((summary) => {
    const bucketKey = buildA6EligibilityBucketKey(summary)
    if (!bucketKey) {
      return
    }

    const bucket = pueRowsByBucket.get(bucketKey) ?? []
    bucket.push(summary)
    pueRowsByBucket.set(bucketKey, bucket)
  })

  pueRowsByBucket.forEach((bucketRows) => {
    if (bucketRows.length === 0) {
      return
    }

    const [first] = bucketRows
    if (!first.customerId || !first.postingPeriodId || !first.currencyId) {
      return
    }

    const hasIndividualMatch = bucketRows.some((summary) =>
      (candidatosByInvoiceId.get(summary.internalId) ?? []).some(
        (candidate) => candidate.cumpleA1 || candidate.cumpleA2 || candidate.cumpleA3,
      ),
    )
    if (hasIndividualMatch) {
      return
    }

    const supportedCredits = dedupeCreditosByTransaction(
      creditos.filter((credito) => {
        if (credito.customerId !== first.customerId) {
          return false
        }

        if (
          !matchesByIdentity(
            first.postingPeriodId,
            credito.postingPeriodId,
            first.postingPeriodName,
            credito.postingPeriodName,
          )
        ) {
          return false
        }

        if (!matchesByIdentity(first.currencyId, credito.currencyId, first.currencyName, credito.currencyName)) {
          return false
        }

        return A8_SUPPORTED_CREDIT_TYPES.has(credito.transactionType ?? '')
      }),
    )

    if (supportedCredits.length === 0) {
      return
    }

    const sortedRows = [...bucketRows].sort((left, right) => {
      const leftAmount = getFacturaTargetAmount(left) ?? 0
      const rightAmount = getFacturaTargetAmount(right) ?? 0
      if (leftAmount !== rightAmount) {
        return rightAmount - leftAmount
      }

      return (left.tranId ?? left.transactionNumber ?? left.internalId).localeCompare(
        right.tranId ?? right.transactionNumber ?? right.internalId,
        'es',
      )
    })
    const assignments = assignA8CreditsToInvoices(sortedRows, supportedCredits)
    if (!assignments) {
      return
    }

    const groupTotal = sortedRows.reduce((sum, summary) => sum + (getFacturaTargetAmount(summary) ?? 0), 0)

    sortedRows.forEach((summary) => {
      const assignment = assignments.get(summary.internalId)
      if (!assignment) {
        return
      }

      result.set(
        summary.internalId,
        buildA8Context(
          first,
          sortedRows,
          groupTotal,
          assignment.credit,
          assignment.remainingAfterInvoice,
        ),
      )
    })
  })

  return result
}

async function buildB1ContextByInvoiceId(
  summaryRows: FacturaOpenSummaryRow[],
  creditos: CreditoAplicableRow[],
  candidatosByInvoiceId: Map<string, FacturaAplicacionCandidata[]>,
) {
  const result = new Map<string, FacturaB1Context>()

  summaryRows.forEach((summary) => {
    const targetAmount = getFacturaTargetAmount(summary)
    if (
      !isFacturaPue(summary) ||
      !summary.customerId ||
      !summary.postingPeriodId ||
      !summary.currencyId ||
      targetAmount === null ||
      targetAmount <= OPEN_AMOUNT_TOLERANCE
    ) {
      return
    }

    const candidatos = candidatosByInvoiceId.get(summary.internalId) ?? []
    if (candidatos.some((candidate) => candidate.cumpleA1 || candidate.cumpleA2 || candidate.cumpleA3)) {
      return
    }

    const exactCrossPeriodCredits = dedupeCreditosByTransaction(
      creditos.filter((credito) => {
        if (credito.customerId !== summary.customerId) {
          return false
        }

        if (credito.transactionType !== 'Journal') {
          return false
        }

        if (!matchesByIdentity(summary.currencyId, credito.currencyId, summary.currencyName, credito.currencyName)) {
          return false
        }

        if (!amountsMatchExactly(targetAmount, credito.availableAmount)) {
          return false
        }

        if (
          matchesByIdentity(
            summary.postingPeriodId,
            credito.postingPeriodId,
            summary.postingPeriodName,
            credito.postingPeriodName,
          )
        ) {
          return false
        }

        return isCrossPeriodCreditEarlier(summary, credito)
      }),
    )

    if (exactCrossPeriodCredits.length !== 1) {
      return
    }

    const [credit] = exactCrossPeriodCredits
    result.set(summary.internalId, {
      customerId: summary.customerId,
      customerName: summary.customerName,
      invoicePeriodId: summary.postingPeriodId,
      invoicePeriodName: summary.postingPeriodName,
      currencyId: summary.currencyId,
      currencyName: summary.currencyName,
      targetAmount,
      bridgeBankAccountId: null,
      bridgeBankAccountName: B1_BRIDGE_BANK_ACCOUNT_DISPLAY_NAME,
      originalCreditTransactionId: credit.transactionId,
      originalCreditDocument: credit.tranId,
      originalCreditType: credit.transactionType,
      originalCreditDate: parseNetSuiteDate(credit.transactionDate),
      originalCreditPeriodId: credit.postingPeriodId,
      originalCreditPeriodName: credit.postingPeriodName,
      originalCreditAmount: credit.creditAmount,
      originalCreditAppliedAmount: credit.appliedAmount,
      originalCreditAvailableAmount: credit.availableAmount,
    })
  })

  return result
}

async function buildB2ContextByInvoiceId(
  summaryRows: FacturaOpenSummaryRow[],
  creditos: CreditoAplicableRow[],
  candidatosByInvoiceId: Map<string, FacturaAplicacionCandidata[]>,
) {
  const result = new Map<string, FacturaB1Context>()

  summaryRows.forEach((summary) => {
    const targetAmount = getFacturaTargetAmount(summary)
    if (
      !isFacturaPue(summary) ||
      !isMxnCurrency(summary.currencyId, summary.currencyName) ||
      !summary.customerId ||
      !summary.postingPeriodId ||
      !summary.currencyId ||
      targetAmount === null ||
      targetAmount <= OPEN_AMOUNT_TOLERANCE
    ) {
      return
    }

    const sameBucketOpenPueInvoices = summaryRows.filter(
      (candidateSummary) =>
        candidateSummary.internalId !== summary.internalId &&
        isFacturaPue(candidateSummary) &&
        candidateSummary.customerId === summary.customerId &&
        matchesByIdentity(
          summary.postingPeriodId,
          candidateSummary.postingPeriodId,
          summary.postingPeriodName,
          candidateSummary.postingPeriodName,
        ) &&
        matchesByIdentity(summary.currencyId, candidateSummary.currencyId, summary.currencyName, candidateSummary.currencyName) &&
        (getFacturaTargetAmount(candidateSummary) ?? 0) > OPEN_AMOUNT_TOLERANCE,
    )
    if (sameBucketOpenPueInvoices.length > 0) {
      return
    }

    const candidatos = candidatosByInvoiceId.get(summary.internalId) ?? []
    if (candidatos.some((candidate) => candidate.cumpleA1 || candidate.cumpleA2 || candidate.cumpleA3)) {
      return
    }

    const samePeriodCoveringCredits = dedupeCreditosByTransaction(
      creditos.filter((credito) => {
        if (credito.customerId !== summary.customerId) {
          return false
        }

        if (credito.transactionType !== 'Journal') {
          return false
        }

        if (!matchesByIdentity(summary.currencyId, credito.currencyId, summary.currencyName, credito.currencyName)) {
          return false
        }

        if (
          !matchesByIdentity(
            summary.postingPeriodId,
            credito.postingPeriodId,
            summary.postingPeriodName,
            credito.postingPeriodName,
          )
        ) {
          return false
        }

        return (credito.availableAmount ?? 0) + OPEN_AMOUNT_TOLERANCE >= targetAmount
      }),
    )
    if (samePeriodCoveringCredits.length > 0) {
      return
    }

    const largerCrossPeriodCredits = dedupeCreditosByTransaction(
      creditos.filter((credito) => {
        if (credito.customerId !== summary.customerId) {
          return false
        }

        if (credito.transactionType !== 'Journal') {
          return false
        }

        if (!matchesByIdentity(summary.currencyId, credito.currencyId, summary.currencyName, credito.currencyName)) {
          return false
        }

        if ((credito.availableAmount ?? 0) - targetAmount <= OPEN_AMOUNT_TOLERANCE) {
          return false
        }

        if (
          matchesByIdentity(
            summary.postingPeriodId,
            credito.postingPeriodId,
            summary.postingPeriodName,
            credito.postingPeriodName,
          )
        ) {
          return false
        }

        return isCrossPeriodCreditEarlier(summary, credito)
      }),
    )

    if (largerCrossPeriodCredits.length !== 1) {
      return
    }

    const [credit] = largerCrossPeriodCredits
    result.set(summary.internalId, {
      customerId: summary.customerId,
      customerName: summary.customerName,
      invoicePeriodId: summary.postingPeriodId,
      invoicePeriodName: summary.postingPeriodName,
      currencyId: summary.currencyId,
      currencyName: summary.currencyName,
      targetAmount,
      bridgeBankAccountId: null,
      bridgeBankAccountName: B1_BRIDGE_BANK_ACCOUNT_DISPLAY_NAME,
      originalCreditTransactionId: credit.transactionId,
      originalCreditDocument: credit.tranId,
      originalCreditType: credit.transactionType,
      originalCreditDate: parseNetSuiteDate(credit.transactionDate),
      originalCreditPeriodId: credit.postingPeriodId,
      originalCreditPeriodName: credit.postingPeriodName,
      originalCreditAmount: credit.creditAmount,
      originalCreditAppliedAmount: credit.appliedAmount,
      originalCreditAvailableAmount: credit.availableAmount,
    })
  })

  return result
}

async function buildB3ContextByInvoiceId(
  client: NetSuiteClient,
  summaryRows: FacturaOpenSummaryRow[],
  creditos: CreditoAplicableRow[],
  candidatosByInvoiceId: Map<string, FacturaAplicacionCandidata[]>,
  excludedInvoiceIds: Set<string>,
) {
  const result = new Map<string, FacturaB3Context>()
  const eligibleRows = summaryRows.filter((summary) => {
    const targetAmount = getFacturaTargetAmount(summary)
    return Boolean(
      isFacturaPue(summary) &&
        isMxnCurrency(summary.currencyId, summary.currencyName) &&
        summary.customerId &&
        summary.createdFromId &&
        summary.postingPeriodId &&
        summary.currencyId &&
        !excludedInvoiceIds.has(summary.internalId) &&
        targetAmount !== null &&
        targetAmount > OPEN_AMOUNT_TOLERANCE,
    )
  })

  if (eligibleRows.length === 0) {
    return result
  }

  const rowsByGroupKey = new Map<string, FacturaOpenSummaryRow[]>()
  eligibleRows.forEach((summary) => {
    const groupKey = buildA4InvoiceGroupKey(summary)
    if (!groupKey) {
      return
    }

    const bucket = rowsByGroupKey.get(groupKey) ?? []
    bucket.push(summary)
    rowsByGroupKey.set(groupKey, bucket)
  })

  const allOpenOrderRows = new Map<string, FacturaOpenSummaryRow[]>()
  summaryRows.forEach((summary) => {
    const targetAmount = getFacturaTargetAmount(summary)
    const orderKey = buildB3OrderOpenKey(summary)
    if (!orderKey || !isFacturaPue(summary) || targetAmount === null || targetAmount <= OPEN_AMOUNT_TOLERANCE) {
      return
    }

    const bucket = allOpenOrderRows.get(orderKey) ?? []
    bucket.push(summary)
    allOpenOrderRows.set(orderKey, bucket)
  })

  const salesOrderIds = uniqueValues(eligibleRows.map((summary) => summary.createdFromId))
  const salesOrdersById = await fetchA4SalesOrdersById(client, salesOrderIds)

  rowsByGroupKey.forEach((groupRows) => {
    if (groupRows.length < 2) {
      return
    }

    const [first] = groupRows
    const orderKey = buildB3OrderOpenKey(first)
    if (!first.customerId || !first.createdFromId || !first.postingPeriodId || !first.currencyId || !orderKey) {
      return
    }

    const candidatosContainIndividualMatch = groupRows.some((summary) =>
      (candidatosByInvoiceId.get(summary.internalId) ?? []).some(
        (candidate) => candidate.cumpleA1 || candidate.cumpleA2 || candidate.cumpleA3,
      ),
    )
    if (candidatosContainIndividualMatch) {
      return
    }

    const orderOpenRows = allOpenOrderRows.get(orderKey) ?? []
    if (orderOpenRows.length !== groupRows.length) {
      return
    }

    const salesOrder = salesOrdersById.get(first.createdFromId)
    if (!salesOrder || salesOrder.total === null) {
      return
    }

    if (salesOrder.customerId && salesOrder.customerId !== first.customerId) {
      return
    }

    if (!matchesByIdentity(first.currencyId, salesOrder.currencyId, first.currencyName, salesOrder.currencyName)) {
      return
    }

    const groupTotal = groupRows.reduce((sum, summary) => sum + (getFacturaTargetAmount(summary) ?? 0), 0)
    const matchingCredits = dedupeCreditosByTransaction(
      creditos.filter((credito) => {
        if (credito.customerId !== first.customerId) {
          return false
        }

        if (credito.transactionType !== 'Journal') {
          return false
        }

        if (!matchesByIdentity(first.currencyId, credito.currencyId, first.currencyName, credito.currencyName)) {
          return false
        }

        if (
          matchesByIdentity(
            first.postingPeriodId,
            credito.postingPeriodId,
            first.postingPeriodName,
            credito.postingPeriodName,
          )
        ) {
          return false
        }

        if (!isCrossPeriodCreditEarlier(first, credito)) {
          return false
        }

        if (!amountsMatchExactly(credito.creditAmount, salesOrder.total)) {
          return false
        }

        return amountsMatchExactly(credito.availableAmount, groupTotal)
      }),
    )

    if (matchingCredits.length !== 1) {
      return
    }

    const sortedRows = [...groupRows].sort((left, right) => {
      const leftDate = getComparableDateValue(left.transactionDate)
      const rightDate = getComparableDateValue(right.transactionDate)
      if (leftDate !== rightDate) {
        return leftDate - rightDate
      }

      return (left.tranId ?? left.transactionNumber ?? left.internalId).localeCompare(
        right.tranId ?? right.transactionNumber ?? right.internalId,
        'es',
      )
    })

    const context = buildB3Context(first, sortedRows, salesOrder, matchingCredits[0], groupTotal)
    sortedRows.forEach((summary) => result.set(summary.internalId, context))
  })

  return result
}

function buildGroupedOrderContext(
  ruleCode: 'A4' | 'A5' | 'A6',
  first: FacturaOpenSummaryRow,
  sortedRows: FacturaOpenSummaryRow[],
  salesOrder: A4SalesOrderRow | undefined,
  credit: CreditoAplicableRow,
  groupTotal: number,
): FacturaA4Context {
  return {
    groupKey: [
      ruleCode,
      first.customerId,
      first.createdFromId,
      first.postingPeriodId,
      first.currencyId,
      credit.transactionId,
      sortedRows.map((summary) => summary.internalId).join(','),
    ].join('|'),
    salesOrderInternalId: first.createdFromId ?? '',
    salesOrderDocument: first.createdFromName ?? salesOrder?.tranId ?? null,
    salesOrderTotal: salesOrder?.total ?? null,
    customerId: first.customerId ?? '',
    customerName: first.customerName,
    postingPeriodId: first.postingPeriodId ?? '',
    postingPeriodName: first.postingPeriodName,
    currencyId: first.currencyId ?? '',
    currencyName: first.currencyName,
    groupTotal,
    invoiceCount: sortedRows.length,
    invoices: sortedRows.map((summary) => ({
      internalId: summary.internalId,
      documento: summary.tranId ?? summary.transactionNumber,
      fecha: parseNetSuiteDate(summary.transactionDate),
      total: summary.total,
      saldoAbierto: summary.amountRemaining,
    })),
    creditTransactionId: credit.transactionId,
    creditDocument: credit.tranId,
    creditType: credit.transactionType,
    creditDate: parseNetSuiteDate(credit.transactionDate),
    creditPeriodId: credit.postingPeriodId,
    creditPeriodName: credit.postingPeriodName,
    creditAmount: credit.creditAmount,
    creditAvailableAmount: credit.availableAmount,
    creditRemainingAfterGroup:
      credit.availableAmount === null ? null : Math.max(0, credit.availableAmount - groupTotal),
  }
}

function buildB3Context(
  first: FacturaOpenSummaryRow,
  sortedRows: FacturaOpenSummaryRow[],
  salesOrder: A4SalesOrderRow,
  credit: CreditoAplicableRow,
  groupTotal: number,
): FacturaB3Context {
  return {
    groupKey: [
      'B3',
      first.customerId,
      first.createdFromId,
      first.postingPeriodId,
      first.currencyId,
      credit.transactionId,
      sortedRows.map((summary) => summary.internalId).join(','),
    ].join('|'),
    salesOrderInternalId: first.createdFromId ?? '',
    salesOrderDocument: first.createdFromName ?? salesOrder.tranId ?? null,
    salesOrderTotal: salesOrder.total,
    customerId: first.customerId ?? '',
    customerName: first.customerName,
    invoicePeriodId: first.postingPeriodId ?? '',
    invoicePeriodName: first.postingPeriodName,
    currencyId: first.currencyId ?? '',
    currencyName: first.currencyName,
    groupTotal,
    invoiceCount: sortedRows.length,
    invoices: sortedRows.map((summary) => ({
      internalId: summary.internalId,
      documento: summary.tranId ?? summary.transactionNumber,
      fecha: parseNetSuiteDate(summary.transactionDate),
      total: summary.total,
      saldoAbierto: summary.amountRemaining,
    })),
    bridgeBankAccountId: null,
    bridgeBankAccountName: B1_BRIDGE_BANK_ACCOUNT_DISPLAY_NAME,
    originalCreditTransactionId: credit.transactionId,
    originalCreditDocument: credit.tranId,
    originalCreditType: credit.transactionType,
    originalCreditDate: parseNetSuiteDate(credit.transactionDate),
    originalCreditPeriodId: credit.postingPeriodId,
    originalCreditPeriodName: credit.postingPeriodName,
    originalCreditAmount: credit.creditAmount,
    originalCreditAppliedAmount: credit.appliedAmount,
    originalCreditAvailableAmount: credit.availableAmount,
    originalCreditRemainingAfterGroup:
      credit.availableAmount === null ? null : Math.max(0, credit.availableAmount - groupTotal),
  }
}

function buildGroupedCustomerPeriodContext(
  ruleCode: 'A7',
  first: FacturaOpenSummaryRow,
  sortedRows: FacturaOpenSummaryRow[],
  credit: CreditoAplicableRow,
  groupTotal: number,
): FacturaA4Context {
  return {
    groupKey: [
      ruleCode,
      first.customerId,
      first.postingPeriodId,
      first.currencyId,
      credit.transactionId,
      sortedRows.map((summary) => summary.internalId).join(','),
    ].join('|'),
    salesOrderInternalId: '',
    salesOrderDocument: [first.customerName, first.postingPeriodName].filter(Boolean).join(' / ') || null,
    salesOrderTotal: null,
    customerId: first.customerId ?? '',
    customerName: first.customerName,
    postingPeriodId: first.postingPeriodId ?? '',
    postingPeriodName: first.postingPeriodName,
    currencyId: first.currencyId ?? '',
    currencyName: first.currencyName,
    groupTotal,
    invoiceCount: sortedRows.length,
    invoices: sortedRows.map((summary) => ({
      internalId: summary.internalId,
      documento: summary.tranId ?? summary.transactionNumber,
      fecha: parseNetSuiteDate(summary.transactionDate),
      total: summary.total,
      saldoAbierto: summary.amountRemaining,
    })),
    creditTransactionId: credit.transactionId,
    creditDocument: credit.tranId,
    creditType: credit.transactionType,
    creditDate: parseNetSuiteDate(credit.transactionDate),
    creditPeriodId: credit.postingPeriodId,
    creditPeriodName: credit.postingPeriodName,
    creditAmount: credit.creditAmount,
    creditAvailableAmount: credit.availableAmount,
    creditRemainingAfterGroup:
      credit.availableAmount === null ? null : Math.max(0, credit.availableAmount - groupTotal),
  }
}

function buildA8Context(
  first: FacturaOpenSummaryRow,
  sortedRows: FacturaOpenSummaryRow[],
  groupTotal: number,
  credit: CreditoAplicableRow,
  remainingAfterInvoice: number | null,
): FacturaA8Context {
  return {
    bucketKey: [
      'A8',
      first.customerId,
      first.postingPeriodId,
      first.currencyId,
      sortedRows.map((summary) => summary.internalId).join(','),
    ].join('|'),
    customerId: first.customerId ?? '',
    customerName: first.customerName,
    postingPeriodId: first.postingPeriodId ?? '',
    postingPeriodName: first.postingPeriodName,
    currencyId: first.currencyId ?? '',
    currencyName: first.currencyName,
    groupTotal,
    invoiceCount: sortedRows.length,
    invoices: sortedRows.map((summary) => ({
      internalId: summary.internalId,
      documento: summary.tranId ?? summary.transactionNumber,
      fecha: parseNetSuiteDate(summary.transactionDate),
      total: summary.total,
      saldoAbierto: summary.amountRemaining,
    })),
    creditTransactionId: credit.transactionId,
    creditDocument: credit.tranId,
    creditType: credit.transactionType,
    creditDate: parseNetSuiteDate(credit.transactionDate),
    creditPeriodId: credit.postingPeriodId,
    creditPeriodName: credit.postingPeriodName,
    creditAmount: credit.creditAmount,
    creditAvailableAmount: credit.availableAmount,
    creditRemainingAfterInvoice: remainingAfterInvoice,
  }
}

function assignA8CreditsToInvoices(
  sortedRows: FacturaOpenSummaryRow[],
  supportedCredits: CreditoAplicableRow[],
) {
  const creditStates = supportedCredits.map((credit) => ({
    credit,
    remaining: credit.availableAmount ?? 0,
  }))
  const assignments = new Map<
    string,
    {
      credit: CreditoAplicableRow
      remainingAfterInvoice: number | null
    }
  >()

  function creditTypeRank(transactionType: string | null) {
    if (transactionType === 'CustCred') {
      return 0
    }

    if (transactionType === 'Journal') {
      return 1
    }

    return 2
  }

  function assignAt(index: number): boolean {
    if (index >= sortedRows.length) {
      return true
    }

    const summary = sortedRows[index]
    const amount = getFacturaTargetAmount(summary)
    if (amount === null || amount <= OPEN_AMOUNT_TOLERANCE) {
      return false
    }

    const candidates = creditStates
      .filter((state) => state.remaining + OPEN_AMOUNT_TOLERANCE >= amount)
      .sort((left, right) => {
        const leftRemainder = left.remaining - amount
        const rightRemainder = right.remaining - amount
        if (leftRemainder !== rightRemainder) {
          return leftRemainder - rightRemainder
        }

        const leftRank = creditTypeRank(left.credit.transactionType)
        const rightRank = creditTypeRank(right.credit.transactionType)
        if (leftRank !== rightRank) {
          return leftRank - rightRank
        }

        return (left.credit.tranId ?? left.credit.transactionId).localeCompare(
          right.credit.tranId ?? right.credit.transactionId,
          'es',
        )
      })

    for (const state of candidates) {
      state.remaining -= amount
      assignments.set(summary.internalId, {
        credit: state.credit,
        remainingAfterInvoice: Math.max(0, state.remaining),
      })

      if (assignAt(index + 1)) {
        return true
      }

      assignments.delete(summary.internalId)
      state.remaining += amount
    }

    return false
  }

  return assignAt(0) ? assignments : null
}

function buildA4InvoiceGroupKey(summary: FacturaOpenSummaryRow) {
  if (!summary.customerId || !summary.createdFromId || !summary.postingPeriodId || !summary.currencyId) {
    return null
  }

  return [
    summary.customerId,
    summary.createdFromId,
    summary.postingPeriodId,
    summary.currencyId,
  ].join('|')
}

function buildB3OrderOpenKey(summary: FacturaOpenSummaryRow) {
  if (!summary.customerId || !summary.createdFromId || !summary.currencyId) {
    return null
  }

  return [summary.customerId, summary.createdFromId, summary.currencyId].join('|')
}

function buildA6EligibilityBucketKey(summary: FacturaOpenSummaryRow) {
  if (!summary.customerId || !summary.postingPeriodId || !summary.currencyId) {
    return null
  }

  return [summary.customerId, summary.postingPeriodId, summary.currencyId].join('|')
}

function dedupeCreditosByTransaction(creditos: CreditoAplicableRow[]) {
  const byTransactionId = new Map<string, CreditoAplicableRow>()
  creditos.forEach((credito) => {
    if (credito.transactionId && !byTransactionId.has(credito.transactionId)) {
      byTransactionId.set(credito.transactionId, credito)
    }
  })
  return [...byTransactionId.values()]
}

async function fetchA4SalesOrdersById(client: NetSuiteClient, salesOrderIds: string[]) {
  const result = new Map<string, A4SalesOrderRow>()
  if (salesOrderIds.length === 0) {
    return result
  }

  for (const salesOrderChunk of chunkValues(salesOrderIds, SUITEQL_IN_CHUNK_SIZE)) {
    const query = `
SELECT
  transaction.id AS internalId,
  transaction.tranid AS tranId,
  transaction.entity AS customerId,
  BUILTIN.DF(transaction.entity) AS customerName,
  transaction.currency AS currencyId,
  BUILTIN.DF(transaction.currency) AS currencyName,
  transaction.foreigntotal AS total
FROM transaction
WHERE transaction.id IN (${joinSuiteQlLiterals(salesOrderChunk)})
    `.trim()
    const rows = (await fetchAllSuiteQlRows(client, query)).map(toA4SalesOrderRow)
    rows.forEach((row) => result.set(row.internalId, row))
  }

  return result
}

async function fetchSalesOrderInvoiceAuditRows(client: NetSuiteClient, salesOrderId: string) {
  const query = `
SELECT
  transaction.id AS internalId,
  transaction.tranid AS tranId,
  transaction.trandate AS transactionDate,
  BUILTIN.DF(transaction.status) AS statusName,
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
  AND mainLine.createdfrom = ${formatSuiteQlLiteral(salesOrderId)}
GROUP BY
  transaction.id,
  transaction.tranid,
  transaction.trandate,
  BUILTIN.DF(transaction.status),
  transaction.foreigntotal
ORDER BY transaction.trandate ASC, transaction.id ASC
  `.trim()

  return (await fetchAllSuiteQlRows(client, query)).map(toSalesOrderInvoiceAuditRow)
}

async function resolveClientesAccountId(client: NetSuiteClient) {
  if (clientesAccountIdCache) {
    return clientesAccountIdCache
  }

  const query = `
SELECT
  account.id AS internalId,
  account.displaynamewithhierarchy AS displayName
FROM account
WHERE account.acctnumber = ${formatSuiteQlTextLiteral(CLIENTES_ACCOUNT_NUMBER)}
  `.trim()

  const rows = (await fetchAllSuiteQlRows(client, query)).map(toClientesAccountRow)
  const exactMatch =
    rows.find((row) => row.displayName === CLIENTES_ACCOUNT_DISPLAY_NAME) ?? rows[0]

  if (!exactMatch?.internalId) {
    throw new Error(
      `Unable to resolve the NetSuite A/R account ${CLIENTES_ACCOUNT_DISPLAY_NAME}.`,
    )
  }

  clientesAccountIdCache = exactMatch.internalId
  return clientesAccountIdCache
}

async function resolveB1BridgeBankAccountId(client: NetSuiteClient) {
  if (b1BridgeBankAccountIdCache) {
    return b1BridgeBankAccountIdCache
  }

  const query = `
SELECT
  account.id AS internalId,
  account.displaynamewithhierarchy AS displayName
FROM account
WHERE account.acctnumber = ${formatSuiteQlTextLiteral(B1_BRIDGE_BANK_ACCOUNT_NUMBER)}
  `.trim()

  const rows = (await fetchAllSuiteQlRows(client, query)).map(toClientesAccountRow)
  const exactMatch =
    rows.find((row) => row.displayName === B1_BRIDGE_BANK_ACCOUNT_DISPLAY_NAME) ?? rows[0]

  if (!exactMatch?.internalId) {
    throw new Error(
      `Unable to resolve the NetSuite bridge bank account ${B1_BRIDGE_BANK_ACCOUNT_DISPLAY_NAME}.`,
    )
  }

  b1BridgeBankAccountIdCache = exactMatch.internalId
  return b1BridgeBankAccountIdCache
}

async function resolveRoundingAccountId(client: NetSuiteClient) {
  if (roundingAccountIdCache) {
    return roundingAccountIdCache
  }

  const query = `
SELECT
  account.id AS internalId,
  account.displaynamewithhierarchy AS displayName
FROM account
WHERE LOWER(account.displaynamewithhierarchy) LIKE ${formatSuiteQlLiteral('%redondeo%')}
  `.trim()

  const rows = (await fetchAllSuiteQlRows(client, query)).map(toClientesAccountRow)
  const exactMatch =
    rows.find((row) => row.displayName === ROUNDING_ACCOUNT_DISPLAY_NAME) ?? rows[0]

  if (!exactMatch?.internalId) {
    throw new Error(
      `Unable to resolve the NetSuite rounding account ${ROUNDING_ACCOUNT_DISPLAY_NAME}.`,
    )
  }

  roundingAccountIdCache = exactMatch.internalId
  return roundingAccountIdCache
}

function buildFacturasAbiertasQuery() {
  return `
SELECT
  transaction.id AS internalId,
  transaction.tranid AS tranId,
  transaction.transactionnumber AS transactionNumber,
  transaction.trandate AS transactionDate,
  transaction.duedate AS dueDate,
  mainLine.createdfrom AS createdFromId,
  BUILTIN.DF(mainLine.createdfrom) AS createdFromName,
  transaction.entity AS customerId,
  BUILTIN.DF(transaction.entity) AS customerName,
  transaction.postingperiod AS postingPeriodId,
  BUILTIN.DF(transaction.postingperiod) AS postingPeriodName,
  transaction.custbody_mx_txn_sat_payment_term AS satPaymentTermId,
  BUILTIN.DF(transaction.custbody_mx_txn_sat_payment_term) AS satPaymentTermName,
  transaction.terms AS termsId,
  BUILTIN.DF(transaction.terms) AS termsName,
  transaction.currency AS currencyId,
  BUILTIN.DF(transaction.currency) AS currencyName,
  transaction.exchangerate AS exchangeRate,
  transaction.foreigntotal AS total,
  MAX(ABS(tal.amountunpaid)) AS amountRemaining,
  BUILTIN.CF(transaction.status) AS statusId,
  BUILTIN.DF(transaction.status) AS statusName
FROM transaction
INNER JOIN transactionline mainLine
  ON mainLine.transaction = transaction.id
  AND mainLine.mainline = 'T'
INNER JOIN transactionaccountingline tal
  ON tal.transaction = transaction.id
  AND tal.posting = 'T'
  AND tal.accounttype = 'AcctRec'
WHERE transaction.type = 'CustInvc'
GROUP BY
  transaction.id,
  transaction.tranid,
  transaction.transactionnumber,
  transaction.trandate,
  transaction.duedate,
  mainLine.createdfrom,
  BUILTIN.DF(mainLine.createdfrom),
  transaction.entity,
  BUILTIN.DF(transaction.entity),
  transaction.postingperiod,
  BUILTIN.DF(transaction.postingperiod),
  transaction.custbody_mx_txn_sat_payment_term,
  BUILTIN.DF(transaction.custbody_mx_txn_sat_payment_term),
  transaction.terms,
  BUILTIN.DF(transaction.terms),
  transaction.currency,
  BUILTIN.DF(transaction.currency),
  transaction.exchangerate,
  transaction.foreigntotal,
  BUILTIN.CF(transaction.status),
  BUILTIN.DF(transaction.status)
HAVING MAX(ABS(tal.amountunpaid)) > ${OPEN_AMOUNT_TOLERANCE}
ORDER BY transaction.trandate DESC, transaction.id DESC
  `.trim()
}

function buildCreditosAplicablesQuery(
  accountId: string,
  customerIds: string[],
) {
  return `
SELECT
  transaction.id AS transactionId,
  transaction.tranid AS tranId,
  transaction.type AS transactionType,
  transaction.trandate AS transactionDate,
  transaction.postingperiod AS postingPeriodId,
  BUILTIN.DF(transaction.postingperiod) AS postingPeriodName,
  transaction.currency AS currencyId,
  BUILTIN.DF(transaction.currency) AS currencyName,
  line.entity AS customerId,
  BUILTIN.DF(line.entity) AS customerName,
  tal.credit AS creditAmount,
  COALESCE(applied.appliedAmount, 0) AS appliedAmount,
  (tal.credit - COALESCE(applied.appliedAmount, 0)) AS availableAmount
FROM transaction
INNER JOIN transactionaccountingline tal
  ON tal.transaction = transaction.id
  AND tal.posting = 'T'
INNER JOIN transactionline line
  ON line.transaction = tal.transaction
  AND line.id = tal.transactionline
LEFT JOIN (
  SELECT
    PreviousTransactionLineLink.nextdoc AS nextDoc,
    SUM(PreviousTransactionLineLink.foreignamount) AS appliedAmount
  FROM PreviousTransactionLineLink
  GROUP BY PreviousTransactionLineLink.nextdoc
) applied
  ON applied.nextDoc = transaction.id
WHERE tal.account = ${formatSuiteQlLiteral(accountId)}
  AND tal.credit > ${OPEN_AMOUNT_TOLERANCE}
  AND (tal.credit - COALESCE(applied.appliedAmount, 0)) > ${OPEN_AMOUNT_TOLERANCE}
  AND line.entity IN (${joinSuiteQlLiterals(customerIds)})
ORDER BY transaction.trandate ASC, transaction.id ASC
  `.trim()
}

async function buildN1ContextByInvoiceId(
  client: NetSuiteClient,
  summaryRows: FacturaOpenSummaryRow[],
) {
  const result = new Map<string, FacturaN1Context>()
  if (summaryRows.length === 0) {
    return result
  }

  const summariesWithWindow = summaryRows
    .map((summary) => ({
      summary,
      window: getPreviousMonthWindow(summary.transactionDate),
    }))
    .filter(
      (
        entry,
      ): entry is {
        summary: FacturaOpenSummaryRow
        window: MonthWindow
      } => Boolean(entry.summary.customerId && entry.window),
    )

  if (summariesWithWindow.length === 0) {
    return result
  }

  const customerIds = uniqueValues(summariesWithWindow.map(({ summary }) => summary.customerId))
  const minStart = summariesWithWindow.reduce(
    (current, { window }) => (current && current < window.startDate ? current : window.startDate),
    summariesWithWindow[0].window.startDate,
  )
  const maxEnd = summariesWithWindow.reduce(
    (current, { window }) => (current && current > window.endDate ? current : window.endDate),
    summariesWithWindow[0].window.endDate,
  )

  const rawRows: N1AnticipoCandidateRow[] = []
  for (const customerChunk of chunkValues(customerIds, SUITEQL_IN_CHUNK_SIZE)) {
    const query = buildN1AnticipoCandidatesQuery(customerChunk, minStart, maxEnd)
    const rows = (await fetchAllSuiteQlRows(client, query)).map(toN1AnticipoCandidateRow)
    rawRows.push(...rows)
  }

  const candidates = consolidateN1AnticipoCandidates(rawRows)
  const candidatesByCustomerId = new Map<string, N1AnticipoCandidate[]>()

  candidates.forEach((candidate) => {
    if (!candidate.facturaAnticipoClienteId) {
      return
    }

    const bucket = candidatesByCustomerId.get(candidate.facturaAnticipoClienteId) ?? []
    bucket.push(candidate)
    candidatesByCustomerId.set(candidate.facturaAnticipoClienteId, bucket)
  })

  summariesWithWindow.forEach(({ summary, window }) => {
    const targetAmount = getFacturaTargetAmount(summary)
    const customerCandidates = summary.customerId ? candidatesByCustomerId.get(summary.customerId) ?? [] : []
    const matches = customerCandidates.filter((candidate) => {
      if (candidate.facturaAnticipoClienteId !== summary.customerId) {
        return false
      }

      if (!amountsMatchExactly(candidate.facturaAnticipoTotal, targetAmount)) {
        return false
      }

      if (!isFacturaPueAnticipoCandidate(candidate)) {
        return false
      }

      if (!isAllowedN1PaymentCandidate(candidate)) {
        return false
      }

      if (!isDateWithinMonthWindow(candidate.facturaAnticipoFecha, window)) {
        return false
      }

      if (!isDateWithinMonthWindow(candidate.pagoFecha, window)) {
        return false
      }

      if (!amountsMatchExactly(candidate.pagoAplicadoMonto, candidate.facturaAnticipoTotal)) {
        return false
      }

      return true
    })

    if (matches.length === 1) {
      result.set(summary.internalId, matches[0])
    }
  })

  return result
}

function buildN1AnticipoCandidatesQuery(
  customerIds: string[],
  minStartDate: string,
  maxEndDate: string,
) {
  return `
SELECT DISTINCT
  invoice.id AS facturaAnticipoInternalId,
  invoice.tranid AS facturaAnticipoDocumento,
  invoice.trandate AS facturaAnticipoFecha,
  invoice.postingperiod AS facturaAnticipoPeriodoContableId,
  BUILTIN.DF(invoice.postingperiod) AS facturaAnticipoPeriodoContableNombre,
  main.entity AS facturaAnticipoClienteId,
  BUILTIN.DF(main.entity) AS facturaAnticipoClienteNombre,
  invoice.foreigntotal AS facturaAnticipoTotal,
  invoice.custbody_mx_txn_sat_payment_term AS facturaAnticipoMetodoPagoId,
  BUILTIN.DF(invoice.custbody_mx_txn_sat_payment_term) AS facturaAnticipoMetodoPagoNombre,
  paymentLink.foreignamount AS pagoAplicadoMonto,
  paymentTxn.id AS pagoTransactionId,
  paymentTxn.tranid AS pagoDocumento,
  paymentTxn.type AS pagoTipoTransaccion,
  paymentTxn.trandate AS pagoFecha,
  paymentTxn.postingperiod AS pagoPeriodoContableId,
  BUILTIN.DF(paymentTxn.postingperiod) AS pagoPeriodoContableNombre,
  paymentBank.account AS pagoCuentaBancoId,
  BUILTIN.DF(paymentBank.account) AS pagoCuentaBancoNombre,
  creditMemoTxn.id AS notaCreditoId,
  creditMemoTxn.tranid AS notaCreditoDocumento,
  creditMemoTxn.trandate AS notaCreditoFecha,
  creditMemoTxn.status AS notaCreditoEstadoId,
  BUILTIN.DF(creditMemoTxn.status) AS notaCreditoEstadoNombre
FROM transaction invoice
INNER JOIN transactionline main
  ON main.transaction = invoice.id
  AND main.mainline = 'T'
INNER JOIN transactionline itemLine
  ON itemLine.transaction = invoice.id
  AND NVL(itemLine.mainline, 'F') = 'F'
LEFT JOIN PreviousTransactionLineLink paymentLink
  ON paymentLink.previousdoc = invoice.id
  AND paymentLink.linktype = 'Payment'
LEFT JOIN transaction paymentTxn
  ON paymentTxn.id = paymentLink.nextdoc
LEFT JOIN transactionaccountingline paymentBank
  ON paymentBank.transaction = paymentTxn.id
  AND paymentBank.posting = 'T'
  AND paymentBank.debit > ${OPEN_AMOUNT_TOLERANCE}
LEFT JOIN PreviousTransactionLineLink creditMemoLink
  ON creditMemoLink.previousdoc = invoice.id
  AND creditMemoLink.linktype = 'SaleRet'
LEFT JOIN transaction creditMemoTxn
  ON creditMemoTxn.id = creditMemoLink.nextdoc
WHERE invoice.type = 'CustInvc'
  AND main.entity IN (${joinSuiteQlLiterals(customerIds)})
  AND invoice.trandate BETWEEN TO_DATE(${formatSuiteQlLiteral(minStartDate)}, 'YYYY-MM-DD')
    AND TO_DATE(${formatSuiteQlLiteral(maxEndDate)}, 'YYYY-MM-DD')
  AND itemLine.item = ${formatSuiteQlLiteral(N1_ANTICIPO_ITEM_ID)}
ORDER BY invoice.trandate DESC, invoice.id DESC
  `.trim()
}

function toN1AnticipoCandidateRow(row: Record<string, unknown>): N1AnticipoCandidateRow {
  const normalizedRow = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]),
  ) as Record<string, unknown>

  return {
    facturaAnticipoInternalId: String(normalizedRow.facturaanticipointernalid ?? ''),
    facturaAnticipoDocumento: getNullableString(normalizedRow.facturaanticipodocumento),
    facturaAnticipoFecha: getNullableString(normalizedRow.facturaanticipofecha),
    facturaAnticipoPeriodoContableId: getNullableString(normalizedRow.facturaanticipoperiodocontableid),
    facturaAnticipoPeriodoContableNombre: getNullableString(normalizedRow.facturaanticipoperiodocontablenombre),
    facturaAnticipoClienteId: getNullableString(normalizedRow.facturaanticipoclienteid),
    facturaAnticipoClienteNombre: getNullableString(normalizedRow.facturaanticipoclientenombre),
    facturaAnticipoTotal: getNullableNumber(normalizedRow.facturaanticipototal),
    facturaAnticipoMetodoPagoId: getNullableString(normalizedRow.facturaanticipometodopagoid),
    facturaAnticipoMetodoPagoNombre: getNullableString(normalizedRow.facturaanticipometodopagonombre),
    pagoAplicadoMonto: getNullableNumber(normalizedRow.pagoaplicadomonto),
    pagoTransactionId: getNullableString(normalizedRow.pagotransactionid),
    pagoDocumento: getNullableString(normalizedRow.pagodocumento),
    pagoTipoTransaccion: getNullableString(normalizedRow.pagotipotransaccion),
    pagoFecha: getNullableString(normalizedRow.pagofecha),
    pagoPeriodoContableId: getNullableString(normalizedRow.pagoperiodocontableid),
    pagoPeriodoContableNombre: getNullableString(normalizedRow.pagoperiodocontablenombre),
    pagoCuentaBancoId: getNullableString(normalizedRow.pagocuentabancoid),
    pagoCuentaBancoNombre: getNullableString(normalizedRow.pagocuentabanconombre),
    notaCreditoId: getNullableString(normalizedRow.notacreditoid),
    notaCreditoDocumento: getNullableString(normalizedRow.notacreditodocumento),
    notaCreditoFecha: getNullableString(normalizedRow.notacreditofecha),
    notaCreditoEstadoId: getNullableString(normalizedRow.notacreditoestadoid),
    notaCreditoEstadoNombre: getNullableString(normalizedRow.notacreditoestadonombre),
  }
}

function consolidateN1AnticipoCandidates(rows: N1AnticipoCandidateRow[]) {
  const byInvoiceId = new Map<string, N1AnticipoCandidate>()

  rows.forEach((row) => {
    if (!row.facturaAnticipoInternalId) {
      return
    }

    const current = byInvoiceId.get(row.facturaAnticipoInternalId)
    if (!current) {
      byInvoiceId.set(row.facturaAnticipoInternalId, {
        facturaAnticipoInternalId: row.facturaAnticipoInternalId,
        facturaAnticipoDocumento: row.facturaAnticipoDocumento,
        facturaAnticipoFecha: parseNetSuiteDate(row.facturaAnticipoFecha),
        facturaAnticipoPeriodoContableId: row.facturaAnticipoPeriodoContableId,
        facturaAnticipoPeriodoContableNombre: row.facturaAnticipoPeriodoContableNombre,
        facturaAnticipoClienteId: row.facturaAnticipoClienteId,
        facturaAnticipoClienteNombre: row.facturaAnticipoClienteNombre,
        facturaAnticipoTotal: row.facturaAnticipoTotal,
        facturaAnticipoMetodoPagoId: row.facturaAnticipoMetodoPagoId,
        facturaAnticipoMetodoPagoNombre: row.facturaAnticipoMetodoPagoNombre,
        pagoAplicadoMonto: row.pagoAplicadoMonto,
        pagoTransactionId: row.pagoTransactionId ?? '',
        pagoDocumento: row.pagoDocumento,
        pagoTipoTransaccion: row.pagoTipoTransaccion,
        pagoFecha: parseNetSuiteDate(row.pagoFecha),
        pagoPeriodoContableId: row.pagoPeriodoContableId,
        pagoPeriodoContableNombre: row.pagoPeriodoContableNombre,
        pagoCuentaBancoId: row.pagoCuentaBancoId,
        pagoCuentaBancoNombre: row.pagoCuentaBancoNombre,
        notaCreditoId: row.notaCreditoId,
        notaCreditoDocumento: row.notaCreditoDocumento,
        notaCreditoFecha: parseNetSuiteDate(row.notaCreditoFecha),
        notaCreditoEstadoId: row.notaCreditoEstadoId,
        notaCreditoEstadoNombre: row.notaCreditoEstadoNombre,
      })
      return
    }

    if (!current.pagoTransactionId && row.pagoTransactionId) {
      current.pagoTransactionId = row.pagoTransactionId
      current.pagoDocumento = row.pagoDocumento
      current.pagoTipoTransaccion = row.pagoTipoTransaccion
      current.pagoFecha = parseNetSuiteDate(row.pagoFecha)
      current.pagoPeriodoContableId = row.pagoPeriodoContableId
      current.pagoPeriodoContableNombre = row.pagoPeriodoContableNombre
      current.pagoCuentaBancoId = row.pagoCuentaBancoId
      current.pagoCuentaBancoNombre = row.pagoCuentaBancoNombre
      current.pagoAplicadoMonto = row.pagoAplicadoMonto
    } else if (
      row.pagoCuentaBancoNombre &&
      N1_ALLOWED_BANK_ACCOUNT_NAMES.has(row.pagoCuentaBancoNombre) &&
      (!current.pagoCuentaBancoNombre || !N1_ALLOWED_BANK_ACCOUNT_NAMES.has(current.pagoCuentaBancoNombre))
    ) {
      current.pagoCuentaBancoId = row.pagoCuentaBancoId
      current.pagoCuentaBancoNombre = row.pagoCuentaBancoNombre
    }

    if (
      row.notaCreditoId &&
      (!current.notaCreditoId ||
        (row.notaCreditoFecha &&
          getComparableDateValue(row.notaCreditoFecha) < getComparableDateValue(current.notaCreditoFecha)))
    ) {
      current.notaCreditoId = row.notaCreditoId
      current.notaCreditoDocumento = row.notaCreditoDocumento
      current.notaCreditoFecha = parseNetSuiteDate(row.notaCreditoFecha)
      current.notaCreditoEstadoId = row.notaCreditoEstadoId
      current.notaCreditoEstadoNombre = row.notaCreditoEstadoNombre
    }
  })

  return [...byInvoiceId.values()]
}

function isFacturaPueAnticipoCandidate(candidate: N1AnticipoCandidate) {
  return (
    normalizeComparableText(candidate.facturaAnticipoMetodoPagoNombre) === SAT_PAYMENT_TERM_PUE ||
    candidate.facturaAnticipoMetodoPagoId === N1_PAYMENT_TERM_ID
  )
}

function isAllowedN1PaymentCandidate(candidate: N1AnticipoCandidate) {
  const bankAccountNumber = extractAccountNumber(candidate.pagoCuentaBancoNombre)
  return (
    Boolean(candidate.pagoTransactionId) &&
    N1_ALLOWED_PAYMENT_TRANSACTION_TYPES.has(candidate.pagoTipoTransaccion ?? '') &&
    (N1_ALLOWED_BANK_ACCOUNT_NAMES.has(candidate.pagoCuentaBancoNombre ?? '') ||
      (bankAccountNumber !== null && N1_ALLOWED_BANK_ACCOUNT_NUMBERS.has(bankAccountNumber)))
  )
}

function extractAccountNumber(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const match = value.match(/\b\d{3}-\d{2}-\d{2}\b/)
  return match?.[0] ?? null
}

function getPreviousMonthWindow(value: string | Date | null): MonthWindow | null {
  const parsed = value instanceof Date ? value : parseNetSuiteDate(value)
  if (!parsed) {
    return null
  }

  const year = parsed.getUTCFullYear()
  const monthIndex = parsed.getUTCMonth()
  const previousMonthDate = new Date(Date.UTC(year, monthIndex - 1, 1))
  const nextMonthDate = new Date(Date.UTC(previousMonthDate.getUTCFullYear(), previousMonthDate.getUTCMonth() + 1, 0))

  return {
    startDate: toIsoDate(previousMonthDate),
    endDate: toIsoDate(nextMonthDate),
    year: previousMonthDate.getUTCFullYear(),
    monthNumber: previousMonthDate.getUTCMonth() + 1,
    monthName: formatSpanishMonthName(previousMonthDate.getUTCMonth() + 1),
  }
}

function isDateWithinMonthWindow(
  value: string | Date | null,
  window: MonthWindow,
) {
  const parsed = value instanceof Date ? value : parseNetSuiteDate(value)
  if (!parsed) {
    return false
  }

  const iso = toIsoDate(parsed)
  return iso >= window.startDate && iso <= window.endDate
}

function extractSchemaFields(properties?: Record<string, SchemaNode>) {
  return Object.entries(properties ?? {})
    .map(([key, value]): FacturaSchemaField => ({
      key,
      title: value.title,
      type: value.type,
      format: value.format,
      nullable: value.nullable,
      custom: Boolean(value['x-ns-custom-field']),
    }))
    .sort((left, right) => left.key.localeCompare(right.key))
}

function toFacturaOpenSummaryRow(row: Record<string, unknown>): FacturaOpenSummaryRow {
  const normalizedRow = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]),
  ) as Record<string, unknown>

  return {
    internalId: String(normalizedRow.internalid ?? ''),
    tranId: getNullableString(normalizedRow.tranid),
    transactionNumber: getNullableString(normalizedRow.transactionnumber),
    transactionDate: getNullableString(normalizedRow.transactiondate),
    dueDate: getNullableString(normalizedRow.duedate),
    customerId: getNullableString(normalizedRow.customerid),
    customerName: getNullableString(normalizedRow.customername),
    postingPeriodId: getNullableString(normalizedRow.postingperiodid),
    postingPeriodName: getNullableString(normalizedRow.postingperiodname),
    satPaymentTermId: getNullableString(normalizedRow.satpaymenttermid),
    satPaymentTermName: getNullableString(normalizedRow.satpaymenttermname),
    currencyId: getNullableString(normalizedRow.currencyid),
    currencyName: getNullableString(normalizedRow.currencyname),
    exchangeRate: getNullableNumber(normalizedRow.exchangerate),
    subtotal: getNullableNumber(normalizedRow.subtotal),
    discountTotal: getNullableNumber(normalizedRow.discounttotal),
    taxTotal: getNullableNumber(normalizedRow.taxtotal),
    total: getNullableNumber(normalizedRow.total),
    amountPaid: getNullableNumber(normalizedRow.amountpaid),
    amountRemaining: getNullableNumber(normalizedRow.amountremaining),
    statusId: getNullableString(normalizedRow.statusid),
    statusName: getNullableString(normalizedRow.statusname),
    referenceNumber: getNullableString(normalizedRow.referencenumber),
    memo: getNullableString(normalizedRow.memo),
    termsId: getNullableString(normalizedRow.termsid),
    termsName: getNullableString(normalizedRow.termsname),
    createdFromId: getNullableString(normalizedRow.createdfromid),
    createdFromName: getNullableString(normalizedRow.createdfromname),
  }
}

function normalizeFactura(
  raw: Record<string, unknown>,
  summary: FacturaOpenSummaryRow,
  situacion: FacturaSituacion,
): Factura {
  const amountPaid = getNullableNumber(raw.amountPaid) ?? summary.amountPaid
  const subtotal = getNullableNumber(raw.subtotal) ?? summary.subtotal
  const discount = getNullableNumber(raw.discountTotal) ?? getNullableNumber(raw.discountAmount) ?? summary.discountTotal
  const impuestoTotal = getNullableNumber(raw.taxTotal) ?? summary.taxTotal
  const total = getNullableNumber(raw.total) ?? summary.total
  const saldoAbierto =
    getNullableNumber(raw.amountRemaining) ??
    getNullableNumber(raw.amountRemainingTotalBox) ??
    summary.amountRemaining
  const lineas = extractLineas(raw.item)
  const impuestos = extractImpuestos(raw, lineas, impuestoTotal)
  const estado = deriveEstado(saldoAbierto)

  return {
    id: String(raw.id ?? summary.internalId),
    netsuiteInternalId: String(raw.id ?? summary.internalId),
    numeroDocumento:
      getNullableString(raw.tranId) ??
      getNullableString(raw.transactionNumber) ??
      summary.tranId ??
      summary.transactionNumber,
    numeroTransaccion:
      getNullableString(raw.transactionNumber) ??
      summary.transactionNumber ??
      getNullableString(raw.tranId) ??
      summary.tranId,
    clienteId: getReferenceId(raw.entity) ?? summary.customerId,
    clienteNombre: getReferenceName(raw.entity) ?? summary.customerName,
    fecha: parseNetSuiteDate(raw.tranDate) ?? parseNetSuiteDate(summary.transactionDate),
    vencimiento: parseNetSuiteDate(raw.dueDate) ?? parseNetSuiteDate(summary.dueDate),
    fechaCreacion: parseNetSuiteDate(raw.createdDate),
    ultimaModificacion: parseNetSuiteDate(raw.lastModifiedDate),
    periodoContableId: getReferenceId(raw.postingPeriod) ?? summary.postingPeriodId,
    periodoContableNombre: getReferenceName(raw.postingPeriod) ?? summary.postingPeriodName,
    satPaymentTermId:
      getReferenceId(raw.custbody_mx_txn_sat_payment_term) ??
      getNullableString(raw.custbody_mx_txn_sat_payment_term) ??
      summary.satPaymentTermId,
    satPaymentTermNombre:
      getReferenceName(raw.custbody_mx_txn_sat_payment_term) ?? summary.satPaymentTermName,
    monedaId: getReferenceId(raw.currency) ?? summary.currencyId,
    moneda: getReferenceName(raw.currency) ?? summary.currencyName,
    tipoCambio: getNullableNumber(raw.exchangeRate) ?? summary.exchangeRate,
    subtotal,
    descuento: discount,
    impuestoTotal,
    iva: deriveIva(impuestos, impuestoTotal),
    total,
    montoPagado: amountPaid,
    saldoAbierto,
    estado,
    situacionCobro: deriveSituacionCobro(total, amountPaid, saldoAbierto, estado),
    situacion,
    estadoNetsuiteId: getReferenceId(raw.status) ?? summary.statusId,
    estadoNetsuiteNombre: getReferenceName(raw.status) ?? summary.statusName,
    terminosPagoId: getReferenceId(raw.terms) ?? summary.termsId,
    terminosPagoNombre: getReferenceName(raw.terms) ?? summary.termsName,
    memo: getNullableString(raw.memo) ?? summary.memo,
    referencia: getNullableString(raw.otherRefNum) ?? summary.referenceNumber,
    impuestos,
    lineas,
    billingAddress: getNullableRecord(raw.billingAddress),
    shippingAddress: getNullableRecord(raw.shippingAddress),
    customFields: extractCustomFields(raw),
    raw,
  }
}

function normalizeFacturaFromSummary(
  summary: FacturaOpenSummaryRow,
  situacion: FacturaSituacion,
) {
  return normalizeFactura(buildFacturaSummaryRaw(summary), summary, situacion)
}

function buildFacturaSummaryRaw(summary: FacturaOpenSummaryRow): Record<string, unknown> {
  return {
    source: 'suiteql-summary',
    id: summary.internalId,
    tranId: summary.tranId,
    transactionNumber: summary.transactionNumber,
    tranDate: summary.transactionDate,
    dueDate: summary.dueDate,
    entity: buildSummaryReference(summary.customerId, summary.customerName),
    postingPeriod: buildSummaryReference(summary.postingPeriodId, summary.postingPeriodName),
    custbody_mx_txn_sat_payment_term: buildSummaryReference(
      summary.satPaymentTermId,
      summary.satPaymentTermName,
    ),
    terms: buildSummaryReference(summary.termsId, summary.termsName),
    currency: buildSummaryReference(summary.currencyId, summary.currencyName),
    exchangeRate: summary.exchangeRate,
    subtotal: summary.subtotal,
    discountTotal: summary.discountTotal,
    taxTotal: summary.taxTotal,
    total: summary.total,
    amountPaid: summary.amountPaid,
    amountRemaining: summary.amountRemaining,
    amountRemainingTotalBox: summary.amountRemaining,
    status: buildSummaryReference(summary.statusId, summary.statusName),
    memo: summary.memo,
    otherRefNum: summary.referenceNumber,
    item: {
      items: [],
      totalResults: 0,
    },
  }
}

function buildSummaryReference(id: string | null, refName: string | null) {
  if (!id && !refName) {
    return null
  }

  return {
    ...(id ? { id } : {}),
    ...(refName ? { refName } : {}),
  }
}

function extractLineas(itemCollection: unknown): FacturaLinea[] {
  const collection = getNullableRecord(itemCollection)
  const items = collection?.items

  if (!Array.isArray(items)) {
    return []
  }

  return items
    .map((item) => getNullableRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((line): FacturaLinea => ({
      lineaId: getNullableString(line.line),
      itemId: getReferenceId(line.item),
      itemNombre: getReferenceName(line.item),
      descripcion: getNullableString(line.description),
      cantidad: getNullableNumber(line.quantity),
      precioUnitario: getNullableNumber(line.rate),
      subtotalLinea: getNullableNumber(line.amount),
      impuestoLinea: getNullableNumber(line.tax1Amt),
      totalLinea: sumNumbers(getNullableNumber(line.amount), getNullableNumber(line.tax1Amt)),
      esGravable: getNullableBoolean(line.isTaxable),
      codigoImpuesto: getReferenceId(line.taxCode),
      tasaImpuesto: getNullableNumber(line.taxRate1),
      raw: line,
    }))
}

function extractImpuestos(
  raw: Record<string, unknown>,
  lineas: FacturaLinea[],
  impuestoTotal: number | null,
): FacturaImpuesto[] {
  const impuestos: FacturaImpuesto[] = []
  const taxItemName = getReferenceName(raw.taxItem)
  const taxItemCode = getReferenceId(raw.taxItem)
  const topLevelRate = getNullableNumber(raw.taxRate)

  if (taxItemName || taxItemCode || impuestoTotal !== null || topLevelRate !== null) {
    impuestos.push({
      codigo: taxItemCode,
      nombre: taxItemName,
      tasa: topLevelRate,
      importe: impuestoTotal,
      esRetencion: false,
    })
  }

  const retentionAmount =
    getNullableNumber(raw.custbody_ph4014_wtax_wamt) ??
    getNullableNumber(raw.custbody_4601_wtax_withheld)

  if (retentionAmount !== null) {
    impuestos.push({
      codigo:
        getNullableString(raw.custbody_ph4014_wtax_code) ??
        getNullableString(raw.custbody_4601_entitydefaultwitaxcode),
      nombre: 'Retencion',
      tasa:
        getNullableNumber(raw.custbody_ph4014_wtax_rate) ??
        getNullableNumber(raw.custbody_shq_tasa_efectiva),
      importe: retentionAmount,
      esRetencion: true,
    })
  }

  if (impuestos.length === 0) {
    const lineTax = lineas.reduce((sum, line) => sumNumbers(sum, line.impuestoLinea), 0)
    if (lineTax > OPEN_AMOUNT_TOLERANCE) {
      impuestos.push({
        nombre: 'Impuesto en lineas',
        importe: lineTax,
        esRetencion: false,
      })
    }
  }

  return impuestos
}

function buildFacturaSituacion(
  candidatos: FacturaAplicacionCandidata[],
  k: FacturaKContext | null,
  a4: FacturaA4Context | null,
  a5: FacturaA4Context | null,
  b1: FacturaB1Context | null,
  n1: FacturaN1Context | null,
  a6: FacturaA4Context | null = null,
  a7: FacturaA4Context | null = null,
  a8: FacturaA8Context | null = null,
  b2: FacturaB1Context | null = null,
  b3: FacturaB3Context | null = null,
): FacturaSituacion {
  const n1CreditMemoId = n1?.notaCreditoId ?? null
  const ppd1Candidate = candidatos.find((candidato) => candidato.cumplePpd1)
  const a1Candidate = candidatos.find(
    (candidato) => candidato.cumpleA1 && (!n1CreditMemoId || candidato.id !== n1CreditMemoId),
  )
  const a2Candidate = candidatos.find(
    (candidato) => candidato.cumpleA2 && (!n1CreditMemoId || candidato.id !== n1CreditMemoId),
  )
  const a3Candidate = candidatos.find(
    (candidato) => candidato.cumpleA3 && (!n1CreditMemoId || candidato.id !== n1CreditMemoId),
  )

  if (k) {
    return {
      codigo: 'K',
      color: 'green',
      motivo:
        k.manualReason ??
        'Factura PPD identificada por cruce Kontempo entre orden, transferencia y diario reconocido en NetSuite, lista para customer payment puente con datos CFDI Kontempo.',
      candidatos,
      k,
      a4,
      a5,
      a6,
      a7,
      a8,
      b1,
      b2,
      b3,
      n1,
    }
  }

  if (ppd1Candidate) {
    return {
      codigo: 'PPD1',
      color: 'green',
      motivo:
        'Existe un diario Journal exacto del mes vigente, con fecha posterior a la factura PPD, homologable al banco puente 100 y listo para customer payment completo.',
      candidatos,
      k,
      a4,
      a5,
      a6,
      a7,
      a8,
      b1,
      b2,
      b3,
      n1,
    }
  }

  if (a1Candidate) {
    return {
      codigo: 'A1',
      color: 'green',
      motivo:
        'Existe un diario o credito vivo del mismo periodo contable con monto disponible y moneda exactos.',
      candidatos,
      k,
      a4,
      a5,
      a6,
      a7,
      a8,
      b1,
      b2,
      b3,
      n1,
    }
  }

  if (a2Candidate) {
    return {
      codigo: 'A2',
      color: 'neutral',
      motivo:
        'Existe un diario o credito vivo MXN del mismo periodo contable con diferencia absoluta mayor a 0 y hasta $1.00 MXN.',
      candidatos,
      k,
      a4,
      a5,
      a6,
      a7,
      a8,
      b1,
      b2,
      b3,
      n1,
    }
  }

  if (a3Candidate) {
    return {
      codigo: 'A3',
      color: 'neutral',
      motivo:
        'Existe un diario o credito vivo MXN del mismo periodo contable con diferencia absoluta mayor a $1.00 MXN y hasta $25.00 MXN.',
      candidatos,
      k,
      a4,
      a5,
      a6,
      a7,
      a8,
      b1,
      b2,
      b3,
      n1,
    }
  }

  if (a4) {
    return {
      codigo: 'A4',
      color: 'green',
      motivo:
        'Varias facturas PUE de la misma orden de venta suman exactamente el monto de un solo credito vivo del mismo cliente y periodo.',
      candidatos,
      k,
      a4,
      a5,
      a6,
      a7,
      a8,
      b1,
      b2,
      b3,
      n1,
    }
  }

  if (a5) {
    return {
      codigo: 'A5',
      color: 'green',
      motivo:
        'Una o varias facturas PUE de la misma orden de venta se aplican contra un credito vivo igual o dentro de $1.00 MXN del total de la orden, dejando remanente en el credito.',
      candidatos,
      k,
      a4,
      a5,
      a6,
      a7,
      a8,
      b1,
      b2,
      b3,
      n1,
    }
  }

  if (a6) {
    return {
      codigo: 'A6',
      color: 'green',
      motivo:
        'Existe un diario vivo mayor al monto de la factura, del mismo cliente, periodo y moneda, para una orden de venta de una sola factura, dejando remanente en el credito.',
      candidatos,
      k,
      a4,
      a5,
      a6,
      a7,
      a8,
      b1,
      b2,
      b3,
      n1,
    }
  }

  if (a7) {
    return {
      codigo: 'A7',
      color: 'green',
      motivo:
        'Existe un solo diario vivo del mismo cliente, periodo y moneda MXN que cubre en forma unica todo el grupo PUE del periodo y deja remanente en el credito.',
      candidatos,
      k,
      a4,
      a5,
      a6,
      a7,
      a8,
      b1,
      b2,
      b3,
      n1,
    }
  }

  if (a8) {
    return {
      codigo: 'A8',
      color: 'green',
      motivo:
        'Existe una asignacion deterministica del mismo periodo entre la factura y uno o varios creditos vivos Journal o CustCred del mismo cliente y moneda MXN.',
      candidatos,
      k,
      a4,
      a5,
      a6,
      a7,
      a8,
      b1,
      b2,
      b3,
      n1,
    }
  }

  if (b3) {
    return {
      codigo: 'B3',
      color: 'green',
      motivo:
        'Varias facturas PUE MXN abiertas de la misma orden de venta se cubren exactamente con el disponible remanente de un diario de periodo anterior igual al total original de la orden, resoluble con puente por factura.',
      candidatos,
      k,
      a4,
      a5,
      a6,
      a7,
      a8,
      b1,
      b2,
      b3,
      n1,
    }
  }

  if (b2) {
    return {
      codigo: 'B2',
      color: 'green',
      motivo:
        'Existe un solo diario vivo de un periodo contable anterior que cubre la factura PUE y deja remanente, resoluble mediante banco puente y diario puente.',
      candidatos,
      k,
      a4,
      a5,
      a6,
      a7,
      a8,
      b1,
      b2,
      b3,
      n1,
    }
  }

  if (b1) {
    return {
      codigo: 'B1',
      color: 'green',
      motivo:
        'Existe un diario exacto del mismo cliente y moneda, pero en un periodo contable anterior, resoluble con banco puente y diario puente.',
      candidatos,
      k,
      a4,
      a5,
      a6,
      a7,
      a8,
      b1,
      b2,
      b3,
      n1,
    }
  }

  if (n1) {
    return {
      codigo: 'N1',
      color: 'green',
      motivo:
        'No existe cobro aplicable A1, A2 o A3, pero si una factura anticipo pagada del mes inmediato anterior con el mismo cliente y monto.',
      candidatos,
      k,
      a4,
      a5,
      a6,
      a7,
      a8,
      b1,
      b2,
      b3,
      n1,
    }
  }

  if (candidatos.length > 0) {
    return {
      codigo: null,
      color: 'neutral',
      motivo:
        'Hay creditos vivos del cliente en la cuenta de clientes nacionales, pero no cumplen PPD1, A1, A2, A3, A4, A5, A6, A7, A8, B1, B2 ni B3.',
      candidatos,
      k,
      a4,
      a5,
      a6,
      a7,
      a8,
      b1,
      b2,
      b3,
      n1,
    }
  }

  return {
    codigo: null,
    color: 'neutral',
    motivo:
      'No se detectaron diarios ni transacciones credito aplicables en la cuenta de clientes nacionales.',
    candidatos,
    k,
    a4,
    a5,
    a6,
    a7,
    a8,
    b1,
    b2,
    b3,
    n1,
  }
}

function countSituaciones(
  situacionesByInvoiceId: Map<string, FacturaSituacion>,
  codigo: string,
) {
  let total = 0

  situacionesByInvoiceId.forEach((situacion) => {
    if (situacion.codigo === codigo) {
      total += 1
    }
  })

  return total
}

function buildResumenTiposTransaccion(
  situacionesByInvoiceId: Map<string, FacturaSituacion>,
): FacturaResumenTipoTransaccion[] {
  return ruleDefinitions.map((definition) => ({
    code: definition.code,
    title: definition.title,
    definition: definition.definition,
    total: countSituaciones(situacionesByInvoiceId, definition.code),
    actionLabel:
      definition.code === 'PPD1' ||
      definition.code === 'A1' ||
      definition.code === 'A2' ||
      definition.code === 'A3' ||
      definition.code === 'A4' ||
      definition.code === 'A5' ||
      definition.code === 'A6' ||
      definition.code === 'A7' ||
      definition.code === 'A8' ||
      definition.code === 'B1' ||
      definition.code === 'B2' ||
      definition.code === 'B3' ||
      definition.code === 'N1'
        ? 'Aplicar transacciones'
        : null,
  }))
}

async function applyFacturaA4Group(
  client: NetSuiteClient,
  summaries: FacturaOpenSummaryRow[],
  a4: FacturaA4Context,
  options: { dryRun: boolean; ruleCode: 'A4' | 'A5' | 'A7' },
): Promise<GroupApplyOutcome> {
  const baseResults = summaries.map((summary) => ({
    invoiceInternalId: summary.internalId,
    invoiceDocument: summary.tranId ?? summary.transactionNumber,
    groupInvoiceInternalIds: a4.invoices.map((invoice) => invoice.internalId),
    groupInvoiceDocuments: a4.invoices.map((invoice) => invoice.documento),
    sourceInvoiceInternalId: a4.salesOrderInternalId || null,
    sourceInvoiceDocument: a4.salesOrderDocument,
    creditTransactionId: a4.creditTransactionId,
    creditDocument: a4.creditDocument,
    creditType: a4.creditType,
  }))

  if (summaries.length === 0 || summaries.length < 2) {
    return {
      items: baseResults.map((baseResult) => ({
        ...baseResult,
        status: 'skipped',
        message:
          options.ruleCode === 'A5'
            ? `El grupo ${options.ruleCode} ya no contiene facturas abiertas al momento de ejecutar.`
            : `El grupo ${options.ruleCode} ya no contiene varias facturas abiertas al momento de ejecutar.`,
      })),
      warnings: [],
    }
  }

  if (a4.creditType !== 'Journal') {
    return {
      items: baseResults.map((baseResult) => ({
        ...baseResult,
        status: 'skipped',
        message: `El tipo ${a4.creditType ?? 'desconocido'} aun no esta soportado para aplicacion automatica ${options.ruleCode}.`,
      })),
      warnings: [],
    }
  }

  const groupTotal = summaries.reduce((sum, summary) => sum + (getFacturaTargetAmount(summary) ?? 0), 0)
  if (!amountsMatchExactly(groupTotal, a4.groupTotal)) {
    return {
      items: baseResults.map((baseResult) => ({
        ...baseResult,
        status: 'skipped',
        message: `El total vivo del grupo ${options.ruleCode} ya no coincide con el grupo detectado.`,
      })),
      warnings: [],
    }
  }

  const expectedCreditRemaining = getGroupedOrderExpectedCreditRemaining(a4, options.ruleCode, groupTotal)
  if (expectedCreditRemaining === null) {
    return {
      items: baseResults.map((baseResult) => ({
        ...baseResult,
        status: 'skipped',
        message:
          options.ruleCode === 'A5'
            ? 'El credito A5 ya no coincide con el total de la orden de venta dentro de la tolerancia permitida o ya no deja remanente suficiente.'
            : options.ruleCode === 'A7'
              ? 'El credito A7 ya no conserva remanente suficiente o ya no es el unico diario cubridor del grupo.'
            : 'El total vivo del grupo A4 ya no coincide exactamente con el credito unico detectado.',
      })),
      warnings: [],
    }
  }

  if (options.dryRun) {
    return {
      items: baseResults.map((baseResult) => ({
        ...baseResult,
        status: 'dry_run',
        message:
          options.ruleCode === 'A5'
            ? `A5 aplicaria ${groupTotal.toFixed(2)} del credito ${a4.creditDocument ?? a4.creditTransactionId} contra ${a4.invoiceCount} factura${a4.invoiceCount === 1 ? '' : 's'} de ${a4.salesOrderDocument ?? a4.salesOrderInternalId}; quedaria remanente ${expectedCreditRemaining.toFixed(2)}.`
            : options.ruleCode === 'A7'
              ? `A7 aplicaria ${groupTotal.toFixed(2)} del diario ${a4.creditDocument ?? a4.creditTransactionId} contra ${a4.invoiceCount} facturas de ${a4.customerName ?? a4.customerId} en ${a4.postingPeriodName ?? a4.postingPeriodId}; quedaria remanente ${expectedCreditRemaining.toFixed(2)}.`
              : `A4 aplicaria el credito ${a4.creditDocument ?? a4.creditTransactionId} contra ${a4.invoiceCount} facturas de ${a4.salesOrderDocument ?? a4.salesOrderInternalId} por ${groupTotal.toFixed(2)}.`,
      })),
      warnings: [],
    }
  }

  try {
    const payment = await createA4CustomerPayment(client, summaries, a4, groupTotal, {
      expectedCreditRemaining,
      ruleCode: options.ruleCode,
    })
    const auditTarget =
      options.ruleCode === 'A4' || options.ruleCode === 'A5'
        ? {
            salesOrderInternalId: a4.salesOrderInternalId,
            salesOrderDocument: a4.salesOrderDocument,
          }
        : resolveSingleSalesOrderForGroupedInvoices(summaries)
    const warnings =
      auditTarget
        ? await auditSalesOrderSettlementAfterApply(client, {
            ruleCode: options.ruleCode,
            salesOrderInternalId: auditTarget.salesOrderInternalId,
            salesOrderDocument: auditTarget.salesOrderDocument,
            targetInvoices: a4.invoices.map((invoice) => ({
              internalId: invoice.internalId,
              documento: invoice.documento,
            })),
          })
        : []

    return {
      items: baseResults.map((baseResult) => ({
        ...baseResult,
        status: 'applied',
        message:
          options.ruleCode === 'A5'
            ? `La factura quedo aplicada dentro del grupo A5 de ${a4.salesOrderDocument ?? a4.salesOrderInternalId}; el credito conserva remanente.`
            : options.ruleCode === 'A7'
              ? `La factura quedo aplicada dentro del grupo A7 de ${a4.customerName ?? a4.customerId} en ${a4.postingPeriodName ?? a4.postingPeriodId}; el diario conserva remanente.`
              : `La factura quedo aplicada dentro del grupo A4 de ${a4.salesOrderDocument ?? a4.salesOrderInternalId}.`,
        customerPaymentId: payment.id,
        customerPaymentTranId: payment.tranId,
      })),
      warnings,
    }
  } catch (error) {
    return {
      items: baseResults.map((baseResult) => ({
        ...baseResult,
        status: 'failed',
        message: error instanceof Error ? error.message : 'Unknown NetSuite A4 apply error.',
      })),
      warnings: [],
    }
  }
}

async function applyFacturaA8Group(
  client: NetSuiteClient,
  summaries: FacturaOpenSummaryRow[],
  contextsByInvoiceId: Map<string, FacturaA8Context>,
  options: { dryRun: boolean },
): Promise<FacturaAplicacionA1ItemResult[]> {
  const orderedSummaries = [...summaries].sort((left, right) => {
    const leftAmount = getFacturaTargetAmount(left) ?? 0
    const rightAmount = getFacturaTargetAmount(right) ?? 0
    if (leftAmount !== rightAmount) {
      return rightAmount - leftAmount
    }

    return (left.tranId ?? left.transactionNumber ?? left.internalId).localeCompare(
      right.tranId ?? right.transactionNumber ?? right.internalId,
      'es',
    )
  })

  const baseResults = orderedSummaries.map((summary) => {
    const context = contextsByInvoiceId.get(summary.internalId)
    return {
      invoiceInternalId: summary.internalId,
      invoiceDocument: summary.tranId ?? summary.transactionNumber,
      groupInvoiceInternalIds: orderedSummaries.map((item) => item.internalId),
      groupInvoiceDocuments: orderedSummaries.map((item) => item.tranId ?? item.transactionNumber),
      sourceInvoiceInternalId: null,
      sourceInvoiceDocument:
        context ? [context.customerName, context.postingPeriodName].filter(Boolean).join(' / ') : null,
      creditTransactionId: context?.creditTransactionId ?? null,
      creditDocument: context?.creditDocument ?? null,
      creditType: context?.creditType ?? null,
    }
  })

  if (orderedSummaries.length === 0) {
    return []
  }

  const results: FacturaAplicacionA1ItemResult[] = []

  for (const [index, summary] of orderedSummaries.entries()) {
    const baseResult = baseResults[index]
    const context = contextsByInvoiceId.get(summary.internalId)
    if (!context) {
      results.push({
        ...baseResult,
        status: 'skipped',
        message: 'La factura ya no conserva contexto A8 al momento de ejecutar.',
      })
      continue
    }

    const targetAmount = getFacturaTargetAmount(summary)
    if (targetAmount === null || targetAmount <= OPEN_AMOUNT_TOLERANCE) {
      results.push({
        ...baseResult,
        status: 'skipped',
        message: 'La factura ya no conserva saldo valido para A8.',
      })
      continue
    }

    const currentCredit = await fetchCreditoAplicableActual(client, context.creditTransactionId, summary.customerId)
    if (!currentCredit) {
      results.push({
        ...baseResult,
        status: 'skipped',
        message: 'El credito A8 ya no existe o ya no esta disponible en Clientes nacionales.',
      })
      continue
    }

    if (!A8_SUPPORTED_CREDIT_TYPES.has(currentCredit.transactionType ?? '')) {
      results.push({
        ...baseResult,
        status: 'skipped',
        message: `El tipo ${currentCredit.transactionType ?? 'desconocido'} ya no esta soportado para aplicacion automatica A8.`,
      })
      continue
    }

    if (
      !matchesByIdentity(
        context.postingPeriodId,
        currentCredit.postingPeriodId,
        context.postingPeriodName,
        currentCredit.postingPeriodName,
      ) ||
      !matchesByIdentity(context.currencyId, currentCredit.currencyId, context.currencyName, currentCredit.currencyName)
    ) {
      results.push({
        ...baseResult,
        status: 'skipped',
        message: 'El credito A8 ya no coincide en periodo o moneda con la factura.',
      })
      continue
    }

    if ((currentCredit.availableAmount ?? 0) + OPEN_AMOUNT_TOLERANCE < targetAmount) {
      results.push({
        ...baseResult,
        status: 'skipped',
        message: 'El credito A8 ya no conserva saldo suficiente para esta factura.',
      })
      continue
    }

    if (options.dryRun) {
      results.push({
        ...baseResult,
        status: 'dry_run',
        message:
          `A8 aplicaria ${targetAmount.toFixed(2)} del ${currentCredit.transactionType ?? 'credito'} ` +
          `${currentCredit.tranId ?? currentCredit.transactionId} a la factura ${summary.tranId ?? summary.internalId}; ` +
          `quedaria remanente ${Math.max(0, (currentCredit.availableAmount ?? 0) - targetAmount).toFixed(2)}.`,
      })
      continue
    }

    try {
      const memo = [
        'Auto A8',
        summary.tranId ?? summary.transactionNumber ?? summary.internalId,
        currentCredit.tranId ?? currentCredit.transactionId,
      ]
        .filter(Boolean)
        .join(' | ')
      const expectedRemainingAmount = Math.max(0, (currentCredit.availableAmount ?? 0) - targetAmount)

      const payment =
        currentCredit.transactionType === 'CustCred'
          ? null
          : await createCustomerPaymentUsingCredit(
              client,
              summary,
              currentCredit.transactionId,
              targetAmount,
              memo,
              currentCredit.transactionDate,
            )

      if (currentCredit.transactionType === 'CustCred') {
        await applyCreditMemoToInvoice(client, currentCredit.transactionId, summary, targetAmount)
      }

      await verifyInvoiceRemainingAmount(
        client,
        summary,
        0,
        `la aplicacion A8 de la factura ${summary.tranId ?? summary.internalId}`,
      )
      if (currentCredit.transactionType === 'CustCred') {
        await verifyCreditMemoRemainingAmount(
          client,
          currentCredit.transactionId,
          expectedRemainingAmount,
          `la aplicacion A8 de la nota de credito ${currentCredit.tranId ?? currentCredit.transactionId}`,
        )
      } else {
        await verifyCreditRemainingAmount(
          client,
          {
            id: currentCredit.transactionId,
            documento: currentCredit.tranId,
            tipoTransaccion: currentCredit.transactionType,
            clienteId: currentCredit.customerId,
            clienteNombre: currentCredit.customerName,
            fecha: parseNetSuiteDate(currentCredit.transactionDate),
            periodoContableId: currentCredit.postingPeriodId,
            periodoContableNombre: currentCredit.postingPeriodName,
            monedaId: currentCredit.currencyId,
            moneda: currentCredit.currencyName,
            montoCredito: currentCredit.creditAmount,
            montoAplicado: currentCredit.appliedAmount,
            montoDisponible: currentCredit.availableAmount,
            cumplePpd1: false,
            cumpleA1: false,
            cumpleA2: false,
            cumpleA3: false,
          },
          expectedRemainingAmount,
          `la aplicacion A8 del credito ${currentCredit.tranId ?? currentCredit.transactionId}`,
        )
      }

      results.push({
        ...baseResult,
        status: 'applied',
        message: `La factura A8 quedo aplicada con ${currentCredit.transactionType ?? 'credito'} ${currentCredit.tranId ?? currentCredit.transactionId}.`,
        customerPaymentId: payment?.id ?? null,
        customerPaymentTranId: payment?.tranId ?? null,
      })
    } catch (error) {
      results.push({
        ...baseResult,
        status: 'failed',
        message: error instanceof Error ? error.message : 'Unknown NetSuite A8 apply error.',
      })
    }
  }

  return results
}

function getGroupedOrderExpectedCreditRemaining(
  context: FacturaA4Context,
  ruleCode: 'A4' | 'A5' | 'A7',
  groupTotal: number,
) {
  if (context.creditAvailableAmount === null) {
    return null
  }

  if (ruleCode === 'A4') {
    return amountsMatchExactly(context.creditAvailableAmount, groupTotal) ? 0 : null
  }

  if (ruleCode === 'A7') {
    return context.creditAvailableAmount - groupTotal > OPEN_AMOUNT_TOLERANCE
      ? context.creditAvailableAmount - groupTotal
      : null
  }

  if (
    context.salesOrderTotal === null ||
    !amountMatchesA5SalesOrderTotal(
      context.creditAvailableAmount,
      context.salesOrderTotal,
      context.currencyId,
      context.currencyName,
    ) ||
    context.creditAvailableAmount - groupTotal <= OPEN_AMOUNT_TOLERANCE
  ) {
    return null
  }

  return context.creditAvailableAmount - groupTotal
}

async function applyFacturaA2(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  situacion: FacturaSituacion,
  options: { dryRun: boolean },
): Promise<FacturaAplicacionA1ItemResult> {
  const a2Candidates = situacion.candidatos.filter((candidato) => candidato.cumpleA2)
  const baseResult = {
    invoiceInternalId: summary.internalId,
    invoiceDocument: summary.tranId ?? summary.transactionNumber,
    creditTransactionId: a2Candidates[0]?.id ?? null,
    creditDocument: a2Candidates[0]?.documento ?? null,
    creditType: a2Candidates[0]?.tipoTransaccion ?? null,
  }

  if (a2Candidates.length === 0) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'La factura ya no conserva un credito A2 vivo al momento de ejecutar.',
    }
  }

  if (a2Candidates.length > 1) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'La factura tiene varios creditos A2 y requiere revision manual.',
    }
  }

  const candidate = a2Candidates[0]
  const targetAmount = getFacturaTargetAmount(summary)
  const difference = getAmountDifference(targetAmount, candidate.montoDisponible)

  if (difference === null || !amountDifferenceQualifiesForA2(targetAmount, candidate.montoDisponible)) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'La diferencia A2 ya no esta dentro del margen operativo configurado.',
    }
  }

  if (candidate.tipoTransaccion !== 'Journal') {
    return {
      ...baseResult,
      status: 'skipped',
      message: `El tipo ${candidate.tipoTransaccion ?? 'desconocido'} aun no esta soportado para aplicacion automatica A2.`,
    }
  }

  if (options.dryRun) {
    return {
      ...baseResult,
      status: 'dry_run',
      message:
        difference > 0
          ? 'La factura es mayor al credito; se aplicaria el diario y luego un pago de redondeo.'
          : 'El credito es mayor a la factura; se ajustaria primero el diario y luego se aplicaria a la factura.',
    }
  }

  try {
    const payment = difference > 0
      ? await applyA2WhenInvoiceIsHigher(client, summary, candidate, targetAmount, difference)
      : await applyA2WhenCreditIsHigher(client, summary, candidate, targetAmount, Math.abs(difference))

    return {
      ...baseResult,
      status: 'applied',
      message: 'La factura A2 quedo conciliada en NetSuite con su tratamiento de redondeo.',
      customerPaymentId: payment.id,
      customerPaymentTranId: payment.tranId,
    }
  } catch (error) {
    return {
      ...baseResult,
      status: 'failed',
      message: error instanceof Error ? error.message : 'Unknown NetSuite A2 apply error.',
    }
  }
}

async function applyFacturaA3(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  situacion: FacturaSituacion,
  options: { dryRun: boolean },
): Promise<FacturaAplicacionA1ItemResult> {
  const a3Candidates = situacion.candidatos.filter((candidato) => candidato.cumpleA3)
  const baseResult = {
    invoiceInternalId: summary.internalId,
    invoiceDocument: summary.tranId ?? summary.transactionNumber,
    creditTransactionId: a3Candidates[0]?.id ?? null,
    creditDocument: a3Candidates[0]?.documento ?? null,
    creditType: a3Candidates[0]?.tipoTransaccion ?? null,
  }

  if (a3Candidates.length === 0) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'La factura ya no conserva un credito A3 vivo al momento de ejecutar.',
    }
  }

  if (a3Candidates.length > 1) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'La factura tiene varios creditos A3 y requiere revision manual.',
    }
  }

  const candidate = a3Candidates[0]
  const targetAmount = getFacturaTargetAmount(summary)
  const difference = getAmountDifference(targetAmount, candidate.montoDisponible)

  if (difference === null || !amountDifferenceQualifiesForA3(targetAmount, candidate.montoDisponible)) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'La diferencia A3 ya no esta dentro del margen operativo configurado.',
    }
  }

  if (candidate.tipoTransaccion !== 'Journal') {
    return {
      ...baseResult,
      status: 'skipped',
      message: `El tipo ${candidate.tipoTransaccion ?? 'desconocido'} aun no esta soportado para aplicacion automatica A3.`,
    }
  }

  if (options.dryRun) {
    return {
      ...baseResult,
      status: 'dry_run',
      message:
        difference > 0
          ? 'La factura es mayor al credito; se aplicaria el diario y luego un pago de redondeo.'
          : 'El credito es mayor a la factura; se ajustaria primero el diario y luego se aplicaria a la factura.',
    }
  }

  try {
    const payment =
      difference > 0
        ? await applyA2WhenInvoiceIsHigher(client, summary, candidate, targetAmount, difference)
        : await applyA2WhenCreditIsHigher(client, summary, candidate, targetAmount, Math.abs(difference))

    return {
      ...baseResult,
      status: 'applied',
      message: 'La factura A3 quedo conciliada en NetSuite con su tratamiento de redondeo.',
      customerPaymentId: payment.id,
      customerPaymentTranId: payment.tranId,
    }
  } catch (error) {
    return {
      ...baseResult,
      status: 'failed',
      message: error instanceof Error ? error.message : 'Unknown NetSuite A3 apply error.',
    }
  }
}

async function applyFacturaK(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  situacion: FacturaSituacion,
  options: { dryRun: boolean },
): Promise<FacturaAplicacionA1ItemResult> {
  const k = situacion.k
  const baseResult = {
    invoiceInternalId: summary.internalId,
    invoiceDocument: summary.tranId ?? summary.transactionNumber,
    sourceInvoiceInternalId: k?.salesOrderInternalId ?? null,
    sourceInvoiceDocument: k?.salesOrderDocument ?? null,
    creditTransactionId: k?.journalTransactionId ?? null,
    creditDocument: k?.journalDocument ?? null,
    creditType: k?.journalTransactionId ? 'Journal' : null,
  }

  if (!k) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'La factura ya no conserva un contexto Kontempo vivo al momento de ejecutar.',
    }
  }

  if (k.requiresManualIntervention) {
    return {
      ...baseResult,
      status: 'skipped',
      message:
        k.manualReason ??
        'El caso Kontempo requiere intervencion manual porque no existe trazabilidad deterministica con orden de venta en NetSuite.',
    }
  }

  if (!isFacturaPpd(summary)) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'K solo opera sobre facturas PPD; la factura ya no cumple ese candado.',
    }
  }

  let paymentInstruction: KontempoJournalPaymentInstruction
  try {
    paymentInstruction = await resolveKontempoJournalPaymentInstruction(client, summary, k, {
      allowPrepare: !options.dryRun,
    })
  } catch (error) {
    return {
      ...baseResult,
      status: 'failed',
      message: error instanceof Error ? error.message : 'Unknown Kontempo journal resolution error.',
    }
  }

  const existingPayments = await fetchLinkedCustomerPaymentsForInvoice(client, summary.internalId)
  const existingPayment = selectCustomerPaymentMatch(
    existingPayments,
    paymentInstruction.paymentAmount,
    paymentInstruction.journalTransactionDate,
    paymentInstruction.bridgeBankAccountId,
  )
  const paymentGuardrail = await resolveKontempoCustomerPaymentGuardrail(
    client,
    summary,
    paymentInstruction,
    existingPayment,
  )

  if (paymentGuardrail.collisionMessage) {
    return {
      ...baseResult,
      status: 'failed',
      message: paymentGuardrail.collisionMessage,
    }
  }

  if (options.dryRun) {
    return {
      ...baseResult,
      status: 'dry_run',
      customerPaymentId: paymentGuardrail.existingPayment?.transactionId ?? null,
      customerPaymentTranId: paymentGuardrail.existingPayment?.tranId ?? null,
      message: paymentGuardrail.existingPayment
        ? `K corregiria el pago ${paymentGuardrail.existingPayment.tranId ?? paymentGuardrail.existingPayment.transactionId} con los datos CFDI Kontempo y conservaria aplicada la factura.`
        : `K crearia un customer payment por ${paymentInstruction.paymentAmount.toFixed(2)} ${summary.currencyName ?? 'moneda'} en la fecha ${paymentInstruction.journalTransactionDate} contra el diario ${k.journalDocument ?? k.journalTransactionId}, conservando ${paymentInstruction.bridgeGrossAmount.toFixed(2)} MXN en SHQ Pago.`,
    }
  }

  try {
    const payment = await ensureKontempoCustomerPayment(
      client,
      summary,
      k,
      paymentInstruction,
      paymentGuardrail.existingPayment,
    )
    await verifyInvoiceRemainingAmount(
      client,
      summary,
      0,
      `la aplicacion K de la factura ${summary.tranId ?? summary.internalId}`,
    )

    return {
      ...baseResult,
      status: 'applied',
      message: `La factura K quedo aplicada con el pago ${payment.tranId ?? payment.id} y el perfil CFDI Kontempo correcto.`,
      customerPaymentId: payment.id,
      customerPaymentTranId: payment.tranId,
    }
  } catch (error) {
    return {
      ...baseResult,
      status: 'failed',
      message: error instanceof Error ? error.message : 'Unknown NetSuite K apply error.',
    }
  }
}

async function applyFacturaPpd1(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  situacion: FacturaSituacion,
  options: { dryRun: boolean },
): Promise<FacturaAplicacionA1ItemResult> {
  const ppd1Candidates = situacion.candidatos.filter((candidato) => candidato.cumplePpd1)
  const baseResult = {
    invoiceInternalId: summary.internalId,
    invoiceDocument: summary.tranId ?? summary.transactionNumber,
    creditTransactionId: ppd1Candidates[0]?.id ?? null,
    creditDocument: ppd1Candidates[0]?.documento ?? null,
    creditType: ppd1Candidates[0]?.tipoTransaccion ?? null,
  }

  if (!isFacturaPpd(summary)) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'PPD1 solo opera sobre facturas PPD; la factura ya no cumple ese candado.',
    }
  }

  if (ppd1Candidates.length === 0) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'La factura ya no conserva un diario PPD1 vivo al momento de ejecutar.',
    }
  }

  const targetAmount = getFacturaTargetAmount(summary)
  const resolvedCandidate = await resolvePpd1CandidateForExecution(client, summary, ppd1Candidates, targetAmount)
  if (!resolvedCandidate) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'La factura tiene varios diarios exactos PPD1 y requiere revision manual.',
    }
  }

  const candidate = resolvedCandidate
  if (!amountsMatchExactly(targetAmount, candidate.montoDisponible)) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'El monto disponible del diario ya no coincide exactamente con la factura PPD1.',
    }
  }

  if (candidate.tipoTransaccion !== 'Journal') {
    return {
      ...baseResult,
      status: 'skipped',
      message: `El tipo ${candidate.tipoTransaccion ?? 'desconocido'} aun no esta soportado para aplicacion automatica PPD1.`,
    }
  }

  let instruction: Ppd1JournalPaymentInstruction
  try {
    instruction = await resolvePpd1JournalPaymentInstruction(client, summary, candidate, {
      allowPrepare: !options.dryRun,
    })
  } catch (error) {
    return {
      ...baseResult,
      status: 'failed',
      message: error instanceof Error ? error.message : 'Unknown PPD1 journal resolution error.',
    }
  }

  const existingPayments = await fetchLinkedCustomerPaymentsForInvoice(client, summary.internalId)
  const existingPayment = selectCustomerPaymentMatch(
    existingPayments,
    instruction.paymentAmount,
    instruction.journalTransactionDate,
    instruction.bridgeBankAccountId,
  )
  const paymentGuardrail = await resolvePpd1CustomerPaymentGuardrail(
    client,
    summary,
    instruction,
    existingPayment,
  )

  if (paymentGuardrail.collisionMessage) {
    return {
      ...baseResult,
      status: 'failed',
      message: paymentGuardrail.collisionMessage,
    }
  }

  if (options.dryRun) {
    return {
      ...baseResult,
      status: 'dry_run',
      customerPaymentId: paymentGuardrail.existingPayment?.transactionId ?? null,
      customerPaymentTranId: paymentGuardrail.existingPayment?.tranId ?? null,
      message: paymentGuardrail.existingPayment
        ? `PPD1 corregiria el pago ${paymentGuardrail.existingPayment.tranId ?? paymentGuardrail.existingPayment.transactionId} con el perfil CFDI completo y conservaria aplicada la factura.`
        : `PPD1 homologaria el diario ${candidate.documento ?? candidate.id} a banco puente y crearia un customer payment exacto por ${instruction.paymentAmount.toFixed(2)} ${summary.currencyName ?? 'moneda'}.`,
    }
  }

  try {
    const payment = await ensurePpd1CustomerPayment(
      client,
      summary,
      instruction,
      paymentGuardrail.existingPayment,
    )
    await verifyInvoiceRemainingAmount(
      client,
      summary,
      0,
      `la aplicacion PPD1 de la factura ${summary.tranId ?? summary.internalId}`,
    )

    return {
      ...baseResult,
      status: 'applied',
      message: `La factura PPD1 quedo aplicada con el pago ${payment.tranId ?? payment.id} y lista para timbrado manual.`,
      customerPaymentId: payment.id,
      customerPaymentTranId: payment.tranId,
    }
  } catch (error) {
    return {
      ...baseResult,
      status: 'failed',
      message: error instanceof Error ? error.message : 'Unknown NetSuite PPD1 apply error.',
    }
  }
}

async function applyFacturaA1(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  situacion: FacturaSituacion,
  options: { dryRun: boolean },
): Promise<FacturaAplicacionA1ItemResult> {
  const exactCandidates = situacion.candidatos.filter((candidato) => candidato.cumpleA1)
  const baseResult = {
    invoiceInternalId: summary.internalId,
    invoiceDocument: summary.tranId ?? summary.transactionNumber,
    creditTransactionId: exactCandidates[0]?.id ?? null,
    creditDocument: exactCandidates[0]?.documento ?? null,
    creditType: exactCandidates[0]?.tipoTransaccion ?? null,
  }

  if (exactCandidates.length === 0) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'La factura ya no conserva un credito A1 vivo al momento de ejecutar.',
    }
  }

  if (exactCandidates.length > 1) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'La factura tiene varios creditos exactos A1 y requiere revision manual.',
    }
  }

  const candidate = exactCandidates[0]
  const targetAmount = getFacturaTargetAmount(summary)

  if (!amountsMatchExactly(targetAmount, candidate.montoDisponible)) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'El monto disponible del credito ya no coincide exactamente con la factura.',
    }
  }

  if (candidate.tipoTransaccion !== 'Journal') {
    return {
      ...baseResult,
      status: 'skipped',
      message: `El tipo ${candidate.tipoTransaccion ?? 'desconocido'} aun no esta soportado para aplicacion automatica A1.`,
    }
  }

  if (options.dryRun) {
    return {
      ...baseResult,
      status: 'dry_run',
      message: 'La transaccion A1 pasaria todas las validaciones y se aplicaria en NetSuite.',
    }
  }

  try {
    const payment = await createA1CustomerPayment(client, summary, candidate, targetAmount)

    return {
      ...baseResult,
      status: 'applied',
      message: 'La factura y el credito quedaron aplicados en NetSuite.',
      customerPaymentId: payment.id,
      customerPaymentTranId: payment.tranId,
    }
  } catch (error) {
    return {
      ...baseResult,
      status: 'failed',
      message: error instanceof Error ? error.message : 'Unknown NetSuite A1 apply error.',
    }
  }
}

async function applyFacturaA6(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  situacion: FacturaSituacion,
  options: { dryRun: boolean },
): Promise<FacturaAplicacionA1ItemResult> {
  const a6 = situacion.a6
  const baseResult = {
    invoiceInternalId: summary.internalId,
    invoiceDocument: summary.tranId ?? summary.transactionNumber,
    sourceInvoiceInternalId: a6?.salesOrderInternalId ?? null,
    sourceInvoiceDocument: a6?.salesOrderDocument ?? null,
    creditTransactionId: a6?.creditTransactionId ?? null,
    creditDocument: a6?.creditDocument ?? null,
    creditType: a6?.creditType ?? null,
  }

  if (!a6) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'La factura ya no cumple las condiciones A6 al momento de ejecutar.',
    }
  }

  const targetAmount = getFacturaTargetAmount(summary)
  if (!amountsMatchExactly(targetAmount, a6.groupTotal)) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'El monto objetivo de la factura ya no coincide con el contexto A6 detectado.',
    }
  }

  const currentCredit = await fetchCreditoAplicableActual(client, a6.creditTransactionId, summary.customerId)
  if (!currentCredit) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'El credito A6 ya no existe o ya no esta disponible en Clientes nacionales.',
    }
  }

  if (currentCredit.transactionType !== 'Journal') {
    return {
      ...baseResult,
      status: 'skipped',
      message: `El credito A6 ${currentCredit.tranId ?? currentCredit.transactionId} ya no es un diario soportado.`,
    }
  }

  if (
    !matchesByIdentity(
      summary.postingPeriodId,
      currentCredit.postingPeriodId,
      summary.postingPeriodName,
      currentCredit.postingPeriodName,
    ) ||
    !matchesByIdentity(summary.currencyId, currentCredit.currencyId, summary.currencyName, currentCredit.currencyName) ||
    (currentCredit.availableAmount ?? 0) - (targetAmount ?? 0) <= OPEN_AMOUNT_TOLERANCE
  ) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'El credito A6 ya no conserva un remanente suficiente en el mismo periodo y moneda.',
    }
  }

  const expectedRemainingAmount = (currentCredit.availableAmount ?? 0) - (targetAmount ?? 0)
  if (options.dryRun) {
    return {
      ...baseResult,
      status: 'dry_run',
      message:
        `A6 aplicaria ${targetAmount?.toFixed(2)} del diario ${currentCredit.tranId ?? currentCredit.transactionId} ` +
        `a la factura ${summary.tranId ?? summary.internalId}; quedaria remanente ${expectedRemainingAmount.toFixed(2)}.`,
    }
  }

  try {
    const payment = await createCustomerPaymentUsingCredit(
      client,
      summary,
      currentCredit.transactionId,
      targetAmount ?? 0,
      ['Auto A6', summary.tranId ?? summary.transactionNumber ?? summary.internalId, currentCredit.tranId ?? currentCredit.transactionId]
        .filter(Boolean)
        .join(' | '),
      summary.transactionDate,
    )

    await verifyInvoiceRemainingAmount(
      client,
      summary,
      0,
      `la aplicacion A6 de la factura ${summary.tranId ?? summary.internalId}`,
    )
    await verifyCreditRemainingAmount(
      client,
      {
        id: currentCredit.transactionId,
        documento: currentCredit.tranId,
        tipoTransaccion: currentCredit.transactionType,
        clienteId: currentCredit.customerId,
        clienteNombre: currentCredit.customerName,
        fecha: parseNetSuiteDate(currentCredit.transactionDate),
        periodoContableId: currentCredit.postingPeriodId,
        periodoContableNombre: currentCredit.postingPeriodName,
        monedaId: currentCredit.currencyId,
        moneda: currentCredit.currencyName,
        montoCredito: currentCredit.creditAmount,
        montoAplicado: currentCredit.appliedAmount,
        montoDisponible: currentCredit.availableAmount,
        cumplePpd1: false,
        cumpleA1: false,
        cumpleA2: false,
        cumpleA3: false,
      },
      expectedRemainingAmount,
      `la aplicacion A6 del credito ${currentCredit.tranId ?? currentCredit.transactionId}`,
    )

    return {
      ...baseResult,
      status: 'applied',
      message: 'La factura A6 quedo aplicada en NetSuite y el diario conserva remanente.',
      customerPaymentId: payment.id,
      customerPaymentTranId: payment.tranId,
    }
  } catch (error) {
    return {
      ...baseResult,
      status: 'failed',
      message: error instanceof Error ? error.message : 'Unknown NetSuite A6 apply error.',
    }
  }
}

async function applyFacturaB1(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  situacion: FacturaSituacion,
  options: { dryRun: boolean },
): Promise<FacturaAplicacionA1ItemResult> {
  const b1 = situacion.b1
  const baseResult = {
    invoiceInternalId: summary.internalId,
    invoiceDocument: summary.tranId ?? summary.transactionNumber,
    creditTransactionId: b1?.originalCreditTransactionId ?? null,
    creditDocument: b1?.originalCreditDocument ?? null,
    creditType: b1?.originalCreditType ?? null,
  }

  if (!b1) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'La factura ya no cumple las condiciones B1 al momento de ejecutar.',
    }
  }

  const targetAmount = getFacturaTargetAmount(summary)
  if (!amountsMatchExactly(targetAmount, b1.targetAmount)) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'El monto objetivo de la factura ya no coincide con el contexto B1 detectado.',
    }
  }

  const currentCredit = await fetchCreditoAplicableActual(client, b1.originalCreditTransactionId, summary.customerId)
  if (!currentCredit) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'El credito B1 ya no existe o ya no esta disponible en Clientes nacionales.',
    }
  }

  if (currentCredit.transactionType !== 'Journal') {
    return {
      ...baseResult,
      status: 'skipped',
      message: `El credito B1 ${currentCredit.tranId ?? currentCredit.transactionId} ya no es un diario soportado para el puente entre periodos.`,
    }
  }

  if (
    !amountsMatchExactly(targetAmount, currentCredit.availableAmount) ||
    matchesByIdentity(
      summary.postingPeriodId,
      currentCredit.postingPeriodId,
      summary.postingPeriodName,
      currentCredit.postingPeriodName,
    ) ||
    !isCrossPeriodCreditEarlier(summary, currentCredit)
  ) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'El credito B1 ya no conserva el mismo monto exacto en un periodo contable anterior.',
    }
  }

  if (options.dryRun) {
    return {
      ...baseResult,
      status: 'dry_run',
      message:
        `B1 generaria un customer payment en ${B1_BRIDGE_BANK_ACCOUNT_DISPLAY_NAME} por ${targetAmount?.toFixed(2)} con fecha ${summary.transactionDate ?? '--'}, ` +
        `crearia un journal puente del mismo importe para debitar Clientes y acreditar el banco puente, y aplicaria ese journal al diario ${currentCredit.tranId ?? currentCredit.transactionId}.`,
    }
  }

  let stage = 'resolveB1BridgeBankAccountId'

  try {
    const bridgeBankAccountId = await resolveB1BridgeBankAccountId(client)
    stage = 'createCustomerPaymentUsingAccount'
    const bridgePayment = await createCustomerPaymentUsingAccount(
      client,
      summary,
      targetAmount ?? 0,
      bridgeBankAccountId,
      B1_BRIDGE_BANK_ACCOUNT_DISPLAY_NAME,
      ['Auto B1 pago puente', summary.tranId ?? summary.internalId, currentCredit.tranId ?? currentCredit.transactionId]
        .filter(Boolean)
      .join(' | '),
      summary.transactionDate,
    )

    stage = 'verifyInvoiceRemainingAmount'
    await verifyInvoiceRemainingAmount(
      client,
      summary,
      0,
      `el pago puente B1 de la factura ${summary.tranId ?? summary.internalId}`,
    )

    stage = 'createB1BridgeJournal'
    const bridgeJournal = await createB1BridgeJournal(
      client,
      summary,
      targetAmount ?? 0,
      bridgeBankAccountId,
      B1_BRIDGE_BANK_ACCOUNT_DISPLAY_NAME,
      currentCredit,
      'B1',
    )
    stage = 'verifyB1BridgeJournal'
    await verifyB1BridgeJournal(client, bridgeJournal.id, summary, targetAmount ?? 0, bridgeBankAccountId)

    stage = 'resolveDebitApplicationLine'
    const bridgeDebitLine = await resolveDebitApplicationLine(client, bridgeJournal.id, summary.customerId)
    stage = 'resolveCreditApplicationLine'
    const creditLine = await resolveCreditApplicationLine(client, currentCredit.transactionId, summary.customerId, {
      requireCustomerMatch: true,
    })
    stage = 'createCustomerPaymentApplyingDocumentUsingCredit'
    await createCustomerPaymentApplyingDocumentUsingCredit(
      client,
      summary,
      {
        documentId: bridgeJournal.id,
        applyLine: bridgeDebitLine,
        amount: targetAmount ?? 0,
      },
      {
        creditTransactionId: currentCredit.transactionId,
        creditLine,
        amount: targetAmount ?? 0,
      },
      ['Auto B1 aplica diario puente', summary.tranId ?? summary.internalId, bridgeJournal.tranId ?? bridgeJournal.id]
        .filter(Boolean)
      .join(' | '),
      summary.transactionDate,
    )

    stage = 'verifyCreditRemainingAmount'
    await verifyCreditRemainingAmount(
      client,
      {
        id: currentCredit.transactionId,
        documento: currentCredit.tranId,
        tipoTransaccion: currentCredit.transactionType,
        clienteId: currentCredit.customerId,
        clienteNombre: currentCredit.customerName,
        fecha: parseNetSuiteDate(currentCredit.transactionDate),
        periodoContableId: currentCredit.postingPeriodId,
        periodoContableNombre: currentCredit.postingPeriodName,
        monedaId: currentCredit.currencyId,
        moneda: currentCredit.currencyName,
        montoCredito: currentCredit.creditAmount,
        montoAplicado: currentCredit.appliedAmount,
        montoDisponible: currentCredit.availableAmount,
        cumplePpd1: false,
        cumpleA1: false,
        cumpleA2: false,
        cumpleA3: false,
      },
      0,
      `la aplicacion B1 del credito ${currentCredit.tranId ?? currentCredit.transactionId}`,
    )
    stage = 'verifyB1JournalApplication'
    await verifyB1JournalApplication(client, bridgeJournal.id, currentCredit.transactionId, targetAmount ?? 0)

    return {
      ...baseResult,
      status: 'applied',
      message:
        `La factura B1 quedo cobrada en su periodo con pago puente ${bridgePayment.tranId ?? bridgePayment.id}, ` +
        `journal puente ${bridgeJournal.tranId ?? bridgeJournal.id} y enlace al credito ${currentCredit.tranId ?? currentCredit.transactionId}.`,
      customerPaymentId: bridgePayment.id,
      customerPaymentTranId: bridgePayment.tranId,
    }
  } catch (error) {
    return {
      ...baseResult,
      status: 'failed',
      message:
        error instanceof Error
          ? `B1 failed at ${typeof stage === 'string' ? stage : 'unknown'}: ${error.message}`
          : 'Unknown NetSuite B1 apply error.',
    }
  }
}

async function applyFacturaB2(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  situacion: FacturaSituacion,
  options: { dryRun: boolean },
): Promise<FacturaAplicacionA1ItemResult> {
  const b2 = situacion.b2
  const baseResult = {
    invoiceInternalId: summary.internalId,
    invoiceDocument: summary.tranId ?? summary.transactionNumber,
    creditTransactionId: b2?.originalCreditTransactionId ?? null,
    creditDocument: b2?.originalCreditDocument ?? null,
    creditType: b2?.originalCreditType ?? null,
  }

  if (!b2) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'La factura ya no cumple las condiciones B2 al momento de ejecutar.',
    }
  }

  const targetAmount = getFacturaTargetAmount(summary)
  if (!amountsMatchExactly(targetAmount, b2.targetAmount)) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'El monto objetivo de la factura ya no coincide con el contexto B2 detectado.',
    }
  }

  const currentCredit = await fetchCreditoAplicableActual(client, b2.originalCreditTransactionId, summary.customerId)
  if (!currentCredit) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'El credito B2 ya no existe o ya no esta disponible en Clientes nacionales.',
    }
  }

  if (currentCredit.transactionType !== 'Journal') {
    return {
      ...baseResult,
      status: 'skipped',
      message: `El credito B2 ${currentCredit.tranId ?? currentCredit.transactionId} ya no es un diario soportado para el puente entre periodos.`,
    }
  }

  if (
    (currentCredit.availableAmount ?? 0) - (targetAmount ?? 0) <= OPEN_AMOUNT_TOLERANCE ||
    matchesByIdentity(
      summary.postingPeriodId,
      currentCredit.postingPeriodId,
      summary.postingPeriodName,
      currentCredit.postingPeriodName,
    ) ||
    !isCrossPeriodCreditEarlier(summary, currentCredit)
  ) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'El credito B2 ya no conserva remanente suficiente en un periodo contable anterior.',
    }
  }

  const expectedRemainingAmount = Math.max(0, (currentCredit.availableAmount ?? 0) - (targetAmount ?? 0))
  if (options.dryRun) {
    return {
      ...baseResult,
      status: 'dry_run',
      message:
        `B2 generaria un customer payment en ${B1_BRIDGE_BANK_ACCOUNT_DISPLAY_NAME} por ${targetAmount?.toFixed(2)} con fecha ${summary.transactionDate ?? '--'}, ` +
        `crearia un journal puente del mismo importe para debitar Clientes y acreditar el banco puente, y aplicaria ${targetAmount?.toFixed(2)} del diario ${currentCredit.tranId ?? currentCredit.transactionId} dejando remanente ${expectedRemainingAmount.toFixed(2)}.`,
    }
  }

  let stage = 'resolveB1BridgeBankAccountId'

  try {
    const bridgeBankAccountId = await resolveB1BridgeBankAccountId(client)
    stage = 'createCustomerPaymentUsingAccount'
    const bridgePayment = await createCustomerPaymentUsingAccount(
      client,
      summary,
      targetAmount ?? 0,
      bridgeBankAccountId,
      B1_BRIDGE_BANK_ACCOUNT_DISPLAY_NAME,
      ['Auto B2 pago puente', summary.tranId ?? summary.internalId, currentCredit.tranId ?? currentCredit.transactionId]
        .filter(Boolean)
        .join(' | '),
      summary.transactionDate,
    )

    stage = 'verifyInvoiceRemainingAmount'
    await verifyInvoiceRemainingAmount(
      client,
      summary,
      0,
      `el pago puente B2 de la factura ${summary.tranId ?? summary.internalId}`,
    )

    stage = 'createB1BridgeJournal'
    const bridgeJournal = await createB1BridgeJournal(
      client,
      summary,
      targetAmount ?? 0,
      bridgeBankAccountId,
      B1_BRIDGE_BANK_ACCOUNT_DISPLAY_NAME,
      currentCredit,
      'B2',
    )
    stage = 'verifyB1BridgeJournal'
    await verifyB1BridgeJournal(client, bridgeJournal.id, summary, targetAmount ?? 0, bridgeBankAccountId)

    stage = 'resolveDebitApplicationLine'
    const bridgeDebitLine = await resolveDebitApplicationLine(client, bridgeJournal.id, summary.customerId)
    stage = 'resolveCreditApplicationLine'
    const creditLine = await resolveCreditApplicationLine(client, currentCredit.transactionId, summary.customerId, {
      requireCustomerMatch: true,
    })
    stage = 'createCustomerPaymentApplyingDocumentUsingCredit'
    await createCustomerPaymentApplyingDocumentUsingCredit(
      client,
      summary,
      {
        documentId: bridgeJournal.id,
        applyLine: bridgeDebitLine,
        amount: targetAmount ?? 0,
      },
      {
        creditTransactionId: currentCredit.transactionId,
        creditLine,
        amount: targetAmount ?? 0,
      },
      ['Auto B2 aplica diario puente', summary.tranId ?? summary.internalId, bridgeJournal.tranId ?? bridgeJournal.id]
        .filter(Boolean)
        .join(' | '),
      summary.transactionDate,
    )

    stage = 'verifyCreditRemainingAmount'
    await verifyCreditRemainingAmount(
      client,
      {
        id: currentCredit.transactionId,
        documento: currentCredit.tranId,
        tipoTransaccion: currentCredit.transactionType,
        clienteId: currentCredit.customerId,
        clienteNombre: currentCredit.customerName,
        fecha: parseNetSuiteDate(currentCredit.transactionDate),
        periodoContableId: currentCredit.postingPeriodId,
        periodoContableNombre: currentCredit.postingPeriodName,
        monedaId: currentCredit.currencyId,
        moneda: currentCredit.currencyName,
        montoCredito: currentCredit.creditAmount,
        montoAplicado: currentCredit.appliedAmount,
        montoDisponible: currentCredit.availableAmount,
        cumplePpd1: false,
        cumpleA1: false,
        cumpleA2: false,
        cumpleA3: false,
      },
      expectedRemainingAmount,
      `la aplicacion B2 del credito ${currentCredit.tranId ?? currentCredit.transactionId}`,
    )
    stage = 'verifyB1JournalApplication'
    await verifyB1JournalApplication(client, bridgeJournal.id, currentCredit.transactionId, targetAmount ?? 0)

    return {
      ...baseResult,
      status: 'applied',
      message:
        `La factura B2 quedo cobrada en su periodo con pago puente ${bridgePayment.tranId ?? bridgePayment.id}, ` +
        `journal puente ${bridgeJournal.tranId ?? bridgeJournal.id} y remanente ${expectedRemainingAmount.toFixed(2)} vivo en el credito ${currentCredit.tranId ?? currentCredit.transactionId}.`,
      customerPaymentId: bridgePayment.id,
      customerPaymentTranId: bridgePayment.tranId,
    }
  } catch (error) {
    return {
      ...baseResult,
      status: 'failed',
      message:
        error instanceof Error
          ? `B2 failed at ${typeof stage === 'string' ? stage : 'unknown'}: ${error.message}`
          : 'Unknown NetSuite B2 apply error.',
    }
  }
}

async function applyFacturaB3Group(
  client: NetSuiteClient,
  summaries: FacturaOpenSummaryRow[],
  context: FacturaB3Context,
  options: { dryRun: boolean },
): Promise<GroupApplyOutcome> {
  const sortedSummaries = [...summaries].sort((left, right) => {
    const leftDate = getComparableDateValue(left.transactionDate)
    const rightDate = getComparableDateValue(right.transactionDate)
    if (leftDate !== rightDate) {
      return leftDate - rightDate
    }

    return (left.tranId ?? left.transactionNumber ?? left.internalId).localeCompare(
      right.tranId ?? right.transactionNumber ?? right.internalId,
      'es',
    )
  })

  const baseResults = sortedSummaries.map((summary) => ({
    invoiceInternalId: summary.internalId,
    invoiceDocument: summary.tranId ?? summary.transactionNumber,
    groupInvoiceInternalIds: context.invoices.map((invoice) => invoice.internalId),
    groupInvoiceDocuments: context.invoices.map((invoice) => invoice.documento),
    sourceInvoiceInternalId: context.salesOrderInternalId || null,
    sourceInvoiceDocument: context.salesOrderDocument,
    creditTransactionId: context.originalCreditTransactionId,
    creditDocument: context.originalCreditDocument,
    creditType: context.originalCreditType,
  }))

  if (sortedSummaries.length < 2) {
    return {
      items: baseResults.map((baseResult) => ({
        ...baseResult,
        status: 'skipped',
        message: 'El grupo B3 ya no contiene varias facturas abiertas al momento de ejecutar.',
      })),
      warnings: [],
    }
  }

  if (context.originalCreditType !== 'Journal') {
    return {
      items: baseResults.map((baseResult) => ({
        ...baseResult,
        status: 'skipped',
        message: `El tipo ${context.originalCreditType ?? 'desconocido'} aun no esta soportado para aplicacion automatica B3.`,
      })),
      warnings: [],
    }
  }

  const groupTotal = sortedSummaries.reduce((sum, summary) => sum + (getFacturaTargetAmount(summary) ?? 0), 0)
  if (!amountsMatchExactly(groupTotal, context.groupTotal)) {
    return {
      items: baseResults.map((baseResult) => ({
        ...baseResult,
        status: 'skipped',
        message: 'El total vivo del grupo B3 ya no coincide con el grupo detectado.',
      })),
      warnings: [],
    }
  }

  const firstCredit = await fetchCreditoAplicableActual(
    client,
    context.originalCreditTransactionId,
    context.customerId,
  )
  if (!firstCredit) {
    return {
      items: baseResults.map((baseResult) => ({
        ...baseResult,
        status: 'skipped',
        message: 'El diario B3 ya no existe o ya no esta disponible en Clientes nacionales.',
      })),
      warnings: [],
    }
  }

  if (firstCredit.transactionType !== 'Journal') {
    return {
      items: baseResults.map((baseResult) => ({
        ...baseResult,
        status: 'skipped',
        message: `El credito B3 ${firstCredit.tranId ?? firstCredit.transactionId} ya no es un diario soportado para el puente entre periodos.`,
      })),
      warnings: [],
    }
  }

  if (
    matchesByIdentity(
      context.invoicePeriodId,
      firstCredit.postingPeriodId,
      context.invoicePeriodName,
      firstCredit.postingPeriodName,
    ) ||
    !isCrossPeriodCreditEarlier(sortedSummaries[0], firstCredit)
  ) {
    return {
      items: baseResults.map((baseResult) => ({
        ...baseResult,
        status: 'skipped',
        message: 'El diario B3 ya no se encuentra en un periodo contable anterior al grupo de facturas.',
      })),
      warnings: [],
    }
  }

  if (!amountsMatchExactly(firstCredit.creditAmount, context.salesOrderTotal)) {
    return {
      items: baseResults.map((baseResult) => ({
        ...baseResult,
        status: 'skipped',
        message: 'El monto original del diario B3 ya no coincide exactamente con la orden de venta detectada.',
      })),
      warnings: [],
    }
  }

  if (!amountsMatchExactly(firstCredit.availableAmount, groupTotal)) {
    return {
      items: baseResults.map((baseResult) => ({
        ...baseResult,
        status: 'skipped',
        message: 'El disponible actual del diario B3 ya no coincide exactamente con el grupo abierto de la orden.',
      })),
      warnings: [],
    }
  }

  if (options.dryRun) {
    let remainingAmount = firstCredit.availableAmount ?? 0
    return {
      items: sortedSummaries.map((summary, index) => {
        const targetAmount = getFacturaTargetAmount(summary) ?? 0
        const remainingAfterInvoice = Math.max(0, remainingAmount - targetAmount)
        const baseResult = baseResults[index]
        remainingAmount = remainingAfterInvoice

        return {
          ...baseResult,
          status: 'dry_run',
          message:
            `B3 generaria un customer payment en ${B1_BRIDGE_BANK_ACCOUNT_DISPLAY_NAME} por ${targetAmount.toFixed(2)} con fecha ${summary.transactionDate ?? '--'}, ` +
            `crearia un journal puente del mismo importe y aplicaria ${targetAmount.toFixed(2)} del diario ${firstCredit.tranId ?? firstCredit.transactionId}, ` +
            `dejando disponible ${remainingAfterInvoice.toFixed(2)} tras ${summary.tranId ?? summary.internalId}.`,
        }
      }),
      warnings: [],
    }
  }

  const bridgeBankAccountId = await resolveB1BridgeBankAccountId(client)
  const results: FacturaAplicacionA1ItemResult[] = []
  let stopRemainingInvoices = false

  for (let index = 0; index < sortedSummaries.length; index += 1) {
    const summary = sortedSummaries[index]
    const baseResult = baseResults[index]
    const targetAmount = getFacturaTargetAmount(summary)

    if (stopRemainingInvoices) {
      results.push({
        ...baseResult,
        status: 'skipped',
        message: 'El grupo B3 se detuvo por una falla previa y requiere revision manual antes de continuar.',
      })
      continue
    }

    if (targetAmount === null || targetAmount <= OPEN_AMOUNT_TOLERANCE) {
      results.push({
        ...baseResult,
        status: 'skipped',
        message: 'La factura B3 ya no conserva un monto objetivo valido para ejecutar el puente.',
      })
      stopRemainingInvoices = true
      continue
    }

    const currentCredit = await fetchCreditoAplicableActual(
      client,
      context.originalCreditTransactionId,
      context.customerId,
    )
    if (!currentCredit) {
      results.push({
        ...baseResult,
        status: 'skipped',
        message: 'El diario B3 ya no existe o ya no esta disponible al momento de ejecutar esta factura.',
      })
      stopRemainingInvoices = true
      continue
    }

    if (
      currentCredit.transactionType !== 'Journal' ||
      matchesByIdentity(
        context.invoicePeriodId,
        currentCredit.postingPeriodId,
        context.invoicePeriodName,
        currentCredit.postingPeriodName,
      ) ||
      !isCrossPeriodCreditEarlier(summary, currentCredit) ||
      (currentCredit.availableAmount ?? 0) + OPEN_AMOUNT_TOLERANCE < targetAmount
    ) {
      results.push({
        ...baseResult,
        status: 'skipped',
        message: 'El diario B3 ya no cumple los candados de periodo anterior y cobertura suficiente para esta factura.',
      })
      stopRemainingInvoices = true
      continue
    }

    const expectedRemainingAmount = Math.max(0, (currentCredit.availableAmount ?? 0) - targetAmount)
    let stage = 'createCustomerPaymentUsingAccount'

    try {
      const bridgePayment = await createCustomerPaymentUsingAccount(
        client,
        summary,
        targetAmount,
        bridgeBankAccountId,
        B1_BRIDGE_BANK_ACCOUNT_DISPLAY_NAME,
        ['Auto B3 pago puente', summary.tranId ?? summary.internalId, currentCredit.tranId ?? currentCredit.transactionId]
          .filter(Boolean)
          .join(' | '),
        summary.transactionDate,
      )

      stage = 'verifyInvoiceRemainingAmount'
      await verifyInvoiceRemainingAmount(
        client,
        summary,
        0,
        `el pago puente B3 de la factura ${summary.tranId ?? summary.internalId}`,
      )

      stage = 'createB1BridgeJournal'
      const bridgeJournal = await createB1BridgeJournal(
        client,
        summary,
        targetAmount,
        bridgeBankAccountId,
        B1_BRIDGE_BANK_ACCOUNT_DISPLAY_NAME,
        currentCredit,
        'B3',
      )
      stage = 'verifyB1BridgeJournal'
      await verifyB1BridgeJournal(client, bridgeJournal.id, summary, targetAmount, bridgeBankAccountId)

      stage = 'resolveDebitApplicationLine'
      const bridgeDebitLine = await resolveDebitApplicationLine(client, bridgeJournal.id, summary.customerId)
      stage = 'resolveCreditApplicationLine'
      const creditLine = await resolveCreditApplicationLine(client, currentCredit.transactionId, summary.customerId, {
        requireCustomerMatch: true,
      })
      stage = 'createCustomerPaymentApplyingDocumentUsingCredit'
      await createCustomerPaymentApplyingDocumentUsingCredit(
        client,
        summary,
        {
          documentId: bridgeJournal.id,
          applyLine: bridgeDebitLine,
          amount: targetAmount,
        },
        {
          creditTransactionId: currentCredit.transactionId,
          creditLine,
          amount: targetAmount,
        },
        ['Auto B3 aplica diario puente', summary.tranId ?? summary.internalId, bridgeJournal.tranId ?? bridgeJournal.id]
          .filter(Boolean)
          .join(' | '),
        summary.transactionDate,
      )

      stage = 'verifyCreditRemainingAmount'
      await verifyCreditRemainingAmount(
        client,
        {
          id: currentCredit.transactionId,
          documento: currentCredit.tranId,
          tipoTransaccion: currentCredit.transactionType,
          clienteId: currentCredit.customerId,
          clienteNombre: currentCredit.customerName,
          fecha: parseNetSuiteDate(currentCredit.transactionDate),
          periodoContableId: currentCredit.postingPeriodId,
          periodoContableNombre: currentCredit.postingPeriodName,
          monedaId: currentCredit.currencyId,
          moneda: currentCredit.currencyName,
          montoCredito: currentCredit.creditAmount,
          montoAplicado: currentCredit.appliedAmount,
          montoDisponible: currentCredit.availableAmount,
          cumplePpd1: false,
          cumpleA1: false,
          cumpleA2: false,
          cumpleA3: false,
        },
        expectedRemainingAmount,
        `la aplicacion B3 del credito ${currentCredit.tranId ?? currentCredit.transactionId}`,
      )
      stage = 'verifyB1JournalApplication'
      await verifyB1JournalApplication(client, bridgeJournal.id, currentCredit.transactionId, targetAmount)

      results.push({
        ...baseResult,
        status: 'applied',
        message:
          `La factura B3 quedo cobrada en su periodo con pago puente ${bridgePayment.tranId ?? bridgePayment.id}, ` +
          `journal puente ${bridgeJournal.tranId ?? bridgeJournal.id} y disponible ${expectedRemainingAmount.toFixed(2)} vivo en el diario ${currentCredit.tranId ?? currentCredit.transactionId}.`,
        customerPaymentId: bridgePayment.id,
        customerPaymentTranId: bridgePayment.tranId,
      })
    } catch (error) {
      results.push({
        ...baseResult,
        status: 'failed',
        message:
          error instanceof Error
            ? `B3 failed at ${typeof stage === 'string' ? stage : 'unknown'}: ${error.message}`
            : 'Unknown NetSuite B3 apply error.',
      })
      stopRemainingInvoices = true
    }
  }

  const warnings =
    results.length > 0 && results.every((item) => item.status === 'applied')
      ? await auditSalesOrderSettlementAfterApply(client, {
          ruleCode: 'B3',
          salesOrderInternalId: context.salesOrderInternalId,
          salesOrderDocument: context.salesOrderDocument,
          targetInvoices: context.invoices.map((invoice) => ({
            internalId: invoice.internalId,
            documento: invoice.documento,
          })),
        })
      : []

  return {
    items: results,
    warnings,
  }
}

async function applyFacturaN1(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  situacion: FacturaSituacion,
  options: { dryRun: boolean },
): Promise<FacturaAplicacionA1ItemResult> {
  const n1 = situacion.n1
  const baseResult = {
    invoiceInternalId: summary.internalId,
    invoiceDocument: summary.tranId ?? summary.transactionNumber,
    sourceInvoiceInternalId: n1?.facturaAnticipoInternalId ?? null,
    sourceInvoiceDocument: n1?.facturaAnticipoDocumento ?? null,
    creditTransactionId: n1?.notaCreditoId ?? null,
    creditDocument: n1?.notaCreditoDocumento ?? null,
    creditType: n1?.notaCreditoId ? 'CustCred' : null,
  }

  if (!n1) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'La factura ya no cumple las condiciones N1 al momento de ejecutar.',
    }
  }

  const targetAmount = getFacturaTargetAmount(summary)
  if (!amountsMatchExactly(targetAmount, n1.facturaAnticipoTotal)) {
    return {
      ...baseResult,
      status: 'skipped',
      message: 'El monto de la factura ya no coincide exactamente con la FacturaAnticipo N1.',
    }
  }

  if (options.dryRun) {
    return {
      ...baseResult,
      status: 'dry_run',
      message: n1.notaCreditoId
        ? `N1 reutilizaria la nota de credito ${n1.notaCreditoDocumento ?? n1.notaCreditoId}, la configuraria para anticipo, validaria el Related CFDI 01 hacia la factura ${summary.tranId ?? summary.internalId} y la aplicaria a la factura.`
        : `N1 transformaria la FacturaAnticipo ${n1.facturaAnticipoDocumento ?? n1.facturaAnticipoInternalId} a nota de credito, validaria el Related CFDI 01 hacia la factura ${summary.tranId ?? summary.internalId} y la aplicaria a la factura.`,
    }
  }

  try {
    const creditMemo = await ensureN1CreditMemo(client, summary, n1)
    const relatedCfdiOutcome = await ensureN1RelatedCfdi(client, creditMemo.id, summary)
    await configureN1CreditMemo(client, creditMemo.id, summary)
    await applyCreditMemoToInvoice(client, creditMemo.id, summary, targetAmount ?? 0)
    await verifyInvoiceRemainingAmount(
      client,
      summary,
      0,
      `la aplicacion N1 sobre la factura ${summary.tranId ?? summary.internalId}`,
    )
    await verifyCreditMemoRemainingAmount(
      client,
      creditMemo.id,
      0,
      `la aplicacion N1 de la nota de credito ${creditMemo.tranId ?? creditMemo.id}`,
    )
    const electronicDocumentState = await fetchCreditMemoElectronicDocumentState(client, creditMemo.id)
    const postApplyMessages = [
      formatN1RelatedCfdiOutcome(relatedCfdiOutcome),
      formatCreditMemoElectronicDocumentState(electronicDocumentState),
    ]

    return {
      ...baseResult,
      creditTransactionId: creditMemo.id,
      creditDocument: creditMemo.tranId,
      creditType: 'CustCred',
      status: 'applied',
      message: `La factura N1 quedo aplicada con la nota de credito ${creditMemo.tranId ?? creditMemo.id}. ${postApplyMessages.join(' ')}`.trim(),
    }
  } catch (error) {
    return {
      ...baseResult,
      status: 'failed',
      message: error instanceof Error ? error.message : 'Unknown NetSuite N1 apply error.',
    }
  }
}

async function ensureN1CreditMemo(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  n1: FacturaN1Context,
) {
  const existingCreditMemoId = normalizeOptionalString(n1.notaCreditoId)
  if (existingCreditMemoId) {
    const existingRecord = await fetchCreditMemoState(client, existingCreditMemoId)
    if ((existingRecord.amountRemaining ?? 0) <= OPEN_AMOUNT_TOLERANCE) {
      throw new Error(
        `La nota de credito ${existingRecord.tranId ?? existingCreditMemoId} ya no tiene saldo abierto para la factura ${summary.tranId ?? summary.internalId}.`,
      )
    }

    return existingRecord
  }

  const recipientEmail = await resolveN1TransactionRecipientEmail(client, summary)
  const transformResponse = await client.transformRecord('invoice', n1.facturaAnticipoInternalId, 'creditMemo', {
    email: recipientEmail,
  })
  const transformedRecord = getNullableRecord(transformResponse.json)
  const createdId =
    normalizeCreatedRecordId(
      getNullableString(transformedRecord?.id) ?? parseRecordIdFromLocation(transformResponse.location),
    ) ?? (await resolveLatestCreditMemoFromInvoice(client, n1.facturaAnticipoInternalId))

  if (!createdId) {
    throw new Error(
      `NetSuite transformo la FacturaAnticipo ${n1.facturaAnticipoDocumento ?? n1.facturaAnticipoInternalId}, pero no devolvio el id de la nota de credito creada.`,
    )
  }

  return fetchCreditMemoState(client, createdId)
}

async function configureN1CreditMemo(
  client: NetSuiteClient,
  creditMemoId: string,
  summary: FacturaOpenSummaryRow,
) {
  const fiscalSettings = getCurrentN1FiscalSettings()
  const recipientEmail = await resolveN1TransactionRecipientEmail(client, summary)
  const cfdiNumbering = await resolveN1CreditMemoCfdiNumbering(client, creditMemoId)
  await client.patchRecord('creditMemo', creditMemoId, {
    email: recipientEmail,
  })

  const patchPayload: Record<string, unknown> = {
    tranDate: fiscalSettings.tranDate,
    toBeEmailed: false,
    toBePrinted: false,
    toBeFaxed: false,
    custbody_psg_ei_template: {
      id: N1_CREDIT_MEMO_TEMPLATE_ID,
      refName: N1_CREDIT_MEMO_TEMPLATE_NAME,
    },
    custbody_psg_ei_sending_method: {
      id: N1_SENDING_METHOD_ID,
      refName: N1_SENDING_METHOD_NAME,
    },
    custbody_psg_ei_trans_edoc_standard: {
      id: N1_E_DOC_STANDARD_ID,
      refName: N1_E_DOC_STANDARD_NAME,
    },
    custbody_psg_ei_status: {
      id: N1_E_DOC_STATUS_PENDING_ID,
      refName: N1_E_DOC_STATUS_PENDING_NAME,
    },
    custbody_mx_cfdi_usage: {
      id: N1_CF_DI_USAGE_ID,
      refName: N1_CF_DI_USAGE_NAME,
    },
    custbody_mx_txn_sat_payment_term: {
      id: N1_PAYMENT_TERM_ID,
      refName: N1_PAYMENT_TERM_NAME,
    },
    custbody_mx_cfdi_sat_export_type: {
      id: N1_EXPORT_TYPE_ID,
      refName: N1_EXPORT_TYPE_NAME,
    },
    custbody_mcf_sat_months: {
      id: String(fiscalSettings.monthNumber),
      refName: fiscalSettings.monthName,
    },
    custbody_mcf_sat_recurrence: {
      id: N1_RECURRENCE_ID,
      refName: N1_RECURRENCE_NAME,
    },
    custbody_mcf_sat_year: fiscalSettings.year,
    custbody_mx_cfdi_serie: cfdiNumbering.serie,
    memo:
      getNullableString(summary.memo) ??
      `N1 ${summary.tranId ?? summary.internalId} | anticipo ${summary.customerName ?? summary.customerId ?? ''}`.trim(),
    custbody_psg_ei_content: null,
    custbody_psg_ei_certified_edoc: null,
    custbody_psg_ei_generated_edoc: null,
    custbody_psg_ei_pdf: null,
    custbody_edoc_generated_pdf: null,
    custbody_mx_cfdi_uuid: null,
    custbody_mx_cfdi_cadena_original: null,
    custbody_mx_cfdi_certify_timestamp: null,
    custbody_mx_cfdi_folio: cfdiNumbering.folio,
    custbody_mx_cfdi_issue_datetime: null,
    custbody_mx_cfdi_issuer_serial: null,
    custbody_mx_cfdi_qr_code: null,
    custbody_mx_cfdi_sat_serial: null,
    custbody_mx_cfdi_sat_signature: null,
    custbody_mx_cfdi_signature: null,
  }

  await client.patchRecord('creditMemo', creditMemoId, patchPayload)

  try {
    await client.patchRecord('creditMemo', creditMemoId, {
      custbody_mx_operation_type: {
        id: N1_OPERATION_TYPE_ID,
        refName: N1_OPERATION_TYPE_NAME,
      },
    })
  } catch {
    // Some NetSuite accounts do not expose this SAT selector for credit memos in REST.
  }
}

async function ensureN1RelatedCfdi(
  client: NetSuiteClient,
  creditMemoId: string,
  summary: FacturaOpenSummaryRow,
) {
  const invoiceCfdiReference = await fetchInvoiceCfdiReference(client, summary)
  if (!invoiceCfdiReference.uuid) {
    throw new Error(
      `La factura ${invoiceCfdiReference.invoiceDocument ?? summary.internalId} no tiene UUID CFDI timbrado para relacionar la nota de credito N1.`,
    )
  }

  const existingRecords = await fetchRelatedCfdiRecords(client, creditMemoId)
  const matchingRecord = existingRecords.find(
    (record) =>
      !record.isInactive &&
      record.relatedTransactionId === invoiceCfdiReference.invoiceInternalId &&
      record.relationTypeId === N1_RELATED_CFDI_RELATION_TYPE_ID &&
      record.uuid === invoiceCfdiReference.uuid,
  )

  if (matchingRecord) {
    return matchingRecord
  }

  const activeRecords = existingRecords.filter((record) => !record.isInactive)
  const payload = buildN1RelatedCfdiPayload(creditMemoId, invoiceCfdiReference)

  if (activeRecords.length > 0) {
    const [primaryRecord, ...extraRecords] = activeRecords
    await client.patchRecord(N1_RELATED_CFDI_RECORD_TYPE, primaryRecord.id, payload)

    for (const extraRecord of extraRecords) {
      await client.patchRecord(N1_RELATED_CFDI_RECORD_TYPE, extraRecord.id, {
        isInactive: true,
      })
    }

    return fetchRelatedCfdiRecord(client, primaryRecord.id)
  }

  const createResponse = await client.createRecord(N1_RELATED_CFDI_RECORD_TYPE, payload)
  const createdId =
    normalizeCreatedRecordId(parseRecordIdFromLocation(createResponse.location)) ??
    normalizeCreatedRecordId(getNullableString(createResponse.json?.id))

  if (!createdId) {
    throw new Error(
      `NetSuite acepto el Related CFDI para la nota de credito ${creditMemoId}, pero no devolvio el id del registro creado.`,
    )
  }

  return fetchRelatedCfdiRecord(client, createdId)
}

function buildN1RelatedCfdiPayload(
  creditMemoId: string,
  invoiceCfdiReference: InvoiceCfdiReference,
) {
  return {
    isInactive: false,
    custrecord_mx_rcs_orig_trans: {
      id: creditMemoId,
    },
    custrecord_mx_rcs_rel_cfdi: {
      id: invoiceCfdiReference.invoiceInternalId,
    },
    custrecord_mx_rcs_rel_type: {
      id: N1_RELATED_CFDI_RELATION_TYPE_ID,
      refName: N1_RELATED_CFDI_RELATION_TYPE_NAME,
    },
    custrecord_mx_rcs_uuid: invoiceCfdiReference.uuid,
  }
}

async function fetchInvoiceCfdiReference(client: NetSuiteClient, summary: FacturaOpenSummaryRow) {
  const response = await client.getRecord('invoice', summary.internalId)
  const record = getNullableRecord(response.json)
  return {
    invoiceInternalId: summary.internalId,
    invoiceDocument:
      getNullableString(record?.tranId) ??
      getNullableString(record?.transactionNumber) ??
      summary.tranId ??
      summary.transactionNumber,
    uuid: getNullableString(record?.custbody_mx_cfdi_uuid),
  } satisfies InvoiceCfdiReference
}

async function fetchRelatedCfdiRecords(client: NetSuiteClient, creditMemoId: string) {
  const response = await client.listRecords(N1_RELATED_CFDI_RECORD_TYPE, {
    limit: N1_RELATED_CFDI_QUERY_LIMIT,
    q: `custrecord_mx_rcs_orig_trans ANY_OF [${creditMemoId}]`,
  })
  const collection = getNullableRecord(response.json)
  const items = Array.isArray(collection?.items) ? collection.items : []
  const recordIds = items
    .map((item) => normalizeCreatedRecordId(getNullableString(getNullableRecord(item)?.id)))
    .filter((value): value is string => value !== null)

  return mapWithConcurrency(recordIds, FACTURA_RAW_FETCH_CONCURRENCY, async (recordId) =>
    fetchRelatedCfdiRecord(client, recordId),
  )
}

async function fetchRelatedCfdiRecord(client: NetSuiteClient, recordId: string) {
  const response = await client.getRecord(N1_RELATED_CFDI_RECORD_TYPE, recordId)
  const record = getNullableRecord(response.json)
  return {
    id: recordId,
    originalTransactionId: getReferenceId(record?.custrecord_mx_rcs_orig_trans),
    relatedTransactionId: getReferenceId(record?.custrecord_mx_rcs_rel_cfdi),
    relatedDocument: getReferenceName(record?.custrecord_mx_rcs_rel_cfdi),
    relationTypeId: getReferenceId(record?.custrecord_mx_rcs_rel_type),
    relationTypeName: getReferenceName(record?.custrecord_mx_rcs_rel_type),
    uuid: getNullableString(record?.custrecord_mx_rcs_uuid),
    isInactive: getNullableBoolean(record?.isInactive) ?? false,
  } satisfies RelatedCfdiRecord
}

async function fetchCreditMemoElectronicDocumentState(
  client: NetSuiteClient,
  creditMemoId: string,
) {
  const response = await client.getRecord('creditMemo', creditMemoId)
  const record = getNullableRecord(response.json)
  return {
    statusId: getReferenceId(record?.custbody_psg_ei_status),
    statusName: getReferenceName(record?.custbody_psg_ei_status),
    generatedDocumentId: getNullableString(record?.custbody_psg_ei_generated_edoc),
    certifiedDocumentId: getNullableString(record?.custbody_psg_ei_certified_edoc),
    generatedPdfId: getNullableString(record?.custbody_edoc_generated_pdf),
    uuid: getNullableString(record?.custbody_mx_cfdi_uuid),
    hasContent: Boolean(getNullableString(record?.custbody_psg_ei_content)),
  } satisfies CreditMemoElectronicDocumentState
}

function formatN1RelatedCfdiOutcome(relatedCfdiRecord: RelatedCfdiRecord) {
  const relationTypeLabel =
    relatedCfdiRecord.relationTypeName ?? N1_RELATED_CFDI_RELATION_TYPE_NAME
  const relatedDocument = relatedCfdiRecord.relatedDocument ?? relatedCfdiRecord.relatedTransactionId ?? '--'
  const relatedUuid = relatedCfdiRecord.uuid ?? '--'
  return `Related CFDI: ${relationTypeLabel} | ${relatedDocument} | UUID ${relatedUuid}.`
}

function formatCreditMemoElectronicDocumentState(
  electronicDocumentState: CreditMemoElectronicDocumentState,
) {
  const statusLabel = electronicDocumentState.statusName ?? 'Sin estado'
  if (electronicDocumentState.uuid) {
    return `Estado E-Document: ${statusLabel}. UUID timbrado: ${electronicDocumentState.uuid}.`
  }

  if (electronicDocumentState.generatedDocumentId || electronicDocumentState.hasContent) {
    return `Estado E-Document: ${statusLabel}. El XML ya esta generado pero aun no aparece UUID certificado.`
  }

  return `Estado E-Document: ${statusLabel}. La nota sigue pendiente de generar/timbrar dentro de NetSuite.`
}

async function applyCreditMemoToInvoice(
  client: NetSuiteClient,
  creditMemoId: string,
  summary: FacturaOpenSummaryRow,
  amount: number,
) {
  const creditMemoResponse = await client.getRecord('creditMemo', creditMemoId, {
    expandSubResources: true,
  })
  const creditMemoRecord = creditMemoResponse.json as Record<string, unknown>
  const applyCollection = getNullableRecord(creditMemoRecord.apply)
  const applyItems = Array.isArray(applyCollection?.items) ? applyCollection.items : []
  const targetApplyLine = applyItems
    .map((item) => getNullableRecord(item))
    .find((item) => getReferenceId(item?.doc) === summary.internalId)

  if (!targetApplyLine) {
    throw new Error(
      `La nota de credito ${creditMemoId} no expone la factura ${summary.tranId ?? summary.internalId} en la pestaña Apply.`,
    )
  }

  const patchPayload = {
    apply: {
      items: applyItems
        .map((item) => getNullableRecord(item))
        .filter((item): item is Record<string, unknown> => item !== null)
        .map((item) => {
          const docId = getReferenceId(item.doc)
          const isTarget = docId === summary.internalId
          return {
            doc: item.doc,
            line: getNullableNumber(item.line) ?? 0,
            apply: isTarget ? true : getNullableBoolean(item.apply) ?? false,
            amount: isTarget ? amount : getNullableNumber(item.amount),
          }
        }),
    },
  }

  await client.patchRecord('creditMemo', creditMemoId, patchPayload, { replace: 'apply' })
}

async function fetchCreditMemoState(client: NetSuiteClient, creditMemoId: string) {
  const response = await client.getRecord('creditMemo', creditMemoId)
  const record = response.json as Record<string, unknown>
  return {
    id: creditMemoId,
    tranId: getNullableString(record.tranId) ?? getNullableString(record.transactionNumber),
    amountRemaining: getNullableNumber(record.amountRemaining),
    total: getNullableNumber(record.total),
  }
}

async function resolveN1CreditMemoCfdiNumbering(
  client: NetSuiteClient,
  creditMemoId: string,
) {
  const creditMemoState = await fetchCreditMemoState(client, creditMemoId)
  const folio = normalizeN1CreditMemoFolio(creditMemoState.tranId) ?? creditMemoId
  return {
    serie: N1_CREDIT_MEMO_CFDI_SERIE,
    folio,
  }
}

async function resolveN1TransactionRecipientEmail(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
) {
  if (!summary.customerId) {
    throw new Error(
      `La factura ${summary.tranId ?? summary.internalId} no tiene cliente asociado para resolver el correo del E-Document.`,
    )
  }

  const response = await client.getRecord('customer', summary.customerId)
  const record = getNullableRecord(response.json)
  const recipientEmail =
    extractEmailAddress(getNullableString(record?.custentity_shq_documentation_mails)) ??
    extractEmailAddress(getNullableString(record?.email))

  if (!recipientEmail) {
    throw new Error(
      `El cliente ${summary.customerName ?? summary.customerId} no tiene un correo valido para la configuracion del E-Document.`,
    )
  }

  return recipientEmail
}

async function verifyCreditMemoRemainingAmount(
  client: NetSuiteClient,
  creditMemoId: string,
  expectedRemainingAmount: number,
  operationLabel: string,
) {
  const creditMemo = await fetchCreditMemoState(client, creditMemoId)
  const remainingAmount = creditMemo.amountRemaining ?? 0

  if (Math.abs(remainingAmount - expectedRemainingAmount) > OPEN_AMOUNT_TOLERANCE) {
    throw new Error(
      `NetSuite completo ${operationLabel}, pero la nota de credito ${creditMemo.tranId ?? creditMemoId} quedo con saldo ${remainingAmount.toFixed(2)} en vez de ${expectedRemainingAmount.toFixed(2)}.`,
    )
  }
}

async function resolveLatestCreditMemoFromInvoice(client: NetSuiteClient, sourceInvoiceId: string) {
  const query = `
SELECT
  creditMemo.id AS internalId
FROM PreviousTransactionLineLink
INNER JOIN transaction creditMemo
  ON creditMemo.id = PreviousTransactionLineLink.nextdoc
WHERE PreviousTransactionLineLink.previousdoc = ${formatSuiteQlLiteral(sourceInvoiceId)}
  AND PreviousTransactionLineLink.linktype = 'SaleRet'
ORDER BY creditMemo.id DESC
  `.trim()
  const rows = await fetchAllSuiteQlRows(client, query)
  return getNullableString(rows[0]?.internalid)
}

async function applyA2WhenInvoiceIsHigher(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  candidate: FacturaAplicacionCandidata,
  targetAmount: number | null,
  difference: number,
) {
  if (!targetAmount || !candidate.montoDisponible) {
    throw new Error('A2 no tiene montos validos para ejecutar la aplicacion parcial.')
  }

  const partialPayment = await createCustomerPaymentUsingCredit(
    client,
    summary,
    candidate.id,
    candidate.montoDisponible,
    `Auto A2 parcial | ${summary.tranId ?? summary.internalId} | ${candidate.documento ?? candidate.id}`,
    summary.transactionDate,
  )

  await verifyInvoiceRemainingAmount(
    client,
    summary,
    difference,
    `la aplicacion parcial A2 de la factura ${summary.tranId ?? summary.internalId}`,
  )
  await verifyCreditRemainingAmount(
    client,
    candidate,
    0,
    `la aplicacion parcial A2 del credito ${candidate.documento ?? candidate.id}`,
  )

  const roundingAccountId = await resolveRoundingAccountId(client)
  const roundingPayment = await createCustomerPaymentUsingAccount(
    client,
    summary,
    difference,
    roundingAccountId,
    ROUNDING_ACCOUNT_DISPLAY_NAME,
    `Auto A2 redondeo | ${summary.tranId ?? summary.internalId}`,
    summary.transactionDate,
  )

  await verifyInvoiceRemainingAmount(
    client,
    summary,
    0,
    `el pago de redondeo A2 de la factura ${summary.tranId ?? summary.internalId}`,
  )

  return roundingPayment.id ? roundingPayment : partialPayment
}

async function applyA2WhenCreditIsHigher(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  candidate: FacturaAplicacionCandidata,
  targetAmount: number | null,
  difference: number,
) {
  if (!targetAmount) {
    throw new Error('A2 no tiene un monto objetivo valido para ajustar el diario.')
  }

  await adjustJournalForA2(client, summary, candidate, targetAmount, difference)
  await verifyCreditRemainingAmount(
    client,
    {
      ...candidate,
      montoDisponible: targetAmount,
    },
    targetAmount,
    `el ajuste A2 del diario ${candidate.documento ?? candidate.id}`,
  )

  const payment = await createCustomerPaymentUsingCredit(
    client,
    summary,
    candidate.id,
    targetAmount,
    `Auto A2 diario ajustado | ${summary.tranId ?? summary.internalId} | ${candidate.documento ?? candidate.id}`,
    summary.transactionDate,
  )

  await verifyInvoiceRemainingAmount(
    client,
    summary,
    0,
    `la aplicacion A2 posterior al ajuste del diario ${candidate.documento ?? candidate.id}`,
  )
  await verifyCreditRemainingAmount(
    client,
    candidate,
    0,
    `la aplicacion A2 del diario ajustado ${candidate.documento ?? candidate.id}`,
  )

  return payment
}

async function createA1CustomerPayment(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  candidate: FacturaAplicacionCandidata,
  targetAmount: number | null,
) {
  if (!targetAmount || targetAmount <= OPEN_AMOUNT_TOLERANCE) {
    throw new Error('La factura no tiene un monto objetivo valido para aplicar.')
  }

  const payment = await createCustomerPaymentUsingCredit(
    client,
    summary,
    candidate.id,
    targetAmount,
    ['Auto A1', summary.tranId ?? summary.transactionNumber ?? summary.internalId, candidate.documento ?? candidate.id]
      .filter(Boolean)
      .join(' | '),
  )

  await verifyA1Application(client, summary, candidate)

  return payment
}

async function createA4CustomerPayment(
  client: NetSuiteClient,
  summaries: FacturaOpenSummaryRow[],
  a4: FacturaA4Context,
  groupTotal: number,
  options: {
    expectedCreditRemaining: number
    ruleCode: 'A4' | 'A5' | 'A7'
  },
) {
  const [firstSummary] = summaries
  if (!firstSummary) {
    throw new Error(`${options.ruleCode} no tiene facturas validas para crear el pago agrupado.`)
  }

  const context = await getInvoicePaymentContext(client, firstSummary)
  const creditLine = await resolveCreditApplicationLine(client, a4.creditTransactionId, firstSummary.customerId, {
    requireCustomerMatch: true,
  })
  const payload = buildCustomerPaymentBasePayload(
    context,
    [
      `Auto ${options.ruleCode}`,
      a4.salesOrderDocument ?? a4.salesOrderInternalId ?? a4.customerName ?? a4.customerId,
      a4.creditDocument ?? a4.creditTransactionId,
    ]
      .filter(Boolean)
      .join(' | '),
    a4.creditDate ? toIsoDate(a4.creditDate) : firstSummary.transactionDate,
  )

  payload.apply = {
    items: summaries.map((summary) => {
      const amount = getFacturaTargetAmount(summary)
      if (!amount || amount <= OPEN_AMOUNT_TOLERANCE) {
        throw new Error(
          `La factura ${summary.tranId ?? summary.internalId} no tiene saldo valido para ${options.ruleCode}.`,
        )
      }

      return {
        doc: { id: summary.internalId },
        line: 0,
        apply: true,
        amount,
      }
    }),
  }
  payload.credit = {
    items: [
      {
        doc: { id: a4.creditTransactionId },
        line: creditLine,
        apply: true,
        amount: groupTotal,
      },
    ],
  }

  const payment = await postCustomerPayment(client, payload)

  for (const summary of summaries) {
    await verifyInvoiceRemainingAmount(
      client,
      summary,
      0,
      `la aplicacion ${options.ruleCode} de la factura ${summary.tranId ?? summary.internalId}`,
    )
  }

  await verifyCreditRemainingAmount(
    client,
    {
      id: a4.creditTransactionId,
      documento: a4.creditDocument,
      tipoTransaccion: a4.creditType,
      clienteId: a4.customerId,
      clienteNombre: a4.customerName,
      fecha: a4.creditDate,
      periodoContableId: a4.creditPeriodId,
      periodoContableNombre: a4.creditPeriodName,
      monedaId: a4.currencyId,
      moneda: a4.currencyName,
      montoCredito: a4.creditAmount,
      montoAplicado: null,
      montoDisponible: a4.creditAvailableAmount,
      cumplePpd1: false,
      cumpleA1: false,
      cumpleA2: false,
      cumpleA3: false,
    },
    options.expectedCreditRemaining,
    `la aplicacion ${options.ruleCode} del credito ${a4.creditDocument ?? a4.creditTransactionId}`,
  )

  return payment
}

async function ensureKontempoCustomerPayment(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  k: FacturaKContext,
  instruction: KontempoJournalPaymentInstruction,
  existingPayment: LinkedCustomerPaymentRow | null,
) {
  const context = await getInvoicePaymentContext(client, summary)
  const memo = buildKontempoCustomerPaymentMemo(summary, k)
  const expectedPaymentDateTime = buildKontempoPaymentDateTime(instruction.journalTransactionDate)

  if (existingPayment) {
    const patchPayload = buildKontempoCustomerPaymentPayload(
      context,
      summary,
      instruction,
      memo,
      expectedPaymentDateTime,
    )
    delete patchPayload.apply
    delete patchPayload.account
    delete patchPayload.payment

    await client.patchRecord('customerpayment', existingPayment.transactionId, patchPayload)
    await verifyKontempoCustomerPayment(
      client,
      existingPayment.transactionId,
      summary,
      instruction,
      expectedPaymentDateTime,
    )

    const refreshedPayment = await client.getRecord('customerpayment', existingPayment.transactionId)
    const refreshedRecord = getNullableRecord(refreshedPayment.json)
    return {
      id: existingPayment.transactionId,
      tranId:
        getNullableString(refreshedRecord?.tranId) ??
        getNullableString(refreshedRecord?.transactionNumber) ??
        existingPayment.tranId,
    }
  }

  const payload = buildKontempoCustomerPaymentPayload(
    context,
    summary,
    instruction,
    memo,
    expectedPaymentDateTime,
  )
  const payment = await postCustomerPayment(client, payload)
  if (!payment.id) {
    throw new Error(
      `NetSuite acepto crear el pago Kontempo para la factura ${summary.tranId ?? summary.internalId}, pero no devolvio el id interno del pago.`,
    )
  }
  await verifyKontempoCustomerPayment(
    client,
    payment.id,
    summary,
    instruction,
    expectedPaymentDateTime,
  )
  return payment
}

async function findKontempoCustomerPaymentCollisions(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  instruction: KontempoJournalPaymentInstruction,
) {
  if (!summary.customerId) {
    return [] satisfies KontempoCustomerPaymentCollision[]
  }

  const query = `
SELECT
  payment.id AS transactionId,
  payment.tranid AS tranId,
  payment.trandate AS transactionDate,
  payment.foreigntotal AS amount,
  payment.account AS accountId,
  BUILTIN.DF(payment.account) AS accountName
FROM transaction payment
WHERE payment.type = 'CustPymt'
  AND payment.entity = ${formatSuiteQlLiteral(summary.customerId)}
  AND payment.account = ${formatSuiteQlLiteral(instruction.bridgeBankAccountId)}
  AND payment.trandate = TO_DATE(${formatSuiteQlLiteral(instruction.journalTransactionDate)}, 'YYYY-MM-DD')
ORDER BY payment.id DESC
  `.trim()

  const candidatePayments = (await fetchAllSuiteQlRows(client, query))
    .map(toLinkedCustomerPaymentRow)
    .filter((payment) => amountsMatchExactly(payment.amount, instruction.paymentAmount))

  if (candidatePayments.length === 0) {
    return [] satisfies KontempoCustomerPaymentCollision[]
  }

  return mapWithConcurrency(candidatePayments, FACTURA_RAW_FETCH_CONCURRENCY, async (payment) => ({
    payment,
    appliedInvoices: await fetchCustomerPaymentAppliedInvoices(client, payment.transactionId),
  }))
}

async function resolveKontempoCustomerPaymentGuardrail(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  instruction: KontempoJournalPaymentInstruction,
  existingPayment: LinkedCustomerPaymentRow | null,
) {
  if (existingPayment) {
    return {
      existingPayment,
      collisionMessage: null,
    } satisfies {
      existingPayment: LinkedCustomerPaymentRow | null
      collisionMessage: string | null
    }
  }

  const collisions = await findKontempoCustomerPaymentCollisions(client, summary, instruction)
  if (collisions.length === 0) {
    return {
      existingPayment: null,
      collisionMessage: null,
    } satisfies {
      existingPayment: LinkedCustomerPaymentRow | null
      collisionMessage: string | null
    }
  }

  const targetCollision =
    collisions.find((collision) =>
      collision.appliedInvoices.some((invoice) => invoice.internalId === summary.internalId),
    ) ?? null
  if (targetCollision) {
    return {
      existingPayment: targetCollision.payment,
      collisionMessage: null,
    } satisfies {
      existingPayment: LinkedCustomerPaymentRow | null
      collisionMessage: string | null
    }
  }

  return {
    existingPayment: null,
    collisionMessage: `Guardrail K: ya existe un pago equivalente en la cuenta puente para la factura ${summary.tranId ?? summary.internalId}. ${collisions
      .map((collision) => formatCustomerPaymentCollision(collision))
      .join(' | ')}. Revisar manualmente antes de crear otro pago.`,
  } satisfies {
    existingPayment: LinkedCustomerPaymentRow | null
    collisionMessage: string | null
  }
}

async function fetchCustomerPaymentAppliedInvoices(
  client: NetSuiteClient,
  customerPaymentId: string,
) {
  const response = await client.getRecord('customerpayment', customerPaymentId, {
    expandSubResources: true,
  })
  const record = getNullableRecord(response.json)
  const applyCollection = getNullableRecord(record?.apply)
  const applyItems = Array.isArray(applyCollection?.items) ? applyCollection.items : []

  return applyItems
    .map((item) => getNullableRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null)
    .filter((item) => getNullableBoolean(item.apply) ?? false)
    .map((item) => ({
      internalId: getReferenceId(item.doc) ?? '',
      documento: getReferenceName(item.doc),
      amount: getNullableNumber(item.amount),
    }))
    .filter((item) => item.internalId)
}

function formatCustomerPaymentCollision(collision: KontempoCustomerPaymentCollision) {
  const paymentLabel = collision.payment.tranId ?? collision.payment.transactionId
  if (collision.appliedInvoices.length === 0) {
    return `Pago ${paymentLabel} ya existe con misma fecha/monto/cuenta y aun no esta aplicado`
  }

  const invoiceLabels = collision.appliedInvoices
    .map((invoice) => invoice.documento ?? invoice.internalId)
    .join(', ')

  return `Pago ${paymentLabel} ya existe con misma fecha/monto/cuenta y esta aplicado a ${invoiceLabels}`
}

function buildKontempoCustomerPaymentPayload(
  context: Awaited<ReturnType<typeof getInvoicePaymentContext>>,
  summary: FacturaOpenSummaryRow,
  instruction: KontempoJournalPaymentInstruction,
  memo: string,
  paymentDateTime: string,
) {
  const payload = buildCustomerPaymentBasePayload(context, memo, instruction.journalTransactionDate)
  payload.account = {
    id: instruction.bridgeBankAccountId,
    refName: instruction.bridgeBankAccountName,
  }
  payload.payment = instruction.paymentAmount
  payload.apply = {
    items: [
      {
        doc: { id: summary.internalId },
        line: 0,
        apply: true,
        amount: instruction.paymentAmount,
      },
    ],
  }
  payload.toBeEmailed = false
  payload.toBePrinted = false
  payload.toBeFaxed = false
  payload.custbody_psg_ei_template = {
    id: K_CUSTOMER_PAYMENT_TEMPLATE_ID,
    refName: K_CUSTOMER_PAYMENT_TEMPLATE_NAME,
  }
  payload.custbody_psg_ei_sending_method = {
    id: K_SENDING_METHOD_ID,
    refName: K_SENDING_METHOD_NAME,
  }
  payload.custbody_psg_ei_trans_edoc_standard = {
    id: K_E_DOC_STANDARD_ID,
    refName: K_E_DOC_STANDARD_NAME,
  }
  payload.custbody_psg_ei_status = {
    id: K_E_DOC_STATUS_PENDING_ID,
    refName: K_E_DOC_STATUS_PENDING_NAME,
  }
  payload.custbody_mx_txn_sat_payment_method = {
    id: K_SAT_PAYMENT_METHOD_ID,
    refName: K_SAT_PAYMENT_METHOD_NAME,
  }
  payload.custbody_mx_cfdi_payment_string_type = {
    id: K_PAYMENT_STRING_TYPE_ID,
    refName: K_PAYMENT_STRING_TYPE_NAME,
  }
  payload.custbody_mx_cfdi_recipient_account = K_RECIPIENT_ACCOUNT
  payload.custbody_mx_cfdi_recipient_entity_rfc = K_RECIPIENT_RFC
  payload.custbody_shq_currency_payment = {
    id: '1',
    refName: 'MXN',
  }
  payload.custbody_shq_fecha_pago = paymentDateTime
  payload.custbody_shq_payment = instruction.bridgeGrossAmount

  if (context.exchangeRate !== null) {
    payload.custbody_shq_tc_docs = context.exchangeRate
  }

  return payload
}

function buildKontempoCustomerPaymentMemo(summary: FacturaOpenSummaryRow, k: FacturaKContext) {
  return [
    'Auto K Kontempo',
    summary.tranId ?? summary.transactionNumber ?? summary.internalId,
    k.journalDocument ?? k.journalTransactionId ?? 'sin-diario',
    k.orderId ? `OV ${k.orderId}` : null,
  ]
    .filter(Boolean)
    .join(' | ')
}

function buildKontempoPaymentDateTime(tranDate: string) {
  const normalizedDate = toNetSuiteDateString(tranDate)
  if (!normalizedDate) {
    throw new Error(`No se pudo normalizar la fecha ${tranDate} para el pago Kontempo.`)
  }

  return `${normalizedDate}T${K_PAYMENT_MEXICO_UTC_TIME}`
}

async function resolveKontempoJournalPaymentInstruction(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  k: FacturaKContext,
  options?: {
    allowPrepare?: boolean
  },
): Promise<KontempoJournalPaymentInstruction> {
  const journalTransactionId = normalizeOptionalString(k.journalTransactionId)
  if (!journalTransactionId) {
    throw new Error(
      `La factura ${summary.tranId ?? summary.internalId} no conserva un diario Kontempo asociado en el modelo.`,
    )
  }

  const bridgeBankAccountId = await resolveB1BridgeBankAccountId(client)
  if (!bridgeBankAccountId) {
    throw new Error('No se pudo resolver la cuenta puente 100 para el flujo Kontempo.')
  }

  const journalResponse = await client.getRecord('journalEntry', journalTransactionId, {
    expandSubResources: true,
  })
  let journalRecord = journalResponse.json as Record<string, unknown>
  const journalTransactionDate = toNetSuiteDateString(getNullableString(journalRecord.tranDate))
  if (!journalTransactionDate) {
    throw new Error(
      `El diario Kontempo ${k.journalDocument ?? journalTransactionId} no expone una fecha valida para generar el pago.`,
    )
  }

  const lineCollection = getNullableRecord(journalRecord.line)
  let lineItems = Array.isArray(lineCollection?.items) ? lineCollection.items : []
  const invoiceTokens = uniqueValues([summary.tranId, summary.transactionNumber, summary.internalId]).map(
    (value) => value.toLowerCase(),
  )
  const targetAmount = getFacturaTargetAmount(summary)
  const component = findKontempoJournalComponentForInvoice(summary.internalId, k)
  const expectedBridgeAmount = component?.grossAmount ?? k.orderGrossAmount ?? k.groupedGrossAmount
  const findPreparedLine = () => {
    const normalizedLines = lineItems
      .map((item) => getNullableRecord(item))
      .filter((line): line is Record<string, unknown> => line !== null)
    const directMatch = normalizedLines.find((line) => {
      const memo = normalizeComparableText(getNullableString(line.memo)) ?? ''
      return (
        getReferenceId(line.account) === bridgeBankAccountId &&
        (getNullableNumber(line.credit) ?? 0) > OPEN_AMOUNT_TOLERANCE &&
        (!summary.customerId || getReferenceId(line.entity) === summary.customerId) &&
        invoiceTokens.some((token) => memo.includes(token))
      )
    })
    const fallbackByAmount = normalizedLines.find(
      (line) =>
        getReferenceId(line.account) === bridgeBankAccountId &&
        (getNullableNumber(line.credit) ?? 0) > OPEN_AMOUNT_TOLERANCE &&
        (!summary.customerId || getReferenceId(line.entity) === summary.customerId) &&
        amountsMatchExactly(getNullableNumber(line.credit), targetAmount),
    )
    const fallbackByBridgeAmount =
      expectedBridgeAmount === null
        ? null
        : normalizedLines.find(
            (line) =>
              getReferenceId(line.account) === bridgeBankAccountId &&
              (getNullableNumber(line.credit) ?? 0) > OPEN_AMOUNT_TOLERANCE &&
              (!summary.customerId || getReferenceId(line.entity) === summary.customerId) &&
              amountsMatchExactly(getNullableNumber(line.credit), expectedBridgeAmount),
          )

    return directMatch ?? fallbackByAmount ?? fallbackByBridgeAmount ?? null
  }

  let chosenLine = findPreparedLine()
  if (!chosenLine && options?.allowPrepare !== false) {
    const prepared = await prepareKontempoJournalForInvoice(
      client,
      summary,
      k,
      journalRecord,
      bridgeBankAccountId,
      B1_BRIDGE_BANK_ACCOUNT_DISPLAY_NAME,
    )

    if (prepared) {
      journalRecord = prepared
      const refreshedLineCollection = getNullableRecord(journalRecord.line)
      lineItems = Array.isArray(refreshedLineCollection?.items) ? refreshedLineCollection.items : []
      chosenLine = findPreparedLine()
    }
  }

  const bridgeGrossAmount = getNullableNumber(chosenLine?.credit)

  if (!chosenLine || bridgeGrossAmount === null || bridgeGrossAmount <= OPEN_AMOUNT_TOLERANCE) {
    throw new Error(
      `El diario Kontempo ${k.journalDocument ?? journalTransactionId} aun no esta preparado con una linea credito a 100 Bancos Nacional para la factura ${summary.tranId ?? summary.internalId}.`,
    )
  }

  if (targetAmount === null || targetAmount <= OPEN_AMOUNT_TOLERANCE) {
    throw new Error(
      `La factura ${summary.tranId ?? summary.internalId} no expone un monto valido para generar el customer payment Kontempo.`,
    )
  }

  return {
    paymentAmount: targetAmount,
    bridgeGrossAmount,
    journalTransactionId,
    journalDocument: k.journalDocument,
    journalTransactionDate,
    bridgeBankAccountId,
    bridgeBankAccountName: B1_BRIDGE_BANK_ACCOUNT_DISPLAY_NAME,
  }
}

async function fetchLinkedCustomerPaymentsForInvoice(
  client: NetSuiteClient,
  invoiceInternalId: string,
) {
  const query = `
SELECT
  payment.id AS transactionId,
  payment.tranid AS tranId,
  payment.trandate AS transactionDate,
  payment.foreigntotal AS amount,
  payment.account AS accountId,
  BUILTIN.DF(payment.account) AS accountName
FROM PreviousTransactionLineLink
INNER JOIN transaction payment
  ON payment.id = PreviousTransactionLineLink.nextdoc
WHERE PreviousTransactionLineLink.previousdoc = ${formatSuiteQlLiteral(invoiceInternalId)}
  AND PreviousTransactionLineLink.linktype = 'Payment'
  AND payment.type = 'CustPymt'
ORDER BY payment.id DESC
  `.trim()

  return (await fetchAllSuiteQlRows(client, query)).map(toLinkedCustomerPaymentRow)
}

function findKontempoJournalComponentForInvoice(invoiceInternalId: string, k: FacturaKContext) {
  return k.journalComponents.find((component) => component.invoiceInternalId === invoiceInternalId) ?? null
}

function buildKontempoJournalComponents(summary: FacturaOpenSummaryRow, k: FacturaKContext) {
  const normalizedComponents = k.journalComponents.filter(
    (component) =>
      component.grossAmount > OPEN_AMOUNT_TOLERANCE &&
      component.netAmount > OPEN_AMOUNT_TOLERANCE &&
      component.commissionAmount >= 0,
  )

  if (normalizedComponents.length > 0) {
    return normalizedComponents
  }

  const grossAmount = k.orderGrossAmount ?? k.groupedGrossAmount
  const netAmount = k.orderNetDisbursementAmount ?? k.groupedNetDisbursementAmount ?? k.journalAmount
  const commissionAmount =
    k.orderCommissionAmount ??
    k.groupedCommissionAmount ??
    (grossAmount !== null && netAmount !== null ? roundCurrency(grossAmount - netAmount) : null)

  if (
    grossAmount === null ||
    netAmount === null ||
    commissionAmount === null ||
    grossAmount <= OPEN_AMOUNT_TOLERANCE ||
    netAmount <= OPEN_AMOUNT_TOLERANCE
  ) {
    return [] as FacturaKJournalComponent[]
  }

  return [
    {
      invoiceInternalId: summary.internalId,
      invoiceDocument: summary.tranId ?? summary.transactionNumber,
      customerId: summary.customerId,
      customerName: summary.customerName,
      salesOrderInternalId: k.salesOrderInternalId,
      salesOrderDocument: k.salesOrderDocument,
      grossAmount: roundCurrency(grossAmount),
      commissionAmount: roundCurrency(commissionAmount),
      netAmount: roundCurrency(netAmount),
    },
  ]
}

function buildKontempoBridgeMemo(
  component: FacturaKJournalComponent,
  summary: FacturaOpenSummaryRow,
  customerName: string | null,
) {
  return [
    component.invoiceDocument ?? summary.tranId ?? summary.internalId,
    customerName ?? component.customerName ?? summary.customerName,
  ]
    .filter(Boolean)
    .join(' ')
}

function kontempoBridgeLineMatchesComponent(
  line: Record<string, unknown>,
  component: FacturaKJournalComponent,
  bridgeBankAccountId: string,
) {
  if (
    getReferenceId(line.account) !== bridgeBankAccountId ||
    (getNullableNumber(line.credit) ?? 0) <= OPEN_AMOUNT_TOLERANCE ||
    (component.customerId && getReferenceId(line.entity) !== component.customerId)
  ) {
    return false
  }

  const memo = normalizeComparableText(getNullableString(line.memo)) ?? ''
  const invoiceTokens = uniqueValues([
    component.invoiceDocument,
    component.invoiceInternalId,
  ])
    .map((value) => value.toLowerCase())
    .filter((value) => value.length > 0)

  if (invoiceTokens.length > 0 && invoiceTokens.some((token) => memo.includes(token))) {
    return true
  }

  return amountsMatchExactly(getNullableNumber(line.credit), component.grossAmount)
}

async function prepareKontempoJournalForInvoice(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  k: FacturaKContext,
  journalRecord: Record<string, unknown>,
  bridgeBankAccountId: string,
  bridgeBankAccountName: string,
) {
  const components = buildKontempoJournalComponents(summary, k)
  const targetComponent = components.find((component) => component.invoiceInternalId === summary.internalId) ?? null
  if (!targetComponent) {
    return null
  }

  const grossAmount = roundCurrency(components.reduce((sum, component) => sum + component.grossAmount, 0))
  const netAmount = roundCurrency(components.reduce((sum, component) => sum + component.netAmount, 0))
  const commissionAmount = roundCurrency(
    components.reduce((sum, component) => sum + component.commissionAmount, 0),
  )

  if (grossAmount <= OPEN_AMOUNT_TOLERANCE || netAmount <= OPEN_AMOUNT_TOLERANCE) {
    throw new Error(
      `El diario Kontempo ${k.journalDocument ?? k.journalTransactionId ?? 'sin-diario'} no trae suficiente desglose bruto/neto/comision para preparar automaticamente la factura ${summary.tranId ?? summary.internalId}.`,
    )
  }

  const lineCollection = getNullableRecord(journalRecord.line)
  const lineItems = Array.isArray(lineCollection?.items) ? lineCollection.items : []
  const normalizedLines = lineItems
    .map((item) => getNullableRecord(item))
    .filter((line): line is Record<string, unknown> => line !== null)

  const existingBridgeLines = normalizedLines.filter(
    (line) =>
      getReferenceId(line.account) === bridgeBankAccountId &&
      (getNullableNumber(line.credit) ?? 0) > OPEN_AMOUNT_TOLERANCE,
  )
  if (
    existingBridgeLines.length > 0 &&
    components.every((component) =>
      existingBridgeLines.some((line) =>
        kontempoBridgeLineMatchesComponent(line, component, bridgeBankAccountId),
      ),
    )
  ) {
    return journalRecord
  }

  if (existingBridgeLines.length > 0) {
    throw new Error(
      `El diario Kontempo ${k.journalDocument ?? k.journalTransactionId ?? 'sin-diario'} ya trae una preparacion parcial a 100 Bancos Nacional; revisar manualmente antes de seguir.`,
    )
  }

  const higoLine = normalizedLines.find(
    (line) => getReferenceId(line.account) === '1765' && (getNullableNumber(line.debit) ?? 0) > OPEN_AMOUNT_TOLERANCE,
  )
  if (!higoLine) {
    throw new Error(
      `El diario Kontempo ${k.journalDocument ?? k.journalTransactionId ?? 'sin-diario'} no conserva el debito a Higo necesario para preparar la factura ${summary.tranId ?? summary.internalId}.`,
    )
  }

  const legacyCreditLine = normalizedLines.find(
    (line) =>
      getReferenceId(line.account) !== bridgeBankAccountId &&
      (getNullableNumber(line.credit) ?? 0) > OPEN_AMOUNT_TOLERANCE,
  )
  if (!legacyCreditLine) {
    throw new Error(
      `El diario Kontempo ${k.journalDocument ?? k.journalTransactionId ?? 'sin-diario'} no conserva una linea credito heredada para reconvertir la factura ${summary.tranId ?? summary.internalId}.`,
    )
  }

  const higoDebitAmount = roundCurrency(getNullableNumber(higoLine.debit) ?? 0)
  if (!amountsMatchExactly(higoDebitAmount, k.journalAmount ?? higoDebitAmount)) {
    throw new Error(
      `El diario Kontempo ${k.journalDocument ?? k.journalTransactionId ?? 'sin-diario'} ya no conserva el neto esperado en Higo para la factura ${summary.tranId ?? summary.internalId}.`,
    )
  }

  const roundingDifference = roundCurrency(higoDebitAmount + commissionAmount - grossAmount)
  const allowedDifference =
    components.length > 1 || (k.groupedOrderCount ?? 0) > 1
      ? K_JOURNAL_GROUPED_DIFFERENCE_TOLERANCE_MXN
      : K_JOURNAL_ROUNDING_TOLERANCE_MXN
  if (Math.abs(roundingDifference) > allowedDifference) {
    throw new Error(
      `El diario Kontempo ${k.journalDocument ?? k.journalTransactionId ?? 'sin-diario'} excede la tolerancia de redondeo Kontempo para la factura ${summary.tranId ?? summary.internalId}.`,
    )
  }

  const context = await getInvoicePaymentContext(client, summary)
  const defaultBridgeCustomerName =
    normalizeOptionalString(summary.customerName) ?? normalizeOptionalString(context.customer.refName)
  const bridgeMemos = components.map((component) =>
    buildKontempoBridgeMemo(
      component,
      summary,
      normalizeOptionalString(component.customerName) ?? defaultBridgeCustomerName,
    ),
  )
  const bridgeDepartment =
    getOptionalReferencePayload(legacyCreditLine.department) ?? getOptionalReferencePayload(higoLine.department)
  const bridgeLocation =
    context.location ??
    getOptionalReferencePayload(legacyCreditLine.location) ??
    getOptionalReferencePayload(higoLine.location)
  const vendorEntity =
    getOptionalReferencePayload(legacyCreditLine.entity) ?? getOptionalReferencePayload(higoLine.entity)
  const commissionComponents = components.filter((component) => component.commissionAmount > OPEN_AMOUNT_TOLERANCE)
  const providerAccount = { id: K_VENDOR_ACCOUNT_ID, refName: K_VENDOR_ACCOUNT_NAME }
  const roundingAccountId =
    Math.abs(roundingDifference) > OPEN_AMOUNT_TOLERANCE ? await resolveRoundingAccountId(client) : null

  if (commissionComponents.length === 0) {
    throw new Error(
      `El diario Kontempo ${k.journalDocument ?? k.journalTransactionId ?? 'sin-diario'} no trae una comision positiva para construir el puente K.`,
    )
  }

  const patchItems: Array<Record<string, unknown>> = [
    {
      line: getNullableNumber(higoLine.line),
      account: getOptionalReferencePayload(higoLine.account),
      entity: getOptionalReferencePayload(higoLine.entity),
      department: getOptionalReferencePayload(higoLine.department),
      location: getOptionalReferencePayload(higoLine.location),
      memo: getNullableString(higoLine.memo),
      debit: higoDebitAmount,
    },
    {
      line: getNullableNumber(legacyCreditLine.line),
      account: providerAccount,
      entity: vendorEntity,
      department: getOptionalReferencePayload(legacyCreditLine.department),
      location: getOptionalReferencePayload(legacyCreditLine.location),
      memo: getNullableString(legacyCreditLine.memo) ?? bridgeMemos[0],
      debit: commissionComponents[0].commissionAmount,
    },
  ]
  commissionComponents.slice(1).forEach((component, index) => {
    patchItems.push({
      account: providerAccount,
      entity: vendorEntity,
      department: bridgeDepartment,
      location: bridgeLocation,
      memo: bridgeMemos[index + 1] ?? bridgeMemos[0] ?? buildKontempoBridgeMemo(component, summary, summary.customerName),
      debit: component.commissionAmount,
    })
  })
  components.forEach((component, index) => {
    patchItems.push({
      account: { id: bridgeBankAccountId, refName: bridgeBankAccountName },
      entity:
        component.customerId || component.customerName
          ? {
              id: component.customerId ?? undefined,
              refName: component.customerName ?? undefined,
            }
          : context.customer,
      department: bridgeDepartment,
      location: bridgeLocation,
      memo: bridgeMemos[index],
      credit: component.grossAmount,
    })
  })
  if (roundingAccountId && Math.abs(roundingDifference) > OPEN_AMOUNT_TOLERANCE) {
    patchItems.push({
      account: { id: roundingAccountId, refName: ROUNDING_ACCOUNT_DISPLAY_NAME },
      department: bridgeDepartment,
      location: bridgeLocation,
      memo: `Ajuste redondeo Kontempo ${k.journalDocument ?? k.journalTransactionId ?? ''}`.trim(),
      ...(roundingDifference > 0
        ? { credit: roundCurrency(roundingDifference) }
        : { debit: roundCurrency(Math.abs(roundingDifference)) }),
    })
  }

  await client.patchRecord('journalEntry', normalizeOptionalString(k.journalTransactionId) ?? '', {
    line: {
      items: patchItems,
    },
  })

  const refreshedResponse = await client.getRecord(
    'journalEntry',
    normalizeOptionalString(k.journalTransactionId) ?? '',
    {
      expandSubResources: true,
    },
  )
  const refreshedRecord = refreshedResponse.json as Record<string, unknown>
  const refreshedLineCollection = getNullableRecord(refreshedRecord.line)
  const refreshedItems = Array.isArray(refreshedLineCollection?.items) ? refreshedLineCollection.items : []
  const refreshedLines = refreshedItems
    .map((item) => getNullableRecord(item))
    .filter((line): line is Record<string, unknown> => line !== null)

  const refreshedBridgeLines = refreshedLines.filter(
    (line) =>
      getReferenceId(line.account) === bridgeBankAccountId &&
      (getNullableNumber(line.credit) ?? 0) > OPEN_AMOUNT_TOLERANCE,
  )
  const refreshedCommissionLines = refreshedLines.filter(
    (line) =>
      getReferenceId(line.account) === K_VENDOR_ACCOUNT_ID &&
      (getNullableNumber(line.debit) ?? 0) > OPEN_AMOUNT_TOLERANCE &&
      (!vendorEntity?.id || getReferenceId(line.entity) === vendorEntity.id),
  )
  const refreshedRoundingLines =
    roundingAccountId === null
      ? []
      : refreshedLines.filter(
          (line) =>
            getReferenceId(line.account) === roundingAccountId &&
            ((getNullableNumber(line.debit) ?? 0) > OPEN_AMOUNT_TOLERANCE ||
              (getNullableNumber(line.credit) ?? 0) > OPEN_AMOUNT_TOLERANCE),
        )
  const refreshedBridgeAmount = roundCurrency(
    refreshedBridgeLines.reduce((sum, line) => sum + (getNullableNumber(line.credit) ?? 0), 0),
  )
  const refreshedCommissionAmount = roundCurrency(
    refreshedCommissionLines.reduce((sum, line) => sum + (getNullableNumber(line.debit) ?? 0), 0),
  )
  const refreshedRoundingAmount = roundCurrency(
    refreshedRoundingLines.reduce(
      (sum, line) => sum + (getNullableNumber(line.credit) ?? 0) - (getNullableNumber(line.debit) ?? 0),
      0,
    ),
  )

  if (!amountsMatchExactly(refreshedBridgeAmount, grossAmount)) {
    throw new Error(
      `NetSuite no dejo el diario Kontempo ${k.journalDocument ?? k.journalTransactionId ?? 'sin-diario'} con el credito esperado a 100 Bancos Nacional.`,
    )
  }

  if (!amountsMatchExactly(refreshedCommissionAmount, commissionAmount)) {
    throw new Error(
      `NetSuite no dejo el diario Kontempo ${k.journalDocument ?? k.journalTransactionId ?? 'sin-diario'} con la comision esperada en Proveedores nacionales.`,
    )
  }

  if (!amountsMatchExactly(refreshedRoundingAmount, roundCurrency(Math.max(roundingDifference, 0)))) {
    const expectedNetRounding = roundCurrency(roundingDifference)
    if (!amountsMatchExactly(refreshedRoundingAmount, expectedNetRounding)) {
      throw new Error(
        `NetSuite no dejo el diario Kontempo ${k.journalDocument ?? k.journalTransactionId ?? 'sin-diario'} con el ajuste de redondeo esperado.`,
      )
    }
  }

  if (
    !refreshedBridgeLines.some((line) =>
      kontempoBridgeLineMatchesComponent(line, targetComponent, bridgeBankAccountId),
    )
  ) {
    throw new Error(
      `NetSuite no dejo el diario Kontempo ${k.journalDocument ?? k.journalTransactionId ?? 'sin-diario'} con la linea puente esperada para la factura ${summary.tranId ?? summary.internalId}.`,
    )
  }

  return refreshedRecord
}

function selectCustomerPaymentMatch(
  payments: LinkedCustomerPaymentRow[],
  expectedAmount: number,
  expectedTranDate: string,
  expectedAccountId: string,
) {
  const exactMatch =
    payments.find(
      (payment) =>
        payment.accountId === expectedAccountId &&
        amountsMatchExactly(payment.amount, expectedAmount) &&
        toNetSuiteDateString(payment.transactionDate) === expectedTranDate,
    ) ?? null

  if (exactMatch) {
    return exactMatch
  }

  return (
    payments.find(
      (payment) =>
        payment.accountId === expectedAccountId && amountsMatchExactly(payment.amount, expectedAmount),
    ) ?? null
  )
}

async function resolvePpd1JournalPaymentInstruction(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  candidate: FacturaAplicacionCandidata,
  options: { allowPrepare: boolean },
) {
  const targetAmount = getFacturaTargetAmount(summary)
  if (!targetAmount || targetAmount <= OPEN_AMOUNT_TOLERANCE) {
    throw new Error(`La factura ${summary.tranId ?? summary.internalId} no tiene un monto PPD1 valido.`)
  }

  const bridgeBankAccountId = await resolveB1BridgeBankAccountId(client)
  const sourceBank = await ensurePpd1JournalPrepared(
    client,
    summary,
    candidate,
    targetAmount,
    bridgeBankAccountId,
    B1_BRIDGE_BANK_ACCOUNT_DISPLAY_NAME,
    options.allowPrepare,
  )

  const journalTransactionDate = candidate.fecha ? toIsoDate(candidate.fecha) : null
  if (!journalTransactionDate) {
    throw new Error(
      `El diario ${candidate.documento ?? candidate.id} no trae una fecha valida para construir el pago PPD1.`,
    )
  }

  return {
    paymentAmount: targetAmount,
    journalTransactionId: candidate.id,
    journalDocument: candidate.documento,
    journalTransactionDate,
    bridgeBankAccountId,
    bridgeBankAccountName: B1_BRIDGE_BANK_ACCOUNT_DISPLAY_NAME,
    sourceBankAccountId: sourceBank.accountId,
    sourceBankAccountName: sourceBank.accountName,
    recipientAccount: sourceBank.recipientAccount,
    recipientRfc: sourceBank.recipientRfc,
    useNetSuiteDefaults: sourceBank.useNetSuiteDefaults,
  } satisfies Ppd1JournalPaymentInstruction
}

async function ensurePpd1JournalPrepared(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  candidate: FacturaAplicacionCandidata,
  targetAmount: number,
  bridgeBankAccountId: string,
  bridgeBankAccountName: string,
  allowPrepare: boolean,
) {
  const clientesAccountId = await resolveClientesAccountId(client)
  const journalResponse = await client.getRecord('journalEntry', candidate.id, {
    expandSubResources: true,
  })
  const journalRecord = journalResponse.json as Record<string, unknown>
  const lineCollection = getNullableRecord(journalRecord.line)
  const lineItems = Array.isArray(lineCollection?.items) ? lineCollection.items : []
  const normalizedLines = lineItems
    .map((item) => getNullableRecord(item))
    .filter((line): line is Record<string, unknown> => line !== null)

  const sourceBankLine = resolvePpd1SourceBankLine(normalizedLines, targetAmount)
  if (!sourceBankLine) {
    throw new Error(
      `El diario ${candidate.documento ?? candidate.id} no expone una linea de debito exacta en Higo, Clara Corriente o BBVA para la factura ${summary.tranId ?? summary.internalId}.`,
    )
  }

  const sourceBankName = getReferenceName(sourceBankLine.account)
  const sourceBankId = getReferenceId(sourceBankLine.account)
  const bankConfig = findPpd1SourceBankConfig(sourceBankName)
  if (!bankConfig || !sourceBankId || !sourceBankName) {
    throw new Error(
      `El diario ${candidate.documento ?? candidate.id} usa una cuenta bancaria no soportada para PPD1.`,
    )
  }

  const existingBridgeLine =
    normalizedLines.find(
      (line) =>
        getReferenceId(line.account) === bridgeBankAccountId &&
        (!summary.customerId || getReferenceId(line.entity) === summary.customerId) &&
        amountsMatchExactly(getNullableNumber(line.credit), targetAmount),
    ) ?? null
  const lingeringArLine =
    normalizedLines.find(
      (line) =>
        getReferenceId(line.account) === clientesAccountId &&
        (!summary.customerId || getReferenceId(line.entity) === summary.customerId) &&
        amountsMatchExactly(getNullableNumber(line.credit), targetAmount),
    ) ?? null

  if (existingBridgeLine) {
    if (lingeringArLine) {
      throw new Error(
        `El diario ${candidate.documento ?? candidate.id} mezcla credito a Clientes y cuenta puente 100 para el mismo monto PPD1 y requiere revision manual.`,
      )
    }

    return {
      accountId: sourceBankId,
      accountName: sourceBankName,
      recipientAccount: bankConfig.recipientAccount,
      recipientRfc: bankConfig.recipientRfc,
      useNetSuiteDefaults: bankConfig.useNetSuiteDefaults,
    }
  }

  const exactCreditLine = await resolvePpd1JournalCreditLine(
    client,
    candidate.id,
    summary.customerId,
    targetAmount,
    clientesAccountId,
  )
  const arLine =
    normalizedLines.find(
      (line) =>
        getNullableNumber(line.line) === exactCreditLine.lineId &&
        getReferenceId(line.account) === clientesAccountId,
    ) ??
    normalizedLines.find(
      (line) =>
        getReferenceId(line.account) === clientesAccountId &&
        (!summary.customerId || getReferenceId(line.entity) === summary.customerId) &&
        amountsMatchExactly(getNullableNumber(line.credit), targetAmount),
    ) ??
    null

  if (!arLine) {
    throw new Error(
      `El diario ${candidate.documento ?? candidate.id} ya no expone una linea de credito exacta en Clientes nacionales para PPD1.`,
    )
  }

  const sourceBankLineNumber = getNullableNumber(sourceBankLine.line)
  const arLineNumber = getNullableNumber(arLine.line)
  if (sourceBankLineNumber === null || arLineNumber === null) {
    throw new Error(
      `NetSuite no devolvio los numeros de linea necesarios para homologar el diario ${candidate.documento ?? candidate.id} en PPD1.`,
    )
  }

  if (!allowPrepare) {
    return {
      accountId: sourceBankId,
      accountName: sourceBankName,
      recipientAccount: bankConfig.recipientAccount,
      recipientRfc: bankConfig.recipientRfc,
      useNetSuiteDefaults: bankConfig.useNetSuiteDefaults,
    }
  }

  const patchPayload: Record<string, unknown> = {
    line: {
      items: [
        {
          line: sourceBankLineNumber,
          account: getOptionalReferencePayload(sourceBankLine.account),
          entity: getOptionalReferencePayload(sourceBankLine.entity),
          department: getOptionalReferencePayload(sourceBankLine.department),
          location: getOptionalReferencePayload(sourceBankLine.location),
          memo: getNullableString(sourceBankLine.memo),
          debit: targetAmount,
        },
        {
          line: arLineNumber,
          account: { id: bridgeBankAccountId, refName: bridgeBankAccountName },
          entity: getOptionalReferencePayload(arLine.entity),
          department: getOptionalReferencePayload(arLine.department),
          location: getOptionalReferencePayload(arLine.location),
          memo: getNullableString(arLine.memo) ?? `Auto PPD1 puente | ${summary.tranId ?? summary.internalId}`,
          credit: targetAmount,
        },
      ],
    },
  }

  await client.patchRecord('journalEntry', candidate.id, patchPayload)

  const refreshedResponse = await client.getRecord('journalEntry', candidate.id, {
    expandSubResources: true,
  })
  const refreshedRecord = refreshedResponse.json as Record<string, unknown>
  const refreshedLineCollection = getNullableRecord(refreshedRecord.line)
  const refreshedLineItems = Array.isArray(refreshedLineCollection?.items) ? refreshedLineCollection.items : []
  const refreshedLines = refreshedLineItems
    .map((item) => getNullableRecord(item))
    .filter((line): line is Record<string, unknown> => line !== null)
  const refreshedBridgeLine =
    refreshedLines.find(
      (line) =>
        getReferenceId(line.account) === bridgeBankAccountId &&
        (!summary.customerId || getReferenceId(line.entity) === summary.customerId) &&
        amountsMatchExactly(getNullableNumber(line.credit), targetAmount),
    ) ?? null

  if (!refreshedBridgeLine) {
    throw new Error(
      `NetSuite no dejo el diario ${candidate.documento ?? candidate.id} homologado a la cuenta puente 100 para PPD1.`,
    )
  }

  return {
    accountId: sourceBankId,
    accountName: sourceBankName,
    recipientAccount: bankConfig.recipientAccount,
    recipientRfc: bankConfig.recipientRfc,
    useNetSuiteDefaults: bankConfig.useNetSuiteDefaults,
  }
}

function resolvePpd1SourceBankLine(lines: Record<string, unknown>[], targetAmount: number) {
  return (
    lines.find((line) => {
      const accountName = getReferenceName(line.account)
      return (
        Boolean(findPpd1SourceBankConfig(accountName)) &&
        amountsMatchExactly(getNullableNumber(line.debit), targetAmount)
      )
    }) ?? null
  )
}

function findPpd1SourceBankConfig(accountName: string | null | undefined) {
  const normalizedName = normalizeComparableText(accountName)
  const accountNumber = extractAccountNumber(accountName)

  return (
    PPD1_SOURCE_BANK_CONFIGS.find((config) => normalizeComparableText(config.accountName) === normalizedName) ??
    PPD1_SOURCE_BANK_CONFIGS.find((config) => config.accountNumber === accountNumber) ??
    null
  )
}

async function resolvePpd1JournalCreditLine(
  client: NetSuiteClient,
  journalTransactionId: string,
  customerId: string | null,
  targetAmount: number,
  clientesAccountId: string,
) {
  const rows = (await fetchAllSuiteQlRows(client, buildJournalAvailableCreditLinesQuery(journalTransactionId)))
    .map(toJournalAvailableCreditLineRow)
    .filter(
      (row) =>
        row.accountId === clientesAccountId &&
        (!customerId || row.customerId === customerId) &&
        amountsMatchExactly(row.availableAmount, targetAmount),
    )

  if (rows.length === 0) {
    throw new Error(
      `El diario ${journalTransactionId} ya no tiene una linea exacta disponible en Clientes nacionales para PPD1.`,
    )
  }

  if (rows.length > 1) {
    throw new Error(
      `El diario ${journalTransactionId} tiene varias lineas exactas disponibles para PPD1 y requiere revision manual.`,
    )
  }

  const [row] = rows
  if (row.lineId === null) {
    throw new Error(`NetSuite no devolvio el numero de linea aplicable del diario ${journalTransactionId}.`)
  }

  return row
}

function buildJournalAvailableCreditLinesQuery(journalTransactionId: string) {
  return `
SELECT
  transaction.id AS transactionId,
  transaction.tranid AS tranId,
  tal.transactionline AS lineId,
  tal.account AS accountId,
  BUILTIN.DF(tal.account) AS accountName,
  line.entity AS customerId,
  BUILTIN.DF(line.entity) AS customerName,
  tal.credit AS creditAmount,
  COALESCE(applied.appliedAmount, 0) AS appliedAmount,
  (tal.credit - COALESCE(applied.appliedAmount, 0)) AS availableAmount
FROM transaction
INNER JOIN transactionaccountingline tal
  ON tal.transaction = transaction.id
  AND tal.posting = 'T'
INNER JOIN transactionline line
  ON line.transaction = tal.transaction
  AND line.id = tal.transactionline
LEFT JOIN (
  SELECT
    PreviousTransactionLineLink.nextdoc AS nextDoc,
    PreviousTransactionLineLink.nextline AS nextLine,
    SUM(PreviousTransactionLineLink.foreignamount) AS appliedAmount
  FROM PreviousTransactionLineLink
  GROUP BY PreviousTransactionLineLink.nextdoc, PreviousTransactionLineLink.nextline
) applied
  ON applied.nextDoc = transaction.id
  AND applied.nextLine = tal.transactionline
WHERE transaction.id = ${formatSuiteQlLiteral(journalTransactionId)}
  AND tal.credit > ${OPEN_AMOUNT_TOLERANCE}
ORDER BY tal.transactionline ASC
  `.trim()
}

function toJournalAvailableCreditLineRow(row: Record<string, unknown>): JournalAvailableCreditLineRow {
  const normalizedRow = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]),
  ) as Record<string, unknown>

  return {
    transactionId: String(normalizedRow.transactionid ?? ''),
    tranId: getNullableString(normalizedRow.tranid),
    lineId: getNullableNumber(normalizedRow.lineid),
    accountId: getNullableString(normalizedRow.accountid),
    accountName: getNullableString(normalizedRow.accountname),
    customerId: getNullableString(normalizedRow.customerid),
    customerName: getNullableString(normalizedRow.customername),
    creditAmount: getNullableNumber(normalizedRow.creditamount),
    appliedAmount: getNullableNumber(normalizedRow.appliedamount),
    availableAmount: getNullableNumber(normalizedRow.availableamount),
  }
}

async function resolvePpd1CandidateForExecution(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  candidates: FacturaAplicacionCandidata[],
  targetAmount: number | null,
) {
  if (candidates.length === 0) {
    return null
  }

  if (candidates.length === 1) {
    return candidates[0]
  }

  if (!summary.customerId || !targetAmount || targetAmount <= OPEN_AMOUNT_TOLERANCE) {
    return null
  }

  const peers = await fetchOpenPpdInvoicesWithSameCustomerAmount(client, summary.customerId, targetAmount)
  if (peers.length !== candidates.length) {
    return null
  }

  const sortedPeers = [...peers].sort((left, right) => {
    const leftDate = getComparableDateValue(left.transactionDate)
    const rightDate = getComparableDateValue(right.transactionDate)
    if (leftDate !== rightDate) {
      return leftDate - rightDate
    }

    return (left.tranId ?? left.internalId).localeCompare(right.tranId ?? right.internalId, 'es')
  })
  const peerIndex = sortedPeers.findIndex((peer) => peer.internalId === summary.internalId)
  if (peerIndex < 0) {
    return null
  }

  const sortedCandidates = [...candidates].sort((left, right) => {
    const leftDate = getComparableDateValue(left.fecha)
    const rightDate = getComparableDateValue(right.fecha)
    if (leftDate !== rightDate) {
      return leftDate - rightDate
    }

    return (left.documento ?? left.id).localeCompare(right.documento ?? right.id, 'es')
  })

  return sortedCandidates[peerIndex] ?? null
}

async function fetchOpenPpdInvoicesWithSameCustomerAmount(
  client: NetSuiteClient,
  customerId: string,
  targetAmount: number,
) {
  return (await fetchAllSuiteQlRows(client, buildPpd1OpenInvoicesByCustomerAmountQuery(customerId, targetAmount))).map(
    toPpd1OpenInvoicePeerRow,
  )
}

function buildPpd1OpenInvoicesByCustomerAmountQuery(customerId: string, targetAmount: number) {
  return `
SELECT
  transaction.id AS internalId,
  transaction.tranid AS tranId,
  transaction.trandate AS transactionDate,
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
  AND transaction.entity = ${formatSuiteQlLiteral(customerId)}
  AND transaction.custbody_mx_txn_sat_payment_term = '4'
GROUP BY transaction.id, transaction.tranid, transaction.trandate
HAVING MAX(ABS(tal.amountunpaid)) > ${OPEN_AMOUNT_TOLERANCE}
  AND ABS(MAX(ABS(tal.amountunpaid)) - ${roundCurrency(targetAmount)}) <= ${OPEN_AMOUNT_TOLERANCE}
ORDER BY transaction.trandate ASC, transaction.id ASC
  `.trim()
}

function toPpd1OpenInvoicePeerRow(row: Record<string, unknown>): Ppd1OpenInvoicePeerRow {
  const normalizedRow = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]),
  ) as Record<string, unknown>

  return {
    internalId: String(normalizedRow.internalid ?? ''),
    tranId: getNullableString(normalizedRow.tranid),
    transactionDate: getNullableString(normalizedRow.transactiondate),
    amountRemaining: getNullableNumber(normalizedRow.amountremaining),
  }
}

async function ensurePpd1CustomerPayment(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  instruction: Ppd1JournalPaymentInstruction,
  existingPayment: LinkedCustomerPaymentRow | null,
) {
  const context = await getInvoicePaymentContext(client, summary)
  const memo = buildPpd1CustomerPaymentMemo(summary, instruction)
  const expectedPaymentDateTime = buildPpd1PaymentDateTime(instruction.journalTransactionDate)

  if (existingPayment) {
    const patchPayload = buildPpd1CustomerPaymentPayload(
      context,
      summary,
      instruction,
      memo,
      expectedPaymentDateTime,
    )
    delete patchPayload.apply
    delete patchPayload.account
    delete patchPayload.payment
    delete patchPayload.custbody_psg_ei_status

    await client.patchRecord('customerpayment', existingPayment.transactionId, patchPayload)
    await verifyPpd1CustomerPayment(
      client,
      existingPayment.transactionId,
      summary,
      instruction,
      expectedPaymentDateTime,
    )

    const refreshedPayment = await client.getRecord('customerpayment', existingPayment.transactionId)
    const refreshedRecord = getNullableRecord(refreshedPayment.json)
    return {
      id: existingPayment.transactionId,
      tranId:
        getNullableString(refreshedRecord?.tranId) ??
        getNullableString(refreshedRecord?.transactionNumber) ??
        existingPayment.tranId,
    }
  }

  const payload = buildPpd1CustomerPaymentPayload(
    context,
    summary,
    instruction,
    memo,
    expectedPaymentDateTime,
  )
  const payment = await postCustomerPayment(client, payload)
  if (!payment.id) {
    throw new Error(
      `NetSuite acepto crear el pago PPD1 para la factura ${summary.tranId ?? summary.internalId}, pero no devolvio el id interno del pago.`,
    )
  }
  await verifyPpd1CustomerPayment(client, payment.id, summary, instruction, expectedPaymentDateTime)
  return payment
}

async function findPpd1CustomerPaymentCollisions(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  instruction: Ppd1JournalPaymentInstruction,
) {
  if (!summary.customerId) {
    return [] satisfies KontempoCustomerPaymentCollision[]
  }

  const query = `
SELECT
  payment.id AS transactionId,
  payment.tranid AS tranId,
  payment.trandate AS transactionDate,
  payment.foreigntotal AS amount,
  payment.account AS accountId,
  BUILTIN.DF(payment.account) AS accountName
FROM transaction payment
WHERE payment.type = 'CustPymt'
  AND payment.entity = ${formatSuiteQlLiteral(summary.customerId)}
  AND payment.account = ${formatSuiteQlLiteral(instruction.bridgeBankAccountId)}
  AND payment.trandate = TO_DATE(${formatSuiteQlLiteral(instruction.journalTransactionDate)}, 'YYYY-MM-DD')
ORDER BY payment.id DESC
  `.trim()

  const candidatePayments = (await fetchAllSuiteQlRows(client, query))
    .map(toLinkedCustomerPaymentRow)
    .filter((payment) => amountsMatchExactly(payment.amount, instruction.paymentAmount))

  if (candidatePayments.length === 0) {
    return [] satisfies KontempoCustomerPaymentCollision[]
  }

  return mapWithConcurrency(candidatePayments, FACTURA_RAW_FETCH_CONCURRENCY, async (payment) => ({
    payment,
    appliedInvoices: await fetchCustomerPaymentAppliedInvoices(client, payment.transactionId),
  }))
}

async function resolvePpd1CustomerPaymentGuardrail(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  instruction: Ppd1JournalPaymentInstruction,
  existingPayment: LinkedCustomerPaymentRow | null,
) {
  if (existingPayment) {
    return {
      existingPayment,
      collisionMessage: null,
    } satisfies {
      existingPayment: LinkedCustomerPaymentRow | null
      collisionMessage: string | null
    }
  }

  const collisions = await findPpd1CustomerPaymentCollisions(client, summary, instruction)
  if (collisions.length === 0) {
    return {
      existingPayment: null,
      collisionMessage: null,
    } satisfies {
      existingPayment: LinkedCustomerPaymentRow | null
      collisionMessage: string | null
    }
  }

  const targetCollision =
    collisions.find((collision) =>
      collision.appliedInvoices.some((invoice) => invoice.internalId === summary.internalId),
    ) ?? null
  if (targetCollision) {
    return {
      existingPayment: targetCollision.payment,
      collisionMessage: null,
    } satisfies {
      existingPayment: LinkedCustomerPaymentRow | null
      collisionMessage: string | null
    }
  }

  return {
    existingPayment: null,
    collisionMessage: `Guardrail PPD1: ya existe un pago equivalente en la cuenta puente para la factura ${summary.tranId ?? summary.internalId}. ${collisions
      .map((collision) => formatCustomerPaymentCollision(collision))
      .join(' | ')}. Revisar manualmente antes de crear otro pago.`,
  } satisfies {
    existingPayment: LinkedCustomerPaymentRow | null
    collisionMessage: string | null
  }
}

function buildPpd1CustomerPaymentPayload(
  context: Awaited<ReturnType<typeof getInvoicePaymentContext>>,
  summary: FacturaOpenSummaryRow,
  instruction: Ppd1JournalPaymentInstruction,
  memo: string,
  paymentDateTime: string,
) {
  const payload = buildCustomerPaymentBasePayload(context, memo, instruction.journalTransactionDate)
  payload.account = {
    id: instruction.bridgeBankAccountId,
    refName: instruction.bridgeBankAccountName,
  }
  payload.payment = instruction.paymentAmount
  payload.apply = {
    items: [
      {
        doc: { id: summary.internalId },
        line: 0,
        apply: true,
        amount: instruction.paymentAmount,
      },
    ],
  }
  payload.toBeEmailed = false
  payload.toBePrinted = false
  payload.toBeFaxed = false
  payload.custbody_psg_ei_template = {
    id: PPD1_CUSTOMER_PAYMENT_TEMPLATE_ID,
    refName: PPD1_CUSTOMER_PAYMENT_TEMPLATE_NAME,
  }
  payload.custbody_psg_ei_sending_method = {
    id: PPD1_SENDING_METHOD_ID,
    refName: PPD1_SENDING_METHOD_NAME,
  }
  payload.custbody_psg_ei_trans_edoc_standard = {
    id: PPD1_E_DOC_STANDARD_ID,
    refName: PPD1_E_DOC_STANDARD_NAME,
  }
  payload.custbody_psg_ei_status = {
    id: PPD1_E_DOC_STATUS_PENDING_ID,
    refName: PPD1_E_DOC_STATUS_PENDING_NAME,
  }
  payload.custbody_mx_txn_sat_payment_method = {
    id: PPD1_SAT_PAYMENT_METHOD_ID,
    refName: PPD1_SAT_PAYMENT_METHOD_NAME,
  }
  payload.custbody_mx_cfdi_payment_string_type = {
    id: PPD1_PAYMENT_STRING_TYPE_ID,
    refName: PPD1_PAYMENT_STRING_TYPE_NAME,
  }
  payload.custbody_mx_cfdi_recipient_account = instruction.useNetSuiteDefaults
    ? null
    : instruction.recipientAccount
  payload.custbody_mx_cfdi_recipient_entity_rfc = instruction.useNetSuiteDefaults
    ? null
    : instruction.recipientRfc
  payload.custbody_shq_currency_payment = context.currency
  payload.custbody_shq_fecha_pago = paymentDateTime
  payload.custbody_shq_payment = instruction.paymentAmount

  if (context.exchangeRate !== null) {
    payload.custbody_shq_tc_docs = context.exchangeRate
  }

  return payload
}

function buildPpd1CustomerPaymentMemo(
  summary: FacturaOpenSummaryRow,
  instruction: Ppd1JournalPaymentInstruction,
) {
  return [
    'Auto PPD1',
    summary.tranId ?? summary.transactionNumber ?? summary.internalId,
    instruction.journalDocument ?? instruction.journalTransactionId,
    instruction.sourceBankAccountName,
  ]
    .filter(Boolean)
    .join(' | ')
}

function buildPpd1PaymentDateTime(tranDate: string) {
  const netSuiteDate = toNetSuiteDateString(tranDate)
  if (!netSuiteDate) {
    throw new Error('PPD1 no pudo construir una fecha de pago valida.')
  }

  return `${netSuiteDate}T${PPD1_PAYMENT_MEXICO_UTC_TIME}`
}

async function verifyPpd1CustomerPayment(
  client: NetSuiteClient,
  customerPaymentId: string,
  summary: FacturaOpenSummaryRow,
  instruction: Ppd1JournalPaymentInstruction,
  expectedPaymentDateTime: string,
) {
  const response = await client.getRecord('customerpayment', customerPaymentId, {
    expandSubResources: true,
  })
  const record = getNullableRecord(response.json)

  if (getReferenceId(record?.account) !== instruction.bridgeBankAccountId) {
    throw new Error(
      `NetSuite no dejo el pago ${customerPaymentId} contra la cuenta puente 100 para la factura ${summary.tranId ?? summary.internalId}.`,
    )
  }

  if (toNetSuiteDateString(getNullableString(record?.tranDate)) !== instruction.journalTransactionDate) {
    throw new Error(
      `NetSuite no dejo el pago ${customerPaymentId} con la misma fecha del diario ${instruction.journalDocument ?? instruction.journalTransactionId}.`,
    )
  }

  if (!amountsMatchExactly(getNullableNumber(record?.payment), instruction.paymentAmount)) {
    throw new Error(
      `NetSuite no dejo el pago ${customerPaymentId} con el monto PPD1 esperado para la factura ${summary.tranId ?? summary.internalId}.`,
    )
  }

  if (getReferenceId(record?.custbody_psg_ei_template) !== PPD1_CUSTOMER_PAYMENT_TEMPLATE_ID) {
    throw new Error(`El pago ${customerPaymentId} no quedo con la plantilla E-Document PPD1 esperada.`)
  }

  if (getReferenceId(record?.custbody_psg_ei_sending_method) !== PPD1_SENDING_METHOD_ID) {
    throw new Error(`El pago ${customerPaymentId} no quedo con el metodo de envio E-Document PPD1 esperado.`)
  }

  if (getReferenceId(record?.custbody_mx_txn_sat_payment_method) !== PPD1_SAT_PAYMENT_METHOD_ID) {
    throw new Error(`El pago ${customerPaymentId} no quedo con la forma de pago SAT 03 esperada.`)
  }

  if (getReferenceId(record?.custbody_mx_cfdi_payment_string_type) !== PPD1_PAYMENT_STRING_TYPE_ID) {
    throw new Error(`El pago ${customerPaymentId} no quedo con el tipo de cadena 01 SPEI esperado.`)
  }

  if (!instruction.useNetSuiteDefaults) {
    if (getNullableString(record?.custbody_mx_cfdi_recipient_account) !== instruction.recipientAccount) {
      throw new Error(`El pago ${customerPaymentId} no quedo con la cuenta beneficiaria esperada para PPD1.`)
    }

    if (getNullableString(record?.custbody_mx_cfdi_recipient_entity_rfc) !== instruction.recipientRfc) {
      throw new Error(`El pago ${customerPaymentId} no quedo con el RFC beneficiario esperado para PPD1.`)
    }
  }

  if (summary.currencyId && getReferenceId(record?.custbody_shq_currency_payment) !== summary.currencyId) {
    throw new Error(`El pago ${customerPaymentId} no quedo con la moneda de pago PPD1 esperada.`)
  }

  if (!amountsMatchExactly(getNullableNumber(record?.custbody_shq_payment), instruction.paymentAmount)) {
    throw new Error(`El pago ${customerPaymentId} no quedo con el monto SHQ de pago PPD1 esperado.`)
  }

  if (normalizeOptionalString(getNullableString(record?.custbody_shq_fecha_pago)) !== expectedPaymentDateTime) {
    throw new Error(`El pago ${customerPaymentId} no quedo con la fecha de pago PPD1 esperada.`)
  }

  const applyCollection = getNullableRecord(record?.apply)
  const applyItems = Array.isArray(applyCollection?.items) ? applyCollection.items : []
  const invoiceApplyLine = applyItems
    .map((item) => getNullableRecord(item))
    .find((item) => getReferenceId(item?.doc) === summary.internalId)

  if (!(getNullableBoolean(invoiceApplyLine?.apply) ?? false)) {
    throw new Error(
      `El pago ${customerPaymentId} no quedo aplicado a la factura ${summary.tranId ?? summary.internalId}.`,
    )
  }

  if (!amountsMatchExactly(getNullableNumber(invoiceApplyLine?.amount), instruction.paymentAmount)) {
    throw new Error(
      `El pago ${customerPaymentId} no quedo aplicado por el monto PPD1 correcto a la factura ${summary.tranId ?? summary.internalId}.`,
    )
  }
}

async function verifyKontempoCustomerPayment(
  client: NetSuiteClient,
  customerPaymentId: string,
  summary: FacturaOpenSummaryRow,
  instruction: KontempoJournalPaymentInstruction,
  expectedPaymentDateTime: string,
) {
  const response = await client.getRecord('customerpayment', customerPaymentId, {
    expandSubResources: true,
  })
  const record = getNullableRecord(response.json)

  if (getReferenceId(record?.account) !== instruction.bridgeBankAccountId) {
    throw new Error(
      `NetSuite no dejo el pago ${customerPaymentId} contra la cuenta puente 100 para la factura ${summary.tranId ?? summary.internalId}.`,
    )
  }

  if (toNetSuiteDateString(getNullableString(record?.tranDate)) !== instruction.journalTransactionDate) {
    throw new Error(
      `NetSuite no dejo el pago ${customerPaymentId} con la misma fecha del diario Kontempo ${instruction.journalDocument ?? instruction.journalTransactionId}.`,
    )
  }

  if (!amountsMatchExactly(getNullableNumber(record?.payment), instruction.paymentAmount)) {
    throw new Error(
      `NetSuite no dejo el pago ${customerPaymentId} con el monto Kontempo esperado para la factura ${summary.tranId ?? summary.internalId}.`,
    )
  }

  if (getReferenceId(record?.custbody_psg_ei_template) !== K_CUSTOMER_PAYMENT_TEMPLATE_ID) {
    throw new Error(`El pago ${customerPaymentId} no quedo con la plantilla E-Document Kontempo esperada.`)
  }

  if (getReferenceId(record?.custbody_psg_ei_sending_method) !== K_SENDING_METHOD_ID) {
    throw new Error(`El pago ${customerPaymentId} no quedo con el metodo de envio E-Document Kontempo esperado.`)
  }

  if (getReferenceId(record?.custbody_mx_txn_sat_payment_method) !== K_SAT_PAYMENT_METHOD_ID) {
    throw new Error(`El pago ${customerPaymentId} no quedo con la forma de pago SAT 03 esperada.`)
  }

  if (getReferenceId(record?.custbody_mx_cfdi_payment_string_type) !== K_PAYMENT_STRING_TYPE_ID) {
    throw new Error(`El pago ${customerPaymentId} no quedo con el tipo de cadena 01 SPEI esperado.`)
  }

  if (getNullableString(record?.custbody_mx_cfdi_recipient_account) !== K_RECIPIENT_ACCOUNT) {
    throw new Error(`El pago ${customerPaymentId} no quedo con la cuenta beneficiaria STP esperada.`)
  }

  if (getNullableString(record?.custbody_mx_cfdi_recipient_entity_rfc) !== K_RECIPIENT_RFC) {
    throw new Error(`El pago ${customerPaymentId} no quedo con el RFC beneficiario STP esperado.`)
  }

  if (getReferenceId(record?.custbody_shq_currency_payment) !== '1') {
    throw new Error(`El pago ${customerPaymentId} no quedo con MXN como moneda de pago Kontempo.`)
  }

  if (!amountsMatchExactly(getNullableNumber(record?.custbody_shq_payment), instruction.bridgeGrossAmount)) {
    throw new Error(`El pago ${customerPaymentId} no quedo con el monto SHQ de pago Kontempo esperado.`)
  }

  if (normalizeOptionalString(getNullableString(record?.custbody_shq_fecha_pago)) !== expectedPaymentDateTime) {
    throw new Error(`El pago ${customerPaymentId} no quedo con la fecha de pago Kontempo esperada.`)
  }

  const applyCollection = getNullableRecord(record?.apply)
  const applyItems = Array.isArray(applyCollection?.items) ? applyCollection.items : []
  const invoiceApplyLine = applyItems
    .map((item) => getNullableRecord(item))
    .find((item) => getReferenceId(item?.doc) === summary.internalId)

  if (!(getNullableBoolean(invoiceApplyLine?.apply) ?? false)) {
    throw new Error(
      `El pago ${customerPaymentId} no quedo aplicado a la factura ${summary.tranId ?? summary.internalId}.`,
    )
  }

  if (!amountsMatchExactly(getNullableNumber(invoiceApplyLine?.amount), instruction.paymentAmount)) {
    throw new Error(
      `El pago ${customerPaymentId} no quedo aplicado por el monto Kontempo correcto a la factura ${summary.tranId ?? summary.internalId}.`,
    )
  }
}

async function auditSalesOrderSettlementAfterApply(
  client: NetSuiteClient,
  options: {
    ruleCode: 'A4' | 'A5' | 'A7' | 'B3'
    salesOrderInternalId: string
    salesOrderDocument: string | null
    targetInvoices: Array<{ internalId: string; documento: string | null }>
  },
) {
  const orderInvoices = await fetchSalesOrderInvoiceAuditRows(client, options.salesOrderInternalId)
  const salesOrderLabel = options.salesOrderDocument ?? options.salesOrderInternalId

  if (orderInvoices.length === 0) {
    return [
      `Aviso sistema ${options.ruleCode}: NetSuite no devolvio facturas para la orden ${salesOrderLabel} despues de aplicar; revisar manualmente la orden.`,
    ]
  }

  const targetIds = new Set(options.targetInvoices.map((invoice) => invoice.internalId))
  const missingTargets = options.targetInvoices.filter(
    (invoice) => !orderInvoices.some((row) => row.internalId === invoice.internalId),
  )
  const warnings: string[] = []

  if (missingTargets.length > 0) {
    warnings.push(
      `Aviso sistema ${options.ruleCode}: la orden ${salesOrderLabel} no devolvio las facturas esperadas ${missingTargets
        .map((invoice) => invoice.documento ?? invoice.internalId)
        .join(', ')}; revisar manualmente antes de seguir.`,
    )
  }

  const targetOpenRows = orderInvoices.filter(
    (row) => targetIds.has(row.internalId) && (row.amountRemaining ?? 0) > OPEN_AMOUNT_TOLERANCE,
  )
  if (targetOpenRows.length > 0) {
    warnings.push(
      `Aviso sistema ${options.ruleCode}: fuga detectada en la orden ${salesOrderLabel}; las facturas objetivo siguen abiertas: ${targetOpenRows
        .map((row) => `${row.tranId ?? row.internalId} (${(row.amountRemaining ?? 0).toFixed(2)})`)
        .join(', ')}.`,
    )
  }

  const unexpectedOpenRows = orderInvoices.filter(
    (row) => !targetIds.has(row.internalId) && (row.amountRemaining ?? 0) > OPEN_AMOUNT_TOLERANCE,
  )
  if (unexpectedOpenRows.length > 0) {
    warnings.push(
      `Aviso sistema ${options.ruleCode}: la orden ${salesOrderLabel} conserva facturas abiertas no previstas tras la aplicacion: ${unexpectedOpenRows
        .map((row) => `${row.tranId ?? row.internalId} (${(row.amountRemaining ?? 0).toFixed(2)})`)
        .join(', ')}.`,
    )
  }

  return warnings
}

function resolveSingleSalesOrderForGroupedInvoices(summaries: FacturaOpenSummaryRow[]) {
  const salesOrderIds = uniqueValues(
    summaries.map((summary) => normalizeOptionalString(summary.createdFromId)).filter((value): value is string => Boolean(value)),
  )

  if (salesOrderIds.length !== 1) {
    return null
  }

  const [salesOrderInternalId] = salesOrderIds
  const salesOrderDocument =
    summaries
      .map((summary) => normalizeOptionalString(summary.createdFromName))
      .find((value): value is string => Boolean(value)) ?? null

  return {
    salesOrderInternalId,
    salesOrderDocument,
  }
}

async function createCustomerPaymentUsingCredit(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  creditTransactionId: string,
  amount: number,
  memo: string,
  tranDate?: string | null,
) {
  const creditLine = await resolveCreditApplicationLine(client, creditTransactionId, summary.customerId)
  return createCustomerPaymentApplyingDocumentUsingCredit(
    client,
    summary,
    {
      documentId: summary.internalId,
      applyLine: 0,
      amount,
    },
    {
      creditTransactionId,
      creditLine,
      amount,
    },
    memo,
    tranDate,
  )
}

async function createCustomerPaymentApplyingDocumentUsingCredit(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  target: {
    documentId: string
    applyLine: number
    amount: number
  },
  credit: {
    creditTransactionId: string
    creditLine: number
    amount: number
  },
  memo: string,
  tranDate?: string | null,
) {
  const context = await getInvoicePaymentContext(client, summary)
  const payload = buildCustomerPaymentBasePayload(context, memo, tranDate)
  payload.apply = {
    items: [
      {
        doc: { id: target.documentId },
        line: target.applyLine,
        apply: true,
        amount: target.amount,
      },
    ],
  }
  payload.credit = {
    items: [
      {
        doc: { id: credit.creditTransactionId },
        line: credit.creditLine,
        apply: true,
        amount: credit.amount,
      },
    ],
  }

  return postCustomerPayment(client, payload)
}

async function createCustomerPaymentUsingAccount(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  amount: number,
  accountId: string,
  accountDisplayName: string,
  memo: string,
  tranDate?: string | null,
) {
  const context = await getInvoicePaymentContext(client, summary)
  const payload = buildCustomerPaymentBasePayload(context, memo, tranDate)
  payload.account = { id: accountId, refName: accountDisplayName }
  payload.payment = amount
  payload.apply = {
    items: [
      {
        doc: { id: summary.internalId },
        line: 0,
        apply: true,
        amount,
      },
    ],
  }

  return postCustomerPayment(client, payload)
}

async function resolveDebitApplicationLine(
  client: NetSuiteClient,
  transactionId: string,
  customerId: string | null,
) {
  const journalResponse = await client.getRecord('journalEntry', transactionId, {
    expandSubResources: true,
  })
  const journalRecord = journalResponse.json as Record<string, unknown>
  const lineCollection = getNullableRecord(journalRecord.line)
  const lineItems = Array.isArray(lineCollection?.items) ? lineCollection.items : []
  const clientesAccountId = await resolveClientesAccountId(client)

  const normalizedLines = lineItems
    .map((item) => getNullableRecord(item))
    .filter((line): line is Record<string, unknown> => line !== null)
  const matchedLine = normalizedLines.find(
    (line) =>
      getReferenceId(line.account) === clientesAccountId &&
      (getNullableNumber(line.debit) ?? 0) > OPEN_AMOUNT_TOLERANCE &&
      (!customerId || getReferenceId(line.entity) === customerId),
  )
  const fallbackLine =
    matchedLine ??
    normalizedLines.find(
      (line) =>
        getReferenceId(line.account) === clientesAccountId &&
        (getNullableNumber(line.debit) ?? 0) > OPEN_AMOUNT_TOLERANCE,
    )

  const lineNumber = getNullableNumber(fallbackLine?.line)
  if (lineNumber === null) {
    throw new Error(
      `No se pudo identificar la linea de debito aplicable del diario ${transactionId} en Clientes nacionales.`,
    )
  }

  return lineNumber
}

async function resolveCreditApplicationLine(
  client: NetSuiteClient,
  creditTransactionId: string,
  customerId: string | null,
  options?: { requireCustomerMatch?: boolean },
) {
  const journalResponse = await client.getRecord('journalEntry', creditTransactionId, {
    expandSubResources: true,
  })
  const journalRecord = journalResponse.json as Record<string, unknown>
  const lineCollection = getNullableRecord(journalRecord.line)
  const lineItems = Array.isArray(lineCollection?.items) ? lineCollection.items : []
  const clientesAccountId = await resolveClientesAccountId(client)

  const normalizedLines = lineItems
    .map((item) => getNullableRecord(item))
    .filter((line): line is Record<string, unknown> => line !== null)
  const customerMatchedLine = normalizedLines.find(
    (line) =>
      getReferenceId(line.account) === clientesAccountId &&
      (getNullableNumber(line.credit) ?? 0) > OPEN_AMOUNT_TOLERANCE &&
      (!customerId || getReferenceId(line.entity) === customerId),
  )

  if (!customerMatchedLine && options?.requireCustomerMatch && customerId) {
    throw new Error(
      `El credito ${creditTransactionId} no expone una linea de Clientes nacionales para el cliente ${customerId}.`,
    )
  }

  const preferredLine =
    customerMatchedLine ??
    normalizedLines.find(
      (line) =>
        getReferenceId(line.account) === clientesAccountId &&
        (getNullableNumber(line.credit) ?? 0) > OPEN_AMOUNT_TOLERANCE,
    )

  const lineNumber = getNullableNumber(preferredLine?.line)
  if (lineNumber === null) {
    throw new Error(
      `No se pudo identificar la linea aplicable del credito ${creditTransactionId} en Clientes nacionales.`,
    )
  }

  return lineNumber
}

async function postCustomerPayment(client: NetSuiteClient, payload: Record<string, unknown>) {
  const createResponse = await client.createRecord('customerpayment', payload)
  const createdRecord = getNullableRecord(createResponse.json)
  const customerPaymentId = normalizeCreatedRecordId(
    getNullableString(createdRecord?.id) ?? parseRecordIdFromLocation(createResponse.location),
  )

  return {
    id: customerPaymentId,
    tranId: getNullableString(createdRecord?.tranId),
  }
}

async function postJournalEntry(client: NetSuiteClient, payload: Record<string, unknown>) {
  const createResponse = await client.createRecord('journalEntry', payload)
  const createdRecord = getNullableRecord(createResponse.json)
  const journalId = normalizeCreatedRecordId(
    getNullableString(createdRecord?.id) ?? parseRecordIdFromLocation(createResponse.location),
  )

  if (!journalId) {
    throw new Error('NetSuite creo el diario puente B1, pero no devolvio su id interno.')
  }

  const journalRecord = (await client.getRecord('journalEntry', journalId)).json as Record<string, unknown>
  return {
    id: journalId,
    tranId: getNullableString(journalRecord.tranId) ?? getNullableString(createdRecord?.tranId),
  }
}

async function getInvoicePaymentContext(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
) {
  const invoiceResponse = await client.getRecord('invoice', summary.internalId)
  const invoiceRecord = invoiceResponse.json as Record<string, unknown>
  const arAccountId = await resolveClientesAccountId(client)

  return {
    invoiceRecord,
    customer: getRequiredReferencePayload(
      invoiceRecord.entity,
      'cliente',
      summary.customerId,
      summary.customerName,
    ),
    currency: getRequiredReferencePayload(
      invoiceRecord.currency,
      'moneda',
      summary.currencyId,
      summary.currencyName,
    ),
    arAcct: getRequiredReferencePayload(
      invoiceRecord.account,
      'cuenta A/R',
      arAccountId,
      CLIENTES_ACCOUNT_DISPLAY_NAME,
    ),
    subsidiary: getOptionalReferencePayload(invoiceRecord.subsidiary),
    location: getOptionalReferencePayload(invoiceRecord.location),
    exchangeRate: getNullableNumber(invoiceRecord.exchangeRate),
  }
}

function buildCustomerPaymentBasePayload(
  context: Awaited<ReturnType<typeof getInvoicePaymentContext>>,
  memo: string,
  tranDate?: string | null,
) {
  const payload: Record<string, unknown> = {
    customer: context.customer,
    currency: context.currency,
    arAcct: context.arAcct,
    autoApply: false,
    memo,
  }

  if (context.subsidiary) {
    payload.subsidiary = context.subsidiary
  }

  if (context.location) {
    payload.location = context.location
  }

  if (context.exchangeRate !== null) {
    payload.exchangeRate = context.exchangeRate
  }

  const normalizedTranDate = normalizeOptionalString(tranDate)
  const netSuiteTranDate = toNetSuiteDateString(normalizedTranDate)
  if (netSuiteTranDate) {
    payload.tranDate = netSuiteTranDate
  }

  return payload
}

async function createB1BridgeJournal(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  amount: number,
  bridgeBankAccountId: string,
  bridgeBankAccountName: string,
  originalCredit: CreditoAplicableRow,
  bridgeRuleCode: 'B1' | 'B2' | 'B3' = 'B1',
) {
  const context = await getInvoicePaymentContext(client, summary)
  const payload: Record<string, unknown> = {
    memo: [
      `Auto ${bridgeRuleCode} diario puente`,
      summary.tranId ?? summary.internalId,
      originalCredit.tranId ?? originalCredit.transactionId,
    ]
      .filter(Boolean)
      .join(' | '),
    line: {
      items: [
        {
          account: context.arAcct,
          entity: context.customer,
          location: context.location,
          memo: `Auto ${bridgeRuleCode} clientes | ${summary.tranId ?? summary.internalId}`,
          debit: amount,
        },
        {
          account: { id: bridgeBankAccountId, refName: bridgeBankAccountName },
          entity: context.customer,
          location: context.location,
          memo: `Auto ${bridgeRuleCode} banco puente | ${summary.tranId ?? summary.internalId}`,
          credit: amount,
        },
      ],
    },
  }

  if (context.subsidiary) {
    payload.subsidiary = context.subsidiary
  }

  if (context.currency) {
    payload.currency = context.currency
  }

  if (context.exchangeRate !== null) {
    payload.exchangeRate = context.exchangeRate
  }

  const netSuiteTranDate = toNetSuiteDateString(summary.transactionDate)
  if (netSuiteTranDate) {
    payload.tranDate = netSuiteTranDate
  }

  return postJournalEntry(client, payload)
}

async function verifyB1BridgeJournal(
  client: NetSuiteClient,
  journalId: string,
  summary: FacturaOpenSummaryRow,
  expectedAmount: number,
  bridgeBankAccountId: string,
) {
  const journalResponse = await client.getRecord('journalEntry', journalId, {
    expandSubResources: true,
  })
  const journalRecord = journalResponse.json as Record<string, unknown>
  const lineCollection = getNullableRecord(journalRecord.line)
  const lineItems = Array.isArray(lineCollection?.items) ? lineCollection.items : []
  const clientesAccountId = await resolveClientesAccountId(client)
  const normalizedLines = lineItems
    .map((item) => getNullableRecord(item))
    .filter((line): line is Record<string, unknown> => line !== null)

  const clientesDebit = normalizedLines.find(
    (line) =>
      getReferenceId(line.account) === clientesAccountId &&
      (getNullableNumber(line.debit) ?? 0) > OPEN_AMOUNT_TOLERANCE &&
      (!summary.customerId || getReferenceId(line.entity) === summary.customerId),
  )
  const bridgeCredit = normalizedLines.find(
    (line) =>
      getReferenceId(line.account) === bridgeBankAccountId &&
      (getNullableNumber(line.credit) ?? 0) > OPEN_AMOUNT_TOLERANCE,
  )

  if (!amountsMatchExactly(getNullableNumber(clientesDebit?.debit), expectedAmount)) {
    throw new Error(
      `NetSuite no dejo el diario puente B1 ${journalId} con el debito correcto a Clientes nacionales.`,
    )
  }

  if (!amountsMatchExactly(getNullableNumber(bridgeCredit?.credit), expectedAmount)) {
    throw new Error(
      `NetSuite no dejo el diario puente B1 ${journalId} con el credito correcto al banco puente.`,
    )
  }
}

async function verifyB1JournalApplication(
  client: NetSuiteClient,
  bridgeJournalId: string,
  originalCreditTransactionId: string,
  expectedAmount: number,
) {
  const query = `
SELECT
  SUM(PreviousTransactionLineLink.foreignamount) AS appliedAmount
FROM PreviousTransactionLineLink
WHERE PreviousTransactionLineLink.previousdoc = ${formatSuiteQlLiteral(bridgeJournalId)}
  AND PreviousTransactionLineLink.nextdoc = ${formatSuiteQlLiteral(originalCreditTransactionId)}
  AND PreviousTransactionLineLink.linktype = 'Payment'
  `.trim()
  const rows = await fetchAllSuiteQlRows(client, query)
  const normalizedRow = Object.fromEntries(
    Object.entries(rows[0] ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  ) as Record<string, unknown>
  const appliedAmount = getNullableNumber(normalizedRow.appliedamount)

  if (!amountsMatchExactly(appliedAmount, expectedAmount)) {
    throw new Error(
      `NetSuite no dejo aplicado el diario puente ${bridgeJournalId} contra el credito ${originalCreditTransactionId} por el monto esperado B1.`,
    )
  }
}

async function verifyA1Application(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  candidate: FacturaAplicacionCandidata,
) {
  await verifyInvoiceRemainingAmount(
    client,
    summary,
    0,
    `la aplicacion A1 de la factura ${summary.tranId ?? summary.internalId}`,
  )
  await verifyCreditRemainingAmount(
    client,
    candidate,
    0,
    `la aplicacion A1 del credito ${candidate.documento ?? candidate.id}`,
  )
}

async function adjustJournalForA2(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  candidate: FacturaAplicacionCandidata,
  targetAmount: number,
  difference: number,
) {
  const roundingAccountId = await resolveRoundingAccountId(client)
  const clientesAccountId = await resolveClientesAccountId(client)
  const journalResponse = await client.getRecord('journalEntry', candidate.id, {
    expandSubResources: true,
  })
  const journalRecord = journalResponse.json as Record<string, unknown>
  const lineCollection = getNullableRecord(journalRecord.line)
  const lineItems = Array.isArray(lineCollection?.items) ? lineCollection.items : []

  const arLine = lineItems
    .map((item) => getNullableRecord(item))
    .find((line) => {
      if (!line) {
        return false
      }

      return (
        getReferenceId(line.account) === clientesAccountId &&
        (getNullableNumber(line.credit) ?? 0) > OPEN_AMOUNT_TOLERANCE
      )
    })

  if (!arLine) {
    throw new Error(
      `No se encontro la linea de credito en clientes nacionales para ajustar el diario ${candidate.documento ?? candidate.id}.`,
    )
  }

  const currentCredit = getNullableNumber(arLine.credit)
  if (!amountsMatchExactly(currentCredit, candidate.montoDisponible)) {
    throw new Error(
      `El diario ${candidate.documento ?? candidate.id} ya cambio y su credito disponible dejo de coincidir con el analisis A2.`,
    )
  }

  const patchPayload: Record<string, unknown> = {
    line: {
      items: [
        {
          line: getNullableNumber(arLine.line),
          account: getOptionalReferencePayload(arLine.account),
          entity: getOptionalReferencePayload(arLine.entity),
          location: getOptionalReferencePayload(arLine.location),
          memo: getNullableString(arLine.memo) ?? `Auto A2 ${summary.tranId ?? summary.internalId}`,
          credit: targetAmount,
        },
        {
          account: { id: roundingAccountId, refName: ROUNDING_ACCOUNT_DISPLAY_NAME },
          location: getOptionalReferencePayload(arLine.location),
          memo: `Auto A2 redondeo | ${summary.tranId ?? summary.internalId}`,
          credit: difference,
        },
      ],
    },
  }

  await client.patchRecord('journalEntry', candidate.id, patchPayload)

  const adjustedResponse = await client.getRecord('journalEntry', candidate.id, {
    expandSubResources: true,
  })
  const adjustedRecord = adjustedResponse.json as Record<string, unknown>
  const adjustedLineCollection = getNullableRecord(adjustedRecord.line)
  const adjustedLineItems = Array.isArray(adjustedLineCollection?.items) ? adjustedLineCollection.items : []
  const adjustedArLine = adjustedLineItems
    .map((item) => getNullableRecord(item))
    .find((line) => getReferenceId(line?.account) === clientesAccountId && (getNullableNumber(line?.credit) ?? 0) > OPEN_AMOUNT_TOLERANCE)
  const roundingLine = adjustedLineItems
    .map((item) => getNullableRecord(item))
    .find((line) => getReferenceId(line?.account) === roundingAccountId && (getNullableNumber(line?.credit) ?? 0) > OPEN_AMOUNT_TOLERANCE)

  if (!amountsMatchExactly(getNullableNumber(adjustedArLine?.credit), targetAmount)) {
    throw new Error(
      `NetSuite no dejo el diario ${candidate.documento ?? candidate.id} con el credito exacto de la factura para A2.`,
    )
  }

  if (!amountsMatchExactly(getNullableNumber(roundingLine?.credit), difference)) {
    throw new Error(
      `NetSuite no agrego correctamente la linea de redondeo al diario ${candidate.documento ?? candidate.id}.`,
    )
  }
}

async function verifyInvoiceRemainingAmount(
  client: NetSuiteClient,
  summary: FacturaOpenSummaryRow,
  expectedRemainingAmount: number,
  operationLabel: string,
) {
  const invoiceResponse = await client.getRecord('invoice', summary.internalId)
  const invoiceRecord = invoiceResponse.json as Record<string, unknown>
  const remainingAmount =
    getNullableNumber(invoiceRecord.amountRemaining) ??
    getNullableNumber(invoiceRecord.amountRemainingTotalBox) ??
    0

  if (Math.abs(remainingAmount - expectedRemainingAmount) > OPEN_AMOUNT_TOLERANCE) {
    throw new Error(
      `NetSuite completo ${operationLabel}, pero la factura ${summary.tranId ?? summary.internalId} quedo con saldo ${remainingAmount.toFixed(2)} en vez de ${expectedRemainingAmount.toFixed(2)}.`,
    )
  }
}

async function verifyCreditRemainingAmount(
  client: NetSuiteClient,
  candidate: FacturaAplicacionCandidata,
  expectedRemainingAmount: number,
  operationLabel: string,
) {
  const creditoActual = await fetchCreditoAplicableActual(client, candidate.id, candidate.clienteId)
  const montoDisponible = creditoActual?.availableAmount ?? 0

  if (Math.abs(montoDisponible - expectedRemainingAmount) > OPEN_AMOUNT_TOLERANCE) {
    throw new Error(
      `NetSuite completo ${operationLabel}, pero el credito ${candidate.documento ?? candidate.id} quedo con ${montoDisponible.toFixed(2)} disponible en vez de ${expectedRemainingAmount.toFixed(2)}.`,
    )
  }
}

async function fetchCreditoAplicableActual(
  client: NetSuiteClient,
  transactionId: string,
  customerId: string | null,
) {
  const accountId = await resolveClientesAccountId(client)
  const query = buildCreditoAplicableActualQuery(accountId, transactionId)
  const rows = (await fetchAllSuiteQlRows(client, query)).map(toCreditoAplicableRow)
  return rows.find((row) => !customerId || row.customerId === customerId) ?? rows[0] ?? null
}

function buildCreditoAplicableActualQuery(accountId: string, transactionId: string) {
  return `
SELECT
  transaction.id AS transactionId,
  transaction.tranid AS tranId,
  transaction.type AS transactionType,
  transaction.trandate AS transactionDate,
  transaction.postingperiod AS postingPeriodId,
  BUILTIN.DF(transaction.postingperiod) AS postingPeriodName,
  transaction.currency AS currencyId,
  BUILTIN.DF(transaction.currency) AS currencyName,
  line.entity AS customerId,
  BUILTIN.DF(line.entity) AS customerName,
  tal.credit AS creditAmount,
  COALESCE(applied.appliedAmount, 0) AS appliedAmount,
  (tal.credit - COALESCE(applied.appliedAmount, 0)) AS availableAmount
FROM transaction
INNER JOIN transactionaccountingline tal
  ON tal.transaction = transaction.id
  AND tal.posting = 'T'
INNER JOIN transactionline line
  ON line.transaction = tal.transaction
  AND line.id = tal.transactionline
LEFT JOIN (
  SELECT
    PreviousTransactionLineLink.nextdoc AS nextDoc,
    SUM(PreviousTransactionLineLink.foreignamount) AS appliedAmount
  FROM PreviousTransactionLineLink
  GROUP BY PreviousTransactionLineLink.nextdoc
) applied
  ON applied.nextDoc = transaction.id
WHERE tal.account = ${formatSuiteQlLiteral(accountId)}
  AND tal.credit > ${OPEN_AMOUNT_TOLERANCE}
  AND transaction.id = ${formatSuiteQlLiteral(transactionId)}
ORDER BY transaction.id ASC
  `.trim()
}

function parseRecordIdFromLocation(location: string | null) {
  if (!location) {
    return null
  }

  try {
    const url = new URL(location)
    const match = url.pathname.match(/\/([^/]+)\/?$/)
    return match?.[1] ?? null
  } catch {
    const match = location.match(/\/([^/?#]+)\/?$/)
    return match?.[1] ?? null
  }
}

function extractEmailAddress(value: string | null) {
  if (!value) {
    return null
  }

  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return match?.[0]?.trim() ?? null
}

function normalizeN1CreditMemoFolio(value: string | null) {
  if (!value) {
    return null
  }

  const normalizedValue = value.trim().replace(/^NC[\s-]*/i, '')
  return normalizedValue.length > 0 ? normalizedValue : null
}

function toFacturaAplicacionCandidata(
  summary: FacturaOpenSummaryRow,
  credito: CreditoAplicableRow,
): FacturaAplicacionCandidata {
  const samePeriod =
    matchesByIdentity(
      summary.postingPeriodId,
      credito.postingPeriodId,
      summary.postingPeriodName,
      credito.postingPeriodName,
    )
  const sameCurrency =
    matchesByIdentity(
      summary.currencyId,
      credito.currencyId,
      summary.currencyName,
      credito.currencyName,
    )
  const facturaEsPue = isFacturaPue(summary)
  const facturaEsPpd = isFacturaPpd(summary)
  const facturaEsMxn = isMxnCurrency(summary.currencyId, summary.currencyName)
  const cumplePpd1 =
    facturaEsPpd &&
    credito.transactionType === 'Journal' &&
    sameCurrency &&
    amountsMatchExactly(getFacturaTargetAmount(summary), credito.availableAmount) &&
    isDateInCurrentMonth(credito.transactionDate) &&
    isDateStrictlyEarlier(summary.transactionDate, credito.transactionDate)
  const cumpleA1 =
    facturaEsPue &&
    samePeriod &&
    sameCurrency &&
    amountsMatchExactly(getFacturaTargetAmount(summary), credito.availableAmount)
  const cumpleA2 =
    !cumpleA1 &&
    facturaEsPue &&
    facturaEsMxn &&
    samePeriod &&
    sameCurrency &&
    amountDifferenceQualifiesForA2(getFacturaTargetAmount(summary), credito.availableAmount)
  const cumpleA3 =
    !cumpleA1 &&
    !cumpleA2 &&
    facturaEsPue &&
    facturaEsMxn &&
    samePeriod &&
    sameCurrency &&
    amountDifferenceQualifiesForA3(getFacturaTargetAmount(summary), credito.availableAmount)

  return {
    id: credito.transactionId,
    documento: credito.tranId,
    tipoTransaccion: credito.transactionType,
    clienteId: credito.customerId,
    clienteNombre: credito.customerName,
    fecha: parseNetSuiteDate(credito.transactionDate),
    periodoContableId: credito.postingPeriodId,
    periodoContableNombre: credito.postingPeriodName,
    monedaId: credito.currencyId,
    moneda: credito.currencyName,
    montoCredito: credito.creditAmount,
    montoAplicado: credito.appliedAmount,
    montoDisponible: credito.availableAmount,
    cumplePpd1,
    cumpleA1,
    cumpleA2,
    cumpleA3,
  }
}

function compareFacturaSummaryRows(
  left: FacturaOpenSummaryRow,
  right: FacturaOpenSummaryRow,
  situacionesByInvoiceId: Map<string, FacturaSituacion>,
) {
  const leftQueueRank = getFacturaQueueRank(left, situacionesByInvoiceId.get(left.internalId)?.codigo)
  const rightQueueRank = getFacturaQueueRank(right, situacionesByInvoiceId.get(right.internalId)?.codigo)

  if (leftQueueRank !== rightQueueRank) {
    return leftQueueRank - rightQueueRank
  }

  const leftRank = getSituacionRank(situacionesByInvoiceId.get(left.internalId)?.codigo)
  const rightRank = getSituacionRank(situacionesByInvoiceId.get(right.internalId)?.codigo)

  if (leftRank !== rightRank) {
    return leftRank - rightRank
  }

  const leftDate = getComparableDateValue(left.transactionDate)
  const rightDate = getComparableDateValue(right.transactionDate)
  if (leftDate !== rightDate) {
    return rightDate - leftDate
  }

  const leftDocument = left.tranId ?? left.transactionNumber ?? left.internalId
  const rightDocument = right.tranId ?? right.transactionNumber ?? right.internalId
  return leftDocument.localeCompare(rightDocument, 'es')
}

function compareFacturaTableSummaryRows(
  left: FacturaOpenSummaryRow,
  right: FacturaOpenSummaryRow,
  situacionesByInvoiceId: Map<string, FacturaSituacion>,
) {
  const leftS1 = getFacturaTableS1SortKey(situacionesByInvoiceId.get(left.internalId)?.codigo)
  const rightS1 = getFacturaTableS1SortKey(situacionesByInvoiceId.get(right.internalId)?.codigo)
  const leftHasS1 = leftS1.length > 0
  const rightHasS1 = rightS1.length > 0

  if (leftHasS1 !== rightHasS1) {
    return leftHasS1 ? -1 : 1
  }

  const s1Compare = leftS1.localeCompare(rightS1, 'es', {
    numeric: true,
    sensitivity: 'base',
  })
  if (s1Compare !== 0) {
    return s1Compare
  }

  const leftS2Rank = getFacturaTableS2Rank(left)
  const rightS2Rank = getFacturaTableS2Rank(right)

  if (leftS2Rank !== rightS2Rank) {
    return leftS2Rank - rightS2Rank
  }

  const leftDate = getComparableDateValue(left.transactionDate)
  const rightDate = getComparableDateValue(right.transactionDate)
  if (leftDate !== rightDate) {
    return rightDate - leftDate
  }

  const leftDocument = left.tranId ?? left.transactionNumber ?? left.internalId
  const rightDocument = right.tranId ?? right.transactionNumber ?? right.internalId
  return leftDocument.localeCompare(rightDocument, 'es')
}

function compareFacturaAplicacionCandidatas(
  left: FacturaAplicacionCandidata,
  right: FacturaAplicacionCandidata,
) {
  const leftRank = left.cumplePpd1 ? 0 : left.cumpleA1 ? 1 : left.cumpleA2 ? 2 : left.cumpleA3 ? 3 : 4
  const rightRank = right.cumplePpd1 ? 0 : right.cumpleA1 ? 1 : right.cumpleA2 ? 2 : right.cumpleA3 ? 3 : 4

  if (leftRank !== rightRank) {
    return leftRank - rightRank
  }

  const leftDate = getComparableDateValue(left.fecha)
  const rightDate = getComparableDateValue(right.fecha)
  if (leftDate !== rightDate) {
    return leftDate - rightDate
  }

  return (left.documento ?? left.id).localeCompare(right.documento ?? right.id, 'es')
}

function getSituacionRank(codigo: string | null | undefined) {
  if (codigo === 'K') {
    return 0
  }

  if (codigo === 'PPD1') {
    return 1
  }

  if (codigo === 'A1') {
    return 2
  }

  if (codigo === 'A2') {
    return 3
  }

  if (codigo === 'A3') {
    return 4
  }

  if (codigo === 'A4') {
    return 5
  }

  if (codigo === 'A5') {
    return 6
  }

  if (codigo === 'A6') {
    return 7
  }

  if (codigo === 'A7') {
    return 8
  }

  if (codigo === 'A8') {
    return 9
  }

  if (codigo === 'B1') {
    return 10
  }

  if (codigo === 'B2') {
    return 11
  }

  if (codigo === 'B3') {
    return 12
  }

  if (codigo === 'N1') {
    return 13
  }

  return 13
}

function getFacturaTableS1SortKey(codigo: string | null | undefined) {
  return codigo?.trim() ?? ''
}

function getFacturaTableS2Rank(summary: FacturaOpenSummaryRow) {
  return getFacturaOverdueState(summary.dueDate, summary.transactionDate) === 'overdue' ? 0 : 1
}

function getFacturaQueueRank(summary: FacturaOpenSummaryRow, situacionCodigo: string | null | undefined) {
  if (situacionCodigo !== 'K' && situacionCodigo !== 'PPD1' && isDeferredCurrentPpdFactura(summary)) {
    return 2
  }

  const overdueState = getFacturaOverdueState(summary.dueDate, summary.transactionDate)

  if (overdueState === 'overdue') {
    return 0
  }

  return 1
}

function getFacturaOverdueState(dueDate: string | null, transactionDate: string | null) {
  const parsedDueDate = parseNetSuiteDate(dueDate) ?? parseNetSuiteDate(transactionDate)
  if (!parsedDueDate) {
    return 'overdue' as const
  }

  const todayDateValue = getCurrentDateOnlyValue()
  const dueDateValue = getDateOnlyValue(parsedDueDate)
  return dueDateValue < todayDateValue ? 'overdue' : 'current'
}

function countReconciliableFacturas(
  summaryRows: FacturaOpenSummaryRow[],
  situacionesByInvoiceId: Map<string, FacturaSituacion>,
) {
  return summaryRows.filter((summary) => {
    const situacionCodigo = situacionesByInvoiceId.get(summary.internalId)?.codigo
    return situacionCodigo === 'K' || situacionCodigo === 'PPD1' || !isDeferredCurrentPpdFactura(summary)
  }).length
}

function countDeferredCurrentPpdFacturas(
  summaryRows: FacturaOpenSummaryRow[],
  situacionesByInvoiceId: Map<string, FacturaSituacion>,
) {
  return summaryRows.filter((summary) => {
    const situacionCodigo = situacionesByInvoiceId.get(summary.internalId)?.codigo
    return situacionCodigo !== 'K' && situacionCodigo !== 'PPD1' && isDeferredCurrentPpdFactura(summary)
  }).length
}

function compareCreditoAplicableRows(left: CreditoAplicableRow, right: CreditoAplicableRow) {
  const leftDate = getComparableDateValue(left.transactionDate)
  const rightDate = getComparableDateValue(right.transactionDate)
  if (leftDate !== rightDate) {
    return leftDate - rightDate
  }

  return left.transactionId.localeCompare(right.transactionId, 'es')
}

function toClientesAccountRow(row: Record<string, unknown>): ClientesAccountRow {
  const normalizedRow = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]),
  ) as Record<string, unknown>

  return {
    internalId: getNullableString(normalizedRow.internalid),
    displayName: getNullableString(normalizedRow.displayname),
  }
}

function toLinkedCustomerPaymentRow(row: Record<string, unknown>): LinkedCustomerPaymentRow {
  const normalizedRow = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]),
  ) as Record<string, unknown>

  return {
    transactionId: String(normalizedRow.transactionid ?? ''),
    tranId: getNullableString(normalizedRow.tranid),
    transactionDate: getNullableString(normalizedRow.transactiondate),
    amount: getNullableNumber(normalizedRow.amount),
    accountId: getNullableString(normalizedRow.accountid),
    accountName: getNullableString(normalizedRow.accountname),
  }
}

function toA4SalesOrderRow(row: Record<string, unknown>): A4SalesOrderRow {
  const normalizedRow = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]),
  ) as Record<string, unknown>

  return {
    internalId: String(normalizedRow.internalid ?? ''),
    tranId: getNullableString(normalizedRow.tranid),
    customerId: getNullableString(normalizedRow.customerid),
    customerName: getNullableString(normalizedRow.customername),
    currencyId: getNullableString(normalizedRow.currencyid),
    currencyName: getNullableString(normalizedRow.currencyname),
    total: getNullableNumber(normalizedRow.total),
  }
}

function toSalesOrderInvoiceAuditRow(row: Record<string, unknown>): SalesOrderInvoiceAuditRow {
  const normalizedRow = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]),
  ) as Record<string, unknown>

  return {
    internalId: String(normalizedRow.internalid ?? ''),
    tranId: getNullableString(normalizedRow.tranid),
    transactionDate: getNullableString(normalizedRow.transactiondate),
    statusName: getNullableString(normalizedRow.statusname),
    total: getNullableNumber(normalizedRow.total),
    amountRemaining: getNullableNumber(normalizedRow.amountremaining),
  }
}

function toCreditoAplicableRow(row: Record<string, unknown>): CreditoAplicableRow {
  const normalizedRow = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]),
  ) as Record<string, unknown>

  return {
    transactionId: String(normalizedRow.transactionid ?? ''),
    tranId: getNullableString(normalizedRow.tranid),
    transactionType: getNullableString(normalizedRow.transactiontype),
    transactionDate: getNullableString(normalizedRow.transactiondate),
    postingPeriodId: getNullableString(normalizedRow.postingperiodid),
    postingPeriodName: getNullableString(normalizedRow.postingperiodname),
    currencyId: getNullableString(normalizedRow.currencyid),
    currencyName: getNullableString(normalizedRow.currencyname),
    customerId: getNullableString(normalizedRow.customerid),
    customerName: getNullableString(normalizedRow.customername),
    creditAmount: getNullableNumber(normalizedRow.creditamount),
    appliedAmount: getNullableNumber(normalizedRow.appliedamount),
    availableAmount: getNullableNumber(normalizedRow.availableamount),
  }
}

function extractCustomFields(raw: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(raw).filter(([key]) => key.startsWith('custbody_') || key.startsWith('custpage_')),
  )
}

function deriveEstado(saldoAbierto: number | null): FacturaEstado {
  if (saldoAbierto !== null && saldoAbierto > OPEN_AMOUNT_TOLERANCE) {
    return 'abierta'
  }

  return 'cerrada'
}

function deriveSituacionCobro(
  total: number | null,
  montoPagado: number | null,
  saldoAbierto: number | null,
  estado: FacturaEstado,
): FacturaSituacionCobro {
  if (estado === 'abierta') {
    if ((montoPagado ?? 0) > OPEN_AMOUNT_TOLERANCE) {
      return 'parcial'
    }

    return 'pendiente'
  }

  if (total !== null && montoPagado !== null && Math.abs(total - montoPagado) <= OPEN_AMOUNT_TOLERANCE) {
    return 'pagada'
  }

  return 'conciliada'
}

function deriveIva(impuestos: FacturaImpuesto[], impuestoTotal: number | null) {
  const impuestoPrincipal = impuestos.find((impuesto) => !impuesto.esRetencion)
  return impuestoPrincipal?.importe ?? impuestoTotal
}

function isFacturaPue(summary: FacturaOpenSummaryRow) {
  return (
    normalizeComparableText(summary.satPaymentTermName) === SAT_PAYMENT_TERM_PUE ||
    summary.satPaymentTermId === '3'
  )
}

function isFacturaPpd(summary: FacturaOpenSummaryRow) {
  return (
    normalizeComparableText(summary.satPaymentTermName) === SAT_PAYMENT_TERM_PPD ||
    summary.satPaymentTermId === '4'
  )
}

function isDeferredCurrentPpdFactura(summary: FacturaOpenSummaryRow) {
  return isFacturaPpd(summary) && getFacturaOverdueState(summary.dueDate, summary.transactionDate) === 'current'
}

function isMxnCurrency(currencyId: string | null, currencyName: string | null) {
  return currencyId === '1' || normalizeComparableText(currencyName) === MXN_CURRENCY_NAME
}

function getFacturaTargetAmount(summary: FacturaOpenSummaryRow) {
  return summary.total ?? summary.amountRemaining
}

function isCrossPeriodCreditEarlier(summary: FacturaOpenSummaryRow, credito: CreditoAplicableRow) {
  const invoiceDate = getComparableDateValue(summary.transactionDate)
  const creditDate = getComparableDateValue(credito.transactionDate)

  if (invoiceDate !== creditDate) {
    return creditDate < invoiceDate
  }

  return (credito.postingPeriodName ?? credito.postingPeriodId ?? '').localeCompare(
    summary.postingPeriodName ?? summary.postingPeriodId ?? '',
    'es',
  ) < 0
}

function amountsMatchExactly(left: number | null, right: number | null) {
  if (left === null || right === null) {
    return false
  }

  return Math.abs(left - right) <= OPEN_AMOUNT_TOLERANCE
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function amountMatchesA5SalesOrderTotal(
  creditAvailableAmount: number | null,
  salesOrderTotal: number | null,
  currencyId: string | null,
  currencyName: string | null,
) {
  if (creditAvailableAmount === null || salesOrderTotal === null) {
    return false
  }

  if (amountsMatchExactly(creditAvailableAmount, salesOrderTotal)) {
    return true
  }

  if (!isMxnCurrency(currencyId, currencyName)) {
    return false
  }

  return (
    Math.abs(creditAvailableAmount - salesOrderTotal) <=
    A5_SALES_ORDER_TOLERANCE_MXN + OPEN_AMOUNT_TOLERANCE
  )
}

function getAmountDifference(left: number | null, right: number | null) {
  if (left === null || right === null) {
    return null
  }

  return left - right
}

function amountDifferenceQualifiesForA2(left: number | null, right: number | null) {
  if (left === null || right === null) {
    return false
  }

  const difference = Math.abs(left - right)
  return difference > OPEN_AMOUNT_TOLERANCE && difference <= A2_MAX_DIFFERENCE_MXN + OPEN_AMOUNT_TOLERANCE
}

function amountDifferenceQualifiesForA3(left: number | null, right: number | null) {
  if (left === null || right === null) {
    return false
  }

  const difference = Math.abs(left - right)
  return (
    difference > A2_MAX_DIFFERENCE_MXN + OPEN_AMOUNT_TOLERANCE &&
    difference <= A3_MAX_DIFFERENCE_MXN + OPEN_AMOUNT_TOLERANCE
  )
}

function matchesByIdentity(
  leftId: string | null,
  rightId: string | null,
  leftName?: string | null,
  rightName?: string | null,
) {
  if (leftId && rightId) {
    return leftId === rightId
  }

  if (leftName && rightName) {
    return leftName === rightName
  }

  return false
}

function getComparableDateValue(value: string | Date | null) {
  if (!value) {
    return Number.MAX_SAFE_INTEGER
  }

  const parsed = value instanceof Date ? value : parseNetSuiteDate(value)
  return parsed ? parsed.getTime() : Number.MAX_SAFE_INTEGER
}

function getDateOnlyValue(value: Date) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
}

function getCurrentDateOnlyValue() {
  return getDateOnlyValue(new Date())
}

function isDateInCurrentMonth(value: string | Date | null | undefined) {
  const parsed = value instanceof Date ? value : parseNetSuiteDate(value)
  if (!parsed) {
    return false
  }

  const now = new Date()
  return (
    parsed.getUTCFullYear() === now.getUTCFullYear() &&
    parsed.getUTCMonth() === now.getUTCMonth()
  )
}

function isDateStrictlyEarlier(
  leftValue: string | Date | null | undefined,
  rightValue: string | Date | null | undefined,
) {
  const leftDate = leftValue instanceof Date ? leftValue : parseNetSuiteDate(leftValue)
  const rightDate = rightValue instanceof Date ? rightValue : parseNetSuiteDate(rightValue)
  if (!leftDate || !rightDate) {
    return false
  }

  return getDateOnlyValue(leftDate) < getDateOnlyValue(rightDate)
}

function normalizePageValue(rawValue: unknown, fallback: number, max: number) {
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.max(0, Math.min(max, Math.trunc(parsed)))
}

function getNullableRecord(value: unknown) {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return null
}

function getNullableString(value: unknown) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value)
  }

  return null
}

function getNullableNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string' && value.trim()) {
    const normalized = Number(value)
    return Number.isFinite(normalized) ? normalized : null
  }

  return null
}

function getNullableBoolean(value: unknown) {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    if (value === 'T' || value.toLowerCase() === 'true') {
      return true
    }
    if (value === 'F' || value.toLowerCase() === 'false') {
      return false
    }
  }

  return undefined
}

function normalizeOptionalString(value: unknown) {
  return getNullableString(value)
}

function getReferenceId(value: unknown) {
  const record = getNullableRecord(value)
  if (!record) {
    return getNullableString(value)
  }

  return getNullableString(record.id)
}

function getReferenceName(value: unknown) {
  const record = getNullableRecord(value)
  if (!record) {
    return getNullableString(value)
  }

  return getNullableString(record.refName) ?? getNullableString(record.name)
}

function getOptionalReferencePayload(value: unknown) {
  const id = getReferenceId(value)
  if (!id) {
    return null
  }

  const refName = getReferenceName(value)
  return refName ? { id, refName } : { id }
}

function getRequiredReferencePayload(
  value: unknown,
  fieldLabel: string,
  fallbackId?: string | null,
  fallbackName?: string | null,
) {
  const payload = getOptionalReferencePayload(value)
  if (payload) {
    return payload
  }

  const id = normalizeOptionalString(fallbackId)
  if (!id) {
    throw new Error(`La factura no trae ${fieldLabel} suficiente para crear el customer payment A1.`)
  }

  const refName = normalizeOptionalString(fallbackName)
  return refName ? { id, refName } : { id }
}

function normalizeCreatedRecordId(value: string | null) {
  if (!value || value === '0') {
    return null
  }

  return value
}

function parseNetSuiteDate(value: unknown) {
  const raw = getNullableString(value)
  if (!raw) {
    return null
  }

  const dotMatch = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (dotMatch) {
    const [, day, month, year] = dotMatch
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  }

  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function toNetSuiteDateString(value: string | null | undefined) {
  const parsed = parseNetSuiteDate(value)
  if (!parsed) {
    return null
  }

  const year = parsed.getUTCFullYear()
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0')
  const day = String(parsed.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toIsoDate(value: Date) {
  const year = value.getUTCFullYear()
  const month = String(value.getUTCMonth() + 1).padStart(2, '0')
  const day = String(value.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatSpanishMonthName(monthNumber: number) {
  return [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
  ][monthNumber - 1] ?? 'Mes'
}

function getCurrentN1FiscalSettings() {
  const now = new Date()
  return {
    year: now.getUTCFullYear(),
    monthNumber: now.getUTCMonth() + 1,
    monthName: formatSpanishMonthName(now.getUTCMonth() + 1),
    tranDate: toIsoDate(now),
  }
}

function normalizeComparableText(value: string | null | undefined) {
  if (!value) {
    return null
  }

  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

function sumNumbers(left: number | null, right: number | null) {
  return (left ?? 0) + (right ?? 0)
}

function uniqueValues(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
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

function formatSuiteQlTextLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function formatSuiteQlLiteral(value: string) {
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return value
  }

  return `'${value.replace(/'/g, "''")}'`
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
