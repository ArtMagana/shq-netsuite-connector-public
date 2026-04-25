import fs from 'node:fs'
import path from 'node:path'
import { NetSuiteClient } from './netsuiteClient.js'
import {
  listActiveEgresoConciliations,
  upsertEgresoConciliation,
} from './egresosConciliationStore.js'

type EgresoCode = 'E1' | 'E2' | 'E3' | 'E4' | 'E5' | 'E6' | 'E7'

type EgresoOperationalCode = 'E1C' | 'E1J' | 'E1M' | 'E1R' | 'E1X'

type EgresoTone = 'ready' | 'review' | 'period-review' | 'exception'

type EgresoConciliationLane = 'exact' | 'with-gap' | 'cross-period' | 'without-support'

type EgresoConciliationActionCode =
  | 'apply-credit'
  | 'resolve-gap'
  | 'review-prepayment'
  | 'trace-payment'
  | 'review-period'
  | 'escalate-treasury'
  | 'review-manual'

type EgresoSupportSource =
  | 'vendor-credit'
  | 'journal'
  | 'payment'
  | 'prepayment'
  | 'mixed'

type EgresoJournalExecutionMode =
  | 'payment-ready'
  | 'review-debit-only'
  | 'review-credit-mismatch'
  | 'unknown'

type SuiteQlCollectionResponse = {
  items?: Array<Record<string, unknown>>
  totalResults?: number
  hasMore?: boolean
  count?: number
}

type EgresoSupportCandidate = {
  internalId: string
  documentNumber: string | null
  transactionType: string
  supportSource: EgresoSupportSource
  journalExecutionMode: EgresoJournalExecutionMode | null
  journalExecutionReason: string | null
  matchedDocumentCount: number
  transactionDate: string | null
  postingPeriodName: string | null
  currency: string | null
  payableAccountId: string | null
  payableAccountNumber: string | null
  payableAccountName: string | null
  availableAmount: number | null
  sameAccount: boolean
  samePeriod: boolean
  sameCurrency: boolean
  exactAmountMatch: boolean
  amountDelta: number | null
  reason: string
}

type EgresoConciliation = {
  lane: EgresoConciliationLane
  laneLabel: string
  actionCode: EgresoConciliationActionCode
  actionLabel: string
  actionDetail: string
  hasSupport: boolean
  supportCount: number
  amountDelta: number | null
  exactAmountMatch: boolean
  sameAccount: boolean | null
  samePeriod: boolean | null
  sameCurrency: boolean | null
  supportSource: EgresoSupportSource | null
  matchedDocumentCount: number
}

type EgresoBillBase = {
  internalId: string
  documentNumber: string
  transactionNumber: string | null
  supplierId: string | null
  supplierName: string | null
  transactionDate: string | null
  dueDate: string | null
  postingPeriodName: string | null
  currency: string | null
  payableAccountId: string | null
  payableAccountNumber: string | null
  payableAccountName: string | null
  total: number | null
  openAmount: number | null
  availableCoverageAmount: number | null
  statusCode: EgresoCode
  statusLabel: string
  statusTone: EgresoTone
  statusReason: string
  operationalCode: EgresoOperationalCode | null
  operationalLabel: string | null
  operationalReason: string | null
  dueStatus: 'vigente' | 'vencida'
  memo: string | null
  creditCandidates: EgresoSupportCandidate[]
}

type EgresoBill = EgresoBillBase & {
  conciliation: EgresoConciliation
}

type EgresoOperationalStatus = {
  code: EgresoOperationalCode | null
  label: string | null
  reason: string | null
}

type EgresosBootstrapResponse = {
  readOnly: true
  generatedAtUtc: string
  dataSource: 'netsuite' | 'seed'
  sourceMessage: string
  highlightBillInternalId: string
  page: {
    limit: number
    offset: number
    count: number
    totalResults: number
    hasMore: boolean
  }
  summary: {
    openBills: number
    totalOpenAmount: number
    overdueBills: number
    overdueAmount: number
    coverageDetectedAmount: number
    exceptionCases: number
  }
  transactionTypes: Array<{
    code: EgresoCode
    title: string
    definition: string
    total: number
    sampleDocumentNumber: string | null
  }>
  bills: EgresoBill[]
}

type ApplyExactVendorCreditResult = {
  success: true
  dryRun: boolean
  appliedAtUtc: string
  bill: {
    internalId: string
    documentNumber: string
    supplierName: string | null
    openAmountBefore: number | null
    openAmountAfter: number
  }
  credit: {
    internalId: string
    documentNumber: string | null
    availableAmountBefore: number | null
    availableAmountAfter: number | null
  }
  appliedAmount: number
  message: string
}

type PrepareExactJournalResult = {
  success: true
  dryRun: true
  preparedAtUtc: string
  operationalCode: 'E1J' | 'E1R'
  nextStepLabel: string
  nextStepDetail: string
  bill: {
    internalId: string
    documentNumber: string
    supplierName: string | null
    openAmount: number | null
    currency: string | null
  }
  journal: {
    internalId: string
    documentNumber: string | null
    transactionDate: string | null
    memo: string | null
    matchedDebitLine: number
    amount: number | null
    payableAccountNumber: string | null
    payableAccountName: string | null
    locationName: string | null
  }
  existingLinks: {
    billPaymentLinks: number
    journalPaymentLinks: number
  }
  message: string
}

type ReconcileExactSupportResult = {
  success: true
  reconciledAtUtc: string
  bill: {
    internalId: string
    documentNumber: string
    supplierName: string | null
    totalAmount: number | null
    openAmount: number | null
    currency: string | null
  }
  support: {
    internalId: string
    documentNumber: string | null
    transactionType: string
    supportSource: EgresoSupportSource
    amount: number | null
  }
  operationalCode: EgresoOperationalCode | null
  message: string
}

type EgresosExactReadyOverviewResponse = {
  generatedAtUtc: string
  dataSource: 'netsuite' | 'seed'
  reviewedBills: number
  exactSupportCount: number
  exactReadyCount: number
  journalReadyCount: number
  firstExactSupportBillInternalId: string | null
  firstExactSupportBillDocumentNumber: string | null
  firstExactSupportOffset: number | null
  firstExactBillInternalId: string | null
  firstExactBillDocumentNumber: string | null
  firstExactOffset: number | null
  firstJournalReadyBillInternalId: string | null
  firstJournalReadyBillDocumentNumber: string | null
  firstJournalReadyOffset: number | null
}

type VendorBillLiveState = {
  internalId: string
  documentNumber: string | null
  statusName: string | null
  openAmount: number | null
}

type ClassifiedBillSnapshot = {
  bills: EgresoBill[]
  supports: VendorSupportLive[]
}

type LiveEgresosUniverseSnapshot = {
  generatedAtUtc: string
  sourceMessage: string
  bills: EgresoBill[]
}

type RevalidatedExactBillsResult = {
  bills: EgresoBill[]
  removedClosedCount: number
  rebalancedCount: number
}

type VendorBillSummaryRow = {
  internalId: string
  tranId: string | null
  transactionNumber: string | null
  transactionDate: string | null
  dueDate: string | null
  supplierId: string | null
  supplierName: string | null
  postingPeriodId: string | null
  postingPeriodName: string | null
  currencyId: string | null
  currencyName: string | null
  payableAccountId: string | null
  payableAccountNumber: string | null
  payableAccountName: string | null
  total: number | null
  openAmount: number | null
  memo: string | null
}

type VendorCreditSummaryRow = {
  internalId: string
  tranId: string | null
  transactionNumber: string | null
  transactionDate: string | null
  postingPeriodId: string | null
  postingPeriodName: string | null
  supplierId: string | null
  supplierName: string | null
  currencyId: string | null
  currencyName: string | null
  payableAccountId: string | null
  payableAccountNumber: string | null
  payableAccountName: string | null
  total: number | null
}

type VendorCreditLive = VendorCreditSummaryRow & {
  transactionType: 'Vendor Credit'
  supportKind: 'vendor-credit'
  availableAmount: number | null
}

type VendorJournalSupportRow = {
  internalId: string
  tranId: string | null
  transactionNumber: string | null
  transactionDate: string | null
  postingPeriodId: string | null
  postingPeriodName: string | null
  supplierId: string | null
  supplierName: string | null
  currencyId: string | null
  currencyName: string | null
  payableAccountId: string | null
  payableAccountNumber: string | null
  payableAccountName: string | null
  availableAmount: number | null
  journalExecutionMode: EgresoJournalExecutionMode
  journalExecutionReason: string
}

type VendorJournalSupportLive = VendorJournalSupportRow & {
  transactionType: 'Journal Entry'
  supportKind: 'journal'
}

type VendorSupportLive = VendorCreditLive | VendorJournalSupportLive

type JournalPayableLineProfileRow = {
  journalId: string
  supplierId: string | null
  payableAccountId: string | null
  debitAmount: number | null
  creditAmount: number | null
}

type JournalExecutionProfile = {
  mode: EgresoJournalExecutionMode
  reason: string
}

type SupportMatch = {
  supports: VendorSupportLive[]
  totalAmount: number
  samePeriod: boolean
  exactAmountMatch: boolean
}

type EgresoPageSnapshot = {
  rows: VendorBillSummaryRow[]
  totalResults: number
  count: number
  hasMore: boolean
}

const OPEN_AMOUNT_TOLERANCE = 0.005
const EGRESOS_VISIBLE_BILL_LIMIT = 60
const EGRESOS_DEFAULT_PAGE_LIMIT = 50
const EGRESOS_MAX_PAGE_LIMIT = 100
const SUITEQL_BATCH_LIMIT = 1000
const SUITEQL_IN_CHUNK_SIZE = 120
const CREDIT_FETCH_CONCURRENCY = 4
const SUPPORT_QUERY_CONCURRENCY = 2
const EGRESOS_READ_CACHE_TTL_MS = 60_000
const EGRESOS_EXACT_SUPPORT_BILLS_CACHE_PATH = path.join(
  process.cwd(),
  'storage',
  'egresos-exact-support-bills.json',
)
const EGRESOS_ALLOWED_AP_ACCOUNT_NUMBERS = [
  '201-01-00',
  '201-02-00',
  '201-02-01',
  '201-02-02',
  '201-03-00',
  '201-04-00',
]

const transactionTypeCatalog: Array<{
  code: EgresoCode
  title: string
  definition: string
}> = [
  {
    code: 'E1',
    title: 'Soporte exacto conciliable',
    definition:
      'Soporte exacto del mismo proveedor, cuenta AP, moneda y periodo contable; puede venir de vendor credit o journal.',
  },
  {
    code: 'E2',
    title: 'Cobertura disponible',
    definition:
      'Hay soporte util en el mismo periodo y misma cuenta, pero requiere ajuste, parcialidad o combinacion.',
  },
  {
    code: 'E3',
    title: 'Anticipo listo',
    definition: 'Reservado para la siguiente fase de prepayments y anticipos a proveedor.',
  },
  {
    code: 'E4',
    title: 'Pago detectado sin amarre',
    definition:
      'Reservado para separar mas adelante los casos de pago detectado cuando ya no compartan la misma vista analitica.',
  },
  {
    code: 'E5',
    title: 'Cobertura en otro periodo',
    definition: 'Existe soporte util, pero vive en un periodo contable distinto al de la factura.',
  },
  {
    code: 'E6',
    title: 'Vencida sin cobertura',
    definition: 'Factura vencida y sin soporte suficiente detectado en la lectura actual.',
  },
  {
    code: 'E7',
    title: 'Revision manual',
    definition: 'No hay soporte claro todavia o el match detectado requiere validacion manual.',
  },
]

const seededDefaultPayableAccount = {
  payableAccountId: '592',
  payableAccountNumber: '201-02-00',
  payableAccountName: '201-02-00 Proveedores : Proveedores nacionales',
  operationalCode: null,
  operationalLabel: null,
  operationalReason: null,
}

const seededBills: EgresoBillBase[] = [
  {
    ...seededDefaultPayableAccount,
    internalId: 'VBILL-10452',
    documentNumber: 'VB-10452',
    transactionNumber: '10452',
    supplierId: 'SUP-001',
    supplierName: 'Fletes del Norte',
    transactionDate: '2026-04-08',
    dueDate: '2026-04-30',
    postingPeriodName: 'Abr 2026',
    currency: 'MXN',
    total: 58000,
    openAmount: 58000,
    availableCoverageAmount: 58000,
    statusCode: 'E1',
    statusLabel: 'Credito exacto aplicable',
    statusTone: 'ready',
    statusReason:
      'Vendor credit exacto del mismo proveedor, misma moneda y mismo periodo contable.',
    dueStatus: 'vigente',
    memo: 'Caso semilla para aplicar vendor credit exacto contra vendor bill.',
    creditCandidates: [
      {
        ...seededDefaultPayableAccount,
        internalId: 'VCRED-7781',
        documentNumber: 'VC-7781',
        transactionType: 'Vendor Credit',
        supportSource: 'vendor-credit',
        journalExecutionMode: null,
        journalExecutionReason: null,
        matchedDocumentCount: 1,
        transactionDate: '2026-04-10',
        postingPeriodName: 'Abr 2026',
        currency: 'MXN',
        availableAmount: 58000,
        sameAccount: true,
        samePeriod: true,
        sameCurrency: true,
        exactAmountMatch: true,
        amountDelta: 0,
        reason: 'Cobertura exacta lista para aplicacion.',
      },
    ],
  },
  {
    ...seededDefaultPayableAccount,
    internalId: 'VBILL-11820',
    documentNumber: 'VB-11820',
    transactionNumber: '11820',
    supplierId: 'SUP-014',
    supplierName: 'Envases del Bajio',
    transactionDate: '2026-04-05',
    dueDate: '2026-04-27',
    postingPeriodName: 'Abr 2026',
    currency: 'MXN',
    total: 92000,
    openAmount: 92000,
    availableCoverageAmount: 40000,
    statusCode: 'E2',
    statusLabel: 'Cobertura disponible',
    statusTone: 'review',
    statusReason:
      'Existe vendor credit util, pero solo cubre una parte del saldo abierto actual.',
    dueStatus: 'vigente',
    memo: 'Se requiere decidir si se aplica parcial o si se espera un segundo soporte.',
    creditCandidates: [
      {
        ...seededDefaultPayableAccount,
        internalId: 'VCRED-7810',
        documentNumber: 'VC-7810',
        transactionType: 'Vendor Credit',
        supportSource: 'vendor-credit',
        journalExecutionMode: null,
        journalExecutionReason: null,
        matchedDocumentCount: 1,
        transactionDate: '2026-04-16',
        postingPeriodName: 'Abr 2026',
        currency: 'MXN',
        availableAmount: 40000,
        sameAccount: true,
        samePeriod: true,
        sameCurrency: true,
        exactAmountMatch: false,
        amountDelta: 52000,
        reason: 'Cubre parcialmente la factura y deja remanente pendiente.',
      },
    ],
  },
  {
    ...seededDefaultPayableAccount,
    internalId: 'VBILL-12011',
    documentNumber: 'VB-12011',
    transactionNumber: '12011',
    supplierId: 'SUP-021',
    supplierName: 'Proveedora Atlas',
    transactionDate: '2026-04-11',
    dueDate: '2026-05-02',
    postingPeriodName: 'Abr 2026',
    currency: 'MXN',
    total: 26500,
    openAmount: 26500,
    availableCoverageAmount: 26500,
    statusCode: 'E3',
    statusLabel: 'Anticipo listo para aplicar',
    statusTone: 'ready',
    statusReason:
      'El proveedor ya tiene un prepayment vivo que cubre por completo la salida actual.',
    dueStatus: 'vigente',
    memo: 'Caso candidato para amarrar anticipo contra vendor bill.',
    creditCandidates: [
      {
        ...seededDefaultPayableAccount,
        internalId: 'VPRE-22004',
        documentNumber: 'VP-22004',
        transactionType: 'Vendor Prepayment',
        supportSource: 'prepayment',
        journalExecutionMode: null,
        journalExecutionReason: null,
        matchedDocumentCount: 1,
        transactionDate: '2026-04-02',
        postingPeriodName: 'Abr 2026',
        currency: 'MXN',
        availableAmount: 26500,
        sameAccount: true,
        samePeriod: true,
        sameCurrency: true,
        exactAmountMatch: true,
        amountDelta: 0,
        reason: 'Anticipo previo pendiente de aplicacion.',
      },
    ],
  },
  {
    ...seededDefaultPayableAccount,
    internalId: 'VBILL-12590',
    documentNumber: 'VB-12590',
    transactionNumber: '12590',
    supplierId: 'SUP-031',
    supplierName: 'Servicios Delta',
    transactionDate: '2026-04-04',
    dueDate: '2026-04-24',
    postingPeriodName: 'Abr 2026',
    currency: 'MXN',
    total: 31000,
    openAmount: 31000,
    availableCoverageAmount: 31000,
    statusCode: 'E4',
    statusLabel: 'Pago detectado sin amarre',
    statusTone: 'review',
    statusReason:
      'Hay vendor payment emitido al mismo proveedor, pero todavia no queda relacionado de forma limpia.',
    dueStatus: 'vigente',
    memo: 'Revisar documentos de soporte y amarre contable antes de cerrar.',
    creditCandidates: [
      {
        ...seededDefaultPayableAccount,
        internalId: 'VPAY-22018',
        documentNumber: 'VP-22018',
        transactionType: 'Vendor Payment',
        supportSource: 'payment',
        journalExecutionMode: null,
        journalExecutionReason: null,
        matchedDocumentCount: 1,
        transactionDate: '2026-04-19',
        postingPeriodName: 'Abr 2026',
        currency: 'MXN',
        availableAmount: 31000,
        sameAccount: true,
        samePeriod: true,
        sameCurrency: true,
        exactAmountMatch: true,
        amountDelta: 0,
        reason: 'Pago emitido y pendiente de enlace correcto contra la factura.',
      },
    ],
  },
  {
    ...seededDefaultPayableAccount,
    internalId: 'VBILL-12744',
    documentNumber: 'VB-12744',
    transactionNumber: '12744',
    supplierId: 'SUP-044',
    supplierName: 'Materias Primas Uno',
    transactionDate: '2026-04-18',
    dueDate: '2026-05-09',
    postingPeriodName: 'Abr 2026',
    currency: 'MXN',
    total: 47000,
    openAmount: 47000,
    availableCoverageAmount: 47000,
    statusCode: 'E5',
    statusLabel: 'Cobertura en otro periodo',
    statusTone: 'period-review',
    statusReason:
      'El monto empata completo, pero el vendor credit disponible pertenece al periodo anterior.',
    dueStatus: 'vigente',
    memo: 'Caso tipico para revision contable antes de aplicar el soporte.',
    creditCandidates: [
      {
        ...seededDefaultPayableAccount,
        internalId: 'VCRED-7702',
        documentNumber: 'VC-7702',
        transactionType: 'Vendor Credit',
        supportSource: 'vendor-credit',
        journalExecutionMode: null,
        journalExecutionReason: null,
        matchedDocumentCount: 1,
        transactionDate: '2026-03-29',
        postingPeriodName: 'Mar 2026',
        currency: 'MXN',
        availableAmount: 47000,
        sameAccount: true,
        samePeriod: false,
        sameCurrency: true,
        exactAmountMatch: true,
        amountDelta: 0,
        reason: 'Credito exacto con cruce de periodo contable.',
      },
    ],
  },
  {
    ...seededDefaultPayableAccount,
    internalId: 'VBILL-12980',
    documentNumber: 'VB-12980',
    transactionNumber: '12980',
    supplierId: 'SUP-052',
    supplierName: 'Renta Industrial',
    transactionDate: '2026-03-15',
    dueDate: '2026-04-05',
    postingPeriodName: 'Mar 2026',
    currency: 'MXN',
    total: 73500,
    openAmount: 73500,
    availableCoverageAmount: 0,
    statusCode: 'E6',
    statusLabel: 'Vencida sin cobertura',
    statusTone: 'exception',
    statusReason:
      'La factura ya vencio y no tiene credito, pago ni anticipo util para sostener la salida.',
    dueStatus: 'vencida',
    memo: 'Caso prioritario para tesoreria y cuentas por pagar.',
    creditCandidates: [],
  },
  {
    ...seededDefaultPayableAccount,
    internalId: 'VBILL-13102',
    documentNumber: 'VB-13102',
    transactionNumber: '13102',
    supplierId: 'SUP-061',
    supplierName: 'Logistica Express',
    transactionDate: '2026-04-09',
    dueDate: '2026-04-29',
    postingPeriodName: 'Abr 2026',
    currency: 'MXN',
    total: 18450,
    openAmount: 18450,
    availableCoverageAmount: 0,
    statusCode: 'E7',
    statusLabel: 'Revision manual',
    statusTone: 'exception',
    statusReason:
      'Se detecto un posible match por monto, pero el soporte viene en otra moneda y con documento ambiguo.',
    dueStatus: 'vigente',
    memo: 'Requiere validacion manual antes de intentar cualquier aplicacion.',
    creditCandidates: [
      {
        ...seededDefaultPayableAccount,
        internalId: 'VCRED-7844',
        documentNumber: 'VC-7844',
        transactionType: 'Vendor Credit',
        supportSource: 'vendor-credit',
        journalExecutionMode: null,
        journalExecutionReason: null,
        matchedDocumentCount: 1,
        transactionDate: '2026-04-15',
        postingPeriodName: 'Abr 2026',
        currency: 'USD',
        availableAmount: 18450,
        sameAccount: true,
        samePeriod: true,
        sameCurrency: false,
        exactAmountMatch: true,
        amountDelta: 0,
        reason: 'Monto similar, pero el soporte se origino en USD y debe revisarse.',
      },
    ],
  },
]

