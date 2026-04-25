import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'

import { downloadBanxicoCepDetails, getBanxicoCepInstitutions } from './banxico.js'
import {
  createBankAnalysisRun,
  findLatestBankAnalysisRunByHash,
  findRunningBankAnalysisRunByHash,
  getBankAnalysisRun,
  toBankAnalysisRunResponse,
  completeBankAnalysisRun,
} from './bankAnalysisRunStore.js'
import {
  findBankBalanceValidation,
  findLatestBankBalanceValidationBefore,
  upsertBankBalanceValidation,
} from './bankBalanceValidationStore.js'
import { getBankWorkingFile, upsertBankWorkingFile } from './bankWorkingFileStore.js'
import {
  findBanxicoCepRecognition,
  upsertBanxicoCepRecognition,
} from './banxicoCepRecognitionStore.js'
import {
  getClaraDepositSeedMappings,
  pickClaraDepositAutoCandidate,
  resolveClaraDepositOrderingParty,
} from './claraDepositModel.js'
import {
  loadBankEquivalenceOverrides,
  upsertBankEquivalenceOverride,
} from './bankEquivalenceStore.js'
import {
  findBankRecognitionOverride,
  upsertBankRecognitionOverride,
} from './bankRecognitionOverrideStore.js'
import {
  getBankHistoricalRegistrySummary,
  isBankHistoricalRecognitionCorroborated,
  loadBankHistoricalRecognitions,
  upsertBankHistoricalRecognitions,
} from './bankHistoricalRegistryStore.js'
import { getBankIndividualPaymentFileSummary } from './bankIndividualPaymentStore.js'
import { NetSuiteClient } from './netsuiteClient.js'
import { loadOrSyncNetSuiteAccountCatalog } from './netsuiteAccountStore.js'
import { loadOrSyncNetSuiteEntityCatalog } from './netsuiteEntityStore.js'
import type {
  BankImportAnalyzeRequest,
  BankImportAnalyzeResponse,
  BankImportAnalysisMode,
  BankImportAnalysisRunResponse,
  BankImportAnalysisStartRequest,
  BankImportBalanceValidation,
  BankImportBankId,
  BankImportCandidateSearchResponse,
  BankImportConfigResponse,
  BankImportCreditDestinationSummary,
  BankImportCreditDestinationType,
  BankImportExcludedBucket,
  BankImportExcludedTypeMovement,
  BankImportExportRow,
  BankImportHistoricalUploadRequest,
  BankImportHistoricalUploadResponse,
  BankImportJournalPreview,
  BankImportMappingMethod,
  BankImportMappingSheet,
  BankImportNetSuiteRecognizedRow,
  BankImportNetSuiteSweep,
  BankImportNetSuiteSweepStatus,
  BankImportPostJournalResult,
  BankImportPostJournalsRequest,
  BankImportPostJournalsResponse,
  BankImportSaveCorrectionRequest,
  BankImportSaveCorrectionResponse,
  BankImportSaveValidatedBalanceRequest,
  BankImportSaveValidatedBalanceResponse,
  BankImportSuggestedCandidate,
  BankImportTransientCorrection,
  BankImportTransactionRule,
  BankImportTransactionTypeSummary,
  BankImportUnmatchedRow,
} from './types.js'

const DEFAULT_CUTOFF_DATE = process.env.BANKS_DEFAULT_CUTOFF_DATE ?? '2026-04-12'
const DEFAULT_ACCOUNTING_PERIOD =
  process.env.BANKS_DEFAULT_ACCOUNTING_PERIOD?.trim() || DEFAULT_CUTOFF_DATE.slice(0, 7)
const BANK_ANALYSIS_REQUEST_VERSION = '2026-04-24-bank-period-v1'
const MAPPING_WORKBOOK_PATH =
  process.env.BANKS_CLIENT_MAPPING_WORKBOOK_PATH ??
  'C:/Users/artur/Mi unidad/SHQ - Contabilidad (AMM)/ModelosFormatosSHQ/CargaPagos/CargaPagosModelo.xlsx'
const CUSTOMER_MAPPING_SHEET_NAME = process.env.BANKS_CLIENT_MAPPING_SHEET_NAME ?? 'Ingresos (Clientes)'
const PROVIDER_MAPPING_SHEET_NAME = process.env.BANKS_PROVIDER_MAPPING_SHEET_NAME ?? 'Proveedores'
const PAYANA_SAMPLE_FILE_PATH =
  process.env.BANKS_PAYANA_SAMPLE_FILE_PATH ?? 'C:/Users/artur/Downloads/transacciones_2026-04-20.xlsx'
const CLARA_CORRIENTE_SAMPLE_FILE_PATH =
  process.env.BANKS_CLARA_CORRIENTE_SAMPLE_FILE_PATH ??
  'C:/Users/artur/Mi unidad/SHQ Transit/Clara-payments-Apr 21, 2026, 12_46_17 PM.csv'
const BBVA_SAMPLE_FILE_PATH =
  process.env.BANKS_BBVA_SAMPLE_FILE_PATH ?? 'C:/Users/artur/Mi unidad/SHQ Transit/BBVA.pdf'
const PAYANA_DEBIT_ACCOUNT = '102-01-06 Bancos : Bancos Nacionales : Higo'
const CLARA_CORRIENTE_BANK_ACCOUNT =
  process.env.BANKS_CLARA_CORRIENTE_BANK_ACCOUNT ?? '102-01-08 Bancos : Bancos Nacionales : Clara Corriente'
const BBVA_BANK_ACCOUNT =
  process.env.BANKS_BBVA_BANK_ACCOUNT ?? '102-01-01 Bancos : Bancos Nacionales : BBVA-SHQ-1624'
const BBVA_BANXICO_DESTINATION_BANK_NAME = process.env.BANKS_BBVA_BANXICO_DESTINATION_BANK_NAME ?? 'BBVA'
const BBVA_BANXICO_BENEFICIARY_ACCOUNT =
  process.env.BANKS_BBVA_BANXICO_BENEFICIARY_ACCOUNT?.trim() || '012180001956416244'
const PAYANA_NETSUITE_REGISTER_ACCOUNT_ID = process.env.BANKS_PAYANA_NETSUITE_REGISTER_ACCOUNT_ID ?? '1765'
const CLARA_CORRIENTE_NETSUITE_REGISTER_ACCOUNT_ID =
  process.env.BANKS_CLARA_CORRIENTE_NETSUITE_REGISTER_ACCOUNT_ID?.trim() || '2104'
const BBVA_NETSUITE_REGISTER_ACCOUNT_ID = process.env.BANKS_BBVA_NETSUITE_REGISTER_ACCOUNT_ID?.trim() || '1366'
const DEFAULT_CUSTOMER_ACCOUNT_DISPLAY_NAME =
  process.env.BANKS_DEFAULT_CUSTOMER_ACCOUNT_DISPLAY_NAME ?? '105-01-00 Clientes : Clientes nacionales'
const DEFAULT_SUPPLIER_ACCOUNT_DISPLAY_NAME =
  process.env.BANKS_DEFAULT_SUPPLIER_ACCOUNT_DISPLAY_NAME ?? '201-02-00 Proveedores : Proveedores nacionales'
const BBVA_DELAY_COMPENSATION_INCOME_ACCOUNT =
  process.env.BANKS_BBVA_DELAY_COMPENSATION_INCOME_ACCOUNT ??
  '702-10-00 Productos financieros : Otros productos financieros'
const BBVA_DELAY_COMPENSATION_VENDOR_NAME =
  process.env.BANKS_BBVA_DELAY_COMPENSATION_VENDOR_NAME ?? 'BBVA Mexico SA'
const CF_TECH_VENDOR_NAME = process.env.BANKS_CF_TECH_VENDOR_NAME ?? 'CF Tech'
const HIGO_VENDOR_NAME =
  process.env.BANKS_HIGO_VENDOR_NAME ?? 'Concentradora Financiera Higo S de RL de CV'
const DEFAULT_JOURNAL_SUBSIDIARY_ID = process.env.BANKS_JOURNAL_SUBSIDIARY_ID ?? '1'
const DEFAULT_JOURNAL_CURRENCY_ID = process.env.BANKS_JOURNAL_CURRENCY_ID ?? '1'
const DEFAULT_JOURNAL_DEPARTMENT_ID = process.env.BANKS_JOURNAL_DEPARTMENT_ID ?? '1'
const DEFAULT_JOURNAL_LOCATION_ID = process.env.BANKS_JOURNAL_LOCATION_ID ?? '1'
const NETSUITE_RECOGNITION_MAX_DAY_DIFFERENCE = Number(
  process.env.BANKS_NETSUITE_RECOGNITION_MAX_DAY_DIFFERENCE ?? 1,
)
const SOFT_SUGGESTION_SCORE_THRESHOLD = Number(process.env.BANKS_SOFT_SUGGESTION_SCORE_THRESHOLD ?? 0.68)
const CANDIDATE_SEARCH_LIMIT = Number(process.env.BANKS_CANDIDATE_SEARCH_LIMIT ?? 8)
const AUTO_NETSUITE_SUGGESTION_LIMIT = Number(process.env.BANKS_AUTO_NETSUITE_SUGGESTION_LIMIT ?? 25)
const COT_OV_MAX_DAY_DIFFERENCE = Number(
  process.env.BANKS_COT_OV_MAX_DAY_DIFFERENCE ?? process.env.BANKS_BBVA_COT_OV_MAX_DAY_DIFFERENCE ?? 10,
)
const COT_OV_MAX_AMOUNT_DIFFERENCE = Number(
  process.env.BANKS_COT_OV_MAX_AMOUNT_DIFFERENCE ?? process.env.BANKS_BBVA_COT_OV_MAX_AMOUNT_DIFFERENCE ?? 1,
)
const COT_OV_EXPANDED_EXACT_DAY_DIFFERENCE = Number(
  process.env.BANKS_COT_OV_EXPANDED_EXACT_DAY_DIFFERENCE ??
    process.env.BANKS_BBVA_COT_OV_EXPANDED_EXACT_DAY_DIFFERENCE ??
    45,
)

type SupportedBankConfig = {
  id: BankImportBankId
  label: string
  debitAccount: string
  netsuiteRegisterAccountId: string | null
}

type ResolvedBankImportAnalysisStartRequest = Omit<BankImportAnalysisStartRequest, 'fileName' | 'fileBase64'> & {
  fileName: string
  fileBase64: string
}

type MappingSheetKey = 'customers' | 'suppliers'

type ImplicitBankMappingOverride = {
  bankName: string
  targetSheetKey: MappingSheetKey
  netsuiteName: string
}

type MappingEntry = {
  bankName: string
  normalizedBankName: string
  compactBankName: string
  netsuiteName: string
  creditAccount: string
  mappingSheetKey: MappingSheetKey
  mappingSheetName: string
}

type MappingSheetConfig = {
  key: MappingSheetKey
  sheetName: string
  bankNameField: string
  aliasBankNameFields?: string[]
  netsuiteNameField: string
}

type MappingCache = BankImportMappingSheet & {
  workbookName: string
  key: MappingSheetKey
  sheetName: string
  totalMappings: number
  exactDuplicates: number
  compactAmbiguous: number
  entries: MappingEntry[]
  exactMatches: Map<string, MappingEntry>
  compactMatches: Map<string, MappingEntry>
}

type LoadedMappings = Record<MappingSheetKey, MappingCache>

type ResolvedTransactionRule = BankImportTransactionRule & {
  normalizedTransactionType: string
  mappedAccountSide: 'debit' | 'credit' | null
}

type RecognitionDirection = 'incoming' | 'outgoing' | 'unknown'
type CounterpartySource = 'statement' | 'banxico_ordering_party'

type ParsedBankMovement = {
  rowIndex: number
  externalId: string
  correctionKey: string
  processingDate: Date
  processingTimestamp: string
  transactionDate: string
  transactionType: string
  transactionRule: ResolvedTransactionRule
  amount: number
  counterpartyName: string
  statementCounterpartyName: string | null
  counterpartySource: CounterpartySource
  orderingPartyName: string | null
  orderingPartyRfc: string | null
  orderingPartyAccount: string | null
  normalizedCounterpartyName: string
  compactCounterpartyName: string
  netsuiteName: string | null
  compactNetsuiteName: string
  entityInternalId?: string | null
  postingDisplayName?: string | null
  mappedAccount: string | null
  mappingSheetKey: MappingSheetKey | null
  mappingSheetName: string | null
  mappingMethod: BankImportMappingMethod
  paymentConcept: string | null
  compactPaymentConcept: string
  rfc: string | null
  trackingKey: string | null
  referenceNumber: string | null
  originBankName: string | null
  destinationBankName: string | null
  destinationAccount: string | null
  hashId: string | null
  recognitionDirection: RecognitionDirection
}

type BankImportFileLayoutId = 'payana_transacciones' | 'clara_payments' | 'clara_account_activity'

type BankImportParsedSourceRow = {
  processingDate: Date | null
  status: string
  amount: number | null
  transactionType: string
  counterpartyName: string
  statementCounterpartyName?: string | null
  counterpartySource?: CounterpartySource
  orderingPartyName?: string | null
  orderingPartyRfc?: string | null
  orderingPartyAccount?: string | null
  paymentConcept: string
  trackingKey: string
  hashId: string
  rfc: string | null
  originBankName?: string | null
  originAccount?: string | null
  destinationBankName?: string | null
  destinationAccount?: string | null
  referenceNumber?: string | null
}

type BankImportFileLayout = {
  id: BankImportFileLayoutId
  label: string
  requiredHeaders: string[]
  allowCrossSheetFallback: boolean
  parseRow: (row: Record<string, unknown>, index: number) => BankImportParsedSourceRow
}

type ParsedBankSource = {
  sourceProfileId: string
  parsedRows: BankImportParsedSourceRow[]
  allowCrossSheetFallback: boolean
}

type BbvaPdfMovement = {
  processingDate: Date
  headerText: string
  detailText: string
  amount: number
  balance: number | null
  direction: RecognitionDirection
  trackingKey: string | null
  referenceNumber: string | null
}

type NetSuiteRegisterLine = {
  key: string
  accountId: string
  accountLabel: string | null
  transactionId: string
  documentNumber: string | null
  transactionDate: Date
  transactionDateText: string
  transactionType: string | null
  entityName: string | null
  compactEntityName: string
  headerMemo: string | null
  compactHeaderMemo: string
  lineMemo: string | null
  compactLineMemo: string
  amount: number
  direction: RecognitionDirection
}

type NetSuiteSweepInternal = {
  status: BankImportNetSuiteSweepStatus
  accountId: string | null
  accountLabel: string | null
  registerLines: NetSuiteRegisterLine[]
  warning: string | null
}

type AccountingPeriodWindow = {
  token: string
  start: Date
  end: Date
  referenceDate: Date
}

type ExcludedBucketAmounts = {
  beforeCutoffAmount: number
  statusAmount: number
  typeAmount: number
}

type RecognitionMatch = {
  registerLine: NetSuiteRegisterLine
  matchRule: string
  score: number
  dayDifference: number
  textMatch: RecognitionTextMatch
}

type ManualRecognitionMatch = {
  netsuiteTransactionId: string
  netsuiteDocumentNumber: string | null
  netsuiteTransactionDate: string
  netsuiteTransactionType: string | null
  netsuiteEntityName: string | null
  netsuiteLineMemo: string | null
  netsuiteHeaderMemo: string | null
  mappingSheetKey: MappingSheetKey | null
  mappingSheetName: string | null
  creditAccount: string | null
  matchRule: string
  movementMatchSource: string
  netsuiteMatchSource: string
}

type RecognitionText = {
  source: string
  value: string
  tokens: string[]
}

type RecognitionTextMatch = {
  score: number
  label: string
  movementSource: string
  registerSource: string
  kind: 'exact' | 'approximate' | 'tokens'
}

type NetSuiteEntityCandidate = {
  internalId: string
  recordType: 'customer' | 'vendor'
  entityId: string
  altName: string
  companyName: string
  displayName: string
  accountDisplayName: string | null
  rfc: string
}

type JournalAccountResolution = {
  mappedAccount: string
  debitAccount: string
  creditAccount: string
  debitEntityName: string | null
  debitEntitySheetKey: MappingSheetKey | null
  debitEntityInternalId?: string | null
  debitEntityDisplayName?: string | null
  creditEntityName: string | null
  creditEntitySheetKey: MappingSheetKey | null
  creditEntityInternalId?: string | null
  creditEntityDisplayName?: string | null
  creditDestinationType: BankImportCreditDestinationType
  creditDestinationLabel: string
}

type ReadyJournalCandidate = {
  movement: ParsedBankMovement
  journal: BankImportJournalPreview
}

type ExistingBankJournalEvidenceCandidate = {
  id: string | null
  tranId: string | null
  externalId: string | null
  headerEntityName: string | null
  lineEntityName: string | null
  headerMemo: string | null
  lineMemo: string | null
}

type ExistingBankJournalEvidenceMatch = {
  candidate: ExistingBankJournalEvidenceCandidate
  textMatch: RecognitionTextMatch
  priority: number
}

type MonthlyRecognitionGapMatch = {
  movement: ParsedBankMovement
  journal: BankImportJournalPreview
  match: RecognitionMatch
}

type NetSuiteReferencePayload = {
  id: string
  refName?: string
}

type NetSuiteAccountCandidate = {
  internalId: string
  displayName: string
}

type HistoricalRecognitionInput = Parameters<typeof upsertBankHistoricalRecognitions>[0][number]

type HistoricalCorrectionCandidate = {
  candidate: BankImportSuggestedCandidate
  transactionType: string
}

type HistoricalCorrectionCandidateResolution =
  | {
      status: 'none'
      candidates: []
    }
  | {
      status: 'single'
      candidates: [HistoricalCorrectionCandidate]
    }
  | {
      status: 'multiple'
      candidates: HistoricalCorrectionCandidate[]
    }

type BbvaCotOvTransactionKind = 'estimate' | 'sales_order'

type BbvaCotOvMatch = {
  transactionKind: BbvaCotOvTransactionKind
  transactionId: string
  documentNumber: string | null
  transactionDate: string
  customerId: string | null
  customerName: string
  customerDisplayName: string
  customerPostingDisplayName: string | null
  creditAccount: string
  amount: number
  amountDifference: number
  dayDifference: number
  matchKind: 'exact' | 'close'
  relatedEstimateLabel?: string | null
  corroboratingInvoiceNumber?: string | null
  searchScope: 'standard' | 'expanded_exact'
}

type CotOvMatchSearchOptions = {
  maxDayDifference?: number
  maxAmountDifference?: number
  searchScope?: BbvaCotOvMatch['searchScope']
}

const implicitBankMappingOverrides: ImplicitBankMappingOverride[] = [
  {
    bankName: 'RAPYD NETWORKS MEXICO SAPI DE CV',
    targetSheetKey: 'suppliers',
    netsuiteName: 'Kontempo Mexico OPS',
  },
]

const supportedBanks: SupportedBankConfig[] = [
  {
    id: 'payana',
    label: 'Payana - Higo',
    debitAccount: PAYANA_DEBIT_ACCOUNT,
    netsuiteRegisterAccountId: PAYANA_NETSUITE_REGISTER_ACCOUNT_ID,
  },
  {
    id: 'clara_corriente',
    label: 'Clara Corriente',
    debitAccount: CLARA_CORRIENTE_BANK_ACCOUNT,
    netsuiteRegisterAccountId: CLARA_CORRIENTE_NETSUITE_REGISTER_ACCOUNT_ID,
  },
  {
    id: 'bbva',
    label: 'BBVA',
    debitAccount: BBVA_BANK_ACCOUNT,
    netsuiteRegisterAccountId: BBVA_NETSUITE_REGISTER_ACCOUNT_ID,
  },
]

type ClaraDepositBanxicoResolution = {
  counterpartyName: string
  rfc: string | null
  trackingKey: string | null
  orderingPartyAccount: string | null
}

type BbvaSpeiBanxicoResolution = {
  counterpartyName: string
  rfc: string | null
  trackingKey: string | null
  orderingPartyAccount: string | null
  originBankName: string | null
  destinationBankName: string | null
  destinationAccount: string | null
  referenceNumber: string
}

const banxicoInstitutionCatalogByDateCache = new Map<string, Promise<Awaited<ReturnType<typeof getBanxicoCepInstitutions>>>>()
const claraDepositBanxicoResolutionCache = new Map<string, Promise<ClaraDepositBanxicoResolution | null>>()
const bbvaSpeiBanxicoResolutionCache = new Map<string, Promise<BbvaSpeiBanxicoResolution | null>>()
const activeBankAnalysisRuns = new Map<string, Promise<void>>()
let bbvaCotOvCustomersByIdPromise: Promise<Map<string, NetSuiteEntityCandidate>> | null = null
const cotOvSalesOrderCreatedFromLabelCache = new Map<string, Promise<string | null>>()

const payanaTransaccionesFileLayout: BankImportFileLayout = {
  id: 'payana_transacciones',
  label: 'Payana transacciones',
  requiredHeaders: [
    'FECHA DE PROCESAMIENTO',
    'ESTADO',
    'MONTO',
    'TIPO DE TRANSACCION',
    'NOMBRE CONTRAPARTE',
  ],
  allowCrossSheetFallback: true,
  parseRow: (row) => ({
    processingDate: parseSpreadsheetDate(row['FECHA DE PROCESAMIENTO']),
    status: cleanText(row.ESTADO),
    amount: parseAmount(row.MONTO),
    transactionType: cleanText(row['TIPO DE TRANSACCION']),
    counterpartyName: cleanText(row['NOMBRE CONTRAPARTE']),
    statementCounterpartyName: cleanText(row['NOMBRE CONTRAPARTE']) || null,
    counterpartySource: 'statement',
    paymentConcept: cleanText(row['CONCEPTO DE PAGO']),
    trackingKey: cleanText(row['CLAVE DE RASTREO']),
    hashId: cleanText(row['HASH ID']),
    rfc: cleanText(row['RFC CONTRAPARTE']) || null,
  }),
}

const claraPaymentsFileLayout: BankImportFileLayout = {
  id: 'clara_payments',
  label: 'Clara pagos',
  requiredHeaders: [
    'FECHA DE ENVIO DEL PAGO',
    'RFC DEL BENEFICIARIO',
    'NOMBRE DEL BENEFICIARIO',
    'MONTO',
    'CONCEPTO',
    'REFERENCIA DE PAGO',
    'CLAVE DE RASTREO',
    'ESTADO',
  ],
  allowCrossSheetFallback: false,
  parseRow: (row) => {
    const repairedRow = repairShiftedClaraDelimitedRow(row, [
      'CONCEPTO',
      'REFERENCIA DE PAGO',
      'CLAVE DE RASTREO',
      'ESTADO',
    ])

    return {
      processingDate: parseSpreadsheetDate(repairedRow['FECHA DE ENVIO DEL PAGO']),
      status: normalizeClaraSourceStatus(repairedRow.ESTADO),
      amount: parseAmount(repairedRow.MONTO),
      transactionType: 'Pago',
      counterpartyName:
        cleanText(repairedRow['NOMBRE DEL BENEFICIARIO']) || cleanText(repairedRow['ALIAS DEL BENEFICIARIO']),
      statementCounterpartyName:
        cleanText(repairedRow['NOMBRE DEL BENEFICIARIO']) || cleanText(repairedRow['ALIAS DEL BENEFICIARIO']) || null,
      counterpartySource: 'statement',
      paymentConcept: cleanText(repairedRow.CONCEPTO),
      trackingKey: cleanText(repairedRow['CLAVE DE RASTREO']),
      hashId: cleanText(repairedRow['REFERENCIA DE PAGO']) || cleanText(repairedRow['FOLIO FISCAL']),
      rfc: cleanText(repairedRow['RFC DEL BENEFICIARIO']) || null,
    }
  },
}

const claraAccountActivityFileLayout: BankImportFileLayout = {
  id: 'clara_account_activity',
  label: 'Clara actividad de cuenta',
  requiredHeaders: [
    'ID',
    'TIPO',
    'BANCO ORIGEN',
    'CUENTA ORIGEN',
    'FECHA',
    'MONTO',
    'CONCEPTO',
    'CLAVE DE RASTREO',
    'REFERENCIA NUMERICA',
    'ESTADO',
  ],
  allowCrossSheetFallback: false,
  parseRow: (row) => {
    const repairedRow = repairShiftedClaraDelimitedRow(row, [
      'CONCEPTO',
      'CLAVE DE RASTREO',
      'REFERENCIA NUMERICA',
      'ESTADO',
    ])
    const statementCounterpartyName = buildClaraAccountActivityStatementDescriptor(repairedRow)
    const counterpartyName = resolveClaraAccountActivityCounterpartyName(repairedRow, statementCounterpartyName)

    return {
      processingDate: parseSpreadsheetDate(repairedRow.FECHA),
      status: normalizeClaraSourceStatus(repairedRow.ESTADO),
      amount: parseAmount(repairedRow.MONTO),
      transactionType: cleanText(repairedRow.TIPO),
      counterpartyName,
      statementCounterpartyName,
      counterpartySource: 'statement',
      paymentConcept: cleanText(repairedRow.CONCEPTO),
      trackingKey: cleanText(repairedRow['CLAVE DE RASTREO']),
      hashId: cleanText(repairedRow.ID),
      rfc: null,
      originBankName: cleanText(repairedRow['BANCO ORIGEN']) || null,
      originAccount: cleanText(repairedRow['CUENTA ORIGEN']) || null,
      destinationBankName: cleanText(repairedRow['BANCO DESTINO']) || null,
      destinationAccount: cleanText(repairedRow['CUENTA DESTINO']) || null,
      referenceNumber: cleanText(repairedRow['REFERENCIA NUMERICA']) || null,
    }
  },
}

const mappingSheetConfigs: MappingSheetConfig[] = [
  {
    key: 'customers',
    sheetName: CUSTOMER_MAPPING_SHEET_NAME,
    bankNameField: 'CLIENTE',
    netsuiteNameField: 'COLUMNA1',
  },
  {
    key: 'suppliers',
    sheetName: PROVIDER_MAPPING_SHEET_NAME,
    bankNameField: 'CLARA CORRIENTE',
    aliasBankNameFields: ['NOMBRE'],
    netsuiteNameField: 'NETSUITE',
  },
]

let mappingCache: LoadedMappings | null = null
let pdfRuntimePreparationPromise: Promise<void> | null = null

export class BankImportError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'BankImportError'
    this.status = status
  }
}

export function getBankImportConfig(): BankImportConfigResponse {
  const mappings = loadMappings()
  const customerMapping = mappings.customers
  const providerMapping = mappings.suppliers
  const historicalSummaryByBank = new Map(
    supportedBanks.map((bank) => [bank.id, getBankHistoricalRegistrySummary(bank.id)] as const),
  )
  const individualPaymentSummaryByBank = new Map(
    supportedBanks.map((bank) => [bank.id, getBankIndividualPaymentFileSummary(bank.id)] as const),
  )
  const sampleFilePathByBank = new Map(
    supportedBanks.map((bank) => {
      const sampleFilePath = resolveSampleFilePath(bank.id)
      return [bank.id, fs.existsSync(sampleFilePath) ? sampleFilePath : null] as const
    }),
  )
  const availableSampleFilePath = supportedBanks
    .map((bank) => sampleFilePathByBank.get(bank.id))
    .find((sampleFilePath): sampleFilePath is string => Boolean(sampleFilePath))

  return {
    defaultCutoffDate: formatDateOnly(startOfMonth(parseCutoffDate(DEFAULT_CUTOFF_DATE))),
    defaultAccountingPeriod: formatAccountingPeriod(
      parseAccountingPeriod(DEFAULT_ACCOUNTING_PERIOD) ?? startOfMonth(parseCutoffDate(DEFAULT_CUTOFF_DATE)),
    ),
    banks: supportedBanks.map((bank) => ({
      id: bank.id,
      label: bank.label,
      debitAccount: bank.debitAccount,
      sampleAnalysisAvailable: Boolean(sampleFilePathByBank.get(bank.id)),
      sampleFileName: path.basename(sampleFilePathByBank.get(bank.id) ?? '') || null,
      historicalRegistryAvailable: historicalSummaryByBank.get(bank.id)?.enabled ?? false,
      historicalStatementCount: historicalSummaryByBank.get(bank.id)?.statementCount ?? 0,
      historicalRecognizedRowCount: historicalSummaryByBank.get(bank.id)?.recognizedRowCount ?? 0,
      historicalReferenceCount: historicalSummaryByBank.get(bank.id)?.referenceCount ?? 0,
      historicalLastUpdatedAtUtc: historicalSummaryByBank.get(bank.id)?.lastUpdatedAtUtc ?? null,
      individualPaymentFileCount: individualPaymentSummaryByBank.get(bank.id)?.count ?? 0,
      individualPaymentLastUpdatedAtUtc: individualPaymentSummaryByBank.get(bank.id)?.lastUpdatedAtUtc ?? null,
    })),
    clientMapping: {
      workbookName: customerMapping.workbookName,
      sheetName: customerMapping.sheetName,
      totalMappings: customerMapping.totalMappings,
      exactDuplicates: customerMapping.exactDuplicates,
      compactAmbiguous: customerMapping.compactAmbiguous,
    },
    providerMapping: {
      workbookName: providerMapping.workbookName,
      sheetName: providerMapping.sheetName,
      totalMappings: providerMapping.totalMappings,
      exactDuplicates: providerMapping.exactDuplicates,
      compactAmbiguous: providerMapping.compactAmbiguous,
    },
    mappingSheets: [customerMapping, providerMapping].map((item) => ({
      key: item.key,
      workbookName: item.workbookName,
      sheetName: item.sheetName,
      totalMappings: item.totalMappings,
      exactDuplicates: item.exactDuplicates,
      compactAmbiguous: item.compactAmbiguous,
    })),
    transactionRules: getTransactionRules().map(stripResolvedTransactionRule),
    sampleAnalysisAvailable: Boolean(availableSampleFilePath),
    sampleFileName: availableSampleFilePath ? path.basename(availableSampleFilePath) : null,
  }
}

export async function searchBankImportCandidates({
  bankId,
  transactionType,
  query,
  rfc,
  correctionKey,
  trackingKey,
  referenceNumber,
}: {
  bankId: BankImportBankId
  transactionType: string
  query: string
  rfc?: string | null
  correctionKey?: string | null
  trackingKey?: string | null
  referenceNumber?: string | null
}): Promise<BankImportCandidateSearchResponse> {
  const bank = resolveBank(bankId)
  const transactionRule = resolveTransactionRule(transactionType)
  const sourceProfileId = correctionKey
    ? resolveSourceProfileIdFromCorrectionKey(correctionKey, bank.id, transactionType)
    : resolveSourceProfileIdForTransactionType(bank.id, transactionType)
  const mappings = loadMappingsForBank(bank.id, sourceProfileId)
  const cleanedQuery = cleanText(query)
  const cleanedRfc = cleanText(rfc)
  const cleanedTrackingKey = cleanText(trackingKey)
  const cleanedReferenceNumber = cleanText(referenceNumber)

  return {
    bankId: bank.id,
    transactionType: cleanText(transactionType) || 'Sin tipo',
    mappingSheetKey: transactionRule.mappingSheetKey,
    mappingSheetName: transactionRule.mappingSheetName,
    query: cleanedQuery,
    rfc: cleanedRfc || null,
    trackingKey: cleanedTrackingKey || null,
      candidates:
      cleanedQuery || cleanedRfc || cleanedTrackingKey
        ? await searchAllCorrectionCandidates(
            cleanedQuery || cleanedRfc || cleanedTrackingKey,
            mappings,
            transactionRule.mappingSheetKey,
            CANDIDATE_SEARCH_LIMIT,
            0.2,
            cleanedRfc || null,
            true,
            bank.id,
            cleanedTrackingKey || null,
            cleanedReferenceNumber || null,
            null,
          )
        : [],
  }
}

export function saveBankImportCorrection(request: BankImportSaveCorrectionRequest): BankImportSaveCorrectionResponse {
  const bank = resolveBank(request.bankId)
  const transactionType = cleanText(request.transactionType) || 'Sin tipo'
  const sourceProfileId = resolveSourceProfileIdFromCorrectionKey(request.correctionKey, bank.id, transactionType)
  const counterpartyName = cleanText(request.counterpartyName)
  if (!counterpartyName) {
    throw new BankImportError('Debes indicar la contraparte del banco a corregir.')
  }

  const selectedCandidate = request.selectedCandidate
  if (!selectedCandidate) {
    throw new BankImportError('Debes seleccionar una equivalencia para guardar la correccion.')
  }

  const mappingSheetKey = selectedCandidate.mappingSheetKey
  const mappings = loadMappings()
  const mappingSheet = mappings[mappingSheetKey]
  if (!mappingSheet) {
    throw new BankImportError('La hoja de equivalencias seleccionada no existe.')
  }

  const workbookCandidate = mappingSheet.entries.find(
    (item) =>
      item.bankName === cleanText(selectedCandidate.bankName) &&
      item.netsuiteName === cleanText(selectedCandidate.netsuiteName) &&
      item.creditAccount === cleanText(selectedCandidate.creditAccount),
  )
  const candidateSource = selectedCandidate.candidateSource ?? 'workbook'
  if (candidateSource === 'workbook' && !workbookCandidate) {
    throw new BankImportError('La equivalencia seleccionada ya no existe en el catalogo cargado.')
  }

  const selectedBankName = cleanText(selectedCandidate.bankName)
  const netsuiteName = cleanText(selectedCandidate.netsuiteName)
  const creditAccount = cleanText(selectedCandidate.creditAccount)
  if (!selectedBankName || !netsuiteName || !creditAccount) {
    throw new BankImportError('La equivalencia seleccionada no trae suficiente informacion para guardarse.')
  }

  const saved = upsertBankEquivalenceOverride({
    bankId: bank.id,
    sourceProfileId,
    mappingSheetKey,
    counterpartyName,
    normalizedCounterpartyName: normalizeText(counterpartyName),
    compactCounterpartyName: compactText(counterpartyName),
    selectedBankName: workbookCandidate?.bankName ?? selectedBankName,
    netsuiteName: workbookCandidate?.netsuiteName ?? netsuiteName,
    creditAccount: workbookCandidate?.creditAccount ?? creditAccount,
  })

  return {
    savedAtUtc: saved.updatedAtUtc,
    bankId: bank.id,
    transactionType,
    counterpartyName,
    mappingSheetKey,
    mappingSheetName: mappingSheet.sheetName,
    netsuiteName: saved.netsuiteName,
    creditAccount: saved.creditAccount,
  }
}

export async function analyzeBankImport(
  request: BankImportAnalyzeRequest,
  analysisMode: BankImportAnalysisMode = 'standard',
): Promise<BankImportAnalyzeResponse> {
  persistWorkingBankFileFromRequest(request)
  return analyzeBankImportInternal(request, analysisMode)
}

