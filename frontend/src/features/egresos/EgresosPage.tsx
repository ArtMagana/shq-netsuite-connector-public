import { useDeferredValue, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  applyEgresoExactCredit,
  fetchEgresosBootstrap,
  fetchEgresosExactReadyOverview,
  HttpClientError,
  prepareEgresoExactJournal,
  reconcileEgresoExactSupport,
  type EgresoBill,
  type EgresoConciliationLane,
  type EgresosExactReadyOverviewResponse,
  type EgresosBootstrapResponse,
} from '../../services/api/reconciliationApi'

type EgresosState = EgresosBootstrapResponse | null

type ErrorPayload = {
  error?: string
}

type EgresoStatusFilter = 'all' | 'E1' | 'E2' | 'E3' | 'E4' | 'E5' | 'E6' | 'E7'
type EgresoDueFilter = 'all' | 'vigente' | 'vencida'
type EgresoConciliationFilter = 'all' | EgresoConciliationLane

type ConciliationTone = EgresoBill['statusTone'] | 'healthy' | 'error'

type ConciliationMetric = {
  label: string
  value: string
  caption: string
}

type ConciliationCheck = {
  id: string
  label: string
  value: string
  detail: string
  tone: ConciliationTone
}

type ExactReadyOverviewState = EgresosExactReadyOverviewResponse | null
type EgresosPageMode = 'overview' | 'detail'
type EgresosNavigationState = {
  selectedBillId: string | null
  offset: number
}
type ActionFeedbackState = {
  tone: 'success' | 'warning'
  title: string
  message: string
  nextStepLabel?: string | null
  nextStepDetail?: string | null
  billInternalId?: string | null
  billDocumentNumber?: string | null
  journalDocumentNumber?: string | null
  preparedAtUtc?: string | null
}

type ConciliationActionContext = {
  objective: string
  detail: string
  buttonLabel: string
  disabled: boolean
}

const PAGE_LIMIT = 50

export function EgresosPage() {
  return <EgresosWorkspace mode="overview" />
}

export function EgresosDetalleConciliacionPage() {
  return <EgresosWorkspace mode="detail" />
}