const egresosReadCache = new Map<
  string,
  {
    createdAtMs: number
    response: EgresosBootstrapResponse
  }
>()

const egresosLiveUniverseCache = new Map<
  string,
  {
    createdAtMs: number
    snapshot: LiveEgresosUniverseSnapshot
  }
>()

const egresosExactSupportBillsCache = new Map<
  string,
  {
    createdAtMs: number
    bills: EgresoBill[]
  }
>()

const egresosExactReadyCache = new Map<
  string,
  {
    createdAtMs: number
    response: EgresosExactReadyOverviewResponse
  }
>()

export async function fetchEgresosBootstrap(options?: {
  client?: NetSuiteClient | null
  forceRefresh?: boolean
  limit?: unknown
  offset?: unknown
}): Promise<EgresosBootstrapResponse> {
  const limit = normalizePageValue(
    options?.limit,
    EGRESOS_DEFAULT_PAGE_LIMIT,
    EGRESOS_MAX_PAGE_LIMIT,
  )
  const offset = normalizePageValue(options?.offset, 0, Number.MAX_SAFE_INTEGER)
  const cacheKey = `${options?.client ? 'live' : 'seed'}:${limit}:${offset}`

  if (
    !options?.forceRefresh &&
    egresosReadCache.has(cacheKey) &&
    Date.now() - (egresosReadCache.get(cacheKey)?.createdAtMs ?? 0) < EGRESOS_READ_CACHE_TTL_MS
  ) {
    return egresosReadCache.get(cacheKey)?.response as EgresosBootstrapResponse
  }

  if (options?.client) {
    try {
      const liveResponse = await buildLiveEgresosBootstrap(
        options.client,
        limit,
        offset,
        Boolean(options.forceRefresh),
      )
      egresosReadCache.set(cacheKey, {
        createdAtMs: Date.now(),
        response: liveResponse,
      })
      return liveResponse
    } catch (error) {
      console.warn('Egresos: live bootstrap failed, falling back to seeded data.', error)
    }
  }

  const seededResponse = buildSeededEgresosBootstrap(limit, offset,
    options?.client
      ? 'Muestra semilla activa. La lectura live de cuentas por pagar no estuvo disponible en esta corrida.'
      : 'Muestra semilla activa. NetSuite no estuvo disponible para esta lectura de egresos.',
  )
  egresosReadCache.set(cacheKey, {
    createdAtMs: Date.now(),
    response: seededResponse,
  })
  return seededResponse
}

export function invalidateEgresosReadCache() {
  egresosReadCache.clear()
  egresosLiveUniverseCache.clear()
  egresosExactSupportBillsCache.clear()
  egresosExactReadyCache.clear()
  try {
    fs.unlinkSync(EGRESOS_EXACT_SUPPORT_BILLS_CACHE_PATH)
  } catch {
    // Ignore missing cache file.
  }
}

export async function fetchEgresosExactReadyOverview(options?: {
  client?: NetSuiteClient | null
  forceRefresh?: boolean
  pageSize?: unknown
}): Promise<EgresosExactReadyOverviewResponse> {
  const pageSize = normalizePageValue(
    options?.pageSize,
    EGRESOS_DEFAULT_PAGE_LIMIT,
    EGRESOS_MAX_PAGE_LIMIT,
  )
  const cacheKey = `${options?.client ? 'live' : 'seed'}:${pageSize}`

  if (
    !options?.forceRefresh &&
    egresosExactReadyCache.has(cacheKey) &&
    Date.now() - (egresosExactReadyCache.get(cacheKey)?.createdAtMs ?? 0) < EGRESOS_READ_CACHE_TTL_MS
  ) {
    return egresosExactReadyCache.get(cacheKey)?.response as EgresosExactReadyOverviewResponse
  }

  if (options?.client) {
    try {
      const response = await buildLiveEgresosExactReadyOverview(
        options.client,
        pageSize,
        Boolean(options.forceRefresh),
      )
      egresosExactReadyCache.set(cacheKey, {
        createdAtMs: Date.now(),
        response,
      })
      return response
    } catch (error) {
      console.warn('Egresos: exact-ready overview failed, falling back to seed.', error)
    }
  }

  const seededResponse = buildSeededEgresosExactReadyOverview(pageSize)
  egresosExactReadyCache.set(cacheKey, {
    createdAtMs: Date.now(),
    response: seededResponse,
  })
  return seededResponse
}

export async function applyExactVendorCredit(options: {
  client: NetSuiteClient
  billInternalId: string
  creditInternalId?: string | null
  dryRun?: boolean
}): Promise<ApplyExactVendorCreditResult> {
  const billInternalId = options.billInternalId.trim()
  if (!billInternalId) {
    throw new Error('La factura de egresos no tiene un id interno valido para aplicar el credito.')
  }

  const summary = await fetchOpenVendorBillSummaryRowById(options.client, billInternalId)
  if (!summary) {
    throw new Error(
      `La vendor bill ${billInternalId} ya no aparece abierta en NetSuite o no existe en esta lectura.`,
    )
  }

  const liveBillState = await fetchVendorBillLiveState(options.client, billInternalId)
  if ((liveBillState.openAmount ?? 0) <= OPEN_AMOUNT_TOLERANCE) {
    throw new Error(
      `La factura ${liveBillState.documentNumber ?? summary.transactionNumber ?? summary.internalId} ya no tiene saldo abierto real en NetSuite.`,
    )
  }
  const liveSummary = applyLiveBalanceToVendorBillSummary(summary, liveBillState)

  const supplierIds = uniqueValues([liveSummary.supplierId])
  if (supplierIds.length === 0) {
    throw new Error(
      `La factura ${liveSummary.transactionNumber ?? liveSummary.internalId} no tiene proveedor legible para buscar creditos.`,
    )
  }

  const credits = await fetchOpenVendorCredits(
    options.client,
    supplierIds,
    getCreditWindowStartDate([liveSummary]),
  )
  const bill = classifyVendorBill(liveSummary, credits)
  const targetCandidate =
    bill.creditCandidates.find(
      (candidate) =>
        candidate.internalId === normalizeOptionalString(options.creditInternalId),
    ) ??
    bill.creditCandidates[0] ??
    null

  if (!targetCandidate) {
    throw new Error(
      `La factura ${bill.documentNumber} no tiene un vendor credit candidato para conciliar en esta corrida.`,
    )
  }

  if (bill.conciliation.actionCode !== 'apply-credit') {
    throw new Error(
      `La factura ${bill.documentNumber} no esta lista para aplicacion exacta; NetSuite la clasifica como ${bill.statusCode}.`,
    )
  }

  if (!targetCandidate.exactAmountMatch || !targetCandidate.samePeriod || !targetCandidate.sameCurrency) {
    throw new Error(
      `El vendor credit ${targetCandidate.documentNumber ?? targetCandidate.internalId} ya no cumple las condiciones exactas para E1.`,
    )
  }

  const appliedAmount = liveBillState.openAmount ?? bill.openAmount ?? bill.total
  if (!appliedAmount || appliedAmount <= OPEN_AMOUNT_TOLERANCE) {
    throw new Error(
      `La factura ${bill.documentNumber} no tiene saldo abierto util para aplicar el credito exacto.`,
    )
  }

  const creditStateBefore = await fetchVendorCreditState(options.client, targetCandidate.internalId)
  const availableAmountBefore = creditStateBefore.availableAmount
  if (!amountsMatchExactly(availableAmountBefore, appliedAmount)) {
    throw new Error(
      `El vendor credit ${creditStateBefore.documentNumber ?? targetCandidate.internalId} ya no tiene saldo exacto contra la factura ${bill.documentNumber}.`,
    )
  }

  if (options.dryRun) {
    return {
      success: true,
      dryRun: true,
      appliedAtUtc: new Date().toISOString(),
      bill: {
        internalId: bill.internalId,
        documentNumber: bill.documentNumber,
        supplierName: bill.supplierName,
        openAmountBefore: bill.openAmount,
        openAmountAfter: 0,
      },
      credit: {
        internalId: targetCandidate.internalId,
        documentNumber: targetCandidate.documentNumber,
        availableAmountBefore,
        availableAmountAfter: 0,
      },
      appliedAmount,
      message: `Dry run E1 listo: ${targetCandidate.documentNumber ?? targetCandidate.internalId} puede aplicarse completo contra ${bill.documentNumber}.`,
    }
  }

  await applyVendorCreditToBill(
    options.client,
    targetCandidate.internalId,
    liveSummary,
    appliedAmount,
  )

  const refreshedBill = await fetchVendorBillLiveState(options.client, bill.internalId)
  const creditStateAfter = await fetchVendorCreditState(options.client, targetCandidate.internalId)
  const openAmountAfter = refreshedBill.openAmount ?? 0

  if (openAmountAfter > OPEN_AMOUNT_TOLERANCE) {
    throw new Error(
      `NetSuite aplico el credito, pero la factura ${bill.documentNumber} sigue abierta por ${openAmountAfter.toFixed(2)}.`,
    )
  }

  if ((creditStateAfter.availableAmount ?? 0) > OPEN_AMOUNT_TOLERANCE) {
    throw new Error(
      `NetSuite aplico el credito, pero ${creditStateAfter.documentNumber ?? targetCandidate.internalId} todavia conserva saldo por ${(creditStateAfter.availableAmount ?? 0).toFixed(2)}.`,
    )
  }

  invalidateEgresosReadCache()

  return {
    success: true,
    dryRun: false,
    appliedAtUtc: new Date().toISOString(),
    bill: {
      internalId: bill.internalId,
      documentNumber: bill.documentNumber,
      supplierName: bill.supplierName,
      openAmountBefore: bill.openAmount,
      openAmountAfter,
    },
    credit: {
      internalId: targetCandidate.internalId,
      documentNumber: targetCandidate.documentNumber,
      availableAmountBefore,
      availableAmountAfter: creditStateAfter.availableAmount,
    },
    appliedAmount,
    message: `Se aplico ${targetCandidate.documentNumber ?? targetCandidate.internalId} contra ${bill.documentNumber} y la conciliacion exacta quedo cerrada.`,
  }
}