export function startBankImportAnalysisRun(request: BankImportAnalysisStartRequest): BankImportAnalysisRunResponse {
  const resolvedRequest = resolveBankImportAnalysisStartRequest(request)
  const analysisMode = resolveBankImportAnalysisMode(resolvedRequest.mode)
  const requestHash = buildBankAnalysisRequestHash(resolvedRequest, analysisMode)
  if (!resolvedRequest.forceRefresh) {
    const existingRun = findRunningBankAnalysisRunByHash({
      requestHash,
      bankId: resolvedRequest.bankId,
      mode: analysisMode,
    })
    if (existingRun) {
      return toBankAnalysisRunResponse(existingRun)
    }
  }

  const analysisId = createHash('sha1')
    .update([resolvedRequest.bankId, analysisMode, requestHash, new Date().toISOString()].join('|'))
    .digest('hex')
    .slice(0, 20)
  const accountingPeriodWindow = resolveRequestedAccountingPeriod(resolvedRequest)
  const cutoffDate = formatDateOnly(accountingPeriodWindow.start)
  const sourceFileName = cleanText(resolvedRequest.fileName)
  const createdRun = createBankAnalysisRun({
    analysisId,
    requestHash,
    bankId: resolvedRequest.bankId,
    sourceFileName,
    accountingPeriod: accountingPeriodWindow.token,
    cutoffDate,
    mode: analysisMode,
  })

  const executionPromise = analyzeBankImportInternal(resolvedRequest, analysisMode)
    .then((result) => {
      completeBankAnalysisRun(analysisId, 'completed', {
        result,
      })
    })
    .catch((error: unknown) => {
      completeBankAnalysisRun(analysisId, 'failed', {
        error: error instanceof Error ? error.message : 'Unknown bank analysis error.',
      })
    })
    .finally(() => {
      activeBankAnalysisRuns.delete(analysisId)
    })

  activeBankAnalysisRuns.set(analysisId, executionPromise)

  return toBankAnalysisRunResponse(createdRun)
}

export function recoverBankImportAnalysisRun(request: BankImportAnalysisStartRequest): BankImportAnalysisRunResponse {
  const resolvedRequest = resolveBankImportAnalysisStartRequest(request)
  const analysisMode = resolveBankImportAnalysisMode(resolvedRequest.mode)
  const requestHash = buildBankAnalysisRequestHash(resolvedRequest, analysisMode)
  if (!resolvedRequest.forceRefresh) {
    const latestRun = findLatestBankAnalysisRunByHash({
      requestHash,
      bankId: resolvedRequest.bankId,
      mode: analysisMode,
    })

    if (latestRun && isReusableStoredBankAnalysisRun(latestRun.result)) {
      return toBankAnalysisRunResponse(latestRun)
    }
  }

  return startBankImportAnalysisRun(resolvedRequest)
}

function isReusableStoredBankAnalysisRun(result: BankImportAnalyzeResponse | null) {
  if (!result) {
    return false
  }

  return Array.isArray(result.excludedTypeMovements)
}

export function getBankImportAnalysisRunStatus(analysisId: string): BankImportAnalysisRunResponse {
  const run = getBankAnalysisRun(analysisId)
  if (!run) {
    throw new BankImportError(`No encuentro la corrida bancaria ${cleanText(analysisId)}.`, 404)
  }

  return toBankAnalysisRunResponse(run)
}

async function analyzeBankImportInternal(
  request: BankImportAnalyzeRequest,
  analysisMode: BankImportAnalysisMode,
): Promise<BankImportAnalyzeResponse> {
  const bank = resolveBank(request.bankId)
  const accountingPeriodWindow = resolveRequestedAccountingPeriod(request)
  const sourceFileName = cleanText(request.fileName)
  if (!sourceFileName) {
    throw new BankImportError('Debes indicar el nombre del archivo bancario.')
  }

  const fileBuffer = parseBase64File(request.fileBase64)
  const sourceFileHash = createHash('sha1').update(fileBuffer).digest('hex')
  const parsedSource = await loadParsedBankSource(bank, sourceFileName, fileBuffer)

  return analyzeBankWorkbook({
    bank,
    accountingPeriodWindow,
    sourceFileHash,
    sourceProfileId: parsedSource.sourceProfileId,
    sourceFileName,
    analysisMode,
    transientCorrections: sanitizeTransientCorrections(request.transientCorrections),
    parsedRows: parsedSource.parsedRows,
    allowCrossSheetFallback: parsedSource.allowCrossSheetFallback,
  })
}

export async function analyzeBankImportSample(
  bankId: BankImportBankId,
  accountingPeriodRaw?: string | null,
  transientCorrections?: BankImportTransientCorrection[],
) {
  const bank = resolveBank(bankId)
  const accountingPeriodWindow = resolveRequestedAccountingPeriod({
    accountingPeriod: accountingPeriodRaw,
    cutoffDate: accountingPeriodRaw,
  })
  const sampleFilePath = resolveSampleFilePath(bank.id)

  if (!fs.existsSync(sampleFilePath)) {
    throw new BankImportError(`No encuentro el archivo de muestra ${path.basename(sampleFilePath)}.`, 404)
  }

  const sampleFileBuffer = fs.readFileSync(sampleFilePath)
  const sourceFileHash = createHash('sha1').update(sampleFileBuffer).digest('hex')
  const parsedSource = await loadParsedBankSource(bank, path.basename(sampleFilePath), sampleFileBuffer)

  return analyzeBankWorkbook({
    bank,
    accountingPeriodWindow,
    sourceFileHash,
    sourceProfileId: parsedSource.sourceProfileId,
    sourceFileName: path.basename(sampleFilePath),
    analysisMode: 'standard',
    transientCorrections: sanitizeTransientCorrections(transientCorrections),
    parsedRows: parsedSource.parsedRows,
    allowCrossSheetFallback: parsedSource.allowCrossSheetFallback,
  })
}

export async function uploadBankHistoricalStatement(
  request: BankImportHistoricalUploadRequest,
): Promise<BankImportHistoricalUploadResponse> {
  const bank = resolveBank(request.bankId)
  if (bank.id !== 'bbva') {
    throw new BankImportError('El registro historico manual por estados previos solo esta habilitado para BBVA.')
  }

  const sourceFileName = cleanText(request.fileName)
  if (!sourceFileName) {
    throw new BankImportError('Debes indicar el nombre del estado de cuenta historico.')
  }

  const fileBuffer = parseBase64File(request.fileBase64)
  const sourceFileHash = createHash('sha1').update(fileBuffer).digest('hex')
  const parsedSource = await loadParsedBankSource(bank, sourceFileName, fileBuffer)
  const historicalCutoffDate = deriveHistoricalCutoffDate(parsedSource.parsedRows)
  const historicalProcessingDates = parsedSource.parsedRows
    .map((row) => (row.processingDate ? startOfDay(row.processingDate) : null))
    .filter((row): row is Date => row !== null)
    .sort((left, right) => left.getTime() - right.getTime())
  const historicalPeriodStart =
    historicalProcessingDates[0] ?? startOfDay(addDays(historicalCutoffDate, 1))
  const historicalPeriodEnd = historicalProcessingDates[historicalProcessingDates.length - 1] ?? historicalPeriodStart
  const analysis = await analyzeBankWorkbook({
    bank,
    accountingPeriodWindow: {
      token: formatAccountingPeriod(historicalPeriodStart),
      start: historicalPeriodStart,
      end: historicalPeriodEnd,
      referenceDate: historicalPeriodEnd,
    },
    sourceFileHash,
    sourceProfileId: parsedSource.sourceProfileId,
    sourceFileName,
    analysisMode: 'standard',
    transientCorrections: [],
    parsedRows: parsedSource.parsedRows,
    allowCrossSheetFallback: parsedSource.allowCrossSheetFallback,
  })

  const sourceDigest = buildHistoricalSourceDigest(bank.id, parsedSource.sourceProfileId, sourceFileName)
  const recognizedEntries = analysis.netsuiteSweep.matches
    .filter((item) => item.mappingSheetKey && item.netsuiteEntityName)
    .map((item) => ({
      bankId: bank.id,
      sourceProfileId: parsedSource.sourceProfileId,
      sourceFileName,
      sourceDigest,
      transactionType: item.transactionType,
      mappingSheetKey: item.mappingSheetKey!,
      mappingSheetName: item.mappingSheetName ?? resolveMappingSheetName(item.mappingSheetKey!),
      transactionDate: item.transactionDate,
      processingTimestamp: item.processingTimestamp,
      counterpartyName: item.counterpartyName,
      paymentConcept: item.paymentConcept,
      trackingKey: item.trackingKey,
      referenceNumber: extractBbvaReferenceNumber(item.paymentConcept, item.counterpartyName, item.trackingKey),
      hashId: item.hashId,
      amount: item.amount,
      netsuiteName: item.netsuiteEntityName!,
      creditAccount: item.creditAccount ?? '',
      netsuiteTransactionId: item.netsuiteTransactionId,
      netsuiteDocumentNumber: item.netsuiteDocumentNumber,
    }))
    .filter(isBankHistoricalRecognitionCorroborated)

  const historicalReferenceEntries = await findBbvaHistoricalReferenceCorroborations({
    bank,
    sourceProfileId: parsedSource.sourceProfileId,
    sourceFileName,
    sourceDigest,
    cutoffDate: historicalCutoffDate,
    unmatchedRows: analysis.unmatched,
  })

  const stored = upsertBankHistoricalRecognitions([...recognizedEntries, ...historicalReferenceEntries])
  const summary = getBankHistoricalRegistrySummary(bank.id)

  return {
    bankId: bank.id,
    sourceFileName,
    statementWindow: analysis.statementWindow,
    parsedRows: parsedSource.parsedRows.length,
    recognizedRows: analysis.netsuiteSweep.matches.length,
    storedRows: stored.items.filter((item) => item.bankId === bank.id && isBankHistoricalRecognitionCorroborated(item)).length,
    storedReferences: summary.referenceCount,
    historicalStatementCount: summary.statementCount,
    historicalLastUpdatedAtUtc: summary.lastUpdatedAtUtc,
  }
}

function persistResolvedBbvaHistoricalRecognitionsFromPostResults({
  bank,
  sourceFileName,
  journals,
  items,
  dryRun,
}: {
  bank: SupportedBankConfig
  sourceFileName?: string | null
  journals: BankImportJournalPreview[]
  items: BankImportPostJournalResult[]
  dryRun: boolean
}) {
  if (bank.id !== 'bbva' || dryRun) {
    return
  }

  const successfulItemsByExternalId = new Map(
    items.filter(canPersistConfirmedJournalPostResult).map((item) => [item.externalId, item] as const),
  )

  journals.forEach((journal) => {
    const outcome = successfulItemsByExternalId.get(journal.externalId)
    if (!outcome) {
      return
    }

    const mappingSheetKey =
      journal.creditEntitySheetKey ??
      journal.debitEntitySheetKey ??
      resolveTransactionRule(journal.transactionType).mappingSheetKey

    if (!mappingSheetKey) {
      return
    }

    persistResolvedBbvaHistoricalRecognition({
      bank,
      sourceProfileId: resolveSourceProfileIdFromCorrectionKey(journal.correctionKey, bank.id, journal.transactionType),
      sourceFileName,
      transactionType: journal.transactionType,
      mappingSheetKey,
      mappingSheetName: journal.mappingSheetName,
      transactionDate: journal.transactionDate,
      processingTimestamp: journal.processingTimestamp,
      counterpartyName: journal.counterpartyName,
      paymentConcept: journal.paymentConcept,
      trackingKey: journal.trackingKey,
      referenceNumber: journal.referenceNumber,
      hashId: journal.hashId,
      amount: journal.amount,
      netsuiteName: journal.netsuiteName,
      creditAccount: journal.mappedAccount,
      netsuiteTransactionId: outcome.netsuiteRecordId,
      netsuiteDocumentNumber: outcome.netsuiteTranId,
    })
  })
}

function persistBankRecognitionOverridesFromPostResults({
  bank,
  journals,
  items,
  dryRun,
}: {
  bank: SupportedBankConfig
  journals: BankImportJournalPreview[]
  items: BankImportPostJournalResult[]
  dryRun: boolean
}) {
  if (dryRun) {
    return
  }

  const successfulItemsByExternalId = new Map(
    items
      .filter((item) => canPersistConfirmedJournalPostResult(item) && item.netsuiteRecordId)
      .map((item) => [item.externalId, item] as const),
  )

  journals.forEach((journal) => {
    const outcome = successfulItemsByExternalId.get(journal.externalId)
    if (!outcome?.netsuiteRecordId) {
      return
    }

    const transactionRule = resolveTransactionRule(journal.transactionType)
    upsertBankRecognitionOverride({
      bankId: bank.id,
      sourceProfileId: resolveSourceProfileIdFromCorrectionKey(journal.correctionKey, bank.id, journal.transactionType),
      transactionType: journal.transactionType,
      transactionDate: journal.transactionDate,
      amount: journal.amount,
      counterpartyName: journal.counterpartyName,
      trackingKey: journal.trackingKey,
      referenceNumber: journal.referenceNumber,
      orderingPartyAccount: journal.orderingPartyAccount,
      originBankName: journal.originBankName,
      destinationBankName: journal.destinationBankName,
      netsuiteTransactionId: outcome.netsuiteRecordId,
      netsuiteDocumentNumber: outcome.netsuiteTranId,
      netsuiteTransactionDate: journal.transactionDate,
      netsuiteTransactionType: 'Diario',
      netsuiteEntityName: journal.postingDisplayName ?? journal.netsuiteName,
      netsuiteLineMemo: journal.lineMemo,
      netsuiteHeaderMemo: journal.memo,
      mappingSheetKey: journal.creditEntitySheetKey ?? journal.debitEntitySheetKey ?? transactionRule.mappingSheetKey,
      mappingSheetName: journal.mappingSheetName ?? transactionRule.mappingSheetName,
      creditAccount: journal.mappedAccount,
      source: 'journal_upload_result',
    })
  })
}

function canPersistConfirmedJournalPostResult(item: BankImportPostJournalResult) {
  return item.status === 'created' || (item.status === 'skipped' && item.skipReason === 'external_id')
}

function persistResolvedBbvaHistoricalRecognition({
  bank,
  sourceProfileId,
  sourceFileName,
  transactionType,
  mappingSheetKey,
  mappingSheetName,
  transactionDate,
  processingTimestamp,
  counterpartyName,
  paymentConcept,
  trackingKey,
  referenceNumber,
  hashId,
  amount,
  netsuiteName,
  creditAccount,
  netsuiteTransactionId,
  netsuiteDocumentNumber,
}: {
  bank: SupportedBankConfig
  sourceProfileId: string
  sourceFileName?: string | null
  transactionType: string
  mappingSheetKey: MappingSheetKey | null
  mappingSheetName: string | null
  transactionDate?: string | null
  processingTimestamp?: string | null
  counterpartyName: string
  paymentConcept?: string | null
  trackingKey?: string | null
  referenceNumber?: string | null
  hashId?: string | null
  amount?: number | null
  netsuiteName: string
  creditAccount: string
  netsuiteTransactionId: string | null
  netsuiteDocumentNumber: string | null
}) {
  if (bank.id !== 'bbva' || !mappingSheetKey) {
    return
  }

  if (!cleanText(netsuiteTransactionId) && !cleanText(netsuiteDocumentNumber)) {
    return
  }

  const cleanedTrackingKey = cleanText(trackingKey)
  const cleanedReferenceNumber = isBbvaStableHistoricalReferenceNumber(referenceNumber)
    ? cleanDigits(referenceNumber)
    : extractBbvaReferenceNumber(paymentConcept, counterpartyName)
  const cleanedHashId = cleanText(hashId)
  const cleanedTransactionDate = cleanText(transactionDate)
  const cleanedProcessingTimestamp = cleanText(processingTimestamp) || cleanedTransactionDate
  const cleanedCounterpartyName = cleanText(counterpartyName)
  const cleanedNetsuiteName = cleanText(netsuiteName)
  const resolvedCreditAccount = resolveHistoricalCreditAccount(mappingSheetKey, creditAccount)
  const normalizedAmount = typeof amount === 'number' && Number.isFinite(amount) ? amount : null

  if (
    (!cleanedTrackingKey && !cleanedReferenceNumber && !cleanedHashId) ||
    !cleanedTransactionDate ||
    !cleanedProcessingTimestamp ||
    !cleanedCounterpartyName ||
    !cleanedNetsuiteName ||
    !resolvedCreditAccount ||
    normalizedAmount === null
  ) {
    return
  }

  const resolvedSourceFileName = cleanText(sourceFileName) || `BBVA ${cleanedTransactionDate}`
  const sourceDigest = buildHistoricalSourceDigest(bank.id, sourceProfileId, resolvedSourceFileName)

  upsertBankHistoricalRecognitions([
    {
      bankId: bank.id,
      sourceProfileId,
      sourceFileName: resolvedSourceFileName,
      sourceDigest,
      transactionType: cleanText(transactionType) || 'Sin tipo',
      mappingSheetKey,
      mappingSheetName: mappingSheetName ?? resolveMappingSheetName(mappingSheetKey),
      transactionDate: cleanedTransactionDate,
      processingTimestamp: cleanedProcessingTimestamp,
      counterpartyName: cleanedCounterpartyName,
      paymentConcept: cleanText(paymentConcept) || null,
      trackingKey: cleanedTrackingKey || null,
      referenceNumber: cleanedReferenceNumber || null,
      hashId: cleanedHashId || null,
      amount: normalizedAmount,
      netsuiteName: cleanedNetsuiteName,
      creditAccount: resolvedCreditAccount,
      netsuiteTransactionId,
      netsuiteDocumentNumber,
    },
  ])
}

async function findBbvaHistoricalReferenceCorroborations({
  bank,
  sourceProfileId,
  sourceFileName,
  sourceDigest,
  cutoffDate,
  unmatchedRows,
}: {
  bank: SupportedBankConfig
  sourceProfileId: string
  sourceFileName: string
  sourceDigest: string
  cutoffDate: Date
  unmatchedRows: BankImportUnmatchedRow[]
}): Promise<HistoricalRecognitionInput[]> {
  if (bank.id !== 'bbva') {
    return []
  }

  const targetRows = unmatchedRows.filter(
    (row): row is BankImportUnmatchedRow & { mappingSheetKey: MappingSheetKey } =>
      Boolean(
        row.mappingSheetKey &&
          (isBbvaStableHistoricalTrackingKey(row.trackingKey) || isBbvaStableHistoricalReferenceNumber(row.referenceNumber)),
      ),
  )
  if (targetRows.length === 0) {
    return []
  }

  const netsuiteSweep = await fetchNetSuiteSweep(bank, cutoffDate)
  if (netsuiteSweep.status !== 'applied' || netsuiteSweep.registerLines.length === 0) {
    return []
  }

  const usedRegisterLineKeys = new Set<string>()
  const corroboratedEntries: HistoricalRecognitionInput[] = []

  for (const row of targetRows) {
    const registerMatch = findBbvaHistoricalReferenceRegisterMatch(row, netsuiteSweep.registerLines, usedRegisterLineKeys)
    if (!registerMatch) {
      continue
    }

    usedRegisterLineKeys.add(registerMatch.registerLine.key)
    const resolvedEntity = await resolveHistoricalEntityFromRegisterLine(
      row.mappingSheetKey,
      registerMatch.registerLine.entityName,
    )
    const resolvedMappingSheetKey = resolvedEntity?.mappingSheetKey ?? row.mappingSheetKey

    corroboratedEntries.push({
      bankId: bank.id,
      sourceProfileId,
      sourceFileName,
      sourceDigest,
      transactionType:
        resolvedMappingSheetKey === 'customers'
          ? 'Cobro'
          : resolvedMappingSheetKey === 'suppliers'
          ? 'Pago'
          : cleanText(row.transactionType) || 'Sin tipo',
      mappingSheetKey: resolvedMappingSheetKey,
      mappingSheetName: resolveMappingSheetName(resolvedMappingSheetKey),
      transactionDate: row.transactionDate,
      processingTimestamp: row.processingTimestamp,
      counterpartyName: row.counterpartyName,
      paymentConcept: row.paymentConcept,
      trackingKey: row.trackingKey,
      referenceNumber: row.referenceNumber,
      hashId: row.hashId,
      amount: row.amount,
      netsuiteName: resolvedEntity?.netsuiteName || cleanText(registerMatch.registerLine.entityName) || row.counterpartyName,
      creditAccount: resolvedEntity?.creditAccount ?? resolveHistoricalCreditAccount(resolvedMappingSheetKey, ''),
      netsuiteTransactionId: registerMatch.registerLine.transactionId,
      netsuiteDocumentNumber: registerMatch.registerLine.documentNumber,
    })
  }

  return corroboratedEntries.filter(isBankHistoricalRecognitionCorroborated)
}

function findBbvaHistoricalReferenceRegisterMatch(
  row: Pick<BankImportUnmatchedRow, 'transactionDate' | 'amount' | 'trackingKey' | 'referenceNumber'>,
  registerLines: NetSuiteRegisterLine[],
  usedRegisterLineKeys: Set<string>,
): {
  registerLine: NetSuiteRegisterLine
  score: number
} | null {
  const movementDate = parseSpreadsheetDate(row.transactionDate)
  const searchTokens = buildBbvaHistoricalReferenceSearchTokens(row)
  if (!movementDate || searchTokens.length === 0) {
    return null
  }

  let bestMatch:
    | {
        registerLine: NetSuiteRegisterLine
        score: number
      }
    | null = null
  let bestMatchCount = 0

  registerLines.forEach((registerLine) => {
    if (usedRegisterLineKeys.has(registerLine.key) || !amountsMatch(row.amount, registerLine.amount)) {
      return
    }

    const dayDifference = getDayDifference(movementDate, registerLine.transactionDate)
    if (dayDifference > NETSUITE_RECOGNITION_MAX_DAY_DIFFERENCE) {
      return
    }

    const evidence = getBbvaHistoricalReferenceEvidence(searchTokens, buildBbvaRegisterSearchText(registerLine))
    if (!evidence) {
      return
    }

    const score = dayDifference * 10 + evidence.priority
    if (!bestMatch || score < bestMatch.score) {
      bestMatch = {
        registerLine,
        score,
      }
      bestMatchCount = 1
      return
    }

    if (score === bestMatch.score) {
      bestMatchCount += 1
    }
  })

  if (!bestMatch || bestMatchCount !== 1) {
    return null
  }

  return bestMatch
}

async function resolveExactNetSuiteEntityForSheet(
  mappingSheetKey: MappingSheetKey,
  entityName: string | null,
): Promise<{
  netsuiteName: string
  creditAccount: string
} | null> {
  const cleanedEntityName = cleanText(entityName)
  if (!cleanedEntityName) {
    return null
  }

  const normalizedTarget = normalizeText(cleanedEntityName)
  const compactTarget = compactText(stripLeadingEntityCode(cleanedEntityName))
  const entities = await fetchNetSuiteEntityCandidates(mappingSheetKey)
  const match =
    entities.find((entity) => normalizeText(formatNetSuiteEntityDisplayName(entity)) === normalizedTarget) ??
    entities.find((entity) => normalizeText(entity.altName) === normalizedTarget) ??
    entities.find((entity) => normalizeText(entity.companyName) === normalizedTarget) ??
    entities.find((entity) => normalizeText(entity.entityId) === normalizedTarget) ??
    entities.find((entity) => compactText(formatNetSuiteEntityDisplayName(entity)) === compactTarget) ??
    entities.find((entity) => compactText(entity.altName) === compactTarget) ??
    entities.find((entity) => compactText(entity.companyName) === compactTarget) ??
    entities.find((entity) => compactText(entity.entityId) === compactTarget)

  if (!match) {
    return null
  }

  return {
    netsuiteName: formatNetSuiteEntityDisplayName(match),
    creditAccount: resolveHistoricalCreditAccount(mappingSheetKey, match.accountDisplayName ?? ''),
  }
}

async function resolveHistoricalEntityFromRegisterLine(
  mappingSheetKey: MappingSheetKey,
  entityName: string | null,
): Promise<{
  mappingSheetKey: MappingSheetKey
  netsuiteName: string
  creditAccount: string
} | null> {
  const candidateSheetKeys = getMappingSheetKeys(mappingSheetKey, true)

  for (const candidateSheetKey of candidateSheetKeys) {
    const resolvedEntity = await resolveExactNetSuiteEntityForSheet(candidateSheetKey, entityName)
    if (!resolvedEntity) {
      continue
    }

    return {
      mappingSheetKey: candidateSheetKey,
      netsuiteName: resolvedEntity.netsuiteName,
      creditAccount: resolvedEntity.creditAccount,
    }
  }

  return null
}

function buildBbvaHistoricalReferenceSearchTokens(
  row: Pick<BankImportUnmatchedRow, 'trackingKey' | 'referenceNumber'>,
): Array<{
  token: string
  priority: number
}> {
  const tokens: Array<{
    token: string
    priority: number
  }> = []
  const cleanedTrackingKey = cleanText(row.trackingKey)
  const cleanedReferenceNumber = cleanText(row.referenceNumber)

  const bbvaTrackingMatch = /^(?:REF)?(BNTC[0-9A-Z]+)$/iu.exec(cleanedTrackingKey)
  if (bbvaTrackingMatch) {
    tokens.push({
      token: compactText(bbvaTrackingMatch[1]),
      priority: 0,
    })
    tokens.push({
      token: compactText(`REF${bbvaTrackingMatch[1]}`),
      priority: 1,
    })
  }

  if (isBbvaStableHistoricalReferenceNumber(cleanedReferenceNumber)) {
    const compactReferenceNumber = compactText(cleanedReferenceNumber)
    tokens.push({
      token: `BNET${compactReferenceNumber}`,
      priority: 0,
    })
    tokens.push({
      token: compactReferenceNumber,
      priority: 1,
    })
  }

  const seenTokens = new Set<string>()
  return tokens.filter((token) => {
    if (!token.token || seenTokens.has(token.token)) {
      return false
    }

    seenTokens.add(token.token)
    return true
  })
}

function getBbvaHistoricalReferenceEvidence(
  searchTokens: Array<{
    token: string
    priority: number
  }>,
  registerSearchText: string,
): {
  priority: number
} | null {
  let bestEvidence:
    | {
        priority: number
      }
    | null = null

  searchTokens.forEach((searchToken) => {
    if (!registerSearchText.includes(searchToken.token)) {
      return
    }

    if (!bestEvidence || searchToken.priority < bestEvidence.priority) {
      bestEvidence = {
        priority: searchToken.priority,
      }
    }
  })

  return bestEvidence
}

function buildBbvaRegisterSearchText(registerLine: NetSuiteRegisterLine) {
  return compactText([registerLine.lineMemo, registerLine.headerMemo, registerLine.entityName].filter(Boolean).join(' | '))
}

function buildHistoricalSourceDigest(bankId: BankImportBankId, sourceProfileId: string, sourceFileName: string) {
  return createHash('sha1')
    .update([bankId, sourceProfileId, cleanText(sourceFileName) || 'unknown'].join('|'))
    .digest('hex')
}

async function loadParsedBankSource(
  bank: SupportedBankConfig,
  sourceFileName: string,
  fileBuffer: Buffer,
): Promise<ParsedBankSource> {
  if (isPdfBankSourceFile(sourceFileName, fileBuffer)) {
    return parsePdfBankSource(bank, sourceFileName, fileBuffer)
  }

  const workbook = XLSX.read(fileBuffer, {
    type: 'buffer',
    cellDates: true,
  })

  return parseSpreadsheetBankSource(bank, workbook)
}

function deriveHistoricalCutoffDate(parsedRows: BankImportParsedSourceRow[]) {
  const orderedProcessingDates = parsedRows
    .map((row) => row.processingDate)
    .filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()))
    .sort((left, right) => left.getTime() - right.getTime())

  const firstProcessingDate = orderedProcessingDates[0]
  if (!firstProcessingDate) {
    throw new BankImportError('No pude identificar fechas dentro del estado historico de BBVA.')
  }

  const cutoffDate = new Date(firstProcessingDate)
  cutoffDate.setDate(cutoffDate.getDate() - 1)
  return cutoffDate
}

function resolveMappingSheetName(mappingSheetKey: MappingSheetKey) {
  const mappings = loadMappings()
  return mappings[mappingSheetKey]?.sheetName ?? mappingSheetKey
}

function parseSpreadsheetBankSource(bank: SupportedBankConfig, workbook: XLSX.WorkBook): ParsedBankSource {
  const sheet = workbook.Sheets.Transacciones ?? workbook.Sheets[workbook.SheetNames[0] ?? '']
  if (!sheet) {
    throw new BankImportError('El archivo bancario no trae una hoja utilizable.', 400)
  }

  const rows = readWorksheetRecords(sheet)
  if (rows.length === 0) {
    throw new BankImportError('El archivo bancario no contiene movimientos para analizar.', 400)
  }

  const fileLayout = detectBankImportFileLayout(bank, rows)
  return {
    sourceProfileId: fileLayout.id,
    parsedRows: rows.map((rawRow, index) => fileLayout.parseRow(normalizeRecordKeys(rawRow), index)),
    allowCrossSheetFallback: fileLayout.allowCrossSheetFallback,
  }
}

async function parsePdfBankSource(
  bank: SupportedBankConfig,
  sourceFileName: string,
  fileBuffer: Buffer,
): Promise<ParsedBankSource> {
  if (bank.id !== 'bbva') {
    throw new BankImportError(
      `El archivo ${path.basename(sourceFileName)} es PDF, pero ${bank.label} solo soporta Excel o CSV por ahora.`,
      400,
    )
  }

  await preparePdfRuntime()
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: fileBuffer })
  try {
    return {
      sourceProfileId: 'bbva_pdf',
      parsedRows: parseBbvaPdfText((await parser.getText()).text),
      allowCrossSheetFallback: false,
    }
  } finally {
    await parser.destroy().catch(() => undefined)
  }
}

async function preparePdfRuntime() {
  if (pdfRuntimePreparationPromise) {
    return pdfRuntimePreparationPromise
  }

  pdfRuntimePreparationPromise = (async () => {
    const pdfGlobals = globalThis as Record<string, unknown>

    if (pdfGlobals.DOMMatrix && pdfGlobals.ImageData && pdfGlobals.Path2D) {
      return
    }

    const canvasRuntime = (await import('@napi-rs/canvas')) as {
      DOMMatrix?: unknown
      ImageData?: unknown
      Path2D?: unknown
    }

    if (!pdfGlobals.DOMMatrix && canvasRuntime.DOMMatrix) {
      pdfGlobals.DOMMatrix = canvasRuntime.DOMMatrix
    }

    if (!pdfGlobals.ImageData && canvasRuntime.ImageData) {
      pdfGlobals.ImageData = canvasRuntime.ImageData
    }

    if (!pdfGlobals.Path2D && canvasRuntime.Path2D) {
      pdfGlobals.Path2D = canvasRuntime.Path2D
    }
  })().catch((error) => {
    pdfRuntimePreparationPromise = null
    throw error
  })

  return pdfRuntimePreparationPromise
}

export async function postBankImportJournals(
  request: BankImportPostJournalsRequest,
): Promise<BankImportPostJournalsResponse> {
  const bank = resolveBank(request.bankId)
  const journals = Array.isArray(request.journals) ? request.journals : []
  const dryRun = Boolean(request.dryRun)

  if (journals.length === 0) {
    throw new BankImportError('No hay diarios listos para enviar a NetSuite.')
  }

  const client = NetSuiteClient.fromEnv()
  const items: BankImportPostJournalResult[] = []

  for (const journal of journals) {
    try {
      const validatedJournal = validatePostableJournal(journal)
      const existing = await findExistingBankJournalByExternalId(client, validatedJournal.externalId)
      if (existing) {
        items.push({
          externalId: validatedJournal.externalId,
          counterpartyName: validatedJournal.counterpartyName,
          transactionDate: validatedJournal.transactionDate,
          amount: validatedJournal.amount,
          status: 'skipped',
          skipReason: 'external_id',
          netsuiteRecordId: existing.id,
          netsuiteTranId: existing.tranId,
          message: `Ya existe un diario con externalId ${validatedJournal.externalId}.`,
        })
        continue
      }

      const existingByEvidence = await findExistingBankJournalByMovementEvidence(client, validatedJournal, bank)
      if (existingByEvidence) {
        items.push({
          externalId: validatedJournal.externalId,
          counterpartyName: validatedJournal.counterpartyName,
          transactionDate: validatedJournal.transactionDate,
          amount: validatedJournal.amount,
          status: 'skipped',
          skipReason: 'movement_evidence',
          netsuiteRecordId: existingByEvidence.id,
          netsuiteTranId: existingByEvidence.tranId,
          message: existingByEvidence.externalId
            ? `Ya existe un diario para este movimiento (${existingByEvidence.externalId}) detectado por fecha, importe y memo de linea.`
            : 'Ya existe un diario para este movimiento detectado por fecha, importe y memo de linea.',
        })
        continue
      }

      const payload = await buildBankJournalCreatePayload(client, validatedJournal, bank)
      if (dryRun) {
        items.push({
          externalId: validatedJournal.externalId,
          counterpartyName: validatedJournal.counterpartyName,
          transactionDate: validatedJournal.transactionDate,
          amount: validatedJournal.amount,
          status: 'dry_run',
          netsuiteRecordId: null,
          netsuiteTranId: null,
          message: 'Payload validado para alta individual en NetSuite.',
        })
        continue
      }

      const createResponse = await client.createRecord('journalEntry', payload)
      const createdRecord = getNullableRecord(createResponse.json)
      const journalId = normalizeCreatedRecordId(
        getNullableString(createdRecord?.id) ?? parseRecordIdFromLocation(createResponse.location),
      )

      let tranId = getNullableString(createdRecord?.tranId)
      if (journalId && !tranId) {
        const freshRecord = await client.getRecord('journalEntry', journalId)
        tranId = getNullableString(getNullableRecord(freshRecord.json)?.tranId)
      }

      items.push({
        externalId: validatedJournal.externalId,
        counterpartyName: validatedJournal.counterpartyName,
        transactionDate: validatedJournal.transactionDate,
        amount: validatedJournal.amount,
        status: 'created',
        netsuiteRecordId: journalId,
        netsuiteTranId: tranId,
        message: 'Diario individual creado en NetSuite.',
      })
    } catch (error) {
      const fallbackExternalId = cleanText(journal.externalId) || '(sin externalId)'
      const fallbackCounterpartyName = resolveJournalCounterpartyName(journal) || '(sin contraparte)'
      const fallbackTransactionDate = cleanText(journal.transactionDate) || '(sin fecha)'
      const fallbackAmount =
        typeof journal.amount === 'number' && Number.isFinite(journal.amount) ? journal.amount : 0

      items.push({
        externalId: fallbackExternalId,
        counterpartyName: fallbackCounterpartyName,
        transactionDate: fallbackTransactionDate,
        amount: fallbackAmount,
        status: 'failed',
        netsuiteRecordId: null,
        netsuiteTranId: null,
        message: error instanceof Error ? error.message : 'Fallo desconocido al crear el diario en NetSuite.',
      })
    }
  }

  persistResolvedBbvaHistoricalRecognitionsFromPostResults({
    bank,
    sourceFileName: request.sourceFileName,
    journals,
    items,
    dryRun,
  })
  persistBankRecognitionOverridesFromPostResults({
    bank,
    journals,
    items,
    dryRun,
  })

  return {
    executedAtUtc: new Date().toISOString(),
    bankId: bank.id,
    dryRun,
    totals: {
      requested: journals.length,
      created: items.filter((item) => item.status === 'created').length,
      skipped: items.filter((item) => item.status === 'skipped').length,
      failed: items.filter((item) => item.status === 'failed').length,
      dryRun: items.filter((item) => item.status === 'dry_run').length,
    },
    items,
  }
}

