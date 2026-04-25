import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  analyzeBankImportSample,
  fetchBanxicoCepDetails,
  fetchBanxicoCepInstitutions,
  fetchBankImportAnalysisRun,
  fetchBankImportSample,
  fetchBankImportConfig,
  fetchNetSuiteAccountCatalog,
  HttpClientError,
  postBankImportJournals,
  recoverBankImportAnalysis,
  saveBankImportValidatedBalance,
  saveBankImportCorrection,
  searchBankImportCandidates,
  startBankImportAnalysis,
  uploadBankHistoricalStatement,
  uploadBankIndividualPaymentFiles,
  type BankImportAnalyzeResponse,
  type BankImportAnalysisMode,
  type BankImportAnalysisRunResponse,
  type BankImportBank,
  type BankImportBalanceValidation,
  type BankImportBankId,
  type BankImportConfigResponse,
  type BankImportCounterpartySource,
  type BankImportCreditDestinationType,
  type BankImportJournalPreview,
  type BankImportPostJournalsResponse,
  type BankImportSuggestedCandidate,
  type BankImportTransientCorrection,
  type BankImportUnmatchedRow,
  type BanxicoCepInstitutionsResponse,
  type BanxicoCepTransferSummary,
  type NetSuiteAccountCatalogResponse,
} from '../../services/api/reconciliationApi'

const FALLBACK_BANK_ID: BankImportBankId = 'payana'
const FALLBACK_BANK_LABEL = 'Payana - Higo'
const DEFAULT_BANK_ACCOUNT_LABEL = '102-01-06 Bancos : Bancos Nacionales : Higo'
const BANK_VIEW_STORAGE_KEY = 'bancos:view-state:v1'
const BANK_COLUMN_WIDTHS_STORAGE_PREFIX = 'bancos:column-widths:v1'
const READY_ACCOUNT_DATALIST_ID = 'bancos-ready-account-options'
const BANK_ANALYSIS_POLL_INTERVAL_MS = 1200
const BANK_ANALYSIS_MAX_WAIT_MS = 180000
const BANK_ANALYSIS_ABORT_ERROR = 'BANK_ANALYSIS_ABORTED'

const BANK_ROUTE_SEGMENTS: Record<BankImportBankId, string> = {
  payana: 'payana-higo',
  clara_corriente: 'clara-corriente',
  bbva: 'bbva',
}

type BankSourceProfile = {
  acceptedFileTypes: string
  expectedSourceLabel: string
  sourceSummary: string
  intakeSummary: string
  specialSummary: string
}

const BANK_SOURCE_PROFILES: Record<BankImportBankId, BankSourceProfile> = {
  payana: {
    acceptedFileTypes: '.xlsx,.xls,.csv',
    expectedSourceLabel: 'Excel o CSV de transacciones',
    sourceSummary: 'Layout tabular de transacciones con fecha de procesamiento y tipo de movimiento.',
    intakeSummary: 'Excel/CSV tabular, filtro Procesado y preferencia inicial segun tipo.',
    specialSummary: 'Cobros, anticipos y pagos siguen el flujo actual de homologacion.',
  },
  clara_corriente: {
    acceptedFileTypes: '.xlsx,.xls,.csv',
    expectedSourceLabel: 'CSV o Excel de pagos / actividad de cuenta',
    sourceSummary: 'Dos layouts soportados: pagos para egresos y actividad de cuenta para ingresos DEPOSIT.',
    intakeSummary: 'CSV/Excel con layouts Clara y barrido por tipo sin fallback cruzado entre hojas.',
    specialSummary: 'Pagos salen a Proveedores; DEPOSIT entra por Clientes.',
  },
  bbva: {
    acceptedFileTypes: '.pdf',
    expectedSourceLabel: 'PDF Detalle de movimientos',
    sourceSummary: 'Parser PDF que reconstruye cada movimiento por fecha, descripcion, monto y saldo corrido.',
    intakeSummary: 'PDF Detalle de movimientos; el sistema infiere cargo/abono a partir del saldo acumulado y mantiene ingresos y egresos en el flujo normal.',
    specialSummary: 'Ingresos entran como Cobro y egresos como Pago dentro del mismo flujo operativo.',
  },
}

const ANALYSIS_MODE_OPTIONS: Record<
  BankImportAnalysisMode,
  {
    label: string
    runningLabel: string
  }
> = {
  standard: {
    label: 'Analizar archivo',
    runningLabel: 'Analizando archivo...',
  },
  banxico: {
    label: 'Banxico',
    runningLabel: 'Corriendo Banxico...',
  },
  cot_ov: {
    label: 'Cot / OV',
    runningLabel: 'Corriendo Cot / OV...',
  },
}

const BANK_ANALYSIS_MODE_OPTIONS: Record<BankImportBankId, BankImportAnalysisMode[]> = {
  payana: ['standard', 'cot_ov'],
  clara_corriente: ['standard', 'banxico', 'cot_ov'],
  bbva: ['standard', 'banxico', 'cot_ov'],
}

type StoredBankViewState = {
  accountingPeriod: string
  cutoffDate?: string
  result: BankImportAnalyzeResponse | null
  transientCorrections: BankImportTransientCorrection[]
  heldReadyCorrectionKeys: string[]
  postedReadyJournalExternalIds: string[]
  uploadedFile: StoredBankUploadedFile | null
  analysisRunId: string | null
  analysisMode: BankImportAnalysisMode
}

type StoredBankUploadedFile = {
  fileName: string
  fileBase64: string
}

type BankResultSource = 'none' | 'cached' | 'backend'

type CorrectionEditorTarget = {
  correctionKey: string
  transactionType: string
  mappingSheetKey: BankImportConfigResponse['mappingSheets'][number]['key'] | null
  mappingSheetName: string | null
  transactionDate: string | null
  processingTimestamp: string | null
  counterpartyName: string
  statementCounterpartyName: string | null
  counterpartySource: BankImportCounterpartySource
  orderingPartyName: string | null
  orderingPartyRfc: string | null
  orderingPartyAccount: string | null
  amount: number | null
  paymentConcept: string | null
  rfc: string | null
  trackingKey: string | null
  referenceNumber: string | null
  originBankName: string | null
  destinationBankName: string | null
  destinationAccount: string | null
  hashId: string | null
  suggestedCandidate: BankImportSuggestedCandidate | null
  currentMatch: {
    netsuiteName: string
    creditAccount: string
    sourceLabel: string
    entityInternalId?: string | null
    postingDisplayName?: string | null
  } | null
}

type RecognitionSpotlightMatch = BankImportAnalyzeResponse['netsuiteSweep']['matches'][number]
type ReadyJournalAccountDrafts = Record<string, string>

type ResizableColumnDefinition = {
  key: string
  label: string
  defaultWidth: number
  minWidth?: number
  className?: string
}

type ResizableColumnWidths = Record<string, number>

type ResizableTableController = {
  columnWidths: ResizableColumnWidths
  totalWidth: number
  beginResize: (columnKey: string, clientX: number, minWidth: number) => void
}

const NETSUITE_SWEEP_COLUMNS: ResizableColumnDefinition[] = [
  { key: 'transactionDate', label: 'Fecha banco', defaultWidth: 130 },
  { key: 'transactionType', label: 'Tipo', defaultWidth: 120 },
  { key: 'counterpartyName', label: 'Contraparte', defaultWidth: 260, minWidth: 160 },
  { key: 'amount', label: 'Monto', defaultWidth: 130 },
  { key: 'netsuiteTransactionDate', label: 'Fecha NetSuite', defaultWidth: 145 },
  { key: 'netsuiteDocument', label: 'Documento NetSuite', defaultWidth: 200, minWidth: 150 },
  { key: 'netsuiteEvidence', label: 'Evidencia NetSuite', defaultWidth: 320, minWidth: 180 },
  { key: 'matchSignal', label: 'Señal de match', defaultWidth: 240, minWidth: 170 },
  { key: 'confidence', label: 'Confianza', defaultWidth: 160, minWidth: 140 },
]

const READY_TO_POST_COLUMNS: ResizableColumnDefinition[] = [
  { key: 'transactionDate', label: 'Fecha', defaultWidth: 120 },
  { key: 'transactionType', label: 'Tipo', defaultWidth: 120 },
  { key: 'counterpartyName', label: 'Contraparte banco', defaultWidth: 250, minWidth: 170 },
  { key: 'mappingSheetName', label: 'Hoja equivalencia', defaultWidth: 170, minWidth: 140 },
  { key: 'netsuiteName', label: 'Entidad NetSuite', defaultWidth: 250, minWidth: 170 },
  { key: 'amount', label: 'Monto', defaultWidth: 130 },
  { key: 'debitAccount', label: 'Débito', defaultWidth: 230, minWidth: 170 },
  { key: 'creditAccount', label: 'Crédito', defaultWidth: 230, minWidth: 170 },
  { key: 'mappedAccount', label: 'Cuenta homologada', defaultWidth: 340, minWidth: 240 },
  { key: 'paymentConcept', label: 'Concepto', defaultWidth: 240, minWidth: 170 },
  { key: 'externalId', label: 'ID externo', defaultWidth: 260, minWidth: 170 },
  { key: 'actions', label: 'Acciones', defaultWidth: 180, minWidth: 150 },
]