export async function prepareExactJournal(options: {
  client: NetSuiteClient
  billInternalId: string
  journalInternalId?: string | null
}): Promise<PrepareExactJournalResult> {
  const billInternalId = options.billInternalId.trim()
  if (!billInternalId) {
    throw new Error('La factura de egresos no tiene un id interno valido para preparar E1J.')
  }

  const summary = await fetchOpenVendorBillSummaryRowById(options.client, billInternalId)
  if (!summary) {
    throw new Error(
      `La vendor bill ${billInternalId} ya no aparece abierta en NetSuite o no existe en esta lectura.`,
    )
  }

  const liveBillState = await fetchVendorBillLiveState(options.client, billInternalId)
  if ((liveBillState.openAmount ?? 0) <= OPEN_AMOUNT_TOLERANCE) {
    throw new Error(
      `La factura ${liveBillState.documentNumber ?? summary.transactionNumber ?? summary.internalId} ya no tiene saldo abierto real en NetSuite.`,
    )
  }
  const liveSummary = applyLiveBalanceToVendorBillSummary(summary, liveBillState)

  const supplierIds = uniqueValues([liveSummary.supplierId])
  if (supplierIds.length === 0) {
    throw new Error(
      `La factura ${liveSummary.transactionNumber ?? liveSummary.internalId} no tiene proveedor legible para preparar E1J.`,
    )
  }

  const journalSupports = await fetchOpenVendorJournalSupports(
    options.client,
    supplierIds,
    getCreditWindowStartDate([liveSummary]),
  )
  const bill = classifyVendorBill(liveSummary, journalSupports)
  const targetCandidate =
    bill.creditCandidates.find(
      (candidate) =>
        candidate.internalId === normalizeOptionalString(options.journalInternalId),
    ) ??
    bill.creditCandidates[0] ??
    null

  if (!targetCandidate) {
    throw new Error(
      `La factura ${bill.documentNumber} no tiene un journal exacto candidato para iniciar la conciliacion en esta corrida.`,
    )
  }

  if (bill.operationalCode !== 'E1J' && bill.operationalCode !== 'E1R') {
    throw new Error(
      `La factura ${bill.documentNumber} no esta lista para iniciar conciliacion exacta con journal; NetSuite hoy la clasifica como ${bill.operationalCode ?? bill.statusCode}.`,
    )
  }

  if (
    targetCandidate.supportSource !== 'journal' ||
    targetCandidate.matchedDocumentCount !== 1 ||
    !targetCandidate.exactAmountMatch ||
    !targetCandidate.sameAccount ||
    !targetCandidate.sameCurrency ||
    !targetCandidate.samePeriod
  ) {
    throw new Error(
      `El journal ${targetCandidate.documentNumber ?? targetCandidate.internalId} ya no cumple las condiciones exactas para iniciar la conciliacion.`,
    )
  }

  const journalState = await fetchJournalDebitSupportState(
    options.client,
    targetCandidate.internalId,
    liveSummary,
    targetCandidate.availableAmount ?? getBillConciliationTargetAmount(liveSummary),
  )
  const existingLinks = await fetchJournalPreparationLinks(
    options.client,
    bill.internalId,
    targetCandidate.internalId,
  )
  const journalOperable = targetCandidate.journalExecutionMode === 'payment-ready'
  const hasExistingLinks =
    existingLinks.billPaymentLinks > 0 || existingLinks.journalPaymentLinks > 0
  const operationalCode = bill.operationalCode === 'E1J' ? 'E1J' : 'E1R'
  const nextStepLabel = journalOperable ? 'Preparar cierre operativo' : 'Revisar journal exacto'
  const nextStepDetail = journalOperable
    ? 'El journal exacto ya expone perfil operativo apto; el siguiente paso es preparar el cierre desde vendor payment con validacion final.'
    : targetCandidate.journalExecutionReason ??
      'El journal exacto cuadra para conciliacion, pero primero hay que revisar su lado AP antes de automatizar el cierre.'

  return {
    success: true,
    dryRun: true,
    preparedAtUtc: new Date().toISOString(),
    operationalCode,
    nextStepLabel,
    nextStepDetail,
    bill: {
      internalId: bill.internalId,
      documentNumber: bill.documentNumber,
      supplierName: bill.supplierName,
      openAmount: bill.openAmount,
      currency: bill.currency,
    },
    journal: {
      internalId: journalState.internalId,
      documentNumber: journalState.documentNumber,
      transactionDate: journalState.transactionDate,
      memo: journalState.memo,
      matchedDebitLine: journalState.matchedDebitLine,
      amount: journalState.amount,
      payableAccountNumber: journalState.payableAccountNumber,
      payableAccountName: journalState.payableAccountName,
      locationName: journalState.locationName,
    },
    existingLinks,
    message: hasExistingLinks
      ? `Conciliacion iniciada para ${bill.documentNumber}: ${journalState.documentNumber ?? journalState.internalId} ya muestra rastros de vendor payment (${existingLinks.billPaymentLinks} por factura, ${existingLinks.journalPaymentLinks} por journal); conviene revisarlo manualmente antes de automatizar.`
      : journalOperable
        ? `Conciliacion iniciada para ${bill.documentNumber}: ${journalState.documentNumber ?? journalState.internalId} ya expone un perfil operativo util y puede avanzar al cierre desde vendor payment, todavia sin mover NetSuite.`
        : `Conciliacion iniciada para ${bill.documentNumber}: ${journalState.documentNumber ?? journalState.internalId} trae la linea AP deudora ${journalState.matchedDebitLine} por ${formatMoneyValue(journalState.amount)} y queda en revision guiada antes de automatizar.`,
  }
}

export async function reconcileExactSupport(options: {
  client: NetSuiteClient
  billInternalId: string
  supportInternalId?: string | null
}): Promise<ReconcileExactSupportResult> {
  const billInternalId = normalizeOptionalString(options.billInternalId)
  if (!billInternalId) {
    throw new Error('La factura de egresos no tiene un id interno valido para conciliar.')
  }

  const summary = await fetchOpenVendorBillSummaryRowById(options.client, billInternalId)
  if (!summary) {
    throw new Error(
      `La vendor bill ${billInternalId} ya no aparece abierta en NetSuite o no existe en esta lectura.`,
    )
  }

  const liveBillState = await fetchVendorBillLiveState(options.client, billInternalId)
  if ((liveBillState.openAmount ?? 0) <= OPEN_AMOUNT_TOLERANCE) {
    throw new Error(
      `La factura ${liveBillState.documentNumber ?? summary.transactionNumber ?? summary.internalId} ya no tiene saldo abierto real en NetSuite.`,
    )
  }
  const liveSummary = applyLiveBalanceToVendorBillSummary(summary, liveBillState)

  const supplierIds = uniqueValues([liveSummary.supplierId])
  if (supplierIds.length === 0) {
    throw new Error(
      `La factura ${liveSummary.transactionNumber ?? liveSummary.internalId} no tiene proveedor legible para conciliar.`,
    )
  }

  const [credits, journalSupports] = await Promise.all([
    fetchOpenVendorCredits(
      options.client,
      supplierIds,
      getCreditWindowStartDate([liveSummary]),
    ),
    fetchOpenVendorJournalSupports(
      options.client,
      supplierIds,
      getCreditWindowStartDate([liveSummary]),
    ),
  ])

  const bill = classifyVendorBill(liveSummary, [...credits, ...journalSupports])
  const targetCandidate =
    bill.creditCandidates.find(
      (candidate) =>
        candidate.internalId === normalizeOptionalString(options.supportInternalId),
    ) ??
    bill.creditCandidates[0] ??
    null

  if (!targetCandidate) {
    throw new Error(
      `La factura ${bill.documentNumber} ya no tiene soporte exacto disponible para conciliar en esta corrida.`,
    )
  }

  if (bill.statusCode !== 'E1') {
    throw new Error(
      `La factura ${bill.documentNumber} ya no califica como caso exacto; NetSuite hoy la clasifica como ${bill.statusCode}.`,
    )
  }

  if (
    targetCandidate.matchedDocumentCount !== 1 ||
    !targetCandidate.exactAmountMatch ||
    !targetCandidate.sameAccount ||
    !targetCandidate.sameCurrency ||
    !targetCandidate.samePeriod
  ) {
    throw new Error(
      `El soporte ${targetCandidate.documentNumber ?? targetCandidate.internalId} ya no cumple las condiciones exactas para conciliar esta factura.`,
    )
  }

  const stored = upsertEgresoConciliation({
    billInternalId: bill.internalId,
    billDocumentNumber: bill.documentNumber,
    supplierId: bill.supplierId,
    supplierName: bill.supplierName,
    supportInternalId: targetCandidate.internalId,
    supportDocumentNumber: targetCandidate.documentNumber,
    supportSource: targetCandidate.supportSource,
    supportAmount: targetCandidate.availableAmount,
    billTargetAmount: getBillConciliationTargetAmount(bill),
    billOpenAmount: bill.openAmount,
    currency: bill.currency,
    payableAccountNumber: bill.payableAccountNumber,
    postingPeriodName: bill.postingPeriodName,
    statusCode: bill.statusCode,
    operationalCode: bill.operationalCode,
  })

  return {
    success: true,
    reconciledAtUtc: stored.updatedAtUtc,
    bill: {
      internalId: bill.internalId,
      documentNumber: bill.documentNumber,
      supplierName: bill.supplierName,
      totalAmount: bill.total,
      openAmount: bill.openAmount,
      currency: bill.currency,
    },
    support: {
      internalId: targetCandidate.internalId,
      documentNumber: targetCandidate.documentNumber,
      transactionType: targetCandidate.transactionType,
      supportSource: targetCandidate.supportSource,
      amount: targetCandidate.availableAmount,
    },
    operationalCode: bill.operationalCode,
    message:
      targetCandidate.supportSource === 'journal'
        ? `Conciliacion registrada para ${bill.documentNumber} contra ${targetCandidate.documentNumber ?? targetCandidate.internalId}. El caso sale de la cola activa y queda guardado como journal exacto conciliado.`
        : `Conciliacion registrada para ${bill.documentNumber} contra ${targetCandidate.documentNumber ?? targetCandidate.internalId}. El caso sale de la cola activa y queda guardado como soporte exacto conciliado.`,
  }
}

async function getLiveEgresosUniverseSnapshot(
  client: NetSuiteClient,
  forceRefresh = false,
): Promise<LiveEgresosUniverseSnapshot> {
  const cacheKey = 'live'
  if (
    !forceRefresh &&
    egresosLiveUniverseCache.has(cacheKey) &&
    Date.now() - (egresosLiveUniverseCache.get(cacheKey)?.createdAtMs ?? 0) <
      EGRESOS_READ_CACHE_TTL_MS
  ) {
    return egresosLiveUniverseCache.get(cacheKey)?.snapshot as LiveEgresosUniverseSnapshot
  }

  const snapshot = await buildLiveEgresosUniverseSnapshot(client)
  egresosLiveUniverseCache.set(cacheKey, {
    createdAtMs: Date.now(),
    snapshot,
  })
  return snapshot
}

async function buildLiveEgresosUniverseSnapshot(
  client: NetSuiteClient,
): Promise<LiveEgresosUniverseSnapshot> {
  const billRows = await fetchAllOpenVendorBillSummaryRows(client)
  const supplierIds = uniqueValues(billRows.map((row) => row.supplierId))
  const creditWindowStartDate = getCreditWindowStartDate(billRows)

  let credits: VendorCreditLive[] = []
  let journalSupports: VendorJournalSupportLive[] = []
  let sourceMessage =
    billRows.length > 0
      ? `Mostrando ${billRows.length} vendor bills abiertas desde NetSuite.`
      : 'NetSuite no devolvio vendor bills abiertas para esta lectura.'

  if (supplierIds.length > 0) {
    try {
      ;[credits, journalSupports] = await Promise.all([
        fetchOpenVendorCredits(client, supplierIds, creditWindowStartDate),
        fetchOpenVendorJournalSupports(client, supplierIds, creditWindowStartDate, {
          includeExecutionProfiles: false,
        }),
      ])
      sourceMessage =
        billRows.length > 0
          ? `Mostrando ${billRows.length} vendor bills abiertas, ${credits.length} vendor credits y ${journalSupports.length} diarios AP candidatos en el universo completo.`
          : `NetSuite no devolvio vendor bills abiertas; aun asi se encontraron ${credits.length} vendor credits y ${journalSupports.length} diarios AP candidatos.`
    } catch (error) {
      console.warn('Egresos: unable to load live support candidates.', error)
      sourceMessage =
        billRows.length > 0
          ? `Mostrando ${billRows.length} vendor bills abiertas. La lectura de soportes AP no estuvo disponible en esta corrida.`
          : 'NetSuite respondio sin vendor bills abiertas y la lectura de soportes AP fallo en esta corrida.'
    }
  }

  const classifiedSnapshot = await classifyBillsWithHydratedExactJournalProfiles(
    client,
    billRows,
    credits,
    journalSupports,
  )
  const revalidatedSnapshot = await revalidateExactBillsAgainstLiveBalance(
    client,
    billRows,
    classifiedSnapshot.bills,
    classifiedSnapshot.supports,
  )
  const storedConciliationSnapshot = filterStoredReconciledBills(revalidatedSnapshot.bills)
  const bills = sortBillsForQueue(storedConciliationSnapshot.bills)

  if (revalidatedSnapshot.removedClosedCount > 0 || revalidatedSnapshot.rebalancedCount > 0) {
    const liveNotes: string[] = []
    if (revalidatedSnapshot.removedClosedCount > 0) {
      liveNotes.push(
        `${revalidatedSnapshot.removedClosedCount} caso(s) exacto(s) ya no seguian abiertos al validar contra el balance real del vendor bill`,
      )
    }
    if (revalidatedSnapshot.rebalancedCount > 0) {
      liveNotes.push(
        `${revalidatedSnapshot.rebalancedCount} caso(s) exacto(s) se revaluaron con el balance live del vendor bill`,
      )
    }
    sourceMessage = `${sourceMessage} Se depuraron ${liveNotes.join(' y ')}.`
  }
  if (storedConciliationSnapshot.hiddenCount > 0) {
    sourceMessage = `${sourceMessage} Se ocultaron ${storedConciliationSnapshot.hiddenCount} caso(s) ya conciliado(s) en esta cola.`
  }

  return {
    generatedAtUtc: new Date().toISOString(),
    sourceMessage,
    bills,
  }
}

async function buildLiveEgresosBootstrap(
  client: NetSuiteClient,
  limit: number,
  offset: number,
  _forceRefresh = false,
): Promise<EgresosBootstrapResponse> {
  const billPage = await fetchOpenVendorBillSummaryRows(client, limit, offset)
  const supplierIds = uniqueValues(billPage.rows.map((row) => row.supplierId))
  const creditWindowStartDate = getCreditWindowStartDate(billPage.rows)

  let credits: VendorCreditLive[] = []
  let journalSupports: VendorJournalSupportLive[] = []
  let sourceMessage =
    billPage.count > 0
      ? `Mostrando ${billPage.count} de ${billPage.totalResults} vendor bills abiertas desde NetSuite.`
      : 'NetSuite no devolvio vendor bills abiertas para esta lectura.'

  if (supplierIds.length > 0) {
    try {
      ;[credits, journalSupports] = await Promise.all([
        fetchOpenVendorCredits(client, supplierIds, creditWindowStartDate),
        fetchOpenVendorJournalSupports(
          client,
          supplierIds,
          creditWindowStartDate,
          {
            includeExecutionProfiles: false,
          },
        ),
      ])
      sourceMessage =
        billPage.count > 0
          ? `Mostrando ${billPage.count} de ${billPage.totalResults} vendor bills abiertas, ${credits.length} vendor credits y ${journalSupports.length} diarios AP candidatos para esta pagina.`
          : `NetSuite no devolvio vendor bills abiertas; aun asi se encontraron ${credits.length} vendor credits y ${journalSupports.length} diarios AP candidatos.`
    } catch (error) {
      console.warn('Egresos: unable to load live support candidates.', error)
      sourceMessage =
        billPage.count > 0
          ? `Mostrando ${billPage.count} de ${billPage.totalResults} vendor bills abiertas. La lectura de soportes AP no estuvo disponible en esta corrida.`
          : 'NetSuite respondio sin vendor bills abiertas y la lectura de soportes AP fallo en esta corrida.'
    }
  }

  const classifiedSnapshot = await classifyBillsWithHydratedExactJournalProfiles(
    client,
    billPage.rows,
    credits,
    journalSupports,
  )
  const revalidatedSnapshot = await revalidateExactBillsAgainstLiveBalance(
    client,
    billPage.rows,
    classifiedSnapshot.bills,
    classifiedSnapshot.supports,
  )
  const storedConciliationSnapshot = filterStoredReconciledBills(revalidatedSnapshot.bills)
  const exactSupportBills =
    offset === 0
      ? (() => {
          const cached = egresosExactSupportBillsCache.get('live')
          if (!cached) {
            return readPersistedExactSupportBills()
          }
          if (Date.now() - cached.createdAtMs >= EGRESOS_READ_CACHE_TTL_MS) {
            egresosExactSupportBillsCache.delete('live')
            return readPersistedExactSupportBills()
          }
          return cached.bills
        })()
      : []
  let bills = storedConciliationSnapshot.bills
  if (offset === 0 && exactSupportBills.length > 0) {
    const merged = [...exactSupportBills, ...bills]
    const seen = new Set<string>()
    const uniqueBills: EgresoBill[] = []
    for (const bill of merged) {
      if (seen.has(bill.internalId)) {
        continue
      }
      seen.add(bill.internalId)
      uniqueBills.push(bill)
      if (uniqueBills.length >= limit) {
        break
      }
    }
    bills = uniqueBills
  }
  bills = sortBillsForQueue(bills)
  const overdueBills = bills.filter((bill) => bill.dueStatus === 'vencida')
  const highlightBill = selectHighlightBill(bills)

  if (revalidatedSnapshot.removedClosedCount > 0 || revalidatedSnapshot.rebalancedCount > 0) {
    const liveNotes: string[] = []
    if (revalidatedSnapshot.removedClosedCount > 0) {
      liveNotes.push(
        `${revalidatedSnapshot.removedClosedCount} caso(s) exacto(s) ya no seguian abiertos al validar contra el balance real del vendor bill`,
      )
    }
    if (revalidatedSnapshot.rebalancedCount > 0) {
      liveNotes.push(
        `${revalidatedSnapshot.rebalancedCount} caso(s) exacto(s) se revaluaron con el balance live del vendor bill`,
      )
    }
    sourceMessage = `${sourceMessage} Se depuraron ${liveNotes.join(' y ')}.`
  }
  if (storedConciliationSnapshot.hiddenCount > 0) {
    sourceMessage = `${sourceMessage} Se ocultaron ${storedConciliationSnapshot.hiddenCount} caso(s) ya conciliado(s) en esta cola.`
  }
  if (offset === 0 && exactSupportBills.length > 0) {
    sourceMessage = `${sourceMessage} Se priorizaron ${exactSupportBills.length} caso(s) exacto(s) global(es) al inicio de la cola.`
  }

  return {
    readOnly: true,
    generatedAtUtc: new Date().toISOString(),
    dataSource: 'netsuite',
    sourceMessage,
    highlightBillInternalId: highlightBill?.internalId ?? '',
    page: {
      limit,
      offset,
      count: bills.length,
      totalResults: billPage.totalResults,
      hasMore: billPage.hasMore,
    },
    summary: {
      openBills: billPage.totalResults,
      totalOpenAmount: sumAmount(bills.map((bill) => bill.openAmount)),
      overdueBills: overdueBills.length,
      overdueAmount: sumAmount(overdueBills.map((bill) => bill.openAmount)),
      coverageDetectedAmount: sumAmount(
        [...credits, ...journalSupports].map((support) => support.availableAmount),
      ),
      exceptionCases: bills.filter((bill) => bill.statusTone === 'exception').length,
    },
    transactionTypes: buildTransactionTypeSummary(bills),
    bills,
  }
}