export function saveBankImportValidatedBalance(
  request: BankImportSaveValidatedBalanceRequest,
): BankImportSaveValidatedBalanceResponse {
  const bank = resolveBank(request.bankId)
  if (bank.id !== 'payana') {
    throw new BankImportError('La validacion manual de saldo solo esta habilitada para Payana - Higo.', 400)
  }

  const sourceFileHash = cleanText(request.sourceFileHash)
  const sourceFileName = cleanText(request.sourceFileName)
  const cutoffDate = cleanText(request.cutoffDate)
  const validatedClosingBalance = parseAmount(request.validatedClosingBalance)
  if (!sourceFileHash || !sourceFileName || !cutoffDate || validatedClosingBalance === null) {
    throw new BankImportError('Falta contexto para guardar el saldo final validado de esta carga.', 400)
  }

  const movementWindow = {
    minProcessingDate: cleanNullableDateOnly(request.movementWindow?.minProcessingDate),
    maxProcessingDate: cleanNullableDateOnly(request.movementWindow?.maxProcessingDate),
  }
  const movementSummary = normalizeBalanceValidationMovementSummary(request.movementSummary)

  upsertBankBalanceValidation({
    bankId: bank.id,
    sourceFileHash,
    sourceFileName,
    cutoffDate,
    movementMinProcessingDate: movementWindow.minProcessingDate,
    movementMaxProcessingDate: movementWindow.maxProcessingDate,
    validatedClosingBalance,
  })

  return buildBankBalanceValidation({
    bankId: bank.id,
    sourceFileHash,
    sourceFileName,
    cutoffDate,
    movementWindow,
    movementSummary,
  })
}

async function analyzeBankWorkbook({
  bank,
  accountingPeriodWindow,
  sourceFileHash,
  sourceProfileId,
  sourceFileName,
  analysisMode,
  transientCorrections,
  parsedRows,
  allowCrossSheetFallback,
}: {
  bank: SupportedBankConfig
  accountingPeriodWindow: AccountingPeriodWindow
  sourceFileHash: string
  sourceProfileId: string
  sourceFileName: string
  analysisMode: BankImportAnalysisMode
  transientCorrections: BankImportTransientCorrection[]
  parsedRows: BankImportParsedSourceRow[]
  allowCrossSheetFallback: boolean
}): Promise<BankImportAnalyzeResponse> {
  const mappings = loadMappingsForBank(bank.id, sourceProfileId)
  const transientCorrectionsByKey = new Map(transientCorrections.map((item) => [item.correctionKey, item]))
  const preparedRows = await enrichParsedRowsForAnalysis({
    bank,
    sourceProfileId,
    accountingPeriodWindow,
    analysisMode,
    parsedRows,
  })

  if (preparedRows.length === 0) {
    throw new BankImportError('El archivo bancario no contiene movimientos para analizar.', 400)
  }

  const journals: BankImportJournalPreview[] = []
  const exportRows: BankImportExportRow[] = []
  const unmatched: BankImportUnmatchedRow[] = []
  const excludedTypeMovements: BankImportExcludedTypeMovement[] = []
  const processableRows: ParsedBankMovement[] = []
  const readyJournalCandidates: ReadyJournalCandidate[] = []
  const creditDestinations = new Map<
    BankImportCreditDestinationType,
    {
      label: string
      count: number
      amount: number
    }
  >()

  let rowsInAccountingPeriod = 0
  let eligibleRows = 0
  let excludedInvalidDateRows = 0
  let excludedOutsideAccountingPeriodRows = 0
  let excludedStatusRows = 0
  let excludedRecognizedRows = 0
  let excludedTypeRows = 0
  let excludedInvalidAmountRows = 0
  let readyAmount = 0
  let unmatchedAmount = 0
  let recognizedAmount = 0
  let excludedOutsideAccountingPeriodAmount = 0
  let excludedStatusAmount = 0
  let excludedTypeAmount = 0
  const externalIdCounts = new Map<string, number>()

  let minProcessingDate: Date | null = null
  let maxProcessingDate: Date | null = null

  preparedRows.forEach((parsedRow, index) => {
    const processingDate = parsedRow.processingDate

    if (!processingDate) {
      excludedInvalidDateRows += 1
      return
    }

    minProcessingDate = minProcessingDate && minProcessingDate <= processingDate ? minProcessingDate : processingDate
    maxProcessingDate = maxProcessingDate && maxProcessingDate >= processingDate ? maxProcessingDate : processingDate

    if (!isDateWithinAccountingPeriod(processingDate, accountingPeriodWindow)) {
      excludedOutsideAccountingPeriodRows += 1
      if (typeof parsedRow.amount === 'number' && Number.isFinite(parsedRow.amount) && parsedRow.amount > 0) {
        excludedOutsideAccountingPeriodAmount += parsedRow.amount
      }
      return
    }

    rowsInAccountingPeriod += 1

    const status = normalizeText(parsedRow.status)
    if (status !== 'PROCESADO') {
      excludedStatusRows += 1
      if (typeof parsedRow.amount === 'number' && Number.isFinite(parsedRow.amount) && parsedRow.amount > 0) {
        excludedStatusAmount += parsedRow.amount
      }
      return
    }

    const amount = parsedRow.amount
    if (amount === null || amount <= 0) {
      excludedInvalidAmountRows += 1
      return
    }

    const transactionType = cleanText(parsedRow.transactionType) || 'Sin tipo'
    const transactionRule = resolveTransactionRule(transactionType)
    const counterpartyName = cleanText(parsedRow.counterpartyName)
    const statementCounterpartyName = cleanText(parsedRow.statementCounterpartyName) || counterpartyName || null
    const counterpartySource =
      parsedRow.counterpartySource === 'banxico_ordering_party' ? 'banxico_ordering_party' : 'statement'
    const paymentConcept = cleanText(parsedRow.paymentConcept)
    const trackingKey = cleanText(parsedRow.trackingKey)
    const hashId = cleanText(parsedRow.hashId)
    const rfc = cleanText(parsedRow.rfc)
    const orderingPartyName =
      cleanText(parsedRow.orderingPartyName) || (counterpartySource === 'banxico_ordering_party' ? counterpartyName : null)
    const orderingPartyRfc =
      cleanText(parsedRow.orderingPartyRfc) || (counterpartySource === 'banxico_ordering_party' ? rfc || null : null)
    const orderingPartyAccount = cleanText(parsedRow.orderingPartyAccount) || cleanText(parsedRow.originAccount) || null
    const externalIdBase = buildExternalId(
      bank.id,
      hashId,
      trackingKey,
      processingDate,
      amount,
      transactionType,
      counterpartyName,
      paymentConcept,
    )
    const externalIdCount = (externalIdCounts.get(externalIdBase) ?? 0) + 1
    externalIdCounts.set(externalIdBase, externalIdCount)
    const externalId =
      externalIdCount === 1 ? externalIdBase : `${externalIdBase}-D${externalIdCount}`.slice(0, 120)
    const correctionKey = buildCorrectionKey(bank.id, sourceProfileId, transactionRule.mappingSheetKey, externalId)
    const resolution = resolveMappingEntryAcrossSheets(
      counterpartyName,
      transactionRule.mappingSheetKey,
      mappings,
      allowCrossSheetFallback,
    )

    const movement: ParsedBankMovement = {
      rowIndex: index,
      externalId,
      correctionKey,
      processingDate,
      processingTimestamp: formatTimestamp(processingDate),
      transactionDate: formatDateOnly(processingDate),
      transactionType,
      transactionRule,
      amount,
      counterpartyName,
      statementCounterpartyName,
      counterpartySource,
      orderingPartyName,
      orderingPartyRfc,
      orderingPartyAccount,
      normalizedCounterpartyName: normalizeText(counterpartyName),
      compactCounterpartyName: compactText(counterpartyName),
      netsuiteName: resolution.entry?.netsuiteName ?? null,
      compactNetsuiteName: compactText(resolution.entry?.netsuiteName ?? ''),
      mappedAccount: resolution.entry?.creditAccount ?? null,
      mappingSheetKey: resolution.entry?.mappingSheetKey ?? null,
      mappingSheetName: resolution.entry?.mappingSheetName ?? null,
      mappingMethod: resolution.method,
      paymentConcept: paymentConcept || null,
      compactPaymentConcept: compactText(paymentConcept),
      rfc: rfc || null,
      trackingKey: trackingKey || null,
      referenceNumber: cleanText(parsedRow.referenceNumber) || null,
      originBankName: cleanText(parsedRow.originBankName) || null,
      destinationBankName: cleanText(parsedRow.destinationBankName) || null,
      destinationAccount: cleanText(parsedRow.destinationAccount) || null,
      hashId: hashId || null,
      recognitionDirection: resolveRecognitionDirection(transactionRule.normalizedTransactionType),
    }

    const transientCorrection = transientCorrectionsByKey.get(correctionKey)
    processableRows.push(
      applyTransientCorrectionToMovement(
        movement,
        transientCorrection,
        mappings,
        shouldPreserveTransientCorrectionClassification(bank.id, sourceProfileId, transactionRule),
      ),
    )
  })

  const netsuiteSweep = await fetchNetSuiteSweep(bank, accountingPeriodWindow.start, accountingPeriodWindow.end)
  const sweepRecognizedMatches = reconcileRecognizedRows(processableRows, netsuiteSweep.registerLines)
  const sweepRecognizedByRowIndex = new Map<number, RecognitionMatch>(
    sweepRecognizedMatches.map((item) => [item.rowIndex, item.match]),
  )
  const manualRecognizedRows = processableRows
    .filter((movement) => !sweepRecognizedByRowIndex.has(movement.rowIndex))
    .map((movement) => {
      const match = findManualRecognitionMatch(bank.id, sourceProfileId, movement)
      return match ? { rowIndex: movement.rowIndex, movement, match } : null
    })
    .filter(
      (
        item,
      ): item is {
        rowIndex: number
        movement: ParsedBankMovement
        match: ManualRecognitionMatch
      } => item !== null,
    )
  const manualRecognizedByRowIndex = new Map<number, ManualRecognitionMatch>(
    manualRecognizedRows.map((item) => [item.rowIndex, item.match]),
  )
  const recognizedRowIndexes = new Set<number>([
    ...sweepRecognizedByRowIndex.keys(),
    ...manualRecognizedByRowIndex.keys(),
  ])

  for (const movement of processableRows) {
    const sweepRecognition = sweepRecognizedByRowIndex.get(movement.rowIndex)
    const manualRecognition = manualRecognizedByRowIndex.get(movement.rowIndex)
    if (sweepRecognition || manualRecognition) {
      excludedRecognizedRows += 1
      recognizedAmount += movement.amount
      continue
    }

    const { transactionRule } = movement
    if (!transactionRule.includedInCurrentFlow || !transactionRule.mappingSheetKey || !transactionRule.mappedAccountSide) {
      excludedTypeRows += 1
      excludedTypeAmount += movement.amount
      excludedTypeMovements.push(
        buildExcludedTypeMovementRow(
          movement,
          transactionRule.ruleSummary || 'Este tipo de movimiento queda fuera del flujo operativo actual.',
        ),
      )
      continue
    }

    eligibleRows += 1

    const historicallyResolvedMovement = await applyHistoricalRecognitionToMovement(movement, bank.id, mappings)
    const banxicoResolvedMovement = await applyBbvaSpeiAutoResolution(
      bank.id,
      sourceProfileId,
      analysisMode,
      accountingPeriodWindow,
      historicallyResolvedMovement,
      mappings,
      allowCrossSheetFallback,
    )
    const resolvedMovement = await applyClaraDepositAutoResolution(
      bank.id,
      sourceProfileId,
      analysisMode,
      banxicoResolvedMovement,
      mappings,
    )
    const bankRuleResolvedMovement = applyBankSpecificMovementRules(bank.id, sourceProfileId, resolvedMovement)
    const resolvedTransactionRule = bankRuleResolvedMovement.transactionRule

    if (!bankRuleResolvedMovement.netsuiteName || !bankRuleResolvedMovement.mappedAccount) {
      const historicalResolution = resolveHistoricalCorrectionCandidateResolution(
        bank.id,
        bankRuleResolvedMovement.trackingKey,
        bankRuleResolvedMovement.referenceNumber,
        resolvedTransactionRule.mappingSheetKey,
        bankRuleResolvedMovement.amount,
      )
      const hasConflictingHistoricalCandidate =
        historicalResolution.status === 'single' &&
        !isHistoricalCandidateCompatibleWithMovement(bankRuleResolvedMovement, historicalResolution.candidates[0])
      unmatchedAmount += bankRuleResolvedMovement.amount
      unmatched.push({
        correctionKey: bankRuleResolvedMovement.correctionKey,
        transactionType: bankRuleResolvedMovement.transactionType,
        mappingSheetKey: resolvedTransactionRule.mappingSheetKey,
        mappingSheetName: resolvedTransactionRule.mappingSheetName,
        processingTimestamp: bankRuleResolvedMovement.processingTimestamp,
        transactionDate: bankRuleResolvedMovement.transactionDate,
        counterpartyName: bankRuleResolvedMovement.counterpartyName,
        statementCounterpartyName: bankRuleResolvedMovement.statementCounterpartyName,
        counterpartySource: bankRuleResolvedMovement.counterpartySource,
        orderingPartyName: bankRuleResolvedMovement.orderingPartyName,
        orderingPartyRfc: bankRuleResolvedMovement.orderingPartyRfc,
        orderingPartyAccount: bankRuleResolvedMovement.orderingPartyAccount,
        normalizedCounterpartyName: bankRuleResolvedMovement.normalizedCounterpartyName,
        amount: bankRuleResolvedMovement.amount,
        paymentConcept: bankRuleResolvedMovement.paymentConcept,
        rfc: bankRuleResolvedMovement.rfc,
        trackingKey: bankRuleResolvedMovement.trackingKey,
        referenceNumber: bankRuleResolvedMovement.referenceNumber,
        originBankName: bankRuleResolvedMovement.originBankName,
        destinationBankName: bankRuleResolvedMovement.destinationBankName,
        destinationAccount: bankRuleResolvedMovement.destinationAccount,
        hashId: bankRuleResolvedMovement.hashId,
        reason:
          historicalResolution.status === 'multiple'
            ? 'La coincidencia historica apunta a varias equivalencias distintas del historico BBVA. Abre la correccion para decidir cual aplica.'
            : hasConflictingHistoricalCandidate
              ? `Se encontro un historico exacto, pero apunta a ${historicalResolution.candidates[0].candidate.mappingSheetName} y contradice la clasificacion detectada en este estado de cuenta. Abre la correccion para decidir si aplica.`
              : `No hay equivalencia exacta en ${resolvedTransactionRule.mappingSheetName ?? 'la tabla de homologacion actual'}.`,
        suggestedCandidate: null,
      })
      continue
    }

    readyAmount += bankRuleResolvedMovement.amount

    const lineMemo =
      bankRuleResolvedMovement.paymentConcept || bankRuleResolvedMovement.trackingKey || `Movimiento bancario ${bank.label}`
    const journalAccounts = resolveJournalAccounts(bankRuleResolvedMovement, bank)
    const resolvedMappedAccountSide = resolvedTransactionRule.mappedAccountSide ?? transactionRule.mappedAccountSide
    if (!resolvedMappedAccountSide) {
      excludedTypeRows += 1
      readyAmount -= bankRuleResolvedMovement.amount
      excludedTypeMovements.push(
        buildExcludedTypeMovementRow(
          bankRuleResolvedMovement,
          'La regla actual no tiene configurado el lado contable para este movimiento.',
        ),
      )
    } else {
      const journalPreview: BankImportJournalPreview = {
        externalId: bankRuleResolvedMovement.externalId,
        correctionKey: bankRuleResolvedMovement.correctionKey,
        transactionType: bankRuleResolvedMovement.transactionType,
        processingTimestamp: bankRuleResolvedMovement.processingTimestamp,
        transactionDate: bankRuleResolvedMovement.transactionDate,
        counterpartyName: bankRuleResolvedMovement.counterpartyName,
        statementCounterpartyName: bankRuleResolvedMovement.statementCounterpartyName,
        counterpartySource: bankRuleResolvedMovement.counterpartySource,
        orderingPartyName: bankRuleResolvedMovement.orderingPartyName,
        orderingPartyRfc: bankRuleResolvedMovement.orderingPartyRfc,
        orderingPartyAccount: bankRuleResolvedMovement.orderingPartyAccount,
        normalizedCounterpartyName: bankRuleResolvedMovement.normalizedCounterpartyName,
        netsuiteName: bankRuleResolvedMovement.netsuiteName,
        mappingSheetName: bankRuleResolvedMovement.mappingSheetName ?? resolvedTransactionRule.mappingSheetName ?? 'Sin regla',
        mappedAccount: journalAccounts.mappedAccount,
        mappedAccountSide: resolvedMappedAccountSide,
        debitAccount: journalAccounts.debitAccount,
        creditAccount: journalAccounts.creditAccount,
        debitEntityName: journalAccounts.debitEntityName,
        debitEntitySheetKey: journalAccounts.debitEntitySheetKey,
        debitEntityInternalId: journalAccounts.debitEntityInternalId ?? null,
        debitEntityDisplayName: journalAccounts.debitEntityDisplayName ?? null,
        creditEntityName: journalAccounts.creditEntityName,
        creditEntitySheetKey: journalAccounts.creditEntitySheetKey,
        creditEntityInternalId: journalAccounts.creditEntityInternalId ?? null,
        creditEntityDisplayName: journalAccounts.creditEntityDisplayName ?? null,
        postingDisplayName:
          journalAccounts.creditEntityDisplayName ??
          journalAccounts.debitEntityDisplayName ??
          bankRuleResolvedMovement.postingDisplayName ??
          bankRuleResolvedMovement.netsuiteName,
        creditDestinationType: journalAccounts.creditDestinationType,
        creditDestinationLabel: journalAccounts.creditDestinationLabel,
        amount: bankRuleResolvedMovement.amount,
        currency: 'MXN',
        exchangeRate: 1,
        memo: bankRuleResolvedMovement.netsuiteName,
        lineMemo,
        paymentConcept: bankRuleResolvedMovement.paymentConcept,
        rfc: bankRuleResolvedMovement.rfc,
        trackingKey: bankRuleResolvedMovement.trackingKey,
        referenceNumber: bankRuleResolvedMovement.referenceNumber,
        originBankName: bankRuleResolvedMovement.originBankName,
        destinationBankName: bankRuleResolvedMovement.destinationBankName,
        destinationAccount: bankRuleResolvedMovement.destinationAccount,
        hashId: bankRuleResolvedMovement.hashId,
        mappingMethod: bankRuleResolvedMovement.mappingMethod,
      }

      accumulateCreditDestination(
        creditDestinations,
        {
          type: journalAccounts.creditDestinationType,
          label: journalAccounts.creditDestinationLabel,
        },
        bankRuleResolvedMovement.amount,
      )
      journals.push(journalPreview)
      readyJournalCandidates.push({
        movement: bankRuleResolvedMovement,
        journal: journalPreview,
      })
      exportRows.push(...buildExportRows(journalPreview))
    }
  }

  const monthlyRecognitionGapFill = await fillCurrentMonthRecognitionGaps({
    bank,
    statementMaxProcessingDate: maxProcessingDate,
    accountingPeriodWindow,
    currentSweep: netsuiteSweep,
    initialSweepMatches: sweepRecognizedMatches,
    manualRecognizedRows,
    readyJournalCandidates,
  })
  const netsuiteSweepPeriodRows = buildNetSuiteSweepPeriodRows({
    registerLines: monthlyRecognitionGapFill.sweep.registerLines,
    recognizedRows: sweepRecognizedMatches,
    manualRecognizedRows,
    monthlyGapMatches: monthlyRecognitionGapFill.matches,
  })
  const monthlyRecognizedExternalIds = new Set(
    monthlyRecognitionGapFill.matches.map((item) => item.journal.externalId),
  )
  const finalJournals =
    monthlyRecognizedExternalIds.size === 0
      ? journals
      : journals.filter((journal) => !monthlyRecognizedExternalIds.has(journal.externalId))
  const finalExportRows =
    monthlyRecognizedExternalIds.size === 0
      ? exportRows
      : exportRows.filter((row) => !monthlyRecognizedExternalIds.has(row.externalId))
  const finalRecognizedRowIndexes = new Set<number>([
    ...recognizedRowIndexes,
    ...monthlyRecognitionGapFill.matches.map((item) => item.movement.rowIndex),
  ])

  await hydrateUnmatchedSuggestions(bank.id, unmatched, mappings, analysisMode)

  const monthlyGapRecognizedAmount = monthlyRecognitionGapFill.matches.reduce(
    (total, item) => total + item.movement.amount,
    0,
  )
  const finalExcludedRecognizedRows = excludedRecognizedRows + monthlyRecognitionGapFill.matches.length
  const finalRecognizedAmount = round2(recognizedAmount + monthlyGapRecognizedAmount)
  const finalReadyAmount = round2(finalJournals.reduce((total, journal) => total + journal.amount, 0))
  const movementWindow = buildMovementWindow(processableRows)
  const movementSummary = summarizeBalanceValidationMovements(processableRows)
  const summary = {
    totalRows: preparedRows.length,
    rowsAfterCutoff: rowsInAccountingPeriod,
    eligibleRows,
    readyRows: finalJournals.length,
    unmatchedRows: unmatched.length,
    excludedRows:
      excludedInvalidDateRows +
      excludedOutsideAccountingPeriodRows +
      excludedStatusRows +
      finalExcludedRecognizedRows +
      excludedTypeRows +
      excludedInvalidAmountRows,
    excludedInvalidDateRows,
    excludedBeforeCutoffRows: excludedOutsideAccountingPeriodRows,
    excludedStatusRows,
    excludedRecognizedRows: finalExcludedRecognizedRows,
    excludedTypeRows,
    excludedInvalidAmountRows,
    readyAmount: finalReadyAmount,
    unmatchedAmount: round2(unmatchedAmount),
    recognizedAmount: finalRecognizedAmount,
  }

  const netsuiteSweepResponse: BankImportNetSuiteSweep = {
    status: monthlyRecognitionGapFill.sweep.status,
    accountId: monthlyRecognitionGapFill.sweep.accountId,
    accountLabel: monthlyRecognitionGapFill.sweep.accountLabel,
    registerRowsFetched: monthlyRecognitionGapFill.sweep.registerLines.length,
    recognizedRows:
      sweepRecognizedMatches.length + manualRecognizedRows.length + monthlyRecognitionGapFill.matches.length,
    recognizedAmount: finalRecognizedAmount,
    warning: monthlyRecognitionGapFill.sweep.warning,
    periodStart: formatDateOnly(accountingPeriodWindow.start),
    periodEnd: formatDateOnly(accountingPeriodWindow.end),
    matches: [
      ...sweepRecognizedMatches.map(({ movement, match }) => buildRecognizedRow(movement, match)),
      ...manualRecognizedRows.map(({ movement, match }) => buildManualRecognizedRow(movement, match)),
      ...monthlyRecognitionGapFill.matches.map(({ movement, match }) =>
        buildRecognizedRow(movement, {
          ...match,
          matchRule: `${match.matchRule}; barrido mensual posterior a homologacion`,
        }),
      ),
    ]
      .sort(
        (left, right) =>
          left.transactionDate.localeCompare(right.transactionDate) ||
          left.counterpartyName.localeCompare(right.counterpartyName) ||
          left.amount - right.amount,
      ),
    periodRows: netsuiteSweepPeriodRows,
  }

  const sampleFilePath = resolveSampleFilePath(bank.id)
  const sampleAnalysisAvailable = fs.existsSync(sampleFilePath)
  const historicalSummary = getBankHistoricalRegistrySummary(bank.id)
  const individualPaymentSummary = getBankIndividualPaymentFileSummary(bank.id)
  const balanceValidation = buildBankBalanceValidation({
    bankId: bank.id,
    sourceFileHash,
    sourceFileName,
    cutoffDate: formatDateOnly(accountingPeriodWindow.start),
    movementWindow,
    movementSummary,
  })

  return {
    generatedAtUtc: new Date().toISOString(),
    bank: {
      id: bank.id,
      label: bank.label,
      debitAccount: bank.debitAccount,
      sampleAnalysisAvailable,
      sampleFileName: sampleAnalysisAvailable ? path.basename(sampleFilePath) : null,
      historicalRegistryAvailable: historicalSummary.enabled,
      historicalStatementCount: historicalSummary.statementCount,
      historicalRecognizedRowCount: historicalSummary.recognizedRowCount,
      historicalReferenceCount: historicalSummary.referenceCount,
      historicalLastUpdatedAtUtc: historicalSummary.lastUpdatedAtUtc,
      individualPaymentFileCount: individualPaymentSummary.count,
      individualPaymentLastUpdatedAtUtc: individualPaymentSummary.lastUpdatedAtUtc,
    },
    sourceFileName,
    sourceFileHash,
    accountingPeriod: accountingPeriodWindow.token,
    cutoffDate: formatDateOnly(accountingPeriodWindow.start),
    statementWindow: {
      minProcessingDate: minProcessingDate ? formatDateOnly(minProcessingDate) : null,
      maxProcessingDate: maxProcessingDate ? formatDateOnly(maxProcessingDate) : null,
    },
    clientMapping: {
      workbookName: mappings.customers.workbookName,
      sheetName: mappings.customers.sheetName,
      totalMappings: mappings.customers.totalMappings,
      exactDuplicates: mappings.customers.exactDuplicates,
      compactAmbiguous: mappings.customers.compactAmbiguous,
    },
    providerMapping: {
      workbookName: mappings.suppliers.workbookName,
      sheetName: mappings.suppliers.sheetName,
      totalMappings: mappings.suppliers.totalMappings,
      exactDuplicates: mappings.suppliers.exactDuplicates,
      compactAmbiguous: mappings.suppliers.compactAmbiguous,
    },
    mappingSheets: [mappings.customers, mappings.suppliers].map((item) => ({
      key: item.key,
      workbookName: item.workbookName,
      sheetName: item.sheetName,
      totalMappings: item.totalMappings,
      exactDuplicates: item.exactDuplicates,
      compactAmbiguous: item.compactAmbiguous,
    })),
    transactionRules: getTransactionRules().map(stripResolvedTransactionRule),
    summary,
    netsuiteSweep: netsuiteSweepResponse,
    excludedBuckets: buildExcludedBuckets(summary, {
      beforeCutoffAmount: round2(excludedOutsideAccountingPeriodAmount),
      statusAmount: round2(excludedStatusAmount),
      typeAmount: round2(excludedTypeAmount),
    }),
    transactionTypes: summarizePendingTransactionTypes(processableRows, finalRecognizedRowIndexes),
    creditDestinations: buildCreditDestinationSummaryFromJournals(finalJournals),
    journals: finalJournals,
    exportRows: finalExportRows,
    unmatched,
    excludedTypeMovements: [...excludedTypeMovements].sort(
      (left, right) =>
        left.transactionDate.localeCompare(right.transactionDate) ||
        left.transactionType.localeCompare(right.transactionType) ||
        left.counterpartyName.localeCompare(right.counterpartyName) ||
        left.amount - right.amount,
    ),
    balanceValidation,
  }
}

function resolveSampleFilePath(bankId: BankImportBankId) {
  switch (bankId) {
    case 'payana':
      return PAYANA_SAMPLE_FILE_PATH
    case 'clara_corriente':
      return CLARA_CORRIENTE_SAMPLE_FILE_PATH
    case 'bbva':
      return BBVA_SAMPLE_FILE_PATH
    default:
      return PAYANA_SAMPLE_FILE_PATH
  }
}

function loadMappings(): LoadedMappings {
  if (mappingCache) {
    return mappingCache
  }

  if (!fs.existsSync(MAPPING_WORKBOOK_PATH)) {
    throw new BankImportError(
      `No encuentro el archivo de homologacion ${path.basename(MAPPING_WORKBOOK_PATH)}.`,
      503,
    )
  }

  const workbook = XLSX.readFile(MAPPING_WORKBOOK_PATH, {
    cellDates: true,
  })

  const loadedMappings = Object.fromEntries(
    mappingSheetConfigs.map((config) => [config.key, loadMappingSheet(workbook, config)]),
  ) as LoadedMappings

  mappingCache = loadedMappings
  return mappingCache
}

function loadMappingsForBank(bankId: BankImportBankId, sourceProfileId: string): LoadedMappings {
  const baseMappings = loadMappings()
  const clonedMappings = cloneLoadedMappings(baseMappings)
  applyImplicitBankMappingOverrides(clonedMappings)
  applyClaraDepositSeedMappings(bankId, sourceProfileId, clonedMappings)
  const overrides = loadBankEquivalenceOverrides()
    .filter((item) => item.bankId === bankId && item.sourceProfileId === sourceProfileId)
    .sort((left, right) => left.updatedAtUtc.localeCompare(right.updatedAtUtc))

  overrides.forEach((override) => {
    const targetSheet = clonedMappings[override.mappingSheetKey]
    if (!targetSheet) {
      return
    }

    applyManualCorrectionEntry(clonedMappings, {
      bankName: override.counterpartyName,
      normalizedBankName: override.normalizedCounterpartyName,
      compactBankName: override.compactCounterpartyName,
      netsuiteName: override.netsuiteName,
      creditAccount: override.creditAccount,
      mappingSheetKey: override.mappingSheetKey,
      mappingSheetName: targetSheet.sheetName,
    })
  })

  return clonedMappings
}

function applyImplicitBankMappingOverrides(mappings: LoadedMappings) {
  implicitBankMappingOverrides.forEach((override) => {
    const targetSheet = mappings[override.targetSheetKey]
    if (!targetSheet) {
      return
    }

    const targetEntry = findMappingEntryByNetSuiteName(targetSheet, override.netsuiteName)
    if (!targetEntry) {
      return
    }

    applyManualCorrectionEntry(mappings, {
      bankName: override.bankName,
      normalizedBankName: normalizeText(override.bankName),
      compactBankName: compactText(override.bankName),
      netsuiteName: targetEntry.netsuiteName,
      creditAccount: targetEntry.creditAccount,
      mappingSheetKey: targetEntry.mappingSheetKey,
      mappingSheetName: targetEntry.mappingSheetName,
    })
  })
}

function applyManualCorrectionEntry(mappings: LoadedMappings, entry: MappingEntry) {
  getMappingSheetKeys().forEach((mappingSheetKey) => {
    const targetSheet = mappings[mappingSheetKey]
    if (!targetSheet) {
      return
    }

    targetSheet.exactMatches.set(entry.normalizedBankName, entry)
    targetSheet.compactMatches.set(entry.compactBankName, entry)
  })
}

function findMappingEntryByNetSuiteName(mapping: MappingCache, netsuiteName: string) {
  const normalizedTarget = normalizeText(netsuiteName)
  const compactTarget = compactText(stripLeadingEntityCode(netsuiteName))

  return (
    mapping.entries.find((entry) => normalizeText(entry.netsuiteName) === normalizedTarget) ??
    mapping.entries.find((entry) => compactText(stripLeadingEntityCode(entry.netsuiteName)) === compactTarget) ??
    null
  )
}

function cloneLoadedMappings(mappings: LoadedMappings): LoadedMappings {
  return {
    customers: cloneMappingCache(mappings.customers),
    suppliers: cloneMappingCache(mappings.suppliers),
  }
}

function cloneMappingCache(mapping: MappingCache): MappingCache {
  return {
    ...mapping,
    entries: [...mapping.entries],
    exactMatches: new Map(mapping.exactMatches),
    compactMatches: new Map(mapping.compactMatches),
  }
}

function loadMappingSheet(workbook: XLSX.WorkBook, config: MappingSheetConfig): MappingCache {
  const sheet = workbook.Sheets[config.sheetName]
  if (!sheet) {
    throw new BankImportError(
      `La hoja ${config.sheetName} no existe en ${path.basename(MAPPING_WORKBOOK_PATH)}.`,
      503,
    )
  }

  const rawRows = readWorksheetRecords(sheet)
  const exactMatches = new Map<string, MappingEntry>()
  const compactCandidates = new Map<string, MappingEntry[]>()
  let exactDuplicates = 0

  rawRows.forEach((rawRow) => {
    const row = normalizeRecordKeys(rawRow)
    const netsuiteName = cleanText(row[config.netsuiteNameField])
    const creditAccount = cleanText(row.CC)
    const primaryBankName = cleanText(row[config.bankNameField])
    const aliasBankNames = (config.aliasBankNameFields ?? [])
      .map((field) => cleanText(row[field]))
      .filter((value) => Boolean(value))
    const bankNames = Array.from(new Set(primaryBankName ? [primaryBankName] : aliasBankNames))

    if (bankNames.length === 0 || !netsuiteName || !creditAccount) {
      return
    }

    bankNames.forEach((bankName) => {
      const entry: MappingEntry = {
        bankName,
        normalizedBankName: normalizeText(bankName),
        compactBankName: compactText(bankName),
        netsuiteName,
        creditAccount,
        mappingSheetKey: config.key,
        mappingSheetName: config.sheetName,
      }

      if (exactMatches.has(entry.normalizedBankName)) {
        exactDuplicates += 1
        return
      }

      exactMatches.set(entry.normalizedBankName, entry)
      if (!compactCandidates.has(entry.compactBankName)) {
        compactCandidates.set(entry.compactBankName, [])
      }
      compactCandidates.get(entry.compactBankName)?.push(entry)
    })
  })

  const compactMatches = new Map<string, MappingEntry>()
  let compactAmbiguous = 0

  compactCandidates.forEach((entries, compactKey) => {
    if (entries.length === 1) {
      compactMatches.set(compactKey, entries[0])
      return
    }

    compactAmbiguous += 1
  })

  return {
    key: config.key,
    workbookName: path.basename(MAPPING_WORKBOOK_PATH),
    sheetName: config.sheetName,
    totalMappings: exactMatches.size,
    exactDuplicates,
    compactAmbiguous,
    entries: Array.from(exactMatches.values()),
    exactMatches,
    compactMatches,
  }
}

function resolveBank(bankId: string): SupportedBankConfig {
  const resolved = supportedBanks.find((bank) => bank.id === bankId)
  if (!resolved) {
    throw new BankImportError(`El banco ${bankId} todavia no esta soportado.`)
  }

  return resolved
}

function detectBankImportFileLayout(bank: SupportedBankConfig, rows: Record<string, unknown>[]) {
  if (bank.id === 'bbva') {
    throw new BankImportError(
      'BBVA usa el PDF "Detalle de movimientos". Sube el PDF exportado desde BBVA en lugar de un Excel o CSV.',
      400,
    )
  }

  const headerRow = normalizeRecordKeys(rows[0] ?? {})
  const availableHeaders = Object.keys(headerRow)
  const availableHeaderSet = new Set(availableHeaders)
  const candidateLayouts =
    bank.id === 'clara_corriente'
      ? [claraPaymentsFileLayout, claraAccountActivityFileLayout]
      : [payanaTransaccionesFileLayout]

  const matchedLayout = candidateLayouts.find((layout) =>
    layout.requiredHeaders.every((header) => availableHeaderSet.has(header)),
  )
  if (matchedLayout) {
    return matchedLayout
  }

  const formattedHeaders = availableHeaders.sort().join(', ')
  if (bank.id === 'clara_corriente') {
    throw new BankImportError(
      `El archivo de Clara Corriente no coincide con los layouts soportados. Espero un CSV/Excel de pagos (15 columnas) o de actividad (12 columnas). Encabezados detectados: ${formattedHeaders || 'sin encabezados'}.`,
      400,
    )
  }

  throw new BankImportError(
    `El archivo de ${bank.label} no coincide con el layout esperado. Encabezados detectados: ${formattedHeaders || 'sin encabezados'}.`,
    400,
  )
}

