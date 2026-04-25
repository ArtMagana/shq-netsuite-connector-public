import { useEffect, useRef, useState } from 'react'
import { Navigate, NavLink, useLocation } from 'react-router-dom'
import { HttpClientError } from '../../services/api/httpClient'
import {
  bootstrapSatAnalysisWindow,
  createSatCfdiRequest,
  fetchNetSuiteAccountCatalog,
  fetchNetSuiteEntityCatalog,
  fetchSatAnalysisWindows,
  fetchSatDownloadHistory,
  fetchSatManualHomologationStore,
  fetchSatStatus,
  getSatPackageDownloadUrl,
  inspectSatCfdiPackage,
  previewSatCfdiPackageForNetsuite,
  reconcileSatAnalysisWindow,
  runSatAuthTest,
  saveSatManualAccountHomologation,
  saveSatManualProviderHomologation,
  uploadSatAnalysisInvoice,
  verifySatCfdiRequest,
  type NetSuiteAccountCatalogResponse,
  type NetSuiteEntityCatalogResponse,
  type SatAnalysisItem,
  type SatAnalysisInvoiceUploadResponse,
  type SatAnalysisWindow,
  type SatAnalysisWorkflowSuggestedExtraction,
  type SatAnalysisWindowsResponse,
  type SatAuthTestResponse,
  type SatCfdiDocumentStatus,
  type SatCfdiDocumentType,
  type SatCfdiDownloadType,
  type SatCfdiNetsuitePreviewResponse,
  type SatCfdiPackageInspectResponse,
  type SatCfdiRequestResponse,
  type SatCfdiRequestType,
  type SatCfdiVerifyResponse,
  type SatDownloadHistoryResponse,
  type SatManualHomologationStoreResponse,
  type SatStatusResponse,
} from '../../services/api/reconciliationApi'

let satAutoBootstrapDone = false

type ErrorPayload = {
  error?: string
}

type SatQueryFormState = {
  startAt: string
  endAt: string
  downloadType: SatCfdiDownloadType
  requestType: SatCfdiRequestType
  documentStatus: SatCfdiDocumentStatus
  documentType: SatCfdiDocumentType
  rfcMatch: string
  uuid: string
}

type SatAnalysisFormState = {
  startDate: string
  endDate: string
}

type SatAnalysisWindowPreviewInvoice = SatCfdiNetsuitePreviewResponse['invoices'][number] & {
  packageId: string
}

type SatReviewClassifiablePreview = Pick<
  SatCfdiNetsuitePreviewResponse['invoices'][number],
  'duplicateStatus' | 'duplicateMatches' | 'readyToImport' | 'issues'
>

type SatAnalysisWindowPreviewState = {
  windowId: string
  windowUpdatedAtUtc: string
  loadedAtUtc: string
  invoicesByUuid: Record<string, SatAnalysisWindowPreviewInvoice>
  rowsByUuid: Record<string, SatCfdiNetsuitePreviewResponse['rows']>
}

type SatReviewQueueStatus =
  | 'ready'
  | 'duplicate'
  | 'missing_provider'
  | 'missing_account'
  | 'missing_retention_rule'
  | 'other'

type SatAnalysisQueueFilter =
  | 'all'
  | 'ready'
  | 'actionable'
  | 'duplicate'
  | 'missing_provider'
  | 'missing_account'
  | 'missing_retention_rule'
  | 'other'

type FacturasSatTableView = 'pending' | 'windows' | 'packages' | 'processed' | 'homologation' | 'preview'

type SatReviewQueueEntry = {
  item: SatAnalysisItem
  previewInvoice: SatAnalysisWindowPreviewInvoice | null
  status: SatReviewQueueStatus
  statusLabel: string
  statusDetail: string
}

type SatPreviewQueueEntry = {
  key: string
  invoice: SatCfdiNetsuitePreviewResponse['invoices'][number]
  status: SatReviewQueueStatus
  statusLabel: string
  statusDetail: string
}

type SatReviewTargetSection = 'analysis' | 'homologation'

type SatAnalysisBulkUploadSummary = {
  attempted: number
  created: number
  skipped: number
  failed: number
  stoppedEarly: boolean
  stoppedAtUuid: string | null
  startedAtUtc: string
  finishedAtUtc: string
  messages: string[]
}

type ReadyUploadProgressPhase = 'preparing' | 'uploading' | 'syncing' | 'completed' | 'failed'

type ReadyUploadProgressState = {
  phase: ReadyUploadProgressPhase
  current: number
  total: number
  completed: number
  uuid: string | null
  message: string
}

type FacturasSatHeaderSectionId = 'status' | 'request' | 'packages' | 'analysis' | 'homologation' | 'preview'

type FacturasSatHeaderSectionSlug =
  | 'status'
  | 'solicitud'
  | 'paquetes'
  | 'analisis'
  | 'homologacion'
  | 'preview'

type FacturasSatFocusPanel = Exclude<FacturasSatHeaderSectionSlug, 'status'>

type FacturasSatHeaderSection = {
  id: FacturasSatHeaderSectionId
  slug: FacturasSatHeaderSectionSlug
  label: string
  title: string
  description: string
}

const FACTURAS_SAT_HEADER_SECTIONS: FacturasSatHeaderSection[] = [
  {
    id: 'status',
    slug: 'status',
    label: 'Status',
    title: 'Operacion SAT local',
    description: 'Configuracion local, certificado y autenticacion real contra SAT.',
  },
  {
    id: 'request',
    slug: 'solicitud',
    label: 'Solicitud',
    title: 'Solicitud SAT',
    description: 'Prepara filtros, genera el request id y valida la respuesta inicial del SAT.',
  },
  {
    id: 'packages',
    slug: 'paquetes',
    label: 'Paquetes',
    title: 'Paquetes SAT',
    description: 'Descarga, inspecciona y revisa el historial local de paquetes SAT.',
  },
  {
    id: 'analysis',
    slug: 'analisis',
    label: 'Analisis',
    title: 'Analisis SAT',
    description: 'Opera ventanas de analisis, pendientes de carga e historico procesado.',
  },
  {
    id: 'homologation',
    slug: 'homologacion',
    label: 'No listas',
    title: 'Facturas no listas',
    description: 'Corrige proveedor, cuenta o retencion antes de subir a NetSuite.',
  },
  {
    id: 'preview',
    slug: 'preview',
    label: 'Preview',
    title: 'Preview NetSuite',
    description: 'Revisa el modelo final, incidencias y payload resultante para NetSuite.',
  },
]

const FACTURAS_SAT_HEADER_SECTION_ALIASES: Record<string, FacturasSatHeaderSectionSlug> = {
  request: 'solicitud',
  packages: 'paquetes',
  analysis: 'analisis',
  homologation: 'homologacion',
}
const SAT_PENDING_EXTRACTION_POLL_INTERVAL_MS = 15_000
const SAT_PENDING_EXTRACTION_FIRST_POLL_DELAY_MS = 4_000