async function buildLiveEgresosExactReadyOverview(
  client: NetSuiteClient,
  pageSize: number,
  _forceRefresh = false,
): Promise<EgresosExactReadyOverviewResponse> {
  const billRows = await fetchAllOpenVendorBillSummaryRows(client)
  const supplierIds = uniqueValues(billRows.map((row) => row.supplierId))
  const creditWindowStartDate = getCreditWindowStartDate(billRows)
  const [credits, journalSupports] =
    supplierIds.length > 0
      ? await Promise.all([
          fetchOpenVendorCredits(client, supplierIds, creditWindowStartDate),
          fetchOpenVendorJournalSupports(
            client,
            supplierIds,
            creditWindowStartDate,
            {
              includeExecutionProfiles: false,
            },
          ),
        ])
      : [[], []]
  const classifiedSnapshot = await classifyBillsWithHydratedExactJournalProfiles(
    client,
    billRows,
    credits,
    journalSupports,
  )
  const revalidatedSnapshot = await revalidateExactBillsAgainstLiveBalance(
    client,
    billRows,
    classifiedSnapshot.bills,
    classifiedSnapshot.supports,
  )
  const bills = sortBillsForQueue(filterStoredReconciledBills(revalidatedSnapshot.bills).bills)
  const exactSupportBills = bills.filter(
    (bill) =>
      bill.conciliation.exactAmountMatch &&
      bill.conciliation.sameAccount === true &&
      bill.conciliation.samePeriod === true &&
      bill.conciliation.sameCurrency === true,
  )
  const exactBills = bills.filter((bill) => bill.conciliation.actionCode === 'apply-credit')
  const journalReadyBills = bills.filter((bill) => bill.operationalCode === 'E1J')
  const firstExactSupportBill = exactSupportBills[0] ?? null
  const firstExactSupportIndex = firstExactSupportBill
    ? bills.findIndex((bill) => bill.internalId === firstExactSupportBill.internalId)
    : -1
  const firstExactBill = exactBills[0] ?? null
  const firstExactIndex = firstExactBill
    ? bills.findIndex((bill) => bill.internalId === firstExactBill.internalId)
    : -1
  const firstJournalReadyBill = journalReadyBills[0] ?? null
  const firstJournalReadyIndex = firstJournalReadyBill
    ? bills.findIndex((bill) => bill.internalId === firstJournalReadyBill.internalId)
    : -1

  egresosExactSupportBillsCache.set('live', {
    createdAtMs: Date.now(),
    bills: exactSupportBills,
  })
  persistExactSupportBills(exactSupportBills)

  return {
    generatedAtUtc: new Date().toISOString(),
    dataSource: 'netsuite',
    reviewedBills: bills.length,
    exactSupportCount: exactSupportBills.length,
    exactReadyCount: exactBills.length,
    journalReadyCount: journalReadyBills.length,
    firstExactSupportBillInternalId: firstExactSupportBill?.internalId ?? null,
    firstExactSupportBillDocumentNumber: firstExactSupportBill?.documentNumber ?? null,
    firstExactSupportOffset:
      firstExactSupportIndex >= 0 ? Math.floor(firstExactSupportIndex / pageSize) * pageSize : null,
    firstExactBillInternalId: firstExactBill?.internalId ?? null,
    firstExactBillDocumentNumber: firstExactBill?.documentNumber ?? null,
    firstExactOffset:
      firstExactIndex >= 0 ? Math.floor(firstExactIndex / pageSize) * pageSize : null,
    firstJournalReadyBillInternalId: firstJournalReadyBill?.internalId ?? null,
    firstJournalReadyBillDocumentNumber: firstJournalReadyBill?.documentNumber ?? null,
    firstJournalReadyOffset:
      firstJournalReadyIndex >= 0 ? Math.floor(firstJournalReadyIndex / pageSize) * pageSize : null,
  }
}

function buildSeededEgresosBootstrap(
  limit: number,
  offset: number,
  sourceMessage: string,
): EgresosBootstrapResponse {
  const allBills = seededBills.map((bill) =>
    finalizeEgresoBill({
      ...bill,
      dueStatus: isOverdue(bill.dueDate) ? 'vencida' : bill.dueStatus,
    }),
  )
  const bills = allBills.slice(offset, offset + limit)
  const overdueBills = bills.filter((bill) => bill.dueStatus === 'vencida')

  return {
    readOnly: true,
    generatedAtUtc: new Date().toISOString(),
    dataSource: 'seed',
    sourceMessage,
    highlightBillInternalId: bills[0]?.internalId ?? '',
    page: {
      limit,
      offset,
      count: bills.length,
      totalResults: allBills.length,
      hasMore: offset + bills.length < allBills.length,
    },
    summary: {
      openBills: allBills.length,
      totalOpenAmount: sumAmount(bills.map((bill) => bill.openAmount)),
      overdueBills: overdueBills.length,
      overdueAmount: sumAmount(overdueBills.map((bill) => bill.openAmount)),
      coverageDetectedAmount: sumAmount(
        uniqueValues(
          bills.flatMap((bill) => bill.creditCandidates.map((candidate) => candidate.internalId)),
        ).map((candidateId) =>
          bills
            .flatMap((bill) => bill.creditCandidates)
            .find((candidate) => candidate.internalId === candidateId)?.availableAmount ?? 0,
        ),
      ),
      exceptionCases: bills.filter((bill) => bill.statusTone === 'exception').length,
    },
    transactionTypes: buildTransactionTypeSummary(bills),
    bills,
  }
}

function buildSeededEgresosExactReadyOverview(pageSize: number): EgresosExactReadyOverviewResponse {
  const bills = seededBills.map((bill) =>
    finalizeEgresoBill({
      ...bill,
      dueStatus: isOverdue(bill.dueDate) ? 'vencida' : bill.dueStatus,
    }),
  )
  const exactSupportBills = bills.filter(
    (bill) =>
      bill.conciliation.exactAmountMatch &&
      bill.conciliation.sameAccount === true &&
      bill.conciliation.samePeriod === true &&
      bill.conciliation.sameCurrency === true,
  )
  const exactBills = bills.filter((bill) => bill.conciliation.actionCode === 'apply-credit')
  const journalReadyBills = bills.filter((bill) => bill.operationalCode === 'E1J')
  const firstExactSupportBill = exactSupportBills[0] ?? null
  const firstExactSupportIndex = firstExactSupportBill
    ? bills.findIndex((bill) => bill.internalId === firstExactSupportBill.internalId)
    : -1
  const firstExactBill = exactBills[0] ?? null
  const firstExactIndex = firstExactBill
    ? bills.findIndex((bill) => bill.internalId === firstExactBill.internalId)
    : -1
  const firstJournalReadyBill = journalReadyBills[0] ?? null
  const firstJournalReadyIndex = firstJournalReadyBill
    ? bills.findIndex((bill) => bill.internalId === firstJournalReadyBill.internalId)
    : -1

  return {
    generatedAtUtc: new Date().toISOString(),
    dataSource: 'seed',
    reviewedBills: bills.length,
    exactSupportCount: exactSupportBills.length,
    exactReadyCount: exactBills.length,
    journalReadyCount: journalReadyBills.length,
    firstExactSupportBillInternalId: firstExactSupportBill?.internalId ?? null,
    firstExactSupportBillDocumentNumber: firstExactSupportBill?.documentNumber ?? null,
    firstExactSupportOffset:
      firstExactSupportIndex >= 0 ? Math.floor(firstExactSupportIndex / pageSize) * pageSize : null,
    firstExactBillInternalId: firstExactBill?.internalId ?? null,
    firstExactBillDocumentNumber: firstExactBill?.documentNumber ?? null,
    firstExactOffset:
      firstExactIndex >= 0 ? Math.floor(firstExactIndex / pageSize) * pageSize : null,
    firstJournalReadyBillInternalId: firstJournalReadyBill?.internalId ?? null,
    firstJournalReadyBillDocumentNumber: firstJournalReadyBill?.documentNumber ?? null,
    firstJournalReadyOffset:
      firstJournalReadyIndex >= 0 ? Math.floor(firstJournalReadyIndex / pageSize) * pageSize : null,
  }
}

async function fetchOpenVendorBillSummaryRows(
  client: NetSuiteClient,
  limit: number,
  offset: number,
): Promise<EgresoPageSnapshot> {
  const response = await client.suiteql(buildOpenVendorBillsQuery(), limit, offset)
  const json = response.json as SuiteQlCollectionResponse
  return {
    rows: (json.items ?? []).map(toVendorBillSummaryRow),
    totalResults:
      typeof json.totalResults === 'number' && Number.isFinite(json.totalResults)
        ? json.totalResults
        : 0,
    count:
      typeof json.count === 'number' && Number.isFinite(json.count)
        ? json.count
        : Array.isArray(json.items)
          ? json.items.length
          : 0,
    hasMore: Boolean(json.hasMore),
  }
}

async function fetchAllOpenVendorBillSummaryRows(client: NetSuiteClient) {
  return (await fetchAllSuiteQlRows(client, buildOpenVendorBillsQuery())).map(toVendorBillSummaryRow)
}

async function fetchOpenVendorBillSummaryRowById(client: NetSuiteClient, billInternalId: string) {
  const response = await client.suiteql(buildOpenVendorBillByIdQuery(billInternalId), 1, 0)
  const json = response.json as SuiteQlCollectionResponse
  const firstRow = (json.items ?? [])[0]
  return firstRow ? toVendorBillSummaryRow(firstRow) : null
}

async function fetchOpenVendorCredits(
  client: NetSuiteClient,
  supplierIds: string[],
  windowStartDate: string | null,
) {
  const creditRowChunks = await mapWithConcurrency(
    chunkValues(supplierIds, SUITEQL_IN_CHUNK_SIZE),
    SUPPORT_QUERY_CONCURRENCY,
    async (supplierChunk) =>
      (
        await fetchAllSuiteQlRows(client, buildVendorCreditsQuery(supplierChunk, windowStartDate))
      ).map(toVendorCreditSummaryRow),
  )
  const creditRows = creditRowChunks.flat()

  const dedupedCredits = Array.from(
    new Map(
      creditRows.map((row) => [
        `${row.internalId}:${row.payableAccountId ?? row.payableAccountNumber ?? ''}`,
        row,
      ]),
    ).values(),
  )

  const credits = await mapWithConcurrency(dedupedCredits, CREDIT_FETCH_CONCURRENCY, async (row) => {
    const record = await client.getRecord('vendorCredit', row.internalId)
    const availableAmount = normalizeMoneyMagnitude(
      getNullableNumber(getNullableRecord(record.json)?.unapplied),
    )

    return {
      ...row,
      availableAmount,
    }
  })

  return credits
    .filter((credit) => (credit.availableAmount ?? 0) > OPEN_AMOUNT_TOLERANCE)
    .map((credit) => ({
      ...credit,
      transactionType: 'Vendor Credit' as const,
      supportKind: 'vendor-credit' as const,
    }))
}

async function fetchOpenVendorJournalSupports(
  client: NetSuiteClient,
  supplierIds: string[],
  windowStartDate: string | null,
  options?: {
    includeExecutionProfiles?: boolean
  },
) {
  const journalRowChunks = await mapWithConcurrency(
    chunkValues(supplierIds, SUITEQL_IN_CHUNK_SIZE),
    SUPPORT_QUERY_CONCURRENCY,
    async (supplierChunk) =>
      (
        await fetchAllSuiteQlRows(
          client,
          buildVendorJournalSupportsQuery(supplierChunk, windowStartDate),
        )
      ).map(toVendorJournalSupportRow),
  )
  const journalRows = journalRowChunks.flat()

  const dedupedRows = Array.from(
    new Map(
      journalRows.map((row) => [
        `${row.internalId}:${row.supplierId ?? ''}:${row.payableAccountId ?? row.payableAccountNumber ?? ''}`,
        row,
      ]),
    ).values(),
  )
    .filter((row) => (row.availableAmount ?? 0) > OPEN_AMOUNT_TOLERANCE)

  if (options?.includeExecutionProfiles === false) {
    return dedupedRows.map((row) => ({
      ...row,
      journalExecutionMode: 'unknown' as const,
      journalExecutionReason:
        'El perfil operativo del journal se calcula solo cuando el caso exacto lo necesita.',
      transactionType: 'Journal Entry' as const,
      supportKind: 'journal' as const,
    }))
  }

  const executionProfiles = await fetchJournalExecutionProfiles(client, dedupedRows)

  return mapVendorJournalSupportRowsWithProfiles(dedupedRows, executionProfiles)
}

async function fetchJournalExecutionProfiles(
  client: NetSuiteClient,
  journalRows: VendorJournalSupportRow[],
) {
  const journalIds = uniqueValues(journalRows.map((row) => row.internalId))
  const rowChunks = await mapWithConcurrency(
    chunkValues(journalIds, SUITEQL_IN_CHUNK_SIZE),
    SUPPORT_QUERY_CONCURRENCY,
    async (journalChunk) =>
      (
        await fetchAllSuiteQlRows(
          client,
          buildJournalPayableLinesQuery(journalChunk),
        )
      ).map(toJournalPayableLineProfileRow),
  )
  const rows = rowChunks.flat()

  const profileRowsByKey = new Map<string, JournalPayableLineProfileRow[]>()
  for (const row of rows) {
    const key = buildJournalSupportKey({
      internalId: row.journalId,
      supplierId: row.supplierId,
      payableAccountId: row.payableAccountId,
    })
    const existing = profileRowsByKey.get(key)
    if (existing) {
      existing.push(row)
    } else {
      profileRowsByKey.set(key, [row])
    }
  }

  const profiles = new Map<string, JournalExecutionProfile>()
  for (const journalRow of journalRows) {
    const key = buildJournalSupportKey(journalRow)
    profiles.set(
      key,
      resolveJournalExecutionProfile(journalRow, profileRowsByKey.get(key) ?? []),
    )
  }

  return profiles
}

function resolveJournalExecutionProfile(
  journalRow: Pick<
    VendorJournalSupportRow,
    'availableAmount' | 'internalId' | 'transactionNumber' | 'tranId'
  >,
  lines: JournalPayableLineProfileRow[],
): JournalExecutionProfile {
  const creditLines = lines.filter((line) => (line.creditAmount ?? 0) > OPEN_AMOUNT_TOLERANCE)
  const hasDebitLine = lines.some((line) => (line.debitAmount ?? 0) > OPEN_AMOUNT_TOLERANCE)
  const exactCreditLine = creditLines.find((line) =>
    amountsMatchExactly(line.creditAmount, journalRow.availableAmount),
  )
  const documentNumber = resolveBestDocumentNumber(
    journalRow.transactionNumber,
    journalRow.tranId,
    journalRow.internalId,
  )

  if (exactCreditLine) {
    return {
      mode: 'payment-ready',
      reason: `El journal ${documentNumber} ya expone una linea AP acreedora exacta; si aparece un caso asi puede prepararse el cierre operativo desde vendor payment.`,
    }
  }

  if (creditLines.length > 0) {
    const maxCreditAmount = Math.max(...creditLines.map((line) => line.creditAmount ?? 0))
    return {
      mode: 'review-credit-mismatch',
      reason: `El journal ${documentNumber} si tiene lineas AP acreedoras, pero ninguna cuadra exacto contra ${formatMoneyValue(journalRow.availableAmount)}; por ahora queda en revision.`,
    }
  }

  if (hasDebitLine) {
    return {
      mode: 'review-debit-only',
      reason: `El journal ${documentNumber} solo expone la linea AP deudora que respalda la conciliacion; sirve para revision, pero no para cierre automatico en esta etapa.`,
    }
  }

  return {
    mode: 'unknown',
    reason: `No pude determinar el lado AP del journal ${documentNumber} en esta lectura; conviene revisarlo manualmente.`,
  }
}

function buildJournalSupportKey(
  row: Pick<VendorJournalSupportRow, 'internalId' | 'supplierId' | 'payableAccountId'>,
) {
  return `${row.internalId}:${row.supplierId ?? ''}:${row.payableAccountId ?? ''}`
}

function mapVendorJournalSupportRowsWithProfiles(
  rows: VendorJournalSupportRow[],
  executionProfiles: Map<string, JournalExecutionProfile>,
): VendorJournalSupportLive[] {
  return rows.map((row) => {
    const executionProfile =
      executionProfiles.get(buildJournalSupportKey(row)) ?? {
        mode: 'unknown' as const,
        reason:
          'No pude determinar en esta lectura si el journal exacto tiene una linea AP acreditable para cierre operativo.',
      }

    return {
      ...row,
      journalExecutionMode: executionProfile.mode,
      journalExecutionReason: executionProfile.reason,
      transactionType: 'Journal Entry' as const,
      supportKind: 'journal' as const,
    }
  })
}