function getTransactionRules(): ResolvedTransactionRule[] {
  return [
    {
      transactionType: 'Cobro',
      normalizedTransactionType: 'COBRO',
      mappingSheetKey: 'customers',
      mappingSheetName: CUSTOMER_MAPPING_SHEET_NAME,
      journalMode: 'incoming',
      includedInCurrentFlow: true,
      includedInPendingSummary: true,
      ruleSummary: 'Cargo banco / abono cuenta homologada',
      mappedAccountSide: 'credit',
    },
    {
      transactionType: 'Anticipo',
      normalizedTransactionType: 'ANTICIPO',
      mappingSheetKey: 'suppliers',
      mappingSheetName: PROVIDER_MAPPING_SHEET_NAME,
      journalMode: 'outgoing',
      includedInCurrentFlow: true,
      includedInPendingSummary: true,
      ruleSummary: 'Cargo cuenta homologada / abono banco',
      mappedAccountSide: 'debit',
    },
    {
      transactionType: 'Pago',
      normalizedTransactionType: 'PAGO',
      mappingSheetKey: 'suppliers',
      mappingSheetName: PROVIDER_MAPPING_SHEET_NAME,
      journalMode: 'outgoing',
      includedInCurrentFlow: true,
      includedInPendingSummary: true,
      ruleSummary: 'Cargo cuenta homologada / abono banco',
      mappedAccountSide: 'debit',
    },
    {
      transactionType: 'DEPOSIT',
      normalizedTransactionType: 'DEPOSIT',
      mappingSheetKey: 'customers',
      mappingSheetName: CUSTOMER_MAPPING_SHEET_NAME,
      journalMode: 'incoming',
      includedInCurrentFlow: true,
      includedInPendingSummary: true,
      ruleSummary: 'Cargo banco / abono cuenta homologada',
      mappedAccountSide: 'credit',
    },
    {
      transactionType: 'Reembolso',
      normalizedTransactionType: 'REEMBOLSO',
      mappingSheetKey: null,
      mappingSheetName: null,
      journalMode: 'special',
      includedInCurrentFlow: false,
      includedInPendingSummary: false,
      ruleSummary: 'Reembolso bancario de Higo/Payana por pago fallido; se excluye del flujo operativo y de revision',
      mappedAccountSide: null,
    },
    {
      transactionType: 'Nomina',
      normalizedTransactionType: 'NOMINA',
      mappingSheetKey: null,
      mappingSheetName: null,
      journalMode: 'special',
      includedInCurrentFlow: false,
      includedInPendingSummary: true,
      ruleSummary: 'Solo verificar contra NetSuite; no generar diario desde Bancos',
      mappedAccountSide: null,
    },
    {
      transactionType: 'Retiro',
      normalizedTransactionType: 'RETIRO',
      mappingSheetKey: null,
      mappingSheetName: null,
      journalMode: 'special',
      includedInCurrentFlow: false,
      includedInPendingSummary: true,
      ruleSummary: 'Pendiente de definicion especial',
      mappedAccountSide: null,
    },
  ]
}

function resolveTransactionRule(transactionType: string): ResolvedTransactionRule {
  const normalizedTransactionType = normalizeText(transactionType)
  const exactRule = getTransactionRules().find((rule) => rule.normalizedTransactionType === normalizedTransactionType)
  if (exactRule) {
    return exactRule
  }

  return {
    transactionType: cleanText(transactionType) || 'Sin tipo',
    normalizedTransactionType,
    mappingSheetKey: null,
    mappingSheetName: null,
    journalMode: 'special',
    includedInCurrentFlow: false,
    includedInPendingSummary: true,
    ruleSummary: 'Sin regla de homologacion definida',
    mappedAccountSide: null,
  }
}

function resolveTransactionTypeForMappedSheet(
  currentTransactionType: string,
  currentTransactionRule: ResolvedTransactionRule,
  targetMappingSheetKey: MappingSheetKey,
  preferredTransactionType?: string | null,
) {
  const cleanedPreferredTransactionType = cleanText(preferredTransactionType)
  if (cleanedPreferredTransactionType) {
    return cleanedPreferredTransactionType
  }

  if (currentTransactionRule.mappingSheetKey === targetMappingSheetKey) {
    return currentTransactionType
  }

  if (targetMappingSheetKey === 'suppliers') {
    if (currentTransactionRule.journalMode === 'incoming') {
      return currentTransactionType
    }

    return currentTransactionRule.normalizedTransactionType === 'ANTICIPO' ? currentTransactionType : 'Pago'
  }

  if (targetMappingSheetKey === 'customers') {
    return currentTransactionRule.journalMode === 'outgoing' ? 'Reembolso' : 'Cobro'
  }

  return currentTransactionType
}

function buildMappedTransactionRule(
  baseRule: ResolvedTransactionRule,
  mappingSheetKey: MappingSheetKey,
  mappingSheetName: string,
): ResolvedTransactionRule {
  return {
    ...baseRule,
    mappingSheetKey,
    mappingSheetName,
  }
}

function applyResolvedMappingToMovement(
  movement: ParsedBankMovement,
  resolved: {
    mappingSheetKey: MappingSheetKey
    mappingSheetName: string
    netsuiteName: string
    creditAccount: string
    mappingMethod: BankImportMappingMethod
    preferredTransactionType?: string | null
    preserveCurrentClassification?: boolean
    entityInternalId?: string | null
    postingDisplayName?: string | null
  },
): ParsedBankMovement {
  const preserveCurrentClassification = resolved.preserveCurrentClassification === true
  const nextTransactionType = preserveCurrentClassification
    ? movement.transactionType
    : resolveTransactionTypeForMappedSheet(
        movement.transactionType,
        movement.transactionRule,
        resolved.mappingSheetKey,
        resolved.preferredTransactionType,
      )
  const nextTransactionRule = preserveCurrentClassification
    ? buildMappedTransactionRule(movement.transactionRule, resolved.mappingSheetKey, resolved.mappingSheetName)
    : resolveTransactionRule(nextTransactionType)

  return {
    ...movement,
    transactionType: nextTransactionType,
    transactionRule: nextTransactionRule,
    netsuiteName: resolved.netsuiteName,
    compactNetsuiteName: compactText(resolved.netsuiteName),
    entityInternalId: cleanText(resolved.entityInternalId) || movement.entityInternalId,
    postingDisplayName: cleanText(resolved.postingDisplayName) || movement.postingDisplayName,
    mappedAccount: resolved.creditAccount,
    mappingSheetKey: resolved.mappingSheetKey,
    mappingSheetName: resolved.mappingSheetName,
    mappingMethod: resolved.mappingMethod,
    recognitionDirection: preserveCurrentClassification
      ? movement.recognitionDirection
      : resolveRecognitionDirection(nextTransactionRule.normalizedTransactionType),
  }
}

function getMappingSheetKeys(preferredMappingSheetKey?: MappingSheetKey | null, allowCrossSheetFallback = true) {
  const keys = mappingSheetConfigs.map((config) => config.key)
  if (!preferredMappingSheetKey) {
    return keys
  }

  if (!allowCrossSheetFallback) {
    return [preferredMappingSheetKey]
  }

  return [preferredMappingSheetKey, ...keys.filter((key) => key !== preferredMappingSheetKey)]
}

function resolveRecognitionDirection(normalizedTransactionType: string): RecognitionDirection {
  if (normalizedTransactionType === 'COBRO' || normalizedTransactionType === 'DEPOSIT') {
    return 'incoming'
  }

  if (
    normalizedTransactionType === 'ANTICIPO' ||
    normalizedTransactionType === 'PAGO' ||
    normalizedTransactionType === 'NOMINA' ||
    normalizedTransactionType === 'RETIRO'
  ) {
    return 'outgoing'
  }

  return 'unknown'
}

function stripResolvedTransactionRule(rule: ResolvedTransactionRule): BankImportTransactionRule {
  return {
    transactionType: rule.transactionType,
    mappingSheetKey: rule.mappingSheetKey,
    mappingSheetName: rule.mappingSheetName,
    journalMode: rule.journalMode,
    includedInCurrentFlow: rule.includedInCurrentFlow,
    includedInPendingSummary: rule.includedInPendingSummary,
    ruleSummary: rule.ruleSummary,
  }
}

function resolveMappingEntryAcrossSheets(
  counterpartyName: string,
  preferredMappingSheetKey: MappingSheetKey | null,
  mappings: LoadedMappings,
  allowCrossSheetFallback = true,
) {
  if (!allowCrossSheetFallback && preferredMappingSheetKey) {
    return resolveMappingEntry(counterpartyName, mappings[preferredMappingSheetKey])
  }

  for (const mappingSheetKey of getMappingSheetKeys(preferredMappingSheetKey)) {
    const resolution = resolveMappingEntry(counterpartyName, mappings[mappingSheetKey])
    if (resolution.entry) {
      return resolution
    }
  }

  return {
    entry: null,
    method: 'exact' as BankImportMappingMethod,
  }
}

function resolveMappingEntry(counterpartyName: string, mappings: MappingCache) {
  const exactKey = normalizeText(counterpartyName)
  const exact = mappings.exactMatches.get(exactKey)
  if (exact) {
    return {
      entry: exact,
      method: 'exact' as BankImportMappingMethod,
    }
  }

  const compactKey = compactText(counterpartyName)
  const compact = compactKey ? mappings.compactMatches.get(compactKey) : undefined
  if (compact) {
    return {
      entry: compact,
      method: 'compact' as BankImportMappingMethod,
    }
  }

  return {
    entry: null,
    method: 'exact' as BankImportMappingMethod,
  }
}

async function hydrateUnmatchedSuggestions(
  bankId: BankImportBankId,
  unmatched: BankImportUnmatchedRow[],
  mappings: LoadedMappings,
  analysisMode: BankImportAnalysisMode,
) {
  const suggestionCache = new Map<string, Promise<BankImportSuggestedCandidate | null>>()
  const cotOvSuggestionCache = new Map<string, Promise<BankImportSuggestedCandidate | null>>()

  await Promise.all(
    unmatched.slice(0, AUTO_NETSUITE_SUGGESTION_LIMIT).map(async (item) => {
      if (analysisMode === 'cot_ov') {
        const cotOvCacheKey = buildCotOvSuggestionCacheKey(item)
        if (cotOvCacheKey) {
          let cotOvSuggestionPromise = cotOvSuggestionCache.get(cotOvCacheKey)
          if (!cotOvSuggestionPromise) {
            cotOvSuggestionPromise = suggestCotOvCandidate(item, mappings)
            cotOvSuggestionCache.set(cotOvCacheKey, cotOvSuggestionPromise)
          }

          const cotOvSuggestion = await cotOvSuggestionPromise
          if (cotOvSuggestion) {
            item.suggestedCandidate = cotOvSuggestion
            return
          }
        }
      }

      const cacheKey = [
        compactText(item.counterpartyName),
        compactText(item.rfc ?? ''),
        compactText(item.trackingKey ?? ''),
        compactText(item.referenceNumber ?? ''),
        Number.isFinite(item.amount) ? round2(item.amount).toFixed(2) : '',
        item.mappingSheetKey ?? '',
      ].join(':')
      let suggestionPromise = suggestionCache.get(cacheKey)
      if (!suggestionPromise) {
        suggestionPromise = suggestCorrectionCandidate(
          bankId,
          item.counterpartyName,
          item.rfc,
          item.trackingKey,
          item.referenceNumber,
          item.amount,
          mappings,
          item.mappingSheetKey,
        )
        suggestionCache.set(cacheKey, suggestionPromise)
      }

      item.suggestedCandidate = await suggestionPromise
    }),
  )
}

function buildCotOvSuggestionCacheKey(item: BankImportUnmatchedRow) {
  if (!isCotOvSuggestionEligible(item)) {
    return null
  }

  return [cleanText(item.transactionDate), round2(item.amount).toFixed(2), item.mappingSheetKey].join(':')
}

function isCotOvSuggestionEligible(item: BankImportUnmatchedRow) {
  const transactionRule = resolveTransactionRule(item.transactionType)
  return (
    item.mappingSheetKey === 'customers' &&
    transactionRule.mappingSheetKey === 'customers' &&
    transactionRule.journalMode === 'incoming' &&
    typeof item.amount === 'number' &&
    Number.isFinite(item.amount)
  )
}

async function suggestCotOvCandidate(item: BankImportUnmatchedRow, mappings: LoadedMappings) {
  if (!isCotOvSuggestionEligible(item)) {
    return null
  }

  const transactionDate = parseSpreadsheetDate(item.transactionDate)
  if (!transactionDate) {
    return null
  }

  try {
    const estimateMatch = await findBestBbvaCotOvMatch('estimate', transactionDate, item.amount)
    if (estimateMatch) {
      return buildBbvaCotOvSuggestedCandidate(estimateMatch, mappings.customers)
    }

    const salesOrderMatch = await findBestBbvaCotOvMatch('sales_order', transactionDate, item.amount)
    if (salesOrderMatch) {
      return buildBbvaCotOvSuggestedCandidate(salesOrderMatch, mappings.customers)
    }
  } catch {
    return null
  }

  return null
}

async function findBestBbvaCotOvMatch(
  transactionKind: BbvaCotOvTransactionKind,
  targetDate: Date,
  targetAmount: number,
): Promise<BbvaCotOvMatch | null> {
  const client = NetSuiteClient.fromEnv()
  const [rows, customersById] = await Promise.all([
    fetchBbvaCotOvTransactionRows(client, transactionKind, targetDate, targetAmount),
    loadBbvaCotOvCustomersById(),
  ])

  const matches = rows
    .map((item) => {
      const transactionId = getNullableString(item.id)
      const transactionDate = parseSpreadsheetDate(item.trandate)
      const amount = parseAmount(item.totalamount)
      if (!transactionId || !transactionDate || amount === null) {
        return null
      }

      const dayDifference = getDayDifference(targetDate, transactionDate)
      if (dayDifference > COT_OV_MAX_DAY_DIFFERENCE) {
        return null
      }

      const amountDifference = round2(Math.abs(amount - targetAmount))
      if (amountDifference > COT_OV_MAX_AMOUNT_DIFFERENCE) {
        return null
      }

      const customerId = getNullableString(item.entityid)
      const customer = customerId ? customersById.get(customerId) : undefined
      const customerDisplayName = cleanText(
        customer
          ? formatNetSuiteEntityDisplayName(customer)
          : getNullableString(item.entityname) || getNullableString(item.tranid),
      )
      if (!customerDisplayName) {
        return null
      }

      const match: BbvaCotOvMatch = {
        transactionKind,
        transactionId,
        documentNumber: getNullableString(item.tranid),
        transactionDate: formatDateOnly(transactionDate),
        customerId,
        customerName: cleanText(customer?.companyName || customer?.altName || customer?.entityId || customerDisplayName),
        customerDisplayName,
        customerPostingDisplayName: customer ? formatNetSuiteEntityPostingDisplayName(customer) : customerDisplayName,
        creditAccount: cleanText(customer?.accountDisplayName) || DEFAULT_CUSTOMER_ACCOUNT_DISPLAY_NAME,
        amount,
        amountDifference,
        dayDifference,
        searchScope: 'standard',
        matchKind: amountDifference <= 0.01 ? 'exact' : 'close',
      }

      return match
    })
    .filter((match): match is BbvaCotOvMatch => match !== null)
    .sort(
      (left, right) =>
        left.dayDifference - right.dayDifference ||
        left.amountDifference - right.amountDifference ||
        right.transactionDate.localeCompare(left.transactionDate) ||
        right.transactionId.localeCompare(left.transactionId),
    )

  return matches[0] ?? null
}

async function fetchBbvaCotOvTransactionRows(
  client: NetSuiteClient,
  transactionKind: BbvaCotOvTransactionKind,
  targetDate: Date,
  targetAmount: number,
) {
  const transactionType = transactionKind === 'estimate' ? 'Estimate' : 'SalesOrd'
  const minDate = addDays(targetDate, -COT_OV_MAX_DAY_DIFFERENCE)
  const maxDate = addDays(targetDate, COT_OV_MAX_DAY_DIFFERENCE)
  const minAmount = Math.max(0, round2(targetAmount - COT_OV_MAX_AMOUNT_DIFFERENCE))
  const maxAmount = round2(targetAmount + COT_OV_MAX_AMOUNT_DIFFERENCE)

  const query = `
    SELECT
      transaction.id AS id,
      NVL(transaction.tranid, transaction.transactionnumber) AS tranid,
      transaction.trandate AS trandate,
      transaction.entity AS entityid,
      BUILTIN.DF(transaction.entity) AS entityname,
      NVL(transaction.foreigntotal, transaction.total) AS totalamount
    FROM transaction
    WHERE transaction.type = ${formatSuiteQlLiteral(transactionType)}
      AND transaction.entity IS NOT NULL
      AND transaction.trandate >= TO_DATE(${formatSuiteQlLiteral(formatDateOnly(minDate))}, 'YYYY-MM-DD')
      AND transaction.trandate <= TO_DATE(${formatSuiteQlLiteral(formatDateOnly(maxDate))}, 'YYYY-MM-DD')
      AND NVL(transaction.foreigntotal, transaction.total) >= ${minAmount.toFixed(2)}
      AND NVL(transaction.foreigntotal, transaction.total) <= ${maxAmount.toFixed(2)}
    ORDER BY transaction.trandate DESC, transaction.id DESC
  `.trim()

  return fetchAllSuiteQlRows(client, query, 1)
}

async function loadBbvaCotOvCustomersById() {
  if (!bbvaCotOvCustomersByIdPromise) {
    bbvaCotOvCustomersByIdPromise = (async () => {
      try {
        const entities = await fetchNetSuiteEntityCandidates('customers')
        return new Map(entities.map((entity) => [entity.internalId, entity]))
      } catch {
        return new Map<string, NetSuiteEntityCandidate>()
      }
    })()
  }

  return bbvaCotOvCustomersByIdPromise
}

function buildBbvaCotOvSuggestedCandidate(match: BbvaCotOvMatch, mappings: MappingCache): BankImportSuggestedCandidate {
  const transactionLabel = match.transactionKind === 'estimate' ? 'Cotizacion' : 'OV'
  const scoreLabel = match.matchKind === 'exact' ? 'Monto exacto' : 'Monto +/- $1.00'
  const dayLabel =
    match.dayDifference === 0
      ? 'misma fecha'
      : `${match.dayDifference} dia${match.dayDifference === 1 ? '' : 's'} de diferencia`
  const documentLabel = match.documentNumber ? `Doc. ${match.documentNumber}` : transactionLabel

  return {
    mappingSheetKey: mappings.key,
    mappingSheetName: mappings.sheetName,
    candidateSource: 'cot_ov',
    bankName: match.customerName || match.customerDisplayName,
    netsuiteName: match.customerDisplayName,
    creditAccount: match.creditAccount,
    entityInternalId: match.customerId,
    postingDisplayName: match.customerPostingDisplayName,
    score: match.matchKind === 'exact' ? 0.995 : 0.93,
    scoreLabel,
    suggestionMethod: 'cot_ov_transaction',
    matchKind: match.matchKind,
    supportingTransactionType: match.transactionKind,
    supportingTransactionNumber: match.documentNumber,
    supportingTransactionDate: match.transactionDate,
    reason: `${transactionLabel} ${documentLabel} del ${match.transactionDate} por ${formatMoney(match.amount)} (${scoreLabel.toLowerCase()}, ${dayLabel}).`,
  }
}

async function suggestCorrectionCandidate(
  bankId: BankImportBankId,
  counterpartyName: string,
  rfc: string | null,
  trackingKey: string | null,
  referenceNumber: string | null,
  amount: number | null,
  mappings: LoadedMappings,
  preferredMappingSheetKey: MappingSheetKey | null,
) {
  const historicalResolution = resolveHistoricalCorrectionCandidateResolution(
    bankId,
    trackingKey,
    referenceNumber,
    preferredMappingSheetKey,
    amount,
  )
  if (historicalResolution.status === 'multiple') {
    return null
  }

  if (historicalResolution.status === 'single') {
    return historicalResolution.candidates[0].candidate
  }

  const [candidate] = await searchAllCorrectionCandidates(
    counterpartyName,
    mappings,
    preferredMappingSheetKey,
    1,
    SOFT_SUGGESTION_SCORE_THRESHOLD,
    rfc,
    false,
    bankId,
    trackingKey,
    referenceNumber,
    amount,
  )
  if (!candidate || candidate.score < SOFT_SUGGESTION_SCORE_THRESHOLD) {
    return null
  }

  return candidate
}

async function searchAllCorrectionCandidates(
  counterpartyName: string,
  mappings: LoadedMappings,
  preferredMappingSheetKey: MappingSheetKey | null,
  limit: number,
  minimumScore = 0.2,
  rfc: string | null = null,
  allowCrossSheetFallback = true,
  bankId: BankImportBankId | null = null,
  trackingKey: string | null = null,
  referenceNumber: string | null = null,
  amount: number | null = null,
) {
  const candidateCollections = await Promise.all(
    getMappingSheetKeys(preferredMappingSheetKey, allowCrossSheetFallback).map(async (mappingSheetKey) => {
      const mappingSheet = mappings[mappingSheetKey]
      const workbookCandidates = findCorrectionCandidates(counterpartyName, mappingSheet, limit, minimumScore)
      const netsuiteCandidates = await findNetSuiteCorrectionCandidates(
        counterpartyName,
        mappingSheet,
        limit,
        minimumScore,
        rfc,
      )

      return [...workbookCandidates, ...netsuiteCandidates]
    }),
  )

  const historicalCandidates = await findHistoricalCorrectionCandidates(
    bankId,
    trackingKey,
    referenceNumber,
    preferredMappingSheetKey,
    amount,
    limit,
  )

  return mergeSuggestedCandidates([
    ...historicalCandidates.map((item) => item.candidate),
    ...candidateCollections.flat(),
  ]).slice(0, limit)
}

function findHistoricalCorrectionCandidates(
  bankId: BankImportBankId | null,
  trackingKey: string | null,
  referenceNumber: string | null,
  preferredMappingSheetKey: MappingSheetKey | null,
  amount: number | null,
  limit: number,
) {
  const lookupKeys = new Set(buildHistoricalLookupKeys(bankId, trackingKey, referenceNumber))
  if (bankId !== 'bbva' || lookupKeys.size === 0) {
    return [] as HistoricalCorrectionCandidate[]
  }

  const historicalItems = loadBankHistoricalRecognitions(bankId)
    .filter(
      (item) =>
        isBankHistoricalRecognitionCorroborated(item) &&
        buildHistoricalLookupKeys(item.bankId, item.trackingKey, item.referenceNumber).some((itemKey) =>
          lookupKeys.has(itemKey),
        ),
    )
    .sort(
      (left, right) =>
        right.updatedAtUtc.localeCompare(left.updatedAtUtc) ||
        right.transactionDate.localeCompare(left.transactionDate) ||
        right.amount - left.amount,
    )

  const prioritizedHistoricalItems =
    amount !== null
      ? (() => {
          const amountMatchedItems = historicalItems.filter((item) => amountsMatch(item.amount, amount))
          return amountMatchedItems.length > 0 ? amountMatchedItems : historicalItems
        })()
      : historicalItems

  const orderedHistoricalItems =
    preferredMappingSheetKey !== null
      ? [
          ...prioritizedHistoricalItems.filter((item) => item.mappingSheetKey === preferredMappingSheetKey),
          ...prioritizedHistoricalItems.filter((item) => item.mappingSheetKey !== preferredMappingSheetKey),
        ]
      : prioritizedHistoricalItems

  const groupedCandidates = new Map<
    string,
    {
      candidate: HistoricalCorrectionCandidate
      latestItemTransactionDate: string
    }
  >()

  orderedHistoricalItems.forEach((item) => {
    const creditAccount = resolveHistoricalCreditAccount(item.mappingSheetKey, item.creditAccount)
    if (!creditAccount) {
      return
    }

    const key = [item.mappingSheetKey, item.transactionType, item.netsuiteName, creditAccount].join(':')
    const candidate: HistoricalCorrectionCandidate = {
      transactionType: item.transactionType,
      candidate: {
        mappingSheetKey: item.mappingSheetKey,
        mappingSheetName: item.mappingSheetName,
        candidateSource: 'historical',
        bankName: item.counterpartyName,
        netsuiteName: item.netsuiteName,
        creditAccount,
        score: 0.995,
        scoreLabel: 'Historico exacto',
        suggestionMethod: 'historical_reference',
        reason: buildHistoricalReferenceReason(item, orderedHistoricalItems.length),
      },
    }

    const current = groupedCandidates.get(key)
    if (!current || item.transactionDate > current.latestItemTransactionDate) {
      groupedCandidates.set(key, {
        candidate,
        latestItemTransactionDate: item.transactionDate,
      })
    }
  })

  return Array.from(groupedCandidates.values())
    .map((item) => item.candidate)
    .sort((left, right) => left.candidate.netsuiteName.localeCompare(right.candidate.netsuiteName))
    .slice(0, limit)
}

function resolveHistoricalCorrectionCandidateResolution(
  bankId: BankImportBankId | null,
  trackingKey: string | null,
  referenceNumber: string | null,
  preferredMappingSheetKey: MappingSheetKey | null,
  amount: number | null,
): HistoricalCorrectionCandidateResolution {
  const candidates = findHistoricalCorrectionCandidates(
    bankId,
    trackingKey,
    referenceNumber,
    preferredMappingSheetKey,
    amount,
    CANDIDATE_SEARCH_LIMIT,
  )

  if (candidates.length === 0) {
    return {
      status: 'none',
      candidates: [],
    }
  }

  if (candidates.length === 1) {
    return {
      status: 'single',
      candidates: [candidates[0]],
    }
  }

  return {
    status: 'multiple',
    candidates,
  }
}

function findCorrectionCandidates(
  counterpartyName: string,
  mappings: MappingCache,
  limit: number,
  minimumScore = 0.2,
) {
  const normalizedQuery = normalizeText(counterpartyName)
  const compactQuery = compactText(counterpartyName)
  const tokens = buildComparableTokens(counterpartyName)

  return mappings.entries
    .map((entry) => buildCorrectionCandidate(entry, mappings, normalizedQuery, compactQuery, tokens, minimumScore))
    .filter((candidate): candidate is BankImportSuggestedCandidate => candidate !== null)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.bankName.localeCompare(right.bankName) ||
        left.netsuiteName.localeCompare(right.netsuiteName),
    )
    .slice(0, limit)
}

function buildCorrectionCandidate(
  entry: MappingEntry,
  mappings: MappingCache,
  normalizedQuery: string,
  compactQuery: string,
  tokens: string[],
  minimumScore: number,
): BankImportSuggestedCandidate | null {
  if (!normalizedQuery) {
    return null
  }

  const compactScore = getCompactSuggestionScore(compactQuery, entry.compactBankName)
  const bankTokenScore = getTokenSimilarity(tokens, buildComparableTokens(entry.bankName))
  const netsuiteTokenScore = getTokenSimilarity(tokens, buildComparableTokens(entry.netsuiteName))

  let score = 0
  let suggestionMethod: BankImportSuggestedCandidate['suggestionMethod'] = 'token_overlap'
  let reason = ''

  if (compactScore >= 0.92) {
    score = compactScore
    suggestionMethod = 'soft_compact'
    reason = 'Coincidencia suave por nombre compacto.'
  } else if (bankTokenScore >= minimumScore) {
    score = bankTokenScore
    suggestionMethod = 'token_overlap'
    reason = 'Coincidencia suave por palabras compartidas con el nombre bancario.'
  } else if (netsuiteTokenScore >= minimumScore) {
    score = netsuiteTokenScore
    suggestionMethod = 'netsuite_overlap'
    reason = 'Coincidencia suave por palabras compartidas con la entidad NetSuite.'
  } else {
    return null
  }

  return {
    mappingSheetKey: mappings.key,
    mappingSheetName: mappings.sheetName,
    candidateSource: 'workbook',
    bankName: entry.bankName,
    netsuiteName: entry.netsuiteName,
    creditAccount: entry.creditAccount,
    score: round3(score),
    scoreLabel: `${Math.round(score * 100)}%`,
    suggestionMethod,
    reason,
  }
}

async function findNetSuiteCorrectionCandidates(
  counterpartyName: string,
  mappings: MappingCache,
  limit: number,
  minimumScore = 0.35,
  rfc: string | null = null,
) {
  const entities = await fetchNetSuiteEntityCandidates(mappings.key)
  const normalizedQuery = normalizeText(counterpartyName)
  const compactQuery = compactText(counterpartyName)
  const tokens = buildComparableTokens(counterpartyName)
  const normalizedRfc = normalizeRfc(rfc)

  return entities
    .map((entity: NetSuiteEntityCandidate) =>
      buildNetSuiteCorrectionCandidate(
        entity,
        mappings,
        normalizedQuery,
        compactQuery,
        tokens,
        minimumScore,
        normalizedRfc,
      ),
    )
    .filter((candidate: BankImportSuggestedCandidate | null): candidate is BankImportSuggestedCandidate => candidate !== null)
    .sort(
      (left: BankImportSuggestedCandidate, right: BankImportSuggestedCandidate) =>
        right.score - left.score ||
        left.netsuiteName.localeCompare(right.netsuiteName) ||
        left.creditAccount.localeCompare(right.creditAccount),
    )
    .slice(0, limit)
}

async function fetchNetSuiteEntityCandidates(mappingSheetKey: MappingSheetKey) {
  return loadOrSyncNetSuiteEntityCatalog(mappingSheetKey)
}

function buildNetSuiteCorrectionCandidate(
  entity: NetSuiteEntityCandidate,
  mappings: MappingCache,
  normalizedQuery: string,
  compactQuery: string,
  tokens: string[],
  minimumScore: number,
  normalizedRfc: string,
): BankImportSuggestedCandidate | null {
  if (!normalizedQuery) {
    return null
  }

  const bankDisplayName = cleanText(entity.companyName || entity.altName || entity.entityId)
  const netsuiteDisplayName = formatNetSuiteEntityDisplayName(entity)
  const compactScore = Math.max(
    getCompactSuggestionScore(compactQuery, compactText(bankDisplayName)),
    getCompactSuggestionScore(compactQuery, compactText(netsuiteDisplayName)),
  )
  const bankTokenScore = getTokenSimilarity(tokens, buildComparableTokens(bankDisplayName))
  const netsuiteTokenScore = getTokenSimilarity(tokens, buildComparableTokens(netsuiteDisplayName))
  const entityRfc = normalizeRfc(entity.rfc)
  const rfcScore = normalizedRfc && entityRfc && normalizedRfc === entityRfc ? 0.995 : 0
  const score = Math.max(compactScore, bankTokenScore, netsuiteTokenScore, rfcScore)
  const creditAccount =
    entity.accountDisplayName ||
    resolveNetSuiteEntityFallbackAccount(mappings.key, compactScore, bankTokenScore, netsuiteTokenScore, rfcScore)

  if (score < minimumScore || !creditAccount) {
    return null
  }

  return {
    mappingSheetKey: mappings.key,
    mappingSheetName: mappings.sheetName,
    candidateSource: 'netsuite',
    bankName: bankDisplayName || netsuiteDisplayName,
    netsuiteName: netsuiteDisplayName,
    creditAccount,
    entityInternalId: entity.internalId,
    postingDisplayName: formatNetSuiteEntityPostingDisplayName(entity),
    score: round3(score),
    scoreLabel: `${Math.round(score * 100)}%`,
    suggestionMethod: 'netsuite_entity',
    reason:
      rfcScore >= 0.99
        ? 'Coincidencia exacta por RFC contra la entidad de NetSuite.'
        : !entity.accountDisplayName
        ? 'Coincidencia exacta contra NetSuite; se propone con la cuenta nacional por defecto al no venir una cuenta propia en el catalogo.'
        : compactScore >= 0.92
        ? 'Coincidencia directa contra la entidad de NetSuite.'
        : 'Coincidencia propuesta desde NetSuite con cuenta contable de la entidad.',
  }
}

function resolveNetSuiteEntityFallbackAccount(
  mappingSheetKey: MappingSheetKey,
  compactScore: number,
  bankTokenScore: number,
  netsuiteTokenScore: number,
  rfcScore: number,
) {
  if (mappingSheetKey !== 'suppliers') {
    return null
  }

  const hasHighConfidenceMatch =
    rfcScore >= 0.99 || compactScore >= 0.92 || bankTokenScore >= 0.99 || netsuiteTokenScore >= 0.99

  return hasHighConfidenceMatch ? DEFAULT_SUPPLIER_ACCOUNT_DISPLAY_NAME : null
}

function mergeSuggestedCandidates(candidates: BankImportSuggestedCandidate[]) {
  const merged = new Map<string, BankImportSuggestedCandidate>()

  candidates.forEach((candidate) => {
    const key = [
      candidate.mappingSheetKey,
      candidate.candidateSource,
      candidate.bankName,
      candidate.netsuiteName,
      candidate.creditAccount,
    ].join(':')
    const current = merged.get(key)
    if (!current || candidate.score > current.score) {
      merged.set(key, candidate)
    }
  })

  return Array.from(merged.values()).sort(
    (left, right) =>
      right.score - left.score ||
      left.netsuiteName.localeCompare(right.netsuiteName) ||
      left.creditAccount.localeCompare(right.creditAccount),
  )
}

function resolveHistoricalCreditAccount(mappingSheetKey: MappingSheetKey, creditAccount: string) {
  const cleanedAccount = cleanText(creditAccount)
  if (cleanedAccount) {
    return cleanedAccount
  }

  return mappingSheetKey === 'customers' ? DEFAULT_CUSTOMER_ACCOUNT_DISPLAY_NAME : DEFAULT_SUPPLIER_ACCOUNT_DISPLAY_NAME
}

function normalizeHistoricalTrackingKey(bankId: BankImportBankId | null | undefined, trackingKey: string | null | undefined) {
  const compactTrackingKey = compactText(trackingKey)
  if (!compactTrackingKey) {
    return null
  }

  if (bankId === 'bbva') {
    const bbvaDepositReferenceMatch = /^(?:REF)?(BNTC[0-9A-Z]+)$/.exec(compactTrackingKey)
    if (bbvaDepositReferenceMatch) {
      return `BBVA_TRACK:${bbvaDepositReferenceMatch[1]}`
    }

    return null
  }

  return compactTrackingKey
}

function normalizeHistoricalReferenceNumber(
  bankId: BankImportBankId | null | undefined,
  referenceNumber: string | null | undefined,
) {
  if (bankId === 'bbva') {
    return isBbvaStableHistoricalReferenceNumber(referenceNumber)
      ? `BBVA_REFERENCE:${compactText(referenceNumber)}`
      : null
  }

  const compactReferenceNumber = compactText(referenceNumber)
  if (!compactReferenceNumber) {
    return null
  }

  return compactReferenceNumber
}

function buildHistoricalLookupKeys(
  bankId: BankImportBankId | null | undefined,
  trackingKey: string | null | undefined,
  referenceNumber: string | null | undefined,
) {
  const lookupKeys = new Set<string>()
  const normalizedTrackingKey = normalizeHistoricalTrackingKey(bankId, trackingKey)
  const normalizedReferenceNumber = normalizeHistoricalReferenceNumber(bankId, referenceNumber)

  if (normalizedTrackingKey) {
    lookupKeys.add(normalizedTrackingKey)
  }

  if (normalizedReferenceNumber) {
    lookupKeys.add(normalizedReferenceNumber)
  }

  return Array.from(lookupKeys)
}