function EgresosWorkspace({ mode }: { mode: EgresosPageMode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const navigationState = resolveEgresosNavigationState(location.state)
  const detailOnly = mode === 'detail'
  const [egresosState, setEgresosState] = useState<EgresosState>(null)
  const [exactReadyOverview, setExactReadyOverview] =
    useState<ExactReadyOverviewState>(null)
  const [isOverviewLoading, setIsOverviewLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionFeedback, setActionFeedback] = useState<ActionFeedbackState | null>(null)
  const [offset, setOffset] = useState(navigationState.offset)
  const [selectedBillId, setSelectedBillId] = useState<string | null>(
    navigationState.selectedBillId,
  )
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<EgresoStatusFilter>('all')
  const [dueFilter, setDueFilter] = useState<EgresoDueFilter>('all')
  const [conciliationFilter, setConciliationFilter] =
    useState<EgresoConciliationFilter>('all')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [isPreparingJournal, setIsPreparingJournal] = useState(false)
  const [isReconcilingExact, setIsReconcilingExact] = useState(false)

  const deferredSearchTerm = useDeferredValue(searchTerm)

  useEffect(() => {
    void refreshConciliation(false, navigationState.offset)
  }, [detailOnly, navigationState.offset])

  async function loadEgresos(nextOffset = 0, forceRefresh = false) {
    setIsRefreshing(true)

    try {
      const response = await fetchEgresosBootstrap({
        forceRefresh,
        limit: PAGE_LIMIT,
        offset: nextOffset,
      })
      setEgresosState(response)
      setOffset(nextOffset)
      setError(null)
      return response
    } catch (reason) {
      setEgresosState(null)
      setError(parseError(reason))
      return null
    } finally {
      setIsRefreshing(false)
    }
  }

  async function loadExactReadyOverview(forceRefresh = false) {
    setIsOverviewLoading(true)

    try {
      const response = await fetchEgresosExactReadyOverview({
        forceRefresh,
        pageSize: PAGE_LIMIT,
      })
      setExactReadyOverview(response)
      return response
    } catch {
      setExactReadyOverview(null)
      return null
    } finally {
      setIsOverviewLoading(false)
    }
  }

  async function refreshConciliation(forceRefresh = false, nextOffset = offset) {
    const response = await loadEgresos(nextOffset, forceRefresh)
    if (exactReadyOverview) {
      void loadExactReadyOverview(forceRefresh)
    }
    return response
  }

  const pageBills = egresosState?.bills ?? []
  const statusOptions = (egresosState?.transactionTypes ?? []).filter(
    (transactionType) => transactionType.total > 0,
  )
  const normalizedSearch = normalizeSearchValue(deferredSearchTerm)
  const filteredBills = [...pageBills]
    .filter((bill) => {
      if (statusFilter !== 'all' && bill.statusCode !== statusFilter) {
        return false
      }

      if (dueFilter !== 'all' && bill.dueStatus !== dueFilter) {
        return false
      }

      if (
        conciliationFilter !== 'all' &&
        bill.conciliation.lane !== conciliationFilter
      ) {
        return false
      }

      if (normalizedSearch && !matchesTextFilter(bill, normalizedSearch)) {
        return false
      }

      return true
    })
    .sort(compareBillsByStatusAndDueDate)

  const hasActiveFilters =
    searchTerm.trim().length > 0 ||
    statusFilter !== 'all' ||
    dueFilter !== 'all' ||
    conciliationFilter !== 'all'

  const highlightedSourceBills =
    filteredBills.length > 0 ? filteredBills : hasActiveFilters ? [] : pageBills
  const highlightedBill =
    highlightedSourceBills.find(
      (bill) => bill.internalId === egresosState?.highlightBillInternalId,
    ) ??
    highlightedSourceBills[0] ??
    null
  const selectedBill =
    highlightedSourceBills.find((bill) => bill.internalId === selectedBillId) ??
    highlightedBill
  const selectedCandidate = getPrimaryCandidate(selectedBill)
  const selectedChecks = selectedBill
    ? buildConciliationChecks(selectedBill)
    : []
  const queueMetrics = buildConciliationMetrics(filteredBills)
  const conciliationSummary = buildConciliationSummary(filteredBills)
  const firstVisibleDirectApplyBill =
    (filteredBills.length > 0 ? filteredBills : pageBills).find(
      (bill) => bill.conciliation.actionCode === 'apply-credit',
    ) ?? null
  const firstVisibleExactBill =
    (filteredBills.length > 0 ? filteredBills : pageBills).find(
      (bill) => bill.statusCode === 'E1',
    ) ?? null
  const firstVisibleJournalReadyBill =
    (filteredBills.length > 0 ? filteredBills : pageBills).find(
      (bill) => bill.operationalCode === 'E1J',
    ) ?? null
  const firstVisibleReviewExactBill =
    (filteredBills.length > 0 ? filteredBills : pageBills).find(
      (bill) => bill.operationalCode === 'E1R',
    ) ?? null
  const conciliationActionContext = resolveConciliationActionContext({
    firstVisibleExactBill,
    firstVisibleDirectApplyBill,
    firstVisibleJournalReadyBill,
    firstVisibleReviewExactBill,
    exactReadyOverview,
    isOverviewLoading,
  })

  useEffect(() => {
    const nextSelectedBillId = selectedBill?.internalId ?? null
    if (nextSelectedBillId !== selectedBillId) {
      setSelectedBillId(nextSelectedBillId)
    }
  }, [selectedBill?.internalId, selectedBillId])

  async function handleApplyExactCredit() {
    if (!selectedBill) {
      return
    }

    await handleApplyExactCreditForBill(selectedBill)
  }

  async function handleApplyExactCreditForBill(bill: EgresoBill) {
    if (bill.conciliation.actionCode !== 'apply-credit') {
      return
    }

    const candidate = getPrimaryCandidate(bill)
    if (!candidate) {
      setActionFeedback({
        tone: 'warning',
        title: 'No hay soporte exacto disponible',
        message: 'La factura seleccionada ya no tiene un soporte exacto disponible.',
        billInternalId: bill.internalId,
        billDocumentNumber: bill.documentNumber,
      })
      return
    }

    setIsApplying(true)
    setActionFeedback(null)

    try {
      setSelectedBillId(bill.internalId)
      const result = await applyEgresoExactCredit(bill.internalId, {
        creditInternalId: candidate.internalId,
      })
      setActionFeedback({
        tone: 'success',
        title: 'Vendor credit exacto aplicado',
        message: result.message,
        billInternalId: result.bill.internalId,
        billDocumentNumber: result.bill.documentNumber,
      })
      await refreshConciliation(true, offset)
    } catch (reason) {
      setActionFeedback({
        tone: 'warning',
        title: 'No se pudo aplicar el vendor credit exacto',
        message: parseError(reason),
        billInternalId: bill.internalId,
        billDocumentNumber: bill.documentNumber,
      })
    } finally {
      setIsApplying(false)
    }
  }

  async function handlePrepareExactJournalForBill(bill: EgresoBill) {
    if (bill.operationalCode !== 'E1J' && bill.operationalCode !== 'E1R') {
      return
    }

    const candidate = getPrimaryCandidate(bill)
    if (!candidate || candidate.supportSource !== 'journal') {
      setActionFeedback({
        tone: 'warning',
        title: 'No hay journal exacto operable',
        message: 'La factura seleccionada ya no tiene un journal exacto operable en esta lectura.',
        billInternalId: bill.internalId,
        billDocumentNumber: bill.documentNumber,
      })
      return
    }

    setIsPreparingJournal(true)
    setActionFeedback(null)

    try {
      setSelectedBillId(bill.internalId)
      const result = await prepareEgresoExactJournal(bill.internalId, {
        journalInternalId: candidate.internalId,
      })
      setActionFeedback({
        tone: result.existingLinks.billPaymentLinks > 0 || result.existingLinks.journalPaymentLinks > 0
          ? 'warning'
          : 'success',
        title:
          result.existingLinks.billPaymentLinks > 0 || result.existingLinks.journalPaymentLinks > 0
            ? 'Conciliacion iniciada con rastros previos'
            : result.operationalCode === 'E1J'
              ? 'Conciliacion exacta lista para cierre operativo'
              : 'Conciliacion exacta iniciada en revision',
        message: result.message,
        nextStepLabel: result.nextStepLabel,
        nextStepDetail: result.nextStepDetail,
        billInternalId: result.bill.internalId,
        billDocumentNumber: result.bill.documentNumber,
        journalDocumentNumber: result.journal.documentNumber,
        preparedAtUtc: result.preparedAtUtc,
      })
      await refreshConciliation(true, offset)
    } catch (reason) {
      setActionFeedback({
        tone: 'warning',
        title: 'No se pudo preparar el journal exacto',
        message: parseError(reason),
        billInternalId: bill.internalId,
        billDocumentNumber: bill.documentNumber,
        journalDocumentNumber: candidate.documentNumber,
      })
    } finally {
      setIsPreparingJournal(false)
    }
  }

  async function handleReconcileExactSupportForBill(bill: EgresoBill) {
    const candidate = getPrimaryCandidate(bill)
    if (!candidate || bill.operationalCode !== 'E1R') {
      setActionFeedback({
        tone: 'warning',
        title: 'No hay caso E1R disponible',
        message:
          'La factura seleccionada ya no aparece como journal exacto en revision en esta lectura.',
        billInternalId: bill.internalId,
        billDocumentNumber: bill.documentNumber,
      })
      return
    }

    setIsReconcilingExact(true)
    setActionFeedback(null)

    try {
      setSelectedBillId(bill.internalId)
      const result = await reconcileEgresoExactSupport(bill.internalId, {
        supportInternalId: candidate.internalId,
      })
      setActionFeedback({
        tone: 'success',
        title: 'Caso E1R conciliado',
        message: result.message,
        billInternalId: result.bill.internalId,
        billDocumentNumber: result.bill.documentNumber,
        journalDocumentNumber: result.support.documentNumber,
        preparedAtUtc: result.reconciledAtUtc,
      })
      await refreshConciliation(true, offset)
    } catch (reason) {
      setActionFeedback({
        tone: 'warning',
        title: 'No se pudo conciliar el caso E1R',
        message: parseError(reason),
        billInternalId: bill.internalId,
        billDocumentNumber: bill.documentNumber,
        journalDocumentNumber: candidate.documentNumber,
      })
    } finally {
      setIsReconcilingExact(false)
    }
  }

  async function handleStartExactConciliationForBill(bill: EgresoBill) {
    const candidate = getPrimaryCandidate(bill)
    if (!candidate || bill.statusCode !== 'E1') {
      setActionFeedback({
        tone: 'warning',
        title: 'No hay caso exacto para iniciar',
        message: 'La factura seleccionada ya no aparece como caso exacto en esta lectura.',
        billInternalId: bill.internalId,
        billDocumentNumber: bill.documentNumber,
      })
      return
    }

    if (candidate.matchedDocumentCount > 1 || candidate.supportSource === 'mixed') {
      setActionFeedback({
        tone: 'warning',
        title: 'Caso exacto con combinacion',
        message:
          'La conciliacion exacta existe, pero mezcla o combina varios soportes; conviene revisarla manualmente antes de ejecutar.',
        billInternalId: bill.internalId,
        billDocumentNumber: bill.documentNumber,
      })
      return
    }

    if (bill.conciliation.actionCode === 'apply-credit') {
      setIsApplying(true)
      setActionFeedback(null)

      try {
        setSelectedBillId(bill.internalId)
        const result = await applyEgresoExactCredit(bill.internalId, {
          creditInternalId: candidate.internalId,
          dryRun: true,
        })
        setActionFeedback({
          tone: 'success',
          title: 'Conciliacion exacta iniciada',
          message: result.message,
          nextStepLabel: 'Confirmar aplicacion',
          nextStepDetail:
            'Si este dry run sigue cuadrando, el siguiente paso es confirmar la aplicacion real del vendor credit exacto.',
          billInternalId: result.bill.internalId,
          billDocumentNumber: result.bill.documentNumber,
          preparedAtUtc: result.appliedAtUtc,
        })
      } catch (reason) {
        setActionFeedback({
          tone: 'warning',
          title: 'No se pudo iniciar la conciliacion exacta',
          message: parseError(reason),
          billInternalId: bill.internalId,
          billDocumentNumber: bill.documentNumber,
        })
      } finally {
        setIsApplying(false)
      }

      return
    }

    if (candidate.supportSource === 'journal') {
      if (bill.operationalCode === 'E1R') {
        await handleReconcileExactSupportForBill(bill)
        return
      }

      await handlePrepareExactJournalForBill(bill)
      return
    }

    setActionFeedback({
      tone: 'warning',
      title: 'Caso exacto no operable todavia',
      message:
        'La factura esta cuadrada, pero el soporte principal no tiene todavia un flujo operativo automatico definido.',
      billInternalId: bill.internalId,
      billDocumentNumber: bill.documentNumber,
    })
  }

  async function handleStartConciliation() {
    setActionFeedback(null)

    let targetBill = firstVisibleExactBill

    if (!targetBill) {
      const overview =
        exactReadyOverview ?? (await loadExactReadyOverview(true))
      const firstExactOffset = overview?.firstExactSupportOffset
      if (firstExactOffset !== null && firstExactOffset !== undefined) {
        const response = await loadEgresos(firstExactOffset, true)
        targetBill = response?.bills.find((bill) => bill.statusCode === 'E1') ?? null
      }
    }

    if (!targetBill) {
      setActionFeedback({
        tone: 'warning',
        title: 'No hay casos exactos visibles',
        message:
          'Hoy no encontré una factura exacta disponible para iniciar conciliación en la lectura actual.',
      })
      return
    }

    setSelectedBillId(targetBill.internalId)
    await handleStartExactConciliationForBill(targetBill)
  }

  async function jumpToFirstExactReady() {
    if (
      exactReadyOverview?.firstExactSupportOffset === null ||
      exactReadyOverview?.firstExactSupportOffset === undefined
    ) {
      return
    }

    setActionFeedback(null)
    await loadEgresos(exactReadyOverview.firstExactSupportOffset, true)
  }

  async function jumpToFirstJournalReady() {
    if (
      exactReadyOverview?.firstJournalReadyOffset === null ||
      exactReadyOverview?.firstJournalReadyOffset === undefined
    ) {
      return
    }

    setActionFeedback(null)
    await loadEgresos(exactReadyOverview.firstJournalReadyOffset, true)
  }

  return (
    <div className="row g-4">
      <div className="col-12 egresos-layout-block egresos-layout-block--hero">
        <div className="surface-card card">
          <div className="card-body">
            <div className="analysis-toolbar">
              <div>
                <div className="eyebrow">Egresos</div>
                <h2 className="h3 mb-3">Conciliacion de cuentas por pagar</h2>
                <p className="text-secondary mb-0">
                  Esta vista queda enfocada solo en conciliacion: factura, todos los
                  soportes aplicables, diferencia, cruce de periodo y siguiente accion.
                </p>
              </div>

              <div className="analysis-toolbar__actions">
                <div className="lab-sync">
                  {egresosState?.generatedAtUtc
                    ? `Ultima lectura: ${formatDateTime(egresosState.generatedAtUtc)}`
                    : 'Sin lectura exitosa todavia'}
                </div>
                <div className="small text-secondary">
                  {egresosState
                    ? `Origen: ${egresosState.dataSource === 'netsuite' ? 'NetSuite live' : 'Muestra semilla'}`
                    : 'Origen pendiente'}
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() =>
                    navigate(detailOnly ? '/egresos' : '/egresos/detalleconciliacion', {
                      state: {
                        selectedBillId: selectedBill?.internalId ?? null,
                        offset,
                      } satisfies EgresosNavigationState,
                    })
                  }
                >
                  {detailOnly ? 'Volver a la cola' : 'Detalle de conciliacion'}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    void refreshConciliation(true, offset)
                  }}
                  disabled={isRefreshing}
                >
                  {isRefreshing ? 'Actualizando...' : 'Refrescar conciliacion'}
                </button>
              </div>
            </div>

            {error ? <div className="alert alert-warning mt-3 mb-0">{error}</div> : null}

            <div className="note-strip note-strip--accent mt-4">
              {egresosState?.sourceMessage ??
                'La lectura muestra facturas abiertas y todos sus soportes aplicables para conciliar.'}
            </div>

            {exactReadyOverview ? (
              <div className="note-strip note-strip--accent mt-3">
                {exactReadyOverview.exactSupportCount > 0
                  ? exactReadyOverview.exactReadyCount === 0 &&
                    exactReadyOverview.journalReadyCount === 0
                    ? `Se revisaron ${formatInteger(exactReadyOverview.reviewedBills)} facturas abiertas. Hoy hay ${formatInteger(exactReadyOverview.exactSupportCount)} caso(s) exactos en revision (E1R) y ningun cierre directo u operable todavia.`
                    : `Se revisaron ${formatInteger(exactReadyOverview.reviewedBills)} facturas abiertas. Hay ${formatInteger(exactReadyOverview.exactSupportCount)} caso(s) exactos, ${formatInteger(exactReadyOverview.exactReadyCount)} aplicable(s) directo(s) y ${formatInteger(exactReadyOverview.journalReadyCount)} journal(es) exactos operable(s).`
                  : `Se revisaron ${formatInteger(exactReadyOverview.reviewedBills)} facturas abiertas y hoy no hay casos exactos detectados.`}
                {exactReadyOverview.firstExactSupportOffset !== null &&
                exactReadyOverview.firstExactSupportOffset !== offset ? (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => void jumpToFirstExactReady()}
                      disabled={isRefreshing}
                    >
                      Ir a la primera exacta
                    </button>
                  </>
                ) : null}
                {exactReadyOverview.firstJournalReadyOffset !== null &&
                exactReadyOverview.firstJournalReadyOffset !== offset ? (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => void jumpToFirstJournalReady()}
                      disabled={isRefreshing}
                    >
                      Ir al primer journal operable
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {queueMetrics.map((metric) => (
        <ConciliationMetricCard
          key={metric.label}
          className="egresos-layout-block egresos-layout-block--metrics"
          label={metric.label}
          value={metric.value}
          caption={metric.caption}
        />
      ))}

      {detailOnly ? (
        <div className="col-12 egresos-layout-block egresos-layout-block--detail">
          <div className="surface-card card">
            <div className="card-body">
              <div className="analysis-card__header">
                <div>
                  <div className="eyebrow">Detalle de conciliacion</div>
                  <h3 className="h4 mb-2">
                    {selectedBill?.documentNumber ?? 'Sin factura seleccionada'}
                  </h3>
                  <p className="text-secondary mb-0">
                    Selecciona una factura para ver como esta cuadrando contra su
                    mejor soporte o combinacion candidata.
                  </p>
                </div>

                {selectedBill ? (
                  <div className={`status-pill status-pill--${selectedBill.statusTone}`}>
                    {resolveVisibleStatusCode(selectedBill)}
                  </div>
                ) : null}
              </div>

              {selectedBill ? (
                <>
                  <div className="control-inline mt-3">
                    {selectedBill.conciliation.actionCode === 'apply-credit' ? (
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => void handleApplyExactCredit()}
                        disabled={isApplying || isRefreshing}
                      >
                        {isApplying ? 'Aplicando...' : 'Aplicar vendor credit exacto'}
                      </button>
                    ) : (
                      <span className={`status-pill status-pill--${selectedBill.statusTone}`}>
                        {selectedBill.conciliation.actionLabel}
                      </span>
                    )}
                  </div>

                  {selectedBill.operationalCode === 'E1R' ? (
                    <div className="note-strip note-strip--accent mt-3">
                      Este journal exacto hoy queda como conciliacion cuadrada en
                      revision. No se propone aplicacion directa desde la vista
                      principal mientras no exista un cierre operativo definido.
                    </div>
                  ) : null}

                  {actionFeedback ? renderActionFeedback(actionFeedback) : null}

                  <div className="row g-3 mt-1">
                    <div className="col-md-6 col-xl-3">
                      <div className="metric-tile">
                        <span>Proveedor</span>
                        <strong>{selectedBill.supplierName ?? '--'}</strong>
                      </div>
                    </div>

                    <div className="col-md-6 col-xl-3">
                      <div className="metric-tile">
                        <span>Saldo abierto</span>
                        <strong>
                          {formatMoneyLike(selectedBill.openAmount, selectedBill.currency)}
                        </strong>
                      </div>
                    </div>

                    <div className="col-md-6 col-xl-3">
                      <div className="metric-tile">
                        <span>Soporte principal</span>
                        <strong>{formatCandidateLabel(selectedCandidate)}</strong>
                      </div>
                    </div>

                    <div className="col-md-6 col-xl-3">
                      <div className="metric-tile">
                        <span>Diferencia visible</span>
                        <strong>
                          {formatMoneyLike(
                            getRemainingCoverageGap(selectedBill),
                            selectedBill.currency,
                          )}
                        </strong>
                      </div>
                    </div>
                  </div>

                  <div className="summary-list mt-4">
                    <div className="summary-list__item">
                      <span>Resultado</span>
                      <strong>
                        {resolveVisibleStatusCode(selectedBill)} | {resolveVisibleStatusLabel(selectedBill)}
                      </strong>
                    </div>
                    <div className="summary-list__item">
                      <span>Cuenta AP factura</span>
                      <strong>
                        {formatPayableAccountLabel(
                          selectedBill.payableAccountNumber,
                          selectedBill.payableAccountName,
                        )}
                      </strong>
                    </div>
                    <div className="summary-list__item">
                      <span>Periodo factura</span>
                      <strong>{selectedBill.postingPeriodName ?? '--'}</strong>
                    </div>
                    <div className="summary-list__item">
                      <span>Cuenta AP soporte</span>
                      <strong>
                        {formatPayableAccountLabel(
                          selectedCandidate?.payableAccountNumber ?? null,
                          selectedCandidate?.payableAccountName ?? null,
                        )}
                      </strong>
                    </div>
                    <div className="summary-list__item">
                      <span>Periodo soporte</span>
                      <strong>{selectedCandidate?.postingPeriodName ?? '--'}</strong>
                    </div>
                    <div className="summary-list__item">
                      <span>Siguiente accion</span>
                      <strong>{selectedBill.conciliation.actionLabel}</strong>
                    </div>
                    <div className="summary-list__item">
                      <span>Detalle accion</span>
                      <strong>{selectedBill.conciliation.actionDetail}</strong>
                    </div>
                  </div>

                  <div className="transaction-summary mt-4">
                    {selectedChecks.map((check) => (
                      <div key={check.id} className="transaction-summary__row">
                        <div className="transaction-summary__copy">
                          <strong>
                            {check.label} | {check.value}
                          </strong>
                          <span>{check.detail}</span>
                        </div>

                        <div className="transaction-summary__meta">
                          <span className={`status-pill status-pill--${check.tone}`}>
                            {check.label}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="eyebrow mt-4">Soportes candidatos</div>
                  <div className="transaction-summary mt-3">
                    {selectedBill.creditCandidates.length > 0 ? (
                      selectedBill.creditCandidates.map((candidate) => (
                        <div key={candidate.internalId} className="transaction-summary__row">
                          <div className="transaction-summary__copy">
                            <strong>
                              {candidate.transactionType} |{' '}
                              {candidate.documentNumber ?? candidate.internalId}
                            </strong>
                            <span>{candidate.reason}</span>
                          </div>

                          <div className="transaction-summary__meta">
                            <span className="small text-secondary">
                              {formatDate(candidate.transactionDate)} |{' '}
                              {candidate.postingPeriodName ?? '--'} |{' '}
                              {candidate.currency ?? '--'} |{' '}
                              {candidate.payableAccountNumber ?? '--'}
                            </span>
                            <span className="transaction-summary__count">
                              {formatMoneyLike(candidate.availableAmount, candidate.currency)}
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-secondary">
                        No se detectaron soportes candidatos en la lectura actual.
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-secondary mt-3">
                  {hasActiveFilters
                    ? 'Los filtros actuales no dejan una factura visible en esta pagina.'
                    : 'Todavia no hay una factura disponible para conciliar en esta vista.'}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div className="col-12 egresos-layout-block egresos-layout-block--queue">
        <div className="surface-card card analysis-card">
          <div className="card-body">
            <div className="analysis-card__header">
              <div>
                <div className="eyebrow">
                  {detailOnly ? 'Selector de factura' : 'Cola de conciliacion'}
                </div>
                <h3 className="h4 mb-2">
                  {detailOnly
                    ? 'Selecciona la factura para revisar el detalle'
                    : 'Facturas abiertas y soportes aplicables'}
                </h3>
                <p className="text-secondary mb-0">
                  {detailOnly
                    ? 'La tabla sirve como selector para abrir otra factura dentro del detalle de conciliacion.'
                    : 'La tabla queda reducida a lo necesario para decidir si una factura ya cuadra, tiene diferencia o se va a revision.'}
                </p>
              </div>

              <div className="analysis-card__summary">{conciliationSummary}</div>

              <div className="analysis-card__meta">
                <span className="status-pill status-pill--healthy">
                  {egresosState
                    ? `Rows filtradas ${filteredBills.length} / pagina ${egresosState.page.count}`
                    : 'Waiting'}
                </span>
                <div className="small text-secondary">
                  {egresosState
                    ? `Offset ${egresosState.page.offset} | Total ${egresosState.page.totalResults}`
                    : 'Sin lectura cargada'}
                </div>
              </div>
            </div>

            <div className="row g-3 mt-3">
              <div className="col-lg-5">
                <label className="form-label small text-secondary mb-1" htmlFor="egresos-search">
                  Buscar
                </label>
                <input
                  id="egresos-search"
                  type="text"
                  className="form-control"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Factura, proveedor o soporte"
                />
              </div>

              <div className="col-md-4 col-lg-2">
                <label className="form-label small text-secondary mb-1" htmlFor="egresos-status-filter">
                  Regla
                </label>
                <select
                  id="egresos-status-filter"
                  className="form-select"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as EgresoStatusFilter)}
                >
                  <option value="all">Todas</option>
                  {statusOptions.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.code} | {option.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-md-4 col-lg-2">
                <label className="form-label small text-secondary mb-1" htmlFor="egresos-conciliation-filter">
                  Conciliacion
                </label>
                <select
                  id="egresos-conciliation-filter"
                  className="form-select"
                  value={conciliationFilter}
                  onChange={(event) =>
                    setConciliationFilter(event.target.value as EgresoConciliationFilter)
                  }
                >
                  <option value="all">Todas</option>
                  <option value="exact">Cuadradas</option>
                  <option value="with-gap">Con diferencia</option>
                  <option value="cross-period">Cruce de periodo</option>
                  <option value="without-support">Sin soporte</option>
                </select>
              </div>

              <div className="col-md-4 col-lg-3">
                <label className="form-label small text-secondary mb-1" htmlFor="egresos-due-filter">
                  Vencimiento
                </label>
                <select
                  id="egresos-due-filter"
                  className="form-select"
                  value={dueFilter}
                  onChange={(event) => setDueFilter(event.target.value as EgresoDueFilter)}
                >
                  <option value="all">Todos</option>
                  <option value="vencida">Vencidas</option>
                  <option value="vigente">Vigentes</option>
                </select>
              </div>
            </div>

            <div className="control-inline mt-3">
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setSearchTerm('')
                  setStatusFilter('all')
                  setDueFilter('all')
                  setConciliationFilter('all')
                }}
                disabled={!hasActiveFilters}
              >
                Limpiar filtros
              </button>
            </div>

            <div className="small text-secondary mt-2">
              {detailOnly
                ? 'Haz click en la factura para cambiar el detalle actual.'
                : 'Haz click en la factura para abrir su detalle de conciliacion.'}
            </div>

            {!detailOnly ? (
              <div className="conciliation-action-bar mt-3">
                <div>
                  <div className="eyebrow">Proceso de conciliacion</div>
                  <strong>
                    {conciliationActionContext.objective}
                  </strong>
                  <div className="small text-secondary mt-1">
                    {conciliationActionContext.detail}
                  </div>
                </div>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void handleStartConciliation()}
                  disabled={
                    isApplying ||
                    isPreparingJournal ||
                    isReconcilingExact ||
                    isRefreshing ||
                    conciliationActionContext.disabled
                  }
                >
                  {isApplying || isPreparingJournal || isReconcilingExact
                    ? 'Procesando...'
                    : conciliationActionContext.buttonLabel}
                </button>
              </div>
            ) : null}

            {!detailOnly && actionFeedback ? (
              <div
                className={`alert ${
                  actionFeedback?.tone === 'warning'
                    ? 'alert-warning'
                    : actionFeedback?.tone === 'success'
                      ? 'alert-success'
                      : 'alert-secondary'
                } mt-3 mb-0`}
                role="alert"
              >
                <div className="fw-semibold">{actionFeedback.title}</div>
                <div>{actionFeedback.message}</div>
                {actionFeedback.nextStepLabel || actionFeedback.nextStepDetail ? (
                  <div className="small mt-2">
                    {actionFeedback.nextStepLabel ? (
                      <strong>{`Siguiente paso: ${actionFeedback.nextStepLabel}. `}</strong>
                    ) : null}
                    {actionFeedback.nextStepDetail ?? null}
                  </div>
                ) : null}
                {actionFeedback.billDocumentNumber ||
                actionFeedback.journalDocumentNumber ||
                actionFeedback.preparedAtUtc ? (
                  <div className="small mt-2">
                    {actionFeedback.billDocumentNumber
                      ? `Factura ${actionFeedback.billDocumentNumber}`
                      : null}
                    {actionFeedback.billDocumentNumber &&
                    actionFeedback.journalDocumentNumber
                      ? ' | '
                      : null}
                    {actionFeedback.journalDocumentNumber
                      ? `Soporte ${actionFeedback.journalDocumentNumber}`
                      : null}
                    {(actionFeedback.billDocumentNumber ||
                      actionFeedback.journalDocumentNumber) &&
                    actionFeedback.preparedAtUtc
                      ? ' | '
                      : null}
                    {actionFeedback.preparedAtUtc
                      ? `Actualizado ${formatDateTime(actionFeedback.preparedAtUtc)}`
                      : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="table-responsive analysis-table mt-3">
              <table className="table align-middle mb-0">
                <thead>
                  <tr>
                    <th>Factura</th>
                    <th>Codigo</th>
                    <th>Proveedor</th>
                    <th>Vence</th>
                    <th>Saldo abierto</th>
                    <th>Diferencia</th>
                    <th>Periodo</th>
                    <th>Cuenta AP</th>
                    <th>Soporte</th>
                    <th>Cobertura</th>
                    <th>Accion</th>
                    <th>Definicion</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBills.length > 0 ? (
                    filteredBills.map((bill) => {
                      const candidate = getPrimaryCandidate(bill)
                      return (
                        <tr
                          key={bill.internalId}
                          className={
                            bill.internalId === selectedBill?.internalId
                              ? 'analysis-row--spotlight'
                              : undefined
                          }
                        >
                          <td>
                            <div className="search-result-heading">
                              <button
                                type="button"
                                className="btn btn-link p-0 text-start fw-semibold"
                                onClick={() => {
                                  setActionFeedback(null)
                                  if (detailOnly) {
                                    setSelectedBillId(bill.internalId)
                                    return
                                  }

                                  navigate('/egresos/detalleconciliacion', {
                                    state: {
                                      selectedBillId: bill.internalId,
                                      offset,
                                    } satisfies EgresosNavigationState,
                                  })
                                }}
                              >
                                {bill.documentNumber}
                              </button>
                              <span>{bill.transactionNumber ?? bill.internalId}</span>
                            </div>
                          </td>
                          <td>
                            <span className={`status-pill status-pill--${bill.statusTone}`}>
                              {resolveVisibleStatusCode(bill)}
                            </span>
                          </td>
                          <td>{bill.supplierName ?? '--'}</td>
                          <td>
                            <span className={dueStatusClass(bill)}>{formatDate(bill.dueDate)}</span>
                          </td>
                          <td>{formatMoneyLike(bill.openAmount, bill.currency)}</td>
                          <td>
                            <span className={`status-pill status-pill--${getDifferenceTone(bill)}`}>
                              {formatMoneyLike(getRemainingCoverageGap(bill), bill.currency)}
                            </span>
                          </td>
                          <td>
                            <div className="invoice-raw-meta">
                              <strong>{bill.postingPeriodName ?? '--'}</strong>
                              <span>{bill.conciliation.samePeriod ? 'Mismo periodo' : candidate ? 'Cruza periodo' : '--'}</span>
                            </div>
                          </td>
                          <td>
                            <div className="invoice-raw-meta">
                              <strong>{bill.payableAccountNumber ?? '--'}</strong>
                              <span>{bill.payableAccountName ?? '--'}</span>
                            </div>
                          </td>
                          <td>
                            <div className="invoice-raw-meta">
                              <strong>{formatCandidateLabel(candidate)}</strong>
                              <span>{candidate?.currency ?? bill.currency ?? '--'}</span>
                            </div>
                          </td>
                          <td>{formatMoneyLike(bill.availableCoverageAmount, bill.currency)}</td>
                          <td>
                            <div className="invoice-raw-meta">
                              <strong>{bill.conciliation.actionLabel}</strong>
                              <span>{bill.conciliation.actionDetail}</span>
                            </div>
                          </td>
                          <td>
                            <strong>{resolveVisibleStatusLabel(bill)}</strong>
                          </td>
                        </tr>
                      )
                    })
                  ) : (
                    <tr>
                      <td colSpan={12} className="text-secondary">
                        {isRefreshing
                          ? 'Consultando conciliacion...'
                          : pageBills.length > 0
                            ? 'No hay facturas que coincidan con los filtros activos en esta pagina.'
                            : 'Todavia no hay facturas cargadas para esta vista.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="control-inline mt-3">
              <button
                type="button"
                className="ghost-button"
                onClick={() => void loadEgresos(Math.max(0, offset - PAGE_LIMIT))}
                disabled={isRefreshing || offset === 0}
              >
                Anterior
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => void loadEgresos(offset + PAGE_LIMIT)}
                disabled={isRefreshing || !egresosState?.page.hasMore}
              >
                Siguiente
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ConciliationMetricCard(
  props: ConciliationMetric & {
    className?: string
  },
) {
  return (
    <div className={`col-md-6 col-xl-3 ${props.className ?? ''}`.trim()}>
      <div className="surface-card card">
        <div className="card-body">
          <div className="eyebrow">{props.label}</div>
          <div className="metric-value">{props.value}</div>
          <p className="metric-caption mt-2">{props.caption}</p>
        </div>
      </div>
    </div>
  )
}

function renderActionFeedback(feedback: ActionFeedbackState) {
  return (
    <div
      className={`alert ${feedback.tone === 'success' ? 'alert-success' : 'alert-warning'} mt-3 mb-0`}
      role="alert"
    >
      <div className="fw-semibold">{feedback.title}</div>
      <div>{feedback.message}</div>
      {feedback.billDocumentNumber || feedback.journalDocumentNumber || feedback.preparedAtUtc ? (
        <div className="small mt-2">
          {feedback.billDocumentNumber ? `Factura ${feedback.billDocumentNumber}` : null}
          {feedback.billDocumentNumber && feedback.journalDocumentNumber ? ' | ' : null}
          {feedback.journalDocumentNumber ? `Soporte ${feedback.journalDocumentNumber}` : null}
          {(feedback.billDocumentNumber || feedback.journalDocumentNumber) &&
          feedback.preparedAtUtc
            ? ' | '
            : null}
          {feedback.preparedAtUtc
            ? `Actualizado ${formatDateTime(feedback.preparedAtUtc)}`
            : null}
        </div>
      ) : null}
    </div>
  )
}

function buildConciliationMetrics(bills: EgresoBill[]): ConciliationMetric[] {
  const exactCount = bills.filter((bill) => bill.conciliation.lane === 'exact').length
  const withGapCount = bills.filter((bill) => {
    const lane = bill.conciliation.lane
    return lane === 'with-gap' || lane === 'cross-period'
  }).length
  const withoutSupportCount = bills.filter(
    (bill) => bill.conciliation.lane === 'without-support',
  ).length

  return [
    {
      label: 'En cola',
      value: formatInteger(bills.length),
      caption: 'Facturas visibles en la pagina actual.',
    },
    {
      label: 'Cuadradas',
      value: formatInteger(exactCount),
      caption: 'Facturas que ya tienen soporte exacto.',
    },
    {
      label: 'Con diferencia',
      value: formatInteger(withGapCount),
      caption: 'Casos con remanente o cruce de periodo.',
    },
    {
      label: 'Sin soporte',
      value: formatInteger(withoutSupportCount),
      caption: 'Facturas que siguen sin cobertura util.',
    },
  ]
}

function buildConciliationSummary(bills: EgresoBill[]) {
  const exactCount = bills.filter((bill) => bill.conciliation.lane === 'exact').length
  const crossPeriodCount = bills.filter(
    (bill) => bill.conciliation.lane === 'cross-period',
  ).length
  const withoutSupportCount = bills.filter(
    (bill) => bill.conciliation.lane === 'without-support',
  ).length
  const withGapCount = bills.filter((bill) => bill.conciliation.lane === 'with-gap').length

  return `Cuadradas ${formatInteger(exactCount)} | Con diferencia ${formatInteger(withGapCount)} | Cruce ${formatInteger(crossPeriodCount)} | Sin soporte ${formatInteger(withoutSupportCount)}`
}

function buildConciliationChecks(bill: EgresoBill): ConciliationCheck[] {
  const candidate = getPrimaryCandidate(bill)
  const remainingGap = getRemainingCoverageGap(bill)

  return [
    {
      id: 'support',
      label: 'Soporte',
      value: formatCandidateLabel(candidate),
      detail: candidate
        ? candidate.reason
        : 'No hay un soporte candidato visible para esta factura en la lectura actual.',
      tone: candidate
        ? candidate.sameCurrency && candidate.sameAccount
          ? 'ready'
          : 'review'
        : 'exception',
    },
    {
      id: 'amount',
      label: 'Importe',
      value: resolveAmountCheckValue(candidate, bill),
      detail: candidate
        ? bill.conciliation.exactAmountMatch
          ? 'El monto del soporte empata contra el saldo abierto.'
          : `La diferencia visible es ${formatMoneyLike(remainingGap, bill.currency)}.`
        : 'Sin soporte no hay monto que cuadrar todavia.',
      tone: candidate
        ? bill.conciliation.exactAmountMatch && bill.conciliation.sameAccount === true
          ? 'ready'
          : 'review'
        : 'exception',
    },
    {
      id: 'period',
      label: 'Periodo',
      value: candidate
        ? candidate.samePeriod
          ? 'Mismo periodo'
          : 'Cruce de periodo'
        : bill.postingPeriodName ?? '--',
      detail: candidate
        ? candidate.samePeriod
          ? `Factura y soporte viven en ${bill.postingPeriodName ?? 'el mismo periodo'}.`
          : `La factura vive en ${bill.postingPeriodName ?? '--'} y el soporte en ${candidate.postingPeriodName ?? '--'}.`
        : 'Todavia no hay soporte candidato para validar cruce contable.',
      tone: candidate
        ? candidate.samePeriod
          ? 'ready'
          : 'period-review'
        : 'review',
    },
    {
      id: 'account',
      label: 'Cuenta AP',
      value: candidate
        ? candidate.sameAccount
          ? 'Misma cuenta'
          : 'Cuenta distinta'
        : formatPayableAccountLabel(
            bill.payableAccountNumber,
            bill.payableAccountName,
          ),
      detail: candidate
        ? candidate.sameAccount
          ? `Factura y soporte viven en ${formatPayableAccountLabel(bill.payableAccountNumber, bill.payableAccountName)}.`
          : `La factura vive en ${formatPayableAccountLabel(bill.payableAccountNumber, bill.payableAccountName)} y el soporte en ${formatPayableAccountLabel(candidate.payableAccountNumber, candidate.payableAccountName)}.`
        : 'Todavia no hay soporte candidato para validar la cuenta AP.',
      tone: candidate
        ? candidate.sameAccount
          ? 'ready'
          : 'exception'
        : 'review',
    },
    {
      id: 'resultado',
      label: 'Accion',
      value: `${resolveVisibleStatusCode(bill)} | ${resolveVisibleStatusLabel(bill)}`,
      detail: bill.operationalReason ?? bill.statusReason ?? bill.conciliation.actionDetail,
      tone: bill.statusTone,
    },
  ]
}

function hasDetectedSupport(bill: EgresoBill) {
  return bill.conciliation.hasSupport
}

function getPrimaryCandidate(bill: EgresoBill | null) {
  return bill?.creditCandidates[0] ?? null
}

function resolveConciliationActionContext(options: {
  firstVisibleExactBill: EgresoBill | null
  firstVisibleDirectApplyBill: EgresoBill | null
  firstVisibleJournalReadyBill: EgresoBill | null
  firstVisibleReviewExactBill: EgresoBill | null
  exactReadyOverview: ExactReadyOverviewState
  isOverviewLoading: boolean
}): ConciliationActionContext {
  if (options.firstVisibleDirectApplyBill) {
    return {
      objective: `Objetivo actual: ${options.firstVisibleDirectApplyBill.documentNumber} | ${options.firstVisibleDirectApplyBill.supplierName ?? '--'} | E1C`,
      detail: 'La primera exacta visible ya trae vendor credit aplicable directo.',
      buttonLabel: 'Iniciar E1C',
      disabled: false,
    }
  }

  if (options.firstVisibleJournalReadyBill) {
    return {
      objective: `Objetivo actual: ${options.firstVisibleJournalReadyBill.documentNumber} | ${options.firstVisibleJournalReadyBill.supplierName ?? '--'} | E1J`,
      detail: 'La primera exacta visible ya expone un journal operable para preparar cierre.',
      buttonLabel: 'Preparar E1J',
      disabled: false,
    }
  }

  if (options.firstVisibleReviewExactBill) {
    return {
      objective: `Objetivo actual: ${options.firstVisibleReviewExactBill.documentNumber} | ${options.firstVisibleReviewExactBill.supplierName ?? '--'} | E1R`,
      detail: 'La primera exacta visible ya tiene soporte individual exacto; este boton la concilia y la saca de la cola activa.',
      buttonLabel: 'Conciliar E1R',
      disabled: false,
    }
  }

  if (options.firstVisibleExactBill) {
    return {
      objective: `Objetivo actual: ${options.firstVisibleExactBill.documentNumber} | ${options.firstVisibleExactBill.supplierName ?? '--'} | ${resolveVisibleStatusCode(options.firstVisibleExactBill)}`,
      detail: 'La primera exacta visible ya puede arrancar el siguiente paso disponible desde esta misma cola.',
      buttonLabel: `Iniciar ${resolveVisibleStatusCode(options.firstVisibleExactBill)}`,
      disabled: false,
    }
  }

  if (options.exactReadyOverview?.exactReadyCount) {
    return {
      objective: `Primer E1C fuera de esta pagina: ${options.exactReadyOverview.firstExactBillDocumentNumber ?? '--'}`,
      detail: 'Al dar clic iremos a la primera exacta aplicable y arrancaremos ese flujo.',
      buttonLabel: 'Ir al primer E1C',
      disabled: false,
    }
  }

  if (options.exactReadyOverview?.journalReadyCount) {
    return {
      objective: `Primer E1J fuera de esta pagina: ${options.exactReadyOverview.firstJournalReadyBillDocumentNumber ?? '--'}`,
      detail: 'Al dar clic iremos al primer journal exacto operable y arrancaremos ese flujo.',
      buttonLabel: 'Ir al primer E1J',
      disabled: false,
    }
  }

  if (options.exactReadyOverview?.exactSupportCount) {
    return {
      objective: `Primer E1R fuera de esta pagina: ${options.exactReadyOverview.firstExactSupportBillDocumentNumber ?? '--'}`,
      detail: 'Al dar clic iremos al primer exacto en revision para conciliarlo desde la cola activa.',
      buttonLabel: 'Ir al primer E1R',
      disabled: false,
    }
  }

  if (options.isOverviewLoading) {
    return {
      objective: 'Buscando casos exactos fuera de esta pagina',
      detail: 'La lectura global sigue corriendo para detectar si hay un E1R, E1J o E1C disponible.',
      buttonLabel: 'Buscando E1R...',
      disabled: true,
    }
  }

  return {
    objective: 'No hay exactas visibles en esta pagina',
    detail: 'Este boton va a buscar el primer caso exacto del universo y, si hoy lo que existe es revision, arrancara el primer E1R.',
    buttonLabel: 'Buscar primer E1R',
    disabled: false,
  }
}

function matchesTextFilter(bill: EgresoBill, normalizedSearch: string) {
  const searchableValues = [
    bill.documentNumber,
    bill.transactionNumber,
    bill.supplierName,
    bill.postingPeriodName,
    bill.currency,
    bill.payableAccountNumber,
    bill.payableAccountName,
    resolveVisibleStatusCode(bill),
    resolveVisibleStatusLabel(bill),
    bill.operationalReason,
    bill.statusLabel,
    bill.statusReason,
    bill.conciliation.laneLabel,
    bill.conciliation.actionLabel,
    bill.conciliation.actionDetail,
    ...bill.creditCandidates.flatMap((candidate) => [
      candidate.documentNumber,
      candidate.transactionType,
      candidate.reason,
      candidate.postingPeriodName,
      candidate.currency,
      candidate.payableAccountNumber,
      candidate.payableAccountName,
    ]),
  ]

  return searchableValues
    .filter((value): value is string => Boolean(value))
    .some((value) => normalizeSearchValue(value).includes(normalizedSearch))
}

function normalizeSearchValue(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

function dueStatusClass(bill: EgresoBill) {
  return bill.dueStatus === 'vencida'
    ? 'status-pill status-pill--error'
    : 'status-pill status-pill--ready'
}

function getDifferenceTone(bill: EgresoBill): ConciliationTone {
  if (!hasDetectedSupport(bill)) {
    return 'exception'
  }

  if (bill.conciliation.exactAmountMatch && bill.conciliation.sameAccount === true) {
    return 'ready'
  }

  return bill.conciliation.lane === 'cross-period' ? 'period-review' : 'review'
}

function formatCandidateLabel(candidate: EgresoBill['creditCandidates'][number] | null) {
  if (!candidate) {
    return 'Sin soporte detectado'
  }

  if (candidate.matchedDocumentCount > 1) {
    return `${candidate.transactionType} | ${candidate.documentNumber ?? `${candidate.matchedDocumentCount} docs`}`
  }

  return `${candidate.transactionType} ${candidate.documentNumber ?? '--'}`
}

function formatPayableAccountLabel(
  accountNumber: string | null,
  accountName: string | null,
) {
  if (accountNumber && accountName) {
    return `${accountNumber} | ${accountName}`
  }

  return accountNumber ?? accountName ?? '--'
}

function resolveAmountCheckValue(
  candidate: EgresoBill['creditCandidates'][number] | null,
  bill: EgresoBill,
) {
  if (!candidate) {
    return 'Sin soporte'
  }

  if (bill.conciliation.exactAmountMatch) {
    return bill.conciliation.sameAccount === true ? 'Cuadra exacto' : 'Monto exacto'
  }

  return formatMoneyLike(getRemainingCoverageGap(bill), bill.currency)
}

function getRemainingCoverageGap(bill: EgresoBill) {
  return bill.conciliation.amountDelta
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

  const dueDateComparison = getDateSortValue(left.dueDate) - getDateSortValue(right.dueDate)
  if (dueDateComparison !== 0) {
    return dueDateComparison
  }

  return left.documentNumber.localeCompare(right.documentNumber, 'es')
}

function resolveVisibleStatusCode(bill: EgresoBill) {
  return bill.operationalCode ?? bill.statusCode
}

function resolveVisibleStatusLabel(bill: EgresoBill) {
  return bill.operationalLabel ?? bill.statusLabel
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

function getDateSortValue(value: string | null) {
  if (!value) {
    return Number.MAX_SAFE_INTEGER
  }

  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value)

  return Number.isNaN(parsed.getTime()) ? Number.MAX_SAFE_INTEGER : parsed.getTime()
}

function formatDate(value: string | null) {
  if (!value) {
    return '--'
  }

  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('es-MX', {
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

  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

function formatInteger(value: number | null | undefined) {
  if (typeof value !== 'number') {
    return '--'
  }

  return new Intl.NumberFormat('es-MX', {
    maximumFractionDigits: 0,
  }).format(value)
}

function formatMoneyLike(value: number | null | undefined, currency: string | null) {
  if (typeof value !== 'number') {
    return '--'
  }

  const amount = new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)

  return currency ? `${amount} ${currency}` : amount
}

function resolveEgresosNavigationState(state: unknown): EgresosNavigationState {
  if (typeof state !== 'object' || state === null) {
    return {
      selectedBillId: null,
      offset: 0,
    }
  }

  const candidate = state as {
    selectedBillId?: unknown
    offset?: unknown
  }

  return {
    selectedBillId:
      typeof candidate.selectedBillId === 'string' && candidate.selectedBillId.trim().length > 0
        ? candidate.selectedBillId
        : null,
    offset:
      typeof candidate.offset === 'number' && Number.isFinite(candidate.offset) && candidate.offset >= 0
        ? candidate.offset
        : 0,
  }
}

function parseError(reason: unknown) {
  if (reason instanceof HttpClientError) {
    const payload = safeParseBody(reason.body)
    return payload?.error ?? reason.message
  }

  if (reason instanceof Error) {
    return reason.message
  }

  return 'No pude cargar la lectura operativa de egresos.'
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