function applyJournalExecutionProfiles(
  rows: VendorJournalSupportLive[],
  executionProfiles: Map<string, JournalExecutionProfile>,
): VendorJournalSupportLive[] {
  return rows.map((row) => {
    const executionProfile = executionProfiles.get(buildJournalSupportKey(row))
    if (!executionProfile) {
      return row
    }

    return {
      ...row,
      journalExecutionMode: executionProfile.mode,
      journalExecutionReason: executionProfile.reason,
    }
  })
}

async function classifyBillsWithHydratedExactJournalProfiles(
  client: NetSuiteClient,
  billRows: VendorBillSummaryRow[],
  credits: VendorCreditLive[],
  journalSupports: VendorJournalSupportLive[],
) : Promise<ClassifiedBillSnapshot> {
  const supports = [...credits, ...journalSupports]
  const bills = billRows.map((row) => classifyVendorBill(row, supports))
  const exactJournalSupportKeys = collectExactJournalSupportKeys(bills)

  if (exactJournalSupportKeys.size === 0) {
    return {
      bills,
      supports,
    }
  }

  const targetJournalRows = journalSupports.filter((row) =>
    exactJournalSupportKeys.has(buildJournalSupportKey(row)),
  )

  if (targetJournalRows.length === 0) {
    return {
      bills,
      supports,
    }
  }

  const executionProfiles = await fetchJournalExecutionProfiles(client, targetJournalRows)
  if (executionProfiles.size === 0) {
    return {
      bills,
      supports,
    }
  }

  const enrichedJournalSupports = mapVendorJournalSupportRowsWithProfiles(journalSupports, executionProfiles)
  const enrichedSupports = [...credits, ...enrichedJournalSupports]
  return {
    bills: billRows.map((row) => classifyVendorBill(row, enrichedSupports)),
    supports: enrichedSupports,
  }
}

function collectExactJournalSupportKeys(bills: EgresoBill[]) {
  const keys = new Set<string>()

  for (const bill of bills) {
    if (bill.statusCode !== 'E1') {
      continue
    }

    const candidate = bill.creditCandidates[0] ?? null
    if (
      !candidate ||
      candidate.supportSource !== 'journal' ||
      candidate.matchedDocumentCount !== 1 ||
      !candidate.exactAmountMatch ||
      !candidate.sameAccount ||
      !candidate.sameCurrency ||
      !candidate.samePeriod
    ) {
      continue
    }

    keys.add(
      buildJournalSupportKey({
        internalId: candidate.internalId,
        supplierId: bill.supplierId,
        payableAccountId: candidate.payableAccountId,
      }),
    )
  }

  return keys
}

function classifyVendorBill(summary: VendorBillSummaryRow, supports: VendorSupportLive[]): EgresoBill {
  const dueStatus = isOverdue(summary.dueDate) ? 'vencida' : 'vigente'
  const billAmount = getBillConciliationTargetAmount(summary)
  const supplierSupports = supports.filter((support) =>
    matchesByIdentity(support.supplierId, summary.supplierId),
  )
  const sameAccountSupports = supplierSupports.filter((support) =>
    isSamePayableAccount(summary, support),
  )
  const crossAccountSupports = supplierSupports.filter(
    (support) => !isSamePayableAccount(summary, support),
  )
  const sameCurrencySupports = sameAccountSupports.filter((support) =>
    matchesByIdentity(support.currencyId, summary.currencyId, support.currencyName, summary.currencyName),
  )
  const crossCurrencySupports = sameAccountSupports.filter(
    (support) =>
      !matchesByIdentity(support.currencyId, summary.currencyId, support.currencyName, summary.currencyName),
  )
  const crossAccountSameCurrencySupports = crossAccountSupports.filter((support) =>
    matchesByIdentity(support.currencyId, summary.currencyId, support.currencyName, summary.currencyName),
  )

  const sortedSameCurrencySupports = sortSupportsForBill(summary, billAmount, sameCurrencySupports)
  const sortedCrossCurrencySupports = sortSupportsForBill(summary, billAmount, crossCurrencySupports)
  const sortedCrossAccountSameCurrencySupports = sortSupportsForBill(
    summary,
    billAmount,
    crossAccountSameCurrencySupports,
  )
  const samePeriodSupports = sortedSameCurrencySupports.filter((support) =>
    isSamePeriod(summary, support),
  )
  const crossPeriodCoverageSupports = sortedSameCurrencySupports.filter(
    (support) => !isSamePeriod(summary, support),
  )
  const exactSamePeriodMatch = findExactSupportMatch(summary, billAmount, samePeriodSupports)
  const exactCrossPeriodMatch = findExactSupportMatch(
    summary,
    billAmount,
    crossPeriodCoverageSupports,
  )
  const samePeriodCoverageAmount = sumAmount(
    samePeriodSupports.map((support) => support.availableAmount),
  )
  const crossPeriodCoverageAmount = sumAmount(
    crossPeriodCoverageSupports.map((support) => support.availableAmount),
  )
  const sameCurrencyCoverageAmount = sumAmount(
    sortedSameCurrencySupports.map((support) => support.availableAmount),
  )
  const crossCurrencyAmbiguity = sortedCrossCurrencySupports.find((support) =>
    amountsMatchExactly(support.availableAmount, billAmount),
  )
  const crossAccountAmbiguity =
    sortedCrossAccountSameCurrencySupports.find((support) =>
      amountsMatchExactly(support.availableAmount, billAmount),
    ) ??
    sortedCrossAccountSameCurrencySupports.find((support) => isSamePeriod(summary, support)) ??
    sortedCrossAccountSameCurrencySupports[0] ??
    null

  const exactSyntheticCandidate = exactSamePeriodMatch
    ? buildCombinedSupportCandidate(summary, billAmount, exactSamePeriodMatch)
    : exactCrossPeriodMatch
      ? buildCombinedSupportCandidate(summary, billAmount, exactCrossPeriodMatch)
      : null
  const sameCurrencyCandidates = sortedSameCurrencySupports.map((support) =>
    toSupportCandidate(summary, billAmount, support),
  )
  const candidates =
    sameCurrencyCandidates.length > 0
      ? exactSyntheticCandidate
        ? [exactSyntheticCandidate, ...sameCurrencyCandidates]
        : sameCurrencyCandidates
      : crossAccountAmbiguity
        ? [toSupportCandidate(summary, billAmount, crossAccountAmbiguity)]
      : crossCurrencyAmbiguity
        ? [toSupportCandidate(summary, billAmount, crossCurrencyAmbiguity)]
        : []

  if (exactSamePeriodMatch) {
    return buildEgresoBill(summary, dueStatus, sameCurrencyCoverageAmount, candidates, {
      statusCode: 'E1',
      statusLabel: 'Soporte exacto conciliable',
      statusTone: 'ready',
      statusReason: buildExactSupportReason(exactSamePeriodMatch),
    })
  }

  if (samePeriodCoverageAmount > OPEN_AMOUNT_TOLERANCE) {
    const supportCount = samePeriodSupports.length
    const isEnoughCoverage = billAmount !== null && samePeriodCoverageAmount + OPEN_AMOUNT_TOLERANCE >= billAmount
    return buildEgresoBill(summary, dueStatus, sameCurrencyCoverageAmount, candidates, {
      statusCode: 'E2',
      statusLabel: 'Cobertura disponible',
      statusTone: 'review',
      statusReason: isEnoughCoverage
        ? `Hay ${formatSupportDocumentCountLabel(supportCount)} aplicables en el mismo periodo con cobertura suficiente para cerrar la factura; conviene revisar la combinacion final.`
        : `Hay ${formatMoneyValue(samePeriodCoverageAmount)} detectados en ${formatSupportDocumentCountLabel(supportCount)} del mismo periodo, pero el saldo sigue parcial.`,
      })
  }

  if (exactCrossPeriodMatch || crossPeriodCoverageAmount > OPEN_AMOUNT_TOLERANCE) {
    return buildEgresoBill(summary, dueStatus, sameCurrencyCoverageAmount, candidates, {
      statusCode: 'E5',
      statusLabel: 'Cobertura en otro periodo',
      statusTone: 'period-review',
      statusReason: exactCrossPeriodMatch
        ? buildCrossPeriodSupportReason(exactCrossPeriodMatch)
        : `Se detecto cobertura util por ${formatMoneyValue(crossPeriodCoverageAmount)}, pero solo en periodos distintos al de la factura.`,
    })
  }

  if (crossAccountAmbiguity) {
    return buildEgresoBill(summary, dueStatus, sameCurrencyCoverageAmount, candidates, {
      statusCode: 'E7',
      statusLabel: 'Revision manual',
      statusTone: 'exception',
      statusReason: `Existe un ${describeSupportDocumentKind(crossAccountAmbiguity)} con proveedor y moneda compatibles, pero en ${formatPayableAccountLabel(crossAccountAmbiguity.payableAccountNumber, crossAccountAmbiguity.payableAccountName)}; la factura vive en ${formatPayableAccountLabel(summary.payableAccountNumber, summary.payableAccountName)}.`,
    })
  }

  if (crossCurrencyAmbiguity) {
    return buildEgresoBill(summary, dueStatus, sameCurrencyCoverageAmount, candidates, {
      statusCode: 'E7',
      statusLabel: 'Revision manual',
      statusTone: 'exception',
      statusReason: `Existe un ${describeSupportDocumentKind(crossCurrencyAmbiguity)} con monto comparable, pero en ${crossCurrencyAmbiguity.currencyName ?? 'otra moneda'}; conviene revisarlo manualmente antes de aplicar.`,
    })
  }

  if (dueStatus === 'vencida') {
    return buildEgresoBill(summary, dueStatus, sameCurrencyCoverageAmount, candidates, {
      statusCode: 'E6',
      statusLabel: 'Vencida sin cobertura',
      statusTone: 'exception',
      statusReason: 'La factura ya vencio y no se detecta soporte AP suficiente en la lectura actual.',
    })
  }

  return buildEgresoBill(summary, dueStatus, sameCurrencyCoverageAmount, candidates, {
    statusCode: 'E7',
    statusLabel: 'Revision manual',
    statusTone: 'review',
    statusReason: 'Todavia no se detecta un soporte AP util para esta factura en la lectura actual.',
  })
}

function findExactSupportMatch(
  bill: VendorBillSummaryRow,
  billAmount: number | null,
  supports: VendorSupportLive[],
): SupportMatch | null {
  const exactSingleSupport = supports.find((support) =>
    amountsMatchExactly(support.availableAmount, billAmount),
  )

  if (exactSingleSupport) {
    return {
      supports: [exactSingleSupport],
      totalAmount: exactSingleSupport.availableAmount ?? 0,
      samePeriod: isSamePeriod(bill, exactSingleSupport),
      exactAmountMatch: true,
    }
  }

  const combination = findExactSupportCombination(supports, billAmount)
  if (!combination) {
    return null
  }

  return {
    supports: combination,
    totalAmount: sumAmount(combination.map((support) => support.availableAmount)),
    samePeriod: combination.every((support) => isSamePeriod(bill, support)),
    exactAmountMatch: true,
  }
}

function findExactSupportCombination(
  supports: VendorSupportLive[],
  billAmount: number | null,
): VendorSupportLive[] | null {
  if (billAmount === null || supports.length < 2) {
    return null
  }

  const targetCents = toMoneyCents(billAmount)
  const toleranceCents = Math.max(1, Math.round(OPEN_AMOUNT_TOLERANCE * 100))
  const usableSupports = supports.filter(
    (support) => (support.availableAmount ?? 0) > OPEN_AMOUNT_TOLERANCE,
  )

  if (usableSupports.length < 2) {
    return null
  }

  const reachable = new Map<number, number[]>()
  reachable.set(0, [])

  for (let index = 0; index < usableSupports.length; index += 1) {
    const support = usableSupports[index]
    const supportCents = toMoneyCents(support.availableAmount ?? 0)
    if (supportCents <= 0 || supportCents > targetCents + toleranceCents) {
      continue
    }

    const snapshot = Array.from(reachable.entries()).sort((left, right) => right[0] - left[0])
    for (const [existingSum, existingIndexes] of snapshot) {
      const nextSum = existingSum + supportCents
      if (nextSum > targetCents + toleranceCents) {
        continue
      }

      const nextIndexes = [...existingIndexes, index]
      const previousIndexes = reachable.get(nextSum)
      if (
        previousIndexes &&
        previousIndexes.length <= nextIndexes.length
      ) {
        continue
      }

      reachable.set(nextSum, nextIndexes)
      if (Math.abs(nextSum - targetCents) <= toleranceCents && nextIndexes.length > 1) {
        return nextIndexes.map((supportIndex) => usableSupports[supportIndex])
      }
    }
  }

  return null
}

function buildCombinedSupportCandidate(
  bill: VendorBillSummaryRow,
  billAmount: number | null,
  match: SupportMatch,
): EgresoSupportCandidate | null {
  if (match.supports.length <= 1) {
    return null
  }

  const supportSource = resolveSupportSource(match.supports)
  const amountDelta =
    match.totalAmount !== null && billAmount !== null
      ? normalizeMoneyMagnitude(match.totalAmount - billAmount)
      : null

  return {
    internalId: `combined:${match.supports.map((support) => support.internalId).join('+')}`,
    documentNumber: `${match.supports.length} soportes`,
    transactionType: resolveCombinedSupportTypeLabel(supportSource, match.supports.length),
    supportSource,
    journalExecutionMode: null,
    journalExecutionReason: null,
    matchedDocumentCount: match.supports.length,
    transactionDate: match.supports[0]?.transactionDate ?? null,
    postingPeriodName: match.samePeriod
      ? match.supports[0]?.postingPeriodName ?? null
      : 'Multiples periodos',
    currency: match.supports[0]?.currencyName ?? null,
    payableAccountId: match.supports[0]?.payableAccountId ?? null,
    payableAccountNumber: match.supports[0]?.payableAccountNumber ?? null,
    payableAccountName: match.supports[0]?.payableAccountName ?? null,
    availableAmount: match.totalAmount,
    sameAccount: true,
    samePeriod: match.samePeriod,
    sameCurrency: true,
    exactAmountMatch: match.exactAmountMatch,
    amountDelta,
    reason: buildCombinedSupportReason(match),
  }
}

function buildExactSupportReason(match: SupportMatch) {
  if (match.supports.length === 1) {
    const support = match.supports[0]
    return `${describeSupportDocumentKind(support)} ${resolveBestDocumentNumber(support.transactionNumber, support.tranId, support.internalId)} cuadra exactamente contra el monto individual de la factura dentro del mismo periodo contable.`
  }

  return `${formatSupportDocumentCountLabel(match.supports.length)} cubren exactamente el monto individual de la factura dentro del mismo periodo contable.`
}

function buildCrossPeriodSupportReason(match: SupportMatch) {
  if (match.supports.length === 1) {
    const support = match.supports[0]
    return `Existe un ${describeSupportDocumentKind(support)} exacto contra la factura individual, pero pertenece a ${support.postingPeriodName ?? 'otro periodo contable'}.`
  }

  return `${formatSupportDocumentCountLabel(match.supports.length)} cubren exactamente el monto individual de la factura, pero solo en periodos contables distintos al de la factura.`
}

function buildCombinedSupportReason(match: SupportMatch) {
  const documentSample = match.supports
    .slice(0, 3)
    .map((support) =>
      resolveBestDocumentNumber(support.transactionNumber, support.tranId, support.internalId),
    )
    .join(', ')

  return match.samePeriod
    ? `La combinacion ${documentSample} cubre exactamente el monto individual de la factura en el mismo periodo.`
    : `La combinacion ${documentSample} cubre exactamente el monto individual de la factura, pero cruza periodo contable.`
}

function resolveCombinedSupportTypeLabel(source: EgresoSupportSource, supportCount: number) {
  if (source === 'vendor-credit') {
    return supportCount === 1 ? 'Vendor Credit' : `${supportCount} vendor credits`
  }

  if (source === 'journal') {
    return supportCount === 1 ? 'Journal Entry' : `${supportCount} journals`
  }

  return `${supportCount} soportes combinados`
}

function buildEgresoBill(
  summary: VendorBillSummaryRow,
  dueStatus: 'vigente' | 'vencida',
  availableCoverageAmount: number,
  creditCandidates: EgresoSupportCandidate[],
  status: Pick<EgresoBillBase, 'statusCode' | 'statusLabel' | 'statusTone' | 'statusReason'>,
): EgresoBill {
  const transactionAmount = getBillConciliationTargetAmount(summary)

  return finalizeEgresoBill({
    internalId: summary.internalId,
    documentNumber: resolveBestDocumentNumber(
      summary.transactionNumber,
      summary.tranId,
      summary.internalId,
    ),
    transactionNumber: summary.transactionNumber,
    supplierId: summary.supplierId,
    supplierName: summary.supplierName,
    transactionDate: summary.transactionDate,
    dueDate: summary.dueDate,
    postingPeriodName: summary.postingPeriodName,
    currency: summary.currencyName,
    payableAccountId: summary.payableAccountId,
    payableAccountNumber: summary.payableAccountNumber,
    payableAccountName: summary.payableAccountName,
    total: summary.total,
    openAmount: transactionAmount,
    availableCoverageAmount,
    dueStatus,
    memo: summary.memo,
    creditCandidates,
    operationalCode: null,
    operationalLabel: null,
    operationalReason: null,
    ...status,
  })
}