function buildHistoricalReferenceReason(
  item: {
    trackingKey: string | null
    referenceNumber?: string | null
    transactionDate: string
    amount: number
    netsuiteName: string
  },
  totalMatches: number,
) {
  const referenceTokens = [
    isBbvaStableHistoricalTrackingKey(item.trackingKey) ? `Ref. ${cleanText(item.trackingKey)}` : null,
    isBbvaStableHistoricalReferenceNumber(item.referenceNumber) ? `BNET ${cleanText(item.referenceNumber)}` : null,
  ].filter((value): value is string => Boolean(value))
  const referenceLabel = referenceTokens.join(' / ') || 'movimiento corroborado previamente'
  const repeatedLabel =
    totalMatches > 1 ? ` Ya aparece ${totalMatches} veces en el historico BBVA.` : ''

  return `Coincidencia historica exacta ${referenceLabel} ya reconocida el ${item.transactionDate} por ${formatMoney(item.amount)} hacia ${item.netsuiteName}.${repeatedLabel}`
}

function formatNetSuiteEntityDisplayName(entity: NetSuiteEntityCandidate) {
  const preferredName = cleanText(entity.companyName || entity.altName || entity.entityId)
  const entityId = cleanText(entity.entityId)
  if (/^\d+$/.test(entityId) && preferredName) {
    return `${entityId} ${preferredName}`.trim()
  }

  return preferredName || entityId
}

function formatNetSuiteEntityPostingDisplayName(entity: NetSuiteEntityCandidate) {
  const preferredName = cleanText(entity.altName || entity.companyName || entity.entityId)
  const entityId = cleanText(entity.entityId)
  if (/^\d+$/.test(entityId) && preferredName) {
    return `${entityId} ${preferredName}`.trim()
  }

  return preferredName || entityId
}

function buildComparableTokens(value: string) {
  const stopWords = new Set([
    'SA',
    'S',
    'DE',
    'CV',
    'RL',
    'C',
    'A',
    'SAPI',
    'SAB',
    'SC',
    'THE',
    'DEL',
    'LAS',
    'LOS',
    'Y',
    'SHQ',
  ])

  return normalizeText(splitEmbeddedNameSegments(value))
    .split(/[^A-Z0-9]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3 && !stopWords.has(item))
}

function splitEmbeddedNameSegments(value: string) {
  return cleanText(value)
    .replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, '$1 $2')
    .replace(/([A-ZÁÉÍÓÚÑ])([A-ZÁÉÍÓÚÑ][a-záéíóúñ])/g, '$1 $2')
}

function getCompactSuggestionScore(left: string, right: string) {
  if (!left || !right) {
    return 0
  }

  if (left === right) {
    return 1
  }

  const minLength = Math.min(left.length, right.length)
  if (minLength < 8) {
    return 0
  }

  if (left.includes(right) || right.includes(left)) {
    return 0.94
  }

  return 0
}

function getTokenSimilarity(leftTokens: string[], rightTokens: string[]) {
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0
  }

  const sharedCount = getSharedTokenCount(leftTokens, rightTokens)
  if (sharedCount === 0) {
    return 0
  }

  return sharedCount / Math.max(leftTokens.length, rightTokens.length)
}

function getSharedTokenCount(leftTokens: string[], rightTokens: string[]) {
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0
  }

  const rightSet = new Set(rightTokens)
  return leftTokens.filter((item) => rightSet.has(item)).length
}

function buildCorrectionKey(
  bankId: BankImportBankId,
  sourceProfileId: string,
  mappingSheetKey: MappingSheetKey | null,
  externalId: string,
) {
  return `${bankId}:${sourceProfileId}:${mappingSheetKey ?? 'special'}:${cleanText(externalId)}`
}

function resolveSourceProfileIdFromCorrectionKey(
  correctionKey: string,
  bankId: BankImportBankId,
  transactionType: string,
) {
  const [candidateBankId, sourceProfileIdToken] = cleanText(correctionKey).split(':')
  if (candidateBankId !== bankId) {
    throw new BankImportError('La correccion no corresponde al banco o layout activo.')
  }

  if (!sourceProfileIdToken || isLegacyCorrectionKeyToken(sourceProfileIdToken)) {
    return resolveSourceProfileIdForTransactionType(bankId, transactionType)
  }

  return sourceProfileIdToken
}

function resolveSourceProfileIdForTransactionType(bankId: BankImportBankId, transactionType: string) {
  if (bankId === 'clara_corriente') {
    return normalizeText(transactionType) === 'DEPOSIT' ? 'clara_account_activity' : 'clara_payments'
  }

  if (bankId === 'bbva') {
    return 'bbva_pdf'
  }

  return 'payana_transacciones'
}

function resolveAllowCrossSheetFallbackForSourceProfile(sourceProfileId: string) {
  return sourceProfileId === 'payana_transacciones'
}

function shouldPreserveTransientCorrectionClassification(
  bankId: BankImportBankId,
  sourceProfileId: string,
  transactionRule: ResolvedTransactionRule,
) {
  if (bankId === 'bbva') {
    return true
  }

  return (
    bankId === 'clara_corriente' &&
    sourceProfileId === 'clara_payments' &&
    transactionRule.normalizedTransactionType === 'PAGO'
  )
}

function isLegacyCorrectionKeyToken(value: string) {
  return value === 'customers' || value === 'suppliers' || value === 'special'
}

function applyTransientCorrectionToMovement(
  movement: ParsedBankMovement,
  correction: BankImportTransientCorrection | undefined,
  mappings: LoadedMappings,
  preserveCurrentClassification = false,
): ParsedBankMovement {
  if (!correction) {
    return movement
  }

  const targetSheet = mappings[correction.mappingSheetKey]
  const correctionCounterpartyName = cleanText(correction.counterpartyName)
  const correctedMovement =
    correctionCounterpartyName.length > 0
      ? {
          ...movement,
          counterpartyName: correctionCounterpartyName,
          statementCounterpartyName:
            movement.statementCounterpartyName ??
            (movement.counterpartySource === 'statement' ? correctionCounterpartyName : null),
          normalizedCounterpartyName: normalizeText(correctionCounterpartyName),
          compactCounterpartyName: compactText(correctionCounterpartyName),
        }
      : movement

  return applyResolvedMappingToMovement(correctedMovement, {
    mappingSheetKey: correction.mappingSheetKey,
    mappingSheetName: targetSheet?.sheetName ?? correctedMovement.mappingSheetName,
    netsuiteName: correction.netsuiteName,
    creditAccount: correction.creditAccount,
    mappingMethod: 'manual_single',
    preserveCurrentClassification,
    entityInternalId: correction.entityInternalId ?? null,
    postingDisplayName: correction.postingDisplayName ?? null,
    })
}

function applyBankSpecificMovementRules(
  bankId: BankImportBankId,
  sourceProfileId: string,
  movement: ParsedBankMovement,
): ParsedBankMovement {
  if (!isBbvaDelayCompensationMovement(bankId, sourceProfileId, movement)) {
    return movement
  }

  return applyResolvedMappingToMovement(movement, {
    mappingSheetKey: 'customers',
    mappingSheetName: 'Productos financieros',
    netsuiteName: BBVA_DELAY_COMPENSATION_VENDOR_NAME,
    creditAccount: BBVA_DELAY_COMPENSATION_INCOME_ACCOUNT,
    mappingMethod: 'exact',
    preserveCurrentClassification: true,
  })
}

function isBbvaDelayCompensationMovement(
  bankId: BankImportBankId,
  sourceProfileId: string,
  movement: ParsedBankMovement,
) {
  if (bankId !== 'bbva' || sourceProfileId !== 'bbva_pdf') {
    return false
  }

  const normalizedText = normalizeText(
    [movement.counterpartyName, movement.statementCounterpartyName, movement.paymentConcept]
      .filter(Boolean)
      .join(' '),
  )
  return normalizedText.includes('COMPENSACION POR RETRASO')
}

function applyClaraDepositSeedMappings(bankId: BankImportBankId, sourceProfileId: string, mappings: LoadedMappings) {
  if (bankId !== 'clara_corriente' || sourceProfileId !== 'clara_account_activity') {
    return
  }

  getClaraDepositSeedMappings().forEach((seed) => {
    const targetSheet = mappings[seed.mappingSheetKey]
    if (!targetSheet) {
      return
    }

    const targetEntry = findMappingEntryByNetSuiteName(targetSheet, seed.netsuiteName)
    if (!targetEntry) {
      return
    }

    applyManualCorrectionEntry(mappings, {
      bankName: seed.counterpartyName,
      normalizedBankName: normalizeText(seed.counterpartyName),
      compactBankName: compactText(seed.counterpartyName),
      netsuiteName: targetEntry.netsuiteName,
      creditAccount: targetEntry.creditAccount,
      mappingSheetKey: targetEntry.mappingSheetKey,
      mappingSheetName: targetEntry.mappingSheetName,
    })
  })
}

async function resolveHistoricalCandidateOnMovementSheet(
  movement: ParsedBankMovement,
  historicalCandidate: HistoricalCorrectionCandidate,
  mappings: LoadedMappings,
): Promise<{
  mappingSheetKey: MappingSheetKey
  mappingSheetName: string
  netsuiteName: string
  creditAccount: string
} | null> {
  const targetSheetKey = movement.transactionRule.mappingSheetKey
  if (!targetSheetKey) {
    return null
  }

  const targetSheet = mappings[targetSheetKey]
  if (!targetSheet) {
    return null
  }

  const workbookMatch = findMappingEntryByNetSuiteName(targetSheet, historicalCandidate.candidate.netsuiteName)
  if (workbookMatch) {
    return {
      mappingSheetKey: workbookMatch.mappingSheetKey,
      mappingSheetName: workbookMatch.mappingSheetName,
      netsuiteName: workbookMatch.netsuiteName,
      creditAccount: workbookMatch.creditAccount,
    }
  }

  const entityMatch = await resolveExactNetSuiteEntityForSheet(targetSheetKey, historicalCandidate.candidate.netsuiteName)
  if (!entityMatch) {
    return null
  }

  return {
    mappingSheetKey: targetSheetKey,
    mappingSheetName: targetSheet.sheetName,
    netsuiteName: entityMatch.netsuiteName,
    creditAccount: entityMatch.creditAccount,
  }
}

async function applyHistoricalRecognitionToMovement(
  movement: ParsedBankMovement,
  bankId: BankImportBankId,
  mappings: LoadedMappings,
): Promise<ParsedBankMovement> {
  if (
    bankId !== 'bbva' ||
    movement.mappingMethod === 'manual_single' ||
    (movement.netsuiteName && movement.mappedAccount) ||
    (!isBbvaStableHistoricalTrackingKey(movement.trackingKey) &&
      !isBbvaStableHistoricalReferenceNumber(movement.referenceNumber)) ||
    !movement.transactionRule.mappingSheetKey
  ) {
    return movement
  }

  const historicalResolution = resolveHistoricalCorrectionCandidateResolution(
    bankId,
    movement.trackingKey,
    movement.referenceNumber,
    movement.transactionRule.mappingSheetKey,
    movement.amount,
  )

  if (historicalResolution.status !== 'single') {
    return movement
  }

  const [historicalCandidate] = historicalResolution.candidates
  if (isHistoricalCandidateCompatibleWithMovement(movement, historicalCandidate)) {
    return applyResolvedMappingToMovement(movement, {
      mappingSheetKey: historicalCandidate.candidate.mappingSheetKey,
      mappingSheetName: historicalCandidate.candidate.mappingSheetName,
      netsuiteName: historicalCandidate.candidate.netsuiteName,
      creditAccount: historicalCandidate.candidate.creditAccount,
      mappingMethod: 'historical_exact',
      preferredTransactionType: historicalCandidate.transactionType,
      preserveCurrentClassification: bankId === 'bbva',
    })
  }

  const projectedCandidate = await resolveHistoricalCandidateOnMovementSheet(movement, historicalCandidate, mappings)
  if (!projectedCandidate) {
    return movement
  }

  return applyResolvedMappingToMovement(movement, {
    mappingSheetKey: projectedCandidate.mappingSheetKey,
    mappingSheetName: projectedCandidate.mappingSheetName,
    netsuiteName: projectedCandidate.netsuiteName,
    creditAccount: projectedCandidate.creditAccount,
    mappingMethod: 'historical_exact',
    preserveCurrentClassification: true,
  })
}

async function applyBbvaSpeiAutoResolution(
  bankId: BankImportBankId,
  sourceProfileId: string,
  analysisMode: BankImportAnalysisMode,
  accountingPeriodWindow: AccountingPeriodWindow,
  movement: ParsedBankMovement,
  mappings: LoadedMappings,
  allowCrossSheetFallback: boolean,
): Promise<ParsedBankMovement> {
  if (
    !shouldRunBbvaBanxicoAnalysis(bankId, sourceProfileId, analysisMode) ||
    movement.mappingMethod === 'manual_single' ||
    (movement.netsuiteName && movement.mappedAccount)
  ) {
    return movement
  }

  const lookupRow = buildBbvaSpeiBanxicoLookupRow(movement)
  if (!shouldEnrichBbvaSpeiRow(lookupRow, accountingPeriodWindow)) {
    return movement
  }

  const resolution = await resolveBbvaSpeiCounterpartyFromBanxico(lookupRow)
  const counterpartyName = cleanText(resolution?.counterpartyName)
  if (!resolution || !counterpartyName) {
    return movement
  }

  const banxicoResolvedMovement: ParsedBankMovement = {
    ...movement,
    counterpartyName,
    statementCounterpartyName: movement.statementCounterpartyName ?? movement.counterpartyName,
    counterpartySource: 'banxico_ordering_party',
    orderingPartyName: counterpartyName,
    orderingPartyRfc: resolution.rfc ?? movement.orderingPartyRfc ?? movement.rfc ?? null,
    orderingPartyAccount: resolution.orderingPartyAccount ?? movement.orderingPartyAccount ?? null,
    normalizedCounterpartyName: normalizeText(counterpartyName),
    compactCounterpartyName: compactText(counterpartyName),
    rfc: resolution.rfc ?? movement.rfc,
    trackingKey: resolution.trackingKey ?? movement.trackingKey,
    referenceNumber: resolution.referenceNumber || movement.referenceNumber,
    originBankName: resolution.originBankName ?? movement.originBankName ?? null,
    destinationBankName: resolution.destinationBankName ?? movement.destinationBankName ?? null,
    destinationAccount: resolution.destinationAccount ?? movement.destinationAccount ?? null,
  }

  const mappingResolution = resolveMappingEntryAcrossSheets(
    counterpartyName,
    movement.transactionRule.mappingSheetKey,
    mappings,
    allowCrossSheetFallback,
  )
  if (!mappingResolution.entry) {
    return banxicoResolvedMovement
  }

  return applyResolvedMappingToMovement(banxicoResolvedMovement, {
    mappingSheetKey: mappingResolution.entry.mappingSheetKey,
    mappingSheetName: mappingResolution.entry.mappingSheetName,
    netsuiteName: mappingResolution.entry.netsuiteName,
    creditAccount: mappingResolution.entry.creditAccount,
    mappingMethod: 'auto_banxico',
    preserveCurrentClassification: true,
  })
}

function buildBbvaSpeiBanxicoLookupRow(movement: ParsedBankMovement): BankImportParsedSourceRow {
  return {
    processingDate: movement.processingDate,
    status: 'Procesado',
    amount: movement.amount,
    transactionType: movement.transactionType,
    counterpartyName: movement.counterpartyName,
    statementCounterpartyName: movement.statementCounterpartyName,
    counterpartySource: movement.counterpartySource,
    orderingPartyName: movement.orderingPartyName,
    orderingPartyRfc: movement.orderingPartyRfc,
    orderingPartyAccount: movement.orderingPartyAccount,
    paymentConcept: movement.paymentConcept ?? '',
    trackingKey: movement.trackingKey ?? '',
    hashId: movement.hashId ?? '',
    rfc: movement.rfc,
    originBankName: movement.originBankName,
    destinationBankName: movement.destinationBankName,
    destinationAccount: movement.destinationAccount,
    referenceNumber: movement.referenceNumber,
  }
}

function shouldRunBbvaBanxicoAnalysis(
  bankId: BankImportBankId,
  sourceProfileId: string,
  analysisMode: BankImportAnalysisMode,
) {
  return bankId === 'bbva' && sourceProfileId === 'bbva_pdf' && analysisMode === 'banxico'
}

function shouldRunClaraBanxicoAnalysis(
  bankId: BankImportBankId,
  sourceProfileId: string,
  analysisMode: BankImportAnalysisMode,
) {
  return bankId === 'clara_corriente' && sourceProfileId === 'clara_account_activity' && analysisMode === 'banxico'
}

async function applyClaraDepositAutoResolution(
  bankId: BankImportBankId,
  sourceProfileId: string,
  analysisMode: BankImportAnalysisMode,
  movement: ParsedBankMovement,
  mappings: LoadedMappings,
): Promise<ParsedBankMovement> {
  if (
    !shouldRunClaraBanxicoAnalysis(bankId, sourceProfileId, analysisMode) ||
    movement.mappingMethod === 'manual_single' ||
    movement.counterpartySource !== 'banxico_ordering_party' ||
    movement.transactionRule.normalizedTransactionType !== 'DEPOSIT' ||
    (movement.netsuiteName && movement.mappedAccount)
  ) {
    return movement
  }

  const candidates = await searchAllCorrectionCandidates(
    movement.counterpartyName,
    mappings,
    movement.mappingSheetKey ?? movement.transactionRule.mappingSheetKey,
    CANDIDATE_SEARCH_LIMIT,
    SOFT_SUGGESTION_SCORE_THRESHOLD,
    movement.orderingPartyRfc ?? movement.rfc,
    true,
    bankId,
    movement.trackingKey,
    movement.referenceNumber,
    movement.amount,
  )
  const autoResolution = pickClaraDepositAutoCandidate({
    counterpartyName: movement.counterpartyName,
    statementCounterpartyName: movement.statementCounterpartyName,
    paymentConcept: movement.paymentConcept,
    candidates,
  })
  if (!autoResolution) {
    return movement
  }

  return applyResolvedMappingToMovement(movement, {
    mappingSheetKey: autoResolution.candidate.mappingSheetKey,
    mappingSheetName: autoResolution.candidate.mappingSheetName,
    netsuiteName: autoResolution.candidate.netsuiteName,
    creditAccount: autoResolution.candidate.creditAccount,
    mappingMethod: 'auto_banxico',
    preferredTransactionType: autoResolution.preferredTransactionType,
  })
}

function isHistoricalCandidateCompatibleWithMovement(
  movement: ParsedBankMovement,
  historicalCandidate: HistoricalCorrectionCandidate,
) {
  const candidateRule = resolveTransactionRule(historicalCandidate.transactionType)

  if (!movement.transactionRule.mappingSheetKey || !candidateRule.mappingSheetKey) {
    return false
  }

  return (
    movement.transactionRule.mappingSheetKey === candidateRule.mappingSheetKey &&
    movement.transactionRule.journalMode === candidateRule.journalMode
  )
}

async function fetchNetSuiteSweep(
  bank: SupportedBankConfig,
  cutoffDate: Date,
  endDate?: Date | null,
): Promise<NetSuiteSweepInternal> {
  if (!bank.netsuiteRegisterAccountId) {
    return {
      status: 'not_configured',
      accountId: null,
      accountLabel: null,
      registerLines: [],
      warning: 'Este banco todavia no tiene configurada una cuenta bancaria de NetSuite para barrido.',
    }
  }

  if (!/^\d+$/.test(bank.netsuiteRegisterAccountId)) {
    return {
      status: 'unavailable',
      accountId: bank.netsuiteRegisterAccountId,
      accountLabel: null,
      registerLines: [],
      warning: `La cuenta de registro ${bank.netsuiteRegisterAccountId} no es valida para SuiteQL.`,
    }
  }

  try {
    const client = NetSuiteClient.fromEnv()
    const registerLines = await fetchAllRegisterLines(client, bank.netsuiteRegisterAccountId, cutoffDate, endDate)

    return {
      status: 'applied',
      accountId: bank.netsuiteRegisterAccountId,
      accountLabel: registerLines[0]?.accountLabel ?? bank.debitAccount,
      registerLines,
      warning: null,
    }
  } catch (error) {
    return {
      status: 'unavailable',
      accountId: bank.netsuiteRegisterAccountId,
      accountLabel: null,
      registerLines: [],
      warning: error instanceof Error ? error.message : 'No pude consultar el registro bancario en NetSuite.',
    }
  }
}

async function fetchAllRegisterLines(client: NetSuiteClient, accountId: string, cutoffDate: Date, endDate?: Date | null) {
  const query = buildRegisterSweepQuery(accountId, cutoffDate, endDate)
  const items: Record<string, unknown>[] = []
  const limit = 1000
  let offset = 0

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await client.suiteql(query, limit, offset)
    const pageItems = Array.isArray(response.json.items) ? response.json.items : []
    items.push(...pageItems)
    if (pageItems.length < limit) {
      break
    }

    offset += limit
  }

  return items
    .map((item) => parseNetSuiteRegisterLine(item))
    .filter((item): item is NetSuiteRegisterLine => item !== null)
}

function buildRegisterSweepQuery(accountId: string, cutoffDate: Date, endDate?: Date | null) {
  const endDateFilter = endDate
    ? `\n      AND transaction.trandate <= TO_DATE('${formatDateOnly(endDate)}', 'YYYY-MM-DD')`
    : ''
  return `
    SELECT
      tal.account AS accountid,
      BUILTIN.DF(tal.account) AS accountlabel,
      transaction.id AS transactionid,
      transaction.tranid AS documentnumber,
      transaction.trandate AS transactiondate,
      BUILTIN.DF(transaction.type) AS transactiontype,
      BUILTIN.DF(transaction.entity) AS headerentityname,
      BUILTIN.DF(transactionLine.entity) AS lineentityname,
      transaction.memo AS headermemo,
      transactionLine.memo AS linememo,
      NVL(tal.debit, 0) AS debitamount,
      NVL(tal.credit, 0) AS creditamount,
      transactionLine.uniquekey AS lineuniquekey
    FROM TransactionAccountingLine tal
    INNER JOIN transaction
      ON transaction.id = tal.transaction
    INNER JOIN transactionLine
      ON transactionLine.transaction = tal.transaction
      AND transactionLine.id = tal.transactionline
    WHERE tal.account = '${accountId}'
      AND transaction.posting = 'T'
      AND transaction.trandate >= TO_DATE('${formatDateOnly(cutoffDate)}', 'YYYY-MM-DD')
      ${endDateFilter}
    ORDER BY transaction.trandate ASC, transaction.id ASC, transactionLine.id ASC
  `
}

function parseNetSuiteRegisterLine(item: Record<string, unknown>): NetSuiteRegisterLine | null {
  const debitAmount = parseAmount(item.debitamount)
  const creditAmount = parseAmount(item.creditamount)
  const amount =
    debitAmount && debitAmount > 0 ? debitAmount : creditAmount && creditAmount > 0 ? creditAmount : null
  if (!amount) {
    return null
  }

  const transactionDate = parseSpreadsheetDate(item.transactiondate)
  if (!transactionDate) {
    return null
  }

  const direction: RecognitionDirection =
    debitAmount && debitAmount > 0 ? 'incoming' : creditAmount && creditAmount > 0 ? 'outgoing' : 'unknown'
  const transactionId = cleanText(item.transactionid)
  const uniqueKey = cleanText(item.lineuniquekey) || `${transactionId}:${formatDateOnly(transactionDate)}:${amount}`

  return {
    key: uniqueKey,
    accountId: cleanText(item.accountid),
    accountLabel: cleanText(item.accountlabel) || null,
    transactionId,
    documentNumber: cleanText(item.documentnumber) || null,
    transactionDate,
    transactionDateText: formatDateOnly(transactionDate),
    transactionType: cleanText(item.transactiontype) || null,
    entityName: cleanText(item.lineentityname) || cleanText(item.headerentityname) || null,
    compactEntityName: compactText(cleanText(item.lineentityname) || cleanText(item.headerentityname)),
    headerMemo: cleanText(item.headermemo) || null,
    compactHeaderMemo: compactText(item.headermemo),
    lineMemo: cleanText(item.linememo) || null,
    compactLineMemo: compactText(item.linememo),
    amount,
    direction,
  }
}

function reconcileRecognizedRows(rows: ParsedBankMovement[], registerLines: NetSuiteRegisterLine[]) {
  const usedRegisterLines = new Set<string>()
  const matches: Array<{
    rowIndex: number
    movement: ParsedBankMovement
    match: RecognitionMatch
  }> = []

  const orderedRows = [...rows].sort(
    (left, right) =>
      buildMovementRecognitionTexts(right).length - buildMovementRecognitionTexts(left).length ||
      left.transactionDate.localeCompare(right.transactionDate) ||
      left.counterpartyName.localeCompare(right.counterpartyName),
  )

  orderedRows.forEach((movement) => {
    const match = findBestRecognitionMatch(movement, registerLines, usedRegisterLines)
    if (!match) {
      return
    }

    usedRegisterLines.add(match.registerLine.key)
    matches.push({
      rowIndex: movement.rowIndex,
      movement,
      match,
    })
  })

  return matches
}

function findBestRecognitionMatch(
  movement: ParsedBankMovement,
  registerLines: NetSuiteRegisterLine[],
  usedRegisterLines: Set<string>,
): RecognitionMatch | null {
  if (movement.recognitionDirection === 'unknown') {
    return null
  }

  const movementTexts = buildMovementRecognitionTexts(movement)
  if (movementTexts.length === 0) {
    return null
  }

  let bestMatch: RecognitionMatch | null = null

  registerLines.forEach((registerLine) => {
    if (usedRegisterLines.has(registerLine.key) || registerLine.direction !== movement.recognitionDirection) {
      return
    }

    if (!amountsMatch(movement.amount, registerLine.amount)) {
      return
    }

    const dayDifference = getDayDifference(movement.processingDate, registerLine.transactionDate)
    if (dayDifference > NETSUITE_RECOGNITION_MAX_DAY_DIFFERENCE) {
      return
    }

    const registerTexts = buildRegisterRecognitionTexts(registerLine)
    const textMatch = getBestTextMatch(movementTexts, registerTexts)
    if (!textMatch) {
      return
    }

    const score = dayDifference * 10 + textMatch.score
    const candidate: RecognitionMatch = {
      registerLine,
      matchRule: `Importe exacto + fecha cercana + ${textMatch.label}`,
      score,
      dayDifference,
      textMatch,
    }

    if (
      !bestMatch ||
      score < bestMatch.score ||
      (score === bestMatch.score && compareRecognitionCandidates(candidate, bestMatch) < 0)
    ) {
      bestMatch = candidate
    }
  })

  return bestMatch
}

async function fillCurrentMonthRecognitionGaps({
  bank,
  statementMaxProcessingDate,
  accountingPeriodWindow,
  currentSweep,
  initialSweepMatches,
  manualRecognizedRows,
  readyJournalCandidates,
}: {
  bank: SupportedBankConfig
  statementMaxProcessingDate: Date | null
  accountingPeriodWindow: AccountingPeriodWindow
  currentSweep: NetSuiteSweepInternal
  initialSweepMatches: Array<{
    rowIndex: number
    movement: ParsedBankMovement
    match: RecognitionMatch
  }>
  manualRecognizedRows: Array<{
    rowIndex: number
    movement: ParsedBankMovement
    match: ManualRecognitionMatch
  }>
  readyJournalCandidates: ReadyJournalCandidate[]
}): Promise<{
  sweep: NetSuiteSweepInternal
  matches: MonthlyRecognitionGapMatch[]
}> {
  if (currentSweep.status !== 'applied') {
    return {
      sweep: currentSweep,
      matches: [],
    }
  }

  const referenceDate = statementMaxProcessingDate ?? accountingPeriodWindow.referenceDate
  let sweepForGapFill = currentSweep
  if (statementMaxProcessingDate && statementMaxProcessingDate.getTime() > accountingPeriodWindow.end.getTime()) {
    const monthlySweep = await fetchNetSuiteSweep(
      bank,
      accountingPeriodWindow.start,
      accountingPeriodWindow.end,
    )
    if (monthlySweep.status === 'applied') {
      sweepForGapFill = monthlySweep
    }
  }

  if (sweepForGapFill.status !== 'applied' || sweepForGapFill.registerLines.length === 0) {
    return {
      sweep: sweepForGapFill,
      matches: [],
    }
  }

  if (readyJournalCandidates.length === 0) {
    return {
      sweep: sweepForGapFill,
      matches: [],
    }
  }

  const usedRegisterLines = new Set(initialSweepMatches.map((item) => item.match.registerLine.key))
  const usedTransactionIds = new Set(manualRecognizedRows.map((item) => item.match.netsuiteTransactionId))
  const orderedCandidates = readyJournalCandidates
    .filter((item) => isSameCalendarMonth(item.movement.processingDate, referenceDate))
    .sort(
      (left, right) =>
        Number(right.movement.mappingMethod === 'manual_single') -
          Number(left.movement.mappingMethod === 'manual_single') ||
        buildReadyJournalRecognitionTexts(right).length - buildReadyJournalRecognitionTexts(left).length ||
        left.journal.transactionDate.localeCompare(right.journal.transactionDate) ||
        left.journal.counterpartyName.localeCompare(right.journal.counterpartyName),
    )

  const matches: MonthlyRecognitionGapMatch[] = []
  orderedCandidates.forEach((candidate) => {
    const match = findMonthlyGapFillRecognitionMatch(
      candidate,
      sweepForGapFill.registerLines,
      usedRegisterLines,
      usedTransactionIds,
    )
    if (!match) {
      return
    }

    usedRegisterLines.add(match.registerLine.key)
    usedTransactionIds.add(match.registerLine.transactionId)
    matches.push({
      movement: candidate.movement,
      journal: candidate.journal,
      match,
    })
  })

  return {
    sweep: sweepForGapFill,
    matches,
  }
}

function buildNetSuiteSweepPeriodRows({
  registerLines,
  recognizedRows,
  manualRecognizedRows,
  monthlyGapMatches,
}: {
  registerLines: NetSuiteRegisterLine[]
  recognizedRows: Array<{
    rowIndex: number
    movement: ParsedBankMovement
    match: RecognitionMatch
  }>
  manualRecognizedRows: Array<{
    rowIndex: number
    movement: ParsedBankMovement
    match: ManualRecognitionMatch
  }>
  monthlyGapMatches: MonthlyRecognitionGapMatch[]
}) {
  const rowsByRegisterKey = new Map(
    registerLines.map((registerLine) => [registerLine.key, buildPeriodOnlyNetSuiteRow(registerLine)]),
  )

  recognizedRows.forEach(({ movement, match }) => {
    rowsByRegisterKey.set(match.registerLine.key, buildRecognizedRow(movement, match))
  })

  monthlyGapMatches.forEach(({ movement, match }) => {
    rowsByRegisterKey.set(
      match.registerLine.key,
      buildRecognizedRow(movement, {
        ...match,
        matchRule: `${match.matchRule}; barrido mensual posterior a homologacion`,
      }),
    )
  })

  const orphanManualRows: BankImportNetSuiteRecognizedRow[] = []
  manualRecognizedRows.forEach(({ movement, match }) => {
    const registerLine = findRegisterLineForManualRecognitionRow(movement, match, registerLines)
    const recognizedRow = buildManualRecognizedRow(movement, match)
    if (registerLine) {
      rowsByRegisterKey.set(registerLine.key, recognizedRow)
      return
    }

    if (
      orphanManualRows.some(
        (item) =>
          item.externalId === recognizedRow.externalId &&
          item.netsuiteTransactionId === recognizedRow.netsuiteTransactionId,
      )
    ) {
      return
    }

    orphanManualRows.push(recognizedRow)
  })

  return [...rowsByRegisterKey.values(), ...orphanManualRows].sort(
    (left, right) =>
      left.netsuiteTransactionDate.localeCompare(right.netsuiteTransactionDate) ||
      Number(left.rowOrigin === 'period_only') - Number(right.rowOrigin === 'period_only') ||
      left.counterpartyName.localeCompare(right.counterpartyName) ||
      left.amount - right.amount,
  )
}

function findRegisterLineForManualRecognitionRow(
  movement: ParsedBankMovement,
  match: ManualRecognitionMatch,
  registerLines: NetSuiteRegisterLine[],
) {
  const candidates = registerLines
    .filter(
      (registerLine) =>
        registerLine.transactionId === match.netsuiteTransactionId &&
        amountsMatch(registerLine.amount, movement.amount) &&
        registerLine.direction === movement.recognitionDirection,
    )
    .sort(
      (left, right) =>
        getDayDifference(movement.processingDate, left.transactionDate) -
          getDayDifference(movement.processingDate, right.transactionDate) ||
        left.key.localeCompare(right.key),
    )

  return candidates[0] ?? registerLines.find((registerLine) => registerLine.transactionId === match.netsuiteTransactionId) ?? null
}

function buildPeriodOnlyNetSuiteRow(registerLine: NetSuiteRegisterLine): BankImportNetSuiteRecognizedRow {
  const directionLabel =
    registerLine.direction === 'incoming'
      ? 'Ingreso NetSuite'
      : registerLine.direction === 'outgoing'
        ? 'Egreso NetSuite'
        : registerLine.transactionType ?? 'Movimiento NetSuite'

  return {
    rowOrigin: 'period_only',
    externalId: `NETSUITE_PERIOD:${registerLine.key}`,
    transactionType: registerLine.transactionType ?? directionLabel,
    transactionDate: registerLine.transactionDateText,
    processingTimestamp: registerLine.transactionDateText,
    counterpartyName: registerLine.entityName ?? '',
    statementCounterpartyName: null,
    counterpartySource: 'statement',
    orderingPartyName: null,
    orderingPartyRfc: null,
    orderingPartyAccount: null,
    amount: registerLine.amount,
    mappingSheetKey: null,
    mappingSheetName: null,
    creditAccount: null,
    paymentConcept: registerLine.lineMemo ?? registerLine.headerMemo,
    trackingKey: null,
    hashId: null,
    netsuiteTransactionDate: registerLine.transactionDateText,
    netsuiteTransactionId: registerLine.transactionId,
    netsuiteDocumentNumber: registerLine.documentNumber,
    netsuiteTransactionType: registerLine.transactionType,
    netsuiteEntityName: registerLine.entityName,
    netsuiteLineMemo: registerLine.lineMemo,
    netsuiteHeaderMemo: registerLine.headerMemo,
    netsuiteMemo: registerLine.lineMemo ?? registerLine.headerMemo,
    movementMatchSource: 'Sin contraparte activa en el archivo',
    netsuiteMatchSource: 'Registro bancario NetSuite',
    matchKind: 'exact',
    matchConfidence: 'low',
    matchConfidenceLabel: 'En periodo',
    dayDifference: 0,
    matchScore: 999999,
    matchRule: 'Movimiento existente en NetSuite dentro del periodo contable vigente',
  }
}