export function BancosPage() {
  const navigate = useNavigate()
  const { bankSlug } = useParams<{ bankSlug?: string }>()
  const initialBankViewState = useMemo(() => getInitialBankViewState(bankSlug), [])
  const [config, setConfig] = useState<BankImportConfigResponse | null>(null)
  const [selectedBankId, setSelectedBankId] = useState<BankImportBankId>(initialBankViewState.bankId)
  const [accountingPeriod, setAccountingPeriod] = useState(initialBankViewState.accountingPeriod)
  const [selectedFile, setSelectedFile] = useState<StoredBankUploadedFile | null>(null)
  const [uploadedFile, setUploadedFile] = useState<StoredBankUploadedFile | null>(initialBankViewState.uploadedFile)
  const [selectedHistoricalFile, setSelectedHistoricalFile] = useState<File | null>(null)
  const [selectedIndividualPaymentFiles, setSelectedIndividualPaymentFiles] = useState<File[]>([])
  const [isPreparingSelectedFile, setIsPreparingSelectedFile] = useState(false)
  const [bankFileInputVersion, setBankFileInputVersion] = useState(0)
  const [individualPaymentInputVersion, setIndividualPaymentInputVersion] = useState(0)
  const [result, setResult] = useState<BankImportAnalyzeResponse | null>(initialBankViewState.result)
  const [resultSource, setResultSource] = useState<BankResultSource>(initialBankViewState.result ? 'cached' : 'none')
  const [activeAnalysisMode, setActiveAnalysisMode] = useState<BankImportAnalysisMode>(initialBankViewState.analysisMode)
  const [analysisRunId, setAnalysisRunId] = useState<string | null>(initialBankViewState.analysisRunId)
  const [analysisRun, setAnalysisRun] = useState<BankImportAnalysisRunResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [correctionMessage, setCorrectionMessage] = useState<string | null>(null)
  const [transientCorrections, setTransientCorrections] = useState<BankImportTransientCorrection[]>(
    initialBankViewState.transientCorrections,
  )
  const [heldReadyCorrectionKeys, setHeldReadyCorrectionKeys] = useState<string[]>(
    initialBankViewState.heldReadyCorrectionKeys,
  )
  const [postedReadyJournalExternalIds, setPostedReadyJournalExternalIds] = useState<string[]>(
    initialBankViewState.postedReadyJournalExternalIds,
  )
  const [isLoadingConfig, setIsLoadingConfig] = useState(true)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isLoadingSample, setIsLoadingSample] = useState(false)
  const [activeCorrectionKey, setActiveCorrectionKey] = useState<string | null>(null)
  const [candidateQuery, setCandidateQuery] = useState('')
  const [candidateResults, setCandidateResults] = useState<BankImportSuggestedCandidate[]>([])
  const [candidateError, setCandidateError] = useState<string | null>(null)
  const [banxicoSuggestion, setBanxicoSuggestion] = useState<BanxicoCepTransferSummary | null>(null)
  const [banxicoSuggestionMessage, setBanxicoSuggestionMessage] = useState<string | null>(null)
  const [customCreditAccount, setCustomCreditAccount] = useState('')
  const [isSearchingCandidates, setIsSearchingCandidates] = useState(false)
  const [isLookingUpBanxicoSuggestion, setIsLookingUpBanxicoSuggestion] = useState(false)
  const [isSavingCorrection, setIsSavingCorrection] = useState(false)
  const [isPostingJournals, setIsPostingJournals] = useState(false)
  const [isUploadingHistorical, setIsUploadingHistorical] = useState(false)
  const [isUploadingIndividualPayments, setIsUploadingIndividualPayments] = useState(false)
  const [isHydratingBank, setIsHydratingBank] = useState(false)
  const [isRefreshingStoredAnalysis, setIsRefreshingStoredAnalysis] = useState(false)
  const [hasRestoredBankState, setHasRestoredBankState] = useState(false)
  const [postResult, setPostResult] = useState<BankImportPostJournalsResponse | null>(null)
  const [postError, setPostError] = useState<string | null>(null)
  const [validatedBalanceInput, setValidatedBalanceInput] = useState('')
  const [validatedBalanceMessage, setValidatedBalanceMessage] = useState<string | null>(null)
  const [validatedBalanceError, setValidatedBalanceError] = useState<string | null>(null)
  const [isSavingValidatedBalance, setIsSavingValidatedBalance] = useState(false)
  const [recognitionSpotlightMatches, setRecognitionSpotlightMatches] = useState<RecognitionSpotlightMatch[]>([])
  const [isRecognizedSectionCollapsed, setIsRecognizedSectionCollapsed] = useState(true)
  const [netsuiteAccountCatalog, setNetSuiteAccountCatalog] = useState<NetSuiteAccountCatalogResponse | null>(null)
  const [readyJournalAccountDrafts, setReadyJournalAccountDrafts] = useState<ReadyJournalAccountDrafts>({})
  const recognizedSectionRef = useRef<HTMLDivElement | null>(null)
  const analysisRequestTokenRef = useRef(0)
  const selectedBankFileReadTokenRef = useRef(0)
  const netsuiteSweepTable = useResizableTableColumns(`${selectedBankId}:netsuite-sweep`, NETSUITE_SWEEP_COLUMNS)
  const readyToPostTable = useResizableTableColumns(`${selectedBankId}:ready-to-post`, READY_TO_POST_COLUMNS)

  useEffect(() => {
    setIsLoadingConfig(true)

    fetchBankImportConfig()
      .then((response) => {
        setConfig(response)
      })
      .catch((reason: unknown) => {
        setError(extractError(reason, 'Unable to load bank import config.'))
      })
      .finally(() => {
        setIsLoadingConfig(false)
      })
  }, [])

  useEffect(() => {
    fetchNetSuiteAccountCatalog()
      .then((response) => {
        setNetSuiteAccountCatalog(response)
      })
      .catch(() => {
        setNetSuiteAccountCatalog(null)
      })
  }, [])

  useEffect(() => {
    setSelectedHistoricalFile(null)
    setSelectedIndividualPaymentFiles([])
    setIndividualPaymentInputVersion((currentVersion) => currentVersion + 1)
  }, [selectedBankId])

  useEffect(() => {
    setIsRecognizedSectionCollapsed(true)
  }, [selectedBankId])

  useEffect(() => {
    setReadyJournalAccountDrafts({})
  }, [result?.generatedAtUtc, selectedBankId])

  useEffect(() => {
    const validatedClosingBalance = result?.balanceValidation?.currentValidation?.validatedClosingBalance
    setValidatedBalanceInput(validatedClosingBalance !== undefined && validatedClosingBalance !== null ? String(validatedClosingBalance) : '')
    setValidatedBalanceMessage(null)
    setValidatedBalanceError(null)
  }, [result?.balanceValidation?.currentValidation?.validatedClosingBalance, result?.generatedAtUtc, selectedBankId])

  const selectedBank = useMemo<BankImportBank | null>(() => {
    return config?.banks.find((bank) => bank.id === selectedBankId) ?? null
  }, [config, selectedBankId])

  const selectedBankProfile = BANK_SOURCE_PROFILES[selectedBankId] ?? BANK_SOURCE_PROFILES[FALLBACK_BANK_ID]
  const availableAnalysisModes = getAvailableAnalysisModes(selectedBankId)
  const selectedBankLabel = selectedBank?.label ?? FALLBACK_BANK_LABEL
  const selectedBankAccountLabel = selectedBank?.debitAccount ?? DEFAULT_BANK_ACCOUNT_LABEL
  const selectedBankSampleAvailable = selectedBank?.sampleAnalysisAvailable ?? false
  const selectedBankSampleFileName = selectedBank?.sampleFileName ?? null
  const selectedBankHistoricalRegistryAvailable = selectedBank?.historicalRegistryAvailable ?? false
  const selectedBankHistoricalStatementCount = selectedBank?.historicalStatementCount ?? 0
  const selectedBankHistoricalReferenceCount = selectedBank?.historicalReferenceCount ?? 0
  const selectedBankHistoricalLastUpdatedAtUtc = selectedBank?.historicalLastUpdatedAtUtc ?? null
  const selectedBankIndividualPaymentFileCount = selectedBank?.individualPaymentFileCount ?? 0
  const selectedBankIndividualPaymentLastUpdatedAtUtc = selectedBank?.individualPaymentLastUpdatedAtUtc ?? null
  const isBackendAnalysisRunning = analysisRun?.status === 'running'
  const hasReusableUploadedFile = Boolean(selectedFile || uploadedFile)
  const currentAnalysisRunId = analysisRun?.analysisId ?? analysisRunId
  const canRefreshAnalysis = Boolean(result || uploadedFile || currentAnalysisRunId)
  const isPreparingAnalysis = isAnalyzing && analysisRun?.status !== 'running'
  const analysisDisplayMode = analysisRun?.mode ?? activeAnalysisMode
  const analysisDisplayModeLabel = getAnalysisModeLabel(analysisDisplayMode)
  const analysisSourceFileName =
    analysisRun?.sourceFileName ?? result?.sourceFileName ?? selectedFile?.fileName ?? uploadedFile?.fileName ?? null
  const analysisTimestampValue = analysisRun?.finishedAtUtc ?? result?.generatedAtUtc ?? analysisRun?.startedAtUtc ?? null
  const analysisTimestampLabel = analysisRun?.finishedAtUtc
    ? 'Terminado'
    : result?.generatedAtUtc
      ? 'Generado'
      : analysisRun?.startedAtUtc
        ? 'Iniciado'
        : 'Sin marca'
  const analysisViewSourceLabel = isRefreshingStoredAnalysis
    ? 'Validando en backend'
    : isPreparingAnalysis
      ? 'Iniciando en backend'
    : analysisRun?.status === 'running'
      ? 'Resguardado en backend'
      : resultSource === 'backend'
        ? 'Verificado en backend'
        : resultSource === 'cached'
          ? 'Vista local sin verificar'
          : 'Sin resultado cargado'
  const analysisBannerLabel = isRefreshingStoredAnalysis
    ? 'Validando corrida'
    : isPreparingAnalysis
      ? 'Iniciando analisis'
    : analysisRun?.status === 'running'
      ? 'Analisis en curso'
      : analysisRun?.status === 'completed'
        ? 'Analisis terminado'
        : analysisRun?.status === 'failed'
          ? 'Analisis fallido'
          : resultSource === 'cached'
            ? 'Vista local recuperada'
            : result
              ? 'Resultado cargado'
              : 'Sin analisis'
  const analysisBannerClassName = isRefreshingStoredAnalysis || isPreparingAnalysis || analysisRun?.status === 'running'
    ? 'status-pill status-pill--healthy'
    : analysisRun?.status === 'completed'
      ? 'status-pill status-pill--ready'
      : analysisRun?.status === 'failed'
        ? 'status-pill status-pill--exception'
        : resultSource === 'cached'
            ? 'status-pill status-pill--review'
          : result
            ? 'status-pill status-pill--healthy'
            : 'status-pill status-pill--idle'
  const analysisBannerDescription = isRefreshingStoredAnalysis
    ? 'Validando en backend la corrida exacta de este archivo antes de mostrarla como definitiva.'
    : isPreparingAnalysis
      ? 'Enviando el archivo y preparando la corrida en backend. En cuanto exista el identificador, quedara visible aqui.'
    : analysisRun?.status === 'running'
      ? 'La corrida actual sigue ejecutandose en backend. Puedes refrescar la pagina: al volver se recuperara por archivo, periodo, correcciones y modo.'
      : analysisRun?.status === 'completed'
        ? resultSource === 'backend'
          ? 'La vista actual ya fue confirmada por backend y corresponde exactamente al analisis terminado.'
          : 'La corrida termino en backend, pero la vista visible aun no esta verificada.'
        : analysisRun?.status === 'failed'
          ? `El backend no pudo terminar esta corrida: ${analysisRun.error ?? 'sin detalle adicional'}.`
          : resultSource === 'cached'
            ? 'Mostrando la ultima vista guardada en este navegador porque backend no pudo confirmarla en este momento.'
          : result
              ? 'Mostrando un resultado cargado desde backend.'
              : 'Todavia no hay un analisis cargado para esta vista.'
  const shouldShowAnalysisBanner =
    isRefreshingStoredAnalysis ||
    isAnalyzing ||
    Boolean(analysisRun) ||
    Boolean(currentAnalysisRunId) ||
    Boolean(result) ||
    Boolean(uploadedFile) ||
    Boolean(selectedFile)
  const isBankSelectionDisabled =
    isLoadingConfig ||
    isAnalyzing ||
    isPreparingSelectedFile ||
    isBackendAnalysisRunning ||
    isLoadingSample ||
    isSavingCorrection ||
    isPostingJournals ||
    isUploadingHistorical ||
    isUploadingIndividualPayments ||
    isHydratingBank
  const recognitionSpotlightKeySet = useMemo(
    () => new Set(recognitionSpotlightMatches.map((item) => getRecognizedMovementKey(item))),
    [recognitionSpotlightMatches],
  )
  const recognitionSpotlightTotalAmount = useMemo(
    () => recognitionSpotlightMatches.reduce((total, item) => total + item.amount, 0),
    [recognitionSpotlightMatches],
  )
  const netsuiteSweepRows = result?.netsuiteSweep.periodRows ?? result?.netsuiteSweep.matches ?? []
  const netsuiteSweepExcludedCount = result?.netsuiteSweep.recognizedRows ?? result?.netsuiteSweep.matches.length ?? 0
  const excludedTypeMovements = result?.excludedTypeMovements ?? []
  const balanceValidation = result?.balanceValidation ?? null
  const netsuiteSweepPeriodLabel =
    result?.netsuiteSweep.periodStart && result?.netsuiteSweep.periodEnd
      ? `${result.netsuiteSweep.periodStart} al ${result.netsuiteSweep.periodEnd}`
      : null
  const selectedAccountingPeriodValue = resolveAccountingPeriodValue(
    accountingPeriod,
    config?.defaultAccountingPeriod ?? null,
  )
  const selectedAccountingPeriodLabel = formatAccountingPeriodLabel(selectedAccountingPeriodValue)
  const resultAccountingPeriodValue = resolveAccountingPeriodValue(
    result?.accountingPeriod ?? null,
    result?.cutoffDate ?? null,
  )
  const resultAccountingPeriodLabel = formatAccountingPeriodLabel(resultAccountingPeriodValue)
  const analysisAccountingPeriodValue = resolveAccountingPeriodValue(
    analysisRun?.accountingPeriod ?? null,
    resultAccountingPeriodValue || selectedAccountingPeriodValue,
  )
  const analysisAccountingPeriodLabel = formatAccountingPeriodLabel(analysisAccountingPeriodValue)

  const pendingByTransactionTypeTotals = useMemo(() => {
    if (!result) {
      return {
        count: 0,
        amount: 0,
      }
    }

    return result.transactionTypes.reduce(
      (accumulator, item) => {
        accumulator.count += item.count
        accumulator.amount += item.amount
        return accumulator
      },
      {
        count: 0,
        amount: 0,
      },
    )
  }, [result])

  const activeCorrectionTarget = useMemo<CorrectionEditorTarget | null>(() => {
    if (!result || !activeCorrectionKey) {
      return null
    }

    const unmatchedRow = result.unmatched.find((item) => item.correctionKey === activeCorrectionKey)
    if (unmatchedRow) {
      return buildCorrectionEditorTargetFromUnmatchedRow(unmatchedRow)
    }

    const journal = result.journals.find(
      (item) => getJournalCorrectionKey(item, selectedBankId, config) === activeCorrectionKey,
    )
    return journal ? buildCorrectionEditorTargetFromJournal(journal, selectedBankId, config) : null
  }, [activeCorrectionKey, config, result, selectedBankId])

  const heldReadyJournalKeySet = useMemo(() => new Set(heldReadyCorrectionKeys), [heldReadyCorrectionKeys])
  const postedReadyJournalExternalIdSet = useMemo(
    () => new Set(postedReadyJournalExternalIds),
    [postedReadyJournalExternalIds],
  )

  const visibleReadyJournals = useMemo(() => {
    return (
      result?.journals.filter(
        (item) =>
          !heldReadyJournalKeySet.has(getJournalCorrectionKey(item, selectedBankId, config)) &&
          !postedReadyJournalExternalIdSet.has(item.externalId),
      ) ?? []
    )
  }, [config, heldReadyJournalKeySet, postedReadyJournalExternalIdSet, result, selectedBankId])

  const heldReadyJournals = useMemo(() => {
    return (
      result?.journals.filter(
        (item) =>
          heldReadyJournalKeySet.has(getJournalCorrectionKey(item, selectedBankId, config)) &&
          !postedReadyJournalExternalIdSet.has(item.externalId),
      ) ?? []
    )
  }, [config, heldReadyJournalKeySet, postedReadyJournalExternalIdSet, result, selectedBankId])

  const visibleReadyExportRows = useMemo(() => {
    if (!result) {
      return []
    }

    const visibleExternalIds = new Set(visibleReadyJournals.map((item) => item.externalId))
    return result.exportRows.filter((item) => visibleExternalIds.has(item.externalId))
  }, [result, visibleReadyJournals])

  useEffect(() => {
    if (!activeCorrectionKey) {
      return
    }

    if (!activeCorrectionTarget) {
      resetCorrectionUi()
    }
  }, [activeCorrectionKey, activeCorrectionTarget])

  useEffect(() => {
    return () => {
      analysisRequestTokenRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (!result || heldReadyCorrectionKeys.length === 0) {
      return
    }

    const availableKeys = new Set(result.journals.map((item) => getJournalCorrectionKey(item, selectedBankId, config)))
    const nextHeldKeys = heldReadyCorrectionKeys.filter((item) => availableKeys.has(item))
    if (areStringArraysEqual(heldReadyCorrectionKeys, nextHeldKeys)) {
      return
    }

    setHeldReadyCorrectionKeys(nextHeldKeys)
  }, [config, heldReadyCorrectionKeys, result, selectedBankId])

  useEffect(() => {
    if (!result || postedReadyJournalExternalIds.length === 0) {
      return
    }

    const availableExternalIds = new Set(result.journals.map((item) => item.externalId))
    const nextPostedExternalIds = postedReadyJournalExternalIds.filter((item) => availableExternalIds.has(item))
    if (areStringArraysEqual(postedReadyJournalExternalIds, nextPostedExternalIds)) {
      return
    }

    setPostedReadyJournalExternalIds(nextPostedExternalIds)
  }, [postedReadyJournalExternalIds, result])

  useEffect(() => {
    if (!config) {
      return
    }

    const nextBankId = resolveBankIdFromRoute(bankSlug, config.banks)
    const nextBankSlug = getBankRouteSegment(nextBankId)
    const nextBank = config.banks.find((bank) => bank.id === nextBankId) ?? null

    if (bankSlug !== nextBankSlug) {
      navigate(`/bancos/${nextBankSlug}`, { replace: true })
      return
    }

    let isCancelled = false
    const cachedState = readStoredBankViewState(nextBankId)
    const nextAccountingPeriod = resolveAccountingPeriodValue(
      cachedState?.accountingPeriod ?? null,
      cachedState?.cutoffDate ?? config.defaultAccountingPeriod,
    )

    setHasRestoredBankState(false)
    setIsHydratingBank(true)
    setIsRefreshingStoredAnalysis(false)
    setSelectedBankId(nextBankId)
    setAccountingPeriod(nextAccountingPeriod)
    setSelectedFile(null)
    setIsPreparingSelectedFile(false)
    setBankFileInputVersion(0)
    selectedBankFileReadTokenRef.current += 1
    setUploadedFile(cachedState?.uploadedFile ?? null)
    setActiveAnalysisMode(resolveAnalysisModeForBank(nextBankId, cachedState?.analysisMode))
    setError(null)
    setCorrectionMessage(null)
    setPostResult(null)
    setRecognitionSpotlightMatches([])
    clearDisplayedResult()
    setAnalysisRun(null)
    setAnalysisRunId(null)
    resetCorrectionUi()
    setTransientCorrections(cachedState?.transientCorrections ?? [])
    setHeldReadyCorrectionKeys(cachedState?.heldReadyCorrectionKeys ?? [])
    setPostedReadyJournalExternalIds(cachedState?.postedReadyJournalExternalIds ?? [])

    if (cachedState?.uploadedFile || cachedState?.analysisRunId) {
      clearDisplayedResult()
    } else if (cachedState?.result) {
      applyCachedResult(cachedState.result)
    } else {
      clearDisplayedResult()
    }

    if (cachedState?.uploadedFile) {
      setIsLoadingSample(false)
      setIsRefreshingStoredAnalysis(true)
      const requestToken = beginAnalysisRequestTracking()

      recoverStoredAnalysisRun({
        bankId: nextBankId,
        accountingPeriod: nextAccountingPeriod,
        uploadedFile: cachedState.uploadedFile,
        transientCorrections: cachedState?.transientCorrections ?? [],
        analysisMode: resolveAnalysisModeForBank(nextBankId, cachedState.analysisMode),
        forceRefresh: true,
        requestToken,
      })
        .then((refreshed) => {
          if (isCancelled || !isCurrentAnalysisRequest(requestToken)) {
            return
          }

          applyBackendResult(refreshed)
          setError(null)
        })
        .catch((reason: unknown) => {
          if (isCancelled || isBankAnalysisAbortError(reason)) {
            return
          }

          const nextError = extractError(
            reason,
            cachedState?.result
              ? 'No fue posible verificar en backend el analisis recuperado; se mantiene la ultima vista guardada.'
              : 'Unable to analyze recovered bank file.',
          )
          setError(nextError)
          if (cachedState?.result) {
            applyCachedResult(cachedState.result)
          } else {
            clearDisplayedResult()
          }
        })
        .finally(() => {
          if (isCancelled) {
            return
          }

          setIsRefreshingStoredAnalysis(false)
          setIsHydratingBank(false)
          setHasRestoredBankState(true)
        })

      return () => {
        isCancelled = true
      }
    }

    if (cachedState?.analysisRunId) {
      setIsLoadingSample(false)
      setIsRefreshingStoredAnalysis(true)
      const requestToken = beginAnalysisRequestTracking()

      loadCurrentAnalysis({
        bankId: nextBankId,
        accountingPeriod: nextAccountingPeriod,
        file: null,
        uploadedFile: null,
        transientCorrections: cachedState?.transientCorrections ?? [],
        analysisMode: resolveAnalysisModeForBank(nextBankId, cachedState.analysisMode),
        forceRefresh: true,
        requestToken,
      })
        .then((refreshed) => {
          if (isCancelled || !isCurrentAnalysisRequest(requestToken)) {
            return
          }

          applyBackendResult(refreshed)
          setError(null)
        })
        .catch((reason: unknown) => {
          if (isCancelled || isBankAnalysisAbortError(reason)) {
            return
          }

          const nextError = extractError(
            reason,
            cachedState?.result
              ? 'No fue posible validar en backend la corrida guardada; se mantiene la ultima vista local.'
              : 'Unable to recover stored bank analysis.',
          )
          setError(nextError)
          if (cachedState?.result) {
            applyCachedResult(cachedState.result)
          } else {
            clearDisplayedResult()
          }
        })
        .finally(() => {
          if (isCancelled) {
            return
          }

          setIsRefreshingStoredAnalysis(false)
          setIsHydratingBank(false)
          setHasRestoredBankState(true)
        })

      return () => {
        isCancelled = true
      }
    }

    setIsLoadingSample(false)
    setIsRefreshingStoredAnalysis(true)
    const requestToken = beginAnalysisRequestTracking()

    loadCurrentAnalysis({
      bankId: nextBankId,
      accountingPeriod: nextAccountingPeriod,
      file: null,
      uploadedFile: null,
      transientCorrections: cachedState?.transientCorrections ?? [],
      analysisMode: resolveAnalysisModeForBank(nextBankId, cachedState?.analysisMode),
      requestToken,
    })
      .then((loadedResult) => {
        if (isCancelled || !isCurrentAnalysisRequest(requestToken)) {
          return
        }

        applyBackendResult(loadedResult)
        setError(null)
      })
      .catch((reason: unknown) => {
        if (isCancelled || isBankAnalysisAbortError(reason)) {
          return
        }

        const nextError = extractError(
          reason,
          nextBank?.sampleAnalysisAvailable
            ? 'Unable to load sample analysis.'
            : 'No hay un archivo bancario resguardado para este banco todavia.',
        )
        setError(
          cachedState?.result
            ? `No fue posible validar en backend la ultima vista guardada. Se mantiene la vista local mientras revisamos el backend. Detalle: ${nextError}`
            : nextError,
        )
        if (cachedState?.result) {
          applyCachedResult(cachedState.result)
        } else {
          clearDisplayedResult()
        }
      })
      .finally(() => {
        if (isCancelled) {
          return
        }

        setIsRefreshingStoredAnalysis(false)
        setIsHydratingBank(false)
        setHasRestoredBankState(true)
      })

    return () => {
      isCancelled = true
    }
  }, [bankSlug, config, navigate])

  useEffect(() => {
    if (!result) {
      setRecognitionSpotlightMatches([])
      return
    }

    const availableKeys = new Set(result.netsuiteSweep.matches.map((item) => getRecognizedMovementKey(item)))
    setRecognitionSpotlightMatches((currentItems) => {
      const nextItems = currentItems.filter((item) => availableKeys.has(getRecognizedMovementKey(item)))
      return areRecognizedMovementListsEqual(currentItems, nextItems) ? currentItems : nextItems
    })
  }, [result])

  useEffect(() => {
    if (isLoadingConfig || isHydratingBank || !hasRestoredBankState) {
      return
    }

    writeStoredBankViewState(selectedBankId, {
      accountingPeriod,
      result,
      transientCorrections,
      heldReadyCorrectionKeys,
      postedReadyJournalExternalIds,
      uploadedFile,
      analysisRunId: currentAnalysisRunId,
      analysisMode: activeAnalysisMode,
    })
  }, [
    activeAnalysisMode,
    accountingPeriod,
    currentAnalysisRunId,
    hasRestoredBankState,
    heldReadyCorrectionKeys,
    postedReadyJournalExternalIds,
    isHydratingBank,
    isLoadingConfig,
    result,
    selectedBankId,
    transientCorrections,
    uploadedFile,
  ])

  function applyBackendResult(nextResult: BankImportAnalyzeResponse) {
    clearAbortErrorIfPresent()
    setResult(normalizeBankImportAnalyzeResponse(nextResult))
    setResultSource('backend')
  }

  function applyOptimisticProcessedJournals(processedExternalIds: string[]) {
    if (processedExternalIds.length === 0) {
      return
    }

    const processedExternalIdSet = new Set(processedExternalIds.map((item) => String(item ?? '').trim()).filter(Boolean))
    setResult((currentResult) => {
      if (!currentResult) {
        return currentResult
      }

      const nextJournals = currentResult.journals.filter((item) => !processedExternalIdSet.has(item.externalId))
      const nextExportRows = currentResult.exportRows.filter((item) => !processedExternalIdSet.has(item.externalId))
      const nextUnmatched = currentResult.unmatched.filter(
        (item) => !processedExternalIdSet.has(extractExternalIdFromCorrectionKey(item.correctionKey)),
      )

      if (
        nextJournals.length === currentResult.journals.length &&
        nextExportRows.length === currentResult.exportRows.length &&
        nextUnmatched.length === currentResult.unmatched.length
      ) {
        return currentResult
      }

      return {
        ...currentResult,
        journals: nextJournals,
        exportRows: nextExportRows,
        unmatched: nextUnmatched,
        summary: {
          ...currentResult.summary,
          readyRows: nextJournals.length,
          unmatchedRows: nextUnmatched.length,
          readyAmount: roundCurrency(nextJournals.reduce((total, item) => total + item.amount, 0)),
          unmatchedAmount: roundCurrency(nextUnmatched.reduce((total, item) => total + item.amount, 0)),
        },
      }
    })
  }

  function applyCachedResult(nextResult: BankImportAnalyzeResponse) {
    clearAbortErrorIfPresent()
    setResult(normalizeBankImportAnalyzeResponse(nextResult))
    setResultSource('cached')
  }

  function clearDisplayedResult() {
    setResult(null)
    setResultSource('none')
  }

  function applyAnalysisRunSnapshot(run: BankImportAnalysisRunResponse, fallbackMode: BankImportAnalysisMode) {
    if (run.status !== 'failed') {
      clearAbortErrorIfPresent()
    }
    setAnalysisRunId(run.analysisId)
    setAnalysisRun(run)
    setActiveAnalysisMode(run.mode ?? fallbackMode)
  }

  function clearAbortErrorIfPresent() {
    setError((currentError) => (currentError === BANK_ANALYSIS_ABORT_ERROR ? null : currentError))
  }

  async function loadCurrentAnalysis(options?: {
    bankId?: BankImportBankId
    accountingPeriod?: string
    file?: StoredBankUploadedFile | null
    uploadedFile?: StoredBankUploadedFile | null
    transientCorrections?: BankImportTransientCorrection[]
    analysisMode?: BankImportAnalysisMode
    forceRefresh?: boolean
    requestToken?: number
  }) {
    const bankId = options?.bankId ?? selectedBankId
    const nextAccountingPeriod = resolveAccountingPeriodValue(
      options?.accountingPeriod,
      accountingPeriod,
    )
    const file = options && 'file' in options ? options.file ?? null : selectedFile
    const restoredUploadedFile = options && 'uploadedFile' in options ? options.uploadedFile ?? null : uploadedFile
    const activeTransientCorrections = options?.transientCorrections ?? transientCorrections
    const nextAnalysisMode = resolveAnalysisModeForBank(bankId, options?.analysisMode ?? activeAnalysisMode)
    const requestToken = options?.requestToken ?? beginAnalysisRequestTracking()
    const canUseSampleAnalysis = config?.banks.some((bank) => bank.id === bankId && bank.sampleAnalysisAvailable) ?? false

    if (file) {
      const nextUploadedFile = {
        fileName: file.fileName,
        fileBase64: file.fileBase64,
      }
      if (!isCurrentAnalysisRequest(requestToken)) {
        throw new Error(BANK_ANALYSIS_ABORT_ERROR)
      }

      setUploadedFile(nextUploadedFile)
      setActiveAnalysisMode(nextAnalysisMode)

      const startedRun = await startBankImportAnalysis({
        bankId,
        accountingPeriod: nextAccountingPeriod,
        fileName: file.fileName,
        fileBase64: file.fileBase64,
        transientCorrections: activeTransientCorrections,
        mode: nextAnalysisMode,
      })

      if (!isCurrentAnalysisRequest(requestToken)) {
        throw new Error(BANK_ANALYSIS_ABORT_ERROR)
      }

      applyAnalysisRunSnapshot(startedRun, nextAnalysisMode)

      const settledRun = await pollAnalysisRunUntilSettled(startedRun.analysisId, requestToken)
      return settledRun.result as BankImportAnalyzeResponse
    }

    if (restoredUploadedFile) {
      return recoverStoredAnalysisRun({
        bankId,
        accountingPeriod: nextAccountingPeriod,
        uploadedFile: restoredUploadedFile,
        transientCorrections: activeTransientCorrections,
        analysisMode: nextAnalysisMode,
        forceRefresh: Boolean(options?.forceRefresh),
        requestToken,
      })
    }

    try {
      return await recoverStoredAnalysisRun({
        bankId,
        accountingPeriod: nextAccountingPeriod,
        transientCorrections: activeTransientCorrections,
        analysisMode: nextAnalysisMode,
        forceRefresh: Boolean(options?.forceRefresh),
        requestToken,
      })
    } catch (reason: unknown) {
      if (!isStoredWorkingFileNotAvailableError(reason)) {
        throw reason
      }

      if (!canUseSampleAnalysis) {
        throw reason
      }
    }

    setActiveAnalysisMode('standard')
    setAnalysisRunId(null)
    setAnalysisRun(null)

    if (activeTransientCorrections.length > 0) {
      return analyzeBankImportSample({
        bankId,
        accountingPeriod: nextAccountingPeriod,
        transientCorrections: activeTransientCorrections,
      })
    }

    return fetchBankImportSample(bankId, nextAccountingPeriod)
  }

  async function recoverStoredAnalysisRun(options: {
    bankId: BankImportBankId
    accountingPeriod: string
    uploadedFile?: StoredBankUploadedFile | null
    transientCorrections: BankImportTransientCorrection[]
    analysisMode: BankImportAnalysisMode
    forceRefresh: boolean
    requestToken: number
  }) {
    const storedRun = await recoverBankImportAnalysis({
      bankId: options.bankId,
      accountingPeriod: options.accountingPeriod,
      transientCorrections: options.transientCorrections,
      mode: options.analysisMode,
      forceRefresh: options.forceRefresh,
      ...(options.uploadedFile
        ? {
            fileName: options.uploadedFile.fileName,
            fileBase64: options.uploadedFile.fileBase64,
          }
        : {}),
    })
    if (!isCurrentAnalysisRequest(options.requestToken)) {
      throw new Error(BANK_ANALYSIS_ABORT_ERROR)
    }

    applyAnalysisRunSnapshot(storedRun, options.analysisMode)

    if (storedRun.status === 'completed') {
      if (!storedRun.result) {
        throw new Error('La corrida recuperada termino sin devolver resultado.')
      }
      return storedRun.result
    }

    if (storedRun.status === 'failed') {
      throw new Error(storedRun.error ?? 'La corrida recuperada fallo en backend.')
    }

    const settledRun = await pollAnalysisRunUntilSettled(storedRun.analysisId, options.requestToken)
    return settledRun.result as BankImportAnalyzeResponse
  }

  async function loadStoredAnalysisRun(options: {
    analysisId: string
    fallbackMode: BankImportAnalysisMode
    requestToken: number
  }) {
    const storedRun = await fetchBankImportAnalysisRun(options.analysisId)
    if (!isCurrentAnalysisRequest(options.requestToken)) {
      throw new Error(BANK_ANALYSIS_ABORT_ERROR)
    }

    applyAnalysisRunSnapshot(storedRun, options.fallbackMode)

    if (storedRun.status === 'completed') {
      if (!storedRun.result) {
        throw new Error('La corrida recuperada terminó sin devolver resultado.')
      }
      return storedRun.result
    }

    if (storedRun.status === 'failed') {
      throw new Error(storedRun.error ?? 'La corrida recuperada falló en backend.')
    }

    const settledRun = await pollAnalysisRunUntilSettled(storedRun.analysisId, options.requestToken)
    return settledRun.result as BankImportAnalyzeResponse
  }

  async function pollAnalysisRunUntilSettled(analysisId: string, requestToken: number) {
    const startedAt = Date.now()

    while (isCurrentAnalysisRequest(requestToken)) {
      const currentRun = await fetchBankImportAnalysisRun(analysisId)
      if (!isCurrentAnalysisRequest(requestToken)) {
        throw new Error(BANK_ANALYSIS_ABORT_ERROR)
      }

      applyAnalysisRunSnapshot(currentRun, currentRun.mode)

      if (currentRun.status === 'completed') {
        if (!currentRun.result) {
          throw new Error('El backend terminó la corrida pero no devolvió resultado.')
        }
        return currentRun
      }

      if (currentRun.status === 'failed') {
        throw new Error(currentRun.error ?? 'El análisis bancario falló en backend.')
      }

      if (Date.now() - startedAt >= BANK_ANALYSIS_MAX_WAIT_MS) {
        throw new Error(
          'La corrida sigue ejecutandose en backend despues de 3 minutos. Usa Refresh para reconstruir la conciliacion cuando termine.',
        )
      }

      await waitFor(BANK_ANALYSIS_POLL_INTERVAL_MS)
    }

    throw new Error(BANK_ANALYSIS_ABORT_ERROR)
  }

  function beginAnalysisRequestTracking() {
    analysisRequestTokenRef.current += 1
    return analysisRequestTokenRef.current
  }

  function isCurrentAnalysisRequest(requestToken: number) {
    return analysisRequestTokenRef.current === requestToken
  }

  function resetCorrectionUi() {
    setActiveCorrectionKey(null)
    setCandidateQuery('')
    setCandidateResults([])
    setCandidateError(null)
    setBanxicoSuggestion(null)
    setBanxicoSuggestionMessage(null)
    setCustomCreditAccount('')
  }

  async function handleSearchCandidates(row: CorrectionEditorTarget, initialQuery?: string) {
    const query = (initialQuery ?? candidateQuery).trim()
    if (!query) {
      setCandidateError('Escribe un texto para buscar equivalencias.')
      return
    }

    setIsSearchingCandidates(true)
    setCandidateError(null)

    try {
      const response = await searchBankImportCandidates(
        selectedBankId,
        row.transactionType,
        query,
        row.rfc,
        row.correctionKey,
        row.trackingKey,
        row.referenceNumber,
      )
      setCandidateResults(mergeCandidates(row.suggestedCandidate ? [row.suggestedCandidate] : [], response.candidates))
    } catch (reason: unknown) {
      setCandidateError(extractError(reason, 'Unable to search correction candidates.'))
    } finally {
      setIsSearchingCandidates(false)
    }
  }

  function resolveCorrectionPayloadCounterpartyName(
    row: CorrectionEditorTarget,
    preferredOrderingName?: string | null,
  ) {
    return (
      cleanText(preferredOrderingName) ||
      cleanText(row.orderingPartyName) ||
      getDisplayCounterpartyName(row) ||
      cleanText(row.statementCounterpartyName) ||
      cleanText(row.paymentConcept) ||
      cleanText(row.suggestedCandidate?.bankName) ||
      cleanText(row.suggestedCandidate?.netsuiteName) ||
      ''
    )
  }

  function getEffectiveCounterpartyName(row: CorrectionEditorTarget) {
    return resolveCorrectionPayloadCounterpartyName(row, banxicoSuggestion?.orderingParty?.name ?? null)
  }

  async function handleLookupBanxicoSuggestion(row: CorrectionEditorTarget) {
    if (!canLookupBanxicoSuggestion(selectedBankId, row)) {
      setBanxicoSuggestion(null)
      setBanxicoSuggestionMessage('Este movimiento no trae datos suficientes para consultar Banxico CEP.')
      return
    }

    setIsLookingUpBanxicoSuggestion(true)
    setCandidateError(null)
    setBanxicoSuggestion(null)
    setBanxicoSuggestionMessage(null)

    try {
      const operationDate = cleanText(row.transactionDate)
      if (!operationDate) {
        throw new Error('El movimiento no trae una fecha valida para consultar Banxico.')
      }

      const catalog = await fetchBanxicoCepInstitutions(operationDate)
      const issuerId = resolveBanxicoInstitutionIdByName(catalog, row.originBankName)
      const receiverId = resolveBanxicoInstitutionIdByName(catalog, row.destinationBankName)
      if (!issuerId || !receiverId) {
        throw new Error('No fue posible mapear los bancos del movimiento al catalogo Banxico.')
      }

      const amount = typeof row.amount === 'number' ? row.amount.toFixed(2) : null
      const attempts: Array<{ searchType: 'trackingKey' | 'referenceNumber'; criteria: string }> = []
      if (cleanText(row.trackingKey)) {
        attempts.push({
          searchType: 'trackingKey',
          criteria: cleanText(row.trackingKey),
        })
      }
      if (cleanText(row.referenceNumber) && cleanText(row.referenceNumber) !== cleanText(row.trackingKey)) {
        attempts.push({
          searchType: 'referenceNumber',
          criteria: cleanText(row.referenceNumber),
        })
      }

      let details: BanxicoCepTransferSummary | null = null
      let lastLookupError: unknown = null
      for (const attempt of attempts) {
        try {
          details = await fetchBanxicoCepDetails({
            bankId: selectedBankId,
            sourceProfileId: resolveBankSourceProfileId(selectedBankId),
            operationDate,
            searchType: attempt.searchType,
            criteria: attempt.criteria,
            issuerId,
            receiverId,
            mode: 'cep',
            beneficiaryAccount: row.destinationAccount,
            amount,
            beneficiaryIsParticipant: false,
          })
        } catch (reason: unknown) {
          lastLookupError = reason
          details = null
        }

        if (details) {
          break
        }
      }

      if (!details) {
        if (lastLookupError) {
          throw lastLookupError
        }
        setBanxicoSuggestionMessage('Banxico no devolvió detalles suficientes para este movimiento.')
        return
      }

      setBanxicoSuggestion(details)
      const orderingName = cleanText(details.orderingParty?.name)
      if (isUsefulBanxicoOrderingName(orderingName, details.beneficiary?.name ?? null)) {
        setBanxicoSuggestionMessage(`Banxico identifico como ordenante a ${orderingName}.`)
        setCandidateQuery(orderingName)
        await handleSearchCandidates(row, orderingName)
        return
      }

      setBanxicoSuggestionMessage('Banxico encontro el CEP, pero el ordenante no aporta un nombre util para homologar.')
    } catch (reason: unknown) {
      setBanxicoSuggestion(null)
      setBanxicoSuggestionMessage(extractError(reason, 'No fue posible consultar el ordenante en Banxico CEP.'))
    } finally {
      setIsLookingUpBanxicoSuggestion(false)
    }
  }

  async function openCorrectionEditor(row: CorrectionEditorTarget) {
    const initialQuery =
      getDisplayCounterpartyName(row) ||
      cleanText(row.orderingPartyName) ||
      cleanText(row.statementCounterpartyName) ||
      cleanText(row.suggestedCandidate?.netsuiteName) ||
      cleanText(row.suggestedCandidate?.bankName) ||
      cleanText(row.paymentConcept)
    setActiveCorrectionKey(row.correctionKey)
    setCandidateQuery(initialQuery)
    setCandidateResults(row.suggestedCandidate ? [row.suggestedCandidate] : [])
    setCandidateError(null)
    setBanxicoSuggestion(null)
    setBanxicoSuggestionMessage(null)
    setCorrectionMessage(null)
    setCustomCreditAccount(resolveInitialCreditAccountForTarget(row))
    await handleSearchCandidates(row, initialQuery)
  }

  async function applyTransientCorrection(
    row: CorrectionEditorTarget,
    candidate: BankImportSuggestedCandidate,
    counterpartyNameOverride?: string,
    customAccountOverride = customCreditAccount,
  ) {
    setIsSavingCorrection(true)
    setError(null)
    setCandidateError(null)
    setCorrectionMessage(null)
    setPostResult(null)

    try {
      const selectedCandidate = buildEditableCandidate(candidate, customAccountOverride)
      const nextTransientCorrections = upsertTransientCorrection(
        transientCorrections,
        buildTransientCorrection(row, selectedCandidate, counterpartyNameOverride),
      )
      const refreshed = await loadCurrentAnalysis({
        transientCorrections: nextTransientCorrections,
      })

      setTransientCorrections(nextTransientCorrections)
      applyBackendResult(refreshed)
      updateRecognitionSpotlight(refreshed, row)
      setCorrectionMessage(
        `Correccion unica aplicada para ${getCorrectionTargetLabel({
          counterpartyName: counterpartyNameOverride ?? row.counterpartyName,
          paymentConcept: row.paymentConcept,
        })}. Solo se usara en este movimiento dentro del analisis actual.`,
      )
      resetCorrectionUi()
    } catch (reason: unknown) {
      if (isBankAnalysisAbortError(reason)) {
        return
      }
      const nextError = extractError(reason, 'Unable to apply single-use correction.')
      setCandidateError(nextError)
      setError(nextError)
    } finally {
      setIsSavingCorrection(false)
    }
  }

  async function saveCorrection(
    row: CorrectionEditorTarget,
    candidate: BankImportSuggestedCandidate,
    counterpartyNameOverride?: string,
    customAccountOverride = customCreditAccount,
  ) {
    setIsSavingCorrection(true)
    setError(null)
    setCandidateError(null)
    setCorrectionMessage(null)
    setPostResult(null)

    try {
      const selectedCandidate = buildEditableCandidate(candidate, customAccountOverride)
      const saved = await saveBankImportCorrection({
        bankId: selectedBankId,
        correctionKey: row.correctionKey,
        transactionType: row.transactionType,
        counterpartyName: counterpartyNameOverride ?? row.counterpartyName,
        sourceFileName: result?.sourceFileName ?? null,
        transactionDate: row.transactionDate,
        processingTimestamp: row.processingTimestamp,
        amount: row.amount,
        paymentConcept: row.paymentConcept,
        trackingKey: row.trackingKey,
        hashId: row.hashId,
        selectedCandidate: {
          mappingSheetKey: selectedCandidate.mappingSheetKey,
          candidateSource: selectedCandidate.candidateSource,
          bankName: selectedCandidate.bankName,
          netsuiteName: selectedCandidate.netsuiteName,
          creditAccount: selectedCandidate.creditAccount,
          entityInternalId: selectedCandidate.entityInternalId ?? null,
          postingDisplayName: selectedCandidate.postingDisplayName ?? null,
        },
      })

      const nextTransientCorrections = removeTransientCorrection(transientCorrections, row.correctionKey)
      setConfig(await fetchBankImportConfig())
      const refreshed = await loadCurrentAnalysis({
        transientCorrections: nextTransientCorrections,
        forceRefresh: true,
      })
      setTransientCorrections(nextTransientCorrections)
      applyBackendResult(refreshed)
      updateRecognitionSpotlight(refreshed, row)
      setCorrectionMessage(
        `Correccion guardada para ${getCorrectionTargetLabel({
          counterpartyName: saved.counterpartyName,
          paymentConcept: row.paymentConcept,
        })}. En adelante se asociara con ${saved.netsuiteName}.`,
      )
      resetCorrectionUi()
    } catch (reason: unknown) {
      if (isBankAnalysisAbortError(reason)) {
        return
      }
      const nextError = extractError(reason, 'Unable to save correction.')
      setCandidateError(nextError)
      setError(nextError)
    } finally {
      setIsSavingCorrection(false)
    }
  }

  async function applyCurrentMatchCorrection(row: CorrectionEditorTarget) {
    const selectedCandidate = buildCurrentMatchCandidate(row, config, customCreditAccount)
    if (!selectedCandidate) {
      setCandidateError('No se pudo preparar la homologacion actual para editar la cuenta.')
      return
    }

    await applyTransientCorrection(row, selectedCandidate, getEffectiveCounterpartyName(row), customCreditAccount)
  }

  async function saveCurrentMatchCorrection(row: CorrectionEditorTarget) {
    const selectedCandidate = buildCurrentMatchCandidate(row, config, customCreditAccount)
    if (!selectedCandidate) {
      setCandidateError('No se pudo preparar la homologacion actual para guardar la cuenta.')
      return
    }

    await saveCorrection(row, selectedCandidate, getEffectiveCounterpartyName(row), customCreditAccount)
  }

  async function applyReadyJournalAccountCorrection(journal: BankImportJournalPreview) {
    const target = buildCorrectionEditorTargetFromJournal(journal, selectedBankId, config)
    const accountDraft = getReadyJournalCreditAccountDraft(journal, readyJournalAccountDrafts)
    const selectedCandidate = buildCurrentMatchCandidate(target, config, accountDraft)
    if (!selectedCandidate) {
      setCandidateError('No se pudo preparar la cuenta homologada para este diario.')
      return
    }

    await applyTransientCorrection(target, selectedCandidate, getEffectiveCounterpartyName(target), accountDraft)
  }

  async function saveReadyJournalAccountCorrection(journal: BankImportJournalPreview) {
    const target = buildCorrectionEditorTargetFromJournal(journal, selectedBankId, config)
    const accountDraft = getReadyJournalCreditAccountDraft(journal, readyJournalAccountDrafts)
    const selectedCandidate = buildCurrentMatchCandidate(target, config, accountDraft)
    if (!selectedCandidate) {
      setCandidateError('No se pudo guardar la cuenta homologada para este diario.')
      return
    }

    await saveCorrection(target, selectedCandidate, getEffectiveCounterpartyName(target), accountDraft)
  }

  async function removeSingleUseCorrection(row: CorrectionEditorTarget) {
    if (!transientCorrections.some((item) => item.correctionKey === row.correctionKey)) {
      return
    }

    setIsSavingCorrection(true)
    setError(null)
    setCandidateError(null)
    setCorrectionMessage(null)
    setPostResult(null)

    try {
      const nextTransientCorrections = removeTransientCorrection(transientCorrections, row.correctionKey)
      const refreshed = await loadCurrentAnalysis({
        transientCorrections: nextTransientCorrections,
      })

      setTransientCorrections(nextTransientCorrections)
      applyBackendResult(refreshed)
      setCorrectionMessage(`Se quito la correccion unica de ${getCorrectionTargetLabel(row)}.`)
      resetCorrectionUi()
    } catch (reason: unknown) {
      if (isBankAnalysisAbortError(reason)) {
        return
      }
      const nextError = extractError(reason, 'Unable to remove single-use correction.')
      setCandidateError(nextError)
      setError(nextError)
    } finally {
      setIsSavingCorrection(false)
    }
  }

  function holdReadyJournal(journal: BankImportJournalPreview) {
    const correctionKey = getJournalCorrectionKey(journal, selectedBankId, config)
    setHeldReadyCorrectionKeys((currentItems) => {
      if (currentItems.includes(correctionKey)) {
        return currentItems
      }

      return [...currentItems, correctionKey]
    })
    setCorrectionMessage(`Se aparto temporalmente ${getCorrectionTargetLabel(journal)} del lote listo para subir.`)
    setPostResult(null)
  }

  function restoreHeldReadyJournal(journal: BankImportJournalPreview) {
    const correctionKey = getJournalCorrectionKey(journal, selectedBankId, config)
    setHeldReadyCorrectionKeys((currentItems) => currentItems.filter((item) => item !== correctionKey))
    setCorrectionMessage(`Se reincorporo ${getCorrectionTargetLabel(journal)} al lote listo para subir.`)
    setPostResult(null)
  }

  async function handleAnalyze(mode: BankImportAnalysisMode) {
    if (!selectedFile && !uploadedFile) {
      setError(`Selecciona primero el archivo del banco (${selectedBankProfile.expectedSourceLabel}).`)
      return
    }

    const requestToken = beginAnalysisRequestTracking()
    setIsAnalyzing(true)
    setActiveAnalysisMode(mode)
    setError(null)
    setCorrectionMessage(null)
    setPostResult(null)
    setRecognitionSpotlightMatches([])
    clearDisplayedResult()
    setAnalysisRun(null)
    setAnalysisRunId(null)
    resetCorrectionUi()

    try {
      const response = await loadCurrentAnalysis({
        file: selectedFile,
        analysisMode: mode,
        requestToken,
      })
      if (!isCurrentAnalysisRequest(requestToken)) {
        return
      }
      applyBackendResult(response)
      setSelectedFile(null)
      setPostedReadyJournalExternalIds([])
    } catch (reason: unknown) {
      if (isBankAnalysisAbortError(reason)) {
        return
      }
      setError(extractError(reason, 'Unable to analyze bank file.'))
    } finally {
      if (isCurrentAnalysisRequest(requestToken)) {
        setIsAnalyzing(false)
      }
    }
  }

  async function handleUploadHistoricalFile() {
    if (selectedBankId !== 'bbva') {
      return
    }

    if (!selectedHistoricalFile) {
      setError('Selecciona primero un estado de cuenta previo de BBVA para cargarlo al historico.')
      return
    }

    setIsUploadingHistorical(true)
    setError(null)
    setCandidateError(null)
    setCorrectionMessage(null)
    setPostResult(null)
    setRecognitionSpotlightMatches([])
    resetCorrectionUi()

    try {
      const fileBase64 = await readFileAsBase64(selectedHistoricalFile)
      const response = await uploadBankHistoricalStatement({
        bankId: selectedBankId,
        fileName: selectedHistoricalFile.name,
        fileBase64,
      })

      setSelectedHistoricalFile(null)
      setConfig(await fetchBankImportConfig())

      if (result || selectedFile || selectedBankSampleAvailable) {
        applyBackendResult(await loadCurrentAnalysis({ forceRefresh: true }))
      }

      setCorrectionMessage(
        `Historico BBVA actualizado con ${response.sourceFileName}: ${response.recognizedRows} reconocido${
          response.recognizedRows === 1 ? '' : 's'
        }, ${response.storedReferences} referencia${response.storedReferences === 1 ? '' : 's'} activas en memoria historica.`,
      )
    } catch (reason: unknown) {
      if (isBankAnalysisAbortError(reason)) {
        return
      }
      setError(extractError(reason, 'Unable to upload BBVA historical statement.'))
    } finally {
      setIsUploadingHistorical(false)
    }
  }

  async function handleUploadIndividualPaymentFiles() {
    if (selectedBankId !== 'bbva') {
      return
    }

    if (selectedIndividualPaymentFiles.length === 0) {
      setError('Selecciona primero uno o mas comprobantes BBVA de PagosIndividuales.')
      return
    }

    setIsUploadingIndividualPayments(true)
    setError(null)
    setCandidateError(null)
    setCorrectionMessage(null)
    setPostResult(null)

    try {
      const files = await Promise.all(
        selectedIndividualPaymentFiles.map(async (file) => ({
          fileName: file.name,
          fileBase64: await readFileAsBase64(file),
          mimeType: file.type || null,
        })),
      )
      const response = await uploadBankIndividualPaymentFiles({
        bankId: selectedBankId,
        files,
      })

      setSelectedIndividualPaymentFiles([])
      setIndividualPaymentInputVersion((currentVersion) => currentVersion + 1)
      setConfig(await fetchBankImportConfig())
      setCorrectionMessage(
        `PagosIndividuales BBVA actualizado: ${response.insertedFiles} nuevo${
          response.insertedFiles === 1 ? '' : 's'
        }, ${response.updatedFiles} actualizado${response.updatedFiles === 1 ? '' : 's'} y ${
          response.totalFiles
        } comprobante${response.totalFiles === 1 ? '' : 's'} guardado${response.totalFiles === 1 ? '' : 's'} en historico.`,
      )
    } catch (reason: unknown) {
      setError(extractError(reason, 'Unable to upload BBVA individual payment files.'))
    } finally {
      setIsUploadingIndividualPayments(false)
    }
  }

  async function handleRefreshAnalysis() {
    if (!canRefreshAnalysis) {
      setError('No hay un analisis resguardado para refrescar.')
      return
    }

    const requestToken = beginAnalysisRequestTracking()
    setIsAnalyzing(true)
    setIsRefreshingStoredAnalysis(true)
    setError(null)
    setCorrectionMessage(null)
    setPostResult(null)
    setRecognitionSpotlightMatches([])
    resetCorrectionUi()

    try {
      const response = await loadCurrentAnalysis({
        forceRefresh: true,
        requestToken,
      })
      if (!isCurrentAnalysisRequest(requestToken)) {
        return
      }
      applyBackendResult(response)
      setPostedReadyJournalExternalIds([])
      setCorrectionMessage(
        'Refresh completado. La vista se reconstruyo contra NetSuite, pendientes por subir y no identificados.',
      )
    } catch (reason: unknown) {
      if (isBankAnalysisAbortError(reason)) {
        return
      }
      setError(extractError(reason, 'Unable to refresh bank reconciliation.'))
    } finally {
      if (isCurrentAnalysisRequest(requestToken)) {
        setIsRefreshingStoredAnalysis(false)
        setIsAnalyzing(false)
      }
    }
  }

  function handleRequestPostJournals() {
    if (!result || visibleReadyJournals.length === 0) {
      const nextError = 'No hay diarios listos para subir a NetSuite.'
      setError(nextError)
      setPostError(nextError)
      return
    }

    const confirmed =
      typeof window === 'undefined'
        ? true
        : window.confirm(
            `Se enviaran ${visibleReadyJournals.length} diarios individuales a NetSuite para ${selectedBankLabel}. Cada movimiento se sube como un diario separado. Deseas continuar?`,
          )

    if (!confirmed) {
      return
    }

    setError(null)
    setPostError(null)
    setCorrectionMessage(null)
    void handlePostJournals()
  }

  async function handleSaveValidatedBalance() {
    if (!result || !balanceValidation?.supported) {
      setValidatedBalanceError('No hay un contexto valido de saldo para guardar en esta vista.')
      return
    }

    const validatedClosingBalance = parseCurrencyInput(validatedBalanceInput)
    if (validatedClosingBalance === null) {
      setValidatedBalanceError('Captura un saldo valido, por ejemplo 4091706.46.')
      return
    }

    setValidatedBalanceError(null)
    setValidatedBalanceMessage(null)
    setIsSavingValidatedBalance(true)

    try {
      const savedValidation = await saveBankImportValidatedBalance({
        bankId: selectedBankId,
        sourceFileHash: balanceValidation.sourceFileHash,
        sourceFileName: balanceValidation.sourceFileName,
        cutoffDate: balanceValidation.cutoffDate,
        movementWindow: balanceValidation.movementWindow,
        movementSummary: balanceValidation.movementSummary,
        validatedClosingBalance,
      })

      setResult((currentResult) =>
        currentResult
          ? {
              ...currentResult,
              balanceValidation: savedValidation,
            }
          : currentResult,
      )
      setValidatedBalanceInput(String(validatedClosingBalance))
      setValidatedBalanceMessage(
        savedValidation.status === 'ok'
          ? 'Saldo validado y continuidad confirmada.'
          : savedValidation.status === 'mismatch'
            ? 'Saldo validado guardado. Se detecto un descuadre contra el ancla previa.'
            : 'Saldo validado guardado.',
      )
    } catch (reason: unknown) {
      setValidatedBalanceError(extractError(reason, 'Unable to save validated bank balance.'))
    } finally {
      setIsSavingValidatedBalance(false)
    }
  }

  async function handleSelectedBankFileChange(nextFile: File | null) {
    selectedBankFileReadTokenRef.current += 1
    const readToken = selectedBankFileReadTokenRef.current

    if (!nextFile) {
      setSelectedFile(null)
      setUploadedFile(null)
      setIsPreparingSelectedFile(false)
      setBankFileInputVersion((currentVersion) => currentVersion + 1)
      return
    }

    setIsPreparingSelectedFile(true)
    setError(null)
    setSelectedFile(null)

    try {
      const fileBase64 = await readFileAsBase64(nextFile)
      if (selectedBankFileReadTokenRef.current !== readToken) {
        return
      }

      setUploadedFile(null)
      setSelectedFile({
        fileName: nextFile.name,
        fileBase64,
      })
    } catch (reason: unknown) {
      if (selectedBankFileReadTokenRef.current !== readToken) {
        return
      }

      setError(extractError(reason, 'No pude leer el archivo bancario seleccionado. Intenta volver a seleccionarlo.'))
    } finally {
      if (selectedBankFileReadTokenRef.current === readToken) {
        setIsPreparingSelectedFile(false)
        setBankFileInputVersion((currentVersion) => currentVersion + 1)
      }
    }
  }

  async function handlePostJournals() {
    if (!result || visibleReadyJournals.length === 0) {
      const nextError = 'No hay diarios listos para subir a NetSuite.'
      setError(nextError)
      setPostError(nextError)
      return
    }

    setIsPostingJournals(true)
    setError(null)
    setPostError(null)
    setCorrectionMessage(null)

    try {
      const response = await postBankImportJournals({
        bankId: selectedBankId,
        sourceFileName: result.sourceFileName,
        journals: visibleReadyJournals,
      })

      const processedExternalIds = Array.from(
        new Set(
          response.items
            .filter((item) => item.status === 'created' || item.status === 'skipped')
            .map((item) => item.externalId)
            .filter((item) => Boolean(item)),
        ),
      )

      setPostResult(response)
      if (processedExternalIds.length > 0) {
        setPostedReadyJournalExternalIds((currentItems) => {
          const nextItems = Array.from(new Set([...currentItems, ...processedExternalIds]))
          return areStringArraysEqual(currentItems, nextItems) ? currentItems : nextItems
        })
        applyOptimisticProcessedJournals(processedExternalIds)
      }

      try {
        const refreshed = await loadCurrentAnalysis({
          forceRefresh: true,
        })
        applyBackendResult(refreshed)
        setPostedReadyJournalExternalIds([])
        const availableReadyKeys = new Set(
          refreshed.journals.map((item) => getJournalCorrectionKey(item, selectedBankId, config)),
        )
        const nextHeldKeys = heldReadyCorrectionKeys.filter((item) => availableReadyKeys.has(item))
        setHeldReadyCorrectionKeys(nextHeldKeys)

        if (processedExternalIds.length > 0) {
          setCorrectionMessage(
            processedExternalIds.length === 1
              ? 'Diario procesado correctamente. La conciliacion ya se reconstruyo con la foto actual de NetSuite.'
              : `Se reconstruyo la conciliacion con ${processedExternalIds.length} diarios ya procesados en NetSuite.`,
          )
        }
      } catch (refreshReason: unknown) {
        if (isBankAnalysisAbortError(refreshReason)) {
          return
        }

        setPostError(
          extractError(
            refreshReason,
            'La subida se proceso, pero no fue posible refrescar la vista automaticamente.',
          ),
        )
      }
    } catch (reason: unknown) {
      if (isBankAnalysisAbortError(reason)) {
        return
      }
      const nextError = extractError(reason, 'Unable to post bank journals to NetSuite.')
      setError(nextError)
      setPostError(nextError)
    } finally {
      setIsPostingJournals(false)
    }
  }

  function updateRecognitionSpotlight(nextResult: BankImportAnalyzeResponse, row: CorrectionEditorTarget) {
    const recognizedMatches = findRecognizedMatchesForTarget(nextResult, row)
    if (recognizedMatches.length === 0) {
      return
    }

    setRecognitionSpotlightMatches((currentItems) => mergeRecognitionSpotlightMatches(currentItems, recognizedMatches))
  }

  function revealRecognizedSection() {
    setIsRecognizedSectionCollapsed(false)

    if (typeof window === 'undefined') {
      recognizedSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }

    window.setTimeout(() => {
      recognizedSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 0)
  }

  return (
    <div className="row g-4">
      <div className="col-12">
        <div className="surface-card card">
          <div className="card-body">
            <div className="row g-4 align-items-center">
              <div className="col-lg-8">
                <div className="eyebrow">Bancos</div>
                <h2 className="h3 mb-3">Carga estados de cuenta y prepara diarios individuales para NetSuite.</h2>
                <p className="text-secondary mb-0">
                  Cada banco reutiliza la misma base operativa: periodo contable, filtro de movimientos
                  <strong> Procesado</strong>, homologacion por tipo de transaccion y barrido del registro bancario
                  configurado en NetSuite. <strong>Clara Corriente</strong> distingue dos formatos y
                  <strong> BBVA</strong> lee el PDF de <strong>Detalle de movimientos</strong>.
                </p>
                <div className="bank-tabs mt-4" role="tablist" aria-label="Bancos disponibles">
                  {(config?.banks ?? []).map((bank) => (
                    <Link
                      key={bank.id}
                      to={`/bancos/${getBankRouteSegment(bank.id)}`}
                      className={`bank-tab ${bank.id === selectedBankId ? 'bank-tab--active' : ''}`}
                      aria-current={bank.id === selectedBankId ? 'page' : undefined}
                      aria-disabled={isBankSelectionDisabled ? 'true' : undefined}
                      onClick={(event) => {
                        if (isBankSelectionDisabled || bank.id === selectedBankId) {
                          event.preventDefault()
                        }
                      }}
                    >
                      {bank.label}
                    </Link>
                  ))}
                </div>
              </div>

              <div className="col-lg-4">
                <div className="bank-highlight">
                  <span>Cuenta bancaria fija</span>
                  <strong>{selectedBankAccountLabel}</strong>
                  <small>Segun el tipo, la cuenta banco puede quedar al débito o al crédito del diario.</small>
                </div>
              </div>
            </div>
            {error ? <div className="alert alert-warning mt-3 mb-0">{error}</div> : null}
            {correctionMessage ? <div className="alert alert-success mt-3 mb-0">{correctionMessage}</div> : null}
            {transientCorrections.length > 0 ? (
              <div className="alert alert-info mt-3 mb-0">
                Hay {transientCorrections.length} correccion{transientCorrections.length === 1 ? '' : 'es'} única
                {transientCorrections.length === 1 ? '' : 's'} activa
                {transientCorrections.length === 1 ? '' : 's'} solo para este análisis.
              </div>
            ) : null}
            {recognitionSpotlightMatches.length > 0 ? (
              <div className="bank-recognition-spotlight mt-3">
                <div className="bank-recognition-spotlight__header">
                  <div>
                    <div className="eyebrow">Reconocidos Ahora</div>
                    <h3 className="h6 mb-1">Estos movimientos ya fueron encontrados en NetSuite.</h3>
                    <p className="text-secondary mb-0">
                      Si desaparecieron de pendientes o de listos, es porque el barrido bancario ya los descontó
                      como cargados.
                    </p>
                  </div>
                  <div className="bank-recognition-spotlight__meta">
                    <span className="status-pill status-pill--healthy">
                      {recognitionSpotlightMatches.length} reconocido
                      {recognitionSpotlightMatches.length === 1 ? '' : 's'}
                    </span>
                    <span className="analysis-card__summary">{formatMoney(recognitionSpotlightTotalAmount)}</span>
                  </div>
                </div>
                <div className="bank-recognition-spotlight__list">
                  {recognitionSpotlightMatches.map((item) => (
                    <div key={getRecognizedMovementKey(item)} className="bank-recognition-spotlight__item">
                      <strong>{getCorrectionTargetLabel(item)}</strong>
                      <span>
                        {formatMoney(item.amount)} · Doc. {item.netsuiteDocumentNumber ?? item.netsuiteTransactionId}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="bank-recognition-spotlight__actions">
                  <button
                    type="button"
                    className="ghost-button ghost-button--inline"
                    onClick={() => {
                      revealRecognizedSection()
                    }}
                  >
                    Ver reconocidos
                  </button>
                  <button
                    type="button"
                    className="ghost-button ghost-button--inline"
                    onClick={() => {
                      setRecognitionSpotlightMatches([])
                    }}
                  >
                    Ocultar aviso
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="col-12">
        <div className="surface-card card">
          <div className="card-body">
            <div className="eyebrow">Carga Inicial</div>
            <h3 className="h5 mb-3">Selecciona periodo contable y archivo bancario.</h3>

            <div className="bank-form-grid">
              <label className="bank-field">
                <span>Banco activo</span>
                <input className="bank-input" type="text" value={selectedBankLabel} readOnly />
              </label>

              <label className="bank-field">
                <span>Periodo contable</span>
                <input
                  className="bank-input"
                  type="month"
                  value={accountingPeriod}
                  disabled={isLoadingConfig || isAnalyzing || isBackendAnalysisRunning || isHydratingBank}
                  onChange={(event) => setAccountingPeriod(event.target.value)}
                />
              </label>

              <label className="bank-field bank-field--wide">
                <span>Archivo bancario</span>
                <input
                  key={`${selectedBankId}:${bankFileInputVersion}`}
                  className="bank-input"
                  type="file"
                  accept={selectedBankProfile.acceptedFileTypes}
                  disabled={
                    isLoadingConfig || isAnalyzing || isPreparingSelectedFile || isBackendAnalysisRunning || isHydratingBank
                  }
                  onChange={(event) => {
                    void handleSelectedBankFileChange(event.target.files?.[0] ?? null)
                  }}
                />
                <small>
                  {isPreparingSelectedFile
                    ? 'Leyendo archivo seleccionado...'
                    : selectedFile
                    ? `Archivo seleccionado: ${selectedFile.fileName}`
                    : isRefreshingStoredAnalysis && uploadedFile
                      ? `Recuperando el análisis guardado de ${uploadedFile.fileName} y consultando al backend si la corrida sigue viva.`
                    : uploadedFile
                      ? `Archivo recuperado de la sesión: ${uploadedFile.fileName}. Puedes refrescar, seguir corrigiendo o relanzar el análisis sin volver a subirlo.`
                      : result
                      ? `Mostrando el ultimo analisis recuperado de ${result.sourceFileName}. Si subes otro archivo y pulsas Analizar archivo, se reemplaza ese resultado.`
                      : selectedBankSampleAvailable
                        ? `Mostrando de inicio el analisis precargado de ${selectedBankSampleFileName ?? selectedBankLabel}. Si subes otro archivo y pulsas Analizar archivo, se reemplaza ese resultado.`
                        : `Esperando ${selectedBankProfile.expectedSourceLabel} exportado por el banco.`}
                </small>
              </label>
            </div>

            <div className="note-strip note-strip--accent mt-3">
              <strong>Fuente esperada:</strong> {selectedBankProfile.expectedSourceLabel}. {selectedBankProfile.sourceSummary}
            </div>

            {selectedBankHistoricalRegistryAvailable ? (
              <>
                <div className="bank-form-grid mt-3">
                  <label className="bank-field bank-field--wide">
                    <span>Historico BBVA por referencia</span>
                    <input
                      key={`${selectedBankId}:historical`}
                      className="bank-input"
                      type="file"
                      accept=".pdf"
                      disabled={
                        isLoadingConfig ||
                        isAnalyzing ||
                        isBackendAnalysisRunning ||
                        isUploadingHistorical ||
                        isUploadingIndividualPayments
                      }
                      onChange={(event) => setSelectedHistoricalFile(event.target.files?.[0] ?? null)}
                    />
                    <small>
                      {selectedHistoricalFile
                        ? `Estado historico seleccionado: ${selectedHistoricalFile.name}`
                        : 'Adjunta estados previos de BBVA para guardar referencias reconocidas como REFBNTC... y reutilizarlas como sugerencia automatica.'}
                    </small>
                  </label>

                  <label className="bank-field bank-field--wide">
                    <span>PagosIndividuales</span>
                    <input
                      key={`${selectedBankId}:individual-payments:${individualPaymentInputVersion}`}
                      className="bank-input"
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      multiple
                      disabled={
                        isLoadingConfig ||
                        isAnalyzing ||
                        isBackendAnalysisRunning ||
                        isUploadingHistorical ||
                        isUploadingIndividualPayments
                      }
                      onChange={(event) => setSelectedIndividualPaymentFiles(Array.from(event.target.files ?? []))}
                    />
                    <small>
                      {selectedIndividualPaymentFiles.length > 0
                        ? `Comprobante${selectedIndividualPaymentFiles.length === 1 ? '' : 's'} seleccionado${
                            selectedIndividualPaymentFiles.length === 1 ? '' : 's'
                          }: ${selectedIndividualPaymentFiles.map((file) => file.name).join(', ')}`
                        : 'Adjunta comprobantes individuales BBVA para guardarlos y usarlos como evidencia historica de conciliacion.'}
                    </small>
                  </label>
                </div>

                <div className="note-strip mt-3">
                  <strong>Registro historico BBVA:</strong> {selectedBankHistoricalStatementCount} estado
                  {selectedBankHistoricalStatementCount === 1 ? '' : 's'} cargado
                  {selectedBankHistoricalStatementCount === 1 ? '' : 's'} y {selectedBankHistoricalReferenceCount}{' '}
                  referencia{selectedBankHistoricalReferenceCount === 1 ? '' : 's'} exacta
                  {selectedBankHistoricalReferenceCount === 1 ? '' : 's'} disponibles.
                  {selectedBankHistoricalLastUpdatedAtUtc
                    ? ` Ultima actualizacion: ${formatDateTime(selectedBankHistoricalLastUpdatedAtUtc)}.`
                    : ''}
                  <br />
                  <strong>PagosIndividuales:</strong> {selectedBankIndividualPaymentFileCount} comprobante
                  {selectedBankIndividualPaymentFileCount === 1 ? '' : 's'} guardado
                  {selectedBankIndividualPaymentFileCount === 1 ? '' : 's'}.
                  {selectedBankIndividualPaymentLastUpdatedAtUtc
                    ? ` Ultima carga: ${formatDateTime(selectedBankIndividualPaymentLastUpdatedAtUtc)}.`
                    : ''}
                </div>
              </>
            ) : null}

            <div className="bank-actions mt-3">
              {availableAnalysisModes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className="ghost-button"
                  disabled={
                    isLoadingConfig ||
                    isAnalyzing ||
                    isPreparingSelectedFile ||
                    isBackendAnalysisRunning ||
                    isUploadingHistorical ||
                    isUploadingIndividualPayments ||
                    isHydratingBank ||
                    !config ||
                    !hasReusableUploadedFile
                  }
                  onClick={() => {
                    void handleAnalyze(mode)
                  }}
                >
                  {getAnalysisActionLabel(mode, isAnalyzing && activeAnalysisMode === mode, isRefreshingStoredAnalysis)}
                </button>
              ))}
              {selectedBankHistoricalRegistryAvailable ? (
                <button
                  type="button"
                  className="ghost-button"
                  disabled={
                    isLoadingConfig ||
                    isAnalyzing ||
                    isBackendAnalysisRunning ||
                    isUploadingHistorical ||
                    isUploadingIndividualPayments ||
                    !selectedHistoricalFile
                  }
                  onClick={() => {
                    void handleUploadHistoricalFile()
                  }}
                >
                  {isUploadingHistorical ? 'Cargando historico...' : 'Cargar al historico BBVA'}
                </button>
              ) : null}
              {selectedBankHistoricalRegistryAvailable ? (
                <button
                  type="button"
                  className="ghost-button"
                  disabled={
                    isLoadingConfig ||
                    isAnalyzing ||
                    isBackendAnalysisRunning ||
                    isUploadingHistorical ||
                    isUploadingIndividualPayments ||
                    selectedIndividualPaymentFiles.length === 0
                  }
                  onClick={() => {
                    void handleUploadIndividualPaymentFiles()
                  }}
                >
                  {isUploadingIndividualPayments ? 'Guardando PagosIndividuales...' : 'Guardar PagosIndividuales'}
                </button>
              ) : null}
              {canRefreshAnalysis ? (
                <button
                  type="button"
                  className="ghost-button"
                  disabled={
                    isLoadingConfig ||
                    isAnalyzing ||
                    isBackendAnalysisRunning ||
                    isSavingCorrection ||
                    isPostingJournals ||
                    isUploadingHistorical ||
                    isUploadingIndividualPayments ||
                    isHydratingBank
                  }
                  onClick={() => {
                    void handleRefreshAnalysis()
                  }}
                >
                  {isAnalyzing || isRefreshingStoredAnalysis ? 'Refrescando...' : 'Refresh'}
                </button>
              ) : null}
              {isLoadingSample ? <span className="text-secondary small">Cargando muestra analizada...</span> : null}
              {isRefreshingStoredAnalysis ? (
                <span className="text-secondary small">
                  Consultando al backend si la corrida recuperada sigue en proceso o ya terminó.
                </span>
              ) : null}
              <span className="text-secondary small">
                El analisis solo considera movimientos dentro de {selectedAccountingPeriodLabel}.
              </span>
            </div>
            {shouldShowAnalysisBanner ? (
              <div className="analysis-run-banner mt-3" role="status" aria-live="polite">
                <div className="analysis-run-banner__header">
                  <div className="analysis-run-banner__title">
                    <span className={analysisBannerClassName}>{analysisBannerLabel}</span>
                    <strong className="analysis-run-banner__source">{analysisViewSourceLabel}</strong>
                  </div>
                  {analysisTimestampValue ? (
                    <span className="analysis-run-banner__timestamp">
                      {analysisTimestampLabel}: {formatDateTime(analysisTimestampValue)}
                    </span>
                  ) : null}
                </div>
                <p className="analysis-run-banner__description">{analysisBannerDescription}</p>
                <div className="analysis-run-banner__meta">
                  <div className="analysis-run-banner__meta-item">
                    <span>Modo</span>
                    <strong>{analysisDisplayModeLabel}</strong>
                  </div>
                  <div className="analysis-run-banner__meta-item">
                    <span>Corrida</span>
                    <strong>{currentAnalysisRunId ?? 'Sin corrida registrada'}</strong>
                  </div>
                  <div className="analysis-run-banner__meta-item">
                    <span>Archivo</span>
                    <strong>{analysisSourceFileName ?? 'Sin archivo cargado'}</strong>
                  </div>
                  <div className="analysis-run-banner__meta-item">
                    <span>Periodo</span>
                    <strong>{analysisAccountingPeriodLabel}</strong>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {result ? (
        <>
          <div className="col-12">
            <div className="bank-summary-grid">
              <div className="bank-stat">
                <span>Filas totales</span>
                <strong>{result.summary.totalRows}</strong>
                <small>Archivo {result.sourceFileName}</small>
              </div>
              <div className="bank-stat">
                <span>En el periodo</span>
                <strong>{result.summary.rowsAfterCutoff}</strong>
                <small>Solo se consideran movimientos de {resultAccountingPeriodLabel}</small>
              </div>
              <div className="bank-stat">
                <span>Listas para diario</span>
                <strong>{result.summary.readyRows}</strong>
                <small>{formatMoney(result.summary.readyAmount)}</small>
              </div>
              <div className="bank-stat">
                <span>Sin homologacion</span>
                <strong>{result.summary.unmatchedRows}</strong>
                <small>{formatMoney(result.summary.unmatchedAmount)}</small>
              </div>
              <div className="bank-stat">
                <span>Ya reconocidos NetSuite</span>
                <strong>{result.summary.excludedRecognizedRows}</strong>
                <small>{formatMoney(result.summary.recognizedAmount)}</small>
              </div>
            </div>
          </div>

          <div className="col-12">
            <div className="surface-card card">
              <div className="card-body">
                <div className="analysis-card__header mb-3">
                  <div>
                    <div className="eyebrow">Barrido NetSuite</div>
                    <h3 className="h5 mb-1">Registro bancario descontado del pendiente</h3>
                    <p className="text-secondary mb-0">
                      El resumen pendiente de esta pantalla ya excluye lo que el registro bancario de
                      NetSuite muestre como reconocido dentro del periodo contable seleccionado.
                    </p>
                  </div>
                  <div className="analysis-card__meta">
                    <div className={getNetSuiteSweepStatusClassName(result.netsuiteSweep.status)}>
                      {getNetSuiteSweepLabel(result.netsuiteSweep.status)}
                    </div>
                    <div className="analysis-card__summary">
                      {result.netsuiteSweep.recognizedRows} movimientos ya reconocidos
                    </div>
                    <div className="analysis-card__summary">
                      {formatMoney(result.netsuiteSweep.recognizedAmount)} descontados
                    </div>
                  </div>
                </div>

                <div className="summary-list">
                  <div className="summary-list__item">
                    <span>Cuenta barrida</span>
                    <strong>
                      {result.netsuiteSweep.accountLabel ?? selectedBankAccountLabel}{' '}
                      {result.netsuiteSweep.accountId ? `(#${result.netsuiteSweep.accountId})` : ''}
                    </strong>
                  </div>
                  <div className="summary-list__item">
                    <span>Renglones leidos en NetSuite</span>
                    <strong>{result.netsuiteSweep.registerRowsFetched}</strong>
                  </div>
                  <div className="summary-list__item">
                    <span>Movimientos descontados</span>
                    <strong>{result.netsuiteSweep.recognizedRows}</strong>
                  </div>
                  <div className="summary-list__item">
                    <span>Monto descontado</span>
                    <strong>{formatMoney(result.netsuiteSweep.recognizedAmount)}</strong>
                  </div>
                </div>

                {selectedBankId === 'payana' && balanceValidation?.supported ? (
                  <div className="bank-balance-validation mt-3">
                    <div className="analysis-card__header mb-3">
                      <div>
                        <div className="eyebrow">Saldo Validado</div>
                        <h4 className="h6 mb-1">Cierre manual de Higo en NetSuite</h4>
                        <p className="text-secondary mb-0">{balanceValidation.message}</p>
                      </div>
                      <div className="analysis-card__meta">
                        <div className={getBalanceValidationStatusClassName(balanceValidation.status)}>
                          {getBalanceValidationStatusLabel(balanceValidation.status)}
                        </div>
                        {balanceValidation.differenceVsValidatedClosing !== null ? (
                          <div className="analysis-card__summary">
                            Diferencia {formatSignedMoney(balanceValidation.differenceVsValidatedClosing)}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="summary-list">
                      <div className="summary-list__item">
                        <span>Ventana activa de la carga</span>
                        <strong>
                          {balanceValidation.movementWindow.minProcessingDate ?? '--'} a{' '}
                          {balanceValidation.movementWindow.maxProcessingDate ?? '--'}
                        </strong>
                      </div>
                      <div className="summary-list__item">
                        <span>Ancla previa validada</span>
                        <strong>
                          {balanceValidation.previousValidation
                            ? `${formatMoney(balanceValidation.previousValidation.validatedClosingBalance)} (${balanceValidation.previousValidation.movementMaxProcessingDate ?? '--'})`
                            : '--'}
                        </strong>
                      </div>
                      <div className="summary-list__item">
                        <span>Variacion neta de esta carga</span>
                        <strong>{formatSignedMoney(balanceValidation.movementSummary.netChange)}</strong>
                      </div>
                      <div className="summary-list__item">
                        <span>Saldo final esperado</span>
                        <strong>
                          {balanceValidation.expectedClosingBalance !== null
                            ? formatMoney(balanceValidation.expectedClosingBalance)
                            : '--'}
                        </strong>
                      </div>
                      <div className="summary-list__item">
                        <span>Saldo final validado</span>
                        <strong>
                          {balanceValidation.currentValidation
                            ? formatMoney(balanceValidation.currentValidation.validatedClosingBalance)
                            : '--'}
                        </strong>
                      </div>
                    </div>

                    <div className="bank-balance-validation__form mt-3">
                      <label className="bank-field bank-balance-validation__field">
                        <span>Saldo final confirmado en Higo NetSuite</span>
                        <input
                          type="text"
                          className="bank-input bank-balance-validation__input"
                          inputMode="decimal"
                          placeholder="4091706.46"
                          value={validatedBalanceInput}
                          disabled={isSavingValidatedBalance}
                          onChange={(event) => {
                            setValidatedBalanceInput(event.target.value)
                          }}
                        />
                        <small>
                          Al guardarlo, este cierre queda como saldo final validado de la carga y servira
                          como ancla para la siguiente.
                        </small>
                      </label>
                      <button
                        type="button"
                        className="ghost-button ghost-button--inline"
                        disabled={isSavingValidatedBalance}
                        onClick={() => {
                          void handleSaveValidatedBalance()
                        }}
                      >
                        {isSavingValidatedBalance ? 'Guardando...' : 'Validado'}
                      </button>
                    </div>

                    {validatedBalanceMessage ? (
                      <div className="alert alert-success mt-3 mb-0">{validatedBalanceMessage}</div>
                    ) : null}
                    {validatedBalanceError ? (
                      <div className="alert alert-warning mt-3 mb-0">{validatedBalanceError}</div>
                    ) : null}
                  </div>
                ) : null}

                {result.netsuiteSweep.warning ? (
                  <div className="alert alert-warning mt-3 mb-0">{result.netsuiteSweep.warning}</div>
                ) : null}
              </div>
            </div>
          </div>

          {result.transactionTypes.length > 0 ? (
            <div className="col-12">
              <div className="surface-card card table-panel">
                <div className="card-body">
                  <div className="analysis-card__header mb-3">
                    <div>
                      <div className="eyebrow">Pendiente Por Tipo</div>
                      <h3 className="h5 mb-1">Resumen por tipo de transaccion pendiente de trabajar</h3>
                      <p className="text-secondary mb-0">
                        Este resumen toma movimientos <strong>dentro del periodo contable seleccionado</strong>{' '}
                        con estado <strong>Procesado</strong>. Ya descuenta lo reconocido en NetSuite para
                        dimensionar lo que sigue pendiente por vaciar y dejar claro que hoja de equivalencia
                        aplica a cada tipo.
                      </p>
                    </div>
                    <div className="analysis-card__meta">
                      <div className="status-pill status-pill--healthy">
                        {pendingByTransactionTypeTotals.count} movimientos procesados
                      </div>
                      <div className="analysis-card__summary">
                        {formatMoney(pendingByTransactionTypeTotals.amount)} pendientes en el periodo
                      </div>
                      {result.netsuiteSweep.recognizedRows > 0 ? (
                        <div className="analysis-card__summary">
                          {result.netsuiteSweep.recognizedRows} ya reconocidos en NetSuite
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="table-responsive analysis-table">
                    <table className="table align-middle mb-0">
                      <thead>
                        <tr>
                          <th>Tipo de transaccion</th>
                          <th>Hoja de equivalencia</th>
                          <th>Movimientos</th>
                          <th>Monto total</th>
                          <th>Flujo actual</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.transactionTypes.map((item) => (
                          <tr key={item.transactionType}>
                            <td>{item.transactionType}</td>
                            <td>{item.mappingSheetName ?? 'Pendiente especial'}</td>
                            <td>{item.count}</td>
                            <td>{formatMoney(item.amount)}</td>
                            <td>
                              <span
                                className={`status-pill ${
                                  item.includedInCurrentFlow ? 'status-pill--ready' : 'status-pill--idle'
                                }`}
                              >
                                {item.includedInCurrentFlow ? 'En flujo actual' : 'Fuera del flujo actual'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {netsuiteSweepRows.length > 0 ? (
            <div className="col-12">
              <div
                ref={recognizedSectionRef}
                className={`surface-card card table-panel bank-section-card ${
                  isRecognizedSectionCollapsed ? 'bank-section-card--collapsed' : ''
                }`}
              >
                <div className="card-body bank-section-card__body">
                  <button
                    type="button"
                    className="bank-section-toggle"
                    aria-expanded={!isRecognizedSectionCollapsed}
                    aria-controls="recognized-netsuite-panel"
                    aria-label={
                      isRecognizedSectionCollapsed
                        ? 'Mostrar movimientos ya cargados en NetSuite'
                        : 'Ocultar movimientos ya cargados en NetSuite'
                    }
                    onClick={() => {
                      setIsRecognizedSectionCollapsed((currentValue) => !currentValue)
                    }}
                  >
                    {isRecognizedSectionCollapsed ? '+' : '-'}
                  </button>

                  <div className="bank-section-card__content">
                  <div className="analysis-card__header mb-3">
                    <div>
                      <div className="eyebrow">Reconocidos</div>
                      <h3 className="h5 mb-1">Movimientos ya cargados en NetSuite</h3>
                      <p className="text-secondary mb-0">
                        Esta tabla monta el barrido completo del periodo vigente en NetSuite.
                        {netsuiteSweepPeriodLabel ? ` Periodo montado: ${netsuiteSweepPeriodLabel}.` : ''}
                        {' '}Los movimientos que coinciden con el analisis actual se excluyen automaticamente del pendiente.
                      </p>
                    </div>
                    <div className="analysis-card__meta">
                      <div className="status-pill status-pill--healthy">
                        {netsuiteSweepRows.length} movimientos en NetSuite
                      </div>
                      <div className="analysis-card__summary">{netsuiteSweepExcludedCount} excluidos del pendiente actual</div>
                      {recognitionSpotlightMatches.length > 0 ? (
                        <div className="analysis-card__summary">
                          {recognitionSpotlightMatches.length} destacados de esta revision
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div
                    id="recognized-netsuite-panel"
                    className="bank-section-card__panel"
                    hidden={isRecognizedSectionCollapsed}
                  >
                    <div className="table-responsive analysis-table analysis-table--resizable">
                    <table className="table align-middle mb-0" style={{ width: `${netsuiteSweepTable.totalWidth}px` }}>
                      <colgroup>
                        {NETSUITE_SWEEP_COLUMNS.map((column) => (
                          <col
                            key={column.key}
                            style={{ width: `${netsuiteSweepTable.columnWidths[column.key] ?? column.defaultWidth}px` }}
                          />
                        ))}
                      </colgroup>
                      <thead>
                        <tr>
                          <ResizableTableHeaderCell column={NETSUITE_SWEEP_COLUMNS[0]} controller={netsuiteSweepTable} />
                          <ResizableTableHeaderCell column={NETSUITE_SWEEP_COLUMNS[1]} controller={netsuiteSweepTable} />
                          <ResizableTableHeaderCell column={NETSUITE_SWEEP_COLUMNS[2]} controller={netsuiteSweepTable} />
                          <ResizableTableHeaderCell column={NETSUITE_SWEEP_COLUMNS[3]} controller={netsuiteSweepTable} />
                          <ResizableTableHeaderCell column={NETSUITE_SWEEP_COLUMNS[4]} controller={netsuiteSweepTable} />
                          <ResizableTableHeaderCell column={NETSUITE_SWEEP_COLUMNS[5]} controller={netsuiteSweepTable} />
                          <ResizableTableHeaderCell column={NETSUITE_SWEEP_COLUMNS[6]} controller={netsuiteSweepTable} />
                          <ResizableTableHeaderCell column={NETSUITE_SWEEP_COLUMNS[7]} controller={netsuiteSweepTable} />
                          <ResizableTableHeaderCell column={NETSUITE_SWEEP_COLUMNS[8]} controller={netsuiteSweepTable} />
                        </tr>
                      </thead>
                      <tbody>
                        {netsuiteSweepRows.map((item) => (
                          <tr
                            key={`${item.externalId}-${item.netsuiteTransactionId}-${item.rowOrigin ?? 'analysis_match'}`}
                            className={
                              recognitionSpotlightKeySet.has(getRecognizedMovementKey(item))
                                ? 'analysis-row--spotlight'
                                : undefined
                            }
                          >
                            <td>{item.transactionDate}</td>
                            <td>{item.transactionType}</td>
                            <td>
                              {isNetSuitePeriodOnlyRow(item) ? (
                                <div className="invoice-raw-meta">
                                  <strong>{cleanText(item.netsuiteEntityName) || getDisplayCounterpartyName(item) || '--'}</strong>
                                  <span>Registro NetSuite</span>
                                  {item.netsuiteMemo ? <span>{item.netsuiteMemo}</span> : null}
                                </div>
                              ) : hasDisplayCounterpartyName(item) ? (
                                <div className="invoice-raw-meta">
                                  <strong>{getDisplayCounterpartyName(item)}</strong>
                                  <span>{getCounterpartySourceLabel(item.counterpartySource)}</span>
                                  {getCounterpartySupportingText(item) ? (
                                    <span>{getCounterpartySupportingText(item)}</span>
                                  ) : null}
                                </div>
                              ) : null}
                            </td>
                            <td>{formatMoney(item.amount)}</td>
                            <td>{item.netsuiteTransactionDate}</td>
                            <td>{item.netsuiteDocumentNumber ?? item.netsuiteTransactionId}</td>
                            <td>
                              <div className="invoice-raw-meta">
                                <strong>{item.netsuiteEntityName ?? '--'}</strong>
                                {item.netsuiteLineMemo ? <span>Línea: {item.netsuiteLineMemo}</span> : null}
                                {item.netsuiteHeaderMemo && item.netsuiteHeaderMemo !== item.netsuiteLineMemo ? (
                                  <span>Cabecera: {item.netsuiteHeaderMemo}</span>
                                ) : null}
                              </div>
                            </td>
                            <td>
                              <div className="invoice-raw-meta">
                                <strong>{item.matchRule}</strong>
                                <span>Banco: {item.movementMatchSource}</span>
                                <span>NetSuite: {item.netsuiteMatchSource}</span>
                              </div>
                            </td>
                            <td>
                              <div className="invoice-raw-meta">
                                <span className={getRecognitionConfidenceClassName(item.matchConfidence)}>
                                  {item.matchConfidenceLabel}
                                </span>
                                <span>{item.dayDifference === 0 ? 'Mismo día' : `${item.dayDifference} día(s)`}</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {result.creditDestinations.length > 0 ? (
            <div className="col-12">
              <div className="surface-card card">
                <div className="card-body">
                <div className="analysis-card__header mb-3">
                  <div>
                      <div className="eyebrow">Cuenta Homologada</div>
                      <h3 className="h5 mb-1">Clasificacion detectada en la cuenta homologada</h3>
                      <p className="text-secondary mb-0">
                        Esta vista sale de la cuenta <strong>CC</strong> homologada, sin importar si en el
                        diario termina al débito o al crédito.
                      </p>
                    </div>
                  </div>

                  <div className="bank-destination-grid">
                    {result.creditDestinations.map((destination) => (
                      <div key={destination.type} className="bank-destination-card">
                        <span className={getDestinationClassName(destination.type)}>
                          {destination.label}
                        </span>
                        <strong>{destination.count} movimientos</strong>
                        <small>{formatMoney(destination.amount)}</small>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="col-12">
            <div className="surface-card card table-panel">
              <div className="card-body">
                <div className="analysis-card__header mb-3">
                  <div>
                    <div className="eyebrow">Lista Definitiva</div>
                    <h3 className="h5 mb-1">Movimientos ya listos para subir a NetSuite</h3>
                    <p className="text-secondary mb-0">
                      Se genera un diario por movimiento. La salida plana ya corresponde a dos renglones por
                      diario en el formato de la hoja <strong>Data</strong>. La hoja aplicada y el lado
                      contable de la cuenta homologada cambian segun el tipo de transaccion. Esta es la lista
                      definitiva operable; lo que siga en pendientes todavia bloquea el cierre total del lote.
                    </p>
                  </div>
                  <div className="analysis-card__meta">
                    <div
                      className={`status-pill ${
                        result.unmatched.length === 0 ? 'status-pill--ready' : 'status-pill--review'
                      }`}
                    >
                      {visibleReadyJournals.length} diarios / {visibleReadyExportRows.length} renglones
                    </div>
                    <div className="analysis-card__summary">
                      {result.unmatched.length === 0
                        ? 'Sin bloqueos por equivalencia'
                        : `${result.unmatched.length} bloqueos por equivalencia`}
                    </div>
                    {heldReadyJournals.length > 0 ? (
                      <div className="analysis-card__summary">{heldReadyJournals.length} apartados temporalmente</div>
                    ) : null}
                    <div className="analysis-card__summary">
                      Archivo analizado: {result.sourceFileName}
                    </div>
                    <div className="analysis-card__summary">
                      Ventana detectada: {result.statementWindow.minProcessingDate ?? '--'} a{' '}
                      {result.statementWindow.maxProcessingDate ?? '--'}
                    </div>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={isPostingJournals || visibleReadyJournals.length === 0}
                      onClick={handleRequestPostJournals}
                    >
                      {isPostingJournals
                        ? 'Subiendo diarios individuales...'
                        : `Subir ${visibleReadyJournals.length} diarios individuales`}
                    </button>
                    {postError ? <div className="alert alert-warning mb-0">{postError}</div> : null}
                  </div>
                </div>

                {visibleReadyJournals.length === 0 && netsuiteSweepExcludedCount > 0 ? (
                  <div className="alert alert-info mb-3">
                    No hay movimientos listos en este momento, pero <strong>{netsuiteSweepExcludedCount}</strong>{' '}
                    ya fueron reconocidos en NetSuite dentro de la ventana analizada. Si esperabas ver alguno aquí,
                    revisa la tabla de <strong>Movimientos ya cargados en NetSuite</strong>.
                    <button
                      type="button"
                      className="ghost-button ghost-button--inline ms-2"
                      onClick={() => {
                        revealRecognizedSection()
                      }}
                    >
                      Ir a reconocidos
                    </button>
                  </div>
                ) : null}

                {postResult ? (
                  <div className="border rounded p-3 mb-3">
                    <div className="analysis-card__header mb-3">
                      <div>
                        <div className="eyebrow">Subida NetSuite</div>
                        <h4 className="h6 mb-1">Resultado de la ultima carga individual</h4>
                        <p className="text-secondary mb-0">
                          Cada fila representa un diario independiente. Nunca se consolida todo el lote en un
                          solo journal entry.
                        </p>
                      </div>
                      <div className="analysis-card__meta">
                        <div
                          className={`status-pill ${
                            postResult.totals.failed > 0
                              ? 'status-pill--exception'
                              : postResult.totals.created > 0
                                ? 'status-pill--ready'
                                : 'status-pill--idle'
                          }`}
                        >
                          {postResult.totals.created} creados / {postResult.totals.requested} enviados
                        </div>
                        <div className="analysis-card__summary">
                          {postResult.totals.skipped} omitidos por duplicado
                        </div>
                        <div className="analysis-card__summary">
                          {postResult.totals.failed} fallidos
                        </div>
                      </div>
                    </div>

                    <div className="summary-list">
                      <div className="summary-list__item">
                        <span>Fecha de ejecucion</span>
                        <strong>{formatDateTime(postResult.executedAtUtc)}</strong>
                      </div>
                      <div className="summary-list__item">
                        <span>Diarios creados</span>
                        <strong>{postResult.totals.created}</strong>
                      </div>
                      <div className="summary-list__item">
                        <span>Diarios omitidos</span>
                        <strong>{postResult.totals.skipped}</strong>
                      </div>
                      <div className="summary-list__item">
                        <span>Diarios fallidos</span>
                        <strong>{postResult.totals.failed}</strong>
                      </div>
                    </div>

                    <div className="table-responsive analysis-table mt-3">
                      <table className="table align-middle mb-0">
                        <thead>
                          <tr>
                            <th>Estatus</th>
                            <th>Fecha</th>
                            <th>Contraparte</th>
                            <th>Monto</th>
                            <th>Documento NetSuite</th>
                            <th>ID externo</th>
                            <th>Mensaje</th>
                          </tr>
                        </thead>
                        <tbody>
                          {postResult.items.map((item) => (
                            <tr key={`${item.externalId}-${item.status}`}>
                              <td>
                                <span className={getPostStatusClassName(item.status)}>
                                  {getPostStatusLabel(item.status)}
                                </span>
                              </td>
                              <td>{item.transactionDate}</td>
                              <td>{item.counterpartyName}</td>
                              <td>{formatMoney(item.amount)}</td>
                              <td>{item.netsuiteTranId ?? item.netsuiteRecordId ?? '--'}</td>
                              <td className="analysis-break">{item.externalId}</td>
                              <td>{item.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                <div className="table-responsive analysis-table analysis-table--resizable analysis-table--compact">
                  <table className="table align-middle mb-0" style={{ width: `${readyToPostTable.totalWidth}px` }}>
                    <colgroup>
                      {READY_TO_POST_COLUMNS.map((column) => (
                        <col
                          key={column.key}
                          style={{ width: `${readyToPostTable.columnWidths[column.key] ?? column.defaultWidth}px` }}
                        />
                      ))}
                    </colgroup>
                    <thead>
                      <tr>
                        <ResizableTableHeaderCell column={READY_TO_POST_COLUMNS[0]} controller={readyToPostTable} />
                        <ResizableTableHeaderCell column={READY_TO_POST_COLUMNS[1]} controller={readyToPostTable} />
                        <ResizableTableHeaderCell column={READY_TO_POST_COLUMNS[2]} controller={readyToPostTable} />
                        <ResizableTableHeaderCell column={READY_TO_POST_COLUMNS[3]} controller={readyToPostTable} />
                        <ResizableTableHeaderCell column={READY_TO_POST_COLUMNS[4]} controller={readyToPostTable} />
                        <ResizableTableHeaderCell column={READY_TO_POST_COLUMNS[5]} controller={readyToPostTable} />
                        <ResizableTableHeaderCell column={READY_TO_POST_COLUMNS[6]} controller={readyToPostTable} />
                        <ResizableTableHeaderCell column={READY_TO_POST_COLUMNS[7]} controller={readyToPostTable} />
                        <ResizableTableHeaderCell column={READY_TO_POST_COLUMNS[8]} controller={readyToPostTable} />
                        <ResizableTableHeaderCell column={READY_TO_POST_COLUMNS[9]} controller={readyToPostTable} />
                        <ResizableTableHeaderCell column={READY_TO_POST_COLUMNS[10]} controller={readyToPostTable} />
                        <ResizableTableHeaderCell column={READY_TO_POST_COLUMNS[11]} controller={readyToPostTable} />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleReadyJournals.length > 0 ? (
                        visibleReadyJournals.map((journal) => {
                          const readyJournalAccountDraft = getReadyJournalCreditAccountDraft(
                            journal,
                            readyJournalAccountDrafts,
                          )
                          const hasPendingAccountChange =
                            normalizeManualCreditAccount(readyJournalAccountDraft) !== journal.mappedAccount

                          return (
                            <tr key={journal.externalId}>
                            <td>{journal.transactionDate}</td>
                            <td>{journal.transactionType}</td>
                            <td>
                              <div className="invoice-raw-meta">
                                {hasDisplayCounterpartyName(journal) ? (
                                  <>
                                    <strong>{getDisplayCounterpartyName(journal)}</strong>
                                    <span>{getCounterpartySourceLabel(journal.counterpartySource)}</span>
                                  </>
                                ) : null}
                                {getCounterpartySupportingText(journal) ? (
                                  <span>{getCounterpartySupportingText(journal)}</span>
                                ) : null}
                                <span>{getMappingMethodLabel(journal.mappingMethod)}</span>
                              </div>
                            </td>
                            <td>{journal.mappingSheetName}</td>
                            <td>
                              <div className="invoice-raw-meta">
                                <strong>{journal.netsuiteName}</strong>
                                {getJournalPostingDisplayName(journal) ? (
                                  <span>En NetSuite se vera como {getJournalPostingDisplayName(journal)}</span>
                                ) : null}
                                <span>Entidad homologada en NetSuite</span>
                              </div>
                            </td>
                            <td>{formatMoney(journal.amount)}</td>
                            <td>{journal.debitAccount}</td>
                            <td>{journal.creditAccount}</td>
                            <td>
                              <div className="bank-destination-cell">
                                <span className={getDestinationClassName(journal.creditDestinationType)}>
                                  {journal.creditDestinationLabel}
                                </span>
                                <span className="bank-destination-cell__account">{journal.mappedAccount}</span>
                                <input
                                  type="text"
                                  className="form-control form-control-sm bank-destination-cell__editor"
                                  list={READY_ACCOUNT_DATALIST_ID}
                                  value={readyJournalAccountDraft}
                                  disabled={isSavingCorrection}
                                  onChange={(event) => {
                                    const nextAccount = event.target.value
                                    setReadyJournalAccountDrafts((currentItems) => ({
                                      ...currentItems,
                                      [getReadyJournalDraftKey(journal)]: nextAccount,
                                    }))
                                  }}
                                />
                                <span className="bank-destination-cell__account">
                                  {journal.mappedAccountSide === 'debit'
                                    ? 'Se aplica al débito'
                                    : 'Se aplica al crédito'}
                                </span>
                                {hasPendingAccountChange ? (
                                  <span className="bank-destination-cell__account">
                                    Cambio pendiente: se aplicara la cuenta capturada arriba.
                                  </span>
                                ) : null}
                                <div className="bank-destination-cell__actions">
                                  <button
                                    type="button"
                                    className="ghost-button ghost-button--inline"
                                    disabled={isSavingCorrection}
                                    onClick={() => {
                                      void applyReadyJournalAccountCorrection(journal)
                                    }}
                                  >
                                    {isSavingCorrection ? 'Aplicando...' : 'Aplicar cuenta'}
                                  </button>
                                  <button
                                    type="button"
                                    className="ghost-button ghost-button--inline"
                                    disabled={isSavingCorrection}
                                    onClick={() => {
                                      void saveReadyJournalAccountCorrection(journal)
                                    }}
                                  >
                                    {isSavingCorrection ? 'Guardando...' : 'Guardar cuenta'}
                                  </button>
                                </div>
                              </div>
                            </td>
                            <td>{journal.paymentConcept ?? journal.lineMemo}</td>
                            <td className="analysis-break">{journal.externalId}</td>
                            <td>
                              <div className="d-flex flex-column gap-2">
                                <button
                                  type="button"
                                  className="ghost-button"
                                  disabled={isSearchingCandidates || isSavingCorrection}
                                  onClick={() => {
                                    void openCorrectionEditor(
                                      buildCorrectionEditorTargetFromJournal(journal, selectedBankId, config),
                                    )
                                  }}
                                >
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  className="ghost-button"
                                  onClick={() => {
                                    holdReadyJournal(journal)
                                  }}
                                >
                                  Apartar
                                </button>
                                {journal.mappingMethod === 'manual_single' ? (
                                  <button
                                    type="button"
                                    className="ghost-button"
                                    disabled={isSavingCorrection}
                                    onClick={() => {
                                      void removeSingleUseCorrection(
                                        buildCorrectionEditorTargetFromJournal(journal, selectedBankId, config),
                                      )
                                    }}
                                  >
                                    {isSavingCorrection ? 'Quitando...' : 'Quitar unica'}
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                          )
                        })
                      ) : (
                        <tr>
                          <td colSpan={12} className="text-secondary">
                            {heldReadyJournals.length > 0
                              ? 'Todos los movimientos listos estan apartados temporalmente.'
                              : 'No hubo movimientos listos para diario con las reglas actuales.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {heldReadyJournals.length > 0 ? (
                  <div className="border rounded p-3 mt-3">
                    <div className="analysis-card__header mb-3">
                      <div>
                        <div className="eyebrow">Apartados</div>
                        <h4 className="h6 mb-1">Movimientos retirados temporalmente del lote</h4>
                        <p className="text-secondary mb-0">
                          Estos movimientos no se enviaran a NetSuite hasta que los reincluyas.
                        </p>
                      </div>
                      <div className="analysis-card__meta">
                        <div className="status-pill status-pill--idle">{heldReadyJournals.length} apartados</div>
                      </div>
                    </div>

                    <div className="table-responsive analysis-table">
                      <table className="table align-middle mb-0">
                        <thead>
                          <tr>
                            <th>Fecha</th>
                            <th>Tipo</th>
                            <th>Contraparte banco</th>
                            <th>Entidad NetSuite</th>
                            <th>Monto</th>
                            <th>Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {heldReadyJournals.map((journal) => (
                            <tr key={`held-${journal.externalId}`}>
                              <td>{journal.transactionDate}</td>
                              <td>{journal.transactionType}</td>
                              <td>{getDisplayCounterpartyName(journal) || '--'}</td>
                              <td>
                                <div className="invoice-raw-meta">
                                  <strong>{journal.netsuiteName}</strong>
                                  {getJournalPostingDisplayName(journal) ? (
                                    <span>En NetSuite se vera como {getJournalPostingDisplayName(journal)}</span>
                                  ) : null}
                                </div>
                              </td>
                              <td>{formatMoney(journal.amount)}</td>
                              <td>
                                <div className="d-flex flex-column gap-2">
                                  <button
                                    type="button"
                                    className="ghost-button"
                                    onClick={() => {
                                      restoreHeldReadyJournal(journal)
                                    }}
                                  >
                                    Reincluir
                                  </button>
                                  <button
                                    type="button"
                                    className="ghost-button"
                                    disabled={isSearchingCandidates || isSavingCorrection}
                                    onClick={() => {
                                      void openCorrectionEditor(
                                        buildCorrectionEditorTargetFromJournal(journal, selectedBankId, config),
                                      )
                                    }}
                                  >
                                    Editar
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="col-12">
            <div className="surface-card card">
              <div className="card-body">
                <div className="eyebrow">Exclusiones</div>
                <h3 className="h5 mb-3">Movimientos que no entran al analisis actual</h3>
                <div className="summary-list">
                  {result.excludedBuckets.length > 0 ? (
                    result.excludedBuckets.map((bucket) => (
                      <div key={bucket.code} className="summary-list__item">
                        <span>{bucket.label}</span>
                        <strong>
                          {bucket.count}
                          {bucket.amount !== undefined && bucket.amount !== null ? ` · ${formatMoney(bucket.amount)}` : ''}
                        </strong>
                      </div>
                    ))
                  ) : (
                    <div className="text-secondary">Todo el periodo seleccionado entro a evaluacion.</div>
                  )}
                </div>

                {excludedTypeMovements.length > 0 ? (
                  <div className="mt-3">
                    <div className="analysis-card__header mb-3">
                      <div>
                        <div className="eyebrow">Fuera Del Flujo</div>
                        <h4 className="h6 mb-1">Movimientos del periodo que no entraron al lote automatico</h4>
                        <p className="text-secondary mb-0">
                          Aqui aparecen las filas que si afectan el saldo del periodo, pero que hoy quedan
                          fuera del flujo operativo actual. Si faltaban 2 por cargar, deberian verse aqui.
                        </p>
                      </div>
                      <div className="analysis-card__meta">
                        <div className="status-pill status-pill--review">
                          {excludedTypeMovements.length} fuera del flujo
                        </div>
                      </div>
                    </div>

                    <div className="table-responsive analysis-table analysis-table--compact">
                      <table className="table align-middle mb-0">
                        <thead>
                          <tr>
                            <th>Fecha</th>
                            <th>Tipo</th>
                            <th>Contraparte</th>
                            <th>Monto</th>
                            <th>Motivo</th>
                            <th>Referencia</th>
                          </tr>
                        </thead>
                        <tbody>
                          {excludedTypeMovements.map((item) => (
                            <tr key={`${item.transactionDate}-${item.transactionType}-${item.hashId ?? item.referenceNumber ?? item.trackingKey ?? item.counterpartyName}-${item.amount}`}>
                              <td>{item.transactionDate}</td>
                              <td>{item.transactionType}</td>
                              <td>
                                {hasDisplayCounterpartyName(item) ? (
                                  <div className="invoice-raw-meta">
                                    <strong>{getDisplayCounterpartyName(item)}</strong>
                                    <span>{getCounterpartySourceLabel(item.counterpartySource)}</span>
                                    {getCounterpartySupportingText(item) ? (
                                      <span>{getCounterpartySupportingText(item)}</span>
                                    ) : null}
                                  </div>
                                ) : (
                                  '--'
                                )}
                              </td>
                              <td>{formatMoney(item.amount)}</td>
                              <td className="analysis-break">{item.reason}</td>
                              <td className="analysis-break">
                                {item.paymentConcept ?? item.referenceNumber ?? item.trackingKey ?? '--'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="col-12">
            <div className="surface-card card table-panel">
              <div className="card-body">
                <div className="analysis-card__header mb-3">
                    <div>
                      <div className="eyebrow">Pendientes</div>
                      <h3 className="h5 mb-1">Contrapartes sin equivalencia directa</h3>
                      <p className="text-secondary mb-0">
                        Estos movimientos cumplen con fecha, tipo y estado, pero aun no se pueden convertir en
                        diario porque falta su homologacion en la tabla actual de equivalencias.
                      </p>
                    </div>
                    <div className="analysis-card__meta">
                      <div className="status-pill status-pill--review">{result.unmatched.length} pendientes</div>
                    </div>
                </div>

                <div className="table-responsive analysis-table">
                  <table className="table align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Tipo</th>
                        <th>Hoja equivalencia</th>
                        <th>Contraparte</th>
                        <th>Monto</th>
                        <th>Concepto</th>
                        <th>RFC</th>
                        <th>Correccion</th>
                        <th>Propuesta fase 1</th>
                        <th>Motivo</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.unmatched.length > 0 ? (
                        result.unmatched.map((item) => (
                          <tr key={item.correctionKey}>
                            <td>{item.transactionDate}</td>
                            <td>{item.transactionType}</td>
                            <td>{item.mappingSheetName ?? 'Pendiente especial'}</td>
                            <td>
                              {item.suggestedCandidate?.candidateSource === 'cot_ov' ? (
                                <div className="invoice-raw-meta">
                                  <strong className={getSuggestedCounterpartyClassName(item.suggestedCandidate)}>
                                    {item.suggestedCandidate.netsuiteName}
                                  </strong>
                                  <span>{getCandidateSourceLabel(item.suggestedCandidate)}</span>
                                  {getCotOvSupportingText(item.suggestedCandidate) ? (
                                    <span>{getCotOvSupportingText(item.suggestedCandidate)}</span>
                                  ) : null}
                                  {hasDisplayCounterpartyName(item) ? (
                                    <span>
                                      {getCounterpartySourceLabel(item.counterpartySource)}: {getDisplayCounterpartyName(item)}
                                    </span>
                                  ) : null}
                                  {getCounterpartySupportingText(item) ? (
                                    <span>{getCounterpartySupportingText(item)}</span>
                                  ) : null}
                                </div>
                              ) : hasDisplayCounterpartyName(item) ? (
                                <div className="invoice-raw-meta">
                                  <strong>{getDisplayCounterpartyName(item)}</strong>
                                  <span>{getCounterpartySourceLabel(item.counterpartySource)}</span>
                                  {getCounterpartySupportingText(item) ? (
                                    <span>{getCounterpartySupportingText(item)}</span>
                                  ) : null}
                                </div>
                              ) : null}
                            </td>
                            <td>{formatMoney(item.amount)}</td>
                            <td className="analysis-break">{item.paymentConcept ?? '--'}</td>
                            <td>{item.rfc ?? '--'}</td>
                            <td>
                              <button
                                type="button"
                                className="ghost-button ghost-button--inline"
                                disabled={isSearchingCandidates || isSavingCorrection}
                                onClick={() => {
                                  void openCorrectionEditor(buildCorrectionEditorTargetFromUnmatchedRow(item))
                                }}
                              >
                                {item.suggestedCandidate ? 'Revisar / corregir' : 'Abrir manual'}
                              </button>
                            </td>
                            <td>
                              {item.suggestedCandidate ? (
                                <div className="invoice-raw-meta">
                                  <strong>{item.suggestedCandidate.netsuiteName}</strong>
                                  {getCandidatePostingDisplayName(item.suggestedCandidate) ? (
                                    <span>
                                      En NetSuite se vera como {getCandidatePostingDisplayName(item.suggestedCandidate)}
                                    </span>
                                  ) : null}
                                  <span>{item.suggestedCandidate.creditAccount}</span>
                                  <span>
                                    {item.suggestedCandidate.scoreLabel} · {item.suggestedCandidate.reason}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-secondary">Sin propuesta automatica</span>
                              )}
                            </td>
                            <td>{item.reason}</td>
                            <td>
                              <div className="d-flex flex-column gap-2">
                                {item.suggestedCandidate ? (
                                  <>
                                    <button
                                    type="button"
                                    className="ghost-button"
                                    disabled={isSavingCorrection}
                                    onClick={() => {
                                        const correctionTarget = buildCorrectionEditorTargetFromUnmatchedRow(item)
                                        void applyTransientCorrection(
                                          correctionTarget,
                                          item.suggestedCandidate!,
                                          resolveCorrectionPayloadCounterpartyName(correctionTarget),
                                        )
                                    }}
                                  >
                                    {isSavingCorrection ? 'Aplicando...' : 'Unica'}
                                    </button>
                                    <button
                                    type="button"
                                    className="ghost-button"
                                    disabled={isSavingCorrection || !canPersistSuggestedCandidate(item.suggestedCandidate!)}
                                    onClick={() => {
                                        if (canPersistSuggestedCandidate(item.suggestedCandidate!)) {
                                          void saveCorrection(
                                            buildCorrectionEditorTargetFromUnmatchedRow(item),
                                            item.suggestedCandidate!,
                                          )
                                        }
                                    }}
                                  >
                                    {isSavingCorrection
                                      ? 'Guardando...'
                                      : canPersistSuggestedCandidate(item.suggestedCandidate!)
                                        ? 'Guardar'
                                        : 'No guardar'}
                                    </button>
                                  </>
                                ) : null}
                                <button
                                  type="button"
                                  className="ghost-button"
                                  disabled={isSearchingCandidates || isSavingCorrection}
                                  onClick={() => {
                                    void openCorrectionEditor(buildCorrectionEditorTargetFromUnmatchedRow(item))
                                  }}
                                >
                                  Corregir manual
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={11} className="text-secondary">
                            Todas las contrapartes elegibles encontraron homologacion.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {activeCorrectionTarget ? (
                  <div className="border rounded p-3 mt-3">
                    <div className="analysis-card__header mb-3">
                      <div>
                        <div className="eyebrow">Correccion Manual</div>
                        <h3 className="h6 mb-1">{getCorrectionTargetLabel(activeCorrectionTarget)}</h3>
                        <p className="text-secondary mb-0">
                          Puedes elegir cualquier entidad de NetSuite que corresponda a la naturaleza real del
                          movimiento. <strong>Unica</strong> aplica solo a este analisis y <strong>Guardar</strong>{' '}
                          deja la equivalencia disponible para el futuro. La opcion <strong>Unica</strong> solo afecta
                          al movimiento seleccionado, no a todas las coincidencias del mismo nombre.
                        </p>
                        {hasDisplayCounterpartyName(activeCorrectionTarget) ||
                        getCounterpartySupportingText(activeCorrectionTarget) ||
                        activeCorrectionTarget.orderingPartyRfc ? (
                          <div className="invoice-raw-meta mt-3">
                            {hasDisplayCounterpartyName(activeCorrectionTarget) ? (
                              <span>{getCounterpartySourceLabel(activeCorrectionTarget.counterpartySource)}</span>
                            ) : null}
                            {getCounterpartySupportingText(activeCorrectionTarget) ? (
                              <span>{getCounterpartySupportingText(activeCorrectionTarget)}</span>
                            ) : null}
                            {activeCorrectionTarget.orderingPartyRfc ? (
                              <span>RFC ordenante: {activeCorrectionTarget.orderingPartyRfc}</span>
                            ) : null}
                          </div>
                        ) : null}
                        {activeCorrectionTarget.currentMatch ? (
                          <div className="alert alert-info mt-3 mb-0">
                            Homologacion actual: <strong>{activeCorrectionTarget.currentMatch.netsuiteName}</strong>{' '}
                            con cuenta <strong>{activeCorrectionTarget.currentMatch.creditAccount}</strong> (
                            {activeCorrectionTarget.currentMatch.sourceLabel}).
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="row g-3 align-items-end">
                      <div className="col-lg-5">
                        <label className="bank-field mb-0">
                          <span>Buscar equivalencia</span>
                          <input
                            className="bank-input"
                            value={candidateQuery}
                            onChange={(event) => setCandidateQuery(event.target.value)}
                            placeholder="Nombre banco, RFC o entidad NetSuite"
                          />
                        </label>
                      </div>
                      <div className="col-lg-4">
                        <label className="bank-field mb-0">
                          <span>Cuenta homologada</span>
                          <input
                            className="bank-input"
                            value={customCreditAccount}
                            onChange={(event) => setCustomCreditAccount(event.target.value)}
                            placeholder="Ej. 201-01-00 Proveedores : Proveedores nacionales de materia prima"
                          />
                        </label>
                      </div>
                      <div className="col-lg-3">
                        <button
                          type="button"
                          className="ghost-button w-100"
                          disabled={isSearchingCandidates}
                          onClick={() => {
                            void handleSearchCandidates(activeCorrectionTarget)
                          }}
                        >
                          {isSearchingCandidates ? 'Buscando...' : 'Buscar opciones'}
                        </button>
                      </div>
                    </div>

                    <p className="text-secondary mt-2 mb-0">
                      Si cambias la cuenta homologada, los botones <strong>Unica</strong> y <strong>Guardar</strong>{' '}
                      la aplicaran aunque el candidato sugiera otra distinta.
                    </p>

                    {canLookupBanxicoSuggestion(selectedBankId, activeCorrectionTarget) ? (
                      <div className="border rounded p-3 mt-3">
                        <div className="d-flex flex-wrap justify-content-between gap-3 align-items-start">
                          <div>
                            <div className="eyebrow">Banxico CEP</div>
                            <strong>{selectedBankId === 'bbva' ? 'Ordenante del SPEI' : 'Ordenante del deposito'}</strong>
                            <p className="text-secondary mb-0">
                              Consulta el CEP de este movimiento para intentar recuperar el nombre real del
                              ordenante y reutilizarlo en la homologacion manual.
                            </p>
                          </div>
                          <button
                            type="button"
                            className="ghost-button"
                            disabled={isLookingUpBanxicoSuggestion}
                            onClick={() => {
                              void handleLookupBanxicoSuggestion(activeCorrectionTarget)
                            }}
                          >
                            {isLookingUpBanxicoSuggestion ? 'Consultando Banxico...' : 'Consultar ordenante'}
                          </button>
                        </div>

                        {banxicoSuggestion ? (
                          <div className="invoice-raw-meta mt-3">
                            <strong>{banxicoSuggestion.orderingParty?.name ?? 'Ordenante sin nombre util'}</strong>
                            <span>
                              {[
                                banxicoSuggestion.orderingParty?.bankName,
                                banxicoSuggestion.orderingParty?.account
                                  ? `cta ${banxicoSuggestion.orderingParty.account}`
                                  : null,
                                banxicoSuggestion.orderingParty?.rfc,
                                banxicoSuggestion.trackingKey ? `rastreo ${banxicoSuggestion.trackingKey}` : null,
                              ]
                                .filter(Boolean)
                                .join(' | ')}
                            </span>
                          </div>
                        ) : null}

                        {banxicoSuggestionMessage ? (
                          <div className="alert alert-info mt-3 mb-0">{banxicoSuggestionMessage}</div>
                        ) : null}
                      </div>
                    ) : null}

                    {activeCorrectionTarget.currentMatch ? (
                      <div className="d-flex flex-wrap gap-2 mt-3">
                        <button
                          type="button"
                          className="ghost-button"
                          disabled={isSavingCorrection}
                          onClick={() => {
                            void applyCurrentMatchCorrection(activeCorrectionTarget)
                          }}
                        >
                          {isSavingCorrection ? 'Aplicando...' : 'Unica entidad actual'}
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          disabled={isSavingCorrection}
                          onClick={() => {
                            void saveCurrentMatchCorrection(activeCorrectionTarget)
                          }}
                        >
                          {isSavingCorrection ? 'Guardando...' : 'Guardar entidad actual'}
                        </button>
                      </div>
                    ) : null}

                    {candidateError ? <div className="alert alert-warning mt-3 mb-0">{candidateError}</div> : null}

                    <div className="table-responsive analysis-table mt-3">
                      <table className="table align-middle mb-0">
                        <thead>
                          <tr>
                            <th>Nombre catalogo</th>
                            <th>Entidad NetSuite</th>
                            <th>Hoja</th>
                            <th>Cuenta</th>
                            <th>Origen</th>
                            <th>Afinidad</th>
                            <th>Accion</th>
                          </tr>
                        </thead>
                        <tbody>
                          {candidateResults.length > 0 ? (
                            candidateResults.map((candidate) => (
                              <tr
                                key={`${candidate.mappingSheetKey}-${candidate.candidateSource}-${candidate.bankName}-${candidate.netsuiteName}-${candidate.creditAccount}`}
                              >
                                <td>{candidate.bankName}</td>
                                <td>
                                  <div className="invoice-raw-meta">
                                    <strong>{candidate.netsuiteName}</strong>
                                    {getCandidatePostingDisplayName(candidate) ? (
                                      <span>En NetSuite se vera como {getCandidatePostingDisplayName(candidate)}</span>
                                    ) : null}
                                  </div>
                                </td>
                                <td>{candidate.mappingSheetName}</td>
                                <td>
                                  <div className="invoice-raw-meta">
                                    <strong>{resolveCandidateCreditAccount(candidate, customCreditAccount)}</strong>
                                    {hasManualCreditAccountOverride(candidate, customCreditAccount) ? (
                                      <span>Se aplicara la cuenta escrita manualmente.</span>
                                    ) : null}
                                  </div>
                                </td>
                                <td>{getCandidateSourceLabel(candidate)}</td>
                                <td>
                                  <div className="invoice-raw-meta">
                                    <strong>{candidate.scoreLabel}</strong>
                                    <span>{candidate.reason}</span>
                                  </div>
                                </td>
                                <td>
                                  <div className="d-flex flex-column gap-2">
                                    <button
                                    type="button"
                                    className="ghost-button"
                                    disabled={isSavingCorrection}
                                    onClick={() => {
                                        void applyTransientCorrection(
                                          activeCorrectionTarget,
                                          candidate,
                                          getEffectiveCounterpartyName(activeCorrectionTarget),
                                        )
                                    }}
                                  >
                                    {isSavingCorrection ? 'Aplicando...' : 'Unica'}
                                    </button>
                                    <button
                                    type="button"
                                    className="ghost-button"
                                    disabled={isSavingCorrection || !canPersistSuggestedCandidate(candidate)}
                                    onClick={() => {
                                        if (canPersistSuggestedCandidate(candidate)) {
                                          void saveCorrection(
                                            activeCorrectionTarget,
                                            candidate,
                                            getEffectiveCounterpartyName(activeCorrectionTarget),
                                          )
                                        }
                                    }}
                                  >
                                    {isSavingCorrection
                                      ? 'Guardando...'
                                      : canPersistSuggestedCandidate(candidate)
                                        ? 'Guardar'
                                        : 'No guardar'}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={6} className="text-secondary">
                                Todavia no hay resultados para esta correccion.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </>
      ) : null}
      <div className="col-12">
        <div className="surface-card card">
          <div className="card-body">
            <div className="eyebrow">Reglas Activas</div>
            <div className="summary-list">
              <div className="summary-list__item">
                <span>Banco activo</span>
                <strong>{selectedBankLabel}</strong>
              </div>
              <div className="summary-list__item">
                <span>Fuente esperada</span>
                <strong>{selectedBankProfile.expectedSourceLabel}</strong>
              </div>
              <div className="summary-list__item">
                <span>Clientes / Cobro</span>
                <strong>{config?.clientMapping.sheetName ?? 'Ingresos (Clientes)'}</strong>
              </div>
              <div className="summary-list__item">
                <span>Proveedores / Anticipo, Pago</span>
                <strong>{config?.providerMapping.sheetName ?? 'Proveedores'}</strong>
              </div>
              <div className="summary-list__item">
                <span>Archivo de equivalencias</span>
                <strong>
                  {config?.clientMapping.workbookName ?? config?.providerMapping.workbookName ?? 'CargaPagosModelo.xlsx'}
                </strong>
              </div>
              <div className="summary-list__item">
                <span>Equivalencias cargadas</span>
                <strong>
                  {(config?.clientMapping.totalMappings ?? 0) + (config?.providerMapping.totalMappings ?? 0)}
                </strong>
              </div>
              <div className="summary-list__item">
                <span>Filtro inicial</span>
                <strong>{selectedBankProfile.intakeSummary}</strong>
              </div>
              <div className="summary-list__item">
                <span>Barrido adicional</span>
                <strong>Registro bancario configurado en NetSuite solo dentro del periodo contable seleccionado</strong>
              </div>
              <div className="summary-list__item">
                <span>Nomina</span>
                <strong>Solo verificacion contra NetSuite</strong>
              </div>
              <div className="summary-list__item">
                <span>Reembolso</span>
                <strong>Clientes al debito / banco al credito</strong>
              </div>
              <div className="summary-list__item">
                <span>Notas del banco</span>
                <strong>{selectedBankProfile.specialSummary}</strong>
              </div>
              <div className="summary-list__item">
                <span>Resultado esperado</span>
                <strong>Preview pendiente real, hoja aplicada y pendientes de homologacion</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
      {netsuiteAccountCatalog?.items.length ? (
        <datalist id={READY_ACCOUNT_DATALIST_ID}>
          {netsuiteAccountCatalog.items.map((account) => (
            <option key={account.internalId} value={account.displayName} />
          ))}
        </datalist>
      ) : null}
    </div>
  )
}

function getBankRouteSegment(bankId: BankImportBankId) {
  return BANK_ROUTE_SEGMENTS[bankId] ?? BANK_ROUTE_SEGMENTS[FALLBACK_BANK_ID]
}

function resolveBankIdFromRoute(bankSlug?: string, banks?: BankImportBank[]) {
  const availableBankIds = new Set((banks ?? []).map((bank) => bank.id))
  const matchedBankId = (Object.entries(BANK_ROUTE_SEGMENTS).find(([, routeSegment]) => routeSegment === bankSlug)?.[0] ??
    null) as BankImportBankId | null

  if (matchedBankId && (availableBankIds.size === 0 || availableBankIds.has(matchedBankId))) {
    return matchedBankId
  }

  return banks?.[0]?.id ?? FALLBACK_BANK_ID
}

function getInitialBankViewState(bankSlug?: string) {
  const bankId = resolveBankIdFromRoute(bankSlug)
  const cachedState = readStoredBankViewState(bankId)
  const shouldDeferCachedResult = Boolean(cachedState?.uploadedFile || cachedState?.analysisRunId)

  return {
    bankId,
    accountingPeriod: resolveAccountingPeriodValue(
      cachedState?.accountingPeriod ?? null,
      cachedState?.cutoffDate ?? null,
    ),
    result: shouldDeferCachedResult ? null : normalizeBankImportAnalyzeResponse(cachedState?.result ?? null),
    transientCorrections: cachedState?.transientCorrections ?? [],
    heldReadyCorrectionKeys: cachedState?.heldReadyCorrectionKeys ?? [],
    postedReadyJournalExternalIds: cachedState?.postedReadyJournalExternalIds ?? [],
    uploadedFile: cachedState?.uploadedFile ?? null,
    analysisRunId: cachedState?.analysisRunId ?? null,
    analysisMode: resolveAnalysisModeForBank(bankId, cachedState?.analysisMode),
  }
}

function readStoredBankViewState(bankId: BankImportBankId): StoredBankViewState | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.sessionStorage.getItem(BANK_VIEW_STORAGE_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<Record<BankImportBankId, StoredBankViewState>>
    return parsed[bankId] ?? null
  } catch {
    return null
  }
}

function writeStoredBankViewState(bankId: BankImportBankId, state: StoredBankViewState) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const raw = window.sessionStorage.getItem(BANK_VIEW_STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<Record<BankImportBankId, StoredBankViewState>>) : {}

    parsed[bankId] = state
    window.sessionStorage.setItem(BANK_VIEW_STORAGE_KEY, JSON.stringify(parsed))
  } catch {
    // Ignore storage errors and keep the page functional.
  }
}

function resolveAccountingPeriodValue(
  accountingPeriod?: string | null,
  fallbackValue?: string | null,
) {
  const normalizedPeriod = normalizeAccountingPeriodValue(accountingPeriod)
  if (normalizedPeriod) {
    return normalizedPeriod
  }

  return normalizeAccountingPeriodValue(fallbackValue)
}

function normalizeBankImportAnalyzeResponse(result: BankImportAnalyzeResponse | null) {
  if (!result) {
    return null
  }

  return {
    ...result,
    excludedTypeMovements: Array.isArray(result.excludedTypeMovements) ? result.excludedTypeMovements : [],
  }
}

function normalizeAccountingPeriodValue(value?: string | null) {
  const normalizedValue = cleanText(value)
  if (!normalizedValue) {
    return ''
  }

  const match = /^(\d{4})-(\d{2})/.exec(normalizedValue)
  if (!match) {
    return ''
  }

  const month = Number(match[2])
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return ''
  }

  return `${match[1]}-${match[2]}`
}

function formatAccountingPeriodLabel(value?: string | null) {
  const normalizedValue = normalizeAccountingPeriodValue(value)
  if (!normalizedValue) {
    return '--'
  }

  const [yearText, monthText] = normalizedValue.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const parsed = new Date(year, month - 1, 1)
  if (Number.isNaN(parsed.getTime())) {
    return normalizedValue
  }

  return parsed.toLocaleDateString('es-MX', {
    month: 'long',
    year: 'numeric',
  })
}

function areStringArraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function buildTransientCorrection(
  row: CorrectionEditorTarget,
  candidate: BankImportSuggestedCandidate,
  counterpartyNameOverride?: string,
): BankImportTransientCorrection {
  const resolvedCounterpartyName =
    cleanText(counterpartyNameOverride) ||
    cleanText(row.counterpartyName) ||
    cleanText(row.orderingPartyName) ||
    cleanText(row.statementCounterpartyName) ||
    cleanText(row.paymentConcept) ||
    cleanText(candidate.bankName) ||
    cleanText(candidate.netsuiteName)

  return {
    correctionKey: row.correctionKey,
    counterpartyName: resolvedCounterpartyName,
    mappingSheetKey: candidate.mappingSheetKey,
    bankName: candidate.bankName,
    netsuiteName: candidate.netsuiteName,
    creditAccount: candidate.creditAccount,
    entityInternalId: candidate.entityInternalId ?? null,
    postingDisplayName: candidate.postingDisplayName ?? null,
  }
}

function buildCorrectionEditorTargetFromUnmatchedRow(row: BankImportUnmatchedRow): CorrectionEditorTarget {
  return {
    correctionKey: row.correctionKey,
    transactionType: row.transactionType,
    mappingSheetKey: row.mappingSheetKey,
    mappingSheetName: row.mappingSheetName,
    transactionDate: row.transactionDate,
    processingTimestamp: row.processingTimestamp,
    counterpartyName: row.counterpartyName,
    statementCounterpartyName: row.statementCounterpartyName,
    counterpartySource: row.counterpartySource,
    orderingPartyName: row.orderingPartyName,
    orderingPartyRfc: row.orderingPartyRfc,
    orderingPartyAccount: row.orderingPartyAccount,
    amount: row.amount,
    paymentConcept: row.paymentConcept,
    rfc: row.rfc,
    trackingKey: row.trackingKey,
    referenceNumber: row.referenceNumber,
    originBankName: row.originBankName,
    destinationBankName: row.destinationBankName,
    destinationAccount: row.destinationAccount,
    hashId: row.hashId,
    suggestedCandidate: row.suggestedCandidate,
    currentMatch: null,
  }
}

function buildCorrectionEditorTargetFromJournal(
  journal: BankImportJournalPreview,
  bankId: BankImportBankId,
  config: BankImportConfigResponse | null,
): CorrectionEditorTarget {
  const mappingSheetKey =
    journal.creditEntitySheetKey ??
    journal.debitEntitySheetKey ??
    resolveMappingSheetKeyForTransactionType(journal.transactionType, config)

  return {
    correctionKey: getJournalCorrectionKey(journal, bankId, config),
    transactionType: journal.transactionType,
    mappingSheetKey,
    mappingSheetName: journal.mappingSheetName,
    transactionDate: journal.transactionDate,
    processingTimestamp: journal.processingTimestamp,
    counterpartyName: journal.counterpartyName,
    statementCounterpartyName: journal.statementCounterpartyName,
    counterpartySource: journal.counterpartySource,
    orderingPartyName: journal.orderingPartyName,
    orderingPartyRfc: journal.orderingPartyRfc,
    orderingPartyAccount: journal.orderingPartyAccount,
    amount: journal.amount,
    paymentConcept: journal.paymentConcept,
    rfc: journal.rfc,
    trackingKey: journal.trackingKey,
    referenceNumber: journal.referenceNumber,
    originBankName: journal.originBankName,
    destinationBankName: journal.destinationBankName,
    destinationAccount: journal.destinationAccount,
    hashId: journal.hashId,
    suggestedCandidate: null,
    currentMatch: {
      netsuiteName: journal.netsuiteName,
      creditAccount: journal.mappedAccount,
      sourceLabel: getMappingMethodLabel(journal.mappingMethod),
      entityInternalId: journal.creditEntityInternalId ?? journal.debitEntityInternalId ?? null,
      postingDisplayName: journal.postingDisplayName ?? journal.creditEntityDisplayName ?? journal.debitEntityDisplayName ?? null,
    },
  }
}

function getReadyJournalDraftKey(journal: BankImportJournalPreview) {
  return journal.correctionKey || journal.externalId
}

function getReadyJournalCreditAccountDraft(
  journal: BankImportJournalPreview,
  drafts: ReadyJournalAccountDrafts,
) {
  return drafts[getReadyJournalDraftKey(journal)] ?? journal.mappedAccount
}

function resolveInitialCreditAccountForTarget(target: CorrectionEditorTarget) {
  return target.currentMatch?.creditAccount ?? target.suggestedCandidate?.creditAccount ?? ''
}

function normalizeManualCreditAccount(value: string) {
  return value.trim()
}

function resolveCandidateCreditAccount(candidate: BankImportSuggestedCandidate, customAccount: string) {
  return normalizeManualCreditAccount(customAccount) || candidate.creditAccount
}

function hasManualCreditAccountOverride(candidate: BankImportSuggestedCandidate, customAccount: string) {
  const resolvedAccount = normalizeManualCreditAccount(customAccount)
  return Boolean(resolvedAccount) && resolvedAccount !== candidate.creditAccount
}

function buildEditableCandidate(candidate: BankImportSuggestedCandidate, customAccount: string): BankImportSuggestedCandidate {
  const resolvedAccount = resolveCandidateCreditAccount(candidate, customAccount)
  const candidateSource = resolvedAccount !== candidate.creditAccount ? 'manual' : candidate.candidateSource

  return {
    ...candidate,
    candidateSource,
    creditAccount: resolvedAccount,
  }
}

function buildCurrentMatchCandidate(
  target: CorrectionEditorTarget,
  config: BankImportConfigResponse | null,
  customAccount: string,
): BankImportSuggestedCandidate | null {
  if (!target.currentMatch || !target.mappingSheetKey) {
    return null
  }

  const creditAccount = normalizeManualCreditAccount(customAccount) || target.currentMatch.creditAccount
  if (!creditAccount) {
    return null
  }

  return {
    mappingSheetKey: target.mappingSheetKey,
    mappingSheetName: target.mappingSheetName ?? resolveMappingSheetName(target.mappingSheetKey, config),
    candidateSource: 'manual',
    bankName: target.counterpartyName,
    netsuiteName: target.currentMatch.netsuiteName,
    creditAccount,
    entityInternalId: target.currentMatch.entityInternalId ?? null,
    postingDisplayName: target.currentMatch.postingDisplayName ?? null,
    score: 1,
    scoreLabel: 'Actual',
    suggestionMethod: 'netsuite_entity',
    reason:
      creditAccount === target.currentMatch.creditAccount
        ? 'Reutiliza la entidad actual del movimiento.'
        : 'Reutiliza la entidad actual con una cuenta homologada ajustada manualmente.',
  }
}

function getJournalCorrectionKey(
  journal: BankImportJournalPreview,
  bankId: BankImportBankId,
  config: BankImportConfigResponse | null,
) {
  if (journal.correctionKey) {
    return journal.correctionKey
  }

  return buildClientCorrectionKey(bankId, resolveMappingSheetKeyForTransactionType(journal.transactionType, config), journal.externalId)
}

function buildClientCorrectionKey(bankId: BankImportBankId, mappingSheetKey: string | null, externalId: string) {
  return `${bankId}:${mappingSheetKey ?? 'special'}:${String(externalId ?? '').trim()}`
}

function extractExternalIdFromCorrectionKey(correctionKey: string) {
  const parts = String(correctionKey ?? '').trim().split(':')
  if (parts.length >= 4) {
    return parts.slice(3).join(':')
  }

  if (parts.length >= 3) {
    return parts.slice(2).join(':')
  }

  return String(correctionKey ?? '').trim()
}

function resolveMappingSheetKeyForTransactionType(transactionType: string, config: BankImportConfigResponse | null) {
  const normalizedTransactionType = normalizeComparisonText(transactionType)
  return (
    config?.transactionRules.find(
      (rule) => normalizeComparisonText(rule.transactionType) === normalizedTransactionType,
    )?.mappingSheetKey ?? null
  )
}

function resolveMappingSheetName(
  mappingSheetKey: BankImportConfigResponse['mappingSheets'][number]['key'],
  config: BankImportConfigResponse | null,
) {
  return config?.mappingSheets.find((sheet) => sheet.key === mappingSheetKey)?.sheetName ?? mappingSheetKey
}

function normalizeComparisonText(value: string | null | undefined) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toUpperCase()
}

function cleanText(value: string | null | undefined) {
  return String(value ?? '').trim()
}

function hasResolvedCounterpartyName(value: string | null | undefined) {
  return cleanText(value).length > 0
}

function isNetSuitePeriodOnlyRow(target: { rowOrigin?: 'analysis_match' | 'manual_override' | 'period_only' }) {
  return target.rowOrigin === 'period_only'
}

function looksLikeStatementOperationDescriptor(value: string | null | undefined) {
  const normalizedValue = normalizeComparisonText(value)
  return (
    normalizedValue === 'DEPOSIT' ||
    normalizedValue.startsWith('DEPOSIT REF ') ||
    normalizedValue.startsWith('DEPOSITO EN EFECTIVO') ||
    normalizedValue.startsWith('COMPENSACION POR RETRASO') ||
    normalizedValue.startsWith('ORDEN DE PAGO EXTRANJERO') ||
    normalizedValue.startsWith('PAGO CUENTA DE TERCERO') ||
    normalizedValue.startsWith('PAGO DE PRESTAMO') ||
    normalizedValue.startsWith('IMSS INF AFORE') ||
    normalizedValue.startsWith('SERV BANCA INTERNET') ||
    normalizedValue.startsWith('IVA COM SERV BCA INTERNET')
  )
}

function getDisplayCounterpartyName(target: {
  counterpartyName: string | null | undefined
  counterpartySource?: BankImportCounterpartySource | null
}) {
  const counterpartyName = cleanText(target.counterpartyName)
  if (!counterpartyName) {
    return ''
  }

  if (target.counterpartySource === 'statement' && looksLikeStatementOperationDescriptor(counterpartyName)) {
    return ''
  }

  return counterpartyName
}

function hasDisplayCounterpartyName(target: {
  counterpartyName: string | null | undefined
  counterpartySource?: BankImportCounterpartySource | null
}) {
  return cleanText(getDisplayCounterpartyName(target)).length > 0
}

function getCorrectionTargetLabel(target: {
  counterpartyName: string | null | undefined
  counterpartySource?: BankImportCounterpartySource | null
  paymentConcept?: string | null
}) {
  const counterpartyName = getDisplayCounterpartyName(target)
  if (counterpartyName) {
    return counterpartyName
  }

  const paymentConcept = cleanText(target.paymentConcept)
  return paymentConcept || 'Movimiento sin contraparte reconocida'
}

function getCounterpartySourceLabel(source: BankImportCounterpartySource) {
  if (source === 'banxico_counterparty') {
    return 'Contraparte Banxico'
  }

  return source === 'banxico_ordering_party' ? 'Ordenante Banxico' : 'Estado de cuenta'
}

function getCounterpartySupportingText(item: {
  counterpartyName: string
  statementCounterpartyName?: string | null
  counterpartySource?: BankImportCounterpartySource
  originBankName?: string | null
  orderingPartyAccount?: string | null
}) {
  const parts: string[] = []
  const statementCounterpartyName = cleanText(item.statementCounterpartyName)
  const originBankName = cleanText(item.originBankName)
  const orderingPartyAccount = cleanText(item.orderingPartyAccount)

  if (item.counterpartySource && item.counterpartySource !== 'statement' && statementCounterpartyName) {
    if (statementCounterpartyName !== cleanText(item.counterpartyName)) {
      parts.push(`Descriptor banco: ${statementCounterpartyName}`)
    }
  }

  if (originBankName) {
    parts.push(`Intermediario: ${originBankName}`)
  }

  if (orderingPartyAccount) {
    parts.push(`Cuenta ordenante: ${orderingPartyAccount}`)
  }

  return parts.join(' · ')
}

function canPersistSuggestedCandidate(candidate: BankImportSuggestedCandidate) {
  return candidate.candidateSource !== 'cot_ov'
}

function getSuggestedCounterpartyClassName(candidate: BankImportSuggestedCandidate) {
  if (candidate.candidateSource !== 'cot_ov') {
    return ''
  }

  return candidate.matchKind === 'close'
    ? 'counterparty-proposal counterparty-proposal--close'
    : 'counterparty-proposal counterparty-proposal--exact'
}

function getCotOvSupportingText(candidate: BankImportSuggestedCandidate) {
  if (candidate.candidateSource !== 'cot_ov') {
    return ''
  }

  const transactionLabel = candidate.supportingTransactionType === 'sales_order' ? 'OV' : 'Cotizacion'
  return [
    `${transactionLabel} ${candidate.matchKind === 'close' ? '+/-$1.00' : 'exacta'}`,
    cleanText(candidate.supportingTransactionNumber)
      ? `Doc. ${cleanText(candidate.supportingTransactionNumber)}`
      : null,
    cleanText(candidate.supportingTransactionDate) || null,
  ]
    .filter(Boolean)
    .join(' | ')
}

function getCandidatePostingDisplayName(candidate: BankImportSuggestedCandidate) {
  const postingDisplayName = cleanText(candidate.postingDisplayName)
  return postingDisplayName && postingDisplayName !== cleanText(candidate.netsuiteName) ? postingDisplayName : ''
}

function getJournalPostingDisplayName(journal: BankImportJournalPreview) {
  const postingDisplayName = cleanText(
    journal.postingDisplayName ?? journal.creditEntityDisplayName ?? journal.debitEntityDisplayName,
  )
  return postingDisplayName && postingDisplayName !== cleanText(journal.netsuiteName) ? postingDisplayName : ''
}

function canLookupBanxicoSuggestion(bankId: BankImportBankId, target: CorrectionEditorTarget) {
  const normalizedTransactionType = normalizeComparisonText(target.transactionType)
  const normalizedConcept = normalizeComparisonText(target.paymentConcept)

  if (bankId === 'bbva') {
    return (
      normalizedTransactionType === 'COBRO' &&
      normalizedConcept.startsWith('SPEI') &&
      Boolean(target.transactionDate) &&
      typeof target.amount === 'number' &&
      target.amount > 0 &&
      Boolean(cleanText(target.originBankName)) &&
      Boolean(cleanText(target.destinationBankName)) &&
      Boolean(cleanText(target.destinationAccount)) &&
      Boolean(cleanText(target.referenceNumber))
    )
  }

  return (
    normalizedTransactionType === 'DEPOSIT' &&
    Boolean(target.transactionDate) &&
    typeof target.amount === 'number' &&
    target.amount > 0 &&
    Boolean(cleanText(target.originBankName)) &&
    Boolean(cleanText(target.destinationBankName)) &&
    Boolean(cleanText(target.destinationAccount)) &&
    Boolean(cleanText(target.trackingKey) || cleanText(target.referenceNumber))
  )
}

function resolveBanxicoInstitutionIdByName(
  catalog: BanxicoCepInstitutionsResponse,
  bankName: string | null | undefined,
) {
  const normalizedBankName = normalizeComparisonText(bankName)
  if (!normalizedBankName) {
    return null
  }

  return (
    [...catalog.institutionsMispei, ...catalog.institutions].find(
      (item) => normalizeComparisonText(item.name) === normalizedBankName,
    )?.id ?? null
  )
}

function isUsefulBanxicoOrderingName(orderingName: string, beneficiaryName: string | null | undefined) {
  const normalizedOrderingName = normalizeComparisonText(orderingName)
  if (!normalizedOrderingName) {
    return false
  }

  if (normalizedOrderingName.includes('SISTEMA DE PAGO') || normalizedOrderingName.includes('BANCOMER SISTEM A DE PAGO')) {
    return false
  }

  if (normalizedOrderingName === normalizeComparisonText(beneficiaryName)) {
    return false
  }

  return normalizedOrderingName.replace(/\s+/g, '').length >= 4
}

function resolveBankSourceProfileId(bankId: BankImportBankId) {
  if (bankId === 'bbva') {
    return 'bbva_pdf'
  }

  if (bankId === 'clara_corriente') {
    return 'clara_account_activity'
  }

  return 'payana_transacciones'
}

function waitFor(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds)
  })
}

function isBankAnalysisAbortError(reason: unknown) {
  return reason instanceof Error && reason.message === BANK_ANALYSIS_ABORT_ERROR
}

function upsertTransientCorrection(
  items: BankImportTransientCorrection[],
  nextItem: BankImportTransientCorrection,
) {
  const filteredItems = items.filter((item) => item.correctionKey !== nextItem.correctionKey)
  return [...filteredItems, nextItem]
}

function removeTransientCorrection(items: BankImportTransientCorrection[], correctionKey: string) {
  return items.filter((item) => item.correctionKey !== correctionKey)
}

function findRecognizedMatchesForTarget(
  result: BankImportAnalyzeResponse,
  target: CorrectionEditorTarget,
): RecognitionSpotlightMatch[] {
  const normalizedCounterparty = normalizeComparisonText(target.counterpartyName)
  const normalizedTransactionType = normalizeComparisonText(target.transactionType)
  const targetAmount = typeof target.amount === 'number' ? target.amount : null

  return result.netsuiteSweep.matches.filter((item) => {
    if (normalizeComparisonText(item.counterpartyName) !== normalizedCounterparty) {
      return false
    }

    if (normalizeComparisonText(item.transactionType) !== normalizedTransactionType) {
      return false
    }

    if (targetAmount === null) {
      return true
    }

    return Math.abs(item.amount - targetAmount) <= 0.01
  })
}

function getRecognizedMovementKey(item: RecognitionSpotlightMatch) {
  return `${item.externalId}:${item.netsuiteTransactionId}`
}

function mergeRecognitionSpotlightMatches(
  currentItems: RecognitionSpotlightMatch[],
  nextItems: RecognitionSpotlightMatch[],
) {
  const merged = new Map(currentItems.map((item) => [getRecognizedMovementKey(item), item]))
  nextItems.forEach((item) => {
    merged.set(getRecognizedMovementKey(item), item)
  })

  return Array.from(merged.values()).sort(
    (left, right) =>
      left.transactionDate.localeCompare(right.transactionDate) ||
      left.counterpartyName.localeCompare(right.counterpartyName) ||
      left.amount - right.amount,
  )
}

function areRecognizedMovementListsEqual(
  leftItems: RecognitionSpotlightMatch[],
  rightItems: RecognitionSpotlightMatch[],
) {
  if (leftItems.length !== rightItems.length) {
    return false
  }

  return leftItems.every((item, index) => getRecognizedMovementKey(item) === getRecognizedMovementKey(rightItems[index]))
}

function extractError(reason: unknown, fallback: string) {
  if (reason instanceof HttpClientError) {
    try {
      const parsed = JSON.parse(reason.body ?? '{}') as { error?: string }
      if (parsed.error) {
        return parsed.error
      }
    } catch {
      return reason.message
    }
    return reason.message
  }

  return reason instanceof Error ? reason.message : fallback
}

function isStoredWorkingFileNotAvailableError(reason: unknown) {
  if (!(reason instanceof HttpClientError) || reason.status !== 404) {
    return false
  }

  try {
    const parsed = JSON.parse(reason.body ?? '{}') as { error?: string }
    return parsed.error?.includes('No hay un archivo bancario resguardado') ?? false
  } catch {
    return false
  }
}

function formatMoney(value: number) {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatSignedMoney(value: number) {
  return `${value >= 0 ? '+' : '-'}${formatMoney(Math.abs(value))}`
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100
}

function parseCurrencyInput(value: string) {
  const normalized = cleanText(value).replace(/\$/g, '').replace(/,/g, '')
  if (!normalized) {
    return null
  }

  const parsed = Number.parseFloat(normalized)
  return Number.isFinite(parsed) ? roundCurrency(parsed) : null
}

function mergeCandidates(
  initialCandidates: BankImportSuggestedCandidate[],
  nextCandidates: BankImportSuggestedCandidate[],
) {
  const merged = new Map<string, BankImportSuggestedCandidate>()

  ;[...initialCandidates, ...nextCandidates].forEach((candidate) => {
    const key = `${candidate.mappingSheetKey}:${candidate.candidateSource}:${candidate.bankName}:${candidate.netsuiteName}:${candidate.creditAccount}`
    const current = merged.get(key)
    if (!current || candidate.score > current.score) {
      merged.set(key, candidate)
    }
  })

  return Array.from(merged.values()).sort(
    (left, right) =>
      right.score - left.score ||
      left.bankName.localeCompare(right.bankName) ||
      left.netsuiteName.localeCompare(right.netsuiteName),
  )
}

function getCandidateSourceLabel(candidate: BankImportSuggestedCandidate) {
  if (candidate.candidateSource === 'cot_ov') {
    return 'Cot / OV'
  }

  if (candidate.candidateSource === 'netsuite') {
    return 'NetSuite directo'
  }

  if (candidate.candidateSource === 'historical') {
    return 'Historico BBVA'
  }

  if (candidate.candidateSource === 'manual') {
    return 'Ajuste manual'
  }

  return candidate.mappingSheetName
}

function getMappingMethodLabel(mappingMethod: 'exact' | 'compact' | 'historical_exact' | 'manual_single' | 'auto_banxico') {
  if (mappingMethod === 'auto_banxico') {
    return 'Auto Banxico'
  }

  if (mappingMethod === 'manual_single') {
    return 'Corrección única'
  }

  if (mappingMethod === 'historical_exact') {
    return 'Historico exacto'
  }

  return mappingMethod === 'compact' ? 'Match compacto' : 'Match exacto'
}

function getRecognitionConfidenceClassName(confidence: 'high' | 'medium' | 'low') {
  if (confidence === 'high') {
    return 'status-pill status-pill--healthy'
  }

  if (confidence === 'medium') {
    return 'status-pill status-pill--review'
  }

  return 'status-pill status-pill--idle'
}

function getDestinationClassName(destinationType: BankImportCreditDestinationType) {
  return `account-kind account-kind--${destinationType}`
}

function getNetSuiteSweepStatusClassName(status: 'applied' | 'unavailable' | 'not_configured') {
  if (status === 'applied') {
    return 'status-pill status-pill--ready'
  }

  if (status === 'unavailable') {
    return 'status-pill status-pill--review'
  }

  return 'status-pill status-pill--idle'
}

function getNetSuiteSweepLabel(status: 'applied' | 'unavailable' | 'not_configured') {
  if (status === 'applied') {
    return 'Barrido aplicado'
  }

  if (status === 'unavailable') {
    return 'Barrido no disponible'
  }

  return 'Barrido no configurado'
}

function getBalanceValidationStatusClassName(status: BankImportBalanceValidation['status']) {
  if (status === 'ok') {
    return 'status-pill status-pill--ready'
  }

  if (status === 'mismatch') {
    return 'status-pill status-pill--exception'
  }

  if (status === 'awaiting_validation' || status === 'partial') {
    return 'status-pill status-pill--review'
  }

  return 'status-pill status-pill--idle'
}

function getBalanceValidationStatusLabel(status: BankImportBalanceValidation['status']) {
  if (status === 'ok') {
    return 'Continuidad OK'
  }

  if (status === 'mismatch') {
    return 'Descuadre'
  }

  if (status === 'awaiting_validation') {
    return 'Pendiente validar'
  }

  if (status === 'partial') {
    return 'Revision parcial'
  }

  if (status === 'unsupported') {
    return 'No aplica'
  }

  return 'Sin ancla previa'
}

function getAnalysisModeLabel(mode: BankImportAnalysisMode) {
  if (mode === 'banxico') {
    return 'Banxico'
  }

  if (mode === 'cot_ov') {
    return 'Cot / OV'
  }

  return 'Estandar'
}

function getAvailableAnalysisModes(bankId: BankImportBankId) {
  return BANK_ANALYSIS_MODE_OPTIONS[bankId] ?? BANK_ANALYSIS_MODE_OPTIONS[FALLBACK_BANK_ID]
}

function resolveAnalysisModeForBank(bankId: BankImportBankId, mode: BankImportAnalysisMode | null | undefined) {
  if (mode && getAvailableAnalysisModes(bankId).includes(mode)) {
    return mode
  }

  return 'standard'
}

function getAnalysisActionLabel(
  mode: BankImportAnalysisMode,
  isRunning: boolean,
  isRefreshingStoredAnalysis: boolean,
) {
  if (mode === 'standard') {
    if (isRunning) {
      return ANALYSIS_MODE_OPTIONS.standard.runningLabel
    }

    return isRefreshingStoredAnalysis ? 'Consultando corrida...' : ANALYSIS_MODE_OPTIONS.standard.label
  }

  return isRunning ? ANALYSIS_MODE_OPTIONS[mode].runningLabel : ANALYSIS_MODE_OPTIONS[mode].label
}

function getPostStatusClassName(status: BankImportPostJournalsResponse['items'][number]['status']) {
  if (status === 'created') {
    return 'status-pill status-pill--ready'
  }

  if (status === 'skipped') {
    return 'status-pill status-pill--idle'
  }

  if (status === 'dry_run') {
    return 'status-pill status-pill--healthy'
  }

  return 'status-pill status-pill--exception'
}

function getPostStatusLabel(status: BankImportPostJournalsResponse['items'][number]['status']) {
  if (status === 'created') {
    return 'Creado'
  }

  if (status === 'skipped') {
    return 'Omitido'
  }

  if (status === 'dry_run') {
    return 'Validado'
  }

  return 'Fallido'
}

function ResizableTableHeaderCell({
  column,
  controller,
}: {
  column: ResizableColumnDefinition
  controller: ResizableTableController
}) {
  return (
    <th className={column.className}>
      <div className="analysis-table__head-cell">
        <span className="analysis-table__head-label">{column.label}</span>
        <button
          type="button"
          className="analysis-table__resize-handle"
          aria-label={`Ajustar ancho de la columna ${column.label}`}
          onPointerDown={(event) => {
            event.preventDefault()
            controller.beginResize(column.key, event.clientX, column.minWidth ?? 96)
          }}
        />
      </div>
    </th>
  )
}

function useResizableTableColumns(
  storageKey: string,
  columns: ResizableColumnDefinition[],
): ResizableTableController {
  const resizeStateRef = useRef<{
    columnKey: string
    startX: number
    startWidth: number
    minWidth: number
  } | null>(null)
  const [columnWidths, setColumnWidths] = useState<ResizableColumnWidths>(() => {
    return readStoredResizableColumnWidths(storageKey, columns)
  })

  useEffect(() => {
    setColumnWidths(readStoredResizableColumnWidths(storageKey, columns))
  }, [columns, storageKey])

  useEffect(() => {
    writeStoredResizableColumnWidths(storageKey, columnWidths)
  }, [columnWidths, storageKey])

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const activeResize = resizeStateRef.current
      if (!activeResize) {
        return
      }

      const nextWidth = Math.max(activeResize.minWidth, Math.round(activeResize.startWidth + event.clientX - activeResize.startX))
      setColumnWidths((currentWidths) => {
        if (currentWidths[activeResize.columnKey] === nextWidth) {
          return currentWidths
        }

        return {
          ...currentWidths,
          [activeResize.columnKey]: nextWidth,
        }
      })
    }

    function handlePointerUp() {
      if (!resizeStateRef.current) {
        return
      }

      resizeStateRef.current = null
      document.body.classList.remove('bank-column-resizing')
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      document.body.classList.remove('bank-column-resizing')
    }
  }, [])

  const totalWidth = columns.reduce((sum, column) => {
    return sum + (columnWidths[column.key] ?? column.defaultWidth)
  }, 0)

  return {
    columnWidths,
    totalWidth,
    beginResize: (columnKey, clientX, minWidth) => {
      const startWidth =
        columnWidths[columnKey] ?? columns.find((column) => column.key === columnKey)?.defaultWidth ?? minWidth

      resizeStateRef.current = {
        columnKey,
        startX: clientX,
        startWidth,
        minWidth,
      }

      document.body.classList.add('bank-column-resizing')
    },
  }
}

function readStoredResizableColumnWidths(storageKey: string, columns: ResizableColumnDefinition[]) {
  const defaultWidths = Object.fromEntries(columns.map((column) => [column.key, column.defaultWidth])) as ResizableColumnWidths

  if (typeof window === 'undefined') {
    return defaultWidths
  }

  try {
    const raw = window.sessionStorage.getItem(`${BANK_COLUMN_WIDTHS_STORAGE_PREFIX}:${storageKey}`)
    if (!raw) {
      return defaultWidths
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>
    return columns.reduce<ResizableColumnWidths>((accumulator, column) => {
      const nextWidth = Number(parsed[column.key])
      accumulator[column.key] = Number.isFinite(nextWidth) && nextWidth > 0 ? nextWidth : column.defaultWidth
      return accumulator
    }, { ...defaultWidths })
  } catch {
    return defaultWidths
  }
}

function writeStoredResizableColumnWidths(storageKey: string, columnWidths: ResizableColumnWidths) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage.setItem(`${BANK_COLUMN_WIDTHS_STORAGE_PREFIX}:${storageKey}`, JSON.stringify(columnWidths))
  } catch {
    // Ignore storage errors and keep the table usable.
  }
}

function formatDateTime(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return parsed.toLocaleString('es-MX', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const raw = String(reader.result ?? '')
      const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw
      resolve(base64)
    }
    reader.onerror = () => {
      const error = reader.error
      if (error?.name === 'NotReadableError' || error?.message.includes('The requested file could not be read')) {
        reject(
          new Error(
            'El navegador perdio acceso al archivo seleccionado. Vuelve a seleccionarlo o mueve el archivo a una carpeta local antes de subirlo.',
          ),
        )
        return
      }

      reject(error ?? new Error('Unable to read bank file.'))
    }
    reader.readAsDataURL(file)
  })
}