function finalizeEgresoBill(bill: EgresoBillBase): EgresoBill {
  const operationalStatus = resolveOperationalStatus(bill, bill.creditCandidates[0] ?? null)

  return {
    ...bill,
    operationalCode: operationalStatus.code,
    operationalLabel: operationalStatus.label,
    operationalReason: operationalStatus.reason,
    conciliation: buildConciliation(bill),
  }
}

function resolveOperationalStatus(
  bill: Pick<EgresoBillBase, 'statusCode' | 'total' | 'openAmount'>,
  candidate: Pick<
    EgresoSupportCandidate,
    | 'supportSource'
    | 'matchedDocumentCount'
    | 'documentNumber'
    | 'availableAmount'
    | 'exactAmountMatch'
    | 'journalExecutionMode'
    | 'journalExecutionReason'
  > | null,
): EgresoOperationalStatus {
  if (bill.statusCode !== 'E1' || !candidate) {
    return {
      code: null,
      label: null,
      reason: null,
    }
  }

  if (candidate.matchedDocumentCount > 1 && candidate.supportSource === 'mixed') {
    return {
      code: 'E1X',
      label: 'Exacto mixto',
      reason:
        'La conciliacion exacta existe, pero mezcla distintos tipos de soporte y requiere validacion manual.',
    }
  }

  if (candidate.matchedDocumentCount > 1) {
    return {
      code: 'E1M',
      label: 'Exacto con multiples soportes',
      reason:
        'La conciliacion exacta existe, pero requiere combinar varios soportes antes de cerrarla.',
    }
  }

  if (candidate.supportSource === 'vendor-credit') {
    if (!isDirectCreditApplicationReady(bill, candidate)) {
      return {
        code: 'E1X',
        label: 'Credito exacto en revision',
        reason: `El vendor credit ${candidate.documentNumber ?? 'detectado'} cuadra contra la factura individual, pero el residual abierto actual no coincide; primero hay que revisar la aplicacion exacta sobre ese documento.`,
      }
    }

    return {
      code: 'E1C',
      label: 'Credito exacto aplicable',
      reason: `El vendor credit ${candidate.documentNumber ?? 'detectado'} cuadra exacto y puede evaluarse para aplicacion directa.`,
    }
  }

  if (candidate.supportSource === 'journal') {
    if (candidate.journalExecutionMode === 'payment-ready') {
      return {
        code: 'E1J',
        label: 'Journal exacto operable',
        reason:
          candidate.journalExecutionReason ??
          `El journal ${candidate.documentNumber ?? 'detectado'} cuadra exacto y ya expone un perfil AP apto para preparar el cierre operativo.`,
      }
    }

    return {
      code: 'E1R',
      label: 'Journal exacto en revision',
      reason:
        candidate.journalExecutionReason ??
        `El journal ${candidate.documentNumber ?? 'detectado'} cuadra exacto para conciliacion, pero hoy se conserva en revision hasta definir el cierre operativo correcto.`,
    }
  }

  return {
    code: 'E1X',
    label: 'Exacto especial',
    reason:
      'La conciliacion exacta existe, pero el tipo de soporte requiere revision operativa antes de cerrarla.',
  }
}

function buildConciliation(bill: EgresoBillBase): EgresoConciliation {
  const candidate = bill.creditCandidates[0] ?? null
  const targetAmount = getBillConciliationTargetAmount(bill)
  const amountDelta =
    candidate?.amountDelta ?? resolveCoverageGap(targetAmount, bill.availableCoverageAmount)
  const hasSupport =
    bill.creditCandidates.length > 0 || (bill.availableCoverageAmount ?? 0) > OPEN_AMOUNT_TOLERANCE
  const exactAmountMatch =
    candidate?.exactAmountMatch ??
    (amountDelta !== null && amountDelta <= OPEN_AMOUNT_TOLERANCE && hasSupport)
  const sameAccount = candidate?.sameAccount ?? null
  const samePeriod = candidate?.samePeriod ?? null
  const sameCurrency = candidate?.sameCurrency ?? null
  const supportCount = bill.creditCandidates.filter(
    (support) => !support.internalId.startsWith('combined:'),
  ).length
  const supportSource = candidate?.supportSource ?? null
  const matchedDocumentCount = candidate?.matchedDocumentCount ?? 0

  const lane = resolveConciliationLane(bill, {
    hasSupport,
    exactAmountMatch,
    sameAccount,
    samePeriod,
    sameCurrency,
  })
  const laneLabel = resolveConciliationLaneLabel(lane)
  const action = resolveConciliationAction(bill, candidate)

  return {
    lane,
    laneLabel,
    actionCode: action.code,
    actionLabel: action.label,
    actionDetail: action.detail,
    hasSupport,
    supportCount,
    amountDelta,
    exactAmountMatch,
    sameAccount,
    samePeriod,
    sameCurrency,
    supportSource,
    matchedDocumentCount,
  }
}

function resolveConciliationLane(
  bill: Pick<EgresoBillBase, 'statusCode'>,
  options: {
    hasSupport: boolean
    exactAmountMatch: boolean
    sameAccount: boolean | null
    samePeriod: boolean | null
    sameCurrency: boolean | null
  },
): EgresoConciliationLane {
  if (
    options.hasSupport &&
    options.exactAmountMatch &&
    options.sameAccount === true &&
    options.samePeriod === true &&
    options.sameCurrency === true
  ) {
    return 'exact'
  }

  if (bill.statusCode === 'E5') {
    return 'cross-period'
  }

  if (bill.statusCode === 'E6' || !options.hasSupport) {
    return 'without-support'
  }

  return 'with-gap'
}

function resolveConciliationLaneLabel(lane: EgresoConciliationLane) {
  switch (lane) {
    case 'exact':
      return 'Cuadrada'
    case 'with-gap':
      return 'Con diferencia'
    case 'cross-period':
      return 'Cruce de periodo'
    case 'without-support':
    default:
      return 'Sin soporte'
  }
}

function resolveConciliationAction(
  bill: Pick<EgresoBillBase, 'statusCode' | 'dueStatus' | 'total' | 'openAmount'>,
  candidate: Pick<
    EgresoSupportCandidate,
    | 'supportSource'
    | 'matchedDocumentCount'
    | 'journalExecutionMode'
    | 'journalExecutionReason'
    | 'availableAmount'
    | 'exactAmountMatch'
  > | null,
): {
  code: EgresoConciliationActionCode
  label: string
  detail: string
} {
  switch (bill.statusCode) {
    case 'E1':
      if (!candidate) {
        return {
          code: 'review-manual',
          label: 'Revisar soporte exacto',
          detail: 'La conciliacion exacta existe, pero conviene validar el soporte antes de cerrarla.',
        }
      }

      if (candidate.matchedDocumentCount > 1 && candidate.supportSource === 'mixed') {
        return {
          code: 'review-manual',
          label: 'Revisar soporte mixto',
          detail: 'La conciliacion exacta mezcla distintos tipos de soporte y conviene validarla antes de cerrarla.',
        }
      }

      if (candidate.matchedDocumentCount > 1) {
        return {
          code: 'review-manual',
          label: 'Revisar combinacion exacta',
          detail: 'La conciliacion exacta existe, pero requiere combinar varios soportes antes de cerrarla.',
        }
      }

      if (candidate.supportSource === 'vendor-credit') {
        if (!isDirectCreditApplicationReady(bill, candidate)) {
          return {
            code: 'review-manual',
            label: 'Revisar credito exacto',
            detail:
              'El vendor credit cuadra contra la factura individual, pero el residual abierto actual no coincide; conviene revisar la aplicacion exacta antes de ejecutar.',
          }
        }

        return {
          code: 'apply-credit',
          label: 'Aplicar credito',
          detail: 'El soporte ya cuadra con un vendor credit exacto; conviene preparar la aplicacion y validar el cierre.',
        }
      }

      if (candidate.supportSource === 'journal') {
        if (candidate.journalExecutionMode === 'payment-ready') {
          return {
            code: 'review-manual',
            label: 'Preparar journal exacto',
            detail:
              candidate.journalExecutionReason ??
              'La conciliacion exacta ya existe en AP y el journal expone un perfil operativo apto para preparar el cierre.',
          }
        }

        return {
          code: 'review-manual',
          label: 'Revisar soporte exacto',
          detail:
            candidate.journalExecutionReason ??
            'La conciliacion exacta ya existe en AP, pero el journal exacto se mantiene en revision hasta definir el cierre operativo correcto.',
        }
      }

      return {
        code: 'review-manual',
        label: 'Revisar soporte exacto',
        detail: 'La conciliacion exacta ya existe, pero mezcla tipos de soporte y conviene validarla antes de cerrar.',
      }
    case 'E2':
      return {
        code: 'resolve-gap',
        label: candidate?.matchedDocumentCount && candidate.matchedDocumentCount > 1
          ? 'Revisar combinacion'
          : 'Resolver diferencia',
        detail:
          candidate?.matchedDocumentCount && candidate.matchedDocumentCount > 1
            ? 'Hay varios soportes aplicables en el mismo periodo; falta decidir la combinacion final.'
            : 'Hay cobertura visible, pero falta cerrar remanente o definir aplicacion parcial.',
      }
    case 'E3':
      return {
        code: 'review-prepayment',
        label: 'Revisar anticipo',
        detail: 'El caso apunta a prepayment y no a conciliacion final de vendor credit.',
      }
    case 'E4':
      return {
        code: 'trace-payment',
        label: 'Amarrar pago',
        detail: 'Existe una salida detectada; primero hay que enlazarla correctamente.',
      }
    case 'E5':
      return {
        code: 'review-period',
        label: 'Revisar periodo',
        detail: 'El soporte existe, pero cruza periodo contable y debe validarse antes de cerrar la conciliacion.',
      }
    case 'E6':
      return {
        code: 'escalate-treasury',
        label: 'Escalar tesoreria',
        detail:
          bill.dueStatus === 'vencida'
            ? 'La factura ya vencio y sigue sin soporte util; requiere atencion inmediata.'
            : 'La factura sigue sin soporte util y conviene escalarla para seguimiento.',
      }
    case 'E7':
    default:
      return {
        code: 'review-manual',
        label: 'Revision manual',
        detail: 'El match no es confiable todavia; conviene validar soporte, moneda y documento.',
      }
  }
}

function resolveCoverageGap(openAmount: number | null, availableCoverageAmount: number | null) {
  if (openAmount === null) {
    return null
  }

  return Math.max(0, openAmount - (availableCoverageAmount ?? 0))
}

function buildTransactionTypeSummary(bills: EgresoBill[]) {
  return transactionTypeCatalog.map((item) => {
    const matchingBills = bills.filter((bill) => bill.statusCode === item.code)
    return {
      ...item,
      total: matchingBills.length,
      sampleDocumentNumber: matchingBills[0]?.documentNumber ?? null,
    }
  })
}

function getCachedExactSupportBills() {
  const cached = egresosExactSupportBillsCache.get('live')
  if (!cached) {
    return readPersistedExactSupportBills()
  }
  if (Date.now() - cached.createdAtMs >= EGRESOS_READ_CACHE_TTL_MS) {
    egresosExactSupportBillsCache.delete('live')
    return readPersistedExactSupportBills()
  }
  return cached.bills
}

function readPersistedExactSupportBills() {
  try {
    const stats = fs.statSync(EGRESOS_EXACT_SUPPORT_BILLS_CACHE_PATH)
    if (Date.now() - stats.mtimeMs >= EGRESOS_READ_CACHE_TTL_MS) {
      return []
    }

    const parsed = JSON.parse(
      fs.readFileSync(EGRESOS_EXACT_SUPPORT_BILLS_CACHE_PATH, 'utf8'),
    ) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed as EgresoBill[]
  } catch {
    return []
  }
}

function persistExactSupportBills(bills: EgresoBill[]) {
  try {
    fs.mkdirSync(path.dirname(EGRESOS_EXACT_SUPPORT_BILLS_CACHE_PATH), {
      recursive: true,
    })
    fs.writeFileSync(
      EGRESOS_EXACT_SUPPORT_BILLS_CACHE_PATH,
      JSON.stringify(bills),
      'utf8',
    )
  } catch (error) {
    console.warn('Egresos: unable to persist exact support bills cache.', error)
  }
}

function mergeExactSupportBillsIntoFirstPage(
  exactBills: EgresoBill[],
  pageBills: EgresoBill[],
  limit: number,
) {
  if (exactBills.length === 0) {
    return pageBills
  }

  const merged = [...exactBills, ...pageBills]
  const seen = new Set<string>()
  const uniqueBills: EgresoBill[] = []
  for (const bill of merged) {
    if (seen.has(bill.internalId)) {
      continue
    }
    seen.add(bill.internalId)
    uniqueBills.push(bill)
    if (uniqueBills.length >= limit) {
      break
    }
  }
  return uniqueBills
}

function sortBillsForQueue(bills: EgresoBill[]) {
  return [...bills].sort(compareBillsByStatusAndDueDate)
}

function compareBillsByStatusAndDueDate(left: EgresoBill, right: EgresoBill) {
  const priorityComparison = getBillOperationalPriority(left) - getBillOperationalPriority(right)
  if (priorityComparison !== 0) {
    return priorityComparison
  }

  const statusComparison = resolveSortableStatusCode(left).localeCompare(
    resolveSortableStatusCode(right),
    'es',
  )
  if (statusComparison !== 0) {
    return statusComparison
  }

  const dueDateComparison = getComparableDateValue(left.dueDate) - getComparableDateValue(right.dueDate)
  if (dueDateComparison !== 0) {
    return dueDateComparison
  }

  return left.documentNumber.localeCompare(right.documentNumber, 'es')
}

function resolveSortableStatusCode(bill: EgresoBill) {
  return bill.operationalCode ?? bill.statusCode
}

function getBillOperationalPriority(bill: EgresoBill) {
  switch (bill.operationalCode) {
    case 'E1C':
      return 0
    case 'E1J':
      return 1
    case 'E1R':
      return 2
    case 'E1M':
      return 3
    case 'E1X':
      return 4
    default:
      break
  }

  switch (bill.statusCode) {
    case 'E1':
      return 5
    case 'E2':
      return 6
    case 'E5':
      return 7
    case 'E6':
      return 8
    case 'E7':
      return 9
    case 'E3':
      return 10
    case 'E4':
      return 11
    default:
      return 99
  }
}

function selectHighlightBill(bills: EgresoBill[]) {
  return sortBillsForQueue(bills)[0]
}

function toSupportCandidate(
  bill: VendorBillSummaryRow,
  billAmount: number | null,
  support: VendorSupportLive,
): EgresoSupportCandidate {
  const sameAccount = isSamePayableAccount(bill, support)
  const sameCurrency = matchesByIdentity(
    support.currencyId,
    bill.currencyId,
    support.currencyName,
    bill.currencyName,
  )
  const samePeriod = isSamePeriod(bill, support)
  const exactAmount = amountsMatchExactly(support.availableAmount, billAmount)
  const amountDelta =
    support.availableAmount !== null && billAmount !== null
      ? normalizeMoneyMagnitude(support.availableAmount - billAmount)
      : null
  const journalExecutionMode =
    support.supportKind === 'journal' ? support.journalExecutionMode : null
  const journalExecutionReason =
    support.supportKind === 'journal' ? support.journalExecutionReason : null

  let reason = 'Soporte detectado para el mismo proveedor.'

  if (!sameAccount) {
    reason = `Soporte detectado en ${formatPayableAccountLabel(support.payableAccountNumber, support.payableAccountName)}, pero la factura vive en ${formatPayableAccountLabel(bill.payableAccountNumber, bill.payableAccountName)}.`
  } else if (!sameCurrency) {
    reason = `Monto util detectado en ${support.currencyName ?? 'otra moneda'}; requiere revision manual.`
  } else if (exactAmount && samePeriod) {
    reason =
      support.supportKind === 'journal'
        ? journalExecutionReason ?? 'Diario exacto en el mismo periodo; requiere amarre contra la factura.'
        : 'Cobertura exacta en el mismo periodo contable.'
  } else if (exactAmount) {
    reason =
      support.supportKind === 'journal'
        ? 'Diario exacto detectado, pero cruza periodo contable.'
        : 'Cobertura exacta detectada, pero cruza periodo contable.'
  } else if (samePeriod) {
    reason =
      support.supportKind === 'journal'
        ? journalExecutionReason ?? 'Diario parcial o combinable en el mismo periodo.'
        : 'Cobertura parcial o combinable en el mismo periodo.'
  } else {
    reason =
      support.supportKind === 'journal'
        ? 'Diario detectado en otro periodo contable.'
        : 'Cobertura detectada en otro periodo contable.'
  }

  return {
    internalId: support.internalId,
    documentNumber: resolveBestDocumentNumber(
      support.transactionNumber,
      support.tranId,
      support.internalId,
    ),
    transactionType: support.transactionType,
    supportSource: support.supportKind,
    journalExecutionMode,
    journalExecutionReason,
    matchedDocumentCount: 1,
    transactionDate: support.transactionDate,
    postingPeriodName: support.postingPeriodName,
    currency: support.currencyName,
    payableAccountId: support.payableAccountId,
    payableAccountNumber: support.payableAccountNumber,
    payableAccountName: support.payableAccountName,
    availableAmount: support.availableAmount,
    sameAccount,
    samePeriod,
    sameCurrency,
    exactAmountMatch: exactAmount,
    amountDelta,
    reason,
  }
}