function findMonthlyGapFillRecognitionMatch(
  candidate: ReadyJournalCandidate,
  registerLines: NetSuiteRegisterLine[],
  usedRegisterLines: Set<string>,
  usedTransactionIds: Set<string>,
): RecognitionMatch | null {
  if (candidate.movement.recognitionDirection === 'unknown') {
    return null
  }

  const journalTexts = buildReadyJournalRecognitionTexts(candidate)
  if (journalTexts.length === 0) {
    return null
  }

  const candidates = registerLines
    .map((registerLine) => {
      if (
        usedRegisterLines.has(registerLine.key) ||
        usedTransactionIds.has(registerLine.transactionId) ||
        registerLine.direction !== candidate.movement.recognitionDirection
      ) {
        return null
      }

      if (!amountsMatch(candidate.movement.amount, registerLine.amount)) {
        return null
      }

      if (!isSameCalendarMonth(candidate.movement.processingDate, registerLine.transactionDate)) {
        return null
      }

      const textMatch = getBestTextMatch(journalTexts, buildRegisterRecognitionTexts(registerLine))
      if (!textMatch || !isMonthlyGapFillTextMatchEligible(textMatch)) {
        return null
      }

      const dayDifference = getDayDifference(candidate.movement.processingDate, registerLine.transactionDate)
      return {
        registerLine,
        matchRule: `Importe exacto + misma mensualidad + ${textMatch.label}`,
        score: dayDifference + textMatch.score * 12,
        dayDifference,
        textMatch,
      }
    })
    .filter((item): item is RecognitionMatch => item !== null)
    .sort((left, right) => left.score - right.score || compareRecognitionCandidates(left, right))

  const bestMatch = candidates[0] ?? null
  const secondMatch = candidates[1] ?? null
  if (!bestMatch || !isMonthlyGapFillCandidateReliable(bestMatch, secondMatch)) {
    return null
  }

  return bestMatch
}

function buildReadyJournalRecognitionTexts(candidate: ReadyJournalCandidate): RecognitionText[] {
  return dedupeRecognitionTexts([
    buildRecognitionText('entidad NetSuite', candidate.journal.netsuiteName),
    buildRecognitionText('entidad debito', candidate.journal.debitEntityName),
    buildRecognitionText('entidad credito', candidate.journal.creditEntityName),
    buildRecognitionText('contraparte banco', candidate.movement.counterpartyName),
    buildRecognitionText('descriptor banco', candidate.movement.statementCounterpartyName),
    buildRecognitionText('ordenante', candidate.movement.orderingPartyName),
    buildRecognitionText('memo diario', candidate.journal.memo),
    buildRecognitionText('memo linea', candidate.journal.lineMemo),
    buildRecognitionText('concepto', candidate.movement.paymentConcept),
  ]).filter(isUsefulRecognitionText)
}

function isMonthlyGapFillTextMatchEligible(textMatch: RecognitionTextMatch) {
  if (textMatch.kind === 'exact') {
    return true
  }

  const movementSource = textMatch.movementSource.toLowerCase()
  const registerSource = textMatch.registerSource.toLowerCase()
  const movementEntityLike = movementSource.includes('entidad') || movementSource.includes('ordenante')
  const registerEntityLike = registerSource.includes('entidad') || registerSource.includes('empleado')

  if (textMatch.kind === 'approximate') {
    return movementEntityLike || registerEntityLike
  }

  return movementEntityLike && registerEntityLike
}

function isMonthlyGapFillCandidateReliable(bestMatch: RecognitionMatch, secondMatch: RecognitionMatch | null) {
  const bestScore = bestMatch.score
  const secondScore = secondMatch?.score ?? Number.POSITIVE_INFINITY
  const scoreGap = secondScore - bestScore

  if (bestMatch.textMatch.kind === 'exact') {
    return scoreGap >= 4 || !Number.isFinite(secondScore)
  }

  if (bestMatch.textMatch.kind === 'approximate') {
    return bestMatch.dayDifference <= 10 && (scoreGap >= 8 || !Number.isFinite(secondScore))
  }

  return bestMatch.dayDifference <= 4 && (scoreGap >= 12 || !Number.isFinite(secondScore))
}

function buildMovementRecognitionTexts(movement: ParsedBankMovement): RecognitionText[] {
  return dedupeRecognitionTexts([
    buildRecognitionText('entidad NetSuite', movement.netsuiteName),
    buildRecognitionText('contraparte banco', movement.counterpartyName),
    buildRecognitionText('descriptor banco', movement.statementCounterpartyName),
    buildRecognitionText('concepto', movement.paymentConcept),
  ]).filter(isUsefulRecognitionText)
}

function buildRegisterRecognitionTexts(registerLine: NetSuiteRegisterLine): RecognitionText[] {
  const employeeName = stripEmployeeCodePrefix(registerLine.entityName)
  const items = [
    buildRecognitionText('entidad NetSuite', registerLine.entityName),
    buildRecognitionText('memo de linea', registerLine.lineMemo),
    buildRecognitionText('memo de cabecera', registerLine.headerMemo),
  ]

  if (employeeName && compactText(employeeName) !== registerLine.compactEntityName) {
    items.push(buildRecognitionText('empleado NetSuite', employeeName))
  }

  return dedupeRecognitionTexts(items).filter(isUsefulRecognitionText)
}

function getBestTextMatch(
  movementTexts: RecognitionText[],
  registerTexts: RecognitionText[],
): RecognitionTextMatch | null {
  let best: RecognitionTextMatch | null = null

  movementTexts.forEach((movementText) => {
    registerTexts.forEach((registerText) => {
      if (movementText.value === registerText.value) {
        const candidate: RecognitionTextMatch = {
          score: 0,
          label: `${movementText.source} exacta`,
          movementSource: movementText.source,
          registerSource: registerText.source,
          kind: 'exact',
        }
        if (!best || candidate.score < best.score) {
          best = candidate
        }
        return
      }

      const minLength = Math.min(movementText.value.length, registerText.value.length)
      if (
        minLength >= 8 &&
        (movementText.value.includes(registerText.value) || registerText.value.includes(movementText.value))
      ) {
        const candidate: RecognitionTextMatch = {
          score: 2,
          label: `${movementText.source} aproximada`,
          movementSource: movementText.source,
          registerSource: registerText.source,
          kind: 'approximate',
        }
        if (!best || candidate.score < best.score) {
          best = candidate
        }
      }

      const tokenSimilarity = getTokenSimilarity(movementText.tokens, registerText.tokens)
      const sharedTokenCount = getSharedTokenCount(movementText.tokens, registerText.tokens)
      if (
        sharedTokenCount >= 2 &&
        tokenSimilarity >= 0.72 &&
        movementText.source !== 'concepto' &&
        !registerText.source.includes('memo')
      ) {
        const candidate: RecognitionTextMatch = {
          score: tokenSimilarity >= 0.99 ? 1 : 4,
          label: `${movementText.source} por tokens`,
          movementSource: movementText.source,
          registerSource: registerText.source,
          kind: 'tokens',
        }
        if (!best || candidate.score < best.score) {
          best = candidate
        }
      }
    })
  })

  return best
}

function buildRecognitionText(source: string, value: string | null | undefined): RecognitionText {
  const cleanedValue = cleanText(value)
  return {
    source,
    value: compactText(cleanedValue),
    tokens: buildComparableTokens(cleanedValue),
  }
}

function isUsefulRecognitionText(item: RecognitionText) {
  return item.value.length >= 4 || item.tokens.length >= 2
}

function dedupeRecognitionTexts(items: RecognitionText[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.source}:${item.value}:${item.tokens.join('|')}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function stripEmployeeCodePrefix(value: string | null | undefined) {
  return cleanText(value).replace(/^SHQ\s*\d+\s*/i, '')
}

function compareRegisterLines(left: NetSuiteRegisterLine, right: NetSuiteRegisterLine) {
  return (
    left.transactionDate.getTime() - right.transactionDate.getTime() ||
    left.transactionId.localeCompare(right.transactionId) ||
    left.key.localeCompare(right.key)
  )
}

function compareRecognitionCandidates(left: RecognitionMatch, right: RecognitionMatch) {
  return (
    getRecognitionEvidencePriority(left.textMatch) - getRecognitionEvidencePriority(right.textMatch) ||
    compareRegisterLines(left.registerLine, right.registerLine)
  )
}

function getRecognitionEvidencePriority(textMatch: RecognitionTextMatch) {
  const registerSource = textMatch.registerSource.toLowerCase()
  const movementSource = textMatch.movementSource.toLowerCase()

  if (registerSource.includes('entidad') || registerSource.includes('empleado')) {
    if (textMatch.kind === 'exact') {
      return 0
    }

    return textMatch.kind === 'tokens' ? 1 : 2
  }

  if (movementSource === 'contraparte banco') {
    return textMatch.kind === 'exact' ? 3 : 4
  }

  if (movementSource === 'concepto') {
    return registerSource.includes('linea') ? 5 : 6
  }

  return 7
}

function buildRecognizedRow(movement: ParsedBankMovement, match: RecognitionMatch): BankImportNetSuiteRecognizedRow {
  const confidence = getRecognitionConfidence(match.score)
  return {
    rowOrigin: 'analysis_match',
    externalId: movement.externalId,
    transactionType: movement.transactionType,
    transactionDate: movement.transactionDate,
    processingTimestamp: movement.processingTimestamp,
    counterpartyName: movement.counterpartyName,
    statementCounterpartyName: movement.statementCounterpartyName,
    counterpartySource: movement.counterpartySource,
    orderingPartyName: movement.orderingPartyName,
    orderingPartyRfc: movement.orderingPartyRfc,
    orderingPartyAccount: movement.orderingPartyAccount,
    amount: movement.amount,
    mappingSheetKey: movement.mappingSheetKey ?? movement.transactionRule.mappingSheetKey,
    mappingSheetName: movement.mappingSheetName ?? movement.transactionRule.mappingSheetName,
    creditAccount: movement.mappedAccount,
    paymentConcept: movement.paymentConcept,
    trackingKey: movement.trackingKey,
    hashId: movement.hashId,
    netsuiteTransactionDate: match.registerLine.transactionDateText,
    netsuiteTransactionId: match.registerLine.transactionId,
    netsuiteDocumentNumber: match.registerLine.documentNumber,
    netsuiteTransactionType: match.registerLine.transactionType,
    netsuiteEntityName: match.registerLine.entityName,
    netsuiteLineMemo: match.registerLine.lineMemo,
    netsuiteHeaderMemo: match.registerLine.headerMemo,
    netsuiteMemo: match.registerLine.lineMemo ?? match.registerLine.headerMemo,
    movementMatchSource: match.textMatch.movementSource,
    netsuiteMatchSource: match.textMatch.registerSource,
    matchKind: match.textMatch.kind,
    matchConfidence: confidence.value,
    matchConfidenceLabel: confidence.label,
    dayDifference: match.dayDifference,
    matchScore: match.score,
    matchRule: match.matchRule,
  }
}

function findManualRecognitionMatch(
  bankId: BankImportBankId,
  sourceProfileId: string,
  movement: ParsedBankMovement,
): ManualRecognitionMatch | null {
  const override = findBankRecognitionOverride({
    bankId,
    sourceProfileId,
    transactionType: movement.transactionType,
    transactionDate: movement.transactionDate,
    amount: movement.amount,
    counterpartyName: movement.counterpartyName,
    trackingKey: movement.trackingKey,
    referenceNumber: movement.referenceNumber,
    orderingPartyAccount: movement.orderingPartyAccount,
    originBankName: movement.originBankName,
    destinationBankName: movement.destinationBankName,
  })
  if (!override) {
    return null
  }

  const movementMatchSource = override.trackingKey
    ? 'tracking key confirmado'
    : override.referenceNumber
      ? 'referencia confirmada'
      : 'movimiento confirmado manualmente'
  const netsuiteReference = override.netsuiteDocumentNumber ?? override.netsuiteTransactionId

  return {
    netsuiteTransactionId: override.netsuiteTransactionId,
    netsuiteDocumentNumber: override.netsuiteDocumentNumber,
    netsuiteTransactionDate: override.netsuiteTransactionDate,
    netsuiteTransactionType: override.netsuiteTransactionType,
    netsuiteEntityName: override.netsuiteEntityName,
    netsuiteLineMemo: override.netsuiteLineMemo,
    netsuiteHeaderMemo: override.netsuiteHeaderMemo,
    mappingSheetKey: override.mappingSheetKey,
    mappingSheetName: override.mappingSheetName,
    creditAccount: override.creditAccount,
    matchRule: `Reconocimiento manual backend -> diario ${netsuiteReference}`,
    movementMatchSource,
    netsuiteMatchSource: override.source,
  }
}

function buildManualRecognizedRow(
  movement: ParsedBankMovement,
  match: ManualRecognitionMatch,
): BankImportNetSuiteRecognizedRow {
  return {
    rowOrigin: 'manual_override',
    externalId: movement.externalId,
    transactionType: movement.transactionType,
    transactionDate: movement.transactionDate,
    processingTimestamp: movement.processingTimestamp,
    counterpartyName: movement.counterpartyName,
    statementCounterpartyName: movement.statementCounterpartyName,
    counterpartySource: movement.counterpartySource,
    orderingPartyName: movement.orderingPartyName,
    orderingPartyRfc: movement.orderingPartyRfc,
    orderingPartyAccount: movement.orderingPartyAccount,
    amount: movement.amount,
    mappingSheetKey: match.mappingSheetKey ?? movement.mappingSheetKey ?? movement.transactionRule.mappingSheetKey,
    mappingSheetName: match.mappingSheetName ?? movement.mappingSheetName ?? movement.transactionRule.mappingSheetName,
    creditAccount: match.creditAccount ?? movement.mappedAccount,
    paymentConcept: movement.paymentConcept,
    trackingKey: movement.trackingKey,
    hashId: movement.hashId,
    netsuiteTransactionDate: match.netsuiteTransactionDate,
    netsuiteTransactionId: match.netsuiteTransactionId,
    netsuiteDocumentNumber: match.netsuiteDocumentNumber,
    netsuiteTransactionType: match.netsuiteTransactionType,
    netsuiteEntityName: match.netsuiteEntityName,
    netsuiteLineMemo: match.netsuiteLineMemo,
    netsuiteHeaderMemo: match.netsuiteHeaderMemo,
    netsuiteMemo: match.netsuiteLineMemo ?? match.netsuiteHeaderMemo,
    movementMatchSource: match.movementMatchSource,
    netsuiteMatchSource: match.netsuiteMatchSource,
    matchKind: 'exact',
    matchConfidence: 'high',
    matchConfidenceLabel: 'Confirmado',
    dayDifference: 0,
    matchScore: -100,
    matchRule: match.matchRule,
  }
}

function getRecognitionConfidence(score: number): {
  value: BankImportNetSuiteRecognizedRow['matchConfidence']
  label: BankImportNetSuiteRecognizedRow['matchConfidenceLabel']
} {
  if (score <= 1) {
    return {
      value: 'high',
      label: 'Alta',
    }
  }

  if (score <= 10) {
    return {
      value: 'medium',
      label: 'Media',
    }
  }

  return {
    value: 'low',
    label: 'Baja',
  }
}

function getDayDifference(left: Date, right: Date) {
  const leftDay = startOfDay(left).getTime()
  const rightDay = startOfDay(right).getTime()
  return Math.round(Math.abs(leftDay - rightDay) / 86400000)
}

function isSameCalendarMonth(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth()
}

function amountsMatch(left: number, right: number) {
  return Math.abs(round2(left) - round2(right)) <= 0.01
}

function resolveJournalCounterpartyName(
  journal: Pick<
    BankImportJournalPreview,
    | 'counterpartyName'
    | 'orderingPartyName'
    | 'statementCounterpartyName'
    | 'debitEntityName'
    | 'creditEntityName'
    | 'paymentConcept'
    | 'netsuiteName'
    | 'memo'
    | 'lineMemo'
    | 'externalId'
  >,
) {
  return (
    cleanText(journal.counterpartyName) ||
    cleanText(journal.orderingPartyName) ||
    cleanText(journal.statementCounterpartyName) ||
    cleanText(journal.debitEntityName) ||
    cleanText(journal.creditEntityName) ||
    cleanText(journal.paymentConcept) ||
    cleanText(journal.netsuiteName) ||
    cleanText(journal.memo) ||
    cleanText(journal.lineMemo) ||
    cleanText(journal.externalId) ||
    ''
  )
}

function buildExportRows(journal: BankImportJournalPreview): BankImportExportRow[] {
  const bankCounterpartyName = resolveJournalCounterpartyName(journal)

  return [
    {
      bankTimestamp: journal.processingTimestamp,
      bankCounterpartyName,
      journalDate: formatTemplateDate(journal.transactionDate),
      currency: journal.currency,
      netsuiteName: journal.creditEntityDisplayName ?? journal.creditEntityName ?? journal.netsuiteName,
      memo: journal.memo,
      exchangeRate: journal.exchangeRate,
      account: journal.creditAccount,
      debit: null,
      credit: journal.amount,
      lineMemo: journal.lineMemo,
      externalId: journal.externalId,
      line: 1,
    },
    {
      bankTimestamp: journal.processingTimestamp,
      bankCounterpartyName,
      journalDate: formatTemplateDate(journal.transactionDate),
      currency: journal.currency,
      netsuiteName: journal.debitEntityDisplayName ?? journal.debitEntityName ?? journal.netsuiteName,
      memo: journal.memo,
      exchangeRate: journal.exchangeRate,
      account: journal.debitAccount,
      debit: journal.amount,
      credit: null,
      lineMemo: journal.lineMemo,
      externalId: journal.externalId,
      line: 2,
    },
  ]
}

function validatePostableJournal(journal: BankImportJournalPreview) {
  const externalId = cleanText(journal.externalId)
  const transactionDate = cleanText(journal.transactionDate)
  const counterpartyName = resolveJournalCounterpartyName(journal) || externalId
  const debitAccount = cleanText(journal.debitAccount)
  const creditAccount = cleanText(journal.creditAccount)
  const memo = cleanText(journal.memo) || cleanText(journal.netsuiteName) || counterpartyName
  const lineMemo = cleanText(journal.lineMemo) || cleanText(journal.paymentConcept) || memo

  if (!externalId || !transactionDate || !debitAccount || !creditAccount) {
    throw new BankImportError('Uno de los diarios listos no trae suficiente informacion para subirse a NetSuite.')
  }

  if (!Number.isFinite(journal.amount) || journal.amount <= 0) {
    throw new BankImportError(`El diario ${externalId} no trae un monto valido para NetSuite.`)
  }

  return {
    ...journal,
    externalId,
    transactionDate,
    counterpartyName,
    debitAccount,
    creditAccount,
    memo,
    lineMemo,
  }
}

async function buildBankJournalCreatePayload(
  client: NetSuiteClient,
  journal: BankImportJournalPreview,
  _bank: SupportedBankConfig,
) {
  const debitAccount = await resolveNetSuiteAccountReference(journal.debitAccount)
  const creditAccount = await resolveNetSuiteAccountReference(journal.creditAccount)
  const debitEntity = await resolveJournalLineEntityReference(journal, 'debit')
  const creditEntity = await resolveJournalLineEntityReference(journal, 'credit')
  const sharedEntity = debitEntity ?? creditEntity
  const memo = buildBankJournalMemo(journal)

  const payload: Record<string, unknown> = {
    externalId: journal.externalId,
    tranDate: journal.transactionDate,
    memo,
    approved: true,
    exchangeRate: Number.isFinite(journal.exchangeRate) && journal.exchangeRate > 0 ? journal.exchangeRate : 1,
    line: {
      items: [
        buildBankJournalLine({
          account: debitAccount,
          debit: journal.amount,
          memo: journal.lineMemo,
          entity: debitEntity ?? sharedEntity,
        }),
        buildBankJournalLine({
          account: creditAccount,
          credit: journal.amount,
          memo: journal.lineMemo,
          entity: creditEntity ?? sharedEntity,
        }),
      ],
    },
  }

  if (DEFAULT_JOURNAL_SUBSIDIARY_ID) {
    payload.subsidiary = { id: DEFAULT_JOURNAL_SUBSIDIARY_ID }
  }

  if (DEFAULT_JOURNAL_CURRENCY_ID) {
    payload.currency = { id: DEFAULT_JOURNAL_CURRENCY_ID }
  }

  return payload
}

function buildBankJournalLine({
  account,
  debit,
  credit,
  memo,
  entity,
}: {
  account: NetSuiteReferencePayload
  debit?: number
  credit?: number
  memo: string
  entity: NetSuiteReferencePayload | null
}) {
  const line: Record<string, unknown> = {
    account,
    memo,
  }

  if (debit && debit > 0) {
    line.debit = round2(debit)
  }

  if (credit && credit > 0) {
    line.credit = round2(credit)
  }

  if (entity) {
    line.entity = entity
  }

  if (DEFAULT_JOURNAL_DEPARTMENT_ID) {
    line.department = { id: DEFAULT_JOURNAL_DEPARTMENT_ID }
  }

  if (DEFAULT_JOURNAL_LOCATION_ID) {
    line.location = { id: DEFAULT_JOURNAL_LOCATION_ID }
  }

  return line
}

function buildBankJournalMemo(journal: BankImportJournalPreview) {
  const explicitMemo = cleanText(journal.memo)
  const defaultEntityMemo = cleanText(journal.netsuiteName)
  if (explicitMemo && explicitMemo !== defaultEntityMemo) {
    return explicitMemo
  }

  const counterpartyName = resolveJournalCounterpartyName(journal)
  return (
    cleanText(
      [explicitMemo, journal.paymentConcept, counterpartyName]
        .filter((value, index, items) => Boolean(value) && items.indexOf(value) === index)
        .join(' | '),
    ) || counterpartyName
  )
}

async function resolveJournalLineEntityReference(journal: BankImportJournalPreview, side: 'debit' | 'credit') {
  const explicitName = side === 'debit' ? journal.debitEntityName : journal.creditEntityName
  const explicitSheetKey = side === 'debit' ? journal.debitEntitySheetKey : journal.creditEntitySheetKey
  const explicitInternalId = side === 'debit' ? journal.debitEntityInternalId : journal.creditEntityInternalId
  const explicitDisplayName = side === 'debit' ? journal.debitEntityDisplayName : journal.creditEntityDisplayName

  if (explicitInternalId && explicitName && explicitSheetKey) {
    return {
      id: explicitInternalId,
      refName: explicitDisplayName ?? explicitName,
    }
  }

  if (explicitName && explicitSheetKey) {
    return resolveNetSuiteEntityReference(explicitSheetKey, explicitName)
  }

  if (journal.creditDestinationType === 'clientes') {
    return resolveNetSuiteEntityReference('customers', journal.netsuiteName)
  }

  if (journal.creditDestinationType === 'proveedores') {
    return resolveNetSuiteEntityReference('suppliers', journal.netsuiteName)
  }

  return null
}

async function resolveNetSuiteEntityReference(
  mappingSheetKey: MappingSheetKey,
  netsuiteName: string,
): Promise<NetSuiteReferencePayload> {
  const normalizedTarget = normalizeText(netsuiteName)
  const compactTarget = compactText(stripLeadingEntityCode(netsuiteName))
  const entities = await fetchNetSuiteEntityCandidates(mappingSheetKey)

  const match =
    entities.find((entity) => normalizeText(formatNetSuiteEntityDisplayName(entity)) === normalizedTarget) ??
    entities.find((entity) => normalizeText(entity.altName) === normalizedTarget) ??
    entities.find((entity) => normalizeText(entity.companyName) === normalizedTarget) ??
    entities.find((entity) => normalizeText(entity.entityId) === normalizedTarget) ??
    entities.find((entity) => compactText(formatNetSuiteEntityDisplayName(entity)) === compactTarget) ??
    entities.find((entity) => compactText(entity.altName) === compactTarget) ??
    entities.find((entity) => compactText(entity.companyName) === compactTarget)

  if (!match) {
    throw new Error(`No pude resolver la entidad de NetSuite para ${netsuiteName}.`)
  }

  return {
    id: match.internalId,
    refName: formatNetSuiteEntityDisplayName(match),
  }
}

async function resolveNetSuiteAccountReference(accountDisplayName: string): Promise<NetSuiteReferencePayload> {
  const normalizedTarget = normalizeText(accountDisplayName)
  const accounts = await fetchNetSuiteAccountCatalog()
  const match =
    accounts.find((account) => normalizeText(account.displayName) === normalizedTarget) ??
    accounts.find((account) => compactText(account.displayName) === compactText(accountDisplayName))

  if (!match) {
    throw new Error(`No pude resolver la cuenta de NetSuite ${accountDisplayName}.`)
  }

  return {
    id: match.internalId,
    refName: match.displayName,
  }
}

async function fetchNetSuiteAccountCatalog() {
  return loadOrSyncNetSuiteAccountCatalog()
}

async function findExistingBankJournalByExternalId(client: NetSuiteClient, externalId: string) {
  const query = `
    SELECT
      transaction.id AS id,
      NVL(transaction.tranid, transaction.transactionnumber) AS tranid
    FROM transaction
    WHERE transaction.type = 'Journal'
      AND transaction.externalid = ${formatSuiteQlLiteral(externalId)}
    ORDER BY transaction.id DESC
  `.trim()

  const rows = await fetchAllSuiteQlRows(client, query, 1)
  const item = rows[0]
  if (!item) {
    return null
  }

  return {
    id: getNullableString(item.id),
    tranId: getNullableString(item.tranid),
  }
}

async function findExistingBankJournalByMovementEvidence(
  client: NetSuiteClient,
  journal: ReturnType<typeof validatePostableJournal>,
  bank: SupportedBankConfig,
) {
  if (!bank.netsuiteRegisterAccountId || !/^\d+$/.test(bank.netsuiteRegisterAccountId)) {
    return null
  }

  const cleanedLineMemo = cleanText(journal.lineMemo)
  if (!cleanedLineMemo) {
    return null
  }

  const bankLineAmountColumn = resolveExpectedBankLineAmountColumn(journal, bank)
  const amountPredicate = bankLineAmountColumn
    ? `NVL(tal.${bankLineAmountColumn}, 0) = ${round2(journal.amount).toFixed(2)}`
    : `(
        NVL(tal.debit, 0) = ${round2(journal.amount).toFixed(2)}
        OR NVL(tal.credit, 0) = ${round2(journal.amount).toFixed(2)}
      )`

  const query = `
    SELECT
      transaction.id AS id,
      NVL(transaction.tranid, transaction.transactionnumber) AS tranid,
      transaction.externalid AS externalid,
      BUILTIN.DF(transaction.entity) AS headerentityname,
      BUILTIN.DF(transactionLine.entity) AS lineentityname,
      transaction.memo AS headermemo,
      transactionLine.memo AS linememo
    FROM TransactionAccountingLine tal
    INNER JOIN transaction
      ON transaction.id = tal.transaction
    INNER JOIN transactionLine
      ON transactionLine.transaction = tal.transaction
      AND transactionLine.id = tal.transactionline
    WHERE tal.account = ${formatSuiteQlLiteral(bank.netsuiteRegisterAccountId)}
      AND transaction.type = 'Journal'
      AND transaction.posting = 'T'
      AND transaction.trandate = TO_DATE(${formatSuiteQlLiteral(journal.transactionDate)}, 'YYYY-MM-DD')
      AND ${amountPredicate}
      AND transactionLine.memo = ${formatSuiteQlLiteral(cleanedLineMemo)}
    ORDER BY transaction.id DESC
  `.trim()

  const candidates = (await fetchAllSuiteQlRows(client, query, 10))
    .map(parseExistingBankJournalEvidenceCandidate)
    .filter((item): item is ExistingBankJournalEvidenceCandidate => item !== null)
  if (candidates.length === 0) {
    return null
  }

  const journalTexts = buildExistingBankJournalEvidenceTexts(journal)
  if (journalTexts.length === 0) {
    return null
  }

  const matches = candidates
    .map((candidate) => {
      const textMatch = getBestTextMatch(journalTexts, buildExistingBankJournalEvidenceCandidateTexts(candidate))
      if (!textMatch || !isExistingBankJournalEvidenceTextMatchEligible(textMatch)) {
        return null
      }

      return {
        candidate,
        textMatch,
        priority: getExistingBankJournalEvidencePriority(textMatch),
      } satisfies ExistingBankJournalEvidenceMatch
    })
    .filter((item): item is ExistingBankJournalEvidenceMatch => item !== null)
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        left.textMatch.score - right.textMatch.score ||
        cleanText(right.candidate.id).localeCompare(cleanText(left.candidate.id)),
    )

  const bestMatch = matches[0] ?? null
  const secondMatch = matches[1] ?? null
  if (!bestMatch || !isExistingBankJournalEvidenceCandidateReliable(bestMatch, secondMatch)) {
    return null
  }

  return {
    id: bestMatch.candidate.id,
    tranId: bestMatch.candidate.tranId,
    externalId: bestMatch.candidate.externalId,
  }
}

function parseExistingBankJournalEvidenceCandidate(item: Record<string, unknown>): ExistingBankJournalEvidenceCandidate | null {
  const id = getNullableString(item.id)
  if (!id) {
    return null
  }

  return {
    id,
    tranId: getNullableString(item.tranid),
    externalId: getNullableString(item.externalid),
    headerEntityName: cleanText(item.headerentityname) || null,
    lineEntityName: cleanText(item.lineentityname) || null,
    headerMemo: cleanText(item.headermemo) || null,
    lineMemo: cleanText(item.linememo) || null,
  }
}

function buildExistingBankJournalEvidenceTexts(
  journal: Pick<
    ReturnType<typeof validatePostableJournal>,
    | 'counterpartyName'
    | 'orderingPartyName'
    | 'netsuiteName'
    | 'postingDisplayName'
    | 'debitEntityName'
    | 'creditEntityName'
    | 'memo'
  >,
) {
  return dedupeRecognitionTexts([
    buildRecognitionText('entidad operable', journal.postingDisplayName),
    buildRecognitionText('entidad NetSuite', journal.netsuiteName),
    buildRecognitionText('entidad debito', journal.debitEntityName),
    buildRecognitionText('entidad credito', journal.creditEntityName),
    buildRecognitionText('contraparte banco', journal.counterpartyName),
    buildRecognitionText('ordenante', journal.orderingPartyName),
    buildRecognitionText('memo diario', journal.memo),
  ]).filter(isUsefulRecognitionText)
}

function buildExistingBankJournalEvidenceCandidateTexts(candidate: ExistingBankJournalEvidenceCandidate) {
  return dedupeRecognitionTexts([
    buildRecognitionText('entidad linea', candidate.lineEntityName),
    buildRecognitionText('entidad cabecera', candidate.headerEntityName),
    buildRecognitionText('memo cabecera', candidate.headerMemo),
  ]).filter(isUsefulRecognitionText)
}

function isExistingBankJournalEvidenceTextMatchEligible(textMatch: RecognitionTextMatch) {
  if (textMatch.kind === 'exact') {
    return true
  }

  const registerSource = textMatch.registerSource.toLowerCase()
  return registerSource.includes('entidad') || registerSource.includes('cabecera')
}

function getExistingBankJournalEvidencePriority(textMatch: RecognitionTextMatch) {
  const registerSource = textMatch.registerSource.toLowerCase()
  if (registerSource.includes('entidad')) {
    return textMatch.kind === 'exact' ? 0 : textMatch.kind === 'tokens' ? 1 : 2
  }

  return textMatch.kind === 'exact' ? 3 : textMatch.kind === 'tokens' ? 4 : 5
}

function isExistingBankJournalEvidenceCandidateReliable(
  bestMatch: ExistingBankJournalEvidenceMatch,
  secondMatch: ExistingBankJournalEvidenceMatch | null,
) {
  if (!secondMatch) {
    return true
  }

  return bestMatch.priority < secondMatch.priority || bestMatch.textMatch.score < secondMatch.textMatch.score
}

function resolveExpectedBankLineAmountColumn(
  journal: ReturnType<typeof validatePostableJournal>,
  bank: SupportedBankConfig,
): 'debit' | 'credit' | null {
  const normalizedBankAccount = normalizeText(bank.debitAccount)
  if (normalizeText(journal.debitAccount) === normalizedBankAccount) {
    return 'debit'
  }

  if (normalizeText(journal.creditAccount) === normalizedBankAccount) {
    return 'credit'
  }

  return null
}

async function fetchAllSuiteQlRows(client: NetSuiteClient, query: string, maxPages = 20) {
  const items: Record<string, unknown>[] = []
  const limit = 1000
  let offset = 0

  for (let attempt = 0; attempt < maxPages; attempt += 1) {
    const response = await client.suiteql(query, limit, offset)
    const pageItems = Array.isArray(response.json.items) ? response.json.items : []
    items.push(...pageItems)
    if (pageItems.length < limit) {
      break
    }

    offset += limit
  }

  return items
}

function buildExcludedBuckets(
  summary: BankImportAnalyzeResponse['summary'],
  amounts: ExcludedBucketAmounts,
): BankImportExcludedBucket[] {
  const buckets: BankImportExcludedBucket[] = [
    {
      code: 'before_cutoff',
      label: 'Fuera del periodo contable seleccionado',
      count: summary.excludedBeforeCutoffRows,
      amount: amounts.beforeCutoffAmount > 0 ? round2(amounts.beforeCutoffAmount) : null,
    },
    {
      code: 'status',
      label: 'Estado distinto de Procesado',
      count: summary.excludedStatusRows,
      amount: amounts.statusAmount > 0 ? round2(amounts.statusAmount) : null,
    },
    {
      code: 'recognized_in_netsuite',
      label: 'Ya reconocido en NetSuite',
      count: summary.excludedRecognizedRows,
      amount: summary.recognizedAmount > 0 ? round2(summary.recognizedAmount) : null,
    },
    {
      code: 'type',
      label: 'Tipo fuera del flujo actual (incluye reembolsos bancarios y movimientos especiales)',
      count: summary.excludedTypeRows,
      amount: amounts.typeAmount > 0 ? round2(amounts.typeAmount) : null,
    },
    {
      code: 'invalid_amount',
      label: 'Monto vacio o invalido',
      count: summary.excludedInvalidAmountRows,
    },
    {
      code: 'invalid_date',
      label: 'Fecha invalida',
      count: summary.excludedInvalidDateRows,
    },
  ]

  return buckets.filter((bucket) => bucket.count > 0)
}

function buildExcludedTypeMovementRow(
  movement: Pick<
    ParsedBankMovement,
    | 'transactionDate'
    | 'processingTimestamp'
    | 'transactionType'
    | 'counterpartyName'
    | 'statementCounterpartyName'
    | 'counterpartySource'
    | 'orderingPartyName'
    | 'orderingPartyRfc'
    | 'orderingPartyAccount'
    | 'amount'
    | 'paymentConcept'
    | 'trackingKey'
    | 'referenceNumber'
    | 'originBankName'
    | 'destinationBankName'
    | 'destinationAccount'
    | 'hashId'
  >,
  reason: string,
): BankImportExcludedTypeMovement {
  return {
    transactionDate: movement.transactionDate,
    processingTimestamp: movement.processingTimestamp,
    transactionType: movement.transactionType,
    counterpartyName: movement.counterpartyName,
    statementCounterpartyName: movement.statementCounterpartyName,
    counterpartySource: movement.counterpartySource,
    orderingPartyName: movement.orderingPartyName,
    orderingPartyRfc: movement.orderingPartyRfc,
    orderingPartyAccount: movement.orderingPartyAccount,
    amount: movement.amount,
    paymentConcept: movement.paymentConcept,
    trackingKey: movement.trackingKey,
    referenceNumber: movement.referenceNumber,
    originBankName: movement.originBankName,
    destinationBankName: movement.destinationBankName,
    destinationAccount: movement.destinationAccount,
    hashId: movement.hashId,
    reason,
  }
}

