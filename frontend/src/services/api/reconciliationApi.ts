import { createHttpClient, HttpClientError } from './httpClient'

function resolveDefaultApiBaseUrl() {
  if (typeof window === 'undefined') {
    return 'http://127.0.0.1:3001/api'
  }

  return `${window.location.origin}/api`
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? resolveDefaultApiBaseUrl()
const httpClient = createHttpClient({ baseUrl: apiBaseUrl })

export const netsuiteOAuthLoginUrl = `${apiBaseUrl.replace(/\/+$/, '')}/auth/netsuite/login`

export type OverviewResponse = {
  health: string
  pendingReceipts: number
  readyToApply: number
  needsReview: number
  totalRules: number
  lastSyncUtc: string
  inventory?: {
    inboundLoads: number
    activePickWaves: number
    cycleCountTasks: number
    criticalAlerts: number
    occupancyRate: number
    stagingUtilizationRate: number
    reserveUtilizationRate: number
    pickAccuracyRate: number
    dispatchReadinessRate: number
    recommendedLens: 'recepcion' | 'surtido' | 'conteos' | 'control'
  }
}

export type SatStatusResponse = {
  checkedAtUtc: string
  configured: boolean
  canTestAuth: boolean
  validationError: string | null
  missing: string[]
  endpoint: string
  files: {
    certPath: string | null
    keyPath: string | null
    passwordSource: 'file' | 'inline' | 'none'
    passwordFilePath: string | null
  }
  certificate: {
    rfc: string | null
    serialNumber: string | null
    issuerName: string | null
    subject: string | null
    issuer: string | null
    validFrom: string | null
    validTo: string | null
  } | null
}

export type SatAuthTestResponse = {
  success: true
  testedAtUtc: string
  latencyMs: number
  endpoint: string
  certificate: {
    rfc: string
    serialNumber: string
    issuerName: string
  }
  token: {
    createdAtUtc: string
    expiresAtUtc: string
    isValid: boolean
  }
}

export type SatStatusCode = {
  code: number
  message: string
  accepted: boolean
}

export type SatCfdiDownloadType = 'issued' | 'received'

export type SatCfdiRequestType = 'xml' | 'metadata'

export type SatCfdiDocumentStatus = 'undefined' | 'active' | 'cancelled'

export type SatCfdiDocumentType =
  | 'undefined'
  | 'ingreso'
  | 'egreso'
  | 'traslado'
  | 'nomina'
  | 'pago'

export type SatCfdiRequestPayload = {
  startAt?: string | null
  endAt?: string | null
  downloadType: SatCfdiDownloadType
  requestType: SatCfdiRequestType
  documentType?: SatCfdiDocumentType
  documentStatus?: SatCfdiDocumentStatus
  uuid?: string | null
  rfcMatch?: string | null
}

export type SatCfdiRequestResponse = {
  success: boolean
  requestedAtUtc: string
  endpoint: string
  requestId: string
  status: SatStatusCode
  parameters: {
    period: {
      startAtUtc: string
      endAtUtc: string
    } | null
    downloadType: SatCfdiDownloadType
    requestType: SatCfdiRequestType
    documentType: SatCfdiDocumentType
    documentStatus: SatCfdiDocumentStatus
    uuid: string | null
    rfcMatch: string | null
  }
}

export type SatCfdiVerifyResponse = {
  success: true
  checkedAtUtc: string
  endpoint: string
  requestId: string
  status: SatStatusCode
  statusRequest: {
    id: string
    value: number | null
    message: string
  }
  codeRequest: {
    id: string
    value: number | null
    message: string
  }
  numberCfdis: number
  readyToDownload: boolean
  packages: Array<{
    packageId: string
    inspectPath: string
    downloadPath: string
  }>
}

export type SatCfdiPackageInspectResponse = {
  success: boolean
  downloadedAtUtc: string
  endpoint: string
  packageId: string
  status: SatStatusCode
  package: {
    filename: string
    encoding: 'binary' | 'base64'
    byteLength: number
    characterLength: number
    zipSignatureDetected: boolean
    inspection: {
      fileCount: number
      xmlCount: number
      metadataCount: number
      samples: Array<{
        name: string
        sizeBytes: number
        uuid: string | null
      }>
      error?: string
    } | null
  }
}

export type SatDownloadHistoryResponse = {
  generatedAtUtc: string
  storePath: string
  packageCacheDir: string
  totalPackages: number
  totalCfdis: number
  records: Array<{
    packageId: string
    filename: string
    firstDownloadedAtUtc: string
    lastDownloadedAtUtc: string
    lastSeenAtUtc: string
    byteLength: number
    characterLength: number
    zipSignatureDetected: boolean
    status: SatStatusCode
    fileCount: number
    xmlCount: number
    metadataCount: number
    cfdis: Array<{
      fileName: string
      sizeBytes: number
      uuid: string | null
      fecha: string | null
      serie: string | null
      folio: string | null
      emisorNombre: string | null
      emisorRfc: string | null
      receptorNombre: string | null
      receptorRfc: string | null
      subtotal: number | null
      total: number | null
      moneda: string | null
    }>
    metadataFiles: Array<{
      name: string
      sizeBytes: number
    }>
    otherFiles: Array<{
      name: string
      sizeBytes: number
    }>
  }>
}

export type SatAnalysisNetSuiteMatch = {
  internalId: string
  transactionNumber: string | null
  tranId: string | null
  vendorName: string | null
  transactionDate: string | null
  total: number | null
  currencyName: string | null
  matchType: 'uuid-field' | 'tranid' | 'externalid'
}

export type SatAnalysisItem = {
  packageId: string
  fileName: string
  uuid: string | null
  fecha: string | null
  serie: string | null
  folio: string | null
  emisorNombre: string | null
  emisorRfc: string | null
  receptorNombre: string | null
  receptorRfc: string | null
  subtotal: number | null
  total: number | null
  moneda: string | null
  packageDownloadedAtUtc: string | null
  netsuiteMatches: SatAnalysisNetSuiteMatch[]
  createdAtUtc: string
  updatedAtUtc: string
}

export type SatProcessedItem = SatAnalysisItem & {
  processedReason: 'already_in_netsuite' | 'uploaded_to_netsuite'
  processedAtUtc: string
}

export type SatManualHomologationProviderOverride = {
  id: string
  matchBy: 'name' | 'rfc'
  matchValue: string
  normalizedMatchValue: string
  proveedorNetsuite: string
  supplierInternalId: string | null
  cc: string
  ccInternalId: string | null
  createdAtUtc: string
  updatedAtUtc: string
}

export type SatManualHomologationAccountOverride = {
  id: string
  claveProdServ: string
  normalizedClaveProdServ: string
  cuentaGastos: string
  accountInternalId: string | null
  createdAtUtc: string
  updatedAtUtc: string
}

export type SatManualHomologationStoreResponse = {
  generatedAtUtc: string
  storePath: string
  providerOverrides: SatManualHomologationProviderOverride[]
  accountOverrides: SatManualHomologationAccountOverride[]
  counts: {
    providerOverrides: number
    accountOverrides: number
  }
}

export type SatManualProviderHomologationSaveRequest = {
  nombreEmisor?: string | null
  emisorRfc?: string | null
  saveByName?: boolean
  saveByRfc?: boolean
  supplierInternalId?: string | null
  supplierDisplayName?: string | null
  ccDisplayName?: string | null
  ccInternalId?: string | null
}

export type SatManualProviderHomologationSaveResponse = {
  success: true
  savedAtUtc: string
  supplier: {
    internalId: string
    displayName: string
    rfc: string
  }
  account: {
    internalId: string
    displayName: string
  }
  overrides: SatManualHomologationProviderOverride[]
  store: SatManualHomologationStoreResponse
}

export type SatManualAccountHomologationSaveRequest = {
  claveProdServ?: string | null
  accountDisplayName?: string | null
  accountInternalId?: string | null
}

export type SatManualAccountHomologationSaveResponse = {
  success: true
  savedAtUtc: string
  override: SatManualHomologationAccountOverride
  store: SatManualHomologationStoreResponse
}

export type SatAnalysisWindow = {
  id: string
  label: string
  status: 'pending_sat' | 'ready'
  requestId: string | null
  subset: {
    startAtUtc: string
    endAtUtc: string
    downloadType: 'received'
    requestType: 'xml'
    documentType: 'ingreso'
    documentStatus: 'active'
  }
  packageIds: string[]
  analysisItems: SatAnalysisItem[]
  processedItems: SatProcessedItem[]
  createdAtUtc: string
  updatedAtUtc: string
  lastSatSyncAtUtc: string | null
  lastNetSuiteSyncAtUtc: string | null
}

export type SatAnalysisWorkflowSuggestedExtraction = {
  startAtUtc: string
  endAtUtc: string
  startDate: string
  endDate: string
  basis: 'latest_window_overlap' | 'current_month_fallback'
  overlapDays: number
  sourceWindowId: string | null
  sourceWindowEndAtUtc: string | null
}

export type SatAnalysisWindowsResponse = {
  generatedAtUtc: string
  storePath: string
  windows: SatAnalysisWindow[]
  workflow: {
    overlapDays: number
    latestWindow: {
      id: string
      label: string
      status: SatAnalysisWindow['status']
      startAtUtc: string
      endAtUtc: string
      updatedAtUtc: string
      lastSatSyncAtUtc: string | null
      lastNetSuiteSyncAtUtc: string | null
    } | null
    suggestedExtraction: SatAnalysisWorkflowSuggestedExtraction
  }
}

export type SatAnalysisWindowBootstrapPayload = {
  startAtUtc: string
  endAtUtc: string
}

export type SatAnalysisInvoiceUploadResponse = {
  success: true
  dryRun: boolean
  created: boolean
  skippedReason: 'duplicate' | null
  executedAtUtc: string
  windowId: string
  packageId: string
  uuid: string | null
  duplicateMatches: SatCfdiNetsuitePreviewResponse['invoices'][number]['duplicateMatches']
  createdRecord?: {
    internalId: string
    tranId: string | null
    transactionNumber: string | null
    total: number | null
    currencyName: string | null
    vendorName: string | null
    tranDate: string | null
  }
  analysisWindow?: {
    id: string
    analysisItems: number
    processedItems: number
  }
  message: string
}

export type SatCfdiNetsuitePreviewResponse = {
  success: true
  generatedAtUtc: string
  packageId: string
  workbook: {
    path: string
    warnings: string[]
    accountMappings: number
    providerNameMappings: number
    providerRfcMappings: number
  }
  summary: {
    xmlFiles: number
    parsedInvoices: number
    outputLines: number
    normalLineCount: number
    discountLineCount: number
    retentionLineCount: number
    readyInvoices: number
    manualHomologationInvoices: number
    missingExpenseAccountLines: number
    unknownRetentionRateLines: number
    invoicesWithDifferenceWarning: number
    exactDuplicateInvoices: number
    possibleDuplicateInvoices: number
  }
  invoices: Array<{
    uuid: string | null
    fileName: string
    fecha: string | null
    serieFolio: string | null
    nombreEmisor: string | null
    rfcEmisor: string | null
    proveedorNetsuite: string | null
    providerMatchSource: 'name' | 'rfc' | 'manual'
    duplicateStatus: 'clear' | 'exact' | 'possible'
    duplicateMatches: Array<{
      internalId: string
      transactionNumber: string | null
      tranId: string | null
      vendorName: string | null
      transactionDate: string | null
      total: number | null
      currencyName: string | null
      memo: string | null
      otherRefNum: string | null
      externalId: string | null
      mxCfdiUuid: string | null
      inboundUuid: string | null
      matchType: 'uuid-field' | 'tranid' | 'externalid' | 'possible'
    }>
    cc: string | null
    moneda: string
    tipoCambio: number
    subtotalXml: number
    descuentoXml: number
    totalXml: number
    lineTotalPreview: number
    differenceVsXmlTotal: number
    normalLineCount: number
    discountLineCount: number
    retentionLineCount: number
    totalLineCount: number
    readyToImport: boolean
    issues: string[]
  }>
  rows: Array<{
    rowId: string
    uuid: string | null
    conceptIndex: number
    lineType: 'normal' | 'discount' | 'retention' | 'ieps'
    fecha: string | null
    serieFolio: string | null
    claveProdServ: string | null
    cuentaGastos: string | null
    descripcion: string | null
    nombreEmisor: string | null
    rfcEmisor: string | null
    proveedorNetsuite: string | null
    importe: number
    importeTraslado: number
    monto: number
    ivaTipo: string
    cc: string | null
    tipoCambio: number
    moneda: string
    descuento: number
    providerMatchSource: 'name' | 'rfc' | 'manual'
    retentionRate: number | null
    issues: string[]
  }>
}

export type RuleConfig = {
  amountTolerance: number
  percentTolerance: number
  exactMatchTolerance: number
  daysWindow: number
  requireSameSubsidiary: boolean
  requireSameArAccount: boolean
  allowManyToOne: boolean
  maxInvoiceCombinationSize: number
  allowCrossPeriodAutoAdjustment: boolean
  minimumConfidenceGap: number
}

export type ReceiptRecord = {
  id: string
  customerId: string
  subsidiaryId?: string
  arAccountId: string
  currency: string
  amount: number
  transactionDate: string
  postingPeriod: string
  reference?: string
  memo?: string
}

export type InvoiceRecord = {
  id: string
  documentNumber?: string
  customerId: string
  subsidiaryId?: string
  arAccountId: string
  currency: string
  openAmount: number
  transactionDate: string
  postingPeriod: string
}

export type PreviewDecision = {
  receiptId: string
  action: string
  stage: string
  matchedInvoiceIds: string[]
  confidence: number
  amountDifference: number
  requiresAdjustment: boolean
  requiresPeriodAdjustment: boolean
  reasons: string[]
  nextStep: string
}

export type PreviewPayloadRequest = {
  rules?: Partial<RuleConfig>
  receipts: ReceiptRecord[]
  invoices: InvoiceRecord[]
}

export type PreviewResponse = {
  rules: RuleConfig
  decisions: PreviewDecision[]
}

export type SearchTransactionEntityKind = 'supplier' | 'customer'

export type SearchTransactionTypeId = 'invoice'

export type SearchTransactionsBootstrapResponse = {
  generatedAtUtc: string
  entityKinds: Array<{
    id: SearchTransactionEntityKind
    label: string
  }>
  transactionTypes: Array<{
    id: SearchTransactionTypeId
    label: string
    description: string
    supportedEntityKinds: SearchTransactionEntityKind[]
  }>
  postingPeriods: Array<{
    internalId: string
    name: string
    startDate: string | null
    endDate: string | null
  }>
}

export type SearchTransactionEntityOptionsResponse = {
  generatedAtUtc: string
  entityKind: SearchTransactionEntityKind
  entityLabel: string
  count: number
  items: Array<{
    internalId: string
    displayName: string
    entityId: string | null
    altName: string | null
    companyName: string | null
    rfc: string | null
  }>
}

export type SearchTransactionsRequest = {
  entityKind: SearchTransactionEntityKind
  transactionTypeId: SearchTransactionTypeId
  postingPeriodStartId: string
  postingPeriodEndId: string
  entityInternalId?: string | null
  limit?: number
}

export type SearchTransactionsResponse = {
  generatedAtUtc: string
  filters: {
    entityKind: SearchTransactionEntityKind
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
  results: Array<{
    internalId: string
    recordType: 'invoice' | 'vendorBill'
    entityKind: SearchTransactionEntityKind
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
    satLineCodes: Array<{
      lineNumber: number
      source: 'item' | 'expense'
      satCode: string | null
      description: string | null
      subtotalBeforeTax: number | null
      taxes: number | null
      totalWithTax: number | null
    }>
  }>
}

export type AuditResponse = {
  items: Array<{
    id: string
    timestampUtc: string
    actor: string
    message: string
  }>
}

export type PolicyResponse = {
  policy: {
    name: string
    description: string
    autoApplyCriteria: string[]
    reviewCriteria: string[]
    blockedCriteria: string[]
  }
}

export type RuleDefinitionsResponse = {
  items: Array<{
    code: string
    title: string
    definition: string
  }>
}

export type FacturaResumenTipoTransaccion = {
  code: string
  title: string
  definition: string
  total: number
  actionLabel?: string | null
}

export type ExampleScenariosResponse = {
  rules: RuleConfig
  examples: Array<{
    id: string
    title: string
    summary: string
    receipt: ReceiptRecord
    candidateInvoices: InvoiceRecord[]
    ruleChecks: Array<{
      label: string
      status: 'pass' | 'watch' | 'block'
      detail: string
    }>
    decision: PreviewDecision
  }>
}

export type NetSuiteAnalysisQueryId = 'openInvoices' | 'arJournalCandidates' | 'postingPeriods'

export type NetSuiteAnalysisQueryDefinition = {
  id: NetSuiteAnalysisQueryId
  title: string
  purpose: string
  limit: number
  query: string
}

export type NetSuiteAnalysisQueryResult = NetSuiteAnalysisQueryDefinition & {
  status: 'ok' | 'error'
  statusCode?: number
  totalResults?: number
  count?: number
  items?: Array<Record<string, unknown>>
  error?: string
}

export type NetSuiteAnalysisBootstrapResponse = {
  readOnly: true
  generatedAtUtc: string
  queries: NetSuiteAnalysisQueryResult[]
}

export type NetSuiteAuthStatusResponse = {
  authMode: string
  oauth2: {
    configured: boolean
    connected: boolean
    redirectUri?: string
    scopes: string[]
    authorizationPath: string
    frontendReturnUrl?: string
    accessTokenExpiresAt?: string
    refreshTokenExpiresAt?: string
  }
  tbaConfigured: boolean
}

export type NetSuiteEntityCatalogKind = 'customers' | 'suppliers'

export type NetSuiteEntityCatalogItem = {
  internalId: string
  recordType: 'customer' | 'vendor'
  entityId: string
  altName: string
  companyName: string
  displayName: string
  rfc: string
  accountDisplayName: string | null
}

export type NetSuiteEntityCatalogResponse = {
  generatedAtUtc: string
  kind: NetSuiteEntityCatalogKind
  label: string
  source: 'store' | 'netsuite_sync' | 'empty'
  storePath: string
  lastSyncedAtUtc: string | null
  count: number
  items: NetSuiteEntityCatalogItem[]
}

export type EgresoStatusTone = 'ready' | 'review' | 'period-review' | 'exception'

export type EgresoOperationalCode = 'E1C' | 'E1J' | 'E1M' | 'E1R' | 'E1X'

export type EgresoConciliationLane =
  | 'exact'
  | 'with-gap'
  | 'cross-period'
  | 'without-support'

export type EgresoConciliationActionCode =
  | 'apply-credit'
  | 'resolve-gap'
  | 'review-prepayment'
  | 'trace-payment'
  | 'review-period'
  | 'escalate-treasury'
  | 'review-manual'

export type EgresoSupportSource =
  | 'vendor-credit'
  | 'journal'
  | 'payment'
  | 'prepayment'
  | 'mixed'

export type EgresoSupportCandidate = {
  internalId: string
  documentNumber: string | null
  transactionType: string
  supportSource: EgresoSupportSource
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

export type EgresoConciliation = {
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

export type EgresoResumenTipoTransaccion = {
  code: string
  title: string
  definition: string
  total: number
  sampleDocumentNumber: string | null
}

export type EgresoBill = {
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
  statusCode: string
  statusLabel: string
  statusTone: EgresoStatusTone
  statusReason: string
  operationalCode: EgresoOperationalCode | null
  operationalLabel: string | null
  operationalReason: string | null
  dueStatus: 'vigente' | 'vencida'
  memo: string | null
  creditCandidates: EgresoSupportCandidate[]
  conciliation: EgresoConciliation
}

export type EgresosBootstrapResponse = {
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
  transactionTypes: EgresoResumenTipoTransaccion[]
  bills: EgresoBill[]
}

export type EgresosExactReadyOverviewResponse = {
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

export type ApplyEgresoExactCreditResponse = {
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

export type PrepareEgresoExactJournalResponse = {
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

export type ReconcileEgresoExactSupportResponse = {
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

export type FacturaEstado = 'abierta' | 'cerrada'

export type FacturaSituacionCobro = 'pendiente' | 'parcial' | 'pagada' | 'conciliada'

export type FacturaSituacionColor = 'green' | 'neutral'

export type FacturaAplicacionCandidata = {
  id: string
  documento: string | null
  tipoTransaccion: string | null
  clienteId: string | null
  clienteNombre: string | null
  fecha: string | null
  periodoContableId: string | null
  periodoContableNombre: string | null
  monedaId: string | null
  moneda: string | null
  montoCredito: number | null
  montoAplicado: number | null
  montoDisponible: number | null
  cumplePpd1: boolean
  cumpleA1: boolean
  cumpleA2: boolean
  cumpleA3: boolean
}

export type FacturaA4Invoice = {
  internalId: string
  documento: string | null
  fecha: string | null
  total: number | null
  saldoAbierto: number | null
}

export type FacturaN1Context = {
  facturaAnticipoInternalId: string
  facturaAnticipoDocumento: string | null
  facturaAnticipoFecha: string | null
  facturaAnticipoPeriodoContableId: string | null
  facturaAnticipoPeriodoContableNombre: string | null
  facturaAnticipoTotal: number | null
  facturaAnticipoMetodoPagoId: string | null
  facturaAnticipoMetodoPagoNombre: string | null
  pagoTransactionId: string
  pagoDocumento: string | null
  pagoTipoTransaccion: string | null
  pagoFecha: string | null
  pagoPeriodoContableId: string | null
  pagoPeriodoContableNombre: string | null
  pagoCuentaBancoId: string | null
  pagoCuentaBancoNombre: string | null
  pagoAplicadoMonto: number | null
  notaCreditoId: string | null
  notaCreditoDocumento: string | null
  notaCreditoFecha: string | null
  notaCreditoEstadoId: string | null
  notaCreditoEstadoNombre: string | null
}

export type FacturaA4Context = {
  groupKey: string
  salesOrderInternalId: string
  salesOrderDocument: string | null
  salesOrderTotal: number | null
  customerId: string
  customerName: string | null
  postingPeriodId: string
  postingPeriodName: string | null
  currencyId: string
  currencyName: string | null
  groupTotal: number
  invoiceCount: number
  invoices: FacturaA4Invoice[]
  creditTransactionId: string
  creditDocument: string | null
  creditType: string | null
  creditDate: string | null
  creditPeriodId: string | null
  creditPeriodName: string | null
  creditAmount: number | null
  creditAvailableAmount: number | null
  creditRemainingAfterGroup: number | null
}

export type FacturaA8Context = {
  bucketKey: string
  customerId: string
  customerName: string | null
  postingPeriodId: string
  postingPeriodName: string | null
  currencyId: string
  currencyName: string | null
  groupTotal: number
  invoiceCount: number
  invoices: FacturaA4Invoice[]
  creditTransactionId: string
  creditDocument: string | null
  creditType: string | null
  creditDate: string | null
  creditPeriodId: string | null
  creditPeriodName: string | null
  creditAmount: number | null
  creditAvailableAmount: number | null
  creditRemainingAfterInvoice: number | null
}

export type FacturaKContext = {
  status: 'matched' | 'pending_journal' | 'pending_invoice' | 'manual_review'
  requiresManualIntervention: boolean
  manualReason: string | null
  recognitionKey: string
  orderId: string
  transferId: string | null
  transferIdFragment: string | null
  transferDate: string | null
  transferAmount: number | null
  transferCurrency: string | null
  groupedOrderCount: number
  groupedOrderIds: string[]
  groupedGrossAmount: number | null
  groupedCommissionAmount: number | null
  groupedNetDisbursementAmount: number | null
  kontempoCustomerId: string | null
  kontempoBuyerId: string | null
  companyName: string | null
  customerName: string | null
  netsuiteCustomerId: string
  netsuiteCustomerName: string
  invoiceInternalId: string
  invoiceDocument: string | null
  invoiceDate: string | null
  invoiceAmount: number | null
  salesOrderInternalId: string | null
  salesOrderDocument: string | null
  salesOrderDate: string | null
  salesOrderAmount: number | null
  orderGrossAmount: number | null
  orderCommissionAmount: number | null
  orderNetDisbursementAmount: number | null
  journalTransactionId: string | null
  journalDocument: string | null
  journalDate: string | null
  journalPeriodId: string | null
  journalPeriodName: string | null
  journalAmount: number | null
  journalMemo: string | null
  matchedInvoiceInternalIds: string[]
  matchedInvoiceDocuments: Array<string | null>
}

export type FacturaB1Context = {
  customerId: string
  customerName: string | null
  invoicePeriodId: string
  invoicePeriodName: string | null
  currencyId: string
  currencyName: string | null
  targetAmount: number
  bridgeBankAccountId: string | null
  bridgeBankAccountName: string | null
  originalCreditTransactionId: string
  originalCreditDocument: string | null
  originalCreditType: string | null
  originalCreditDate: string | null
  originalCreditPeriodId: string | null
  originalCreditPeriodName: string | null
  originalCreditAmount: number | null
  originalCreditAppliedAmount: number | null
  originalCreditAvailableAmount: number | null
}

export type FacturaB3Context = {
  groupKey: string
  salesOrderInternalId: string
  salesOrderDocument: string | null
  salesOrderTotal: number | null
  customerId: string
  customerName: string | null
  invoicePeriodId: string
  invoicePeriodName: string | null
  currencyId: string
  currencyName: string | null
  groupTotal: number
  invoiceCount: number
  invoices: FacturaA4Invoice[]
  bridgeBankAccountId: string | null
  bridgeBankAccountName: string | null
  originalCreditTransactionId: string
  originalCreditDocument: string | null
  originalCreditType: string | null
  originalCreditDate: string | null
  originalCreditPeriodId: string | null
  originalCreditPeriodName: string | null
  originalCreditAmount: number | null
  originalCreditAppliedAmount: number | null
  originalCreditAvailableAmount: number | null
  originalCreditRemainingAfterGroup: number | null
}

export type FacturaSituacion = {
  codigo: string | null
  color: FacturaSituacionColor
  motivo: string | null
  candidatos: FacturaAplicacionCandidata[]
  k: FacturaKContext | null
  a4: FacturaA4Context | null
  a5: FacturaA4Context | null
  a6: FacturaA4Context | null
  a7: FacturaA4Context | null
  a8: FacturaA8Context | null
  b1: FacturaB1Context | null
  b2: FacturaB1Context | null
  b3: FacturaB3Context | null
  n1: FacturaN1Context | null
}

export type FacturaImpuesto = {
  codigo?: string | null
  nombre?: string | null
  tasa?: number | null
  importe: number | null
  esRetencion?: boolean
}

export type FacturaLinea = {
  lineaId?: string | null
  itemId?: string | null
  itemNombre?: string | null
  descripcion?: string | null
  cantidad: number | null
  precioUnitario: number | null
  subtotalLinea: number | null
  impuestoLinea: number | null
  totalLinea: number | null
  esGravable?: boolean
  codigoImpuesto?: string | null
  tasaImpuesto?: number | null
  raw: Record<string, unknown>
}

export type Factura = {
  id: string
  numeroDocumento: string | null
  numeroTransaccion: string | null
  netsuiteInternalId: string
  clienteId: string | null
  clienteNombre: string | null
  fecha: string | null
  vencimiento: string | null
  fechaCreacion: string | null
  ultimaModificacion: string | null
  periodoContableId: string | null
  periodoContableNombre: string | null
  satPaymentTermId: string | null
  satPaymentTermNombre: string | null
  monedaId: string | null
  moneda: string | null
  tipoCambio: number | null
  subtotal: number | null
  descuento: number | null
  impuestoTotal: number | null
  iva: number | null
  total: number | null
  montoPagado: number | null
  saldoAbierto: number | null
  estado: FacturaEstado
  situacionCobro: FacturaSituacionCobro
  situacion: FacturaSituacion
  estadoNetsuiteId: string | null
  estadoNetsuiteNombre: string | null
  terminosPagoId: string | null
  terminosPagoNombre: string | null
  memo: string | null
  referencia: string | null
  impuestos: FacturaImpuesto[]
  lineas: FacturaLinea[]
  billingAddress?: Record<string, unknown> | null
  shippingAddress?: Record<string, unknown> | null
  customFields: Record<string, unknown>
  raw: Record<string, unknown>
}

export type FacturaSchemaField = {
  key: string
  title?: string
  type?: string
  format?: string
  nullable?: boolean
  custom: boolean
}

export type FacturaSchemaSnapshot = {
  recordType: 'invoice'
  topLevelFieldCount: number
  customFieldCount: number
  topLevelFields: FacturaSchemaField[]
  itemLineFieldCount: number
  itemLineFields: FacturaSchemaField[]
}

export type FacturasAbiertasResponse = {
  generatedAtUtc: string
  page: {
    limit: number
    offset: number
    count: number
    totalResults: number
    reconciliableResults: number
    deferredCurrentPpdCount: number
    kCount: number
    ppd1Count: number
    a1Count: number
    a4Count: number
    a5Count: number
    a6Count: number
    a7Count: number
    a8Count: number
    b1Count: number
    b2Count: number
    b3Count: number
    n1Count: number
    hasMore: boolean
  }
  summary: {
    transactionTypes: FacturaResumenTipoTransaccion[]
  }
  schema: FacturaSchemaSnapshot
  facturas: Factura[]
}

export type FacturaAdjuntoDetectedSignals = {
  transferAmount: number | null
  amountCandidates: number[]
  referenceNumber: string | null
  bankName: string | null
  operationDateText: string | null
  paymentConcept: string | null
  sourceAccountHint: string | null
  destinationAccountHint: string | null
}

export type FacturaAdjunto = {
  invoiceInternalId: string | null
  invoiceDocument: string | null
  fileId: string
  name: string | null
  fileType: string | null
  mediaTypeName: string | null
  fileSize: number | null
  url: string | null
  isInactive: boolean | null
  textExtractionSupported: boolean
  textExtractionStatus: 'parsed' | 'failed' | 'missing_content' | 'unsupported'
  parseError: string | null
  detectedSignals: FacturaAdjuntoDetectedSignals | null
  parsedTextExcerpt: string | null
  parsedText: string | null
}

export type FacturaAdjuntosResponse = {
  inspectedAtUtc: string
  source: 'invoice'
  invoiceInternalId: string
  invoiceDocument: string | null
  attachmentCount: number
  attachments: FacturaAdjunto[]
}

export type FacturaAplicacionA1Estado = 'applied' | 'skipped' | 'failed' | 'dry_run'

export type FacturaAplicacionA1ItemResult = {
  invoiceInternalId: string
  invoiceDocument: string | null
  groupInvoiceInternalIds?: string[]
  groupInvoiceDocuments?: Array<string | null>
  sourceInvoiceInternalId?: string | null
  sourceInvoiceDocument?: string | null
  creditTransactionId: string | null
  creditDocument: string | null
  creditType: string | null
  status: FacturaAplicacionA1Estado
  message: string
  customerPaymentId?: string | null
  customerPaymentTranId?: string | null
}

export type FacturaAplicacionA1Response = {
  executedAtUtc: string
  ruleCode: 'K' | 'PPD1' | 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7' | 'A8' | 'B1' | 'B2' | 'B3' | 'N1'
  totals: {
    eligible: number
    applied: number
    dryRun: number
    skipped: number
    failed: number
  }
  items: FacturaAplicacionA1ItemResult[]
  warnings?: string[]
}

export type BankImportBankId = 'payana' | 'clara_corriente' | 'bbva'

export type BankImportBank = {
  id: BankImportBankId
  label: string
  debitAccount: string
  sampleAnalysisAvailable: boolean
  sampleFileName: string | null
  historicalRegistryAvailable: boolean
  historicalStatementCount: number
  historicalRecognizedRowCount: number
  historicalReferenceCount: number
  historicalLastUpdatedAtUtc: string | null
  individualPaymentFileCount: number
  individualPaymentLastUpdatedAtUtc: string | null
}

export type BankImportMappingSheet = {
  key: 'customers' | 'suppliers'
  workbookName: string
  sheetName: string
  totalMappings: number
  exactDuplicates: number
  compactAmbiguous: number
}

export type BankImportTransactionRule = {
  transactionType: string
  mappingSheetKey: BankImportMappingSheet['key'] | null
  mappingSheetName: string | null
  journalMode: 'incoming' | 'outgoing' | 'special'
  includedInCurrentFlow: boolean
  includedInPendingSummary: boolean
  ruleSummary: string
}

export type BankImportConfigResponse = {
  defaultCutoffDate: string
  defaultAccountingPeriod: string
  banks: BankImportBank[]
  clientMapping: {
    workbookName: string
    sheetName: string
    totalMappings: number
    exactDuplicates: number
    compactAmbiguous: number
  }
  providerMapping: {
    workbookName: string
    sheetName: string
    totalMappings: number
    exactDuplicates: number
    compactAmbiguous: number
  }
  mappingSheets: BankImportMappingSheet[]
  transactionRules: BankImportTransactionRule[]
  sampleAnalysisAvailable: boolean
  sampleFileName: string | null
}

export type NetSuiteAccountCatalogItem = {
  internalId: string
  displayName: string
}

export type NetSuiteAccountCatalogResponse = {
  generatedAtUtc: string
  label: string
  source: 'store' | 'empty' | 'netsuite_sync'
  storePath: string
  lastSyncedAtUtc: string | null
  count: number
  items: NetSuiteAccountCatalogItem[]
}

export type ClaveSatCatalogItem = {
  code: string
  description: string
}

export type ClaveSatCatalogResponse = {
  generatedAtUtc: string
  label: string
  source: 'store' | 'empty' | 'excel_sync'
  storePath: string
  workbookPath: string | null
  sheetName: string
  lastSyncedAtUtc: string | null
  count: number
  items: ClaveSatCatalogItem[]
}

export type NetSuiteAccountTypeOption = {
  id: string
  label: string
  aliases: string[]
}

export type NetSuiteAccountImportRowStatus = 'ready' | 'existing' | 'blocked'

export type NetSuiteAccountImportRowExecutionStatus =
  | 'created'
  | 'skipped_existing'
  | 'blocked'
  | 'failed'

export type NetSuiteAccountImportResolvedReference = {
  source: 'existing' | 'batch'
  internalId: string | null
  displayName: string | null
  rowNumber: number | null
}

export type NetSuiteAccountImportExistingMatch = {
  internalId: string
  displayName: string
  matchBy: 'acctNumber' | 'displayName'
}

export type NetSuiteAccountImportRowResult = {
  rowNumber: number
  acctNumber: string | null
  acctName: string | null
  acctTypeInput: string | null
  acctTypeId: string | null
  acctTypeLabel: string | null
  parentReference: string | null
  description: string | null
  externalId: string | null
  isInactive: boolean
  isSummary: boolean
  previewStatus: NetSuiteAccountImportRowStatus
  existingAccount: NetSuiteAccountImportExistingMatch | null
  resolvedParent: NetSuiteAccountImportResolvedReference | null
  payload: Record<string, unknown> | null
  issues: string[]
}

export type NetSuiteAccountImportPreviewResponse = {
  generatedAtUtc: string
  detectedDelimiter: 'tab' | 'comma' | 'semicolon' | 'pipe' | 'unknown'
  detectedHeader: boolean
  acceptedColumns: string[]
  accountTypeOptions: NetSuiteAccountTypeOption[]
  summary: {
    totalLines: number
    parsedRows: number
    readyRows: number
    existingRows: number
    blockedRows: number
    batchDependentRows: number
  }
  items: NetSuiteAccountImportRowResult[]
}

export type NetSuiteAccountImportExecutionItem = NetSuiteAccountImportRowResult & {
  executionStatus: NetSuiteAccountImportRowExecutionStatus
  createdAccountInternalId: string | null
  message: string
}

export type NetSuiteAccountImportExecutionResponse = {
  executedAtUtc: string
  detectedDelimiter: NetSuiteAccountImportPreviewResponse['detectedDelimiter']
  detectedHeader: boolean
  acceptedColumns: string[]
  accountTypeOptions: NetSuiteAccountTypeOption[]
  summary: {
    totalLines: number
    parsedRows: number
    createdRows: number
    skippedExistingRows: number
    blockedRows: number
    failedRows: number
  }
  items: NetSuiteAccountImportExecutionItem[]
  syncedCatalog: NetSuiteAccountCatalogResponse | null
}

export type BankImportTransientCorrection = {
  correctionKey: string
  counterpartyName: string
  mappingSheetKey: BankImportMappingSheet['key']
  bankName: string
  netsuiteName: string
  creditAccount: string
  entityInternalId?: string | null
  postingDisplayName?: string | null
}

export type BankImportAnalyzeRequest = {
  bankId: BankImportBankId
  accountingPeriod?: string | null
  cutoffDate?: string | null
  fileName: string
  fileBase64: string
  transientCorrections?: BankImportTransientCorrection[]
}

export type BankImportAnalysisMode = 'standard' | 'banxico' | 'cot_ov'

export type BankImportAnalysisStatus = 'running' | 'completed' | 'failed'

export type BankImportAnalysisStartRequest = Omit<BankImportAnalyzeRequest, 'fileName' | 'fileBase64'> & {
  fileName?: string | null
  fileBase64?: string | null
  mode?: BankImportAnalysisMode | null
  forceRefresh?: boolean
}

export type BankImportHistoricalUploadRequest = {
  bankId: BankImportBankId
  fileName: string
  fileBase64: string
}

export type BankImportHistoricalUploadResponse = {
  bankId: BankImportBankId
  sourceFileName: string
  statementWindow: {
    minProcessingDate: string | null
    maxProcessingDate: string | null
  }
  parsedRows: number
  recognizedRows: number
  storedRows: number
  storedReferences: number
  historicalStatementCount: number
  historicalLastUpdatedAtUtc: string | null
}

export type BankImportIndividualPaymentUploadFile = {
  fileName: string
  fileBase64: string
  mimeType?: string | null
}

export type BankImportIndividualPaymentUploadRequest = {
  bankId: BankImportBankId
  files: BankImportIndividualPaymentUploadFile[]
}

export type BankImportIndividualPaymentFileMetadata = {
  id: string
  bankId: BankImportBankId
  fileName: string
  mimeType: string | null
  fileDigest: string
  fileSizeBytes: number
  createdAtUtc: string
  updatedAtUtc: string
}

export type BankImportIndividualPaymentUploadResponse = {
  bankId: BankImportBankId
  uploadedFiles: number
  insertedFiles: number
  updatedFiles: number
  totalFiles: number
  lastUpdatedAtUtc: string | null
  items: BankImportIndividualPaymentFileMetadata[]
}

export type BankImportCounterpartySource = 'statement' | 'banxico_ordering_party' | 'banxico_counterparty'

export type BankImportSampleAnalyzeRequest = {
  bankId: BankImportBankId
  accountingPeriod?: string | null
  cutoffDate?: string | null
  transientCorrections?: BankImportTransientCorrection[]
}

export type BankImportMappingMethod =
  | 'exact'
  | 'compact'
  | 'historical_exact'
  | 'manual_single'
  | 'auto_banxico'

export type BankImportCreditDestinationType =
  | 'clientes'
  | 'proveedores'
  | 'bancos'
  | 'ajustes'
  | 'otras'

export type BankImportCreditDestinationSummary = {
  type: BankImportCreditDestinationType
  label: string
  count: number
  amount: number
}

export type BankImportTransactionTypeSummary = {
  transactionType: string
  count: number
  amount: number
  mappingSheetName: string | null
  journalMode: BankImportTransactionRule['journalMode']
  includedInCurrentFlow: boolean
  includedInPendingSummary: boolean
}

export type BankImportJournalPreview = {
  externalId: string
  correctionKey: string
  transactionType: string
  processingTimestamp: string
  transactionDate: string
  counterpartyName: string
  statementCounterpartyName: string | null
  counterpartySource: BankImportCounterpartySource
  orderingPartyName: string | null
  orderingPartyRfc: string | null
  orderingPartyAccount: string | null
  normalizedCounterpartyName: string
  netsuiteName: string
  mappingSheetName: string
  mappedAccount: string
  mappedAccountSide: 'debit' | 'credit'
  debitAccount: string
  creditAccount: string
  debitEntityName: string | null
  debitEntitySheetKey: BankImportMappingSheet['key'] | null
  debitEntityInternalId?: string | null
  debitEntityDisplayName?: string | null
  creditEntityName: string | null
  creditEntitySheetKey: BankImportMappingSheet['key'] | null
  creditEntityInternalId?: string | null
  creditEntityDisplayName?: string | null
  postingDisplayName?: string | null
  creditDestinationType: BankImportCreditDestinationType
  creditDestinationLabel: string
  amount: number
  currency: string
  exchangeRate: number
  memo: string
  lineMemo: string
  paymentConcept: string | null
  rfc: string | null
  trackingKey: string | null
  referenceNumber: string | null
  originBankName: string | null
  destinationBankName: string | null
  destinationAccount: string | null
  hashId: string | null
  mappingMethod: BankImportMappingMethod
}

export type BankImportExportRow = {
  bankTimestamp: string
  bankCounterpartyName: string
  journalDate: string
  currency: string
  netsuiteName: string
  memo: string
  exchangeRate: number
  account: string
  debit: number | null
  credit: number | null
  lineMemo: string
  externalId: string
  line: 1 | 2
}

export type BankImportCandidateSource = 'workbook' | 'netsuite' | 'historical' | 'manual' | 'cot_ov'

export type BankImportSuggestedCandidate = {
  mappingSheetKey: BankImportMappingSheet['key']
  mappingSheetName: string
  candidateSource: BankImportCandidateSource
  bankName: string
  netsuiteName: string
  creditAccount: string
  entityInternalId?: string | null
  postingDisplayName?: string | null
  score: number
  scoreLabel: string
  suggestionMethod:
    | 'soft_compact'
    | 'token_overlap'
    | 'netsuite_overlap'
    | 'netsuite_entity'
    | 'historical_reference'
    | 'cot_ov_transaction'
  matchKind?: 'exact' | 'close'
  supportingTransactionType?: 'estimate' | 'sales_order' | null
  supportingTransactionNumber?: string | null
  supportingTransactionDate?: string | null
  reason: string
}

export type BankImportUnmatchedRow = {
  correctionKey: string
  transactionType: string
  mappingSheetKey: BankImportMappingSheet['key'] | null
  mappingSheetName: string | null
  processingTimestamp: string
  transactionDate: string
  counterpartyName: string
  statementCounterpartyName: string | null
  counterpartySource: BankImportCounterpartySource
  orderingPartyName: string | null
  orderingPartyRfc: string | null
  orderingPartyAccount: string | null
  normalizedCounterpartyName: string
  amount: number
  paymentConcept: string | null
  rfc: string | null
  trackingKey: string | null
  referenceNumber: string | null
  originBankName: string | null
  destinationBankName: string | null
  destinationAccount: string | null
  hashId: string | null
  reason: string
  suggestedCandidate: BankImportSuggestedCandidate | null
}

export type BankImportCandidateSearchResponse = {
  bankId: BankImportBankId
  transactionType: string
  mappingSheetKey: BankImportMappingSheet['key'] | null
  mappingSheetName: string | null
  query: string
  rfc: string | null
  trackingKey?: string | null
  candidates: BankImportSuggestedCandidate[]
}

export type BankImportSaveCorrectionRequest = {
  bankId: BankImportBankId
  correctionKey: string
  transactionType: string
  counterpartyName: string
  sourceFileName?: string | null
  transactionDate?: string | null
  processingTimestamp?: string | null
  amount?: number | null
  paymentConcept?: string | null
  trackingKey?: string | null
  hashId?: string | null
  selectedCandidate: {
    mappingSheetKey: BankImportMappingSheet['key']
    candidateSource?: BankImportCandidateSource
    bankName: string
    netsuiteName: string
    creditAccount: string
    entityInternalId?: string | null
    postingDisplayName?: string | null
  }
}

export type BankImportSaveCorrectionResponse = {
  savedAtUtc: string
  bankId: BankImportBankId
  transactionType: string
  counterpartyName: string
  mappingSheetKey: BankImportMappingSheet['key']
  mappingSheetName: string
  netsuiteName: string
  creditAccount: string
}

export type BankImportBalanceValidationStatus =
  | 'unsupported'
  | 'no_previous_anchor'
  | 'awaiting_validation'
  | 'ok'
  | 'mismatch'
  | 'partial'

export type BankImportBalanceValidation = {
  supported: boolean
  status: BankImportBalanceValidationStatus
  message: string
  bankId: BankImportBankId
  sourceFileHash: string
  sourceFileName: string
  cutoffDate: string
  movementWindow: {
    minProcessingDate: string | null
    maxProcessingDate: string | null
  }
  movementSummary: {
    incomingAmount: number
    outgoingAmount: number
    netChange: number
    rowsWithKnownDirection: number
    rowsWithUnknownDirection: number
    unknownDirectionAmount: number
  }
  currentValidation: {
    validatedClosingBalance: number
    validatedAtUtc: string
  } | null
  previousValidation: {
    sourceFileName: string
    cutoffDate: string
    movementMaxProcessingDate: string | null
    validatedClosingBalance: number
    validatedAtUtc: string
  } | null
  expectedClosingBalance: number | null
  differenceVsValidatedClosing: number | null
}

export type BankImportAnalyzeResponse = {
  generatedAtUtc: string
  bank: BankImportBank
  sourceFileName: string
  sourceFileHash: string
  accountingPeriod: string
  cutoffDate: string
  statementWindow: {
    minProcessingDate: string | null
    maxProcessingDate: string | null
  }
  clientMapping: BankImportConfigResponse['clientMapping']
  providerMapping: BankImportConfigResponse['providerMapping']
  mappingSheets: BankImportConfigResponse['mappingSheets']
  transactionRules: BankImportConfigResponse['transactionRules']
  summary: {
    totalRows: number
    rowsAfterCutoff: number
    eligibleRows: number
    readyRows: number
    unmatchedRows: number
    excludedRows: number
    excludedInvalidDateRows: number
    excludedBeforeCutoffRows: number
    excludedStatusRows: number
    excludedRecognizedRows: number
    excludedTypeRows: number
    excludedInvalidAmountRows: number
    readyAmount: number
    unmatchedAmount: number
    recognizedAmount: number
  }
  netsuiteSweep: {
    status: 'applied' | 'unavailable' | 'not_configured'
    accountId: string | null
    accountLabel: string | null
    registerRowsFetched: number
    recognizedRows: number
    recognizedAmount: number
    warning: string | null
    periodStart?: string | null
    periodEnd?: string | null
    matches: Array<{
      rowOrigin?: 'analysis_match' | 'manual_override' | 'period_only'
      externalId: string
      transactionType: string
      transactionDate: string
      processingTimestamp: string
      counterpartyName: string
      statementCounterpartyName: string | null
      counterpartySource: BankImportCounterpartySource
      orderingPartyName: string | null
      orderingPartyRfc: string | null
      orderingPartyAccount: string | null
      amount: number
      mappingSheetKey: BankImportMappingSheet['key'] | null
      mappingSheetName: string | null
      creditAccount: string | null
      paymentConcept: string | null
      trackingKey: string | null
      hashId: string | null
      netsuiteTransactionDate: string
      netsuiteTransactionId: string
      netsuiteDocumentNumber: string | null
      netsuiteTransactionType: string | null
      netsuiteEntityName: string | null
      netsuiteLineMemo: string | null
      netsuiteHeaderMemo: string | null
      netsuiteMemo: string | null
      movementMatchSource: string
      netsuiteMatchSource: string
      matchKind: 'exact' | 'approximate' | 'tokens'
      matchConfidence: 'high' | 'medium' | 'low'
      matchConfidenceLabel: string
      dayDifference: number
      matchScore: number
      matchRule: string
    }>
    periodRows?: Array<{
      rowOrigin?: 'analysis_match' | 'manual_override' | 'period_only'
      externalId: string
      transactionType: string
      transactionDate: string
      processingTimestamp: string
      counterpartyName: string
      statementCounterpartyName: string | null
      counterpartySource: BankImportCounterpartySource
      orderingPartyName: string | null
      orderingPartyRfc: string | null
      orderingPartyAccount: string | null
      amount: number
      mappingSheetKey: BankImportMappingSheet['key'] | null
      mappingSheetName: string | null
      creditAccount: string | null
      paymentConcept: string | null
      trackingKey: string | null
      hashId: string | null
      netsuiteTransactionDate: string
      netsuiteTransactionId: string
      netsuiteDocumentNumber: string | null
      netsuiteTransactionType: string | null
      netsuiteEntityName: string | null
      netsuiteLineMemo: string | null
      netsuiteHeaderMemo: string | null
      netsuiteMemo: string | null
      movementMatchSource: string
      netsuiteMatchSource: string
      matchKind: 'exact' | 'approximate' | 'tokens'
      matchConfidence: 'high' | 'medium' | 'low'
      matchConfidenceLabel: string
      dayDifference: number
      matchScore: number
      matchRule: string
    }>
  }
  excludedBuckets: Array<{
    code: string
    label: string
    count: number
    amount?: number | null
  }>
  transactionTypes: BankImportTransactionTypeSummary[]
  creditDestinations: BankImportCreditDestinationSummary[]
  journals: BankImportJournalPreview[]
  exportRows: BankImportExportRow[]
  unmatched: BankImportUnmatchedRow[]
  excludedTypeMovements: Array<{
    transactionDate: string
    processingTimestamp: string
    transactionType: string
    counterpartyName: string
    statementCounterpartyName: string | null
    counterpartySource: BankImportCounterpartySource
    orderingPartyName: string | null
    orderingPartyRfc: string | null
    orderingPartyAccount: string | null
    amount: number
    paymentConcept: string | null
    trackingKey: string | null
    referenceNumber: string | null
    originBankName: string | null
    destinationBankName: string | null
    destinationAccount: string | null
    hashId: string | null
    reason: string
  }>
  balanceValidation: BankImportBalanceValidation
}

export type BankImportAnalysisRunResponse = {
  analysisId: string
  bankId: BankImportBankId
  sourceFileName: string
  accountingPeriod: string
  cutoffDate: string
  mode: BankImportAnalysisMode
  status: BankImportAnalysisStatus
  startedAtUtc: string
  finishedAtUtc: string | null
  error: string | null
  result: BankImportAnalyzeResponse | null
}

export type BankImportPostJournalStatus = 'created' | 'skipped' | 'failed' | 'dry_run'

export type BankImportPostJournalSkipReason = 'external_id' | 'movement_evidence'

export type BankImportPostJournalsRequest = {
  bankId: BankImportBankId
  sourceFileName?: string | null
  journals: BankImportJournalPreview[]
  dryRun?: boolean
}

export type BankImportPostJournalResult = {
  externalId: string
  counterpartyName: string
  transactionDate: string
  amount: number
  status: BankImportPostJournalStatus
  skipReason?: BankImportPostJournalSkipReason | null
  netsuiteRecordId: string | null
  netsuiteTranId: string | null
  message: string
}

export type BankImportPostJournalsResponse = {
  executedAtUtc: string
  bankId: BankImportBankId
  dryRun: boolean
  totals: {
    requested: number
    created: number
    skipped: number
    failed: number
    dryRun: number
  }
  items: BankImportPostJournalResult[]
}

export type BankImportSaveValidatedBalanceRequest = {
  bankId: BankImportBankId
  sourceFileHash: string
  sourceFileName: string
  cutoffDate: string
  movementWindow: {
    minProcessingDate: string | null
    maxProcessingDate: string | null
  }
  movementSummary: BankImportBalanceValidation['movementSummary']
  validatedClosingBalance: number
}

export type BankImportSaveValidatedBalanceResponse = BankImportBalanceValidation

export type BanxicoCepLookupMode = 'status' | 'cep'

export type BanxicoCepSearchType = 'trackingKey' | 'referenceNumber'

export type BanxicoCepInstitution = {
  id: string
  name: string
}

export type BanxicoCepInstitutionsResponse = {
  fetchedAtUtc: string
  date: string
  banxicoDate: string
  overrideCaptcha: boolean
  institutions: BanxicoCepInstitution[]
  institutionsMispei: BanxicoCepInstitution[]
  sourceUrl: string
}

export type BanxicoCepLookupRequest = {
  bankId?: BankImportBankId | null
  sourceProfileId?: string | null
  operationDate: string
  searchType: BanxicoCepSearchType
  criteria: string
  issuerId: string
  receiverId: string
  mode: BanxicoCepLookupMode
  beneficiaryAccount?: string | null
  amount?: string | number | null
  beneficiaryIsParticipant?: boolean
}

export type BanxicoCepLookupResponse = {
  fetchedAtUtc: string
  sourceUrl: string
  request: {
    operationDate: string
    banxicoDate: string
    searchType: BanxicoCepSearchType
    mode: BanxicoCepLookupMode
    criteria: string
    issuerId: string
    receiverId: string
    beneficiaryAccountMasked: string | null
    amount: string | null
    beneficiaryIsParticipant: boolean
    captchaSupplied: boolean
  }
  result: {
    kind: 'error' | 'payment_status' | 'cep' | 'unknown'
    title: string | null
    message: string | null
    text: string
    html: string
    contentType: string
    fileName: string | null
    download: {
      contentBase64: string
      contentType: string
      fileName: string | null
    } | null
    found: boolean | null
    operationNotFound: boolean
    captchaInvalid: boolean
  }
}

export type BanxicoCepTransferParty = {
  bankName: string | null
  name: string | null
  account: string | null
  rfc: string | null
}

export type BanxicoCepTransferSummary = {
  operationDate: string | null
  processedAt: string | null
  concept: string | null
  amount: string | null
  vat: string | null
  trackingKey: string | null
  orderingParty: BanxicoCepTransferParty | null
  beneficiary: BanxicoCepTransferParty | null
}

export { HttpClientError }

export function fetchOverview() {
  return httpClient.request<OverviewResponse>('/console/overview')
}

export function fetchSatStatus() {
  return httpClient.request<SatStatusResponse>('/sat/status')
}

export function runSatAuthTest() {
  return httpClient.request<SatAuthTestResponse>('/sat/auth/test', {
    method: 'POST',
  })
}

export function createSatCfdiRequest(payload: SatCfdiRequestPayload) {
  return httpClient.request<SatCfdiRequestResponse>('/sat/cfdi/request', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function verifySatCfdiRequest(requestId: string) {
  return httpClient.request<SatCfdiVerifyResponse>(
    `/sat/cfdi/request/${encodeURIComponent(requestId)}`,
  )
}

export function inspectSatCfdiPackage(packageId: string) {
  return httpClient.request<SatCfdiPackageInspectResponse>(
    `/sat/cfdi/package/${encodeURIComponent(packageId)}`,
  )
}

export function fetchSatDownloadHistory(limit = 20) {
  return httpClient.request<SatDownloadHistoryResponse>(
    `/sat/download-history?limit=${encodeURIComponent(String(limit))}`,
  )
}

export function fetchSatAnalysisWindows() {
  return httpClient.request<SatAnalysisWindowsResponse>('/sat/analysis/windows')
}

export function fetchSatManualHomologationStore() {
  return httpClient.request<SatManualHomologationStoreResponse>('/sat/homologation/manual')
}

export function saveSatManualProviderHomologation(payload: SatManualProviderHomologationSaveRequest) {
  return httpClient.request<SatManualProviderHomologationSaveResponse>('/sat/homologation/manual/provider', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function saveSatManualAccountHomologation(payload: SatManualAccountHomologationSaveRequest) {
  return httpClient.request<SatManualAccountHomologationSaveResponse>('/sat/homologation/manual/account', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function bootstrapSatAnalysisWindow(payload: SatAnalysisWindowBootstrapPayload) {
  return httpClient.request<SatAnalysisWindow>('/sat/analysis/windows/bootstrap', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function reconcileSatAnalysisWindow(windowId: string) {
  return httpClient.request<SatAnalysisWindow>(
    `/sat/analysis/windows/${encodeURIComponent(windowId)}/reconcile`,
    {
      method: 'POST',
    },
  )
}

export function previewSatCfdiPackageForNetsuite(packageId: string) {
  return httpClient.request<SatCfdiNetsuitePreviewResponse>(
    `/sat/cfdi/package/${encodeURIComponent(packageId)}/netsuite-preview`,
  )
}

export function uploadSatAnalysisInvoice(windowId: string, uuid: string, dryRun = false) {
  return httpClient.request<SatAnalysisInvoiceUploadResponse>(
    `/sat/analysis/windows/${encodeURIComponent(windowId)}/invoices/${encodeURIComponent(uuid)}/upload`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dryRun,
      }),
    },
  )
}

export function getSatPackageDownloadUrl(packageId: string) {
  return `${apiBaseUrl.replace(/\/+$/, '')}/sat/cfdi/package/${encodeURIComponent(packageId)}/download`
}

export function fetchBankImportConfig() {
  return httpClient.request<BankImportConfigResponse>('/bancos/config')
}

export function fetchRules() {
  return httpClient.request<{ rules: RuleConfig }>('/rules/default')
}

export function fetchNetSuiteEntityCatalog(kind: NetSuiteEntityCatalogKind) {
  return httpClient.request<NetSuiteEntityCatalogResponse>(`/entities/${encodeURIComponent(kind)}`)
}

export function syncNetSuiteEntityCatalog(kind: NetSuiteEntityCatalogKind) {
  return httpClient.request<NetSuiteEntityCatalogResponse>(`/entities/${encodeURIComponent(kind)}/sync`, {
    method: 'POST',
  })
}

export function fetchNetSuiteAccountCatalog() {
  return httpClient.request<NetSuiteAccountCatalogResponse>('/catalogs/netsuite/accounts')
}

export function syncNetSuiteAccountCatalog() {
  return httpClient.request<NetSuiteAccountCatalogResponse>('/catalogs/netsuite/accounts/sync', {
    method: 'POST',
  })
}

export function fetchClaveSatCatalog() {
  return httpClient.request<ClaveSatCatalogResponse>('/catalogs/sat/clave-sat')
}

export function syncClaveSatCatalog() {
  return httpClient.request<ClaveSatCatalogResponse>('/catalogs/sat/clave-sat/sync', {
    method: 'POST',
  })
}

export function previewNetSuiteAccountImport(rawText: string) {
  return httpClient.request<NetSuiteAccountImportPreviewResponse>('/catalogs/netsuite/accounts/import/preview', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      rawText,
    }),
  })
}

export function createNetSuiteAccountImport(rawText: string) {
  return httpClient.request<NetSuiteAccountImportExecutionResponse>('/catalogs/netsuite/accounts/import/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      rawText,
    }),
  })
}

export function fetchSearchTransactionsBootstrap() {
  return httpClient.request<SearchTransactionsBootstrapResponse>('/search/bootstrap')
}

export function fetchSearchTransactionEntities(entityKind: SearchTransactionEntityKind) {
  return httpClient.request<SearchTransactionEntityOptionsResponse>(
    `/search/entities?entityKind=${encodeURIComponent(entityKind)}`,
  )
}

export function searchTransactions(payload: SearchTransactionsRequest) {
  return httpClient.request<SearchTransactionsResponse>('/search/transactions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function fetchAudit() {
  return httpClient.request<AuditResponse>('/audit')
}

export function fetchPreviewDemo() {
  return httpClient.request<PreviewResponse>('/reconcile/demo')
}

export function fetchPolicy() {
  return httpClient.request<PolicyResponse>('/reconcile/policy')
}

export function fetchRuleDefinitions() {
  return httpClient.request<RuleDefinitionsResponse>('/rules/definitions')
}

export function fetchExampleScenarios() {
  return httpClient.request<ExampleScenariosResponse>('/reconcile/examples')
}

export function fetchPreview(payload: PreviewPayloadRequest) {
  return httpClient.request<PreviewResponse>('/reconcile/preview', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function analyzeBankImport(payload: BankImportAnalyzeRequest) {
  return httpClient.request<BankImportAnalyzeResponse>('/bancos/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function startBankImportAnalysis(payload: BankImportAnalysisStartRequest) {
  return httpClient.request<BankImportAnalysisRunResponse>('/bancos/analysis/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function recoverBankImportAnalysis(payload: BankImportAnalysisStartRequest) {
  return httpClient.request<BankImportAnalysisRunResponse>('/bancos/analysis/recover', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function fetchBankImportAnalysisRun(analysisId: string) {
  return httpClient.request<BankImportAnalysisRunResponse>(
    `/bancos/analysis/${encodeURIComponent(analysisId)}`,
  )
}

export function uploadBankHistoricalStatement(payload: BankImportHistoricalUploadRequest) {
  return httpClient.request<BankImportHistoricalUploadResponse>('/bancos/history/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function uploadBankIndividualPaymentFiles(payload: BankImportIndividualPaymentUploadRequest) {
  return httpClient.request<BankImportIndividualPaymentUploadResponse>('/bancos/pagos-individuales/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function fetchBankImportSample(bankId: BankImportBankId, accountingPeriod?: string | null) {
  const params = new URLSearchParams({
    bankId,
  })

  if (accountingPeriod) {
    params.set('accountingPeriod', accountingPeriod)
  }

  return httpClient.request<BankImportAnalyzeResponse>(`/bancos/sample?${params.toString()}`)
}

export function analyzeBankImportSample(payload: BankImportSampleAnalyzeRequest) {
  return httpClient.request<BankImportAnalyzeResponse>('/bancos/sample', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function searchBankImportCandidates(
  bankId: BankImportBankId,
  transactionType: string,
  query: string,
  rfc?: string | null,
  correctionKey?: string | null,
  trackingKey?: string | null,
  referenceNumber?: string | null,
) {
  const params = new URLSearchParams({
    bankId,
    transactionType,
    query,
  })

  if (rfc) {
    params.set('rfc', rfc)
  }

  if (correctionKey) {
    params.set('correctionKey', correctionKey)
  }

  if (trackingKey) {
    params.set('trackingKey', trackingKey)
  }

  if (referenceNumber) {
    params.set('referenceNumber', referenceNumber)
  }

  return httpClient.request<BankImportCandidateSearchResponse>(`/bancos/candidates?${params.toString()}`)
}

export function saveBankImportCorrection(payload: BankImportSaveCorrectionRequest) {
  return httpClient.request<BankImportSaveCorrectionResponse>('/bancos/corrections', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function postBankImportJournals(payload: BankImportPostJournalsRequest) {
  return httpClient.request<BankImportPostJournalsResponse>('/bancos/journals/post', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function saveBankImportValidatedBalance(payload: BankImportSaveValidatedBalanceRequest) {
  return httpClient.request<BankImportSaveValidatedBalanceResponse>('/bancos/saldo-validado', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function fetchBanxicoCepInstitutions(date?: string | null) {
  const params = new URLSearchParams()
  if (date) {
    params.set('date', date)
  }

  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  return httpClient.request<BanxicoCepInstitutionsResponse>(`/bancos/cep/institutions${suffix}`)
}

export function lookupBanxicoCep(payload: BanxicoCepLookupRequest) {
  return httpClient.request<BanxicoCepLookupResponse>('/bancos/cep/lookup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function fetchBanxicoCepDetails(payload: BanxicoCepLookupRequest) {
  return httpClient.request<BanxicoCepTransferSummary | null>('/bancos/cep/details', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function fetchNetSuiteAnalysisBootstrap() {
  return httpClient.request<NetSuiteAnalysisBootstrapResponse>('/netsuite/analysis/bootstrap')
}

export function fetchNetSuiteAuthStatus() {
  return httpClient.request<NetSuiteAuthStatusResponse>('/auth/netsuite/status')
}

export function fetchEgresosBootstrap(options?: {
  forceRefresh?: boolean
  limit?: number
  offset?: number
}) {
  const searchParams = new URLSearchParams()

  if (options?.forceRefresh) {
    searchParams.set('forceRefresh', 'true')
  }

  if (typeof options?.limit === 'number' && Number.isFinite(options.limit)) {
    searchParams.set('limit', String(options.limit))
  }

  if (typeof options?.offset === 'number' && Number.isFinite(options.offset)) {
    searchParams.set('offset', String(options.offset))
  }

  const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : ''
  return httpClient.request<EgresosBootstrapResponse>(`/egresos/bootstrap${suffix}`)
}

export function fetchEgresosExactReadyOverview(options?: {
  forceRefresh?: boolean
  pageSize?: number
}) {
  const searchParams = new URLSearchParams()

  if (options?.forceRefresh) {
    searchParams.set('forceRefresh', 'true')
  }

  if (typeof options?.pageSize === 'number' && Number.isFinite(options.pageSize)) {
    searchParams.set('pageSize', String(options.pageSize))
  }

  const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : ''
  return httpClient.request<EgresosExactReadyOverviewResponse>(
    `/egresos/exact-ready-overview${suffix}`,
  )
}

export function applyEgresoExactCredit(
  billInternalId: string,
  payload?: {
    creditInternalId?: string | null
    dryRun?: boolean
  },
) {
  return httpClient.request<ApplyEgresoExactCreditResponse>(
    `/egresos/${encodeURIComponent(billInternalId)}/apply-exact-credit`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        creditInternalId: payload?.creditInternalId ?? null,
        dryRun: Boolean(payload?.dryRun),
      }),
    },
  )
}

export function prepareEgresoExactJournal(
  billInternalId: string,
  payload?: {
    journalInternalId?: string | null
  },
) {
  return httpClient.request<PrepareEgresoExactJournalResponse>(
    `/egresos/${encodeURIComponent(billInternalId)}/prepare-exact-journal`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        journalInternalId: payload?.journalInternalId ?? null,
      }),
    },
  )
}

export function reconcileEgresoExactSupport(
  billInternalId: string,
  payload?: {
    supportInternalId?: string | null
  },
) {
  return httpClient.request<ReconcileEgresoExactSupportResponse>(
    `/egresos/${encodeURIComponent(billInternalId)}/reconcile-exact-support`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        supportInternalId: payload?.supportInternalId ?? null,
      }),
    },
  )
}

export function fetchFacturasAbiertas(
  limit = 10,
  offset = 0,
  options?: {
    includeRaw?: boolean
    forceRefresh?: boolean
  },
) {
  const searchParams = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  })

  if (options?.includeRaw === true) {
    searchParams.set('includeRaw', 'true')
  } else {
    searchParams.set('includeRaw', 'false')
  }

  if (options?.forceRefresh) {
    searchParams.set('forceRefresh', 'true')
  }

  return httpClient.request<FacturasAbiertasResponse>(`/facturas/open?${searchParams.toString()}`)
}

export function fetchFacturaAdjuntos(
  invoiceInternalId: string,
  options?: {
    includeText?: boolean
    fileId?: string
  },
) {
  const searchParams = new URLSearchParams()

  if (options?.includeText) {
    searchParams.set('includeText', 'true')
  }

  if (typeof options?.fileId === 'string' && options.fileId.trim()) {
    searchParams.set('fileId', options.fileId.trim())
  }

  const path = `/facturas/${encodeURIComponent(invoiceInternalId)}/adjuntos`
  const query = searchParams.toString()

  return httpClient.request<FacturaAdjuntosResponse>(query ? `${path}?${query}` : path)
}

export function applyA1Transactions(body?: {
  dryRun?: boolean
  invoiceInternalId?: string
  limit?: number
}) {
  return httpClient.request<FacturaAplicacionA1Response>('/facturas/apply/a1', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  })
}

export function applyPpd1Transactions(body?: {
  dryRun?: boolean
  invoiceInternalId?: string
  limit?: number
}) {
  return httpClient.request<FacturaAplicacionA1Response>('/facturas/apply/ppd1', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  })
}

export function applyA2Transactions(body?: {
  dryRun?: boolean
  invoiceInternalId?: string
  limit?: number
}) {
  return httpClient.request<FacturaAplicacionA1Response>('/facturas/apply/a2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  })
}

export function applyA3Transactions(body?: {
  dryRun?: boolean
  invoiceInternalId?: string
  limit?: number
}) {
  return httpClient.request<FacturaAplicacionA1Response>('/facturas/apply/a3', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  })
}

export function applyA4Transactions(body?: {
  dryRun?: boolean
  invoiceInternalId?: string
  limit?: number
}) {
  return httpClient.request<FacturaAplicacionA1Response>('/facturas/apply/a4', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  })
}

export function applyA5Transactions(body?: {
  dryRun?: boolean
  invoiceInternalId?: string
  limit?: number
}) {
  return httpClient.request<FacturaAplicacionA1Response>('/facturas/apply/a5', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  })
}

export function applyA6Transactions(body?: {
  dryRun?: boolean
  invoiceInternalId?: string
  limit?: number
}) {
  return httpClient.request<FacturaAplicacionA1Response>('/facturas/apply/a6', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  })
}

export function applyA7Transactions(body?: {
  dryRun?: boolean
  invoiceInternalId?: string
  limit?: number
}) {
  return httpClient.request<FacturaAplicacionA1Response>('/facturas/apply/a7', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  })
}

export function applyA8Transactions(body?: {
  dryRun?: boolean
  invoiceInternalId?: string
  limit?: number
}) {
  return httpClient.request<FacturaAplicacionA1Response>('/facturas/apply/a8', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  })
}

export function applyB1Transactions(body?: {
  dryRun?: boolean
  invoiceInternalId?: string
  limit?: number
}) {
  return httpClient.request<FacturaAplicacionA1Response>('/facturas/apply/b1', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  })
}

export function applyB2Transactions(body?: {
  dryRun?: boolean
  invoiceInternalId?: string
  limit?: number
}) {
  return httpClient.request<FacturaAplicacionA1Response>('/facturas/apply/b2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  })
}

export function applyB3Transactions(body?: {
  dryRun?: boolean
  invoiceInternalId?: string
  limit?: number
}) {
  return httpClient.request<FacturaAplicacionA1Response>('/facturas/apply/b3', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  })
}

export function applyN1Transactions(body?: {
  dryRun?: boolean
  invoiceInternalId?: string
  limit?: number
}) {
  return httpClient.request<FacturaAplicacionA1Response>('/facturas/apply/n1', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  })
}

export function revokeNetSuiteOAuthSession() {
  return httpClient.request<{ revoked: boolean }>('/auth/netsuite/revoke', {
    method: 'POST',
  })
}