function describeSupportDocumentKind(support: VendorSupportLive) {
  return support.supportKind === 'journal' ? 'diario AP' : 'vendor credit'
}

function resolveSupportSource(supports: Array<Pick<VendorSupportLive, 'supportKind'>>) {
  const supportKinds = Array.from(new Set(supports.map((support) => support.supportKind)))
  if (supportKinds.length === 1) {
    return supportKinds[0]
  }

  return 'mixed'
}

function formatPayableAccountLabel(accountNumber: string | null, accountName: string | null) {
  if (accountNumber && accountName) {
    return `${accountNumber} | ${accountName}`
  }

  return accountNumber ?? accountName ?? 'cuenta AP no identificada'
}

function buildOpenVendorBillsQuery() {
  const accountFilter = joinSuiteQlLiterals(EGRESOS_ALLOWED_AP_ACCOUNT_NUMBERS)
  return `
SELECT
  transaction.id AS internalId,
  transaction.tranid AS tranId,
  transaction.transactionnumber AS transactionNumber,
  transaction.trandate AS transactionDate,
  transaction.duedate AS dueDate,
  transaction.entity AS supplierId,
  BUILTIN.DF(transaction.entity) AS supplierName,
  transaction.postingperiod AS postingPeriodId,
  BUILTIN.DF(transaction.postingperiod) AS postingPeriodName,
  transaction.currency AS currencyId,
  BUILTIN.DF(transaction.currency) AS currencyName,
  tal.account AS payableAccountId,
  account.acctnumber AS payableAccountNumber,
  account.displaynamewithhierarchy AS payableAccountName,
  transaction.memo AS memo,
  transaction.foreigntotal AS total,
  MAX(ABS(tal.amountunpaid)) AS openAmount
FROM transaction
INNER JOIN transactionline mainLine
  ON mainLine.transaction = transaction.id
  AND mainLine.mainline = 'T'
INNER JOIN transactionaccountingline tal
  ON tal.transaction = transaction.id
  AND tal.posting = 'T'
  AND tal.accounttype = 'AcctPay'
INNER JOIN account
  ON account.id = tal.account
WHERE transaction.type = 'VendBill'
  AND account.acctnumber IN (${accountFilter})
GROUP BY
  transaction.id,
  transaction.tranid,
  transaction.transactionnumber,
  transaction.trandate,
  transaction.duedate,
  transaction.entity,
  BUILTIN.DF(transaction.entity),
  transaction.postingperiod,
  BUILTIN.DF(transaction.postingperiod),
  transaction.currency,
  BUILTIN.DF(transaction.currency),
  tal.account,
  account.acctnumber,
  account.displaynamewithhierarchy,
  transaction.memo,
  transaction.foreigntotal
HAVING MAX(ABS(tal.amountunpaid)) > ${OPEN_AMOUNT_TOLERANCE}
ORDER BY transaction.trandate DESC, transaction.id DESC
  `.trim()
}

function buildOpenVendorBillByIdQuery(billInternalId: string) {
  const accountFilter = joinSuiteQlLiterals(EGRESOS_ALLOWED_AP_ACCOUNT_NUMBERS)
  return `
SELECT
  transaction.id AS internalId,
  transaction.tranid AS tranId,
  transaction.transactionnumber AS transactionNumber,
  transaction.trandate AS transactionDate,
  transaction.duedate AS dueDate,
  transaction.entity AS supplierId,
  BUILTIN.DF(transaction.entity) AS supplierName,
  transaction.postingperiod AS postingPeriodId,
  BUILTIN.DF(transaction.postingperiod) AS postingPeriodName,
  transaction.currency AS currencyId,
  BUILTIN.DF(transaction.currency) AS currencyName,
  tal.account AS payableAccountId,
  account.acctnumber AS payableAccountNumber,
  account.displaynamewithhierarchy AS payableAccountName,
  transaction.memo AS memo,
  transaction.foreigntotal AS total,
  MAX(ABS(tal.amountunpaid)) AS openAmount
FROM transaction
INNER JOIN transactionline mainLine
  ON mainLine.transaction = transaction.id
  AND mainLine.mainline = 'T'
INNER JOIN transactionaccountingline tal
  ON tal.transaction = transaction.id
  AND tal.posting = 'T'
  AND tal.accounttype = 'AcctPay'
INNER JOIN account
  ON account.id = tal.account
WHERE transaction.type = 'VendBill'
  AND transaction.id = ${formatSuiteQlLiteral(billInternalId)}
  AND account.acctnumber IN (${accountFilter})
GROUP BY
  transaction.id,
  transaction.tranid,
  transaction.transactionnumber,
  transaction.trandate,
  transaction.duedate,
  transaction.entity,
  BUILTIN.DF(transaction.entity),
  transaction.postingperiod,
  BUILTIN.DF(transaction.postingperiod),
  transaction.currency,
  BUILTIN.DF(transaction.currency),
  tal.account,
  account.acctnumber,
  account.displaynamewithhierarchy,
  transaction.memo,
  transaction.foreigntotal
HAVING MAX(ABS(tal.amountunpaid)) > ${OPEN_AMOUNT_TOLERANCE}
  `.trim()
}

function buildVendorCreditsQuery(supplierIds: string[], windowStartDate: string | null) {
  const accountFilter = joinSuiteQlLiterals(EGRESOS_ALLOWED_AP_ACCOUNT_NUMBERS)
  const dateFilter = windowStartDate
    ? `\n  AND transaction.trandate >= TO_DATE(${formatSuiteQlLiteral(windowStartDate)}, 'YYYY-MM-DD')`
    : ''

  return `
SELECT
  transaction.id AS internalId,
  transaction.tranid AS tranId,
  transaction.transactionnumber AS transactionNumber,
  transaction.trandate AS transactionDate,
  transaction.postingperiod AS postingPeriodId,
  BUILTIN.DF(transaction.postingperiod) AS postingPeriodName,
  transaction.entity AS supplierId,
  BUILTIN.DF(transaction.entity) AS supplierName,
  transaction.currency AS currencyId,
  BUILTIN.DF(transaction.currency) AS currencyName,
  tal.account AS payableAccountId,
  account.acctnumber AS payableAccountNumber,
  account.displaynamewithhierarchy AS payableAccountName,
  transaction.foreigntotal AS total
FROM transaction
INNER JOIN transactionaccountingline tal
  ON tal.transaction = transaction.id
  AND tal.posting = 'T'
  AND tal.accounttype = 'AcctPay'
INNER JOIN account
  ON account.id = tal.account
WHERE transaction.type = 'VendCred'
  AND transaction.entity IN (${joinSuiteQlLiterals(supplierIds)})
  AND account.acctnumber IN (${accountFilter})
${dateFilter}
GROUP BY
  transaction.id,
  transaction.tranid,
  transaction.transactionnumber,
  transaction.trandate,
  transaction.postingperiod,
  BUILTIN.DF(transaction.postingperiod),
  transaction.entity,
  BUILTIN.DF(transaction.entity),
  transaction.currency,
  BUILTIN.DF(transaction.currency),
  tal.account,
  account.acctnumber,
  account.displaynamewithhierarchy,
  transaction.foreigntotal
ORDER BY transaction.trandate DESC, transaction.id DESC
  `.trim()
}

function buildVendorJournalSupportsQuery(supplierIds: string[], windowStartDate: string | null) {
  const accountFilter = joinSuiteQlLiterals(EGRESOS_ALLOWED_AP_ACCOUNT_NUMBERS)
  const dateFilter = windowStartDate
    ? `\n  AND transaction.trandate >= TO_DATE(${formatSuiteQlLiteral(windowStartDate)}, 'YYYY-MM-DD')`
    : ''

  return `
SELECT
  transaction.id AS internalId,
  transaction.tranid AS tranId,
  transaction.transactionnumber AS transactionNumber,
  transaction.trandate AS transactionDate,
  transaction.postingperiod AS postingPeriodId,
  BUILTIN.DF(transaction.postingperiod) AS postingPeriodName,
  transaction.currency AS currencyId,
  BUILTIN.DF(transaction.currency) AS currencyName,
  tal.account AS payableAccountId,
  account.acctnumber AS payableAccountNumber,
  account.displaynamewithhierarchy AS payableAccountName,
  transactionline.entity AS supplierId,
  BUILTIN.DF(transactionline.entity) AS supplierName,
  SUM(tal.debit) AS availableAmount
FROM transaction
INNER JOIN transactionline
  ON transactionline.transaction = transaction.id
INNER JOIN transactionaccountingline tal
  ON tal.transaction = transaction.id
  AND tal.transactionline = transactionline.id
  AND tal.posting = 'T'
  AND tal.accounttype = 'AcctPay'
INNER JOIN account
  ON account.id = tal.account
WHERE transaction.type = 'Journal'
  AND transactionline.entity IN (${joinSuiteQlLiterals(supplierIds)})
  AND account.acctnumber IN (${accountFilter})
  AND tal.debit > ${OPEN_AMOUNT_TOLERANCE}
${dateFilter}
GROUP BY
  transaction.id,
  transaction.tranid,
  transaction.transactionnumber,
  transaction.trandate,
  transaction.postingperiod,
  BUILTIN.DF(transaction.postingperiod),
  transaction.currency,
  BUILTIN.DF(transaction.currency),
  tal.account,
  account.acctnumber,
  account.displaynamewithhierarchy,
  transactionline.entity,
  BUILTIN.DF(transactionline.entity)
ORDER BY transaction.trandate DESC, transaction.id DESC
  `.trim()
}

function buildJournalPayableLinesQuery(journalIds: string[]) {
  if (journalIds.length === 0) {
    throw new Error('No hay journals para inspeccionar lineas AP.')
  }

  const accountFilter = joinSuiteQlLiterals(EGRESOS_ALLOWED_AP_ACCOUNT_NUMBERS)

  return `
SELECT
  transaction.id AS journalId,
  transactionline.entity AS supplierId,
  tal.account AS payableAccountId,
  SUM(tal.debit) AS debitAmount,
  SUM(tal.credit) AS creditAmount
FROM transaction
INNER JOIN transactionline
  ON transactionline.transaction = transaction.id
INNER JOIN transactionaccountingline tal
  ON tal.transaction = transaction.id
  AND tal.transactionline = transactionline.id
  AND tal.posting = 'T'
  AND tal.accounttype = 'AcctPay'
INNER JOIN account
  ON account.id = tal.account
WHERE transaction.type = 'Journal'
  AND transaction.id IN (${joinSuiteQlLiterals(journalIds)})
  AND account.acctnumber IN (${accountFilter})
GROUP BY
  transaction.id,
  transactionline.entity,
  tal.account
  `.trim()
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

    if (pageItems.length < SUITEQL_BATCH_LIMIT) {
      break
    }

    offset += pageItems.length
  }

  return items
}