function buildMovementWindow(movements: ParsedBankMovement[]) {
  if (movements.length === 0) {
    return {
      minProcessingDate: null,
      maxProcessingDate: null,
    }
  }

  const sortedDates = movements.map((movement) => movement.transactionDate).filter(Boolean).sort()
  return {
    minProcessingDate: sortedDates[0] ?? null,
    maxProcessingDate: sortedDates[sortedDates.length - 1] ?? null,
  }
}

function summarizeBalanceValidationMovements(
  movements: ParsedBankMovement[],
): BankImportBalanceValidation['movementSummary'] {
  let incomingAmount = 0
  let outgoingAmount = 0
  let unknownDirectionAmount = 0
  let rowsWithKnownDirection = 0
  let rowsWithUnknownDirection = 0

  movements.forEach((movement) => {
    const direction = resolveBalanceValidationDirection(movement)
    if (direction === 'incoming') {
      incomingAmount += movement.amount
      rowsWithKnownDirection += 1
      return
    }

    if (direction === 'outgoing') {
      outgoingAmount += movement.amount
      rowsWithKnownDirection += 1
      return
    }

    unknownDirectionAmount += movement.amount
    rowsWithUnknownDirection += 1
  })

  return {
    incomingAmount: round2(incomingAmount),
    outgoingAmount: round2(outgoingAmount),
    netChange: round2(incomingAmount - outgoingAmount),
    rowsWithKnownDirection,
    rowsWithUnknownDirection,
    unknownDirectionAmount: round2(unknownDirectionAmount),
  }
}

function resolveBalanceValidationDirection(movement: ParsedBankMovement): RecognitionDirection {
  if (movement.transactionRule.normalizedTransactionType === 'REEMBOLSO') {
    return 'outgoing'
  }

  return movement.recognitionDirection
}

function normalizeBalanceValidationMovementSummary(
  value: BankImportSaveValidatedBalanceRequest['movementSummary'],
): BankImportBalanceValidation['movementSummary'] {
  return {
    incomingAmount: round2(parseAmount(value?.incomingAmount) ?? 0),
    outgoingAmount: round2(parseAmount(value?.outgoingAmount) ?? 0),
    netChange: round2(parseAmount(value?.netChange) ?? 0),
    rowsWithKnownDirection: Math.max(0, Math.trunc(Number(value?.rowsWithKnownDirection) || 0)),
    rowsWithUnknownDirection: Math.max(0, Math.trunc(Number(value?.rowsWithUnknownDirection) || 0)),
    unknownDirectionAmount: round2(parseAmount(value?.unknownDirectionAmount) ?? 0),
  }
}

function buildBankBalanceValidation(input: {
  bankId: BankImportBankId
  sourceFileHash: string
  sourceFileName: string
  cutoffDate: string
  movementWindow: {
    minProcessingDate: string | null
    maxProcessingDate: string | null
  }
  movementSummary: BankImportBalanceValidation['movementSummary']
}): BankImportBalanceValidation {
  const sourceFileHash = cleanText(input.sourceFileHash)
  const sourceFileName = cleanText(input.sourceFileName)
  const cutoffDate = cleanText(input.cutoffDate)
  const movementWindow = {
    minProcessingDate: cleanNullableDateOnly(input.movementWindow.minProcessingDate),
    maxProcessingDate: cleanNullableDateOnly(input.movementWindow.maxProcessingDate),
  }
  const movementSummary = normalizeBalanceValidationMovementSummary(input.movementSummary)

  if (input.bankId !== 'payana') {
    return {
      supported: false,
      status: 'unsupported',
      message: 'La validacion manual de saldo solo esta habilitada para Payana - Higo.',
      bankId: input.bankId,
      sourceFileHash,
      sourceFileName,
      cutoffDate,
      movementWindow,
      movementSummary,
      currentValidation: null,
      previousValidation: null,
      expectedClosingBalance: null,
      differenceVsValidatedClosing: null,
    }
  }

  const currentValidationRecord = findBankBalanceValidation({
    bankId: input.bankId,
    sourceFileHash,
    cutoffDate,
  })
  const previousValidationRecord = findLatestBankBalanceValidationBefore({
    bankId: input.bankId,
    beforeProcessingDate: movementWindow.minProcessingDate,
  })
  const currentValidation = currentValidationRecord
    ? {
        validatedClosingBalance: currentValidationRecord.validatedClosingBalance,
        validatedAtUtc: currentValidationRecord.validatedAtUtc,
      }
    : null
  const previousValidation = previousValidationRecord
    ? {
        sourceFileName: previousValidationRecord.sourceFileName,
        cutoffDate: previousValidationRecord.cutoffDate,
        movementMaxProcessingDate: previousValidationRecord.movementMaxProcessingDate,
        validatedClosingBalance: previousValidationRecord.validatedClosingBalance,
        validatedAtUtc: previousValidationRecord.validatedAtUtc,
      }
    : null
  const expectedClosingBalance = previousValidation
    ? round2(previousValidation.validatedClosingBalance + movementSummary.netChange)
    : null
  const differenceVsValidatedClosing =
    currentValidation && expectedClosingBalance !== null
      ? round2(currentValidation.validatedClosingBalance - expectedClosingBalance)
      : null
  const status = resolveBalanceValidationStatus({
    movementSummary,
    currentValidation,
    previousValidation,
    differenceVsValidatedClosing,
  })

  return {
    supported: true,
    status,
    message: describeBalanceValidationStatus({
      status,
      movementSummary,
      currentValidation,
      previousValidation,
      expectedClosingBalance,
      differenceVsValidatedClosing,
    }),
    bankId: input.bankId,
    sourceFileHash,
    sourceFileName,
    cutoffDate,
    movementWindow,
    movementSummary,
    currentValidation,
    previousValidation,
    expectedClosingBalance,
    differenceVsValidatedClosing,
  }
}

function resolveBalanceValidationStatus(input: {
  movementSummary: BankImportBalanceValidation['movementSummary']
  currentValidation: BankImportBalanceValidation['currentValidation']
  previousValidation: BankImportBalanceValidation['previousValidation']
  differenceVsValidatedClosing: number | null
}): BankImportBalanceValidation['status'] {
  if (input.movementSummary.rowsWithUnknownDirection > 0 || input.movementSummary.unknownDirectionAmount > 0) {
    return 'partial'
  }

  if (!input.previousValidation) {
    return 'no_previous_anchor'
  }

  if (!input.currentValidation) {
    return 'awaiting_validation'
  }

  return Math.abs(input.differenceVsValidatedClosing ?? 0) <= 0.01 ? 'ok' : 'mismatch'
}

function describeBalanceValidationStatus(input: {
  status: BankImportBalanceValidation['status']
  movementSummary: BankImportBalanceValidation['movementSummary']
  currentValidation: BankImportBalanceValidation['currentValidation']
  previousValidation: BankImportBalanceValidation['previousValidation']
  expectedClosingBalance: number | null
  differenceVsValidatedClosing: number | null
}) {
  if (input.status === 'partial') {
    return `Hay ${input.movementSummary.rowsWithUnknownDirection} movimientos especiales por ${formatMoney(
      input.movementSummary.unknownDirectionAmount,
    )} sin direccion de saldo confiable. Valida el cierre manualmente para tomarlo como ancla.`
  }

  if (input.status === 'no_previous_anchor') {
    return input.currentValidation
      ? 'Saldo final validado guardado. Esta carga ya queda como ancla contable para la siguiente.'
      : 'Todavia no existe un cierre previo validado. Captura el saldo final confirmado en NetSuite para usarlo como ancla de la siguiente carga.'
  }

  if (input.status === 'awaiting_validation') {
    return `Con el cierre previo validado, el saldo esperado para esta carga es ${formatMoney(
      input.expectedClosingBalance ?? 0,
    )}. Captura el saldo final confirmado en NetSuite para cerrar la continuidad.`
  }

  if (input.status === 'ok') {
    return `El saldo final validado cuadra contra el cierre previo mas la variacion neta de esta carga (${formatMoney(
      input.movementSummary.netChange,
    )}).`
  }

  if (input.status === 'mismatch') {
    return `El saldo final validado no cuadra contra el cierre previo mas la variacion neta de esta carga. Diferencia detectada: ${formatMoney(
      Math.abs(input.differenceVsValidatedClosing ?? 0),
    )}.`
  }

  return 'La validacion manual de saldo no esta habilitada para este banco.'
}

function buildCreditDestinationSummary(
  creditDestinations: Map<
    BankImportCreditDestinationType,
    {
      label: string
      count: number
      amount: number
    }
  >,
): BankImportCreditDestinationSummary[] {
  return Array.from(creditDestinations.entries())
    .map(([type, value]) => ({
      type,
      label: value.label,
      count: value.count,
      amount: round2(value.amount),
    }))
    .sort((left, right) => right.count - left.count || right.amount - left.amount || left.label.localeCompare(right.label))
}

function buildCreditDestinationSummaryFromJournals(journals: BankImportJournalPreview[]) {
  const creditDestinations = new Map<
    BankImportCreditDestinationType,
    {
      label: string
      count: number
      amount: number
    }
  >()

  journals.forEach((journal) => {
    accumulateCreditDestination(
      creditDestinations,
      {
        type: journal.creditDestinationType,
        label: journal.creditDestinationLabel,
      },
      journal.amount,
    )
  })

  return buildCreditDestinationSummary(creditDestinations)
}

function summarizePendingTransactionTypes(
  rows: ParsedBankMovement[],
  recognizedRowIndexes: Set<number>,
): BankImportTransactionTypeSummary[] {
  const transactionTypes = new Map<
    string,
    {
      label: string
      count: number
      amount: number
      mappingSheetName: string | null
      journalMode: BankImportTransactionRule['journalMode']
      includedInCurrentFlow: boolean
      includedInPendingSummary: boolean
    }
  >()

  rows.forEach((row) => {
    if (recognizedRowIndexes.has(row.rowIndex)) {
      return
    }
    if (!row.transactionRule.includedInPendingSummary) {
      return
    }
    accumulateTransactionType(
      transactionTypes,
      row.transactionRule.normalizedTransactionType || 'SIN TIPO',
      row.transactionType,
      row.amount,
      row.mappingSheetName ?? row.transactionRule.mappingSheetName,
      row.transactionRule.journalMode,
      row.transactionRule.includedInCurrentFlow,
      row.transactionRule.includedInPendingSummary,
    )
  })

  return Array.from(transactionTypes.entries())
    .map(([, value]) => ({
      transactionType: value.label,
      count: value.count,
      amount: round2(value.amount),
      mappingSheetName: value.mappingSheetName,
      journalMode: value.journalMode,
      includedInCurrentFlow: value.includedInCurrentFlow,
      includedInPendingSummary: value.includedInPendingSummary,
    }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        right.amount - left.amount ||
        left.transactionType.localeCompare(right.transactionType),
    )
}

function readWorksheetRecords(sheet: XLSX.WorkSheet) {
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
  })
}

function describeCreditDestination(creditAccount: string) {
  const normalizedAccount = normalizeText(creditAccount)

  if (normalizedAccount.includes('CLIENTE')) {
    return {
      type: 'clientes' as BankImportCreditDestinationType,
      label: 'Clientes',
    }
  }

  if (normalizedAccount.includes('PROVEEDOR')) {
    return {
      type: 'proveedores' as BankImportCreditDestinationType,
      label: 'Proveedores',
    }
  }

  if (normalizedAccount.includes('BANCO')) {
    return {
      type: 'bancos' as BankImportCreditDestinationType,
      label: 'Bancos',
    }
  }

  if (
    normalizedAccount.includes('DEVOLUC') ||
    normalizedAccount.includes('DESCUENT') ||
    normalizedAccount.includes('BONIFIC')
  ) {
    return {
      type: 'ajustes' as BankImportCreditDestinationType,
      label: 'Devoluciones / descuentos',
    }
  }

  return {
    type: 'otras' as BankImportCreditDestinationType,
    label: extractAccountCategory(creditAccount) || 'Otra cuenta',
  }
}

function resolveJournalAccounts(
  movement: ParsedBankMovement,
  bank: SupportedBankConfig,
): JournalAccountResolution {
  const specialRule = resolveSpecialJournalRule(movement, bank)
  if (specialRule) {
    return specialRule
  }

  const mappedAccountDestination = describeCreditDestination(movement.mappedAccount ?? '')
  const defaultEntitySheetKey = movement.mappingSheetKey ?? movement.transactionRule.mappingSheetKey
  const defaultEntityName = movement.netsuiteName
  const debitAccount =
    movement.transactionRule.mappedAccountSide === 'debit' ? movement.mappedAccount ?? bank.debitAccount : bank.debitAccount
  const creditAccount =
    movement.transactionRule.mappedAccountSide === 'credit' ? movement.mappedAccount ?? bank.debitAccount : bank.debitAccount

  return {
    mappedAccount: movement.mappedAccount ?? '',
    debitAccount,
    creditAccount,
    debitEntityName: defaultEntityName,
    debitEntitySheetKey: defaultEntitySheetKey,
    debitEntityInternalId: movement.entityInternalId ?? null,
    debitEntityDisplayName: movement.postingDisplayName ?? movement.netsuiteName ?? null,
    creditEntityName: defaultEntityName,
    creditEntitySheetKey: defaultEntitySheetKey,
    creditEntityInternalId: movement.entityInternalId ?? null,
    creditEntityDisplayName: movement.postingDisplayName ?? movement.netsuiteName ?? null,
    creditDestinationType: mappedAccountDestination.type,
    creditDestinationLabel: mappedAccountDestination.label,
  }
}

function resolveSpecialJournalRule(
  movement: ParsedBankMovement,
  bank: SupportedBankConfig,
): JournalAccountResolution | null {
  if (isBbvaDelayCompensationMovement(bank.id, 'bbva_pdf', movement)) {
    return {
      mappedAccount: BBVA_DELAY_COMPENSATION_INCOME_ACCOUNT,
      debitAccount: bank.debitAccount,
      creditAccount: BBVA_DELAY_COMPENSATION_INCOME_ACCOUNT,
      debitEntityName: BBVA_DELAY_COMPENSATION_VENDOR_NAME,
      debitEntitySheetKey: 'suppliers',
      creditEntityName: BBVA_DELAY_COMPENSATION_VENDOR_NAME,
      creditEntitySheetKey: 'suppliers',
      creditDestinationType: 'otras',
      creditDestinationLabel: 'Productos financieros',
    }
  }

  const normalizedCounterparty = movement.compactCounterpartyName
  const normalizedNetSuiteName = compactText(movement.netsuiteName)

  if (normalizedCounterparty === 'CFTECH' || normalizedNetSuiteName === 'CFTECH') {
    return {
      mappedAccount: CLARA_CORRIENTE_BANK_ACCOUNT,
      debitAccount: CLARA_CORRIENTE_BANK_ACCOUNT,
      creditAccount: bank.debitAccount,
      debitEntityName: CF_TECH_VENDOR_NAME,
      debitEntitySheetKey: 'suppliers',
      creditEntityName: HIGO_VENDOR_NAME,
      creditEntitySheetKey: 'suppliers',
      creditDestinationType: 'bancos',
      creditDestinationLabel: 'Bancos',
    }
  }

  return null
}

function extractAccountCategory(creditAccount: string) {
  const withoutCode = cleanText(creditAccount).replace(/^[0-9-]+\s+/, '')
  const firstSegment = withoutCode.split(':')[0] ?? ''
  return cleanText(firstSegment)
}

function accumulateCreditDestination(
  creditDestinations: Map<
    BankImportCreditDestinationType,
    {
      label: string
      count: number
      amount: number
    }
  >,
  creditDestination: {
    type: BankImportCreditDestinationType
    label: string
  },
  amount: number,
) {
  const current = creditDestinations.get(creditDestination.type)
  if (current) {
    current.count += 1
    current.amount += amount
    return
  }

  creditDestinations.set(creditDestination.type, {
    label: creditDestination.label,
    count: 1,
    amount,
  })
}

function accumulateTransactionType(
  transactionTypes: Map<
    string,
    {
      label: string
      count: number
      amount: number
      mappingSheetName: string | null
      journalMode: BankImportTransactionRule['journalMode']
      includedInCurrentFlow: boolean
      includedInPendingSummary: boolean
    }
  >,
  transactionTypeKey: string,
  transactionTypeLabel: string,
  amount: number,
  mappingSheetName: string | null,
  journalMode: BankImportTransactionRule['journalMode'],
  includedInCurrentFlow: boolean,
  includedInPendingSummary: boolean,
) {
  const current = transactionTypes.get(transactionTypeKey)
  if (current) {
    current.count += 1
    current.amount += amount
    current.includedInCurrentFlow = current.includedInCurrentFlow || includedInCurrentFlow
    current.includedInPendingSummary = current.includedInPendingSummary || includedInPendingSummary
    return
  }

  transactionTypes.set(transactionTypeKey, {
    label: transactionTypeLabel,
    count: 1,
    amount,
    mappingSheetName,
    journalMode,
    includedInCurrentFlow,
    includedInPendingSummary,
  })
}

function normalizeRecordKeys(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [normalizeHeader(key), value]),
  ) as Record<string, unknown>
}

function normalizeHeader(value: string) {
  return normalizeText(value)
}

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeText(value: unknown) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
}

function compactText(value: unknown) {
  return normalizeText(value).replace(/[^A-Z0-9]/g, '')
}

function cleanDigits(value: unknown) {
  return cleanText(value).replace(/\D+/g, '')
}

function parseBase64File(value: unknown) {
  const base64 = cleanText(value)
  if (!base64) {
    throw new BankImportError('Debes adjuntar un archivo de banco para analizar.')
  }

  try {
    return Buffer.from(base64, 'base64')
  } catch {
    throw new BankImportError('No pude leer el archivo bancario enviado.')
  }
}

function resolveBankImportAnalysisMode(value: unknown): BankImportAnalysisMode {
  if (value === 'banxico') {
    return 'banxico'
  }

  if (value === 'cot_ov') {
    return 'cot_ov'
  }

  return 'standard'
}

function isPdfBankSourceFile(sourceFileName: string, fileBuffer: Buffer) {
  return sourceFileName.toLowerCase().endsWith('.pdf') || fileBuffer.subarray(0, 4).toString('utf8') === '%PDF'
}

function parseDateOnly(value: unknown) {
  const raw = cleanText(value)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, month, day)
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    return null
  }

  return date
}

function parseCutoffDate(value: unknown) {
  const raw = cleanText(value) || DEFAULT_CUTOFF_DATE
  const parsed = parseDateOnly(raw)
  if (!parsed) {
    throw new BankImportError('La fecha de corte debe venir en formato YYYY-MM-DD.')
  }

  return parsed
}

function formatAccountingPeriod(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
}

function parseAccountingPeriod(value: unknown) {
  const raw = cleanText(value)
  const directMatch = /^(\d{4})-(\d{2})$/.exec(raw)
  if (directMatch) {
    const year = Number(directMatch[1])
    const month = Number(directMatch[2]) - 1
    const date = new Date(year, month, 1)
    if (!Number.isNaN(date.getTime()) && date.getFullYear() === year && date.getMonth() === month) {
      return date
    }
  }

  const dateOnly = parseDateOnly(raw)
  if (!dateOnly) {
    return null
  }

  return startOfMonth(dateOnly)
}

function resolveRequestedAccountingPeriod(input: {
  accountingPeriod?: unknown
  cutoffDate?: unknown
}) {
  const parsed =
    parseAccountingPeriod(input.accountingPeriod) ||
    parseAccountingPeriod(input.cutoffDate) ||
    parseAccountingPeriod(DEFAULT_ACCOUNTING_PERIOD) ||
    startOfMonth(parseCutoffDate(DEFAULT_CUTOFF_DATE))

  return resolveAccountingPeriodWindow(parsed)
}

function sanitizeTransientCorrections(value: unknown): BankImportTransientCorrection[] {
  if (!Array.isArray(value)) {
    return []
  }

  const sanitized: BankImportTransientCorrection[] = []

  value.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return
    }

    const candidate = item as Partial<BankImportTransientCorrection>
    const correctionKey = cleanText(candidate.correctionKey)
    const counterpartyName = cleanText(candidate.counterpartyName)
    const mappingSheetKey =
      candidate.mappingSheetKey === 'customers' || candidate.mappingSheetKey === 'suppliers'
        ? candidate.mappingSheetKey
        : null
    const bankName = cleanText(candidate.bankName)
    const netsuiteName = cleanText(candidate.netsuiteName)
    const creditAccount = cleanText(candidate.creditAccount)
    const entityInternalId = getNullableString(candidate.entityInternalId)
    const postingDisplayName = getNullableString(candidate.postingDisplayName)

    if (!correctionKey || !counterpartyName || !mappingSheetKey || !bankName || !netsuiteName || !creditAccount) {
      return
    }

    sanitized.push({
      correctionKey,
      counterpartyName,
      mappingSheetKey,
      bankName,
      netsuiteName,
      creditAccount,
      entityInternalId,
      postingDisplayName,
    })
  })

  return sanitized
}

function buildBankAnalysisRequestHash(
  request: Pick<
    ResolvedBankImportAnalysisStartRequest,
    'bankId' | 'accountingPeriod' | 'cutoffDate' | 'fileName' | 'fileBase64' | 'transientCorrections'
  >,
  analysisMode: BankImportAnalysisMode,
) {
  const fileBuffer = parseBase64File(request.fileBase64)
  const accountingPeriodWindow = resolveRequestedAccountingPeriod(request)
  const transientCorrections = sanitizeTransientCorrections(request.transientCorrections).map((item) => ({
    correctionKey: item.correctionKey,
    counterpartyName: item.counterpartyName,
    mappingSheetKey: item.mappingSheetKey,
    bankName: item.bankName,
    netsuiteName: item.netsuiteName,
    creditAccount: item.creditAccount,
    entityInternalId: item.entityInternalId ?? null,
    postingDisplayName: item.postingDisplayName ?? null,
  }))

  return createHash('sha1')
    .update(fileBuffer)
    .update(
      JSON.stringify({
        analysisRequestVersion: BANK_ANALYSIS_REQUEST_VERSION,
        bankId: request.bankId,
        accountingPeriod: accountingPeriodWindow.token,
        fileName: cleanText(request.fileName),
        analysisMode,
        transientCorrections,
      }),
    )
    .digest('hex')
}

function resolveBankImportAnalysisStartRequest(
  request: BankImportAnalysisStartRequest,
): ResolvedBankImportAnalysisStartRequest {
  const fileName = cleanText(request.fileName)
  const fileBase64 = cleanText(request.fileBase64)

  if (fileName && fileBase64) {
    persistWorkingBankFileFromRequest({
      bankId: request.bankId,
      fileName,
      fileBase64,
    })

    return {
      ...request,
      fileName,
      fileBase64,
    }
  }

  const storedWorkingFile = getBankWorkingFile(request.bankId)
  if (!storedWorkingFile) {
    const bank = resolveBank(request.bankId)
    throw new BankImportError(
      `No hay un archivo bancario resguardado para ${bank.label}. Sube y analiza un archivo primero.`,
      404,
    )
  }

  return {
    ...request,
    fileName: storedWorkingFile.fileName,
    fileBase64: storedWorkingFile.fileBase64,
  }
}

function persistWorkingBankFileFromRequest(
  request: Pick<BankImportAnalyzeRequest, 'bankId' | 'fileName' | 'fileBase64'>,
) {
  const fileName = cleanText(request.fileName)
  const fileBase64 = cleanText(request.fileBase64)
  if (!fileName || !fileBase64) {
    return
  }

  upsertBankWorkingFile({
    bankId: request.bankId,
    fileName,
    fileBase64,
  })
}

function normalizeRfc(value: unknown) {
  return compactText(value)
}

function normalizeClaraSourceStatus(value: unknown) {
  const normalized = normalizeText(value)
  if (normalized === 'CONFIRMED' || normalized === 'COMPLETED') {
    return 'Procesado'
  }

  return cleanText(value)
}

function repairShiftedClaraDelimitedRow(row: Record<string, unknown>, tailFields: readonly string[]) {
  if (tailFields.length < 2) {
    return row
  }

  const statusField = tailFields[tailFields.length - 1]
  const expectedStatusIndex = tailFields.length - 1
  const overflowFields = Object.keys(row)
    .filter((key) => /^__EMPTY(?:_\d+)?$/u.test(key))
    .sort(compareClaraOverflowFieldNames)
  const tailValues = [...tailFields, ...overflowFields].map((field) => cleanText(row[field]))
  const statusIndex = tailValues.findIndex((value, index) => index >= expectedStatusIndex && isClaraDelimitedStatusToken(value))

  if (statusIndex <= expectedStatusIndex) {
    return row
  }

  const conceptPartCount = statusIndex - expectedStatusIndex + 1
  const nextRow = { ...row }
  nextRow[tailFields[0]] = tailValues
    .slice(0, conceptPartCount)
    .map(cleanClaraDelimitedConceptPart)
    .filter(Boolean)
    .join(', ')

  tailFields.slice(1).forEach((field, index) => {
    nextRow[field] = tailValues[conceptPartCount + index] ?? ''
  })

  nextRow[statusField] = tailValues[statusIndex]
  return nextRow
}

function compareClaraOverflowFieldNames(left: string, right: string) {
  return getClaraOverflowFieldIndex(left) - getClaraOverflowFieldIndex(right)
}

function getClaraOverflowFieldIndex(value: string) {
  const match = value.match(/^__EMPTY(?:_(\d+))?$/u)
  return match?.[1] ? Number(match[1]) : 0
}

function cleanClaraDelimitedConceptPart(value: string) {
  return cleanText(value).replace(/^"+|"+$/gu, '')
}

function isClaraDelimitedStatusToken(value: string) {
  return [
    'CANCELED',
    'CANCELLED',
    'COMPLETED',
    'CONFIRMED',
    'FAILED',
    'PENDING',
    'PROCESSING',
    'REFUNDED',
    'REJECTED',
  ].includes(normalizeText(value))
}

function buildClaraAccountActivityStatementDescriptor(row: Record<string, unknown>) {
  const transactionType = normalizeText(row.TIPO)
  const reference = cleanText(row['REFERENCIA NUMERICA'])
  const originBank = cleanText(row['BANCO ORIGEN'])
  const originAccount = cleanText(row['CUENTA ORIGEN'])
  const concept = cleanText(row.CONCEPTO)
  const trackingKey = cleanText(row['CLAVE DE RASTREO'])
  if (transactionType !== 'DEPOSIT') {
    return concept || reference || trackingKey || originAccount || originBank
  }

  if (isMeaningfulClaraCounterpartyName(concept, trackingKey, reference)) {
    return concept
  }

  const parts = [
    reference ? `Deposit ref ${reference}` : 'Deposit',
    originBank || null,
    originAccount ? `cta ${originAccount}` : null,
    concept && compactText(concept) !== compactText(trackingKey) ? concept : null,
  ]

  return parts.filter((part): part is string => Boolean(part)).join(' | ')
}

function resolveClaraAccountActivityCounterpartyName(
  row: Record<string, unknown>,
  statementCounterpartyName: string | null,
) {
  if (normalizeText(row.TIPO) !== 'DEPOSIT') {
    return statementCounterpartyName ?? ''
  }

  const concept = cleanText(row.CONCEPTO)
  const trackingKey = cleanText(row['CLAVE DE RASTREO'])
  const reference = cleanText(row['REFERENCIA NUMERICA'])
  return isMeaningfulClaraCounterpartyName(concept, trackingKey, reference) ? concept : ''
}

async function enrichParsedRowsForAnalysis({
  bank,
  sourceProfileId,
  accountingPeriodWindow,
  analysisMode,
  parsedRows,
}: {
  bank: SupportedBankConfig
  sourceProfileId: string
  accountingPeriodWindow: AccountingPeriodWindow
  analysisMode: BankImportAnalysisMode
  parsedRows: BankImportParsedSourceRow[]
}) {
  if (!shouldRunClaraBanxicoAnalysis(bank.id, sourceProfileId, analysisMode)) {
    return parsedRows
  }

  const enrichedRows = [...parsedRows]
  const targetIndexes = parsedRows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => shouldEnrichClaraDepositRow(row, accountingPeriodWindow))

  await mapWithConcurrency(targetIndexes, 1, async ({ row, index }) => {
    const resolution = await resolveClaraDepositCounterpartyFromBanxico(row)
    if (!resolution) {
      return
    }

    enrichedRows[index] = {
      ...row,
      counterpartyName: resolution.counterpartyName,
      counterpartySource: 'banxico_ordering_party',
      statementCounterpartyName: row.statementCounterpartyName ?? row.counterpartyName,
      orderingPartyName: resolution.counterpartyName,
      orderingPartyRfc: resolution.rfc ?? row.orderingPartyRfc ?? row.rfc ?? null,
      orderingPartyAccount: resolution.orderingPartyAccount ?? row.orderingPartyAccount ?? null,
      rfc: resolution.rfc ?? row.rfc,
      trackingKey: resolution.trackingKey ?? row.trackingKey,
    }
  })

  return enrichedRows
}

async function enrichBbvaRowsFromBanxico(
  parsedRows: BankImportParsedSourceRow[],
  accountingPeriodWindow: AccountingPeriodWindow,
) {
  const enrichedRows = [...parsedRows]
  const targetIndexes = parsedRows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => shouldEnrichBbvaSpeiRow(row, accountingPeriodWindow))

  await mapWithConcurrency(targetIndexes, 1, async ({ row, index }) => {
    const resolution = await resolveBbvaSpeiCounterpartyFromBanxico(row)
    if (!resolution) {
      return
    }

    enrichedRows[index] = {
      ...row,
      counterpartyName: resolution.counterpartyName,
      counterpartySource: 'banxico_ordering_party',
      statementCounterpartyName: row.statementCounterpartyName ?? row.counterpartyName,
      orderingPartyName: resolution.counterpartyName,
      orderingPartyRfc: resolution.rfc ?? row.orderingPartyRfc ?? row.rfc ?? null,
      orderingPartyAccount: resolution.orderingPartyAccount ?? row.orderingPartyAccount ?? null,
      rfc: resolution.rfc ?? row.rfc,
      trackingKey: resolution.trackingKey ?? row.trackingKey,
      referenceNumber: resolution.referenceNumber,
      originBankName: resolution.originBankName ?? row.originBankName ?? null,
      destinationBankName: resolution.destinationBankName ?? row.destinationBankName ?? null,
      destinationAccount: resolution.destinationAccount ?? row.destinationAccount ?? null,
    }
  })

  return enrichedRows
}

function shouldEnrichBbvaSpeiRow(row: BankImportParsedSourceRow, accountingPeriodWindow: AccountingPeriodWindow) {
  if (!row.processingDate || !isDateWithinAccountingPeriod(row.processingDate, accountingPeriodWindow)) {
    return false
  }

  if (normalizeText(row.transactionType) !== 'COBRO') {
    return false
  }

  if (normalizeText(row.status) !== 'PROCESADO') {
    return false
  }

  if (!Number.isFinite(row.amount) || (row.amount ?? 0) <= 0) {
    return false
  }

  if ((row.counterpartySource ?? 'statement') === 'banxico_ordering_party') {
    return false
  }

  const paymentConcept = cleanText(row.paymentConcept)
  if (!normalizeText(paymentConcept).startsWith('SPEI')) {
    return false
  }

  if (!extractBbvaSpeiBanxicoReferenceNumber(paymentConcept)) {
    return false
  }

  if (!extractBbvaSpeiOriginBankName(paymentConcept)) {
    return false
  }

  return cleanDigits(resolveBbvaBanxicoBeneficiaryAccount(row)).length >= 10
}

async function resolveBbvaSpeiCounterpartyFromBanxico(
  row: BankImportParsedSourceRow,
): Promise<BbvaSpeiBanxicoResolution | null> {
  const cacheKey = buildBbvaSpeiBanxicoCacheKey(row)
  if (!cacheKey) {
    return null
  }

  let cachedResolution = bbvaSpeiBanxicoResolutionCache.get(cacheKey)
  if (!cachedResolution) {
    cachedResolution = fetchBbvaSpeiCounterpartyFromBanxico(row)
      .then((result) => {
        if (!result) {
          bbvaSpeiBanxicoResolutionCache.delete(cacheKey)
        }

        return result
      })
      .catch((error) => {
        bbvaSpeiBanxicoResolutionCache.delete(cacheKey)
        throw error
      })
    bbvaSpeiBanxicoResolutionCache.set(cacheKey, cachedResolution)
  }

  return cachedResolution
}

async function fetchBbvaSpeiCounterpartyFromBanxico(
  row: BankImportParsedSourceRow,
): Promise<BbvaSpeiBanxicoResolution | null> {
  if (!row.processingDate || !Number.isFinite(row.amount) || (row.amount ?? 0) <= 0) {
    return null
  }

  const paymentConcept = cleanText(row.paymentConcept)
  const referenceNumber = extractBbvaSpeiBanxicoReferenceNumber(paymentConcept)
  const originBankName = extractBbvaSpeiOriginBankName(paymentConcept)
  const beneficiaryAccount = cleanDigits(resolveBbvaBanxicoBeneficiaryAccount(row))
  if (!referenceNumber || !originBankName || !beneficiaryAccount) {
    return null
  }

  const operationDate = formatDateOnly(row.processingDate)
  const destinationBankName = BBVA_BANXICO_DESTINATION_BANK_NAME
  const catalog = await getBanxicoInstitutionCatalogCached(operationDate)
  const issuerId = resolveBanxicoInstitutionId(catalog, originBankName)
  const receiverId = resolveBanxicoInstitutionId(catalog, destinationBankName)
  if (!issuerId || !receiverId) {
    return null
  }

  const amount = round2(row.amount ?? 0).toFixed(2)
  const storedRecognition = findBanxicoCepRecognition({
    bankId: 'bbva',
    sourceProfileId: 'bbva_pdf',
    operationDate,
    issuerId,
    receiverId,
    beneficiaryAccount,
    amount,
    referenceNumber,
  })
  if (storedRecognition) {
    const orderingResolution = resolveBbvaSpeiOrderingParty({
      orderingPartyName: storedRecognition.orderingPartyName,
      orderingPartyRfc: storedRecognition.orderingPartyRfc,
      beneficiaryName: storedRecognition.beneficiaryName,
      referenceNumber,
    })
    if (orderingResolution) {
      return {
        counterpartyName: orderingResolution.counterpartyName,
        rfc: cleanText(storedRecognition.orderingPartyRfc) || null,
        trackingKey: cleanText(storedRecognition.trackingKey) || null,
        orderingPartyAccount: cleanText(storedRecognition.orderingPartyAccount) || null,
        originBankName: cleanText(storedRecognition.orderingPartyBankName) || originBankName,
        destinationBankName,
        destinationAccount: beneficiaryAccount,
        referenceNumber,
      }
    }
  }

  try {
    const details = await lookupBanxicoDetailsWithRetry({
      operationDate,
      issuerId,
      receiverId,
      beneficiaryAccount,
      amount,
      attempts: [
        {
          searchType: 'referenceNumber',
          criteria: referenceNumber,
        },
      ],
    })
    if (!details) {
      return null
    }

    upsertBanxicoCepRecognition({
      bankId: 'bbva',
      sourceProfileId: 'bbva_pdf',
      operationDate,
      issuerId,
      receiverId,
      beneficiaryAccount,
      amount,
      referenceNumber,
      details,
      source: 'bbva_banxico_analysis',
    })

    const orderingResolution = resolveBbvaSpeiOrderingParty({
      orderingPartyName: details.orderingParty?.name ?? null,
      orderingPartyRfc: details.orderingParty?.rfc ?? null,
      beneficiaryName: details.beneficiary?.name ?? null,
      referenceNumber,
    })
    if (!orderingResolution) {
      return null
    }

    return {
      counterpartyName: orderingResolution.counterpartyName,
      rfc: cleanText(details.orderingParty?.rfc) || null,
      trackingKey: cleanText(details.trackingKey) || null,
      orderingPartyAccount: cleanText(details.orderingParty?.account) || null,
      originBankName: cleanText(details.orderingParty?.bankName) || originBankName,
      destinationBankName,
      destinationAccount: beneficiaryAccount,
      referenceNumber,
    }
  } catch {
    return null
  }
}

