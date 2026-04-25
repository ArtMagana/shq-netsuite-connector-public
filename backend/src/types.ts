export type ActionType =
  | 'AUTO_APPLY'
  | 'REVIEW_TOLERANCE'
  | 'REVIEW_CROSS_PERIOD'
  | 'EXCEPTION_CASE'

export type MatchStage =
  | 'STRICT_EXACT'
  | 'TOLERANCE_REVIEW'
  | 'CROSS_PERIOD_REVIEW'
  | 'UNMATCHED'

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

export type ReceiptCandidate = {
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

export type InvoiceCandidate = {
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

export type MatchProposal = {
  receiptId: string
  invoiceIds: string[]
  action: ActionType
  stage: MatchStage
  score: number
  amountDifference: number
  samePeriod: boolean
  dayDifference: number
  referenceMatch: boolean
  reasons: string[]
}

export type Decision = {
  receiptId: string
  action: ActionType
  stage: MatchStage
  matchedInvoiceIds: string[]
  confidence: number
  amountDifference: number
  requiresAdjustment: boolean
  requiresPeriodAdjustment: boolean
  reasons: string[]
  alternatives: MatchProposal[]
  nextStep: string
}

export type PreviewPayload = {
  rules?: Partial<RuleConfig>
  receipts: ReceiptCandidate[]
  invoices: InvoiceCandidate[]
}

export type ReconciliationPolicy = {
  name: string
  description: string
  autoApplyCriteria: string[]
  reviewCriteria: string[]
  blockedCriteria: string[]
}

export type RuleDefinition = {
  code: string
  title: string
  definition: string
}

export type FacturaResumenTipoTransaccion = {
  code: string
  title: string
  definition: string
  total: number
  actionLabel?: string | null
}

export type RuleCheckStatus = 'pass' | 'watch' | 'block'

export type RuleCheck = {
  label: string
  status: RuleCheckStatus
  detail: string
}

export type ExampleScenario = {
  id: string
  title: string
  summary: string
  receipt: ReceiptCandidate
  candidateInvoices: InvoiceCandidate[]
  ruleChecks: RuleCheck[]
  decision: Decision
}

export type NetSuiteAnalysisQueryId =
  | 'openInvoices'
  | 'arJournalCandidates'
  | 'postingPeriods'

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
  items?: Record<string, unknown>[]
  error?: string
}

export type NetSuiteAnalysisBootstrapResponse = {
  readOnly: true
  generatedAtUtc: string
  queries: NetSuiteAnalysisQueryResult[]
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
  fecha: Date | null
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
  fecha: Date | null
  total: number | null
  saldoAbierto: number | null
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
  creditDate: Date | null
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
  creditDate: Date | null
  creditPeriodId: string | null
  creditPeriodName: string | null
  creditAmount: number | null
  creditAvailableAmount: number | null
  creditRemainingAfterInvoice: number | null
}

export type FacturaKJournalComponent = {
  invoiceInternalId: string
  invoiceDocument: string | null
  customerId: string | null
  customerName: string | null
  salesOrderInternalId: string | null
  salesOrderDocument: string | null
  grossAmount: number
  commissionAmount: number
  netAmount: number
}

export type FacturaKContext = {
  status: 'matched' | 'pending_journal' | 'pending_invoice' | 'manual_review'
  requiresManualIntervention: boolean
  manualReason: string | null
  recognitionKey: string
  orderId: string
  transferId: string | null
  transferIdFragment: string | null
  transferDate: Date | null
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
  invoiceDate: Date | null
  invoiceAmount: number | null
  salesOrderInternalId: string | null
  salesOrderDocument: string | null
  salesOrderDate: Date | null
  salesOrderAmount: number | null
  orderGrossAmount: number | null
  orderCommissionAmount: number | null
  orderNetDisbursementAmount: number | null
  journalTransactionId: string | null
  journalDocument: string | null
  journalDate: Date | null
  journalPeriodId: string | null
  journalPeriodName: string | null
  journalAmount: number | null
  journalMemo: string | null
  matchedInvoiceInternalIds: string[]
  matchedInvoiceDocuments: Array<string | null>
  journalComponents: FacturaKJournalComponent[]
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
  originalCreditDate: Date | null
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
  originalCreditDate: Date | null
  originalCreditPeriodId: string | null
  originalCreditPeriodName: string | null
  originalCreditAmount: number | null
  originalCreditAppliedAmount: number | null
  originalCreditAvailableAmount: number | null
  originalCreditRemainingAfterGroup: number | null
}

export type FacturaN1Context = {
  facturaAnticipoInternalId: string
  facturaAnticipoDocumento: string | null
  facturaAnticipoFecha: Date | null
  facturaAnticipoPeriodoContableId: string | null
  facturaAnticipoPeriodoContableNombre: string | null
  facturaAnticipoTotal: number | null
  facturaAnticipoMetodoPagoId: string | null
  facturaAnticipoMetodoPagoNombre: string | null
  pagoTransactionId: string
  pagoDocumento: string | null
  pagoTipoTransaccion: string | null
  pagoFecha: Date | null
  pagoPeriodoContableId: string | null
  pagoPeriodoContableNombre: string | null
  pagoCuentaBancoId: string | null
  pagoCuentaBancoNombre: string | null
  pagoAplicadoMonto: number | null
  notaCreditoId: string | null
  notaCreditoDocumento: string | null
  notaCreditoFecha: Date | null
  notaCreditoEstadoId: string | null
  notaCreditoEstadoNombre: string | null
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
  fecha: Date | null
  vencimiento: Date | null
  fechaCreacion: Date | null
  ultimaModificacion: Date | null
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

export type NetSuiteEntityCatalogKind = BankImportMappingSheet['key']

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

export type NetSuiteAccountCatalogItem = {
  internalId: string
  displayName: string
}

export type NetSuiteAccountCatalogResponse = {
  generatedAtUtc: string
  label: string
  source: 'store' | 'netsuite_sync' | 'empty'
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
  source: 'store' | 'excel_sync' | 'empty'
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

export type BankImportExcludedBucket = {
  code: 'before_cutoff' | 'status' | 'recognized_in_netsuite' | 'type' | 'invalid_amount' | 'invalid_date'
  label: string
  count: number
  amount?: number | null
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

export type BankImportNetSuiteSweepStatus = 'applied' | 'unavailable' | 'not_configured'

export type BankImportNetSuiteRecognizedRowOrigin = 'analysis_match' | 'manual_override' | 'period_only'

export type BankImportNetSuiteRecognizedRow = {
  rowOrigin: BankImportNetSuiteRecognizedRowOrigin
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
}

export type BankImportNetSuiteSweep = {
  status: BankImportNetSuiteSweepStatus
  accountId: string | null
  accountLabel: string | null
  registerRowsFetched: number
  recognizedRows: number
  recognizedAmount: number
  warning: string | null
  periodStart: string | null
  periodEnd: string | null
  matches: BankImportNetSuiteRecognizedRow[]
  periodRows: BankImportNetSuiteRecognizedRow[]
}

export type BankImportExcludedTypeMovement = {
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
  netsuiteSweep: BankImportNetSuiteSweep
  excludedBuckets: BankImportExcludedBucket[]
  transactionTypes: BankImportTransactionTypeSummary[]
  creditDestinations: BankImportCreditDestinationSummary[]
  journals: BankImportJournalPreview[]
  exportRows: BankImportExportRow[]
  unmatched: BankImportUnmatchedRow[]
  excludedTypeMovements: BankImportExcludedTypeMovement[]
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

export type BankImportCounterpartySource = 'statement' | 'banxico_ordering_party' | 'banxico_counterparty'

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