async function applyVendorCreditToBill(
  client: NetSuiteClient,
  creditInternalId: string,
  summary: VendorBillSummaryRow,
  amount: number,
) {
  const creditResponse = await client.getRecord('vendorCredit', creditInternalId, {
    expandSubResources: true,
  })
  const creditRecord = getNullableRecord(creditResponse.json)
  const applyCollection = getNullableRecord(creditRecord?.apply)
  const applyItems = Array.isArray(applyCollection?.items) ? applyCollection.items : []
  const targetApplyLine = applyItems
    .map((item) => getNullableRecord(item))
    .find((item) => getReferenceId(item?.doc) === summary.internalId)

  if (!targetApplyLine) {
    throw new Error(
      `El vendor credit ${creditInternalId} no expone la factura ${summary.transactionNumber ?? summary.internalId} en la pestaña Apply.`,
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

  await client.patchRecord('vendorCredit', creditInternalId, patchPayload, { replace: 'apply' })
}

async function fetchVendorCreditState(client: NetSuiteClient, creditInternalId: string) {
  const response = await client.getRecord('vendorCredit', creditInternalId)
  const record = getNullableRecord(response.json)
  return {
    internalId: creditInternalId,
    documentNumber:
      getNullableString(record?.tranId) ?? getNullableString(record?.transactionNumber),
    availableAmount: normalizeMoneyMagnitude(getNullableNumber(record?.unapplied)),
  }
}

async function fetchVendorBillLiveState(
  client: NetSuiteClient,
  billInternalId: string,
): Promise<VendorBillLiveState> {
  const response = await client.getRecord('vendorBill', billInternalId)
  const record = getNullableRecord(response.json)
  const statusRecord = getNullableRecord(record?.status)
  return {
    internalId: billInternalId,
    documentNumber:
      getNullableString(record?.transactionNumber) ??
      getNullableString(record?.tranId) ??
      billInternalId,
    statusName:
      getNullableString(statusRecord?.refName) ?? getNullableString(statusRecord?.id),
    openAmount: normalizeMoneyMagnitude(getNullableNumber(record?.balance)),
  }
}

function applyLiveBalanceToVendorBillSummary(
  summary: VendorBillSummaryRow,
  liveState: VendorBillLiveState,
): VendorBillSummaryRow {
  if (liveState.openAmount === null) {
    return summary
  }

  return {
    ...summary,
    openAmount: liveState.openAmount,
  }
}

async function hydrateVendorBillSummariesWithLiveBalance(
  client: NetSuiteClient,
  summaries: VendorBillSummaryRow[],
) {
  if (summaries.length === 0) {
    return {
      rows: summaries,
      removedClosedCount: 0,
      rebalancedCount: 0,
    }
  }

  const liveStates = await mapWithConcurrency(
    summaries.map((summary) => summary.internalId),
    SUPPORT_QUERY_CONCURRENCY,
    async (billInternalId) => {
      try {
        return await fetchVendorBillLiveState(client, billInternalId)
      } catch (error) {
        console.warn(`Egresos: unable to load live balance for vendor bill ${billInternalId}.`, error)
        return null
      }
    },
  )
  const liveStateById = new Map(
    liveStates
      .filter((state): state is VendorBillLiveState => state !== null)
      .map((state) => [state.internalId, state]),
  )
  let removedClosedCount = 0
  let rebalancedCount = 0

  const rows = summaries.flatMap((summary) => {
    const liveState = liveStateById.get(summary.internalId)
    if (!liveState) {
      return [summary]
    }
    if ((liveState.openAmount ?? 0) <= OPEN_AMOUNT_TOLERANCE) {
      removedClosedCount += 1
      return []
    }
    if (!amountsMatchExactly(liveState.openAmount, summary.openAmount)) {
      rebalancedCount += 1
      return [applyLiveBalanceToVendorBillSummary(summary, liveState)]
    }
    return [summary]
  })

  return {
    rows,
    removedClosedCount,
    rebalancedCount,
  }
}

async function revalidateExactBillsAgainstLiveBalance(
  client: NetSuiteClient,
  billRows: VendorBillSummaryRow[],
  bills: EgresoBill[],
  supports: VendorSupportLive[],
): Promise<RevalidatedExactBillsResult> {
  const exactBills = bills.filter((bill) => bill.statusCode === 'E1')
  if (exactBills.length === 0) {
    return {
      bills,
      removedClosedCount: 0,
      rebalancedCount: 0,
    }
  }

  const summaryById = new Map(billRows.map((row) => [row.internalId, row]))
  const liveStates = await mapWithConcurrency(
    exactBills.map((bill) => bill.internalId),
    SUPPORT_QUERY_CONCURRENCY,
    async (billInternalId) => fetchVendorBillLiveState(client, billInternalId),
  )
  const liveStateById = new Map(liveStates.map((state) => [state.internalId, state]))
  let removedClosedCount = 0
  let rebalancedCount = 0

  let nextBills = bills.flatMap((bill) => {
    if (bill.statusCode !== 'E1') {
      return [bill]
    }

    const liveState = liveStateById.get(bill.internalId)
    if (!liveState) {
      return [bill]
    }

    if ((liveState.openAmount ?? 0) <= OPEN_AMOUNT_TOLERANCE) {
      removedClosedCount += 1
      return []
    }

    if (!amountsMatchExactly(liveState.openAmount, bill.openAmount)) {
      const summary = summaryById.get(bill.internalId)
      if (!summary) {
        return [bill]
      }

      rebalancedCount += 1
      return [classifyVendorBill(applyLiveBalanceToVendorBillSummary(summary, liveState), supports)]
    }

    return [bill]
  })

  const exactJournalSupportKeys = collectExactJournalSupportKeys(nextBills)
  if (exactJournalSupportKeys.size > 0) {
    const journalSupports = supports.filter(
      (support): support is VendorJournalSupportLive =>
        support.supportKind === 'journal' &&
        exactJournalSupportKeys.has(buildJournalSupportKey(support)),
    )
    if (journalSupports.length > 0) {
      const executionProfiles = await fetchJournalExecutionProfiles(client, journalSupports)
      if (executionProfiles.size > 0) {
        const hydratedSupportsById = new Map(
          applyJournalExecutionProfiles(journalSupports, executionProfiles).map((support) => [
            buildJournalSupportKey(support),
            support,
          ]),
        )
        const nextSupports = supports.map((support) => {
          if (support.supportKind !== 'journal') {
            return support
          }
          return hydratedSupportsById.get(buildJournalSupportKey(support)) ?? support
        })
        nextBills = nextBills.map((bill) => {
          if (bill.statusCode !== 'E1') {
            return bill
          }
          const summary = summaryById.get(bill.internalId)
          if (!summary) {
            return bill
          }
          const liveState = liveStateById.get(bill.internalId)
          const effectiveSummary = liveState
            ? applyLiveBalanceToVendorBillSummary(summary, liveState)
            : summary
          return classifyVendorBill(effectiveSummary, nextSupports)
        })
      }
    }
  }

  return {
    bills: nextBills,
    removedClosedCount,
    rebalancedCount,
  }
}

async function fetchJournalDebitSupportState(
  client: NetSuiteClient,
  journalInternalId: string,
  bill: VendorBillSummaryRow,
  targetAmount: number | null,
) {
  const response = await client.getRecord('journalEntry', journalInternalId, {
    expandSubResources: true,
  })
  const record = getNullableRecord(response.json)
  const lineCollection = getNullableRecord(record?.line)
  const lineItems = Array.isArray(lineCollection?.items) ? lineCollection.items : []
  const normalizedLines = lineItems
    .map((item) => getNullableRecord(item))
    .filter((line): line is Record<string, unknown> => line !== null)

  const exactMatchedLine = normalizedLines.find((line) => {
    const sameAccount = matchesByIdentity(
      bill.payableAccountId,
      getReferenceId(line.account),
      bill.payableAccountNumber ?? bill.payableAccountName,
      getNullableString(getNullableRecord(line.account)?.refName),
    )
    const sameEntity =
      !bill.supplierId || matchesByIdentity(bill.supplierId, getReferenceId(line.entity))
    return (
      sameAccount &&
      sameEntity &&
      amountsMatchExactly(getNullableNumber(line.debit), targetAmount) &&
      (getNullableNumber(line.credit) ?? 0) <= OPEN_AMOUNT_TOLERANCE
    )
  })

  if (!exactMatchedLine) {
    throw new Error(
      `El journal ${journalInternalId} ya no expone una linea AP deudora exacta para la factura ${bill.transactionNumber ?? bill.internalId}.`,
    )
  }

  return {
    internalId: journalInternalId,
    documentNumber:
      getNullableString(record?.tranId) ?? getNullableString(record?.transactionNumber),
    transactionDate: normalizeSuiteQlDate(getNullableString(record?.tranDate)),
    memo: getNullableString(record?.memo),
    matchedDebitLine: getNullableNumber(exactMatchedLine.line) ?? 0,
    amount: normalizeMoneyMagnitude(getNullableNumber(exactMatchedLine.debit)),
    payableAccountNumber: getNullableString(getNullableRecord(exactMatchedLine.account)?.refName)?.split(
      ' ',
    )[0] ?? bill.payableAccountNumber,
    payableAccountName:
      getNullableString(getNullableRecord(exactMatchedLine.account)?.refName) ??
      bill.payableAccountName,
    locationName: getNullableString(getNullableRecord(exactMatchedLine.location)?.refName),
  }
}

async function fetchJournalPreparationLinks(
  client: NetSuiteClient,
  billInternalId: string,
  journalInternalId: string,
) {
  const query = `
SELECT
  SUM(CASE WHEN PreviousTransactionLineLink.previousdoc = ${formatSuiteQlLiteral(billInternalId)} THEN 1 ELSE 0 END) AS billPaymentLinks,
  SUM(CASE WHEN PreviousTransactionLineLink.previousdoc = ${formatSuiteQlLiteral(journalInternalId)} THEN 1 ELSE 0 END) AS journalPaymentLinks
FROM PreviousTransactionLineLink
INNER JOIN transaction nextTran
  ON nextTran.id = PreviousTransactionLineLink.nextdoc
WHERE PreviousTransactionLineLink.linktype = 'Payment'
  AND nextTran.type = 'VendPymt'
  AND PreviousTransactionLineLink.previousdoc IN (
    ${formatSuiteQlLiteral(billInternalId)},
    ${formatSuiteQlLiteral(journalInternalId)}
  )
  `.trim()
  const rows = await fetchAllSuiteQlRows(client, query)
  const row = Object.fromEntries(
    Object.entries(rows[0] ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  ) as Record<string, unknown>

  return {
    billPaymentLinks: getNullableNumber(row.billpaymentlinks) ?? 0,
    journalPaymentLinks: getNullableNumber(row.journalpaymentlinks) ?? 0,
  }
}

function toVendorBillSummaryRow(row: Record<string, unknown>): VendorBillSummaryRow {
  return {
    internalId: getNullableString(row.internalid) ?? '',
    tranId: getNullableString(row.tranid),
    transactionNumber: getNullableString(row.transactionnumber),
    transactionDate: normalizeSuiteQlDate(getNullableString(row.transactiondate)),
    dueDate: normalizeSuiteQlDate(getNullableString(row.duedate)),
    supplierId: getNullableString(row.supplierid),
    supplierName: getNullableString(row.suppliername),
    postingPeriodId: getNullableString(row.postingperiodid),
    postingPeriodName: getNullableString(row.postingperiodname),
    currencyId: getNullableString(row.currencyid),
    currencyName: getNullableString(row.currencyname),
    payableAccountId: getNullableString(row.payableaccountid),
    payableAccountNumber: getNullableString(row.payableaccountnumber),
    payableAccountName: getNullableString(row.payableaccountname),
    memo: getNullableString(row.memo),
    total: normalizeMoneyMagnitude(getNullableNumber(row.total)),
    openAmount: normalizeMoneyMagnitude(getNullableNumber(row.openamount)),
  }
}

function toVendorCreditSummaryRow(row: Record<string, unknown>): VendorCreditSummaryRow {
  return {
    internalId: getNullableString(row.internalid) ?? '',
    tranId: getNullableString(row.tranid),
    transactionNumber: getNullableString(row.transactionnumber),
    transactionDate: normalizeSuiteQlDate(getNullableString(row.transactiondate)),
    postingPeriodId: getNullableString(row.postingperiodid),
    postingPeriodName: getNullableString(row.postingperiodname),
    supplierId: getNullableString(row.supplierid),
    supplierName: getNullableString(row.suppliername),
    currencyId: getNullableString(row.currencyid),
    currencyName: getNullableString(row.currencyname),
    payableAccountId: getNullableString(row.payableaccountid),
    payableAccountNumber: getNullableString(row.payableaccountnumber),
    payableAccountName: getNullableString(row.payableaccountname),
    total: normalizeMoneyMagnitude(getNullableNumber(row.total)),
  }
}

function toVendorJournalSupportRow(row: Record<string, unknown>): VendorJournalSupportRow {
  return {
    internalId: getNullableString(row.internalid) ?? '',
    tranId: getNullableString(row.tranid),
    transactionNumber: getNullableString(row.transactionnumber),
    transactionDate: normalizeSuiteQlDate(getNullableString(row.transactiondate)),
    postingPeriodId: getNullableString(row.postingperiodid),
    postingPeriodName: getNullableString(row.postingperiodname),
    supplierId: getNullableString(row.supplierid),
    supplierName: getNullableString(row.suppliername),
    currencyId: getNullableString(row.currencyid),
    currencyName: getNullableString(row.currencyname),
    payableAccountId: getNullableString(row.payableaccountid),
    payableAccountNumber: getNullableString(row.payableaccountnumber),
    payableAccountName: getNullableString(row.payableaccountname),
    availableAmount: normalizeMoneyMagnitude(getNullableNumber(row.availableamount)),
    journalExecutionMode: 'unknown',
    journalExecutionReason:
      'No se ha calculado todavia el perfil operativo del journal en esta lectura.',
  }
}

function toJournalPayableLineProfileRow(row: Record<string, unknown>): JournalPayableLineProfileRow {
  return {
    journalId: getNullableString(row.journalid) ?? '',
    supplierId: getNullableString(row.supplierid),
    payableAccountId: getNullableString(row.payableaccountid),
    debitAmount: normalizeMoneyMagnitude(getNullableNumber(row.debitamount)),
    creditAmount: normalizeMoneyMagnitude(getNullableNumber(row.creditamount)),
  }
}

function sortSupportsForBill(
  bill: VendorBillSummaryRow,
  billAmount: number | null,
  supports: VendorSupportLive[],
) {
  return [...supports].sort((left, right) => {
    const leftScore = getSupportSortScore(bill, billAmount, left)
    const rightScore = getSupportSortScore(bill, billAmount, right)
    if (leftScore !== rightScore) {
      return leftScore - rightScore
    }

    return getComparableDateValue(right.transactionDate) - getComparableDateValue(left.transactionDate)
  })
}

function getSupportSortScore(
  bill: VendorBillSummaryRow,
  billAmount: number | null,
  support: VendorSupportLive,
) {
  const samePeriodPenalty = isSamePeriod(bill, support) ? 0 : 10
  const supportKindPenalty = support.supportKind === 'vendor-credit' ? 0 : 3
  const difference = Math.abs((support.availableAmount ?? Number.MAX_SAFE_INTEGER) - (billAmount ?? 0))
  return samePeriodPenalty + supportKindPenalty + difference
}

function getBillConciliationTargetAmount(
  bill: Pick<VendorBillSummaryRow, 'total' | 'openAmount'> | Pick<EgresoBillBase, 'total' | 'openAmount'>,
) {
  if ((bill.total ?? 0) > OPEN_AMOUNT_TOLERANCE) {
    return normalizeMoneyMagnitude(bill.total)
  }

  return normalizeMoneyMagnitude(bill.openAmount)
}

function getBillExecutionAmount(
  bill: Pick<VendorBillSummaryRow, 'total' | 'openAmount'> | Pick<EgresoBillBase, 'total' | 'openAmount'>,
) {
  return getBillConciliationTargetAmount(bill)
}

function isDirectCreditApplicationReady(
  bill: Pick<EgresoBillBase, 'total' | 'openAmount'>,
  candidate: Pick<EgresoSupportCandidate, 'supportSource' | 'matchedDocumentCount' | 'availableAmount' | 'exactAmountMatch'>,
) {
  if (
    candidate.supportSource !== 'vendor-credit' ||
    candidate.matchedDocumentCount !== 1 ||
    !candidate.exactAmountMatch
  ) {
    return false
  }

  return amountsMatchExactly(candidate.availableAmount, getBillExecutionAmount(bill))
}

function matchesStoredConciliationRecord(
  bill: EgresoBill,
  candidate: EgresoSupportCandidate | null,
  record: ReturnType<typeof listActiveEgresoConciliations>[number],
) {
  if (!candidate) {
    return false
  }

  return (
    record.billInternalId === bill.internalId &&
    record.supportInternalId === candidate.internalId &&
    record.supportSource === candidate.supportSource &&
    amountsMatchExactly(record.billTargetAmount, getBillConciliationTargetAmount(bill)) &&
    amountsMatchExactly(record.supportAmount, candidate.availableAmount)
  )
}

function filterStoredReconciledBills(bills: EgresoBill[]) {
  const records = listActiveEgresoConciliations()
  if (records.length === 0) {
    return {
      bills,
      hiddenCount: 0,
    }
  }

  const recordsByBillId = new Map<string, typeof records>()
  for (const record of records) {
    const current = recordsByBillId.get(record.billInternalId) ?? []
    current.push(record)
    recordsByBillId.set(record.billInternalId, current)
  }

  const visibleBills = bills.filter((bill) => {
    const billRecords = recordsByBillId.get(bill.internalId)
    if (!billRecords || billRecords.length === 0) {
      return true
    }

    const candidate = bill.creditCandidates[0] ?? null
    return !billRecords.some((record) => matchesStoredConciliationRecord(bill, candidate, record))
  })

  return {
    bills: visibleBills,
    hiddenCount: bills.length - visibleBills.length,
  }
}

function resolveBestDocumentNumber(
  transactionNumber: string | null,
  tranId: string | null,
  fallback: string,
) {
  return transactionNumber ?? tranId ?? fallback
}

function normalizeSuiteQlDate(value: string | null) {
  if (!value) {
    return null
  }

  const dottedMatch = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (dottedMatch) {
    const [, day, month, year] = dottedMatch
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return parsed.toISOString().slice(0, 10)
}

function getCreditWindowStartDate(bills: VendorBillSummaryRow[]) {
  const comparableDates = bills
    .map((bill) => bill.transactionDate)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(`${value}T12:00:00Z`))
    .filter((value) => !Number.isNaN(value.getTime()))

  if (comparableDates.length === 0) {
    return null
  }

  const oldestDate = new Date(
    Math.min(...comparableDates.map((value) => value.getTime())),
  )
  oldestDate.setUTCDate(oldestDate.getUTCDate() - 365)
  return oldestDate.toISOString().slice(0, 10)
}

function normalizePageValue(rawValue: unknown, fallback: number, max: number) {
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.max(0, Math.min(max, Math.trunc(parsed)))
}

function normalizeMoneyMagnitude(value: number | null) {
  if (value === null) {
    return null
  }

  return Math.abs(value)
}

function isSamePeriod(
  bill: Pick<VendorBillSummaryRow, 'postingPeriodId' | 'postingPeriodName'>,
  support: Pick<VendorSupportLive, 'postingPeriodId' | 'postingPeriodName'>,
) {
  return matchesByIdentity(
    bill.postingPeriodId,
    support.postingPeriodId,
    bill.postingPeriodName,
    support.postingPeriodName,
  )
}

function isSamePayableAccount(
  bill: Pick<VendorBillSummaryRow, 'payableAccountId' | 'payableAccountNumber' | 'payableAccountName'>,
  support: Pick<VendorSupportLive, 'payableAccountId' | 'payableAccountNumber' | 'payableAccountName'>,
) {
  return matchesByIdentity(
    bill.payableAccountId,
    support.payableAccountId,
    bill.payableAccountNumber ?? bill.payableAccountName,
    support.payableAccountNumber ?? support.payableAccountName,
  )
}

function amountsMatchExactly(left: number | null, right: number | null) {
  if (left === null || right === null) {
    return false
  }

  return Math.abs(left - right) <= OPEN_AMOUNT_TOLERANCE
}

function toMoneyCents(value: number) {
  return Math.round(value * 100)
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

function isOverdue(dueDate: string | null) {
  if (!dueDate) {
    return false
  }

  const parsed = new Date(`${dueDate}T12:00:00Z`)
  if (Number.isNaN(parsed.getTime())) {
    return false
  }

  const now = new Date()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const due = Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())

  return due < today
}

function sumAmount(values: Array<number | null | undefined>) {
  return values.reduce<number>(
    (total, value) => total + (typeof value === 'number' ? value : 0),
    0,
  )
}

function uniqueValues(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
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

function getComparableDateValue(value: string | Date | null) {
  if (!value) {
    return 0
  }

  const parsed = value instanceof Date ? value : new Date(`${value}T12:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime()
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
    return trimmed.length > 0 ? trimmed : null
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
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function getNullableBoolean(value: unknown) {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === 't') {
      return true
    }
    if (normalized === 'false' || normalized === 'f') {
      return false
    }
  }

  return null
}

function getReferenceId(value: unknown) {
  const record = getNullableRecord(value)
  if (!record) {
    return null
  }

  return (
    getNullableString(record.id) ??
    getNullableString(record.internalId) ??
    getNullableString(record.value)
  )
}

function normalizeOptionalString(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function formatCountLabel(total: number, singular: string) {
  return total === 1 ? `1 ${singular}` : `${total} ${singular}s`
}

function formatSupportDocumentCountLabel(total: number) {
  return total === 1 ? '1 soporte AP' : `${total} soportes AP`
}

function formatMoneyValue(value: number | null | undefined) {
  if (typeof value !== 'number') {
    return '--'
  }

  return value.toFixed(2)
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
) {
  if (items.length === 0) {
    return []
  }

  const results = new Array<TOutput>(items.length)
  const workerCount = Math.max(1, Math.min(concurrency, items.length))
  let currentIndex = 0

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (currentIndex < items.length) {
        const index = currentIndex
        currentIndex += 1
        results[index] = await mapper(items[index], index)
      }
    }),
  )

  return results
}