function buildBbvaSpeiBanxicoCacheKey(row: BankImportParsedSourceRow) {
  if (!row.processingDate || !Number.isFinite(row.amount) || (row.amount ?? 0) <= 0) {
    return null
  }

  const paymentConcept = cleanText(row.paymentConcept)
  const referenceNumber = extractBbvaSpeiBanxicoReferenceNumber(paymentConcept)
  if (!referenceNumber) {
    return null
  }

  return [
    'bbva',
    formatDateOnly(row.processingDate),
    round2(row.amount ?? 0).toFixed(2),
    referenceNumber,
  ].join('|')
}

function resolveBbvaBanxicoBeneficiaryAccount(row: Pick<BankImportParsedSourceRow, 'destinationAccount'>) {
  const destinationAccount = cleanDigits(row.destinationAccount)
  if (destinationAccount.length >= 18) {
    return destinationAccount
  }

  return cleanDigits(BBVA_BANXICO_BENEFICIARY_ACCOUNT) || destinationAccount
}

function shouldEnrichClaraDepositRow(
  row: BankImportParsedSourceRow,
  accountingPeriodWindow: AccountingPeriodWindow,
) {
  if (normalizeText(row.transactionType) !== 'DEPOSIT') {
    return false
  }

  if (!row.processingDate || !isDateWithinAccountingPeriod(row.processingDate, accountingPeriodWindow)) {
    return false
  }

  if (normalizeText(row.status) !== 'PROCESADO') {
    return false
  }

  if (!Number.isFinite(row.amount) || (row.amount ?? 0) <= 0) {
    return false
  }

  if (
    !shouldPreferClaraDepositBanxicoLookup(
      row.statementCounterpartyName ?? row.counterpartyName,
      row.trackingKey,
      row.referenceNumber,
      row.counterpartySource ?? 'statement',
    )
  ) {
    return false
  }

  return Boolean(
    cleanText(row.originBankName) &&
      cleanText(row.destinationBankName) &&
      cleanText(row.destinationAccount) &&
      (cleanText(row.trackingKey) || cleanText(row.referenceNumber)),
  )
}

async function resolveClaraDepositCounterpartyFromBanxico(
  row: BankImportParsedSourceRow,
): Promise<ClaraDepositBanxicoResolution | null> {
  const cacheKey = buildClaraDepositBanxicoCacheKey(row)
  if (!cacheKey) {
    return null
  }

  let cachedResolution = claraDepositBanxicoResolutionCache.get(cacheKey)
  if (!cachedResolution) {
    cachedResolution = fetchClaraDepositCounterpartyFromBanxico(row)
      .then((result) => {
        if (!result) {
          claraDepositBanxicoResolutionCache.delete(cacheKey)
        }

        return result
      })
      .catch((error) => {
        claraDepositBanxicoResolutionCache.delete(cacheKey)
        throw error
      })
    claraDepositBanxicoResolutionCache.set(cacheKey, cachedResolution)
  }

  return cachedResolution
}

async function fetchClaraDepositCounterpartyFromBanxico(
  row: BankImportParsedSourceRow,
): Promise<ClaraDepositBanxicoResolution | null> {
  if (!row.processingDate || !Number.isFinite(row.amount) || (row.amount ?? 0) <= 0) {
    return null
  }

  const operationDate = formatDateOnly(row.processingDate)
  const catalog = await getBanxicoInstitutionCatalogCached(operationDate)
  const issuerId = resolveBanxicoInstitutionId(catalog, row.originBankName ?? null)
  const receiverId = resolveBanxicoInstitutionId(catalog, row.destinationBankName ?? null)
  const trackingKey = cleanText(row.trackingKey)
  const referenceNumber = cleanText(row.referenceNumber)
  const beneficiaryAccount = cleanText(row.destinationAccount)

  if (!issuerId || !receiverId || !beneficiaryAccount || (!trackingKey && !referenceNumber)) {
    return null
  }

  const storedRecognition = findBanxicoCepRecognition({
    bankId: 'clara_corriente',
    sourceProfileId: 'clara_account_activity',
    operationDate,
    issuerId,
    receiverId,
    beneficiaryAccount,
    amount: round2(row.amount ?? 0).toFixed(2),
    trackingKey,
    referenceNumber,
  })
  if (storedRecognition) {
    const orderingResolution = resolveClaraDepositOrderingParty({
      orderingPartyName: storedRecognition.orderingPartyName,
      orderingPartyRfc: storedRecognition.orderingPartyRfc,
      beneficiaryName: storedRecognition.beneficiaryName,
      trackingKey,
      referenceNumber,
    })
    if (orderingResolution) {
      return {
        counterpartyName: orderingResolution.counterpartyName,
        rfc: cleanText(storedRecognition.orderingPartyRfc) || null,
        trackingKey: cleanText(storedRecognition.trackingKey) || trackingKey || null,
        orderingPartyAccount: cleanText(storedRecognition.orderingPartyAccount) || cleanText(row.originAccount) || null,
      }
    }
  }

  const lookupAttempts = buildClaraDepositBanxicoLookupAttempts(trackingKey, referenceNumber)
  try {
    const details = await lookupBanxicoDetailsWithRetry({
      operationDate,
      issuerId,
      receiverId,
      beneficiaryAccount,
      amount: round2(row.amount ?? 0).toFixed(2),
      attempts: lookupAttempts,
    })
    if (!details) {
      return null
    }

    upsertBanxicoCepRecognition({
      bankId: 'clara_corriente',
      sourceProfileId: 'clara_account_activity',
      operationDate,
      issuerId,
      receiverId,
      beneficiaryAccount,
      amount: round2(row.amount ?? 0).toFixed(2),
      trackingKey,
      referenceNumber,
      details,
      source: 'analysis_auto',
    })

    const orderingResolution = resolveClaraDepositOrderingParty({
      orderingPartyName: details?.orderingParty?.name ?? null,
      orderingPartyRfc: details?.orderingParty?.rfc ?? null,
      beneficiaryName: details?.beneficiary?.name ?? null,
      trackingKey,
      referenceNumber,
    })
    if (!orderingResolution) {
      return null
    }

    return {
      counterpartyName: orderingResolution.counterpartyName,
      rfc: cleanText(details?.orderingParty?.rfc) || null,
      trackingKey: cleanText(details?.trackingKey) || trackingKey || null,
      orderingPartyAccount: cleanText(details?.orderingParty?.account) || cleanText(row.originAccount) || null,
    }
  } catch {
    return null
  }
}

function buildClaraDepositBanxicoLookupAttempts(trackingKey: string, referenceNumber: string) {
  const attempts: Array<{
    searchType: 'trackingKey' | 'referenceNumber'
    criteria: string
  }> = []

  if (trackingKey) {
    attempts.push({
      searchType: 'trackingKey',
      criteria: trackingKey,
    })
  }

  if (referenceNumber && referenceNumber !== trackingKey) {
    attempts.push({
      searchType: 'referenceNumber',
      criteria: referenceNumber,
    })
  }

  return attempts
}

async function lookupBanxicoDetailsWithRetry({
  operationDate,
  issuerId,
  receiverId,
  beneficiaryAccount,
  amount,
  attempts,
}: {
  operationDate: string
  issuerId: string
  receiverId: string
  beneficiaryAccount: string
  amount: string
  attempts: Array<{
    searchType: 'trackingKey' | 'referenceNumber'
    criteria: string
  }>
}) {
  for (const attempt of attempts) {
    for (let retry = 0; retry < 3; retry += 1) {
      try {
        const details = await downloadBanxicoCepDetails({
          operationDate,
          searchType: attempt.searchType,
          criteria: attempt.criteria,
          issuerId,
          receiverId,
          mode: 'cep',
          beneficiaryAccount,
          amount,
          beneficiaryIsParticipant: false,
        })
        if (details) {
          return details
        }
      } catch {
        // Banxico is intermittently flaky; retry before giving up on the deposit.
      }

      if (retry < 2) {
        await wait(350 * (retry + 1))
      }
    }
  }

  return null
}

function buildClaraDepositBanxicoCacheKey(row: BankImportParsedSourceRow) {
  if (!row.processingDate || !Number.isFinite(row.amount) || (row.amount ?? 0) <= 0) {
    return null
  }

  const trackingKey = cleanText(row.trackingKey)
  const referenceNumber = cleanText(row.referenceNumber)
  const beneficiaryAccount = cleanText(row.destinationAccount)
  if (!beneficiaryAccount || (!trackingKey && !referenceNumber)) {
    return null
  }

  return [
    formatDateOnly(row.processingDate),
    cleanText(row.originBankName),
    cleanText(row.destinationBankName),
    beneficiaryAccount,
    round2(row.amount ?? 0).toFixed(2),
    trackingKey || `ref:${referenceNumber}`,
  ].join('|')
}

async function getBanxicoInstitutionCatalogCached(operationDate: string) {
  let catalogPromise = banxicoInstitutionCatalogByDateCache.get(operationDate)
  if (!catalogPromise) {
    catalogPromise = getBanxicoCepInstitutions(operationDate)
    banxicoInstitutionCatalogByDateCache.set(operationDate, catalogPromise)
  }

  return catalogPromise
}

function resolveBanxicoInstitutionId(
  catalog: Awaited<ReturnType<typeof getBanxicoCepInstitutions>>,
  bankName: string | null,
) {
  const cleanedBankName = cleanText(bankName)
  if (!cleanedBankName) {
    return null
  }

  const normalizedBankName = normalizeText(cleanedBankName)
  const compactBankName = compactText(cleanedBankName)
  const allInstitutions = [...catalog.institutionsMispei, ...catalog.institutions]

  const exactInstitution = allInstitutions.find((item) => normalizeText(item.name) === normalizedBankName)
  if (exactInstitution) {
    return exactInstitution.id
  }

  const compactInstitution = allInstitutions.find((item) => compactText(item.name) === compactBankName)
  if (compactInstitution) {
    return compactInstitution.id
  }

  const includedInstitution = allInstitutions.find((item) => {
    const compactInstitutionName = compactText(item.name)
    return compactInstitutionName.includes(compactBankName) || compactBankName.includes(compactInstitutionName)
  })
  return includedInstitution?.id ?? null
}

function shouldPreferClaraDepositBanxicoLookup(
  value: string | null | undefined,
  trackingKey: string | null | undefined,
  referenceNumber: string | null | undefined,
  source: CounterpartySource = 'statement',
) {
  if (source === 'banxico_ordering_party') {
    return false
  }

  return true
}

function isMeaningfulClaraCounterpartyName(
  value: string | null | undefined,
  trackingKey: string | null | undefined,
  referenceNumber: string | null | undefined,
) {
  const cleanedValue = cleanText(value)
  const compactValue = compactText(cleanedValue)
  if (!cleanedValue || !compactValue) {
    return false
  }

  if (compactValue === compactText(trackingKey) || compactValue === compactText(referenceNumber)) {
    return false
  }

  if (/^\d+$/u.test(cleanedValue)) {
    return false
  }

  if (/^(?=.*\d)[A-Z0-9]{12,}$/u.test(compactValue)) {
    return false
  }

  if (compactValue.startsWith('DEPOSITREF')) {
    return false
  }

  const unicodeLetters = cleanedValue.match(/\p{L}/gu) ?? []
  return unicodeLetters.length >= 4

  const letters = cleanedValue.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/gu) ?? []
  return letters.length >= 4
}

async function mapWithConcurrency<Item>(
  items: Item[],
  concurrency: number,
  task: (item: Item) => Promise<void>,
) {
  if (items.length === 0) {
    return
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async (_item, workerIndex) => {
    for (let index = workerIndex; index < items.length; index += concurrency) {
      await task(items[index])
    }
  })

  await Promise.all(workers)
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

const BBVA_PDF_AMOUNT_BALANCE_REGEX = /\$\s*([\d,]+\.\d{2})\s+\$\s*([\d,]+\.\d{2})\s*$/
const BBVA_PDF_TRAILING_AMOUNTS_REGEX = /(?:\s+\$?[\d,]+\.\d{2}){1,3}\s*$/u
const BBVA_PDF_COMPACT_MOVEMENT_START_REGEX = /^(\d{2})-(\d{2})\b/
const BBVA_PDF_STATEMENT_MOVEMENT_START_REGEX = /^(\d{2})\/([A-Z]{3})\s+(\d{2})\/([A-Z]{3})\s+[A-Z0-9]{2,3}\s+(.+)$/iu

const BBVA_MONTH_TOKEN_TO_NUMBER: Record<string, number> = {
  ENE: 1,
  FEB: 2,
  MAR: 3,
  ABR: 4,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AGO: 8,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DIC: 12,
  DEC: 12,
}

function parseBbvaPdfText(text: string): BankImportParsedSourceRow[] {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => cleanText(line))
    .filter((line) => Boolean(line))
  const statementDate = parseBbvaStatementDate(lines)
  const statementAccount = parseBbvaStatementAccount(lines)
  const movements = extractBbvaPdfMovements(lines, statementDate)

  if (movements.length === 0) {
    throw new BankImportError(
      'No detecte movimientos en el PDF de BBVA. Verifica que sea el reporte "Detalle de movimientos".',
      400,
    )
  }

  return movements.map((movement) => {
    const paymentConcept = buildBbvaPaymentConcept(movement)
    const counterpartyName = resolveBbvaCounterpartyName(movement)
    const trackingKey = movement.trackingKey ?? ''
    const referenceNumber = movement.referenceNumber ?? extractBbvaSpeiBanxicoReferenceNumber(paymentConcept) ?? ''
    const isIncoming = movement.direction === 'incoming'
    const isOutgoing = movement.direction === 'outgoing'

    return {
      processingDate: movement.processingDate,
      status: 'Procesado',
      amount: movement.amount,
      transactionType: resolveBbvaTransactionType(movement),
      counterpartyName,
      paymentConcept,
      trackingKey,
      referenceNumber,
      hashId: trackingKey ? '' : buildBbvaHashId(movement),
      rfc: null,
      originBankName: isOutgoing ? BBVA_BANXICO_DESTINATION_BANK_NAME : null,
      originAccount: isOutgoing ? statementAccount : null,
      destinationBankName: isIncoming ? BBVA_BANXICO_DESTINATION_BANK_NAME : null,
      destinationAccount: isIncoming ? statementAccount : null,
    }
  })
}

function parseBbvaStatementDate(lines: string[]) {
  for (const line of lines) {
    const cutoffMatch = /FECHA DE CORTE\s+(\d{2})\/(\d{2})\/(\d{4})/iu.exec(line)
    if (cutoffMatch) {
      return new Date(Number(cutoffMatch[3]), Number(cutoffMatch[2]) - 1, Number(cutoffMatch[1]))
    }

    const periodMatch = /PERIODO\s+DEL\s+\d{2}\/\d{2}\/\d{4}\s+AL\s+(\d{2})\/(\d{2})\/(\d{4})/iu.exec(line)
    if (periodMatch) {
      return new Date(Number(periodMatch[3]), Number(periodMatch[2]) - 1, Number(periodMatch[1]))
    }
  }

  for (const line of lines) {
    const match = /(\d{2})\/(\d{2})\/(\d{4})/.exec(line)
    if (match) {
      return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]))
    }
  }

  throw new BankImportError('No pude identificar la fecha del PDF de BBVA.', 400)
}

function parseBbvaStatementAccount(lines: string[]) {
  for (let index = 0; index < lines.length; index += 1) {
    const currentLine = cleanText(lines[index])
    const normalizedLine = normalizeText(currentLine)
    const currentMatch = /(?:NO\.?\s*CUENTA|NUMERO\s+DE\s+CUENTA|CLABE(?:\s+INTERBANCARIA)?)\s*:?\s*([0-9*\s-]{8,})/u.exec(
      normalizedLine,
    )
    if (currentMatch) {
      const account = cleanDigits(currentMatch[1])
      if (account) {
        return account
      }
    }

    if (/(?:NO\.?\s*CUENTA|NUMERO\s+DE\s+CUENTA|CLABE(?:\s+INTERBANCARIA)?)/u.test(normalizedLine)) {
      const nextLine = cleanText(lines[index + 1])
      const account = cleanDigits(nextLine)
      if (account.length >= 8) {
        return account
      }
    }
  }

  return cleanDigits(BBVA_BANXICO_BENEFICIARY_ACCOUNT) || null
}

function extractBbvaPdfMovements(lines: string[], statementDate: Date): BbvaPdfMovement[] {
  const statementLayoutDetected = lines.some((line) => BBVA_PDF_STATEMENT_MOVEMENT_START_REGEX.test(line))
  const movements = statementLayoutDetected
    ? extractBbvaStatementPdfMovements(lines, statementDate)
    : extractBbvaCompactPdfMovements(lines, statementDate)

  movements.forEach((movement, index) => {
    movement.direction = resolveBbvaMovementDirection(movements, index)
  })

  return movements
}

function extractBbvaCompactPdfMovements(lines: string[], statementDate: Date) {
  const movements: BbvaPdfMovement[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const firstLine = lines[index]
    const dateMatch = BBVA_PDF_COMPACT_MOVEMENT_START_REGEX.exec(firstLine)
    if (!dateMatch) {
      continue
    }

    let amountLine = firstLine
    let detailText = ''
    let amountMatch = BBVA_PDF_AMOUNT_BALANCE_REGEX.exec(amountLine)
    if (!amountMatch) {
      const nextLine = lines[index + 1] ?? ''
      if (nextLine && !BBVA_PDF_COMPACT_MOVEMENT_START_REGEX.test(nextLine)) {
        amountLine = nextLine
        detailText = nextLine.replace(BBVA_PDF_AMOUNT_BALANCE_REGEX, '')
        amountMatch = BBVA_PDF_AMOUNT_BALANCE_REGEX.exec(nextLine)
        if (amountMatch) {
          index += 1
        }
      }
    }

    if (!amountMatch) {
      continue
    }

    const processingDate = buildBbvaProcessingDate(statementDate, Number(dateMatch[1]), Number(dateMatch[2]))
    const amount = Number(amountMatch[1].replace(/,/g, ''))
    const balance = Number(amountMatch[2].replace(/,/g, ''))
    const headerText = cleanText(firstLine.replace(BBVA_PDF_COMPACT_MOVEMENT_START_REGEX, '').replace(BBVA_PDF_AMOUNT_BALANCE_REGEX, ''))
    const movement: BbvaPdfMovement = {
      processingDate,
      headerText,
      detailText: cleanText(detailText),
      amount: round2(amount),
      balance: round2(balance),
      direction: 'unknown',
      trackingKey: extractBbvaTrackingKey(headerText, detailText),
      referenceNumber: extractBbvaReferenceNumber(headerText, detailText),
    }

    movements.push(movement)
  }

  return movements
}

function extractBbvaStatementPdfMovements(lines: string[], statementDate: Date) {
  const movements: BbvaPdfMovement[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const firstLine = lines[index]
    const startMatch = BBVA_PDF_STATEMENT_MOVEMENT_START_REGEX.exec(firstLine)
    if (!startMatch) {
      continue
    }

    const month = parseBbvaMonthToken(startMatch[2])
    if (!month) {
      continue
    }

    const detailLines: string[] = []
    let nextIndex = index + 1
    while (nextIndex < lines.length) {
      const nextLine = lines[nextIndex]
      if (BBVA_PDF_STATEMENT_MOVEMENT_START_REGEX.test(nextLine)) {
        break
      }

      if (!isBbvaStatementNoiseLine(nextLine)) {
        detailLines.push(nextLine)
      }

      nextIndex += 1
    }

    const amountTokens = extractBbvaAmountTokens(startMatch[5])
    const amount = amountTokens[0]
    if (!Number.isFinite(amount)) {
      index = nextIndex - 1
      continue
    }

    const processingDate = buildBbvaProcessingDate(statementDate, Number(startMatch[1]), month)
    const headerText = cleanText(startMatch[5].replace(BBVA_PDF_TRAILING_AMOUNTS_REGEX, ''))
    const detailText = detailLines.join(' | ')
    movements.push({
      processingDate,
      headerText,
      detailText,
      amount: round2(amount),
      balance: amountTokens.length > 1 ? round2(amountTokens[1]) : null,
      direction: 'unknown',
      trackingKey: extractBbvaTrackingKey(headerText, detailText),
      referenceNumber: extractBbvaReferenceNumber(headerText, detailText),
    })

    index = nextIndex - 1
  }

  return movements
}

function buildBbvaProcessingDate(statementDate: Date, day: number, month: number) {
  const statementMonth = statementDate.getMonth() + 1
  const year = month > statementMonth ? statementDate.getFullYear() - 1 : statementDate.getFullYear()
  return new Date(year, month - 1, day)
}

function resolveBbvaMovementDirection(movements: BbvaPdfMovement[], index: number): RecognitionDirection {
  const current = movements[index]
  const next = movements[index + 1]
  if (next && current.balance !== null && next.balance !== null) {
    const delta = round2(current.balance - next.balance)
    if (Math.abs(Math.abs(delta) - current.amount) <= 0.05 && delta !== 0) {
      return delta > 0 ? 'incoming' : 'outgoing'
    }
  }

  return inferBbvaDirectionFromText(current.headerText, current.detailText)
}

function inferBbvaDirectionFromText(headerText: string, detailText: string): RecognitionDirection {
  const normalized = normalizeText(`${headerText} ${detailText}`)
  if (
    normalized.includes('DEPOSITO') ||
    normalized.includes('RECIBIDO') ||
    normalized.includes('COMPENSACION POR RETRASO')
  ) {
    return 'incoming'
  }

  if (
    normalized.includes('ORDEN DE PAGO') ||
    normalized.startsWith('PAGO ') ||
    normalized.includes('SERV BANCA INTERNET') ||
    normalized.includes('IVA COM SERV BCA INTERNET') ||
    normalized.includes('IMSS/INF/AFORE') ||
    normalized.includes('PRESTAMO')
  ) {
    return 'outgoing'
  }

  return 'unknown'
}

function resolveBbvaTransactionType(movement: BbvaPdfMovement) {
  const normalized = normalizeText(`${movement.headerText} ${movement.detailText}`)

  if (normalized.includes('NOMINA')) {
    return 'Nomina'
  }

  if (movement.direction === 'incoming') {
    return 'Cobro'
  }

  if (movement.direction === 'outgoing') {
    return 'Pago'
  }

  if (hasBbvaStrongOutgoingTypeHint(movement.headerText, movement.detailText)) {
    return 'Pago'
  }

  if (inferBbvaDirectionFromText(movement.headerText, movement.detailText) === 'incoming') {
    return 'Cobro'
  }

  return 'Pago'
}

function hasBbvaStrongOutgoingTypeHint(headerText: string, detailText: string) {
  const normalized = normalizeText(`${headerText} ${detailText}`)
  return (
    normalized.startsWith('PAGO CUENTA DE TERCERO/') ||
    normalized.startsWith('ORDEN DE PAGO EXTRANJERO/') ||
    normalized.startsWith('PAGO DE PRESTAMO/') ||
    normalized.startsWith('SERV BANCA INTERNET') ||
    normalized.startsWith('IVA COM SERV BCA INTERNET') ||
    normalized.startsWith('IMSS/INF/AFORE')
  )
}

function resolveBbvaCounterpartyName(movement: BbvaPdfMovement) {
  const normalizedHeader = normalizeText(movement.headerText)
  if (normalizedHeader.startsWith('SPEI ')) {
    return ''
  }

  if (
    normalizedHeader.startsWith('PAGO CUENTA DE TERCERO/') ||
    normalizedHeader.startsWith('ORDEN DE PAGO EXTRANJERO/') ||
    normalizedHeader.startsWith('PAGO DE PRESTAMO/') ||
    normalizedHeader.startsWith('IMSS/INF/AFORE') ||
    normalizedHeader.startsWith('SERV BANCA INTERNET') ||
    normalizedHeader.startsWith('IVA COM SERV BCA INTERNET')
  ) {
    return movement.headerText
  }

  const detailHint = cleanBbvaDetailHint(movement.detailText)
  return detailHint || movement.headerText
}

function buildBbvaPaymentConcept(movement: BbvaPdfMovement) {
  return [movement.headerText, movement.detailText].filter((value) => Boolean(value)).join(' | ')
}

function cleanBbvaDetailHint(detailText: string) {
  return cleanText(
    detailText
      .replace(/\|\s*/gu, ' ')
      .replace(/^\d+(?:\.\d+)*\s*/u, '')
      .replace(/^BNET\s+\d+\s*/iu, '')
      .replace(/\s+REF\.?\s+[A-Z0-9.\s-]+$/iu, '')
      .replace(/^(?:PAGO\s+)?FACT(?:URA)?\s+\d+\s+/iu, ''),
  )
}

function extractBbvaTrackingKey(...textParts: Array<string | null | undefined>) {
  const joinedText = textParts.filter((value): value is string => Boolean(value)).join('\n')
  const referenceMatch = /(?:\bREF\.?\s*)([A-Z0-9][A-Z0-9.\s-]{4,}?)(?=$|\n|\|)/iu.exec(joinedText)
  if (referenceMatch) {
    return cleanText(referenceMatch[1]) || null
  }

  for (const textPart of textParts) {
    const cleanedPart = cleanText(textPart)
    const slashIndex = cleanedPart.indexOf('/')
    if (slashIndex >= 0) {
      const candidate = cleanText(cleanedPart.slice(slashIndex + 1))
      if (candidate) {
        return candidate
      }
    }
  }

  return null
}

function extractBbvaReferenceNumber(...textParts: Array<string | null | undefined>) {
  for (const textPart of textParts) {
    const bnetReferenceMatch = /\bBNET\s*([0-9]{6,})\b/iu.exec(cleanText(textPart))
    if (bnetReferenceMatch) {
      return cleanText(bnetReferenceMatch[1]) || null
    }
  }

  return null
}

function isBbvaStableHistoricalTrackingKey(value: string | null | undefined) {
  return /^(?:REF)?BNTC[0-9A-Z]+$/iu.test(cleanText(value))
}

function isBbvaStableHistoricalReferenceNumber(value: string | null | undefined) {
  return /^[0-9]{10,}$/u.test(cleanDigits(value))
}

function extractBbvaSpeiBanxicoReferenceNumber(value: string | null | undefined) {
  const paymentConcept = cleanText(value)
  if (!normalizeText(paymentConcept).startsWith('SPEI')) {
    return null
  }

  const trailingSegment = paymentConcept
    .split('|')
    .map((segment) => cleanText(segment))
    .filter((segment) => Boolean(segment))
    .at(-1)

  const match = /^\s*([0-9]{7})(?=\D|$)/u.exec(trailingSegment ?? '')
  return match ? cleanText(match[1]) || null : null
}

function extractBbvaSpeiOriginBankName(value: string | null | undefined) {
  const paymentConcept = cleanText(value)
  if (!normalizeText(paymentConcept).startsWith('SPEI')) {
    return null
  }

  const match = /\bSPEI\s+(?:RECIBIDO|ENVIADO)\s*([A-Z0-9 ]+?)\//iu.exec(normalizeText(paymentConcept))
  if (!match) {
    return null
  }

  return cleanText(match[1]) || null
}

function resolveBbvaSpeiOrderingParty(input: {
  orderingPartyName: string | null
  orderingPartyRfc?: string | null
  beneficiaryName?: string | null
  referenceNumber?: string | null
}) {
  const cleanedOrderingName = cleanText(input.orderingPartyName)
  if (!cleanedOrderingName) {
    return null
  }

  if (!isMeaningfulBbvaSpeiCounterpartyName(cleanedOrderingName, input.referenceNumber)) {
    return null
  }

  if (compactText(cleanedOrderingName) === compactText(input.beneficiaryName)) {
    return null
  }

  return {
    counterpartyName: cleanedOrderingName,
  }
}

function isMeaningfulBbvaSpeiCounterpartyName(value: string | null | undefined, referenceNumber?: string | null) {
  const cleanedValue = cleanText(value)
  const compactValue = compactText(cleanedValue)
  if (!cleanedValue || !compactValue) {
    return false
  }

  if (compactValue === compactText(referenceNumber)) {
    return false
  }

  if (/^\d+$/u.test(cleanedValue)) {
    return false
  }

  if (/^(?=.*\d)[A-Z0-9]{12,}$/u.test(compactValue)) {
    return false
  }

  if (
    compactValue.includes('SISTEMADEPAGO') ||
    compactValue.includes('BANXICO') ||
    compactValue.includes('BBVAMEXICO') ||
    compactValue.includes('BANCOMERSISTEMADEPAGO')
  ) {
    return false
  }

  const unicodeLetters = cleanedValue.match(/\p{L}/gu) ?? []
  return unicodeLetters.length >= 4
}

function buildBbvaHashId(movement: BbvaPdfMovement) {
  return createHash('sha1')
    .update(
      [
        formatDateOnly(movement.processingDate),
        movement.headerText,
        movement.detailText,
        movement.amount.toFixed(2),
        movement.balance?.toFixed(2) ?? '',
      ].join('|'),
    )
    .digest('hex')
    .slice(0, 20)
}

function extractBbvaAmountTokens(value: string) {
  return Array.from(value.matchAll(/\$?\s*([\d,]+\.\d{2})/gu))
    .map((match) => Number(match[1].replace(/,/g, '')))
    .filter((item) => Number.isFinite(item))
}

function parseBbvaMonthToken(value: string) {
  return BBVA_MONTH_TOKEN_TO_NUMBER[normalizeText(value)]
}

function isBbvaStatementNoiseLine(value: string) {
  const normalized = normalizeText(value)
  return (
    normalized.startsWith('NO. CUENTA') ||
    normalized.startsWith('NUMERO DE CUENTA') ||
    normalized.startsWith('CLABE INTERBANCARIA') ||
    normalized.startsWith('NO. CLIENTE') ||
    normalized.startsWith('ESTADO DE CUENTA') ||
    normalized.startsWith('PAGINA ') ||
    normalized.startsWith('MAESTRA PYME BBVA') ||
    normalized.startsWith('BBVA MEXICO') ||
    normalized.startsWith('-- ') ||
    normalized.startsWith('TOTAL DE MOVIMIENTOS') ||
    normalized.startsWith('TOTAL IMPORTE ') ||
    normalized.startsWith('INFORMACION FINANCIERA') ||
    normalized.startsWith('DOMICILIO FISCAL')
  )
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

function normalizeCreatedRecordId(value: string | null) {
  if (!value || value === '0') {
    return null
  }

  return value
}

function parseRecordIdFromLocation(location: string | null) {
  if (!location) {
    return null
  }

  try {
    const url = new URL(location)
    const parts = url.pathname.split('/').filter(Boolean)
    return parts[parts.length - 1] || null
  } catch {
    const match = location.match(/\/([^/?#]+)\/?$/)
    return match?.[1] ?? null
  }
}

function formatSuiteQlLiteral(value: string) {
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return value
  }

  return `'${value.replace(/'/g, "''")}'`
}

function stripLeadingEntityCode(value: string) {
  return cleanText(value).replace(/^\d+\s+/, '')
}

function parseSpreadsheetDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const serial = XLSX.SSF.parse_date_code(value)
    if (!serial) {
      return null
    }

    return new Date(
      serial.y,
      Math.max(serial.m - 1, 0),
      serial.d,
      serial.H,
      serial.M,
      Math.round(serial.S),
    )
  }

  const text = cleanText(value)
  if (!text) {
    return null
  }

  const timestampMatch =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text)
  if (timestampMatch) {
    return new Date(
      Number(timestampMatch[1]),
      Number(timestampMatch[2]) - 1,
      Number(timestampMatch[3]),
      Number(timestampMatch[4] ?? 0),
      Number(timestampMatch[5] ?? 0),
      Number(timestampMatch[6] ?? 0),
    )
  }

  const dottedMatch = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text)
  if (dottedMatch) {
    return new Date(
      Number(dottedMatch[3]),
      Number(dottedMatch[2]) - 1,
      Number(dottedMatch[1]),
    )
  }

  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function parseAmount(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return round2(value)
  }

  const text = cleanText(value).replace(/,/g, '')
  if (!text) {
    return null
  }

  const parsed = Number.parseFloat(text)
  return Number.isFinite(parsed) ? round2(parsed) : null
}

function buildExternalId(
  bankId: BankImportBankId,
  hashId: string,
  trackingKey: string,
  processingDate: Date,
  amount: number,
  transactionType: string,
  counterpartyName: string,
  paymentConcept: string,
) {
  const dateToken = formatDateOnly(processingDate).replace(/-/g, '')
  const readableToken =
    compactText(hashId) ||
    compactText(trackingKey) ||
    compactText(counterpartyName) ||
    compactText(paymentConcept) ||
    `${dateToken}${round2(amount).toFixed(2).replace(/\D/g, '')}`
  const fingerprint = createHash('sha1')
    .update(
      [
        'v3',
        bankId,
        dateToken,
        round2(amount).toFixed(2),
        compactText(counterpartyName),
        compactText(paymentConcept),
        compactText(trackingKey),
        compactText(hashId),
      ].join('|'),
    )
    .digest('hex')
    .slice(0, 20)

  return `BANK-${bankId.toUpperCase()}-V3-${dateToken}-${readableToken.slice(0, 24)}-${fingerprint}`.slice(0, 120)
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function resolveAccountingPeriodWindow(periodStartInput: Date): AccountingPeriodWindow {
  const periodStart = startOfMonth(periodStartInput)
  const today = startOfDay(new Date())
  const referenceDate = periodStart
  const periodEnd = isSameCalendarMonth(referenceDate, today) ? today : endOfMonth(referenceDate)

  return {
    token: formatAccountingPeriod(referenceDate),
    start: periodStart,
    end: periodEnd,
    referenceDate,
  }
}

function isDateWithinAccountingPeriod(date: Date, accountingPeriodWindow: AccountingPeriodWindow) {
  const day = startOfDay(date).getTime()
  return day >= accountingPeriodWindow.start.getTime() && day <= accountingPeriodWindow.end.getTime()
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function formatDateOnly(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function cleanNullableDateOnly(value: unknown) {
  const cleaned = cleanText(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(cleaned) ? cleaned : null
}

function formatTimestamp(date: Date) {
  return `${formatDateOnly(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

function formatTemplateDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    return value
  }

  return `${Number(match[3])}.${Number(match[2])}.${match[1]}`
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function round2(value: number) {
  return Math.round(value * 100) / 100
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000
}

function formatMoney(value: number) {
  return `$${round2(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