export function FacturasSatPage() {
  const location = useLocation()
  const [status, setStatus] = useState<SatStatusResponse | null>(null)
  const [authTest, setAuthTest] = useState<SatAuthTestResponse | null>(null)
  const [requestResult, setRequestResult] = useState<SatCfdiRequestResponse | null>(null)
  const [verifyResult, setVerifyResult] = useState<SatCfdiVerifyResponse | null>(null)
  const [inspectedPackage, setInspectedPackage] = useState<SatCfdiPackageInspectResponse | null>(null)
  const [netsuitePreview, setNetsuitePreview] = useState<SatCfdiNetsuitePreviewResponse | null>(null)
  const [downloadHistory, setDownloadHistory] = useState<SatDownloadHistoryResponse | null>(null)
  const [analysisWindows, setAnalysisWindows] = useState<SatAnalysisWindowsResponse | null>(null)
  const [manualHomologationStore, setManualHomologationStore] =
    useState<SatManualHomologationStoreResponse | null>(null)
  const [supplierCatalog, setSupplierCatalog] = useState<NetSuiteEntityCatalogResponse | null>(null)
  const [accountCatalog, setAccountCatalog] = useState<NetSuiteAccountCatalogResponse | null>(null)
  const [analysisPreviewStates, setAnalysisPreviewStates] = useState<Record<string, SatAnalysisWindowPreviewState>>(
    {},
  )
  const [lastUploadResult, setLastUploadResult] = useState<SatAnalysisInvoiceUploadResponse | null>(null)
  const [lastBulkUploadSummary, setLastBulkUploadSummary] = useState<SatAnalysisBulkUploadSummary | null>(null)
  const [selectedAnalysisWindowId, setSelectedAnalysisWindowId] = useState<string | null>(null)
  const [selectedReviewUuid, setSelectedReviewUuid] = useState<string | null>(null)
  const [analysisQueueFilter, setAnalysisQueueFilter] = useState<SatAnalysisQueueFilter>('actionable')
  const [analysisSearch, setAnalysisSearch] = useState('')
  const [processedSearch, setProcessedSearch] = useState('')
  const [homologationQueueFilter, setHomologationQueueFilter] = useState<SatAnalysisQueueFilter>('actionable')
  const [homologationSearch, setHomologationSearch] = useState('')
  const [previewQueueFilter, setPreviewQueueFilter] = useState<SatAnalysisQueueFilter>('all')
  const [previewSearch, setPreviewSearch] = useState('')
  const [selectedPreviewInvoiceKey, setSelectedPreviewInvoiceKey] = useState<string | null>(null)
  const [requestIdInput, setRequestIdInput] = useState('')
  const [supplierSearch, setSupplierSearch] = useState('')
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null)
  const [providerCcSearch, setProviderCcSearch] = useState('')
  const [selectedProviderCcId, setSelectedProviderCcId] = useState<string | null>(null)
  const [selectedMissingClave, setSelectedMissingClave] = useState<string | null>(null)
  const [expenseAccountSearch, setExpenseAccountSearch] = useState('')
  const [selectedExpenseAccountId, setSelectedExpenseAccountId] = useState<string | null>(null)
  const [formState, setFormState] = useState<SatQueryFormState>(() => createDefaultFormState())
  const [analysisFormState, setAnalysisFormState] = useState<SatAnalysisFormState>(() =>
    createDefaultAnalysisFormState(),
  )
  const [suggestedExtraction, setSuggestedExtraction] = useState<SatAnalysisWorkflowSuggestedExtraction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false)
  const [isRefreshingHistory, setIsRefreshingHistory] = useState(false)
  const [isRefreshingAnalysisWindows, setIsRefreshingAnalysisWindows] = useState(false)
  const [isTestingAuth, setIsTestingAuth] = useState(false)
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false)
  const [isVerifyingRequest, setIsVerifyingRequest] = useState(false)
  const [isInspectingPackage, setIsInspectingPackage] = useState(false)
  const [isPreparingNetsuiteModel, setIsPreparingNetsuiteModel] = useState(false)
  const [isBootstrappingAnalysisWindow, setIsBootstrappingAnalysisWindow] = useState(false)
  const [isReconcilingAnalysisWindow, setIsReconcilingAnalysisWindow] = useState(false)
  const [isPreparingAnalysisUploadState, setIsPreparingAnalysisUploadState] = useState(false)
  const [isLoadingHomologationSupport, setIsLoadingHomologationSupport] = useState(false)
  const [isSavingProviderHomologation, setIsSavingProviderHomologation] = useState(false)
  const [isSavingAccountHomologation, setIsSavingAccountHomologation] = useState(false)
  const [uploadingAnalysisInvoiceKey, setUploadingAnalysisInvoiceKey] = useState<string | null>(null)
  const [isUploadingReadyInvoices, setIsUploadingReadyInvoices] = useState(false)
  const [isRunningAnalysisWorkflow, setIsRunningAnalysisWorkflow] = useState(false)
  const [analysisWorkflowNotice, setAnalysisWorkflowNotice] = useState<string | null>(null)
  const [readyUploadProgress, setReadyUploadProgress] = useState<ReadyUploadProgressState | null>(null)
  const [activePackageId, setActivePackageId] = useState<string | null>(null)
  const autoTestStarted = useRef(false)
  const analysisPreviewRequestId = useRef(0)
  const reviewRouteFocusRef = useRef<string | null>(null)
  const previewRouteFocusRef = useRef<string | null>(null)
  const previewAutoLinkedRef = useRef(false)
  const panelScrollRef = useRef<string | null>(null)
  const pendingSatPollWindowIdRef = useRef<string | null>(null)

  const hasUuidFilter = formState.uuid.trim().length > 0
  const headerSectionPath = location.pathname.replace(/^\/facturas-sat\/?/, '')
  const headerSectionSegments = headerSectionPath.split('/').filter(Boolean)
  const headerSearchParams = new URLSearchParams(location.search)
  const requestedLegacyPanel = parseFacturasSatLegacyPanel(headerSectionSegments[0] ?? null)
  const requestedPanel = parseFacturasSatFocusPanel(headerSearchParams.get('panel'))
  const requestedTableView = parseFacturasSatTableView(headerSearchParams.get('view'))
  const requestedReviewUuid = normalizeUuidKey(headerSearchParams.get('uuid'))
  const effectiveRequestedPanel = requestedPanel ?? requestedLegacyPanel
  const activeTableView = resolveFacturasSatTableView(effectiveRequestedPanel, requestedTableView)
  const shouldRedirectToUnifiedFacturasSatRoute = headerSectionSegments.length > 0

  useEffect(() => {
    if (satAutoBootstrapDone || autoTestStarted.current) {
      return
    }

    satAutoBootstrapDone = true
    autoTestStarted.current = true
    void refreshStatus(true)
  }, [])

  useEffect(() => {
    setLastUploadResult(null)
    setLastBulkUploadSummary(null)
    setReadyUploadProgress(null)
    setAnalysisWorkflowNotice(null)
  }, [selectedAnalysisWindowId])

  async function refreshStatus(runTestAfterLoad = false) {
    setIsRefreshingStatus(true)

    try {
      const response = await fetchSatStatus()
      setStatus(response)
      await refreshDownloadHistory()
      await refreshAnalysisWindows()
      setError(null)

      if (runTestAfterLoad && response.canTestAuth) {
        await testSatAuth()
      }
    } catch (reason) {
      setStatus(null)
      setDownloadHistory(null)
      setError(parseError(reason))
    } finally {
      setIsRefreshingStatus(false)
    }
  }

  async function refreshDownloadHistory() {
    setIsRefreshingHistory(true)

    try {
      const response = await fetchSatDownloadHistory(20)
      setDownloadHistory(response)
      return response
    } catch (reason) {
      setError(parseError(reason))
      return null
    } finally {
      setIsRefreshingHistory(false)
    }
  }

  async function refreshAnalysisWindows(preferredWindowId?: string | null) {
    setIsRefreshingAnalysisWindows(true)

    try {
      const response = await fetchSatAnalysisWindows()
      setAnalysisWindows(response)
      setSuggestedExtraction(response.workflow.suggestedExtraction)
      setAnalysisFormState({
        startDate: response.workflow.suggestedExtraction.startDate,
        endDate: response.workflow.suggestedExtraction.endDate,
      })
      setSelectedAnalysisWindowId((current) => {
        if (preferredWindowId && response.windows.some((window) => window.id === preferredWindowId)) {
          return preferredWindowId
        }
        if (current && response.windows.some((window) => window.id === current)) {
          return current
        }

        return response.windows[0]?.id ?? null
      })
      return response
    } catch (reason) {
      setError(parseError(reason))
      return null
    } finally {
      setIsRefreshingAnalysisWindows(false)
    }
  }

  async function refreshManualHomologationStore() {
    const response = await fetchSatManualHomologationStore()
    setManualHomologationStore(response)
    return response
  }

  async function ensureHomologationSupportLoaded() {
    if (isLoadingHomologationSupport) {
      return
    }

    if (manualHomologationStore && supplierCatalog && accountCatalog) {
      return
    }

    setIsLoadingHomologationSupport(true)

    try {
      const [storeResponse, supplierResponse, accountResponse] = await Promise.all([
        manualHomologationStore ? Promise.resolve(manualHomologationStore) : fetchSatManualHomologationStore(),
        supplierCatalog ? Promise.resolve(supplierCatalog) : fetchNetSuiteEntityCatalog('suppliers'),
        accountCatalog ? Promise.resolve(accountCatalog) : fetchNetSuiteAccountCatalog(),
      ])

      setManualHomologationStore(storeResponse)
      setSupplierCatalog(supplierResponse)
      setAccountCatalog(accountResponse)
      setError(null)
    } catch (reason) {
      setError(parseError(reason))
    } finally {
      setIsLoadingHomologationSupport(false)
    }
  }

  async function testSatAuth() {
    setIsTestingAuth(true)

    try {
      const response = await runSatAuthTest()
      setAuthTest(response)
      setError(null)
      return response
    } catch (reason) {
      setAuthTest(null)
      setError(parseError(reason))
      return null
    } finally {
      setIsTestingAuth(false)
    }
  }

  async function ensureSatConnectionReady() {
    if (!status?.canTestAuth) {
      setError('La conexion SAT no esta disponible todavia. Refresca estado y valida la configuracion local.')
      return false
    }

    if (authTest?.success) {
      return true
    }

    const response = await testSatAuth()
    return Boolean(response?.success)
  }

  function findExistingWindowForSuggestedExtraction(nextExtraction: SatAnalysisWorkflowSuggestedExtraction) {
    return (
      analysisWindows?.windows.find(
        (window) =>
          window.subset.documentType === 'ingreso' &&
          window.subset.startAtUtc.slice(0, 10) === nextExtraction.startDate &&
          window.subset.endAtUtc.slice(0, 10) === nextExtraction.endDate,
      ) ?? null
    )
  }

  async function refreshPendingSuggestedExtraction(window: SatAnalysisWindow, source: 'manual' | 'auto' = 'manual') {
    setIsReconcilingAnalysisWindow(true)
    if (source === 'manual') {
      setAnalysisWorkflowNotice(
        'Ya existe una extraccion SAT en curso para este mismo rango. Estoy revisando si el SAT ya libero paquetes.',
      )
    }

    try {
      const response = await reconcileSatAnalysisWindow(window.id)
      const snapshot = await syncAnalysisWindowSnapshot(response.id, false)
      const refreshedWindow = snapshot.window

      if (!refreshedWindow || refreshedWindow.status === 'pending_sat') {
        setAnalysisWorkflowNotice(
          source === 'manual'
            ? 'La extraccion ya existe y sigue en proceso dentro del SAT. No cree una solicitud nueva; solo refresque su estado.'
            : `La extraccion sigue viva en SAT. La pantalla la revisara otra vez en ${formatInteger(
                Math.round(SAT_PENDING_EXTRACTION_POLL_INTERVAL_MS / 1000),
              )} segundos.`,
        )
        return
      }

      setAnalysisWorkflowNotice(
        `El SAT ya libero la extraccion. Hay ${formatInteger(
          refreshedWindow.packageIds.length,
        )} paquete(s) listos y ya puedes pulsar Procesar.`,
      )
      setError(null)
    } catch (reason) {
      if (source === 'manual') {
        setError(parseError(reason))
      }
    } finally {
      setIsReconcilingAnalysisWindow(false)
    }
  }

  async function handleSubmitRequest() {
    setIsSubmittingRequest(true)

    try {
      const payload = buildRequestPayload(formState)
      const response = await createSatCfdiRequest(payload)
      setRequestResult(response)
      setRequestIdInput(response.requestId)
      setVerifyResult(null)
      setInspectedPackage(null)
      setNetsuitePreview(null)
      setActivePackageId(null)
      setError(null)
    } catch (reason) {
      setRequestResult(null)
      setVerifyResult(null)
      setInspectedPackage(null)
      setNetsuitePreview(null)
      setActivePackageId(null)
      setError(parseError(reason))
    } finally {
      setIsSubmittingRequest(false)
    }
  }

  async function handleVerifyRequest() {
    const normalizedRequestId = requestIdInput.trim()
    if (!normalizedRequestId) {
      setError('Escribe o genera primero un request id del SAT.')
      return
    }

    setIsVerifyingRequest(true)

    try {
      const response = await verifySatCfdiRequest(normalizedRequestId)
      setVerifyResult(response)
      setInspectedPackage(null)
      setNetsuitePreview(null)
      setActivePackageId(null)
      setError(null)
    } catch (reason) {
      setVerifyResult(null)
      setInspectedPackage(null)
      setNetsuitePreview(null)
      setActivePackageId(null)
      setError(parseError(reason))
    } finally {
      setIsVerifyingRequest(false)
    }
  }

  async function handleInspectPackage(packageId: string) {
    setIsInspectingPackage(true)
    setActivePackageId(packageId)

    try {
      const response = await inspectSatCfdiPackage(packageId)
      setInspectedPackage(response)
      setNetsuitePreview(null)
      await refreshDownloadHistory()
      setError(null)
    } catch (reason) {
      setInspectedPackage(null)
      setNetsuitePreview(null)
      setError(parseError(reason))
    } finally {
      setIsInspectingPackage(false)
    }
  }

  async function handlePrepareNetsuiteModel(packageId: string) {
    setIsPreparingNetsuiteModel(true)
    setActivePackageId(packageId)

    try {
      const response = await previewSatCfdiPackageForNetsuite(packageId)
      setNetsuitePreview(response)
      setError(null)
    } catch (reason) {
      setNetsuitePreview(null)
      setError(parseError(reason))
    } finally {
      setIsPreparingNetsuiteModel(false)
    }
  }

  async function syncAnalysisWindowSnapshot(windowId: string, preparePreview = true) {
    await refreshDownloadHistory()
    const refreshedWindows = await refreshAnalysisWindows(windowId)
    const refreshedWindow = refreshedWindows?.windows.find((window) => window.id === windowId) ?? null
    const previewState =
      preparePreview && refreshedWindow ? await prepareAnalysisWindowUploadState(refreshedWindow, true) : null

    return {
      window: refreshedWindow,
      previewState,
    }
  }

  async function bootstrapAnalysisWindowForRange(startAtUtc: string, endAtUtc: string) {
    setIsBootstrappingAnalysisWindow(true)
    setAnalysisWorkflowNotice(null)

    try {
      const response = await bootstrapSatAnalysisWindow({
        startAtUtc,
        endAtUtc,
      })
      setRequestIdInput(response.requestId ?? '')
      const snapshot = await syncAnalysisWindowSnapshot(response.id, false)
      const syncedWindow = snapshot.window
      if (syncedWindow?.status === 'pending_sat') {
        setAnalysisWorkflowNotice(
          'Extraccion enviada al SAT. La solicitud quedo registrada y puede tardar unos minutos en liberar paquetes.',
        )
      } else if (syncedWindow) {
        setAnalysisWorkflowNotice(
          `Extraccion completada: ${formatInteger(
            syncedWindow.packageIds.length,
          )} paquete(s) quedaron listos para procesar.`,
        )
      }
      setError(null)
      return response
    } catch (reason) {
      setError(parseError(reason))
      return null
    } finally {
      setIsBootstrappingAnalysisWindow(false)
    }
  }

  async function handleBootstrapAnalysisWindow() {
    await bootstrapAnalysisWindowForRange(
      toIsoDateStart(analysisFormState.startDate),
      toIsoDateEnd(analysisFormState.endDate),
    )
  }

  async function handleSuggestedExtraction() {
    if (!suggestedExtraction) {
      setError('No hay una ventana sugerida para la siguiente extraccion SAT.')
      return
    }

    setAnalysisFormState({
      startDate: suggestedExtraction.startDate,
      endDate: suggestedExtraction.endDate,
    })

    if (!(await ensureSatConnectionReady())) {
      return
    }

    const existingWindow = findExistingWindowForSuggestedExtraction(suggestedExtraction)
    if (existingWindow?.status === 'pending_sat') {
      setSelectedAnalysisWindowId(existingWindow.id)
      await refreshPendingSuggestedExtraction(existingWindow)
      return
    }

    await bootstrapAnalysisWindowForRange(suggestedExtraction.startAtUtc, suggestedExtraction.endAtUtc)
  }

  async function handleReconcileAnalysisWindow(windowId: string) {
    setIsReconcilingAnalysisWindow(true)
    setAnalysisWorkflowNotice(null)

    try {
      const response = await reconcileSatAnalysisWindow(windowId)
      await syncAnalysisWindowSnapshot(response.id)
      setError(null)
    } catch (reason) {
      setError(parseError(reason))
    } finally {
      setIsReconcilingAnalysisWindow(false)
    }
  }

  async function handleProcessSelectedAnalysisWindow() {
    if (!selectedAnalysisWindow) {
      setError('No hay una ventana SAT activa para procesar.')
      return
    }

    setIsRunningAnalysisWorkflow(true)
    setAnalysisWorkflowNotice(null)
    setLastUploadResult(null)
    setLastBulkUploadSummary(null)
    setReadyUploadProgress(null)
    setError(null)

    try {
      const reconcileResponse = await reconcileSatAnalysisWindow(selectedAnalysisWindow.id)
      const reconciledSnapshot = await syncAnalysisWindowSnapshot(reconcileResponse.id, true)
      const reconciledWindow = reconciledSnapshot.window

      if (!reconciledWindow) {
        setAnalysisWorkflowNotice('No pude rehidratar la ventana activa despues del cruce con NetSuite.')
        return
      }

      if (reconciledWindow.status === 'pending_sat') {
        setAnalysisWorkflowNotice(
          'La extraccion sigue esperando respuesta del SAT. Refresca el estado o vuelve a procesar cuando el request ya tenga paquetes.',
        )
        return
      }

      const readyEntries = buildReadyReviewQueueEntries(reconciledWindow, reconciledSnapshot.previewState)
      if (readyEntries.length === 0) {
        setAnalysisWorkflowNotice(
          'El procesamiento termino, pero no hay facturas listas para subir. Revisa No listas o Preview si hace falta.',
        )
        return
      }

      setAnalysisWorkflowNotice(
        `Procesamiento completo: ${formatInteger(readyEntries.length)} facturas quedaron listas para subir a NetSuite.`,
      )
    } catch (reason) {
      setError(parseError(reason))
    } finally {
      setIsRunningAnalysisWorkflow(false)
    }
  }

  async function prepareAnalysisWindowUploadState(window: SatAnalysisWindow, force = false) {
    const cachedState = analysisPreviewStates[window.id]
    if (!force && cachedState?.windowUpdatedAtUtc === window.updatedAtUtc) {
      return cachedState
    }

    const requestId = analysisPreviewRequestId.current + 1
    analysisPreviewRequestId.current = requestId
    setIsPreparingAnalysisUploadState(true)

    try {
      const invoicesByUuid: Record<string, SatAnalysisWindowPreviewInvoice> = {}
      const rowsByUuid: Record<string, SatCfdiNetsuitePreviewResponse['rows']> = {}

      for (const packageId of window.packageIds) {
        const response = await previewSatCfdiPackageForNetsuite(packageId)
        if (analysisPreviewRequestId.current !== requestId) {
          return null
        }

        for (const invoice of response.invoices) {
          const normalizedUuid = normalizeUuidKey(invoice.uuid)
          if (!normalizedUuid) {
            continue
          }

          invoicesByUuid[normalizedUuid] = {
            ...invoice,
            packageId,
          }
        }

        for (const row of response.rows) {
          const normalizedUuid = normalizeUuidKey(row.uuid)
          if (!normalizedUuid) {
            continue
          }

          rowsByUuid[normalizedUuid] = [...(rowsByUuid[normalizedUuid] ?? []), row]
        }
      }

      if (analysisPreviewRequestId.current !== requestId) {
        return null
      }

      const nextState: SatAnalysisWindowPreviewState = {
        windowId: window.id,
        windowUpdatedAtUtc: window.updatedAtUtc,
        loadedAtUtc: new Date().toISOString(),
        invoicesByUuid,
        rowsByUuid,
      }

      setAnalysisPreviewStates((current) => ({
        ...current,
        [window.id]: nextState,
      }))
      setError(null)
      return nextState
    } catch (reason) {
      if (analysisPreviewRequestId.current === requestId) {
        setError(parseError(reason))
      }
      return null
    } finally {
      if (analysisPreviewRequestId.current === requestId) {
        setIsPreparingAnalysisUploadState(false)
      }
    }
  }

  async function syncAnalysisWindowAfterUpload(windowId: string) {
    const refreshedWindows = await refreshAnalysisWindows(windowId)
    const refreshedWindow =
      refreshedWindows?.windows.find((window) => window.id === windowId) ??
      analysisWindows?.windows.find((window) => window.id === windowId) ??
      null

    if (refreshedWindow) {
      await prepareAnalysisWindowUploadState(refreshedWindow, true)
      return
    }

    setAnalysisPreviewStates((current) => {
      const nextState = { ...current }
      delete nextState[windowId]
      return nextState
    })
  }

  async function handleUploadAnalysisInvoice(windowId: string, uuid: string) {
    const uploadKey = `${windowId}:${normalizeUuidKey(uuid)}`
    setUploadingAnalysisInvoiceKey(uploadKey)
    setLastUploadResult(null)
    setLastBulkUploadSummary(null)
    setAnalysisWorkflowNotice(null)

    try {
      const response = await uploadSatAnalysisInvoice(windowId, uuid)
      setLastUploadResult(response)
      await syncAnalysisWindowAfterUpload(windowId)

      setError(null)
    } catch (reason) {
      setError(parseError(reason))
    } finally {
      setUploadingAnalysisInvoiceKey(null)
    }
  }

  async function uploadReadyAnalysisInvoices(windowId: string, entries: SatReviewQueueEntry[]) {
    setIsUploadingReadyInvoices(true)
    setLastUploadResult(null)
    setLastBulkUploadSummary(null)
    setError(null)

    const startedAtUtc = new Date().toISOString()
    const messages: string[] = []
    let created = 0
    let skipped = 0
    let failed = 0
    let stoppedEarly = false
    let stoppedAtUuid: string | null = null
    let progressState: ReadyUploadProgressState = {
      phase: 'preparing',
      current: 0,
      total: entries.length,
      completed: 0,
      uuid: null,
      message: `Preparando lote de ${entries.length} facturas listas para subir.`,
    }

    setReadyUploadProgress(progressState)

    try {
      for (const [index, entry] of entries.entries()) {
        const uuid = entry.item.uuid
        if (!uuid) {
          continue
        }

        const uploadKey = `${windowId}:${normalizeUuidKey(uuid)}`
        setUploadingAnalysisInvoiceKey(uploadKey)
        progressState = {
          phase: 'uploading',
          current: index + 1,
          total: entries.length,
          completed: index,
          uuid,
          message: `Subiendo factura ${index + 1} de ${entries.length}.`,
        }
        setReadyUploadProgress(progressState)

        try {
          const response = await uploadSatAnalysisInvoice(windowId, uuid)
          if (response.created) {
            created += 1
            messages.push(
              `${uuid}: ${response.createdRecord?.transactionNumber ?? response.createdRecord?.internalId ?? response.message}`,
            )
          } else {
            skipped += 1
            messages.push(`${uuid}: ${response.message}`)
          }

          progressState = {
            phase: 'uploading',
            current: index + 1,
            total: entries.length,
            completed: index + 1,
            uuid,
            message: `Factura ${index + 1} de ${entries.length} enviada. Avanzando al siguiente registro.`,
          }
          setReadyUploadProgress(progressState)
        } catch (reason) {
          failed += 1
          const errorMessage = parseError(reason)
          stoppedEarly = true
          stoppedAtUuid = uuid
          messages.push(`${uuid}: ${errorMessage}`)
          progressState = {
            phase: 'failed',
            current: index + 1,
            total: entries.length,
            completed: index,
            uuid,
            message: `La subida se detuvo en la factura ${index + 1} de ${entries.length}.`,
          }
          setReadyUploadProgress(progressState)
          setError(`Subida masiva detenida en ${uuid}: ${errorMessage}`)
          break
        }
      }

      progressState = {
        phase: 'syncing',
        current: Math.max(created + skipped + failed, progressState.current),
        total: entries.length,
        completed: created + skipped,
        uuid: stoppedAtUuid,
        message: 'Sincronizando la ventana SAT para refrescar la cola despues del lote.',
      }
      setReadyUploadProgress(progressState)
      await syncAnalysisWindowAfterUpload(windowId)

      const summary = {
        attempted: created + skipped + failed,
        created,
        skipped,
        failed,
        stoppedEarly,
        stoppedAtUuid,
        startedAtUtc,
        finishedAtUtc: new Date().toISOString(),
        messages: messages.slice(0, 6),
      } satisfies SatAnalysisBulkUploadSummary

      setLastBulkUploadSummary(summary)
      progressState = {
        phase: stoppedEarly || failed > 0 ? 'failed' : 'completed',
        current: summary.attempted,
        total: entries.length,
        completed: created + skipped,
        uuid: stoppedAtUuid,
        message:
          stoppedEarly || failed > 0
            ? `La subida se detuvo antes de terminar. Se intentaron ${summary.attempted} de ${entries.length} facturas.`
            : `Subida terminada. ${created} factura(s) creadas en NetSuite y ${skipped} omitida(s).`,
      }
      setReadyUploadProgress(progressState)
      if (!stoppedEarly) {
        setError(null)
      }

      return summary
    } catch (reason) {
      const errorMessage = parseError(reason)
      setReadyUploadProgress({
        phase: 'failed',
        current: created + skipped + failed,
        total: entries.length,
        completed: created + skipped,
        uuid: progressState.uuid,
        message: `La subida no pudo terminar: ${errorMessage}`,
      })
      setError(errorMessage)
      return null
    } finally {
      setUploadingAnalysisInvoiceKey(null)
      setIsUploadingReadyInvoices(false)
    }
  }

  async function handleUploadReadyAnalysisInvoices(windowId: string) {
    if (readyReviewQueueEntries.length === 0) {
      setError('No hay facturas listas para subir en la ventana activa.')
      return
    }

    setAnalysisWorkflowNotice(null)
    await uploadReadyAnalysisInvoices(windowId, readyReviewQueueEntries)
    setAnalysisQueueFilter('actionable')
  }

  async function handleRunAnalysisWorkflow() {
    setIsRunningAnalysisWorkflow(true)
    setAnalysisWorkflowNotice(null)
    setAnalysisQueueFilter('actionable')
    setLastUploadResult(null)
    setLastBulkUploadSummary(null)
    setReadyUploadProgress(null)
    setError(null)

    try {
      const bootstrapResponse = await bootstrapSatAnalysisWindow({
        startAtUtc: toIsoDateStart(analysisFormState.startDate),
        endAtUtc: toIsoDateEnd(analysisFormState.endDate),
      })
      setRequestIdInput(bootstrapResponse.requestId ?? '')

      const bootstrappedSnapshot = await syncAnalysisWindowSnapshot(bootstrapResponse.id, false)
      const bootstrappedWindow = bootstrappedSnapshot.window

      if (!bootstrappedWindow) {
        setAnalysisWorkflowNotice('El subset SAT se genero, pero no pude recuperar la ventana activa para continuar.')
        return
      }

      if (bootstrappedWindow.status === 'pending_sat') {
        setAnalysisWorkflowNotice(
          'El SAT acepto la solicitud pero todavia no libera paquetes. La cola se conserva estable; vuelve a ejecutar el flujo cuando el request deje de estar en progreso.',
        )
        return
      }

      const reconcileResponse = await reconcileSatAnalysisWindow(bootstrappedWindow.id)
      const reconciledSnapshot = await syncAnalysisWindowSnapshot(reconcileResponse.id, true)
      const reconciledWindow = reconciledSnapshot.window

      if (!reconciledWindow) {
        setAnalysisWorkflowNotice('No pude rehidratar la ventana reconciliada despues del cruce con NetSuite.')
        return
      }

      if (reconciledWindow.status === 'pending_sat') {
        setAnalysisWorkflowNotice(
          'La ventana sigue esperando respuesta del SAT. El historico y los pendientes quedan preservados mientras tanto.',
        )
        return
      }

      const readyEntries = buildReadyReviewQueueEntries(reconciledWindow, reconciledSnapshot.previewState)
      if (readyEntries.length === 0) {
        setAnalysisWorkflowNotice(
          'El flujo completo termino sin facturas listas para subir. La tabla principal queda enfocada en los bloqueos manuales.',
        )
        return
      }

      await uploadReadyAnalysisInvoices(reconciledWindow.id, readyEntries)
      setAnalysisQueueFilter('actionable')
      setAnalysisWorkflowNotice(
        'El flujo completo ya corrio. Las facturas listas se procesaron en lote y la tabla principal quedo enfocada en lo que requiere revision.',
      )
    } catch (reason) {
      setError(parseError(reason))
    } finally {
      setIsRunningAnalysisWorkflow(false)
    }
  }

  function updateFormState<Key extends keyof SatQueryFormState>(key: Key, value: SatQueryFormState[Key]) {
    setFormState((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function updateAnalysisFormState<Key extends keyof SatAnalysisFormState>(
    key: Key,
    value: SatAnalysisFormState[Key],
  ) {
    setAnalysisFormState((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function focusReviewUuidOnSection(uuid: string | null, section: SatReviewTargetSection) {
    if (!uuid) {
      return
    }

    setSelectedReviewUuid(uuid)

    if (section === 'analysis') {
      setAnalysisQueueFilter('all')
      setAnalysisSearch(uuid)
      return
    }

    setHomologationQueueFilter('all')
    setHomologationSearch(uuid)
  }

  function scrollToFacturasSatSection(panel: FacturasSatFocusPanel) {
    const targetId = getFacturasSatPanelElementId(panel)
    if (!targetId) {
      return
    }

    window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }, 0)
  }

  const downloadHistoryRecords = downloadHistory?.records.slice(0, 10) ?? []
  const selectedAnalysisWindow =
    analysisWindows?.windows.find((window) => window.id === selectedAnalysisWindowId) ??
    analysisWindows?.windows[0] ??
    null
  const selectedAnalysisPreviewState = selectedAnalysisWindow
    ? analysisPreviewStates[selectedAnalysisWindow.id] ?? null
    : null
  const selectedAnalysisPreviewLoaded =
    selectedAnalysisWindow !== null &&
    selectedAnalysisPreviewState?.windowUpdatedAtUtc === selectedAnalysisWindow.updatedAtUtc
  const selectedAnalysisPreviewLoadedAt = selectedAnalysisPreviewState?.loadedAtUtc ?? null
  const selectedAnalysisPreviewInvoices = selectedAnalysisPreviewState
    ? Object.values(selectedAnalysisPreviewState.invoicesByUuid)
    : []
  const selectedAnalysisPreviewRows = selectedAnalysisPreviewState
    ? Object.values(selectedAnalysisPreviewState.rowsByUuid).flat()
    : []
  const activePreviewInvoices = selectedAnalysisPreviewLoaded
    ? selectedAnalysisPreviewInvoices
    : (netsuitePreview?.invoices ?? [])
  const activePreviewRows = selectedAnalysisPreviewLoaded
    ? selectedAnalysisPreviewRows
    : (netsuitePreview?.rows ?? [])
  const activePreviewSummary = selectedAnalysisPreviewLoaded
    ? buildSatPreparedPreviewSummary(activePreviewInvoices, activePreviewRows)
    : (netsuitePreview?.summary ?? null)
  const activePreviewPackageLabel = selectedAnalysisPreviewLoaded
    ? selectedAnalysisWindow?.label ?? '--'
    : (netsuitePreview?.packageId ?? '--')
  const previewQueueEntries = activePreviewInvoices.map((invoice) => ({
    key: getSatPreviewInvoiceKey(invoice),
    invoice,
    ...classifySatReviewQueueItem(invoice),
  })) satisfies SatPreviewQueueEntry[]
  const selectedAnalysisPreviewSummary = buildSatPreviewOperationalSummary(selectedAnalysisPreviewInvoices)
  const analysisQueueItems = selectedAnalysisWindow?.analysisItems ?? []
  const processedAnalysisItems = selectedAnalysisWindow?.processedItems ?? []
  const reviewQueueEntries = buildSatReviewQueueEntries(analysisQueueItems, selectedAnalysisPreviewState)
  const readyReviewQueueEntries = buildReadyReviewQueueEntries(selectedAnalysisWindow, selectedAnalysisPreviewState)
  const reviewQueueSummary = buildSatReviewQueueSummary(reviewQueueEntries)
  const totalAnalysisWindows = analysisWindows?.windows.length ?? 0
  const totalPendingAnalysisItems =
    analysisWindows?.windows.reduce((total, window) => total + window.analysisItems.length, 0) ?? 0
  const totalProcessedAnalysisItems =
    analysisWindows?.windows.reduce((total, window) => total + window.processedItems.length, 0) ?? 0
  const reviewQueueBlockedCount = reviewQueueEntries.length - reviewQueueSummary.ready
  const homologationPendingCount =
    reviewQueueSummary.missingProvider +
    reviewQueueSummary.missingAccount +
    reviewQueueSummary.missingRetentionRule +
    reviewQueueSummary.other
  const previewReadyCount = selectedAnalysisPreviewLoaded
    ? selectedAnalysisPreviewSummary.ready
    : (netsuitePreview?.summary.readyInvoices ?? 0)
  const previewDuplicateCount = selectedAnalysisPreviewLoaded
    ? selectedAnalysisPreviewSummary.duplicate
    : (netsuitePreview?.summary.exactDuplicateInvoices ?? 0) + (netsuitePreview?.summary.possibleDuplicateInvoices ?? 0)
  const previewIssueCount = selectedAnalysisPreviewLoaded
    ? selectedAnalysisPreviewSummary.total - selectedAnalysisPreviewSummary.ready
    : (netsuitePreview?.summary.manualHomologationInvoices ?? 0) +
      (netsuitePreview?.summary.exactDuplicateInvoices ?? 0) +
      (netsuitePreview?.summary.possibleDuplicateInvoices ?? 0)
  const latestDownloadRecord = downloadHistory?.records[0] ?? null
  const latestRequestId = requestResult?.requestId ?? verifyResult?.requestId ?? selectedAnalysisWindow?.requestId ?? null
  const latestRequestStatusMessage =
    verifyResult?.statusRequest.message ??
    requestResult?.status.message ??
    (selectedAnalysisWindow ? `Ventana ${formatAnalysisWindowStatus(selectedAnalysisWindow.status)}` : 'Sin request SAT reciente')
  const latestReadyToDownloadPackages = verifyResult?.readyToDownload ? verifyResult.packages.length : 0
  const latestVerifiedPackageId = verifyResult?.packages[0]?.packageId ?? inspectedPackage?.packageId ?? null
  const satConnectionReady = Boolean(status?.canTestAuth && authTest?.success)
  const showPendingLanding = !effectiveRequestedPanel && activeTableView === 'pending'
  const showRequestPanel = effectiveRequestedPanel === 'solicitud'
  const showAnalysisWorkspacePanel = effectiveRequestedPanel === 'analisis'
  const showPendingTable = showPendingLanding || (effectiveRequestedPanel === 'analisis' && activeTableView === 'pending')
  const effectiveAnalysisQueueFilter = showPendingLanding ? 'ready' : analysisQueueFilter
  const pendingTableTitle = showPendingLanding
    ? 'Facturas pendientes por subir'
    : effectiveAnalysisQueueFilter === 'ready'
      ? 'Facturas listas para subir'
      : 'Facturas pendientes de carga'
  const normalizedAnalysisSearch = normalizeSearchText(analysisSearch)
  const filteredReviewQueueEntries = reviewQueueEntries.filter(
    (entry) =>
      matchesSatReviewQueueFilter(entry, effectiveAnalysisQueueFilter) &&
      matchesSatReviewQueueSearch(entry, normalizedAnalysisSearch),
  )
  const selectedAnalysisReviewEntry =
    filteredReviewQueueEntries.find(
      (entry) => normalizeUuidKey(entry.item.uuid) === normalizeUuidKey(selectedReviewUuid),
    ) ??
    filteredReviewQueueEntries[0] ??
    null
  const selectedAnalysisReviewNormalizedUuid = normalizeUuidKey(selectedAnalysisReviewEntry?.item.uuid)
  const selectedAnalysisReviewUploadKey =
    selectedAnalysisWindow && selectedAnalysisReviewNormalizedUuid
      ? `${selectedAnalysisWindow.id}:${selectedAnalysisReviewNormalizedUuid}`
      : null
  const isUploadingSelectedAnalysisReview = uploadingAnalysisInvoiceKey === selectedAnalysisReviewUploadKey
  const canUploadSelectedAnalysisReview = Boolean(
    selectedAnalysisWindow &&
      selectedAnalysisReviewNormalizedUuid &&
      selectedAnalysisReviewEntry?.previewInvoice?.readyToImport &&
      selectedAnalysisReviewEntry.previewInvoice.duplicateStatus === 'clear',
  )
  const normalizedHomologationSearch = normalizeSearchText(homologationSearch)
  const filteredHomologationEntries = reviewQueueEntries.filter(
    (entry) =>
      matchesSatReviewQueueFilter(entry, homologationQueueFilter) &&
      matchesSatReviewQueueSearch(entry, normalizedHomologationSearch),
  )
  const normalizedProcessedSearch = normalizeSearchText(processedSearch)
  const filteredProcessedAnalysisItems = processedAnalysisItems
    .filter((item) => matchesSatProcessedItemSearch(item, normalizedProcessedSearch))
    .slice(0, 60)
  const normalizedPreviewSearch = normalizeSearchText(previewSearch)
  const filteredPreviewQueueEntries = previewQueueEntries.filter(
    (entry) =>
      matchesSatReviewQueueFilter(entry, previewQueueFilter) &&
      matchesSatPreviewInvoiceSearch(entry, normalizedPreviewSearch),
  )
  const previewReadyQueueCount = previewQueueEntries.filter((entry) => entry.status === 'ready').length
  const previewBlockedQueueCount = previewQueueEntries.length - previewReadyQueueCount
  const selectedPreviewEntry =
    previewQueueEntries.find((entry) => entry.key === selectedPreviewInvoiceKey) ?? previewQueueEntries[0] ?? null
  const selectedPreviewRows = selectedPreviewEntry
    ? activePreviewRows.filter((row) => getSatPreviewInvoiceKey(row) === selectedPreviewEntry.key)
    : []
  const selectedPreviewLinkedReviewEntry =
    selectedPreviewEntry?.invoice.uuid
      ? reviewQueueEntries.find(
          (entry) => normalizeUuidKey(entry.item.uuid) === normalizeUuidKey(selectedPreviewEntry.invoice.uuid),
        ) ?? null
      : null
  const totalHomologationOverrides =
    (manualHomologationStore?.counts.providerOverrides ?? 0) + (manualHomologationStore?.counts.accountOverrides ?? 0)
  const showPackagesTables = activeTableView === 'packages'
  const showAnalysisWindowsTable = activeTableView === 'windows'
  const showProcessedTable = activeTableView === 'processed'
  const showHomologationPanel = activeTableView === 'homologation'
  const showPreviewPanel = activeTableView === 'preview'
  const suggestedExtractionWindow = suggestedExtraction ? findExistingWindowForSuggestedExtraction(suggestedExtraction) : null
  const hasPendingSuggestedExtraction = suggestedExtractionWindow?.status === 'pending_sat'
  const workflowBusy =
    isRefreshingStatus ||
    isTestingAuth ||
    isBootstrappingAnalysisWindow ||
    isReconcilingAnalysisWindow ||
    isPreparingAnalysisUploadState ||
    isUploadingReadyInvoices ||
    isRunningAnalysisWorkflow
  const canRunSuggestedExtraction = Boolean(
    suggestedExtraction && status?.canTestAuth && !workflowBusy,
  )
  const canProcessActiveWindow = Boolean(
    satConnectionReady && selectedAnalysisWindow && selectedAnalysisWindow.status === 'ready' && !workflowBusy,
  )
  const canUploadReadyToNetSuite = Boolean(
    satConnectionReady &&
      selectedAnalysisWindow &&
      selectedAnalysisPreviewLoaded &&
      readyReviewQueueEntries.length > 0 &&
      !workflowBusy,
  )
  const extractionActionLabel = isBootstrappingAnalysisWindow
    ? 'Extrayendo...'
    : isReconcilingAnalysisWindow && hasPendingSuggestedExtraction
      ? 'Revisando SAT...'
      : hasPendingSuggestedExtraction
        ? 'Extraccion en curso'
        : 'Extraccion'
  const suggestedExtractionLabel = suggestedExtraction
    ? `${formatDate(suggestedExtraction.startAtUtc)} a ${formatDate(suggestedExtraction.endAtUtc)}`
    : '--'
  const workflowStepSummary = suggestedExtraction
    ? hasPendingSuggestedExtraction
      ? `Ya existe una extraccion SAT viva para este rango. La pantalla la revisa sola cada ${formatInteger(
          Math.round(SAT_PENDING_EXTRACTION_POLL_INTERVAL_MS / 1000),
        )} segundos y dejara listo Procesar en cuanto haya paquetes.`
      : suggestedExtraction.basis === 'latest_window_overlap'
        ? `La siguiente extraccion se propone con ${formatInteger(
            suggestedExtraction.overlapDays,
          )} dias de solape desde la ultima ventana util.`
        : 'No existe una extraccion previa; se propone arrancar desde el inicio del mes actual.'
    : 'Aun no hay una recomendacion de extraccion disponible.'
  const readyUploadProgressPercent = readyUploadProgress ? getReadyUploadProgressPercent(readyUploadProgress) : 0
  const readyUploadProgressTone = readyUploadProgress
    ? readyUploadProgress.phase === 'completed'
      ? 'success'
      : readyUploadProgress.phase === 'failed'
        ? 'warning'
        : 'active'
    : null
  const readyUploadProgressPhaseLabel = readyUploadProgress
    ? getReadyUploadProgressPhaseLabel(readyUploadProgress.phase)
    : null

  useEffect(() => {
    if (!selectedAnalysisWindow || selectedAnalysisWindow.status !== 'pending_sat') {
      pendingSatPollWindowIdRef.current = null
      return
    }

    if (workflowBusy) {
      return
    }

    const currentPollWindowId = selectedAnalysisWindow.id
    const hasPolledThisWindow = pendingSatPollWindowIdRef.current === currentPollWindowId
    const delayMs = hasPolledThisWindow
      ? SAT_PENDING_EXTRACTION_POLL_INTERVAL_MS
      : SAT_PENDING_EXTRACTION_FIRST_POLL_DELAY_MS

    pendingSatPollWindowIdRef.current = currentPollWindowId
    const timerId = window.setTimeout(() => {
      void refreshPendingSuggestedExtraction(selectedAnalysisWindow, 'auto')
    }, delayMs)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [selectedAnalysisWindow?.id, selectedAnalysisWindow?.status, selectedAnalysisWindow?.updatedAtUtc, workflowBusy])

  const landingRecommendation = !status?.configured
    ? {
        sectionId: 'status' as FacturasSatHeaderSectionId,
        title: 'Completa la configuracion local del SAT',
        description: 'Faltan rutas o credenciales antes de poder autenticar, solicitar y bajar paquetes.',
        actionLabel: 'Abrir Status',
      }
    : !authTest?.success && status?.canTestAuth
      ? {
          sectionId: 'status' as FacturasSatHeaderSectionId,
          title: 'Valida la autenticacion real contra SAT',
          description: 'La configuracion local ya existe; falta confirmar el token real antes de operar el flujo.',
          actionLabel: 'Probar SAT',
        }
      : selectedAnalysisWindow && !selectedAnalysisPreviewLoaded
        ? {
            sectionId: 'analysis' as FacturasSatHeaderSectionId,
            title: 'Actualiza la carga de la ventana activa',
            description: 'La cola esta recalculando duplicados, proveedores y cuentas para mostrar el estado operativo real.',
            actionLabel: 'Abrir Analisis',
          }
        : reviewQueueSummary.ready > 0
          ? {
              sectionId: 'analysis' as FacturasSatHeaderSectionId,
              title: `${formatInteger(reviewQueueSummary.ready)} facturas listas para subir`,
              description: 'La ventana activa ya tiene facturas sin duplicado ni incidencias bloqueantes.',
              actionLabel: 'Ir a Analisis',
            }
          : homologationPendingCount > 0
            ? {
                sectionId: 'homologation' as FacturasSatHeaderSectionId,
                title: `${formatInteger(homologationPendingCount)} facturas no listas`,
                description: 'Resuelve proveedor, cuenta o retencion para liberar la cola de carga.',
                actionLabel: 'Ir a No listas',
              }
            : (downloadHistory?.totalPackages ?? 0) === 0
              ? {
                  sectionId: 'request' as FacturasSatHeaderSectionId,
                  title: 'Genera una nueva solicitud SAT',
                  description: 'Todavia no hay paquetes locales para alimentar el pipeline de descarga y analisis.',
                  actionLabel: 'Abrir Solicitud',
                }
              : totalAnalysisWindows === 0
                ? {
                    sectionId: 'analysis' as FacturasSatHeaderSectionId,
                    title: 'Crea un subset SAT para operar la cola',
                    description: 'Ya hay paquetes locales, pero falta una ventana de analisis para revisarlos y subirlos.',
                    actionLabel: 'Crear subset',
                  }
                : {
                    sectionId: 'packages' as FacturasSatHeaderSectionId,
                    title: 'Revisa paquetes y previews activos',
                    description: 'El flujo base esta estable; el siguiente paso es inspeccionar cache, modelo y nuevos lotes.',
                    actionLabel: 'Abrir Paquetes',
                  }
  const landingRecommendationSection =
    FACTURAS_SAT_HEADER_SECTIONS.find((section) => section.id === landingRecommendation.sectionId) ??
    FACTURAS_SAT_HEADER_SECTIONS[0]
  const facturasSatRouteCards = FACTURAS_SAT_HEADER_SECTIONS.map((section) => {
    switch (section.id) {
      case 'status':
        return {
          section,
          tone: !status?.configured ? 'error' : authTest?.success ? 'healthy' : 'review',
          statusLabel: !status?.configured ? 'Pendiente' : authTest?.success ? 'Autenticada' : 'Por validar',
          metricValue: status?.certificate?.rfc ?? 'SAT local',
          metricCaption: status?.certificate?.validTo
            ? `E.firma vigente al ${formatDate(status.certificate.validTo)}`
            : 'Sin certificado detectado todavia',
          detail: status?.configured
            ? 'La e.firma ya esta montada y la pantalla puede correr pruebas reales contra SAT.'
            : 'Faltan rutas, password o certificado para habilitar el flujo operativo.',
        }
      case 'request':
        return {
          section,
          tone: latestReadyToDownloadPackages > 0 ? 'ready' : latestRequestId ? 'review' : 'idle',
          statusLabel:
            latestReadyToDownloadPackages > 0
              ? 'Lista para bajar'
              : latestRequestId
                ? 'Con request'
                : 'Sin request',
          metricValue: latestRequestId ?? 'Sin request',
          metricCaption: latestRequestStatusMessage,
          detail:
            latestReadyToDownloadPackages > 0
              ? `${formatInteger(latestReadyToDownloadPackages)} paquetes ya quedaron listos para descarga.`
              : 'Genera o verifica un request id SAT para seguir bajando CFDI.',
        }
      case 'packages':
        return {
          section,
          tone: (downloadHistory?.totalPackages ?? 0) > 0 ? 'healthy' : 'idle',
          statusLabel: (downloadHistory?.totalPackages ?? 0) > 0 ? 'Cache local' : 'Sin paquetes',
          metricValue: formatInteger(downloadHistory?.totalPackages ?? 0),
          metricCaption: `${formatInteger(downloadHistory?.totalCfdis ?? 0)} CFDI cacheados`,
          detail: latestDownloadRecord
            ? `Ultimo paquete descargado ${formatDateTime(latestDownloadRecord.lastDownloadedAtUtc)}.`
            : 'Todavia no hay paquetes ZIP/XML descargados localmente.',
        }
      case 'analysis':
        return {
          section,
          tone:
            selectedAnalysisWindow && !selectedAnalysisPreviewLoaded
              ? 'review'
              : reviewQueueSummary.ready > 0
                ? 'ready'
                : reviewQueueEntries.length > 0
                  ? 'review'
                  : 'idle',
          statusLabel:
            selectedAnalysisWindow && !selectedAnalysisPreviewLoaded
              ? 'Preparando'
              : reviewQueueSummary.ready > 0
                ? 'Listas para subir'
                : reviewQueueEntries.length > 0
                  ? 'En revision'
                  : 'Sin pendientes',
          metricValue: formatInteger(reviewQueueSummary.ready),
          metricCaption: selectedAnalysisWindow
            ? `${selectedAnalysisWindow.label} · ${formatInteger(analysisQueueItems.length)} pendientes`
            : 'No hay ventana activa todavia',
          detail:
            selectedAnalysisWindow && !selectedAnalysisPreviewLoaded
              ? 'La app esta recalculando preview, duplicados y bloqueos de la ventana activa.'
              : `${formatInteger(reviewQueueBlockedCount)} facturas requieren revision antes de subir.`,
        }
      case 'homologation':
        return {
          section,
          tone:
            selectedAnalysisWindow && !selectedAnalysisPreviewLoaded
              ? 'idle'
              : homologationPendingCount > 0
                ? 'review'
                : totalHomologationOverrides > 0
                  ? 'healthy'
                  : 'idle',
          statusLabel:
            selectedAnalysisWindow && !selectedAnalysisPreviewLoaded
              ? 'Esperando preview'
              : homologationPendingCount > 0
                ? 'Pendientes'
                : totalHomologationOverrides > 0
                  ? 'Con overrides'
                  : 'Sin carga',
          metricValue: formatInteger(homologationPendingCount),
          metricCaption: `${formatInteger(manualHomologationStore?.counts.providerOverrides ?? 0)} proveedores y ${formatInteger(manualHomologationStore?.counts.accountOverrides ?? 0)} cuentas guardadas`,
          detail:
            homologationPendingCount > 0
              ? 'Aqui resolvemos proveedores, cuentas de gasto y retenciones que bloquean la subida.'
              : 'La cola actual no trae incidencias manuales fuertes o ya fueron atendidas.',
        }
      case 'preview':
        return {
          section,
          tone:
            previewReadyCount > 0
              ? previewIssueCount > previewReadyCount
                ? 'review'
                : 'ready'
              : previewIssueCount > 0
                ? 'review'
                : 'idle',
          statusLabel:
            previewReadyCount > 0
              ? 'Preview activo'
              : previewIssueCount > 0
                ? 'Con incidencias'
                : 'Sin preview',
          metricValue: formatInteger(previewReadyCount),
          metricCaption: `${formatInteger(previewDuplicateCount)} duplicadas y ${formatInteger(previewIssueCount)} con incidencia`,
          detail:
            selectedAnalysisPreviewLoaded || netsuitePreview
              ? 'El modelo de NetSuite ya permite revisar lineas, duplicados y facturas listas.'
              : 'Prepara un paquete o una ventana para ver aqui el payload final hacia NetSuite.',
      }
    }
  })
  const landingRecommendationPath =
    landingRecommendationSection.slug === 'status'
      ? '/facturas-sat'
      : buildFacturasSatUnifiedPath(landingRecommendationSection.slug)
  const currentHeaderTitle = showPendingLanding
    ? 'Pendientes por subir'
    : FACTURAS_SAT_HEADER_SECTIONS.find((section) => section.slug === effectiveRequestedPanel)?.title ??
      'Operacion SAT'
  const facturasSatHeaderTabs: Array<{
    key: string
    label: string
    value: string
    to: string
    active: boolean
  }> = [
    {
      key: 'pending',
      label: 'Pendientes',
      value: formatInteger(reviewQueueSummary.ready),
      to: '/facturas-sat',
      active: showPendingLanding,
    },
    {
      key: 'solicitud',
      label: 'Solicitud',
      value: formatInteger(latestReadyToDownloadPackages),
      to: buildFacturasSatUnifiedPath('solicitud'),
      active: showRequestPanel,
    },
    {
      key: 'analisis',
      label: 'Flujo',
      value: formatInteger(analysisQueueItems.length),
      to: buildFacturasSatUnifiedPath('analisis'),
      active: showAnalysisWorkspacePanel && activeTableView === 'pending',
    },
    {
      key: 'windows',
      label: 'Ventanas',
      value: formatInteger(totalAnalysisWindows),
      to: buildFacturasSatUnifiedPath('analisis', null, 'windows'),
      active: showAnalysisWindowsTable,
    },
    {
      key: 'processed',
      label: 'Procesadas',
      value: formatInteger(processedAnalysisItems.length),
      to: buildFacturasSatUnifiedPath('analisis', null, 'processed'),
      active: showProcessedTable,
    },
    {
      key: 'packages',
      label: 'Paquetes',
      value: formatInteger(downloadHistory?.totalPackages ?? 0),
      to: buildFacturasSatUnifiedPath('paquetes'),
      active: showPackagesTables,
    },
    {
      key: 'homologation',
      label: 'No listas',
      value: formatInteger(homologationPendingCount),
      to: buildFacturasSatUnifiedPath('homologacion'),
      active: showHomologationPanel,
    },
    {
      key: 'preview',
      label: 'Preview',
      value: formatInteger(previewQueueEntries.length),
      to: buildFacturasSatUnifiedPath('preview'),
      active: showPreviewPanel,
    },
  ]
  const selectedReviewEntry =
    reviewQueueEntries.find((entry) => normalizeUuidKey(entry.item.uuid) === normalizeUuidKey(selectedReviewUuid)) ??
    reviewQueueEntries[0] ??
    null
  const selectedReviewRows =
    selectedReviewEntry?.item.uuid && selectedAnalysisPreviewState
      ? selectedAnalysisPreviewState.rowsByUuid[normalizeUuidKey(selectedReviewEntry.item.uuid)] ?? []
      : []
  const selectedReviewIssueList = selectedReviewEntry?.previewInvoice?.issues ?? []
  const selectedReviewDuplicateMatches = selectedReviewEntry?.previewInvoice?.duplicateMatches ?? []
  const selectedReviewNormalizedUuid = normalizeUuidKey(selectedReviewEntry?.item.uuid)
  const selectedReviewMissingExpenseRows = selectedReviewRows.filter(
    (row) => row.lineType !== 'retention' && !row.cuentaGastos,
  )
  const selectedReviewRetentionRows = selectedReviewRows.filter((row) => row.lineType === 'retention')
  const missingClaveOptions = getMissingClaveOptions(selectedReviewRows)
  const selectedSupplier =
    supplierCatalog?.items.find((item) => item.internalId === selectedSupplierId) ?? null
  const selectedProviderCc =
    accountCatalog?.items.find((item) => item.internalId === selectedProviderCcId) ?? null
  const selectedExpenseAccount =
    accountCatalog?.items.find((item) => item.internalId === selectedExpenseAccountId) ?? null
  const supplierOptions = filterSupplierCatalog(
    supplierCatalog?.items ?? [],
    supplierSearch || selectedReviewEntry?.item.emisorNombre || selectedReviewEntry?.previewInvoice?.nombreEmisor || '',
  ).slice(0, 8)
  const providerCcOptions = filterAccountCatalog(
    accountCatalog?.items ?? [],
    providerCcSearch || selectedSupplier?.accountDisplayName || '',
  ).slice(0, 8)
  const expenseAccountOptions = filterAccountCatalog(
    accountCatalog?.items ?? [],
    expenseAccountSearch || selectedMissingClave || '',
  ).slice(0, 8)

  useEffect(() => {
    if (!selectedAnalysisWindow || selectedAnalysisPreviewLoaded || isPreparingAnalysisUploadState) {
      return
    }

    void prepareAnalysisWindowUploadState(selectedAnalysisWindow)
  }, [
    isPreparingAnalysisUploadState,
    selectedAnalysisPreviewLoaded,
    selectedAnalysisWindow?.id,
    selectedAnalysisWindow?.updatedAtUtc,
  ])

  useEffect(() => {
    if (!selectedAnalysisPreviewLoaded) {
      return
    }

    void ensureHomologationSupportLoaded()
  }, [selectedAnalysisPreviewLoaded])

  useEffect(() => {
    if (reviewQueueEntries.length === 0) {
      if (selectedReviewUuid !== null) {
        setSelectedReviewUuid(null)
      }
      return
    }

    if (
      selectedReviewUuid &&
      reviewQueueEntries.some((entry) => normalizeUuidKey(entry.item.uuid) === normalizeUuidKey(selectedReviewUuid))
    ) {
      return
    }

    setSelectedReviewUuid(reviewQueueEntries[0]?.item.uuid ?? null)
  }, [reviewQueueEntries, selectedReviewUuid])

  useEffect(() => {
    setAnalysisQueueFilter('actionable')
    setAnalysisSearch('')
    setProcessedSearch('')
    setHomologationQueueFilter('actionable')
    setHomologationSearch('')
  }, [selectedAnalysisWindow?.id])

  useEffect(() => {
    if (!requestedReviewUuid || (effectiveRequestedPanel !== 'analisis' && effectiveRequestedPanel !== 'homologacion')) {
      reviewRouteFocusRef.current = null
      return
    }

    const matchedEntry =
      reviewQueueEntries.find(
        (entry) => normalizeUuidKey(entry.item.uuid) === normalizeUuidKey(requestedReviewUuid),
      ) ?? null

    if (!matchedEntry) {
      return
    }

    const targetSection = effectiveRequestedPanel === 'homologacion' ? 'homologation' : 'analysis'
    const focusKey = `${targetSection}:${requestedReviewUuid}`
    if (reviewRouteFocusRef.current === focusKey) {
      return
    }

    focusReviewUuidOnSection(matchedEntry.item.uuid ?? requestedReviewUuid, targetSection)
    reviewRouteFocusRef.current = focusKey
  }, [effectiveRequestedPanel, requestedReviewUuid, reviewQueueEntries])

  useEffect(() => {
    setPreviewQueueFilter('all')
    setPreviewSearch('')
    previewRouteFocusRef.current = null
    previewAutoLinkedRef.current = false
  }, [netsuitePreview?.packageId])

  useEffect(() => {
    if (!requestedReviewUuid || filteredHomologationEntries.length === 0) {
      return
    }

    if (
      selectedReviewUuid &&
      filteredHomologationEntries.some(
        (entry) => normalizeUuidKey(entry.item.uuid) === normalizeUuidKey(selectedReviewUuid),
      )
    ) {
      return
    }

    const matchedEntry =
      filteredHomologationEntries.find(
        (entry) => normalizeUuidKey(entry.item.uuid) === normalizeUuidKey(requestedReviewUuid),
      ) ?? null

    if (!matchedEntry) {
      return
    }

    setSelectedReviewUuid(matchedEntry.item.uuid ?? requestedReviewUuid)
  }, [filteredHomologationEntries, requestedReviewUuid, selectedReviewUuid])

  useEffect(() => {
    if (previewQueueEntries.length === 0) {
      if (selectedPreviewInvoiceKey !== null) {
        setSelectedPreviewInvoiceKey(null)
      }
      return
    }

    if (selectedPreviewInvoiceKey && previewQueueEntries.some((entry) => entry.key === selectedPreviewInvoiceKey)) {
      return
    }

    setSelectedPreviewInvoiceKey(previewQueueEntries[0]?.key ?? null)
  }, [previewQueueEntries, selectedPreviewInvoiceKey])

  useEffect(() => {
    if (previewAutoLinkedRef.current || previewQueueEntries.length === 0 || reviewQueueEntries.length === 0) {
      return
    }

    const linkedPreviewEntry =
      previewQueueEntries.find(
        (entry) =>
          entry.invoice.uuid &&
          reviewQueueEntries.some(
            (reviewEntry) => normalizeUuidKey(reviewEntry.item.uuid) === normalizeUuidKey(entry.invoice.uuid),
          ),
      ) ?? null

    previewAutoLinkedRef.current = true

    if (!linkedPreviewEntry || linkedPreviewEntry.key === selectedPreviewInvoiceKey) {
      return
    }

    setSelectedPreviewInvoiceKey(linkedPreviewEntry.key)
  }, [previewQueueEntries, reviewQueueEntries, selectedPreviewInvoiceKey])

  useEffect(() => {
    if (!requestedReviewUuid || effectiveRequestedPanel !== 'preview') {
      previewRouteFocusRef.current = null
      return
    }

    const matchedEntry =
      previewQueueEntries.find(
        (entry) => normalizeUuidKey(entry.invoice.uuid) === normalizeUuidKey(requestedReviewUuid),
      ) ?? null

    if (!matchedEntry) {
      return
    }

    const focusKey = `preview:${activePreviewPackageLabel}:${requestedReviewUuid}`
    if (previewRouteFocusRef.current === focusKey) {
      return
    }

    setPreviewQueueFilter('all')
    setPreviewSearch(matchedEntry.invoice.uuid ?? requestedReviewUuid)
    setSelectedPreviewInvoiceKey(matchedEntry.key)
    previewRouteFocusRef.current = focusKey
  }, [activePreviewPackageLabel, effectiveRequestedPanel, requestedReviewUuid, previewQueueEntries])

  useEffect(() => {
    if (filteredPreviewQueueEntries.length === 0) {
      return
    }

    if (
      selectedPreviewInvoiceKey &&
      filteredPreviewQueueEntries.some((entry) => entry.key === selectedPreviewInvoiceKey)
    ) {
      return
    }

    setSelectedPreviewInvoiceKey(filteredPreviewQueueEntries[0]?.key ?? null)
  }, [filteredPreviewQueueEntries, selectedPreviewInvoiceKey])

  useEffect(() => {
    if (!effectiveRequestedPanel) {
      panelScrollRef.current = null
      return
    }

    const scrollKey = `${effectiveRequestedPanel}:${requestedReviewUuid}`
    if (panelScrollRef.current === scrollKey) {
      return
    }

    panelScrollRef.current = scrollKey
    scrollToFacturasSatSection(effectiveRequestedPanel)
  }, [effectiveRequestedPanel, requestedReviewUuid])

  useEffect(() => {
    setSupplierSearch(selectedReviewEntry?.item.emisorNombre ?? selectedReviewEntry?.previewInvoice?.nombreEmisor ?? '')
    setSelectedSupplierId(null)
    setProviderCcSearch('')
    setSelectedProviderCcId(null)
    setExpenseAccountSearch('')
    setSelectedExpenseAccountId(null)
  }, [selectedReviewEntry?.item.uuid])

  useEffect(() => {
    if (missingClaveOptions.length === 0) {
      if (selectedMissingClave !== null) {
        setSelectedMissingClave(null)
      }
      return
    }

    if (selectedMissingClave && missingClaveOptions.includes(selectedMissingClave)) {
      return
    }

    setSelectedMissingClave(missingClaveOptions[0] ?? null)
  }, [missingClaveOptions, selectedMissingClave])

  async function handleSaveProviderHomologation() {
    if (!selectedReviewEntry) {
      setError('Selecciona primero una factura pendiente para guardar la homologacion del proveedor.')
      return
    }

    if (!selectedSupplier) {
      setError('Selecciona un proveedor de NetSuite antes de guardar la homologacion manual.')
      return
    }

    const effectiveCc = selectedProviderCc ?? resolveDefaultSupplierCc(selectedSupplier, accountCatalog)
    if (!effectiveCc) {
      setError('Selecciona la cuenta proveedor antes de guardar la homologacion manual.')
      return
    }

    setIsSavingProviderHomologation(true)

    try {
      const response = await saveSatManualProviderHomologation({
        nombreEmisor: selectedReviewEntry.previewInvoice?.nombreEmisor ?? selectedReviewEntry.item.emisorNombre,
        emisorRfc: selectedReviewEntry.previewInvoice?.rfcEmisor ?? selectedReviewEntry.item.emisorRfc,
        saveByName: Boolean(
          selectedReviewEntry.previewInvoice?.nombreEmisor ?? selectedReviewEntry.item.emisorNombre,
        ),
        saveByRfc: Boolean(selectedReviewEntry.previewInvoice?.rfcEmisor ?? selectedReviewEntry.item.emisorRfc),
        supplierInternalId: selectedSupplier.internalId,
        supplierDisplayName: selectedSupplier.displayName,
        ccInternalId: effectiveCc.internalId,
        ccDisplayName: effectiveCc.displayName,
      })

      setManualHomologationStore(response.store)
      if (selectedAnalysisWindow) {
        await prepareAnalysisWindowUploadState(selectedAnalysisWindow, true)
      }
      setError(null)
    } catch (reason) {
      setError(parseError(reason))
    } finally {
      setIsSavingProviderHomologation(false)
    }
  }

  async function handleSaveAccountHomologation() {
    if (!selectedMissingClave) {
      setError('Selecciona primero la ClaveProdServ pendiente para guardar la cuenta de gasto.')
      return
    }

    if (!selectedExpenseAccount) {
      setError('Selecciona una cuenta de gasto antes de guardar la homologacion manual.')
      return
    }

    setIsSavingAccountHomologation(true)

    try {
      const response = await saveSatManualAccountHomologation({
        claveProdServ: selectedMissingClave,
        accountInternalId: selectedExpenseAccount.internalId,
        accountDisplayName: selectedExpenseAccount.displayName,
      })

      setManualHomologationStore(response.store)
      if (selectedAnalysisWindow) {
        await prepareAnalysisWindowUploadState(selectedAnalysisWindow, true)
      }
      setError(null)
    } catch (reason) {
      setError(parseError(reason))
    } finally {
      setIsSavingAccountHomologation(false)
    }
  }

  if (shouldRedirectToUnifiedFacturasSatRoute) {
    return <Navigate to={buildFacturasSatUnifiedPath(requestedLegacyPanel, requestedReviewUuid)} replace />
  }

  return (
    <div className="row g-4">
      <div className="col-12 facturas-sat-section">
        <div className="surface-card card facturas-sat-header">
          <div className="card-body">
            <div className="analysis-toolbar facturas-sat-header__top">
              <div className="facturas-sat-header__lead">
                <div className="eyebrow">Facturas (SAT)</div>
                <h2 className="h4 mb-0">{currentHeaderTitle}</h2>
              </div>

              <div className="analysis-toolbar__actions">
                <div className="lab-sync">
                  {status?.checkedAtUtc
                    ? `Ultima lectura local: ${formatDateTime(status.checkedAtUtc)}`
                    : 'Sin lectura local todavia'}
                </div>

                <div className="control-inline">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void refreshStatus(false)}
                    disabled={workflowBusy}
                  >
                    {isRefreshingStatus ? 'Refrescando...' : 'Refrescar estado'}
                  </button>

                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void testSatAuth()}
                    disabled={!status?.canTestAuth || workflowBusy}
                  >
                    {isTestingAuth ? 'SAT conectando...' : 'SAT conexion'}
                  </button>

                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void handleSuggestedExtraction()}
                    disabled={!canRunSuggestedExtraction}
                  >
                    {extractionActionLabel}
                  </button>

                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void handleProcessSelectedAnalysisWindow()}
                    disabled={!canProcessActiveWindow}
                  >
                    {isRunningAnalysisWorkflow || isReconcilingAnalysisWindow || isPreparingAnalysisUploadState
                      ? 'Procesando...'
                      : 'Procesar'}
                  </button>

                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() =>
                      selectedAnalysisWindow
                        ? void handleUploadReadyAnalysisInvoices(selectedAnalysisWindow.id)
                        : undefined
                    }
                    disabled={!canUploadReadyToNetSuite}
                  >
                    {isUploadingReadyInvoices ? 'Subiendo...' : 'Subir NetSuite'}
                  </button>
                </div>
              </div>
            </div>

            {error ? <div className="alert alert-warning mt-3 mb-0">{error}</div> : null}

            {authTest?.success ? (
              <div className="alert alert-success mt-3 mb-0">
                Autenticacion SAT correcta. Token valido generado a las{' '}
                {formatDateTime(authTest.token.createdAtUtc)}.
              </div>
            ) : null}

            {readyUploadProgress && readyUploadProgressTone ? (
              <div
                className={`facturas-sat-upload-monitor facturas-sat-upload-monitor--${readyUploadProgressTone} mt-3`}
                role="status"
                aria-live="polite"
              >
                <div className="facturas-sat-upload-monitor__top">
                  <div className="facturas-sat-upload-monitor__copy">
                    <div className="eyebrow">Subida NetSuite</div>
                    <h3 className="h6 mb-1">{readyUploadProgressPhaseLabel}</h3>
                    <p className="mb-0">{readyUploadProgress.message}</p>
                  </div>

                  <div className="facturas-sat-upload-monitor__percent">{readyUploadProgressPercent}%</div>
                </div>

                <div className="facturas-sat-upload-monitor__bar">
                  <span style={{ width: `${readyUploadProgressPercent}%` }} />
                </div>

                <div className="facturas-sat-upload-monitor__meta">
                  <span>
                    {formatInteger(readyUploadProgress.completed)} de{' '}
                    {formatInteger(readyUploadProgress.total)} facturas completadas
                  </span>
                  {readyUploadProgress.uuid ? (
                    <span className="analysis-break">UUID activo: {readyUploadProgress.uuid}</span>
                  ) : null}
                  {lastBulkUploadSummary ? (
                    <span>
                      Creadas {formatInteger(lastBulkUploadSummary.created)} · Omitidas{' '}
                      {formatInteger(lastBulkUploadSummary.skipped)} · Fallidas{' '}
                      {formatInteger(lastBulkUploadSummary.failed)}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="facturas-sat-analysis-subnav mt-3" data-table-card-count={facturasSatHeaderTabs.length}>
              <div className="note-strip note-strip--accent mb-3">
                Siguiente extraccion sugerida: {suggestedExtractionLabel}. {workflowStepSummary}
              </div>
              <div className="facturas-sat-analysis-subnav__actions">
                {facturasSatHeaderTabs.map((tab) => (
                  <NavLink
                    key={tab.key}
                    to={tab.to}
                    className={`facturas-sat-analysis-subnav__button ${
                      tab.active ? 'facturas-sat-analysis-subnav__button--active' : ''
                    }`}
                  >
                    <span>{tab.label}</span>
                    <strong>{tab.value}</strong>
                  </NavLink>
                ))}
              </div>


              {false ? (
              <div className="facturas-sat-landing-kpi-grid">
                <div className="facturas-sat-landing-kpi">
                  <span>Estado SAT local</span>
                  <strong>{status?.configured ? 'Listo' : 'Pendiente'}</strong>
                  <small>
                    {authTest?.success
                      ? authTest?.token?.expiresAtUtc
                        ? `Token valido hasta ${formatDateTime(authTest?.token?.expiresAtUtc ?? '')}`
                        : 'Token SAT generado'
                      : status?.canTestAuth
                        ? 'Listo para probar autenticacion'
                        : 'Falta validar la configuracion base'}
                  </small>
                </div>

                <div className="facturas-sat-landing-kpi">
                  <span>RFC detectado</span>
                  <strong>{status?.certificate?.rfc ?? '--'}</strong>
                  <small>
                    {status?.certificate?.validTo
                      ? `E.firma vigente al ${formatDate(status?.certificate?.validTo ?? '')}`
                      : 'Sin certificado detectado todavia'}
                  </small>
                </div>

                <div className="facturas-sat-landing-kpi">
                  <span>Paquetes listos</span>
                  <strong>{formatInteger(latestReadyToDownloadPackages)}</strong>
                  <small>{latestRequestStatusMessage}</small>
                </div>

                <div className="facturas-sat-landing-kpi">
                  <span>Listas para subir</span>
                  <strong>{formatInteger(reviewQueueSummary.ready)}</strong>
                  <small>{formatInteger(homologationPendingCount)} bloqueos manuales vigentes</small>
                </div>

                <div className="facturas-sat-landing-kpi">
                  <span>Ventana activa</span>
                  <strong>
                    {selectedAnalysisWindow ? formatInteger(selectedAnalysisWindow?.processedItems.length ?? 0) : '--'}
                  </strong>
                  <small>
                    {selectedAnalysisWindow ? `${selectedAnalysisWindow?.label ?? '--'}` : 'Aun no existe una ventana activa'}
                  </small>
                </div>
              </div>
              ) : null}

              {false ? (
              <>
              <div className="facturas-sat-analysis-subnav mt-4" data-table-card-count={facturasSatRouteCards.length}>
                <div className="facturas-sat-analysis-subnav__copy">
                  <div className="eyebrow">Tablas operativas</div>
                  <h3 className="h5 mb-1">La portada deja visible solo pendientes</h3>
                  <p className="mb-0 text-secondary">
                    Abre el resto de tablas desde aqui sin salir de `#/facturas-sat`; cada boton actualiza la URL.
                  </p>
                </div>

                <div className="facturas-sat-analysis-subnav__actions">
                  {facturasSatHeaderTabs.map((tab) => (
                    <NavLink
                      key={tab.key}
                      to={tab.to}
                      className={`facturas-sat-analysis-subnav__button ${
                        tab.active ? 'facturas-sat-analysis-subnav__button--active' : ''
                      }`}
                    >
                      <span>{tab.label}</span>
                      <strong>{tab.value}</strong>
                    </NavLink>
                  ))}
                </div>
              </div>

              <div className="summary-list mt-4">
                <div className="summary-list__item">
                  <span>Autenticacion SAT disponible</span>
                  <strong>{status?.canTestAuth ? 'Si' : 'No'}</strong>
                </div>
                <div className="summary-list__item">
                  <span>Ultimo request SAT</span>
                  <strong className="analysis-break">{latestRequestId ?? '--'}</strong>
                </div>
                <div className="summary-list__item">
                  <span>Ultimo paquete</span>
                  <strong className="analysis-break">{latestVerifiedPackageId ?? '--'}</strong>
                </div>
                <div className="summary-list__item">
                  <span>Endpoint SAT</span>
                  <strong className="analysis-break">{status?.endpoint ?? '--'}</strong>
                </div>
                <div className="summary-list__item">
                  <span>Password source</span>
                  <strong>{status?.files.passwordSource ?? '--'}</strong>
                </div>
                <div className="summary-list__item">
                  <span>Overrides manuales</span>
                  <strong>{formatInteger(totalHomologationOverrides)}</strong>
                </div>
              </div>
              </>
              ) : null}

              <div className="lab-sync mt-3">
                {status?.certificate?.rfc ? `RFC ${status.certificate.rfc}` : 'Sin RFC detectado'} · Request{' '}
                {latestRequestId ?? '--'} · Paquete {latestVerifiedPackageId ?? '--'} · Overrides{' '}
                {formatInteger(totalHomologationOverrides)}
              </div>

              {status?.validationError ? (
                <div className="alert alert-warning mt-3 mb-0">{status.validationError}</div>
              ) : null}

              {!status?.configured && (status?.missing.length ?? 0) > 0 ? (
                <div className="note-strip mt-3">
                  Faltan estas variables para SAT: {status?.missing.join(', ')}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {showRequestPanel ? (
      <>
      <div className="col-12 facturas-sat-section" id="facturas-sat-request">
        <div className="surface-card card">
          <div className="card-body">
            <div className="eyebrow">Solicitud SAT</div>
            <h3 className="h4 mb-3">SolicitaDescarga</h3>

            <div className="bank-form-grid">
              <label className="bank-field">
                <span>Fecha inicio</span>
                <input
                  type="datetime-local"
                  className="bank-input"
                  value={formState.startAt}
                  onChange={(event) => updateFormState('startAt', event.target.value)}
                  disabled={hasUuidFilter}
                />
                <small>Se convertira a UTC antes de enviarlo al backend.</small>
              </label>

              <label className="bank-field">
                <span>Fecha fin</span>
                <input
                  type="datetime-local"
                  className="bank-input"
                  value={formState.endAt}
                  onChange={(event) => updateFormState('endAt', event.target.value)}
                  disabled={hasUuidFilter}
                />
                <small>Si pones UUID, el periodo deja de ser necesario.</small>
              </label>

              <label className="bank-field">
                <span>Descarga</span>
                <select
                  className="bank-select"
                  value={formState.downloadType}
                  onChange={(event) =>
                    updateFormState('downloadType', event.target.value as SatCfdiDownloadType)
                  }
                >
                  <option value="received">Recibidas</option>
                  <option value="issued">Emitidas</option>
                </select>
                <small>Recibidas consulta XML donde SHQ es receptor; emitidas, donde es emisor.</small>
              </label>

              <label className="bank-field">
                <span>Formato</span>
                <select
                  className="bank-select"
                  value={formState.requestType}
                  onChange={(event) =>
                    updateFormState('requestType', event.target.value as SatCfdiRequestType)
                  }
                >
                  <option value="xml">XML</option>
                  <option value="metadata">Metadata</option>
                </select>
                <small>Para XML recibidos el SAT solo admite documentos activos.</small>
              </label>

              <label className="bank-field">
                <span>Estado documento</span>
                <select
                  className="bank-select"
                  value={formState.documentStatus}
                  onChange={(event) =>
                    updateFormState('documentStatus', event.target.value as SatCfdiDocumentStatus)
                  }
                  disabled={hasUuidFilter}
                >
                  <option value="undefined">Sin filtro</option>
                  <option value="active">Activas</option>
                  <option value="cancelled">Canceladas</option>
                </select>
              </label>

              <label className="bank-field">
                <span>Tipo CFDI</span>
                <select
                  className="bank-select"
                  value={formState.documentType}
                  onChange={(event) =>
                    updateFormState('documentType', event.target.value as SatCfdiDocumentType)
                  }
                  disabled={hasUuidFilter}
                >
                  <option value="undefined">Sin filtro</option>
                  <option value="ingreso">Ingreso</option>
                  <option value="egreso">Egreso</option>
                  <option value="traslado">Traslado</option>
                  <option value="nomina">Nomina</option>
                  <option value="pago">Pago</option>
                </select>
              </label>

              <label className="bank-field">
                <span>RFC contraparte</span>
                <input
                  type="text"
                  className="bank-input"
                  value={formState.rfcMatch}
                  onChange={(event) => updateFormState('rfcMatch', event.target.value.toUpperCase())}
                  disabled={hasUuidFilter}
                  placeholder="Opcional"
                />
                <small>
                  En recibidas filtra por RFC emisor; en emitidas, por RFC receptor.
                </small>
              </label>

              <label className="bank-field bank-field--wide">
                <span>UUID</span>
                <input
                  type="text"
                  className="bank-input"
                  value={formState.uuid}
                  onChange={(event) => updateFormState('uuid', event.target.value.toUpperCase())}
                  placeholder="Opcional, prioriza consulta puntual por folio fiscal"
                />
                <small>
                  Si informas UUID, el backend enviara la consulta puntual y desactivara los
                  filtros incompatibles del SAT.
                </small>
              </label>
            </div>

            <div className="control-inline mt-4">
              <button
                type="button"
                className="ghost-button"
                onClick={() => void handleSubmitRequest()}
                disabled={!status?.canTestAuth || isSubmittingRequest}
              >
                {isSubmittingRequest ? 'Solicitando...' : 'Solicitar descarga SAT'}
              </button>

              <button
                type="button"
                className="ghost-button"
                onClick={() => setFormState(createDefaultFormState())}
                disabled={isSubmittingRequest || isVerifyingRequest || isInspectingPackage}
              >
                Restablecer filtros
              </button>
            </div>

            <div className="note-strip mt-3">
              Usa periodos pequenos para la primera prueba. El SAT puede devolver la solicitud en
              progreso o sin resultados, y ambos estados siguen siendo validos.
            </div>
          </div>
        </div>
      </div>

      <div className="col-xl-6">
        <div className="surface-card card">
          <div className="card-body">
            <div className="eyebrow">Resultado solicitud</div>
            <h3 className="h4 mb-3">Request id del SAT</h3>

            <label className="bank-field">
              <span>Request id</span>
              <input
                type="text"
                className="bank-input"
                value={requestIdInput}
                onChange={(event) => setRequestIdInput(event.target.value)}
                placeholder="Se rellenara al solicitar o puedes pegar uno existente"
              />
            </label>

            <div className="control-inline mt-3">
              <button
                type="button"
                className="ghost-button"
                onClick={() => void handleVerifyRequest()}
                disabled={!requestIdInput.trim() || isVerifyingRequest}
              >
                {isVerifyingRequest ? 'Verificando...' : 'Verificar solicitud'}
              </button>
            </div>

            <div className="summary-list mt-4">
              <div className="summary-list__item">
                <span>Estado SAT</span>
                <strong>{requestResult?.status.message ?? '--'}</strong>
              </div>
              <div className="summary-list__item">
                <span>Codigo SAT</span>
                <strong>{typeof requestResult?.status.code === 'number' ? requestResult.status.code : '--'}</strong>
              </div>
              <div className="summary-list__item">
                <span>Request id generado</span>
                <strong className="analysis-break">{requestResult?.requestId ?? '--'}</strong>
              </div>
              <div className="summary-list__item">
                <span>Solicitado a las</span>
                <strong>{requestResult ? formatDateTime(requestResult.requestedAtUtc) : '--'}</strong>
              </div>
            </div>

            {requestResult?.parameters.period ? (
              <div className="note-strip mt-3">
                Periodo enviado al SAT: {formatDateTime(requestResult.parameters.period.startAtUtc)} a{' '}
                {formatDateTime(requestResult.parameters.period.endAtUtc)} UTC.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="col-xl-6">
        <div className="surface-card card">
          <div className="card-body">
            <div className="eyebrow">Verificacion SAT</div>
            <h3 className="h4 mb-3">VerificaSolicitudDescarga</h3>

            <div className="summary-list">
              <div className="summary-list__item">
                <span>Status request</span>
                <strong>{verifyResult?.statusRequest.message ?? '--'}</strong>
              </div>
              <div className="summary-list__item">
                <span>Status request id</span>
                <strong>{verifyResult?.statusRequest.id ?? '--'}</strong>
              </div>
              <div className="summary-list__item">
                <span>Code request</span>
                <strong>{verifyResult?.codeRequest.message ?? '--'}</strong>
              </div>
              <div className="summary-list__item">
                <span>CFDI reportados</span>
                <strong>{typeof verifyResult?.numberCfdis === 'number' ? verifyResult.numberCfdis : '--'}</strong>
              </div>
              <div className="summary-list__item">
                <span>Paquetes listos</span>
                <strong>{verifyResult?.packages.length ?? 0}</strong>
              </div>
              <div className="summary-list__item">
                <span>Ultima verificacion</span>
                <strong>{verifyResult ? formatDateTime(verifyResult.checkedAtUtc) : '--'}</strong>
              </div>
            </div>

            {verifyResult ? (
              <div className="note-strip note-strip--accent mt-3">
                {verifyResult.readyToDownload
                  ? 'El SAT ya devolvio paquetes descargables.'
                  : 'La solicitud aun no tiene paquetes listos o el resultado fue vacio.'}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      </>
      ) : null}

      {showPackagesTables ? (
      <>
      <div className="col-12 facturas-sat-section" id="facturas-sat-packages">
        <div className="surface-card card table-panel">
          <div className="card-body">
            <div className="eyebrow">Paquetes</div>
            <h3 className="h4 mb-3">DescargaMasiva</h3>

            <div className="table-responsive analysis-table">
              <table className="table align-middle mb-0">
                <thead>
                  <tr>
                    <th>Package id</th>
                    <th>Inspeccion</th>
                    <th>Descarga</th>
                  </tr>
                </thead>
                <tbody>
                  {(verifyResult?.packages.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={3} className="text-secondary">
                        No hay paquetes listos todavia para esta solicitud.
                      </td>
                    </tr>
                  ) : (
                    verifyResult?.packages.map((item) => (
                      <tr key={item.packageId}>
                        <td className="analysis-break">{item.packageId}</td>
                        <td>
                          <button
                            type="button"
                            className="ghost-button ghost-button--inline"
                            onClick={() => void handleInspectPackage(item.packageId)}
                            disabled={isInspectingPackage && activePackageId === item.packageId}
                          >
                            {isInspectingPackage && activePackageId === item.packageId
                              ? 'Leyendo...'
                              : 'Inspeccionar'}
                          </button>
                        </td>
                        <td>
                          <a
                            className="ghost-button ghost-button--inline text-decoration-none"
                            href={getSatPackageDownloadUrl(item.packageId)}
                          >
                            Descargar ZIP
                          </a>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="col-12">
        <div className="surface-card card">
          <div className="card-body">
            <div className="analysis-toolbar">
              <div>
                <div className="eyebrow">Paquete inspeccionado</div>
                <h3 className="h4 mb-3">Contenido del ZIP</h3>
              </div>

              <div className="analysis-toolbar__actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() =>
                    inspectedPackage ? void handlePrepareNetsuiteModel(inspectedPackage.packageId) : undefined
                  }
                  disabled={!inspectedPackage?.packageId || isPreparingNetsuiteModel}
                >
                  {isPreparingNetsuiteModel ? 'Preparando modelo...' : 'Preparar modelo NetSuite'}
                </button>
              </div>
            </div>

            <div className="summary-list">
              <div className="summary-list__item">
                <span>Package id</span>
                <strong className="analysis-break">{inspectedPackage?.packageId ?? '--'}</strong>
              </div>
              <div className="summary-list__item">
                <span>Nombre archivo</span>
                <strong>{inspectedPackage?.package.filename ?? '--'}</strong>
              </div>
              <div className="summary-list__item">
                <span>Bytes</span>
                <strong>
                  {typeof inspectedPackage?.package.byteLength === 'number'
                    ? formatInteger(inspectedPackage.package.byteLength)
                    : '--'}
                </strong>
              </div>
              <div className="summary-list__item">
                <span>Ficheros detectados</span>
                <strong>
                  {typeof inspectedPackage?.package.inspection?.fileCount === 'number'
                    ? inspectedPackage.package.inspection.fileCount
                    : '--'}
                </strong>
              </div>
              <div className="summary-list__item">
                <span>XML detectados</span>
                <strong>
                  {typeof inspectedPackage?.package.inspection?.xmlCount === 'number'
                    ? inspectedPackage.package.inspection.xmlCount
                    : '--'}
                </strong>
              </div>
              <div className="summary-list__item">
                <span>Metadata detectada</span>
                <strong>
                  {typeof inspectedPackage?.package.inspection?.metadataCount === 'number'
                    ? inspectedPackage.package.inspection.metadataCount
                    : '--'}
                </strong>
              </div>
            </div>

            {inspectedPackage?.package.inspection?.error ? (
              <div className="alert alert-warning mt-3 mb-0">
                No pude leer el contenido interno del ZIP: {inspectedPackage.package.inspection.error}
              </div>
            ) : null}

            <div className="table-responsive analysis-table mt-3">
              <table className="table align-middle mb-0">
                <thead>
                  <tr>
                    <th>Nombre interno</th>
                    <th>UUID</th>
                    <th>Tamano</th>
                  </tr>
                </thead>
                <tbody>
                  {(inspectedPackage?.package.inspection?.samples.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={3} className="text-secondary">
                        Todavia no hay una muestra del contenido interno del paquete.
                      </td>
                    </tr>
                  ) : (
                    inspectedPackage?.package.inspection?.samples.map((sample) => (
                      <tr key={sample.name}>
                        <td className="analysis-break">{sample.name}</td>
                        <td className="analysis-break">{sample.uuid ?? '--'}</td>
                        <td>{formatInteger(sample.sizeBytes)} bytes</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="col-12">
        <div className="surface-card card">
          <div className="card-body">
            <div className="analysis-toolbar">
              <div>
                <div className="eyebrow">Historial SAT</div>
                <h3 className="h4 mb-3">Paquetes guardados en backend</h3>
              </div>

              <div className="analysis-toolbar__actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => void refreshDownloadHistory()}
                  disabled={isRefreshingHistory}
                >
                  {isRefreshingHistory ? 'Refrescando historial...' : 'Refrescar historial'}
                </button>
              </div>
            </div>

            <div className="summary-list">
              <div className="summary-list__item">
                <span>Paquetes registrados</span>
                <strong>
                  {typeof downloadHistory?.totalPackages === 'number'
                    ? formatInteger(downloadHistory.totalPackages)
                    : '--'}
                </strong>
              </div>
              <div className="summary-list__item">
                <span>CFDI historicos</span>
                <strong>
                  {typeof downloadHistory?.totalCfdis === 'number'
                    ? formatInteger(downloadHistory.totalCfdis)
                    : '--'}
                </strong>
              </div>
              <div className="summary-list__item">
                <span>Store local</span>
                <strong className="analysis-break">{downloadHistory?.storePath ?? '--'}</strong>
              </div>
            </div>

            {!downloadHistory ? (
              <div className="note-strip mt-3">
                El backend registrara aqui cada paquete SAT descargado para no perder el historial.
              </div>
            ) : null}

            <div className="table-responsive analysis-table mt-3">
              <table className="table align-middle mb-0">
                <thead>
                  <tr>
                    <th>Paquete</th>
                    <th>Descargado</th>
                    <th>XML</th>
                    <th>Muestra CFDI</th>
                  </tr>
                </thead>
                <tbody>
                  {downloadHistoryRecords.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-secondary">
                        No hay paquetes SAT historicos registrados todavia.
                      </td>
                    </tr>
                  ) : (
                    downloadHistoryRecords.map((record) => (
                      <tr key={record.packageId}>
                        <td className="analysis-break">{record.packageId}</td>
                        <td>{formatDateTime(record.lastDownloadedAtUtc)}</td>
                        <td>{formatInteger(record.xmlCount)}</td>
                        <td>
                          {record.cfdis.slice(0, 3).map((cfdi) => (
                            <div key={`${record.packageId}-${cfdi.fileName}`}>
                              {(cfdi.uuid ?? '--') + ' | ' + (cfdi.emisorNombre ?? '--') + ' | '}
                              {cfdi.total === null ? '--' : `${formatAmount(cfdi.total)} ${cfdi.moneda ?? ''}`.trim()}
                            </div>
                          ))}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      </>
      ) : null}

      {showAnalysisWorkspacePanel ? (
      <div className="col-12 facturas-sat-section" id="facturas-sat-analysis">
        <div className="surface-card card">
          <div className="card-body">
            <div className="analysis-toolbar">
              <div>
                <div className="eyebrow">Subset SAT</div>
                <h3 className="h4 mb-3">Operacion de analisis</h3>
              </div>

              <div className="analysis-toolbar__actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => void refreshAnalysisWindows()}
                  disabled={isRefreshingAnalysisWindows}
                >
                  {isRefreshingAnalysisWindows ? 'Refrescando ventanas...' : 'Refrescar ventanas'}
                </button>
              </div>
            </div>

            <div className="bank-form-grid">
              <label className="bank-field">
                <span>Inicio subset</span>
                <input
                  type="date"
                  className="bank-input"
                  value={analysisFormState.startDate}
                  onChange={(event) => updateAnalysisFormState('startDate', event.target.value)}
                />
              </label>

              <label className="bank-field">
                <span>Fin subset</span>
                <input
                  type="date"
                  className="bank-input"
                  value={analysisFormState.endDate}
                  onChange={(event) => updateAnalysisFormState('endDate', event.target.value)}
                />
              </label>

              <div className="bank-field bank-field--wide">
                <span>Acciones</span>
                <div className="control-inline">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void handleRunAnalysisWorkflow()}
                    disabled={
                      !status?.canTestAuth ||
                      isRunningAnalysisWorkflow ||
                      isBootstrappingAnalysisWindow ||
                      isReconcilingAnalysisWindow ||
                      isPreparingAnalysisUploadState ||
                      isUploadingReadyInvoices
                    }
                  >
                    {isRunningAnalysisWorkflow ? 'Ejecutando flujo...' : 'Ejecutar flujo completo'}
                  </button>

                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void handleBootstrapAnalysisWindow()}
                    disabled={!status?.canTestAuth || isBootstrappingAnalysisWindow || isRunningAnalysisWorkflow}
                  >
                    {isBootstrappingAnalysisWindow ? 'Cargando subset...' : 'Cargar subset SAT'}
                  </button>

                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() =>
                      selectedAnalysisWindow
                        ? void handleReconcileAnalysisWindow(selectedAnalysisWindow.id)
                        : undefined
                    }
                    disabled={!selectedAnalysisWindow || isReconcilingAnalysisWindow || isRunningAnalysisWorkflow}
                  >
                    {isReconcilingAnalysisWindow ? 'Reconciliando...' : 'Reconciliar con NetSuite'}
                  </button>

                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() =>
                      selectedAnalysisWindow
                        ? void prepareAnalysisWindowUploadState(selectedAnalysisWindow, true)
                        : undefined
                    }
                    disabled={!selectedAnalysisWindow || isPreparingAnalysisUploadState || isRunningAnalysisWorkflow}
                  >
                    {isPreparingAnalysisUploadState
                      ? 'Preparando carga...'
                      : 'Preparar carga NetSuite'}
                  </button>
                </div>
              </div>
            </div>

            <div className="summary-list mt-4">
              <div className="summary-list__item">
                <span>Ventana activa</span>
                <strong>{selectedAnalysisWindow?.label ?? '--'}</strong>
              </div>
              <div className="summary-list__item">
                <span>Estado</span>
                <strong>{formatAnalysisWindowStatus(selectedAnalysisWindow?.status ?? null)}</strong>
              </div>
              <div className="summary-list__item">
                <span>Paquetes SAT</span>
                <strong>
                  {selectedAnalysisWindow ? formatInteger(selectedAnalysisWindow.packageIds.length) : '--'}
                </strong>
              </div>
              <div className="summary-list__item">
                <span>Facturas a analizar</span>
                <strong>
                  {selectedAnalysisWindow ? formatInteger(selectedAnalysisWindow.analysisItems.length) : '--'}
                </strong>
              </div>
              <div className="summary-list__item">
                <span>Historico procesado</span>
                <strong>
                  {selectedAnalysisWindow ? formatInteger(selectedAnalysisWindow.processedItems.length) : '--'}
                </strong>
              </div>
              <div className="summary-list__item">
                <span>Request id SAT</span>
                <strong className="analysis-break">{selectedAnalysisWindow?.requestId ?? '--'}</strong>
              </div>
            </div>

            {selectedAnalysisWindow ? (
              <div className="note-strip note-strip--accent mt-3">
                Rango: {formatDate(selectedAnalysisWindow.subset.startAtUtc)} a{' '}
                {formatDate(selectedAnalysisWindow.subset.endAtUtc)}. El filtro cargado es
                `received + xml + ingreso + active`.
              </div>
            ) : (
              <div className="note-strip mt-3">
                Aqui se mostraran las facturas SAT pendientes de revisar y las que ya pasaron a
                historico procesado por existir en NetSuite.
              </div>
            )}

            {selectedAnalysisWindow ? (
              <div className="note-strip mt-3">
                {selectedAnalysisPreviewLoaded
                  ? `Estado de carga NetSuite preparado con base local a las ${formatDateTime(
                      selectedAnalysisPreviewLoadedAt ?? selectedAnalysisWindow.updatedAtUtc,
                    )}.`
                  : 'Prepara la carga NetSuite para habilitar los botones de subida sobre esta ventana.'}
              </div>
            ) : null}

            {selectedAnalysisWindow ? (
              <div className="summary-list mt-3">
                <div className="summary-list__item">
                  <span>Listas</span>
                  <strong>{formatInteger(reviewQueueSummary.ready)}</strong>
                </div>
                <div className="summary-list__item">
                  <span>Duplicadas</span>
                  <strong>{formatInteger(reviewQueueSummary.duplicate)}</strong>
                </div>
                <div className="summary-list__item">
                  <span>Sin proveedor</span>
                  <strong>{formatInteger(reviewQueueSummary.missingProvider)}</strong>
                </div>
                <div className="summary-list__item">
                  <span>Sin cuenta gasto</span>
                  <strong>{formatInteger(reviewQueueSummary.missingAccount)}</strong>
                </div>
                <div className="summary-list__item">
                  <span>Retencion sin regla</span>
                  <strong>{formatInteger(reviewQueueSummary.missingRetentionRule)}</strong>
                </div>
                <div className="summary-list__item">
                  <span>Otros bloqueos</span>
                  <strong>{formatInteger(reviewQueueSummary.other)}</strong>
                </div>
              </div>
            ) : null}

            {lastUploadResult ? (
              <div
                className={`alert ${lastUploadResult.created ? 'alert-success' : 'alert-warning'} mt-3 mb-0`}
              >
                {lastUploadResult.message}{' '}
                {lastUploadResult.createdRecord
                  ? `NetSuite: ${lastUploadResult.createdRecord.transactionNumber ?? lastUploadResult.createdRecord.internalId}.`
                  : null}
              </div>
            ) : null}

            {analysisWorkflowNotice ? (
              <div className="note-strip note-strip--accent mt-3">{analysisWorkflowNotice}</div>
            ) : null}

            {!showAnalysisWindowsTable ? (
              <div className="note-strip mt-3">
                La tabla de ventanas vive ahora en el header superior para que esta vista mantenga el foco en las
                facturas pendientes por cargar.
              </div>
            ) : (
            <div className="table-responsive analysis-table mt-3">
              <table className="table align-middle mb-0">
                <thead>
                  <tr>
                    <th>Ventana</th>
                    <th>Estado</th>
                    <th>Pendientes</th>
                    <th>Procesadas</th>
                    <th>Accion</th>
                  </tr>
                </thead>
                <tbody>
                  {(analysisWindows?.windows.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-secondary">
                        No hay ventanas SAT registradas todavia.
                      </td>
                    </tr>
                  ) : (
                    analysisWindows?.windows.map((window) => (
                      <tr key={window.id}>
                        <td>
                          <div>{window.label}</div>
                          <div className="text-secondary analysis-break">{window.id}</div>
                        </td>
                        <td>{formatAnalysisWindowStatus(window.status)}</td>
                        <td>{formatInteger(window.analysisItems.length)}</td>
                        <td>{formatInteger(window.processedItems.length)}</td>
                        <td>
                          <div className="control-inline">
                            <button
                              type="button"
                              className="ghost-button ghost-button--inline"
                              onClick={() => setSelectedAnalysisWindowId(window.id)}
                            >
                              Ver
                            </button>
                            <button
                              type="button"
                              className="ghost-button ghost-button--inline"
                              onClick={() => void handleReconcileAnalysisWindow(window.id)}
                              disabled={isReconcilingAnalysisWindow}
                            >
                              Reconciliar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            )}
          </div>
        </div>
      </div>
      ) : null}

      {showPendingTable ? (
      <div className="col-12">
        <div className="surface-card card table-panel">
          <div className="card-body">
            <div className="eyebrow">A analizar</div>
            <h3 className="h4 mb-3">{pendingTableTitle}</h3>

            {showPendingLanding ? (
              <div className="note-strip note-strip--accent mb-3">
                {selectedAnalysisWindow
                  ? `Mostrando ${formatInteger(filteredReviewQueueEntries.length)} facturas listas para subir desde ${selectedAnalysisWindow.label}.`
                  : 'No hay una ventana SAT activa para mostrar facturas listas por subir.'}
                <div className="control-inline mt-3">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() =>
                      selectedAnalysisWindow
                        ? void handleUploadReadyAnalysisInvoices(selectedAnalysisWindow.id)
                        : undefined
                    }
                    disabled={
                      !selectedAnalysisWindow ||
                      !selectedAnalysisPreviewLoaded ||
                      readyReviewQueueEntries.length === 0 ||
                      isUploadingReadyInvoices ||
                      isRunningAnalysisWorkflow
                    }
                  >
                    {isUploadingReadyInvoices
                      ? 'Subiendo listas...'
                      : `Subir todas las listas (${formatInteger(readyReviewQueueEntries.length)})`}
                  </button>
                </div>
              </div>
            ) : reviewQueueSummary.ready > 0 ? (
              <div className="note-strip note-strip--accent mb-3">
                Hay {formatInteger(reviewQueueSummary.ready)} facturas listas para subir. Para mantener limpia la tabla
                principal, por defecto dejamos aqui solo lo que necesita revision.
                <div className="control-inline mt-3">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() =>
                      selectedAnalysisWindow
                        ? void handleUploadReadyAnalysisInvoices(selectedAnalysisWindow.id)
                        : undefined
                    }
                    disabled={
                      !selectedAnalysisWindow ||
                      !selectedAnalysisPreviewLoaded ||
                      readyReviewQueueEntries.length === 0 ||
                      isUploadingReadyInvoices ||
                      isRunningAnalysisWorkflow
                    }
                  >
                    {isUploadingReadyInvoices
                      ? 'Subiendo listas...'
                      : `Subir todas las listas (${formatInteger(readyReviewQueueEntries.length)})`}
                  </button>

                  <button
                    type="button"
                    className="ghost-button ghost-button--inline"
                    onClick={() =>
                      setAnalysisQueueFilter((current) => (current === 'ready' ? 'actionable' : 'ready'))
                    }
                  >
                    {analysisQueueFilter === 'ready' ? 'Volver a bloqueadas' : 'Ver listas'}
                  </button>
                </div>
              </div>
            ) : null}

            {!showPendingLanding ? (
            <div className="facturas-sat-analysis-filters">
              <label className="bank-field">
                <span>Buscar pendiente</span>
                <input
                  type="search"
                  className="bank-input"
                  value={analysisSearch}
                  onChange={(event) => setAnalysisSearch(event.target.value)}
                  placeholder="UUID, emisor, proveedor, paquete..."
                />
              </label>

              <label className="bank-field">
                <span>Filtro operativo</span>
                <select
                  className="bank-select"
                  value={analysisQueueFilter}
                  onChange={(event) => setAnalysisQueueFilter(event.target.value as SatAnalysisQueueFilter)}
                >
                  <option value="actionable">Bloqueadas por revision</option>
                  <option value="ready">Listas para subir</option>
                  <option value="all">Todas</option>
                  <option value="duplicate">Duplicadas</option>
                  <option value="missing_provider">Sin proveedor</option>
                  <option value="missing_account">Sin cuenta gasto</option>
                  <option value="missing_retention_rule">Retencion sin regla</option>
                  <option value="other">Otros bloqueos</option>
                </select>
              </label>

              <div className="note-strip facturas-sat-analysis-filters__summary">
                Mostrando {formatInteger(filteredReviewQueueEntries.length)} de{' '}
                {formatInteger(reviewQueueEntries.length)} pendientes. {formatInteger(reviewQueueSummary.ready)} listas,{' '}
                {formatInteger(reviewQueueBlockedCount)} con bloqueo.
              </div>
            </div>
            ) : null}

            {!showPendingLanding ? (
            <div className="control-inline mt-3">
              <NavLink to={buildFacturasSatUnifiedPath('homologacion')} className="ghost-button ghost-button--inline">
                Abrir no listas
              </NavLink>
              <NavLink to={buildFacturasSatUnifiedPath('preview')} className="ghost-button ghost-button--inline">
                Abrir preview
              </NavLink>
            </div>
            ) : null}

            {!showPendingLanding && selectedAnalysisPreviewLoaded && selectedAnalysisReviewEntry?.item.uuid ? (
              <div className="note-strip note-strip--accent mt-3">
                Factura activa: {selectedAnalysisReviewEntry.item.uuid}. {selectedAnalysisReviewEntry.statusLabel}:{' '}
                {selectedAnalysisReviewEntry.statusDetail}
                <div className="control-inline mt-3">
                  <NavLink
                    to={buildFacturasSatReviewPath('preview', selectedAnalysisReviewEntry.item.uuid)}
                    className="ghost-button ghost-button--inline"
                  >
                    Abrir preview de esta factura
                  </NavLink>

                  {(selectedAnalysisReviewEntry.status === 'missing_provider' ||
                    selectedAnalysisReviewEntry.status === 'missing_account' ||
                    selectedAnalysisReviewEntry.status === 'missing_retention_rule' ||
                    selectedAnalysisReviewEntry.status === 'other') ? (
                    <NavLink
                      to={buildFacturasSatReviewPath('homologacion', selectedAnalysisReviewEntry.item.uuid)}
                      className="ghost-button ghost-button--inline"
                    >
                      Resolver en no listas
                    </NavLink>
                  ) : null}

                  {canUploadSelectedAnalysisReview && selectedAnalysisWindow ? (
                    <button
                      type="button"
                      className="ghost-button ghost-button--inline"
                      onClick={() =>
                        selectedAnalysisReviewEntry.item.uuid
                          ? void handleUploadAnalysisInvoice(
                              selectedAnalysisWindow.id,
                              selectedAnalysisReviewEntry.item.uuid,
                            )
                          : undefined
                      }
                      disabled={
                        isUploadingSelectedAnalysisReview || isUploadingReadyInvoices || isRunningAnalysisWorkflow
                      }
                    >
                      {isUploadingSelectedAnalysisReview ? 'Subiendo activa...' : 'Subir factura activa'}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="table-responsive analysis-table">
              <table className="table align-middle mb-0">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>UUID</th>
                    <th>Emisor</th>
                    <th>Proveedor NetSuite</th>
                    <th>Total</th>
                    <th>Retenciones</th>
                    <th>Cola</th>
                    <th>Duplicado</th>
                    <th>Accion</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReviewQueueEntries.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-secondary">
                        {!selectedAnalysisWindow
                          ? 'Selecciona o crea una ventana SAT para ver las facturas pendientes.'
                          : analysisSearch
                            ? 'Ninguna factura coincide con el filtro operativo actual.'
                            : effectiveAnalysisQueueFilter === 'actionable'
                              ? 'No hay bloqueos manuales en esta ventana. Las facturas listas se quedaron resumidas arriba para mantener limpia la cola.'
                              : effectiveAnalysisQueueFilter === 'ready'
                                ? 'No hay facturas listas para subir en esta ventana.'
                                : effectiveAnalysisQueueFilter !== 'all'
                                ? 'Ninguna factura coincide con el filtro operativo actual.'
                                : 'No hay facturas pendientes en esta ventana.'}
                      </td>
                    </tr>
                  ) : (
                    filteredReviewQueueEntries.map((entry) => {
                      const item = entry.item
                      const previewInvoice = entry.previewInvoice
                      const normalizedUuid = normalizeUuidKey(item.uuid)
                      const uploadKey = selectedAnalysisWindow ? `${selectedAnalysisWindow.id}:${normalizedUuid}` : null
                      const isUploading = uploadingAnalysisInvoiceKey === uploadKey
                      const canUpload = Boolean(
                        selectedAnalysisWindow &&
                          normalizedUuid &&
                          previewInvoice?.readyToImport &&
                          previewInvoice.duplicateStatus === 'clear',
                      )

                      return (
                        <tr
                          key={`${item.packageId}:${item.fileName}`}
                          className={
                            normalizedUuid && normalizedUuid === normalizeUuidKey(selectedReviewUuid)
                              ? 'table-active'
                              : undefined
                          }
                        >
                          <td>{item.fecha ? formatDate(item.fecha) : '--'}</td>
                          <td className="analysis-break">{item.uuid ?? '--'}</td>
                          <td>{item.emisorNombre ?? '--'}</td>
                          <td>{previewInvoice?.proveedorNetsuite ?? '--'}</td>
                          <td>
                            {item.total === null ? '--' : `${formatAmount(item.total)} ${item.moneda ?? ''}`.trim()}
                          </td>
                          <td>
                            {selectedAnalysisPreviewLoaded && previewInvoice
                              ? formatInteger(previewInvoice.retentionLineCount)
                              : '--'}
                          </td>
                          <td>
                            {!selectedAnalysisPreviewLoaded ? (
                              <span className="text-secondary">Prepara carga</span>
                            ) : !normalizedUuid ? (
                              <span className="text-secondary">Sin UUID</span>
                            ) : !previewInvoice ? (
                              <span className="text-secondary">Sin preview</span>
                            ) : (
                              <div>
                                <div>{entry.statusLabel}</div>
                                <div className="text-secondary">{entry.statusDetail}</div>
                              </div>
                            )}
                          </td>
                          <td>
                            {selectedAnalysisPreviewLoaded && previewInvoice
                              ? formatDuplicateStatus(previewInvoice.duplicateStatus)
                              : '--'}
                          </td>
                          <td>
                            <div className="control-inline">
                              <button
                                type="button"
                                className="ghost-button ghost-button--inline"
                                onClick={() => setSelectedReviewUuid(item.uuid)}
                                disabled={!item.uuid || isUploadingReadyInvoices || isRunningAnalysisWorkflow}
                              >
                                Revisar
                              </button>

                              {item.uuid ? (
                                <NavLink
                                  to={buildFacturasSatReviewPath('preview', item.uuid)}
                                  className="ghost-button ghost-button--inline"
                                >
                                  Preview
                                </NavLink>
                              ) : null}

                              {(entry.status === 'missing_provider' ||
                                entry.status === 'missing_account' ||
                                entry.status === 'missing_retention_rule' ||
                                entry.status === 'other') &&
                              item.uuid ? (
                                <NavLink
                                  to={buildFacturasSatReviewPath('homologacion', item.uuid)}
                                  className="ghost-button ghost-button--inline"
                                >
                                  Homologar
                                </NavLink>
                              ) : null}

                              {canUpload && selectedAnalysisWindow ? (
                                <button
                                  type="button"
                                  className="ghost-button ghost-button--inline"
                                  onClick={() =>
                                    item.uuid
                                      ? void handleUploadAnalysisInvoice(selectedAnalysisWindow.id, item.uuid)
                                      : undefined
                                  }
                                  disabled={isUploading || isUploadingReadyInvoices || isRunningAnalysisWorkflow}
                                >
                                  {isUploading ? 'Subiendo...' : 'Subir'}
                                </button>
                              ) : (
                                <span className="text-secondary">
                                  {!selectedAnalysisPreviewLoaded
                                    ? 'Preparando'
                                    : previewInvoice?.duplicateStatus && previewInvoice.duplicateStatus !== 'clear'
                                      ? 'Ya existe'
                                      : previewInvoice && !previewInvoice.readyToImport
                                        ? 'Bloqueada'
                                        : 'Sin accion'}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      ) : null}

      {showProcessedTable ? (
      <div className="col-12">
        <div className="surface-card card table-panel">
          <div className="card-body">
            <div className="eyebrow">Procesadas</div>
            <h3 className="h4 mb-3">Historico procesado</h3>

            <div className="facturas-sat-analysis-filters facturas-sat-analysis-filters--compact">
              <label className="bank-field">
                <span>Buscar en historico</span>
                <input
                  type="search"
                  className="bank-input"
                  value={processedSearch}
                  onChange={(event) => setProcessedSearch(event.target.value)}
                  placeholder="UUID, emisor o folio NetSuite..."
                />
              </label>

              <div className="note-strip facturas-sat-analysis-filters__summary">
                Mostrando {formatInteger(filteredProcessedAnalysisItems.length)} de{' '}
                {formatInteger(processedAnalysisItems.length)} procesadas.
              </div>
            </div>

            <div className="table-responsive analysis-table">
              <table className="table align-middle mb-0">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>UUID</th>
                    <th>Emisor</th>
                    <th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProcessedAnalysisItems.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-secondary">
                        {!selectedAnalysisWindow
                          ? 'Selecciona o crea una ventana SAT para ver el historico procesado.'
                          : processedSearch
                            ? 'Ninguna factura procesada coincide con la busqueda actual.'
                            : 'Todavia no hay facturas procesadas en esta ventana.'}
                      </td>
                    </tr>
                  ) : (
                    filteredProcessedAnalysisItems.map((item) => (
                      <tr key={`${item.packageId}:${item.fileName}:${item.processedReason}`}>
                        <td>{item.fecha ? formatDate(item.fecha) : '--'}</td>
                        <td className="analysis-break">{item.uuid ?? '--'}</td>
                        <td>{item.emisorNombre ?? '--'}</td>
                        <td>
                          <div>{formatProcessedReason(item.processedReason)}</div>
                          <div className="text-secondary">
                            {item.netsuiteMatches[0]?.transactionNumber ??
                              item.netsuiteMatches[0]?.tranId ??
                              item.netsuiteMatches[0]?.internalId ??
                              '--'}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      ) : null}

      {showHomologationPanel ? (
      <>
      <div className="col-12 facturas-sat-section" id="facturas-sat-homologation">
        <div className="surface-card card">
          <div className="card-body">
            <div className="analysis-toolbar">
              <div>
                <div className="eyebrow">Revision previa</div>
                <h3 className="h4 mb-3">Correccion manual de facturas no listas</h3>
              </div>

              <div className="analysis-toolbar__actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => void ensureHomologationSupportLoaded()}
                  disabled={isLoadingHomologationSupport}
                >
                  {isLoadingHomologationSupport ? 'Cargando catalogos...' : 'Cargar soporte local'}
                </button>

                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => void refreshManualHomologationStore()}
                  disabled={isLoadingHomologationSupport}
                >
                  Refrescar no listas
                </button>
              </div>
            </div>

            <div className="summary-list">
              <div className="summary-list__item">
                <span>Factura seleccionada</span>
                <strong className="analysis-break">{selectedReviewEntry?.item.uuid ?? '--'}</strong>
              </div>
              <div className="summary-list__item">
                <span>Proveedor emisor</span>
                <strong>{selectedReviewEntry?.item.emisorNombre ?? '--'}</strong>
              </div>
              <div className="summary-list__item">
                <span>Estado cola</span>
                <strong>{selectedReviewEntry?.statusLabel ?? '--'}</strong>
              </div>
              <div className="summary-list__item">
                <span>Store manual</span>
                <strong className="analysis-break">{manualHomologationStore?.storePath ?? '--'}</strong>
              </div>
              <div className="summary-list__item">
                <span>Overrides proveedor</span>
                <strong>
                  {manualHomologationStore
                    ? formatInteger(manualHomologationStore.counts.providerOverrides)
                    : '--'}
                </strong>
              </div>
              <div className="summary-list__item">
                <span>Overrides cuenta</span>
                <strong>
                  {manualHomologationStore
                    ? formatInteger(manualHomologationStore.counts.accountOverrides)
                    : '--'}
                </strong>
              </div>
            </div>

            {selectedAnalysisWindow && selectedAnalysisPreviewLoaded ? (
              <>
                <div className="facturas-sat-landing-kpi-grid mt-4">
                  <div className="facturas-sat-landing-kpi">
                    <span>Pendientes manuales</span>
                    <strong>{formatInteger(homologationPendingCount)}</strong>
                    <small>Facturas con proveedor, cuenta o retencion por resolver.</small>
                  </div>

                  <div className="facturas-sat-landing-kpi">
                    <span>Sin proveedor</span>
                    <strong>{formatInteger(reviewQueueSummary.missingProvider)}</strong>
                    <small>Emisores sin mapeo completo hacia proveedor NetSuite.</small>
                  </div>

                  <div className="facturas-sat-landing-kpi">
                    <span>Sin cuenta gasto</span>
                    <strong>{formatInteger(reviewQueueSummary.missingAccount)}</strong>
                    <small>ClavesProdServ que todavia no tienen cuenta de gasto.</small>
                  </div>

                  <div className="facturas-sat-landing-kpi">
                    <span>Retenciones</span>
                    <strong>{formatInteger(reviewQueueSummary.missingRetentionRule)}</strong>
                    <small>Retenciones sin regla contable para la subida.</small>
                  </div>

                  <div className="facturas-sat-landing-kpi">
                    <span>Overrides guardados</span>
                    <strong>{formatInteger(totalHomologationOverrides)}</strong>
                    <small>Catalogo manual vivo para proveedor y cuenta.</small>
                  </div>
                </div>

                <div className="surface-card card mt-4">
                  <div className="card-body">
                    <div className="analysis-toolbar">
                      <div>
                        <div className="eyebrow">Cola de no listas</div>
                        <h4 className="h5 mb-2">Selecciona la factura a resolver</h4>
                        <p className="text-secondary mb-0">
                          Esta cola vive dentro de la subruta y te deja cambiar de factura sin regresar a
                          `Analisis`.
                        </p>
                      </div>

                      <div className="control-inline">
                        <NavLink to={buildFacturasSatUnifiedPath('analisis')} className="ghost-button ghost-button--inline">
                          Abrir analisis
                        </NavLink>
                        <NavLink to={buildFacturasSatUnifiedPath('preview')} className="ghost-button ghost-button--inline">
                          Abrir preview
                        </NavLink>
                      </div>
                    </div>

                    <div className="facturas-sat-analysis-filters mt-3">
                      <label className="bank-field">
                        <span>Buscar incidencia</span>
                        <input
                          type="search"
                          className="bank-input"
                          value={homologationSearch}
                          onChange={(event) => setHomologationSearch(event.target.value)}
                          placeholder="UUID, emisor, proveedor o detalle del bloqueo..."
                        />
                      </label>

                      <label className="bank-field">
                        <span>Filtro de cola</span>
                        <select
                          className="bank-select"
                          value={homologationQueueFilter}
                          onChange={(event) =>
                            setHomologationQueueFilter(event.target.value as SatAnalysisQueueFilter)
                          }
                        >
                          <option value="actionable">Bloqueadas por revision</option>
                          <option value="all">Todas</option>
                          <option value="missing_provider">Sin proveedor</option>
                          <option value="missing_account">Sin cuenta gasto</option>
                          <option value="missing_retention_rule">Retencion sin regla</option>
                          <option value="duplicate">Duplicadas</option>
                          <option value="other">Otros bloqueos</option>
                          <option value="ready">Listas</option>
                        </select>
                      </label>

                      <div className="note-strip facturas-sat-analysis-filters__summary">
                        Mostrando {formatInteger(filteredHomologationEntries.length)} de{' '}
                        {formatInteger(reviewQueueEntries.length)} pendientes. La ventana activa es{' '}
                        {selectedAnalysisWindow.label}.
                      </div>
                    </div>

                    <div className="table-responsive analysis-table mt-3">
                      <table className="table align-middle mb-0">
                        <thead>
                          <tr>
                            <th>Fecha</th>
                            <th>UUID</th>
                            <th>Emisor</th>
                            <th>Estado cola</th>
                            <th>Proveedor actual</th>
                            <th>Cuenta actual</th>
                            <th>Accion</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredHomologationEntries.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="text-secondary">
                                {homologationSearch || homologationQueueFilter !== 'actionable'
                                  ? 'Ninguna factura coincide con el filtro actual de no listas.'
                                  : 'La ventana activa no tiene bloqueos manuales visibles.'}
                              </td>
                            </tr>
                          ) : (
                            filteredHomologationEntries.map((entry) => {
                              const normalizedUuid = normalizeUuidKey(entry.item.uuid)

                              return (
                                <tr
                                  key={`${entry.item.packageId}:${entry.item.fileName}:homologation`}
                                  className={
                                    normalizedUuid && normalizedUuid === normalizeUuidKey(selectedReviewUuid)
                                      ? 'table-active'
                                      : undefined
                                  }
                                >
                                  <td>{entry.item.fecha ? formatDate(entry.item.fecha) : '--'}</td>
                                  <td className="analysis-break">{entry.item.uuid ?? '--'}</td>
                                  <td>{entry.item.emisorNombre ?? '--'}</td>
                                  <td>
                                    <div>{entry.statusLabel}</div>
                                    <div className="text-secondary">{entry.statusDetail}</div>
                                  </td>
                                  <td>{entry.previewInvoice?.proveedorNetsuite ?? '--'}</td>
                                  <td>{entry.previewInvoice?.cc ?? '--'}</td>
                                  <td>
                                    <button
                                      type="button"
                                      className="ghost-button ghost-button--inline"
                                      onClick={() => setSelectedReviewUuid(entry.item.uuid)}
                                      disabled={!entry.item.uuid}
                                    >
                                      {normalizedUuid && normalizedUuid === normalizeUuidKey(selectedReviewUuid)
                                        ? 'Activa'
                                        : 'Trabajar'}
                                    </button>
                                  </td>
                                </tr>
                              )
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </>
            ) : null}

            {!selectedAnalysisWindow ? (
              <div className="note-strip mt-3">
                Selecciona primero una ventana SAT para revisar incidencias y guardar correcciones.
              </div>
            ) : !selectedAnalysisPreviewLoaded ? (
              <div className="note-strip mt-3">
                La cola se esta preparando con base local para poder detectar proveedor, cuentas y duplicados.
              </div>
            ) : !selectedReviewEntry ? (
              <div className="note-strip mt-3">
                No hay facturas pendientes en esta ventana para revisar.
              </div>
            ) : (
              <div className="row g-4 mt-1">
                <div className="col-12">
                  <div className="row g-4">
                    <div className="col-xl-6">
                      <div className="surface-card card h-100">
                        <div className="card-body">
                          <div className="eyebrow">Factura activa</div>
                          <h4 className="h5 mb-3">Contexto SAT y NetSuite</h4>

                          <div className="summary-list">
                            <div className="summary-list__item">
                              <span>UUID</span>
                              <strong className="analysis-break">{selectedReviewEntry.item.uuid ?? '--'}</strong>
                            </div>
                            <div className="summary-list__item">
                              <span>Serie / folio</span>
                              <strong>
                                {selectedReviewEntry.previewInvoice?.serieFolio ??
                                  ([selectedReviewEntry.item.serie, selectedReviewEntry.item.folio]
                                    .filter(Boolean)
                                    .join(' / ') || '--')}
                              </strong>
                            </div>
                            <div className="summary-list__item">
                              <span>Total XML</span>
                              <strong>
                                {selectedReviewEntry.item.total === null
                                  ? '--'
                                  : `${formatAmount(selectedReviewEntry.item.total)} ${selectedReviewEntry.item.moneda ?? ''}`.trim()}
                              </strong>
                            </div>
                            <div className="summary-list__item">
                              <span>Paquete SAT</span>
                              <strong className="analysis-break">{selectedReviewEntry.item.packageId}</strong>
                            </div>
                            <div className="summary-list__item">
                              <span>Match proveedor</span>
                              <strong>
                                {formatProviderMatchSource(
                                  selectedReviewEntry.previewInvoice?.providerMatchSource ?? null,
                                )}
                              </strong>
                            </div>
                            <div className="summary-list__item">
                              <span>Lineas sin cuenta</span>
                              <strong>{formatInteger(selectedReviewMissingExpenseRows.length)}</strong>
                            </div>
                            <div className="summary-list__item">
                              <span>Lineas retencion</span>
                              <strong>{formatInteger(selectedReviewRetentionRows.length)}</strong>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="col-xl-6">
                      <div className="surface-card card h-100">
                        <div className="card-body">
                          <div className="eyebrow">Incidencias</div>
                          <h4 className="h5 mb-3">Bloqueos detectados</h4>

                          {selectedReviewIssueList.length === 0 ? (
                            <div className="note-strip">
                              Esta factura no reporta incidencias textuales adicionales en el preview local.
                            </div>
                          ) : (
                            <div className="check-list">
                              {selectedReviewIssueList.map((issue, index) => (
                                <div
                                  key={`${selectedReviewEntry.item.packageId}:${selectedReviewEntry.item.fileName}:${index}`}
                                  className="check-list__item"
                                >
                                  <strong>{issue}</strong>
                                </div>
                              ))}
                            </div>
                          )}

                          {selectedReviewDuplicateMatches.length > 0 ? (
                            <div className="note-strip mt-3">
                              Coincidencias NetSuite:{' '}
                              {selectedReviewDuplicateMatches
                                .slice(0, 3)
                                .map(
                                  (match) =>
                                    match.transactionNumber ??
                                    match.tranId ??
                                    match.internalId ??
                                    match.mxCfdiUuid ??
                                    '--',
                                )
                                .join(', ')}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="col-xl-6">
                  <div className="surface-card card h-100">
                    <div className="card-body">
                      <div className="eyebrow">Proveedor</div>
                      <h4 className="h5 mb-3">Homologacion manual de proveedor</h4>

                      <div className="summary-list">
                        <div className="summary-list__item">
                          <span>NombreEmisor</span>
                          <strong>{selectedReviewEntry.previewInvoice?.nombreEmisor ?? selectedReviewEntry.item.emisorNombre ?? '--'}</strong>
                        </div>
                        <div className="summary-list__item">
                          <span>RFC</span>
                          <strong>{selectedReviewEntry.previewInvoice?.rfcEmisor ?? selectedReviewEntry.item.emisorRfc ?? '--'}</strong>
                        </div>
                        <div className="summary-list__item">
                          <span>Proveedor NetSuite actual</span>
                          <strong>{selectedReviewEntry.previewInvoice?.proveedorNetsuite ?? '--'}</strong>
                        </div>
                        <div className="summary-list__item">
                          <span>Cuenta proveedor actual</span>
                          <strong>{selectedReviewEntry.previewInvoice?.cc ?? '--'}</strong>
                        </div>
                      </div>

                      <label className="bank-field mt-3">
                        <span>Buscar proveedor NetSuite</span>
                        <input
                          type="search"
                          className="bank-input"
                          value={supplierSearch}
                          onChange={(event) => setSupplierSearch(event.target.value)}
                          placeholder="Busca por nombre, RFC o codigo..."
                        />
                      </label>

                      <div className="table-responsive analysis-table mt-3">
                        <table className="table align-middle mb-0">
                          <thead>
                            <tr>
                              <th>Proveedor</th>
                              <th>RFC</th>
                              <th>Cuenta</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {supplierOptions.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="text-secondary">
                                  No hay proveedores locales que coincidan con el filtro.
                                </td>
                              </tr>
                            ) : (
                              supplierOptions.map((supplier) => (
                                <tr key={supplier.internalId}>
                                  <td>
                                    <div>{supplier.displayName}</div>
                                    <div className="text-secondary">{supplier.entityId || supplier.internalId}</div>
                                  </td>
                                  <td>{supplier.rfc || '--'}</td>
                                  <td>{supplier.accountDisplayName ?? '--'}</td>
                                  <td>
                                    <button
                                      type="button"
                                      className="ghost-button ghost-button--inline"
                                      onClick={() => {
                                        setSelectedSupplierId(supplier.internalId)
                                        setProviderCcSearch(supplier.accountDisplayName ?? '')
                                        const defaultCc = resolveDefaultSupplierCc(supplier, accountCatalog)
                                        setSelectedProviderCcId(defaultCc?.internalId ?? null)
                                      }}
                                    >
                                      {selectedSupplierId === supplier.internalId ? 'Seleccionado' : 'Elegir'}
                                    </button>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>

                      <label className="bank-field mt-3">
                        <span>Cuenta proveedor</span>
                        <input
                          type="search"
                          className="bank-input"
                          value={providerCcSearch}
                          onChange={(event) => setProviderCcSearch(event.target.value)}
                          placeholder="Busca cuenta proveedor..."
                        />
                        <small>
                          Si el proveedor ya trae cuenta por defecto en NetSuite, la usamos como base.
                        </small>
                      </label>

                      <div className="table-responsive analysis-table mt-3">
                        <table className="table align-middle mb-0">
                          <thead>
                            <tr>
                              <th>Cuenta</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {providerCcOptions.length === 0 ? (
                              <tr>
                                <td colSpan={2} className="text-secondary">
                                  No hay cuentas que coincidan con el filtro actual.
                                </td>
                              </tr>
                            ) : (
                              providerCcOptions.map((account) => (
                                <tr key={account.internalId}>
                                  <td>{account.displayName}</td>
                                  <td>
                                    <button
                                      type="button"
                                      className="ghost-button ghost-button--inline"
                                      onClick={() => setSelectedProviderCcId(account.internalId)}
                                    >
                                      {selectedProviderCcId === account.internalId ? 'Seleccionada' : 'Elegir'}
                                    </button>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>

                      <div className="note-strip mt-3">
                        Al guardar, la app sembrara la equivalencia futura usando el NombreEmisor y, si existe,
                        tambien el RFC del XML.
                      </div>

                      <div className="control-inline mt-3">
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => void handleSaveProviderHomologation()}
                          disabled={isSavingProviderHomologation || !selectedSupplier}
                        >
                          {isSavingProviderHomologation ? 'Guardando proveedor...' : 'Guardar homologacion proveedor'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="col-xl-6">
                  <div className="surface-card card h-100">
                    <div className="card-body">
                      <div className="eyebrow">Cuenta gasto</div>
                      <h4 className="h5 mb-3">Homologacion manual por ClaveProdServ</h4>

                      <label className="bank-field">
                        <span>ClaveProdServ pendiente</span>
                        <select
                          className="bank-select"
                          value={selectedMissingClave ?? ''}
                          onChange={(event) => setSelectedMissingClave(normalizeOptionalString(event.target.value))}
                          disabled={missingClaveOptions.length === 0}
                        >
                          {missingClaveOptions.length === 0 ? (
                            <option value="">Sin claves pendientes</option>
                          ) : (
                            missingClaveOptions.map((clave) => (
                              <option key={clave} value={clave}>
                                {clave}
                              </option>
                            ))
                          )}
                        </select>
                      </label>

                      <label className="bank-field mt-3">
                        <span>Buscar cuenta de gasto</span>
                        <input
                          type="search"
                          className="bank-input"
                          value={expenseAccountSearch}
                          onChange={(event) => setExpenseAccountSearch(event.target.value)}
                          placeholder="Busca cuenta contable..."
                        />
                      </label>

                      <div className="table-responsive analysis-table mt-3">
                        <table className="table align-middle mb-0">
                          <thead>
                            <tr>
                              <th>Cuenta</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {expenseAccountOptions.length === 0 ? (
                              <tr>
                                <td colSpan={2} className="text-secondary">
                                  No hay cuentas de gasto que coincidan con el filtro actual.
                                </td>
                              </tr>
                            ) : (
                              expenseAccountOptions.map((account) => (
                                <tr key={account.internalId}>
                                  <td>{account.displayName}</td>
                                  <td>
                                    <button
                                      type="button"
                                      className="ghost-button ghost-button--inline"
                                      onClick={() => setSelectedExpenseAccountId(account.internalId)}
                                    >
                                      {selectedExpenseAccountId === account.internalId ? 'Seleccionada' : 'Elegir'}
                                    </button>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>

                      {selectedReviewRows.length > 0 ? (
                        <div className="table-responsive analysis-table mt-3">
                          <table className="table align-middle mb-0">
                            <thead>
                              <tr>
                                <th>Linea</th>
                                <th>Clave</th>
                                <th>Descripcion</th>
                                <th>Cuenta actual</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedReviewRows
                                .filter((row) => row.lineType !== 'retention')
                                .map((row) => (
                                  <tr key={row.rowId}>
                                    <td>{row.conceptIndex}</td>
                                    <td>{row.claveProdServ ?? '--'}</td>
                                    <td>{row.descripcion ?? '--'}</td>
                                    <td>{row.cuentaGastos ?? '--'}</td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}

                      {selectedReviewMissingExpenseRows.length > 0 ? (
                        <div className="note-strip mt-3">
                          Esta factura tiene {formatInteger(selectedReviewMissingExpenseRows.length)} lineas sin cuenta de
                          gasto homologada.
                        </div>
                      ) : null}

                      <div className="control-inline mt-3">
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => void handleSaveAccountHomologation()}
                          disabled={
                            isSavingAccountHomologation || !selectedMissingClave || !selectedExpenseAccount
                          }
                        >
                          {isSavingAccountHomologation ? 'Guardando cuenta...' : 'Guardar homologacion cuenta'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      </>
      ) : null}

      {showPreviewPanel ? (
      <>
      <div className="col-12 facturas-sat-section" id="facturas-sat-preview">
        <div className="surface-card card">
          <div className="card-body">
            <div className="eyebrow">Modelo NetSuite</div>
            <h3 className="h4 mb-3">Preview SAT recibidas {'->'} Facturas Multilinea</h3>

            <div className="summary-list">
              <div className="summary-list__item">
                <span>Paquete preparado</span>
                <strong className="analysis-break">{activePreviewPackageLabel}</strong>
              </div>
              <div className="summary-list__item">
                <span>XML procesados</span>
                <strong>
                  {typeof activePreviewSummary?.xmlFiles === 'number'
                    ? formatInteger(activePreviewSummary.xmlFiles)
                    : '--'}
                </strong>
              </div>
              <div className="summary-list__item">
                <span>Facturas detectadas</span>
                <strong>
                  {typeof activePreviewSummary?.parsedInvoices === 'number'
                    ? formatInteger(activePreviewSummary.parsedInvoices)
                    : '--'}
                </strong>
              </div>
              <div className="summary-list__item">
                <span>Lineas generadas</span>
                <strong>
                  {typeof activePreviewSummary?.outputLines === 'number'
                    ? formatInteger(activePreviewSummary.outputLines)
                    : '--'}
                </strong>
              </div>
              <div className="summary-list__item">
                <span>Facturas listas</span>
                <strong>
                  {typeof activePreviewSummary?.readyInvoices === 'number'
                    ? formatInteger(activePreviewSummary.readyInvoices)
                    : '--'}
                </strong>
              </div>
              <div className="summary-list__item">
                <span>Pendientes no listas</span>
                <strong>
                  {typeof activePreviewSummary?.manualHomologationInvoices === 'number'
                    ? formatInteger(activePreviewSummary.manualHomologationInvoices)
                    : '--'}
                </strong>
              </div>
              <div className="summary-list__item">
                <span>Lineas con cuenta faltante</span>
                <strong>
                  {typeof activePreviewSummary?.missingExpenseAccountLines === 'number'
                    ? formatInteger(activePreviewSummary.missingExpenseAccountLines)
                    : '--'}
                </strong>
              </div>
              <div className="summary-list__item">
                <span>Retenciones sin cuenta</span>
                <strong>
                  {typeof activePreviewSummary?.unknownRetentionRateLines === 'number'
                    ? formatInteger(activePreviewSummary.unknownRetentionRateLines)
                    : '--'}
                </strong>
              </div>
              <div className="summary-list__item">
                <span>Duplicados exactos</span>
                <strong>
                  {typeof activePreviewSummary?.exactDuplicateInvoices === 'number'
                    ? formatInteger(activePreviewSummary.exactDuplicateInvoices)
                    : '--'}
                </strong>
              </div>
              <div className="summary-list__item">
                <span>Duplicados posibles</span>
                <strong>
                  {typeof activePreviewSummary?.possibleDuplicateInvoices === 'number'
                    ? formatInteger(activePreviewSummary.possibleDuplicateInvoices)
                    : '--'}
                </strong>
              </div>
            </div>

            {!activePreviewSummary ? (
              <div className="note-strip mt-3">
                {isPreparingAnalysisUploadState
                  ? 'Preparando preview de la ventana activa para mostrar el payload NetSuite.'
                  : 'Inspecciona un paquete o deja cargar la ventana activa para ver aqui las lineas que reemplazan la logica de Excel.'}
              </div>
            ) : null}

            {(netsuitePreview?.workbook.warnings.length ?? 0) > 0 ? (
              <div className="alert alert-warning mt-3 mb-0">
                {netsuitePreview?.workbook.warnings.join(' ')}
              </div>
            ) : null}

            {netsuitePreview ? (
              <div className="note-strip note-strip--accent mt-3">
                Archivo de equivalencias activo: {netsuitePreview.workbook.path}
              </div>
            ) : selectedAnalysisPreviewLoaded && selectedAnalysisWindow ? (
              <div className="note-strip note-strip--accent mt-3">
                Preview cargado desde la ventana activa {selectedAnalysisWindow.label} con{' '}
                {formatInteger(selectedAnalysisWindow.packageIds.length)} paquetes SAT.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="col-xl-5">
        <div className="surface-card card table-panel">
          <div className="card-body">
            <div className="analysis-toolbar">
              <div>
                <div className="eyebrow">Cola del preview</div>
                <h3 className="h4 mb-2">Selecciona la factura a revisar</h3>
                <p className="text-secondary mb-0">
                  Aqui ves el estado previo a la subida y eliges el UUID que quieres inspeccionar.
                </p>
              </div>

              <div className="control-inline">
                <NavLink to={buildFacturasSatUnifiedPath('analisis')} className="ghost-button ghost-button--inline">
                  Abrir analisis
                </NavLink>
                <NavLink to={buildFacturasSatUnifiedPath('homologacion')} className="ghost-button ghost-button--inline">
                  Abrir no listas
                </NavLink>
              </div>
            </div>

            <div className="facturas-sat-analysis-filters mt-3">
              <label className="bank-field">
                <span>Buscar factura</span>
                <input
                  type="search"
                  className="bank-input"
                  value={previewSearch}
                  onChange={(event) => setPreviewSearch(event.target.value)}
                  placeholder="UUID, emisor, proveedor o folio..."
                />
              </label>

              <label className="bank-field">
                <span>Filtro operativo</span>
                <select
                  className="bank-select"
                  value={previewQueueFilter}
                  onChange={(event) => setPreviewQueueFilter(event.target.value as SatAnalysisQueueFilter)}
                >
                  <option value="all">Todas</option>
                  <option value="ready">Listas para subir</option>
                  <option value="actionable">Bloqueadas por revision</option>
                  <option value="duplicate">Duplicadas</option>
                  <option value="missing_provider">Sin proveedor</option>
                  <option value="missing_account">Sin cuenta gasto</option>
                  <option value="missing_retention_rule">Retencion sin regla</option>
                  <option value="other">Otros bloqueos</option>
                </select>
              </label>

              <div className="note-strip facturas-sat-analysis-filters__summary">
                Mostrando {formatInteger(filteredPreviewQueueEntries.length)} de{' '}
                {formatInteger(previewQueueEntries.length)} facturas. {formatInteger(previewReadyQueueCount)} listas y{' '}
                {formatInteger(previewBlockedQueueCount)} con bloqueo.
              </div>
            </div>

            <div className="table-responsive analysis-table">
              <table className="table align-middle mb-0">
                <thead>
                  <tr>
                    <th>UUID</th>
                    <th>Emisor</th>
                    <th>Estado</th>
                    <th>Duplicado</th>
                    <th>Accion</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPreviewQueueEntries.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-secondary">
                        {activePreviewSummary
                          ? previewSearch || previewQueueFilter !== 'all'
                            ? 'Ninguna factura coincide con el filtro del preview.'
                            : 'No hay facturas en el preview preparado.'
                          : 'Prepara un modelo NetSuite para revisar incidencias.'}
                      </td>
                    </tr>
                  ) : (
                    filteredPreviewQueueEntries.map((entry) => (
                      <tr key={entry.key} className={entry.key === selectedPreviewInvoiceKey ? 'table-active' : undefined}>
                        <td className="analysis-break">{entry.invoice.uuid ?? '--'}</td>
                        <td>{entry.invoice.nombreEmisor ?? '--'}</td>
                        <td>
                          <div>{entry.statusLabel}</div>
                          <div className="text-secondary">{entry.invoice.proveedorNetsuite ?? '--'}</div>
                        </td>
                        <td>{formatDuplicateStatus(entry.invoice.duplicateStatus)}</td>
                        <td>
                          <button
                            type="button"
                            className="ghost-button ghost-button--inline"
                            onClick={() => setSelectedPreviewInvoiceKey(entry.key)}
                          >
                            {entry.key === selectedPreviewInvoiceKey ? 'Activa' : 'Ver'}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="col-xl-7">
        <div className="surface-card card table-panel">
          <div className="card-body">
            <div className="eyebrow">Factura seleccionada</div>
            <h3 className="h4 mb-3">Contexto antes de subir</h3>

            {!selectedPreviewEntry ? (
              <div className="note-strip">
                Prepara un modelo NetSuite y selecciona una factura para revisar su payload y bloqueos.
              </div>
            ) : (
              <>
                <div className="summary-list">
                  <div className="summary-list__item">
                    <span>UUID</span>
                    <strong className="analysis-break">{selectedPreviewEntry.invoice.uuid ?? '--'}</strong>
                  </div>
                  <div className="summary-list__item">
                    <span>Serie / folio</span>
                    <strong>{selectedPreviewEntry.invoice.serieFolio ?? '--'}</strong>
                  </div>
                  <div className="summary-list__item">
                    <span>Emisor</span>
                    <strong>{selectedPreviewEntry.invoice.nombreEmisor ?? '--'}</strong>
                  </div>
                  <div className="summary-list__item">
                    <span>Proveedor NetSuite</span>
                    <strong>{selectedPreviewEntry.invoice.proveedorNetsuite ?? '--'}</strong>
                  </div>
                  <div className="summary-list__item">
                    <span>Cuenta proveedor</span>
                    <strong>{selectedPreviewEntry.invoice.cc ?? '--'}</strong>
                  </div>
                  <div className="summary-list__item">
                    <span>Total XML</span>
                    <strong>
                      {`${formatAmount(selectedPreviewEntry.invoice.totalXml)} ${selectedPreviewEntry.invoice.moneda}`.trim()}
                    </strong>
                  </div>
                  <div className="summary-list__item">
                    <span>Lineas generadas</span>
                    <strong>{formatInteger(selectedPreviewEntry.invoice.totalLineCount)}</strong>
                  </div>
                  <div className="summary-list__item">
                    <span>Match proveedor</span>
                    <strong>{formatProviderMatchSource(selectedPreviewEntry.invoice.providerMatchSource)}</strong>
                  </div>
                  <div className="summary-list__item">
                    <span>Estado de carga</span>
                    <strong>{selectedPreviewEntry.statusLabel}</strong>
                  </div>
                </div>

                {selectedPreviewLinkedReviewEntry ? (
                  <div className="control-inline mt-3">
                    <NavLink
                      to={buildFacturasSatReviewPath('analisis', selectedPreviewLinkedReviewEntry.item.uuid)}
                      className="ghost-button ghost-button--inline"
                      onClick={() =>
                        focusReviewUuidOnSection(selectedPreviewLinkedReviewEntry.item.uuid, 'analysis')
                      }
                    >
                      Abrir en analisis
                    </NavLink>

                    {(selectedPreviewLinkedReviewEntry.status === 'missing_provider' ||
                      selectedPreviewLinkedReviewEntry.status === 'missing_account' ||
                      selectedPreviewLinkedReviewEntry.status === 'missing_retention_rule' ||
                      selectedPreviewLinkedReviewEntry.status === 'other') ? (
                      <NavLink
                        to={buildFacturasSatReviewPath('homologacion', selectedPreviewLinkedReviewEntry.item.uuid)}
                        className="ghost-button ghost-button--inline"
                        onClick={() =>
                          focusReviewUuidOnSection(selectedPreviewLinkedReviewEntry.item.uuid, 'homologation')
                        }
                      >
                        Abrir en no listas
                      </NavLink>
                    ) : null}
                  </div>
                ) : selectedPreviewEntry.invoice.uuid ? (
                  <div className="note-strip mt-3">
                    Esta factura no aparece dentro de la ventana activa de analisis. Si quieres saltar directo,
                    primero carga o selecciona la ventana SAT donde viva ese UUID.
                  </div>
                ) : null}

                <div className={`note-strip mt-3 ${selectedPreviewEntry.invoice.readyToImport ? 'note-strip--accent' : ''}`}>
                  {selectedPreviewEntry.invoice.readyToImport
                    ? 'Esta factura ya esta lista para importarse en NetSuite con el payload mostrado abajo.'
                    : selectedPreviewEntry.statusDetail}
                </div>

                {selectedPreviewEntry.invoice.issues.length > 0 ? (
                  <div className="check-list mt-3">
                    {selectedPreviewEntry.invoice.issues.map((issue, index) => (
                      <div key={`${selectedPreviewEntry.key}:${index}`} className="check-list__item">
                        <strong>{issue}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}

                {selectedPreviewEntry.invoice.duplicateMatches.length > 0 ? (
                  <div className="note-strip mt-3">
                    Coincidencias NetSuite:{' '}
                    {selectedPreviewEntry.invoice.duplicateMatches
                      .slice(0, 3)
                      .map(
                        (match) =>
                          match.transactionNumber ??
                          match.tranId ??
                          match.internalId ??
                          match.mxCfdiUuid ??
                          '--',
                      )
                      .join(', ')}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="col-12">
        <div className="surface-card card table-panel">
          <div className="card-body">
            <div className="eyebrow">Preview de lineas</div>
            <h3 className="h4 mb-3">Payload NetSuite de la factura seleccionada</h3>

            <div className="table-responsive analysis-table">
              <table className="table align-middle mb-0">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>UUID</th>
                    <th>Descripcion</th>
                    <th>Proveedor</th>
                    <th>Duplicado</th>
                    <th>Cuenta gastos</th>
                    <th>CC</th>
                    <th>Importe</th>
                    <th>Traslado</th>
                    <th>Monto</th>
                    <th>Problemas</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedPreviewRows.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="text-secondary">
                        {selectedPreviewEntry
                          ? 'No hay lineas visibles para la factura seleccionada.'
                          : activePreviewSummary
                            ? 'Selecciona una factura del preview para ver su payload.'
                            : 'Prepara un modelo NetSuite para ver aqui las lineas resultantes.'}
                      </td>
                    </tr>
                  ) : (
                    selectedPreviewRows.map((row) => (
                      <tr key={row.rowId}>
                        <td>{formatLineType(row.lineType)}</td>
                        <td className="analysis-break">{row.uuid ?? '--'}</td>
                        <td>{row.descripcion ?? '--'}</td>
                        <td>{row.proveedorNetsuite ?? '--'}</td>
                        <td>
                          {formatDuplicateStatus(
                            activePreviewInvoices.find((invoice) => invoice.uuid === row.uuid)?.duplicateStatus ??
                              'clear',
                          )}
                        </td>
                        <td>{row.cuentaGastos ?? '--'}</td>
                        <td>{row.cc ?? '--'}</td>
                        <td>{formatAmount(row.importe)}</td>
                        <td>{formatAmount(row.importeTraslado)}</td>
                        <td>{formatAmount(row.monto)}</td>
                        <td>{row.issues.join(' ') || '--'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      </>
      ) : null}
    </div>
  )
}

function createDefaultFormState(): SatQueryFormState {
  const end = new Date()
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000)

  return {
    startAt: formatDateTimeLocalInput(start),
    endAt: formatDateTimeLocalInput(end),
    downloadType: 'received',
    requestType: 'xml',
    documentStatus: 'active',
    documentType: 'undefined',
    rfcMatch: '',
    uuid: '',
  }
}

function createDefaultAnalysisFormState(): SatAnalysisFormState {
  return {
    startDate: '2026-04-01',
    endDate: formatDateInput(new Date()),
  }
}

function buildRequestPayload(formState: SatQueryFormState) {
  const normalizedUuid = normalizeOptionalString(formState.uuid)
  const startAt = normalizedUuid ? null : toIsoString(formState.startAt)
  const endAt = normalizedUuid ? null : toIsoString(formState.endAt)

  if (!normalizedUuid && (!startAt || !endAt)) {
    throw new Error('Define un periodo valido o captura un UUID para consultar al SAT.')
  }

  return {
    startAt,
    endAt,
    downloadType: formState.downloadType,
    requestType: formState.requestType,
    documentType: normalizedUuid ? 'undefined' : formState.documentType,
    documentStatus: normalizedUuid ? 'undefined' : formState.documentStatus,
    uuid: normalizedUuid,
    rfcMatch: normalizedUuid ? null : normalizeOptionalString(formState.rfcMatch),
  }
}

function formatDateInput(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDate(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed)
}

function formatDateTime(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(parsed)
}

function formatDateTimeLocalInput(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  const hours = String(value.getHours()).padStart(2, '0')
  const minutes = String(value.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function toIsoDateStart(value: string) {
  const normalized = normalizeOptionalString(value)
  if (!normalized) {
    throw new Error('Define una fecha inicial valida para el subset SAT.')
  }

  const parsed = new Date(`${normalized}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`La fecha inicial ${value} no es valida.`)
  }

  return parsed.toISOString()
}

function toIsoDateEnd(value: string) {
  const normalized = normalizeOptionalString(value)
  if (!normalized) {
    throw new Error('Define una fecha final valida para el subset SAT.')
  }

  const parsed = new Date(`${normalized}T23:59:59.999`)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`La fecha final ${value} no es valida.`)
  }

  const now = new Date()
  return parsed.getTime() > now.getTime() ? now.toISOString() : parsed.toISOString()
}

function formatInteger(value: number) {
  return new Intl.NumberFormat('es-ES', {
    maximumFractionDigits: 0,
  }).format(value)
}

function getReadyUploadProgressPhaseLabel(phase: ReadyUploadProgressPhase) {
  switch (phase) {
    case 'preparing':
      return 'Preparando lote'
    case 'uploading':
      return 'Subiendo facturas'
    case 'syncing':
      return 'Sincronizando resultados'
    case 'completed':
      return 'Subida terminada'
    case 'failed':
      return 'Subida detenida'
    default:
      return phase
  }
}

function getReadyUploadProgressPercent(progress: ReadyUploadProgressState) {
  if (progress.total <= 0) {
    return progress.phase === 'completed' ? 100 : 0
  }

  switch (progress.phase) {
    case 'preparing':
      return 0
    case 'uploading':
      return Math.max(3, Math.min(90, Math.round((progress.completed / progress.total) * 90)))
    case 'syncing':
      return 95
    case 'completed':
      return 100
    case 'failed':
      return Math.max(3, Math.min(95, Math.round((progress.completed / progress.total) * 90)))
    default:
      return 0
  }
}

function formatAmount(value: number) {
  return new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value)
}

function formatLineType(value: string) {
  switch (value) {
    case 'normal':
      return 'Normal'
    case 'discount':
      return 'Descuento'
    case 'ieps':
      return 'IEPS'
    case 'local_tax':
      return 'Impuesto local'
    case 'retention':
      return 'Retencion'
    default:
      return value
  }
}

function formatProviderMatchSource(value: SatAnalysisWindowPreviewInvoice['providerMatchSource'] | null) {
  switch (value) {
    case 'manual':
      return 'Manual'
    case 'rfc':
      return 'RFC'
    case 'name':
      return 'Nombre'
    default:
      return '--'
  }
}

function formatDuplicateStatus(value: 'clear' | 'exact' | 'possible') {
  switch (value) {
    case 'clear':
      return 'No'
    case 'exact':
      return 'Exacto'
    case 'possible':
      return 'Posible'
  }
}

function formatAnalysisWindowStatus(value: 'pending_sat' | 'ready' | null) {
  switch (value) {
    case 'pending_sat':
      return 'Pendiente SAT'
    case 'ready':
      return 'Lista'
    default:
      return '--'
  }
}

function formatProcessedReason(value: 'already_in_netsuite' | 'uploaded_to_netsuite') {
  switch (value) {
    case 'already_in_netsuite':
      return 'Ya en NetSuite'
    case 'uploaded_to_netsuite':
      return 'Cargada por la app'
  }
}

function resolveFacturasSatHeaderSection(value: string) {
  const normalized = value.trim().toLowerCase()
  const canonicalSlug = FACTURAS_SAT_HEADER_SECTION_ALIASES[normalized] ?? normalized

  return (
    FACTURAS_SAT_HEADER_SECTIONS.find((section) => section.slug === canonicalSlug) ?? null
  )
}

function parseFacturasSatLegacyPanel(value: string | null) {
  const section = value ? resolveFacturasSatHeaderSection(value) : null
  if (!section || section.slug === 'status') {
    return null
  }

  return section.slug
}

function parseFacturasSatFocusPanel(value: string | null) {
  const normalized = normalizeOptionalString(value ?? '')
  if (!normalized) {
    return null
  }

  const section = resolveFacturasSatHeaderSection(normalized)
  if (!section || section.slug === 'status') {
    return null
  }

  return section.slug
}

function parseFacturasSatTableView(value: string | null): FacturasSatTableView | null {
  const normalized = normalizeOptionalString(value ?? '')?.toLowerCase()
  if (!normalized) {
    return null
  }

  switch (normalized) {
    case 'pending':
    case 'pendientes':
      return 'pending'
    case 'windows':
    case 'ventanas':
      return 'windows'
    case 'packages':
    case 'paquetes':
      return 'packages'
    case 'processed':
    case 'procesadas':
      return 'processed'
    case 'homologation':
    case 'homologacion':
      return 'homologation'
    case 'preview':
      return 'preview'
    default:
      return null
  }
}

function resolveFacturasSatTableView(
  panel: FacturasSatFocusPanel | null,
  requestedView: FacturasSatTableView | null,
): FacturasSatTableView {
  if (requestedView) {
    return requestedView
  }

  switch (panel) {
    case 'paquetes':
      return 'packages'
    case 'homologacion':
      return 'homologation'
    case 'preview':
      return 'preview'
    default:
      return 'pending'
  }
}

function buildFacturasSatUnifiedPath(
  panel?: FacturasSatFocusPanel | null,
  uuid?: string | null | undefined,
  view?: FacturasSatTableView | null,
) {
  const searchParams = new URLSearchParams()
  const normalizedPanel = panel ?? null
  const normalizedUuid = normalizeOptionalString(uuid ?? '')
  const normalizedView = view ?? null

  if (normalizedPanel) {
    searchParams.set('panel', normalizedPanel)
  }

  if (normalizedView && normalizedView !== 'pending') {
    searchParams.set('view', normalizedView)
  }

  if (normalizedUuid) {
    searchParams.set('uuid', normalizedUuid)
  }

  const serialized = searchParams.toString()
  return serialized ? `/facturas-sat?${serialized}` : '/facturas-sat'
}

function getFacturasSatPanelElementId(panel: FacturasSatFocusPanel) {
  switch (panel) {
    case 'solicitud':
      return 'facturas-sat-request'
    case 'paquetes':
      return 'facturas-sat-packages'
    case 'analisis':
      return 'facturas-sat-analysis'
    case 'homologacion':
      return 'facturas-sat-homologation'
    case 'preview':
      return 'facturas-sat-preview'
  }
}

function buildFacturasSatReviewPath(
  section: Extract<FacturasSatFocusPanel, 'analisis' | 'homologacion' | 'preview'>,
  uuid: string | null | undefined,
) {
  return buildFacturasSatUnifiedPath(section, uuid)
}

function toIsoString(value: string) {
  const normalized = normalizeOptionalString(value)
  if (!normalized) {
    return null
  }

  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`La fecha ${value} no es valida para el SAT.`)
  }

  return parsed.toISOString()
}

function normalizeOptionalString(value: string) {
  const normalized = value.trim()
  return normalized ? normalized : null
}

function normalizeUuidKey(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? ''
}

function parseError(reason: unknown) {
  if (reason instanceof HttpClientError) {
    const payload = safeParseBody(reason.body)
    return payload?.error ?? reason.message
  }

  if (reason instanceof Error) {
    return reason.message
  }

  return 'Unable to connect with SAT.'
}

function safeParseBody(body?: string) {
  if (!body) {
    return null
  }

  try {
    return JSON.parse(body) as ErrorPayload
  } catch {
    return null
  }
}

function classifySatReviewQueueItem(previewInvoice: SatReviewClassifiablePreview | null): {
  status: SatReviewQueueStatus
  statusLabel: string
  statusDetail: string
} {
  if (!previewInvoice) {
    return {
      status: 'other',
      statusLabel: 'Sin preview',
      statusDetail: 'Todavia no pude preparar el modelo local de esta factura.',
    }
  }

  if (previewInvoice.duplicateStatus !== 'clear') {
    return {
      status: 'duplicate',
      statusLabel: previewInvoice.duplicateStatus === 'exact' ? 'Duplicada exacta' : 'Duplicada posible',
      statusDetail:
        previewInvoice.duplicateMatches[0]?.transactionNumber ??
        previewInvoice.issues[0] ??
        'La factura parece existir ya en NetSuite.',
    }
  }

  if (previewInvoice.readyToImport) {
    return {
      status: 'ready',
      statusLabel: 'Lista',
      statusDetail: 'Ya puede subirse a NetSuite desde esta misma cola.',
    }
  }

  if (previewInvoice.issues.some((issue) => issue.toUpperCase().includes('PROVEEDOR SIN HOMOLOGACION AUTOMATICA'))) {
    return {
      status: 'missing_provider',
      statusLabel: 'Sin proveedor',
      statusDetail: previewInvoice.issues[0] ?? 'La factura requiere homologacion manual del proveedor.',
    }
  }

  if (
    previewInvoice.issues.some(
      (issue) =>
        issue.toUpperCase().includes('PROVEEDOR NETSUITE DEFINIDO') ||
        issue.toUpperCase().includes('CUENTA PROVEEDOR DEFINIDA'),
    )
  ) {
    return {
      status: 'missing_provider',
      statusLabel: 'Proveedor incompleto',
      statusDetail: previewInvoice.issues[0] ?? 'La equivalencia del proveedor esta incompleta.',
    }
  }

  if (previewInvoice.issues.some((issue) => issue.toUpperCase().includes('CUENTA GASTOS SIN HOMOLOGACION'))) {
    return {
      status: 'missing_account',
      statusLabel: 'Sin cuenta gasto',
      statusDetail: previewInvoice.issues[0] ?? 'Falta homologar una ClaveProdServ.',
    }
  }

  if (previewInvoice.issues.some((issue) => issue.toUpperCase().includes('RETENCION NO TIENE CUENTA CONTABLE'))) {
    return {
      status: 'missing_retention_rule',
      statusLabel: 'Retencion sin regla',
      statusDetail: previewInvoice.issues[0] ?? 'Hay una retencion sin cuenta contable configurada.',
    }
  }

  return {
    status: 'other',
    statusLabel: 'Revisar',
    statusDetail: previewInvoice.issues[0] ?? 'La factura requiere revision manual antes de cargar.',
  }
}

function buildSatReviewQueueSummary(entries: SatReviewQueueEntry[]) {
  return entries.reduce(
    (summary, entry) => {
      switch (entry.status) {
        case 'ready':
          summary.ready += 1
          break
        case 'duplicate':
          summary.duplicate += 1
          break
        case 'missing_provider':
          summary.missingProvider += 1
          break
        case 'missing_account':
          summary.missingAccount += 1
          break
        case 'missing_retention_rule':
          summary.missingRetentionRule += 1
          break
        case 'other':
          summary.other += 1
          break
      }

      return summary
    },
    {
      ready: 0,
      duplicate: 0,
      missingProvider: 0,
      missingAccount: 0,
      missingRetentionRule: 0,
      other: 0,
    },
  )
}

function buildSatReviewQueueEntries(
  items: SatAnalysisItem[],
  previewState: SatAnalysisWindowPreviewState | null,
) {
  return items.map((item) => {
    const previewInvoice = item.uuid ? previewState?.invoicesByUuid[normalizeUuidKey(item.uuid)] ?? null : null

    return {
      item,
      previewInvoice,
      ...classifySatReviewQueueItem(previewInvoice),
    } satisfies SatReviewQueueEntry
  })
}

function buildReadyReviewQueueEntries(
  window: SatAnalysisWindow | null,
  previewState: SatAnalysisWindowPreviewState | null,
) {
  if (!window || !previewState) {
    return []
  }

  return dedupeSatReviewQueueEntries(
    buildSatReviewQueueEntries(window.analysisItems, previewState).filter(
      (entry) => entry.status === 'ready' && Boolean(normalizeUuidKey(entry.item.uuid)),
    ),
  )
}

function buildSatPreviewOperationalSummary(invoices: SatReviewClassifiablePreview[]) {
  const summary = {
    total: invoices.length,
    ready: 0,
    duplicate: 0,
    missingProvider: 0,
    missingAccount: 0,
    missingRetentionRule: 0,
    other: 0,
  }

  for (const invoice of invoices) {
    const classification = classifySatReviewQueueItem(invoice)
    switch (classification.status) {
      case 'ready':
        summary.ready += 1
        break
      case 'duplicate':
        summary.duplicate += 1
        break
      case 'missing_provider':
        summary.missingProvider += 1
        break
      case 'missing_account':
        summary.missingAccount += 1
        break
      case 'missing_retention_rule':
        summary.missingRetentionRule += 1
        break
      case 'other':
        summary.other += 1
        break
    }
  }

  return summary
}

function buildSatPreparedPreviewSummary(
  invoices: Array<SatCfdiNetsuitePreviewResponse['invoices'][number]>,
  rows: SatCfdiNetsuitePreviewResponse['rows'],
) {
  const operational = buildSatPreviewOperationalSummary(invoices)
  const xmlFiles = new Set(invoices.map((invoice) => invoice.fileName).filter(Boolean)).size
  const normalLineCount = rows.filter((row) => row.lineType === 'normal').length
  const discountLineCount = rows.filter((row) => row.lineType === 'discount').length
  const retentionLineCount = rows.filter((row) => row.lineType === 'retention').length
  const invoicesWithDifferenceWarning = invoices.filter((invoice) => Math.abs(invoice.differenceVsXmlTotal) > 0.000001).length
  const exactDuplicateInvoices = invoices.filter((invoice) => invoice.duplicateStatus === 'exact').length
  const possibleDuplicateInvoices = invoices.filter((invoice) => invoice.duplicateStatus === 'possible').length
  const missingExpenseAccountLines = rows.filter((row) => row.lineType !== 'retention' && !row.cuentaGastos).length
  const unknownRetentionRateLines = rows.filter(
    (row) =>
      row.lineType === 'retention' &&
      row.issues.some((issue) => issue.toUpperCase().includes('RETENCION')),
  ).length

  return {
    xmlFiles,
    parsedInvoices: invoices.length,
    outputLines: rows.length,
    normalLineCount,
    discountLineCount,
    retentionLineCount,
    readyInvoices: operational.ready,
    manualHomologationInvoices:
      operational.missingProvider +
      operational.missingAccount +
      operational.missingRetentionRule +
      operational.other,
    missingExpenseAccountLines,
    unknownRetentionRateLines,
    exactDuplicateInvoices,
    possibleDuplicateInvoices,
    invoicesWithDifferenceWarning,
  }
}

function dedupeSatReviewQueueEntries(entries: SatReviewQueueEntry[]) {
  const seen = new Set<string>()
  const deduped: SatReviewQueueEntry[] = []

  for (const entry of entries) {
    const normalizedUuid = normalizeUuidKey(entry.item.uuid)
    if (!normalizedUuid || seen.has(normalizedUuid)) {
      continue
    }

    seen.add(normalizedUuid)
    deduped.push(entry)
  }

  return deduped
}

function matchesSatReviewQueueFilter(
  entry: Pick<SatReviewQueueEntry | SatPreviewQueueEntry, 'status'>,
  filter: SatAnalysisQueueFilter,
) {
  switch (filter) {
    case 'all':
      return true
    case 'actionable':
      return (
        entry.status === 'missing_provider' ||
        entry.status === 'missing_account' ||
        entry.status === 'missing_retention_rule' ||
        entry.status === 'other'
      )
    default:
      return entry.status === filter
  }
}

function matchesSatReviewQueueSearch(entry: SatReviewQueueEntry, query: string) {
  if (!query) {
    return true
  }

  return (
    scoreSearchMatch(query, [
      entry.item.uuid,
      entry.item.emisorNombre,
      entry.item.emisorRfc,
      entry.item.packageId,
      entry.item.fileName,
      entry.previewInvoice?.nombreEmisor,
      entry.previewInvoice?.rfcEmisor,
      entry.previewInvoice?.proveedorNetsuite,
      entry.previewInvoice?.cc,
      entry.statusLabel,
      entry.statusDetail,
      entry.previewInvoice?.issues.join(' '),
      entry.previewInvoice?.duplicateMatches
        .map(
          (match) =>
            match.transactionNumber ?? match.tranId ?? match.internalId ?? match.mxCfdiUuid ?? match.externalId,
        )
        .join(' '),
    ]) > 0
  )
}

function matchesSatProcessedItemSearch(item: SatAnalysisWindow['processedItems'][number], query: string) {
  if (!query) {
    return true
  }

  return (
    scoreSearchMatch(query, [
      item.uuid,
      item.emisorNombre,
      item.emisorRfc,
      item.packageId,
      item.fileName,
      formatProcessedReason(item.processedReason),
      item.netsuiteMatches
        .map((match) => match.transactionNumber ?? match.tranId ?? match.internalId ?? match.vendorName)
        .join(' '),
    ]) > 0
  )
}

function matchesSatPreviewInvoiceSearch(entry: SatPreviewQueueEntry, query: string) {
  if (!query) {
    return true
  }

  return (
    scoreSearchMatch(query, [
      entry.invoice.uuid,
      entry.invoice.fileName,
      entry.invoice.nombreEmisor,
      entry.invoice.rfcEmisor,
      entry.invoice.proveedorNetsuite,
      entry.invoice.cc,
      entry.invoice.serieFolio,
      entry.statusLabel,
      entry.statusDetail,
      entry.invoice.issues.join(' '),
      entry.invoice.duplicateMatches
        .map(
          (match) =>
            match.transactionNumber ?? match.tranId ?? match.internalId ?? match.mxCfdiUuid ?? match.externalId,
        )
        .join(' '),
    ]) > 0
  )
}

function getSatPreviewInvoiceKey(
  value:
    | Pick<SatCfdiNetsuitePreviewResponse['invoices'][number], 'uuid' | 'fileName' | 'serieFolio' | 'nombreEmisor'>
    | Pick<SatCfdiNetsuitePreviewResponse['rows'][number], 'uuid' | 'serieFolio' | 'nombreEmisor'>,
) {
  const normalizedUuid = normalizeUuidKey(value.uuid)
  if (normalizedUuid) {
    return `uuid:${normalizedUuid}`
  }

  const normalizedEmisor = normalizeSearchText(value.nombreEmisor)
  const normalizedSerieFolio = normalizeSearchText(value.serieFolio)
  if (normalizedEmisor || normalizedSerieFolio) {
    return `alt:${normalizedEmisor}:${normalizedSerieFolio}`
  }

  if ('fileName' in value) {
    return `file:${normalizeSearchText(value.fileName)}`
  }

  return 'preview:unknown'
}

function getMissingClaveOptions(rows: SatCfdiNetsuitePreviewResponse['rows']) {
  return [...new Set(
    rows
      .filter((row) => row.lineType !== 'retention' && !row.cuentaGastos)
      .map((row) => normalizeOptionalString(row.claveProdServ ?? ''))
      .filter((value): value is string => Boolean(value)),
  )]
}

function filterSupplierCatalog(items: NetSuiteEntityCatalogResponse['items'], query: string) {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) {
    return items.slice(0, 8)
  }

  return [...items]
    .map((item) => ({
      item,
      score: scoreSearchMatch(
        normalizedQuery,
        [item.displayName, item.rfc, item.entityId, item.altName, item.companyName].filter(Boolean),
      ),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((candidate) => candidate.item)
}

function filterAccountCatalog(items: NetSuiteAccountCatalogResponse['items'], query: string) {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) {
    return items.slice(0, 8)
  }

  return [...items]
    .map((item) => ({
      item,
      score: scoreSearchMatch(normalizedQuery, [item.displayName]),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((candidate) => candidate.item)
}

function resolveDefaultSupplierCc(
  supplier: NetSuiteEntityCatalogResponse['items'][number] | null,
  accountCatalog: NetSuiteAccountCatalogResponse | null,
) {
  if (!supplier?.accountDisplayName || !accountCatalog) {
    return null
  }

  const normalizedAccountName = normalizeSearchText(supplier.accountDisplayName)
  return (
    accountCatalog.items.find((item) => normalizeSearchText(item.displayName) === normalizedAccountName) ?? null
  )
}

function scoreSearchMatch(query: string, haystacks: Array<string | null | undefined>) {
  let score = 0

  for (const haystack of haystacks) {
    const normalizedHaystack = normalizeSearchText(haystack)
    if (!normalizedHaystack) {
      continue
    }

    if (normalizedHaystack === query) {
      score = Math.max(score, 120)
      continue
    }

    if (normalizedHaystack.startsWith(query)) {
      score = Math.max(score, 90)
      continue
    }

    if (normalizedHaystack.includes(query)) {
      score = Math.max(score, 70)
    }
  }

  return score
}

function normalizeSearchText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}
