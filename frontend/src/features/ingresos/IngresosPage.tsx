import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { HttpClientError } from '../../services/api/httpClient'
import {
  applyA1Transactions,
  applyA2Transactions,
  applyA3Transactions,
  applyA4Transactions,
  applyA5Transactions,
  applyA6Transactions,
  applyA7Transactions,
  applyA8Transactions,
  applyB1Transactions,
  applyB2Transactions,
  applyB3Transactions,
  applyN1Transactions,
  applyPpd1Transactions,
  fetchFacturaAdjuntos,
  fetchFacturasAbiertas,
  fetchNetSuiteAuthStatus,
  netsuiteOAuthLoginUrl,
  revokeNetSuiteOAuthSession,
  type FacturaAdjunto,
  type FacturaAdjuntosResponse,
  type Factura,
} from '../../services/api/reconciliationApi'

type FacturasState = Awaited<ReturnType<typeof fetchFacturasAbiertas>> | null
type AuthState = Awaited<ReturnType<typeof fetchNetSuiteAuthStatus>> | null

type OAuthPopupMessage = {
  source?: string
  success?: boolean
  message?: string
}

type ErrorPayload = {
  error?: string
}

type ActivityMessage = {
  tone: 'success' | 'warning'
  text: string
}

type FacturaAdjuntosState =
  | {
      status: 'idle'
    }
  | {
      status: 'loading'
    }
  | {
      status: 'loaded'
      data: FacturaAdjuntosResponse
    }
  | {
      status: 'error'
      error: string
    }

const PAGE_LIMIT = 50

export function IngresosPage() {
  const [facturasState, setFacturasState] = useState<FacturasState>(null)
  const [authStatus, setAuthStatus] = useState<AuthState>(null)
  const [error, setError] = useState<string | null>(null)
  const [activityMessage, setActivityMessage] = useState<ActivityMessage | null>(null)
  const [offset, setOffset] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [isApplyingPpd1, setIsApplyingPpd1] = useState(false)
  const [isApplyingA1, setIsApplyingA1] = useState(false)
  const [isApplyingA2, setIsApplyingA2] = useState(false)
  const [isApplyingA3, setIsApplyingA3] = useState(false)
  const [isApplyingA4, setIsApplyingA4] = useState(false)
  const [isApplyingA5, setIsApplyingA5] = useState(false)
  const [isApplyingA6, setIsApplyingA6] = useState(false)
  const [isApplyingA7, setIsApplyingA7] = useState(false)
  const [isApplyingA8, setIsApplyingA8] = useState(false)
  const [isApplyingB1, setIsApplyingB1] = useState(false)
  const [isApplyingB2, setIsApplyingB2] = useState(false)
  const [isApplyingB3, setIsApplyingB3] = useState(false)
  const [isApplyingN1, setIsApplyingN1] = useState(false)
  const [expandedFacturaAdjuntosId, setExpandedFacturaAdjuntosId] = useState<string | null>(null)
  const [facturaAdjuntosByInvoiceId, setFacturaAdjuntosByInvoiceId] = useState<
    Record<string, FacturaAdjuntosState>
  >({})

  useEffect(() => {
    function handleMessage(event: MessageEvent<OAuthPopupMessage>) {
      if (event.data?.source !== 'netsuite-oauth') {
        return
      }

      if (event.data.success) {
        setError(null)
        setOffset(0)
        void Promise.all([loadAuthStatus(), hardRefreshFacturas(0)])
        return
      }

      setError(event.data.message ?? 'NetSuite OAuth 2.0 was not completed.')
      void loadAuthStatus()
    }

    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [])

  const oauth2 = authStatus?.oauth2
  const facturas = facturasState?.facturas ?? []
  const totalFacturas = facturasState?.page.totalResults ?? 0
  const reconciliableFacturas = facturasState?.page.reconciliableResults ?? totalFacturas
  const deferredCurrentPpdCount = facturasState?.page.deferredCurrentPpdCount ?? 0
  const transactionTypes = facturasState?.summary.transactionTypes ?? []
  const sampledSaldo = facturas.reduce((sum, factura) => sum + (factura.saldoAbierto ?? 0), 0)
  const sampledK = facturas.filter((factura) => factura.situacion.codigo === 'K').length
  const sampledPpd1 = facturas.filter((factura) => factura.situacion.codigo === 'PPD1').length
  const sampledA1 = facturas.filter((factura) => factura.situacion.codigo === 'A1').length
  const sampledA2 = facturas.filter((factura) => factura.situacion.codigo === 'A2').length
  const sampledA3 = facturas.filter((factura) => factura.situacion.codigo === 'A3').length
  const sampledA4 = facturas.filter((factura) => factura.situacion.codigo === 'A4').length
  const sampledA5 = facturas.filter((factura) => factura.situacion.codigo === 'A5').length
  const sampledA6 = facturas.filter((factura) => factura.situacion.codigo === 'A6').length
  const sampledA7 = facturas.filter((factura) => factura.situacion.codigo === 'A7').length
  const sampledA8 = facturas.filter((factura) => factura.situacion.codigo === 'A8').length
  const sampledB1 = facturas.filter((factura) => factura.situacion.codigo === 'B1').length
  const sampledB2 = facturas.filter((factura) => factura.situacion.codigo === 'B2').length
  const sampledB3 = facturas.filter((factura) => factura.situacion.codigo === 'B3').length
  const sampledN1 = facturas.filter((factura) => factura.situacion.codigo === 'N1').length
  const activeTransactionTypes = transactionTypes.filter((item) => item.total > 0)
  const compactMetrics = [
    {
      label: 'Por conciliar',
      value: formatInteger(reconciliableFacturas),
      detail: `${formatInteger(totalFacturas)} abiertas`,
    },
    {
      label: 'PPD al final',
      value: formatInteger(deferredCurrentPpdCount),
      detail: 'vigentes no operativas',
    },
    {
      label: 'Saldo en muestra',
      value: formatNumber(sampledSaldo),
      detail: `${formatInteger(facturas.length)} filas cargadas`,
    },
    {
      label: 'Reglas vivas',
      value: formatInteger(activeTransactionTypes.length),
      detail: 'tipos con accion',
    },
  ]
  const sampledCountByCode: Record<string, number> = {
    K: sampledK,
    PPD1: sampledPpd1,
    A1: sampledA1,
    A2: sampledA2,
    A3: sampledA3,
    A4: sampledA4,
    A5: sampledA5,
    A6: sampledA6,
    A7: sampledA7,
    A8: sampledA8,
    B1: sampledB1,
    B2: sampledB2,
    B3: sampledB3,
    N1: sampledN1,
  }
  const authPillClass = oauth2?.connected ? 'status-pill status-pill--healthy' : 'status-pill status-pill--idle'
  const authPillLabel = oauth2?.connected
    ? `NetSuite conectado (${authStatus?.authMode ?? 'oauth'})`
    : `NetSuite ${authStatus?.authMode ?? 'sin sesion'}`
  const analysisSummaryText =
    activeTransactionTypes.length > 0
      ? activeTransactionTypes.map((item) => `${item.code}:${formatInteger(item.total)}`).join(' | ')
      : 'Sin reglas vivas'
  const transactionActions = {
    PPD1: { busy: isApplyingPpd1, run: () => void applyOnlyPpd1Transactions() },
    A1: { busy: isApplyingA1, run: () => void applyOnlyA1Transactions() },
    A2: { busy: isApplyingA2, run: () => void applyOnlyA2Transactions() },
    A3: { busy: isApplyingA3, run: () => void applyOnlyA3Transactions() },
    A4: { busy: isApplyingA4, run: () => void applyOnlyA4Transactions() },
    A5: { busy: isApplyingA5, run: () => void applyOnlyA5Transactions() },
    A6: { busy: isApplyingA6, run: () => void applyOnlyA6Transactions() },
    A7: { busy: isApplyingA7, run: () => void applyOnlyA7Transactions() },
    A8: { busy: isApplyingA8, run: () => void applyOnlyA8Transactions() },
    B1: { busy: isApplyingB1, run: () => void applyOnlyB1Transactions() },
    B2: { busy: isApplyingB2, run: () => void applyOnlyB2Transactions() },
    B3: { busy: isApplyingB3, run: () => void applyOnlyB3Transactions() },
    N1: { busy: isApplyingN1, run: () => void applyOnlyN1Transactions() },
  } as const

  function buildApplyActivityMessage(result: {
    ruleCode: string
    totals: {
      eligible: number
      applied: number
      skipped: number
      failed: number
    }
    items: Array<{
      status: 'applied' | 'skipped' | 'failed' | 'dry_run'
      message: string
    }>
    warnings?: string[]
  }) {
    const tone =
      result.totals.failed > 0 || result.totals.skipped > 0 || (result.warnings?.length ?? 0) > 0
        ? 'warning'
        : 'success'
    const fragments = [
      `${result.ruleCode} elegibles: ${formatInteger(result.totals.eligible)}`,
      `aplicadas: ${formatInteger(result.totals.applied)}`,
    ]

    if (result.totals.skipped > 0) {
      fragments.push(`omitidas: ${formatInteger(result.totals.skipped)}`)
    }

    if (result.totals.failed > 0) {
      fragments.push(`fallidas: ${formatInteger(result.totals.failed)}`)
    }

    if (result.warnings?.length) {
      fragments.push(result.warnings[0])
    }

    const firstIssue = result.items.find((item) => item.status === 'failed' || item.status === 'skipped')
    if (firstIssue) {
      fragments.push(firstIssue.message)
    }

    return {
      tone,
      text: fragments.join(' | '),
    } satisfies ActivityMessage
  }

  async function hardRefreshFacturas(nextOffset = 0) {
    await loadFacturas(nextOffset, { forceRefresh: true })
  }

  async function loadAuthStatus() {
    try {
      const response = await fetchNetSuiteAuthStatus()
      setAuthStatus(response)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load NetSuite auth status.')
    }
  }

  async function loadFacturas(
    nextOffset: number,
    options?: {
      forceRefresh?: boolean
    },
  ) {
    setIsRefreshing(true)

    try {
      const response = await fetchFacturasAbiertas(PAGE_LIMIT, nextOffset, {
        includeRaw: false,
        forceRefresh: options?.forceRefresh,
      })
      setFacturasState(response)
      setOffset(nextOffset)
      setError(null)
    } catch (reason) {
      setFacturasState(null)
      setError(parseError(reason))
    } finally {
      setIsRefreshing(false)
    }
  }

  async function loadFacturaAdjuntos(invoiceInternalId: string) {
    const normalizedInvoiceInternalId = invoiceInternalId.trim()
    if (!normalizedInvoiceInternalId) {
      return
    }

    setFacturaAdjuntosByInvoiceId((current) => ({
      ...current,
      [normalizedInvoiceInternalId]: { status: 'loading' },
    }))

    try {
      const response = await fetchFacturaAdjuntos(normalizedInvoiceInternalId)
      setFacturaAdjuntosByInvoiceId((current) => ({
        ...current,
        [normalizedInvoiceInternalId]: {
          status: 'loaded',
          data: response,
        },
      }))
    } catch (reason) {
      setFacturaAdjuntosByInvoiceId((current) => ({
        ...current,
        [normalizedInvoiceInternalId]: {
          status: 'error',
          error: parseError(reason),
        },
      }))
    }
  }

  async function toggleFacturaAdjuntos(factura: Factura) {
    const invoiceInternalId = factura.netsuiteInternalId.trim()
    if (!invoiceInternalId) {
      return
    }

    if (expandedFacturaAdjuntosId === invoiceInternalId) {
      setExpandedFacturaAdjuntosId(null)
      return
    }

    setExpandedFacturaAdjuntosId(invoiceInternalId)

    const currentState = facturaAdjuntosByInvoiceId[invoiceInternalId]
    if (currentState?.status === 'loaded' || currentState?.status === 'loading') {
      return
    }

    await loadFacturaAdjuntos(invoiceInternalId)
  }

  useEffect(() => {
    void Promise.all([loadAuthStatus(), loadFacturas(0)])
  }, [])

  async function applyOnlyA1Transactions() {
    const accepted = window.confirm(
      'Se aplicaran solamente las transacciones A1 vivas en NetSuite. Esta accion modifica contabilidad real. ¿Deseas continuar?',
    )
    if (!accepted) {
      return
    }

    setIsApplyingA1(true)

    try {
      const result = await applyA1Transactions()
      setActivityMessage(buildApplyActivityMessage(result))
      setError(null)
      await hardRefreshFacturas(0)
    } catch (reason) {
      setActivityMessage(null)
      setError(parseError(reason))
    } finally {
      setIsApplyingA1(false)
    }
  }

  async function applyOnlyPpd1Transactions() {
    const confirmed = window.confirm(
      'Se aplicaran solamente las transacciones PPD1 vivas en NetSuite. Esta accion modifica diarios y customer payments. Deseas continuar?',
    )

    if (!confirmed) {
      return
    }

    setIsApplyingPpd1(true)
    setActivityMessage(null)
    setError(null)
    try {
      const result = await applyPpd1Transactions()
      setActivityMessage(buildApplyActivityMessage(result))
      await hardRefreshFacturas(offset)
    } catch (reason) {
      setError(parseError(reason))
    } finally {
      setIsApplyingPpd1(false)
    }
  }

  async function applyOnlyA2Transactions() {
    const accepted = window.confirm(
      'Se aplicaran solamente las transacciones A2 vivas en NetSuite. Esta accion puede editar diarios y crear pagos de redondeo reales. ¿Deseas continuar?',
    )
    if (!accepted) {
      return
    }

    setIsApplyingA2(true)

    try {
      const result = await applyA2Transactions()
      setActivityMessage(buildApplyActivityMessage(result))
      setError(null)
      await hardRefreshFacturas(0)
    } catch (reason) {
      setActivityMessage(null)
      setError(parseError(reason))
    } finally {
      setIsApplyingA2(false)
    }
  }

  async function applyOnlyA3Transactions() {
    const accepted = window.confirm(
      'Se aplicaran solamente las transacciones A3 vivas en NetSuite. Esta accion puede editar diarios y crear pagos de redondeo reales. ¿Deseas continuar?',
    )
    if (!accepted) {
      return
    }

    setIsApplyingA3(true)

    try {
      const result = await applyA3Transactions()
      setActivityMessage(buildApplyActivityMessage(result))
      setError(null)
      await hardRefreshFacturas(0)
    } catch (reason) {
      setActivityMessage(null)
      setError(parseError(reason))
    } finally {
      setIsApplyingA3(false)
    }
  }

  async function applyOnlyA4Transactions() {
    const accepted = window.confirm(
      'Se aplicaran solamente las transacciones A4 vivas en NetSuite. Esta accion crea un pago de cliente real que aplica un solo credito contra varias facturas. ¿Deseas continuar?',
    )
    if (!accepted) {
      return
    }

    setIsApplyingA4(true)

    try {
      const result = await applyA4Transactions()
      setActivityMessage(buildApplyActivityMessage(result))
      setError(null)
      await hardRefreshFacturas(0)
    } catch (reason) {
      setActivityMessage(null)
      setError(parseError(reason))
    } finally {
      setIsApplyingA4(false)
    }
  }

  async function applyOnlyA5Transactions() {
    const accepted = window.confirm(
      'Se aplicaran solamente las transacciones A5 vivas en NetSuite. Esta accion crea un pago de cliente real que aplica parte de un credito contra una o varias facturas y deja remanente en el credito. Deseas continuar?',
    )
    if (!accepted) {
      return
    }

    setIsApplyingA5(true)

    try {
      const result = await applyA5Transactions()
      setActivityMessage(buildApplyActivityMessage(result))
      setError(null)
      await hardRefreshFacturas(0)
    } catch (reason) {
      setActivityMessage(null)
      setError(parseError(reason))
    } finally {
      setIsApplyingA5(false)
    }
  }

  async function applyOnlyA6Transactions() {
    const accepted = window.confirm(
      'Se aplicaran solamente las transacciones A6 vivas en NetSuite. Esta accion crea un pago de cliente real para aplicar parte de un diario del mismo periodo y dejar remanente en el credito. Deseas continuar?',
    )
    if (!accepted) {
      return
    }

    setIsApplyingA6(true)

    try {
      const result = await applyA6Transactions()
      setActivityMessage(buildApplyActivityMessage(result))
      setError(null)
      await hardRefreshFacturas(0)
    } catch (reason) {
      setActivityMessage(null)
      setError(parseError(reason))
    } finally {
      setIsApplyingA6(false)
    }
  }

  async function applyOnlyA7Transactions() {
    const accepted = window.confirm(
      'Se aplicaran solamente las transacciones A7 vivas en NetSuite. Esta accion aplica un solo diario del mismo periodo a varias facturas PUE del mismo cliente y deja remanente en el credito. Deseas continuar?',
    )
    if (!accepted) {
      return
    }

    setIsApplyingA7(true)

    try {
      const result = await applyA7Transactions()
      setActivityMessage(buildApplyActivityMessage(result))
      setError(null)
      await hardRefreshFacturas(0)
    } catch (reason) {
      setActivityMessage(null)
      setError(parseError(reason))
    } finally {
      setIsApplyingA7(false)
    }
  }

  async function applyOnlyA8Transactions() {
    const accepted = window.confirm(
      'Se aplicaran solamente las transacciones A8 vivas en NetSuite. Esta accion asigna por factura el credito Journal o CustCred del mismo periodo mas ajustado disponible. Deseas continuar?',
    )
    if (!accepted) {
      return
    }

    setIsApplyingA8(true)

    try {
      const result = await applyA8Transactions()
      setActivityMessage(buildApplyActivityMessage(result))
      setError(null)
      await hardRefreshFacturas(0)
    } catch (reason) {
      setActivityMessage(null)
      setError(parseError(reason))
    } finally {
      setIsApplyingA8(false)
    }
  }

  async function applyOnlyB1Transactions() {
    const accepted = window.confirm(
      'Se aplicaran solamente las transacciones B1 vivas en NetSuite. Esta accion crea un pago real al banco puente, genera un diario puente y enlaza el credito original de otro periodo. Deseas continuar?',
    )
    if (!accepted) {
      return
    }

    setIsApplyingB1(true)

    try {
      const result = await applyB1Transactions()
      setActivityMessage(buildApplyActivityMessage(result))
      setError(null)
      await hardRefreshFacturas(0)
    } catch (reason) {
      setActivityMessage(null)
      setError(parseError(reason))
    } finally {
      setIsApplyingB1(false)
    }
  }

  async function applyOnlyB2Transactions() {
    const accepted = window.confirm(
      'Se aplicaran solamente las transacciones B2 MXN vivas en NetSuite. Esta accion crea un pago real al banco puente, genera un diario puente y deja remanente vivo en el diario original de otro periodo. Deseas continuar?',
    )
    if (!accepted) {
      return
    }

    setIsApplyingB2(true)

    try {
      const result = await applyB2Transactions()
      setActivityMessage(buildApplyActivityMessage(result))
      setError(null)
      await hardRefreshFacturas(0)
    } catch (reason) {
      setActivityMessage(null)
      setError(parseError(reason))
    } finally {
      setIsApplyingB2(false)
    }
  }

  async function applyOnlyB3Transactions() {
    const accepted = window.confirm(
      'Se aplicaran solamente las transacciones B3 MXN vivas en NetSuite. Esta accion crea un pago real y un diario puente por cada factura del grupo, respetando la fecha de cada factura y consumiendo el diario original de otro periodo hasta cerrar la orden pendiente. Deseas continuar?',
    )
    if (!accepted) {
      return
    }

    setIsApplyingB3(true)

    try {
      const result = await applyB3Transactions()
      setActivityMessage(buildApplyActivityMessage(result))
      setError(null)
      await hardRefreshFacturas(0)
    } catch (reason) {
      setActivityMessage(null)
      setError(parseError(reason))
    } finally {
      setIsApplyingB3(false)
    }
  }

  async function applyOnlyN1Transactions() {
    const accepted = window.confirm(
      'Se aplicaran solamente las transacciones N1 vivas en NetSuite. Esta accion puede emitir y aplicar notas de credito reales. ¿Deseas continuar?',
    )
    if (!accepted) {
      return
    }

    setIsApplyingN1(true)

    try {
      const result = await applyN1Transactions()
      setActivityMessage(buildApplyActivityMessage(result))
      setError(null)
      await hardRefreshFacturas(0)
    } catch (reason) {
      setActivityMessage(null)
      setError(parseError(reason))
    } finally {
      setIsApplyingN1(false)
    }
  }

  async function disconnectOAuth() {
    setIsDisconnecting(true)

    try {
      await revokeNetSuiteOAuthSession()
      await Promise.all([loadAuthStatus(), hardRefreshFacturas(offset)])
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to revoke the stored OAuth session.')
    } finally {
      setIsDisconnecting(false)
    }
  }

  function beginOAuthFlow() {
    window.open(netsuiteOAuthLoginUrl, 'netsuite-oauth', 'popup,width=760,height=820')
  }

  function renderTransactionActionButton(code: string, total: number, compact = false) {
    const action = transactionActions[code as keyof typeof transactionActions]
    if (!action) {
      return null
    }

    return (
      <button
        type="button"
        className={compact ? 'ghost-button ghost-button--inline' : 'ghost-button'}
        onClick={action.run}
        disabled={action.busy || total === 0}
      >
        {action.busy ? 'Aplicando...' : compact ? 'Aplicar' : 'Aplicar transacciones'}
      </button>
    )
  }

  return (
    <div className="row g-3">
      <div className="col-12">
        <div className="surface-card card ingresos-compact-shell">
          <div className="card-body">
            <div className="ingresos-header">
              <div className="ingresos-header__copy">
                <div className="eyebrow">Ingresos</div>
                <div className="ingresos-header__title-row">
                  <h2 className="h5 mb-0">Facturas abiertas</h2>
                  <span className={authPillClass}>{authPillLabel}</span>
                </div>
                <p className="text-secondary mb-0">
                  Vista minima para priorizar tabla y reglas activas.
                </p>
              </div>

              <div className="ingresos-header__actions">
                <div className="lab-sync">
                  {facturasState?.generatedAtUtc
                    ? `Ultima lectura: ${formatDateTime(facturasState.generatedAtUtc)}`
                    : 'Sin lectura exitosa todavia'}
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => void hardRefreshFacturas(offset)}
                  disabled={isRefreshing}
                >
                  {isRefreshing ? 'Refreshing...' : 'Refrescar facturas'}
                </button>
              </div>
            </div>

            {error ? <div className="alert alert-warning mt-3 mb-0">{error}</div> : null}
            {activityMessage ? (
              <div
                className={`alert mt-3 mb-0 ${
                  activityMessage.tone === 'success' ? 'alert-success' : 'alert-warning'
                }`}
              >
                {activityMessage.text}
              </div>
            ) : null}

            <div className="ingresos-toolbar">
              <div className="ingresos-toolbar__group">
                {compactMetrics.map((metric) => (
                  <div key={metric.label} className="ingresos-metric-pill" title={metric.detail}>
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                  </div>
                ))}
              </div>

              {activeTransactionTypes.length > 0 ? (
                <div className="ingresos-toolbar__group ingresos-toolbar__group--rules">
                  {activeTransactionTypes.map((item) => (
                    <article key={item.code} className="ingresos-rule-pill">
                      <div className="ingresos-rule-pill__meta">
                        <strong>{item.code}</strong>
                        <span>{formatInteger(item.total)}</span>
                        <small>
                          {sampledCountByCode[item.code] !== undefined
                            ? `${formatInteger(sampledCountByCode[item.code])} en pantalla`
                            : 'requiere lectura puntual'}
                        </small>
                      </div>
                      {renderTransactionActionButton(item.code, item.total, true)}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="ingresos-toolbar__group">
                  <div className="ingresos-rule-pill ingresos-rule-pill--empty">
                    <small>Sin reglas vivas en este corte</small>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="col-12">
        <div className="surface-card card analysis-card">
          <div className="card-body">
            <div className="analysis-card__header">
              <div>
                <div className="eyebrow">Tabla operativa</div>
                <h3 className="h4 mb-2">Facturas abiertas</h3>
                <p className="text-secondary mb-0">
                  La tabla usa la capa normalizada y evita cargar el `raw` completo hasta que haga falta
                  inspeccionar una factura puntual. Las PPD vigentes no cuentan como por conciliar. El
                  orden visible sigue S1, luego S2, con vencidas primero.
                </p>
              </div>

              <div className="analysis-card__summary">
                {analysisSummaryText}
              </div>

              <div className="analysis-card__meta">
                <span className="status-pill status-pill--healthy">
                  {facturasState ? `Rows ${facturasState.page.count}` : 'Waiting'}
                </span>
                <div className="small text-secondary">
                  Offset {offset}
                  {facturasState
                    ? ` | Por conciliar ${facturasState.page.reconciliableResults} | Abiertas ${facturasState.page.totalResults}`
                    : ''}
                </div>
              </div>
            </div>

            <div className="table-responsive analysis-table mt-3">
              <table className="table align-middle mb-0">
                <thead>
                  <tr>
                    <th>Documento</th>
                    <th>S1</th>
                    <th>S2</th>
                    <th>Cliente</th>
                    <th>Fecha</th>
                    <th>Vencimiento</th>
                    <th>Periodo</th>
                    <th>Moneda</th>
                    <th>Total</th>
                    <th>Saldo abierto</th>
                    <th>Estado</th>
                    <th>Raw</th>
                  </tr>
                </thead>
                <tbody>
                  {facturas.length > 0 ? (
                    facturas.map((factura) => {
                      const invoiceInternalId = factura.netsuiteInternalId
                      const adjuntosState = facturaAdjuntosByInvoiceId[invoiceInternalId] ?? {
                        status: 'idle' as const,
                      }
                      const isAdjuntosExpanded = expandedFacturaAdjuntosId === invoiceInternalId
                      const isAdjuntosLoading = adjuntosState.status === 'loading'
                      const adjuntosLoadedCount =
                        adjuntosState.status === 'loaded' ? adjuntosState.data.attachmentCount : null

                      return (
                        <Fragment key={factura.id}>
                          <tr>
                            <td>
                              <strong>{factura.numeroDocumento ?? factura.numeroTransaccion ?? factura.id}</strong>
                            </td>
                            <td>
                              <div className="invoice-situacion">
                                {factura.situacion.codigo ? (
                                  <Link
                                    to={`/rules?highlight=${factura.situacion.codigo}`}
                                    className={`${facturaSituacionClass(factura)} invoice-situacion__link`}
                                  >
                                    {factura.situacion.codigo}
                                  </Link>
                                ) : (
                                  <span className={facturaSituacionClass(factura)}>
                                    {factura.situacion.codigo ?? '--'}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td>
                              <div className="invoice-situacion">
                                <span className={facturaS2Class(factura)}>{facturaS2Label(factura)}</span>
                              </div>
                            </td>
                            <td>{factura.clienteNombre ?? '--'}</td>
                            <td>{formatDate(factura.fecha)}</td>
                            <td>{formatDate(factura.vencimiento)}</td>
                            <td>{factura.periodoContableNombre ?? '--'}</td>
                            <td>{factura.moneda ?? '--'}</td>
                            <td>{formatMoneyLike(factura.total, factura.moneda)}</td>
                            <td>{formatMoneyLike(factura.saldoAbierto, factura.moneda)}</td>
                            <td>
                              <span className={facturaEstadoClass(factura.estado)}>{factura.estado}</span>
                            </td>
                            <td>
                              <div className="invoice-raw-meta">
                                <strong>{Object.keys(factura.raw).length}</strong>
                                <span>
                                  {factura.situacion.codigo === 'N1' && factura.situacion.n1
                                    ? `raw / ${Object.keys(factura.customFields).length} custom / ${factura.lineas.length} lineas / anticipo ${factura.situacion.n1.facturaAnticipoDocumento ?? '--'} / banco ${factura.situacion.n1.pagoCuentaBancoNombre ?? '--'}`
                                      : factura.situacion.codigo === 'A4' && factura.situacion.a4
                                      ? `raw / ${Object.keys(factura.customFields).length} custom / ${factura.lineas.length} lineas / orden ${factura.situacion.a4.salesOrderDocument ?? '--'} / grupo ${factura.situacion.a4.invoiceCount} facturas / credito ${factura.situacion.a4.creditDocument ?? '--'}`
                                      : factura.situacion.codigo === 'K' && factura.situacion.k
                                        ? `raw / ${Object.keys(factura.customFields).length} custom / ${factura.lineas.length} lineas / Kontempo orden ${factura.situacion.k.orderId} / transferencia ${factura.situacion.k.transferId ?? factura.situacion.k.transferIdFragment ?? '--'} / diario ${factura.situacion.k.journalDocument ?? '--'} / comision ${formatMoneyLike(factura.situacion.k.orderCommissionAmount, factura.moneda)}${factura.situacion.k.requiresManualIntervention ? ' / intervencion manual' : ''}`
                                      : factura.situacion.codigo === 'A5' && factura.situacion.a5
                                        ? `raw / ${Object.keys(factura.customFields).length} custom / ${factura.lineas.length} lineas / orden ${factura.situacion.a5.salesOrderDocument ?? '--'} / grupo ${factura.situacion.a5.invoiceCount} factura${factura.situacion.a5.invoiceCount === 1 ? '' : 's'} / credito ${factura.situacion.a5.creditDocument ?? '--'} / remanente ${formatMoneyLike(factura.situacion.a5.creditRemainingAfterGroup, factura.moneda)}`
                                        : factura.situacion.codigo === 'A6' && factura.situacion.a6
                                        ? `raw / ${Object.keys(factura.customFields).length} custom / ${factura.lineas.length} lineas / orden ${factura.situacion.a6.salesOrderDocument ?? '--'} / credito ${factura.situacion.a6.creditDocument ?? '--'} / remanente ${formatMoneyLike(factura.situacion.a6.creditRemainingAfterGroup, factura.moneda)}`
                                          : factura.situacion.codigo === 'A7' && factura.situacion.a7
                                            ? `raw / ${Object.keys(factura.customFields).length} custom / ${factura.lineas.length} lineas / grupo ${factura.situacion.a7.invoiceCount} facturas / cliente-periodo ${factura.situacion.a7.salesOrderDocument ?? '--'} / credito ${factura.situacion.a7.creditDocument ?? '--'} / remanente ${formatMoneyLike(factura.situacion.a7.creditRemainingAfterGroup, factura.moneda)}`
                                          : factura.situacion.codigo === 'A8' && factura.situacion.a8
                                            ? `raw / ${Object.keys(factura.customFields).length} custom / ${factura.lineas.length} lineas / grupo ${factura.situacion.a8.invoiceCount} facturas / cliente-periodo ${factura.situacion.a8.customerName ?? '--'} / ${factura.situacion.a8.postingPeriodName ?? '--'} / credito ${factura.situacion.a8.creditDocument ?? '--'} / remanente ${formatMoneyLike(factura.situacion.a8.creditRemainingAfterInvoice, factura.moneda)}`
                                          : factura.situacion.codigo === 'B1' && factura.situacion.b1
                                            ? `raw / ${Object.keys(factura.customFields).length} custom / ${factura.lineas.length} lineas / credito origen ${factura.situacion.b1.originalCreditDocument ?? '--'} / periodo origen ${factura.situacion.b1.originalCreditPeriodName ?? '--'} / banco puente ${factura.situacion.b1.bridgeBankAccountName ?? '--'}`
                                          : factura.situacion.codigo === 'B2' && factura.situacion.b2
                                            ? `raw / ${Object.keys(factura.customFields).length} custom / ${factura.lineas.length} lineas / credito origen ${factura.situacion.b2.originalCreditDocument ?? '--'} / periodo origen ${factura.situacion.b2.originalCreditPeriodName ?? '--'} / banco puente ${factura.situacion.b2.bridgeBankAccountName ?? '--'} / remanente ${formatMoneyLike((factura.situacion.b2.originalCreditAvailableAmount ?? 0) - (factura.situacion.b2.targetAmount ?? 0), factura.moneda)}`
                                            : factura.situacion.codigo === 'B3' && factura.situacion.b3
                                              ? `raw / ${Object.keys(factura.customFields).length} custom / ${factura.lineas.length} lineas / orden ${factura.situacion.b3.salesOrderDocument ?? '--'} / grupo ${factura.situacion.b3.invoiceCount} facturas / credito origen ${factura.situacion.b3.originalCreditDocument ?? '--'} / periodo origen ${factura.situacion.b3.originalCreditPeriodName ?? '--'} / banco puente ${factura.situacion.b3.bridgeBankAccountName ?? '--'}`
                                            : `raw / ${Object.keys(factura.customFields).length} custom / ${factura.lineas.length} lineas / ${factura.situacion.candidatos.length} creditos`}
                                </span>

                                <div className="invoice-raw-meta__actions">
                                  <button
                                    type="button"
                                    className="ghost-button ghost-button--inline"
                                    onClick={() => void toggleFacturaAdjuntos(factura)}
                                    disabled={isAdjuntosLoading}
                                  >
                                    {isAdjuntosLoading
                                      ? 'Leyendo pago...'
                                      : isAdjuntosExpanded
                                        ? 'Ocultar pago'
                                        : 'Inspeccionar pago'}
                                  </button>

                                  {adjuntosLoadedCount !== null ? (
                                    <span className="invoice-attachment-count">
                                      {adjuntosLoadedCount} adjunto
                                      {adjuntosLoadedCount === 1 ? '' : 's'}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </td>
                          </tr>

                          {isAdjuntosExpanded ? (
                            <tr className="invoice-attachment-row">
                              <td colSpan={12}>
                                <FacturaAdjuntosPanel
                                  factura={factura}
                                  state={adjuntosState}
                                  onRetry={() => void loadFacturaAdjuntos(invoiceInternalId)}
                                />
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      )
                    })
                  ) : (
                    <tr>
                      <td colSpan={12} className="text-secondary">
                        {isRefreshing
                          ? 'Consultando NetSuite...'
                          : 'No hay facturas cargadas todavia o la conexion sigue pendiente.'}
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
                onClick={() => void loadFacturas(Math.max(0, offset - PAGE_LIMIT))}
                disabled={isRefreshing || offset === 0}
              >
                Anterior
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => void loadFacturas(offset + PAGE_LIMIT)}
                disabled={isRefreshing || !facturasState?.page.hasMore}
              >
                Siguiente
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="col-12">
        <div className="surface-card card ingresos-foldout">
          <details className="ingresos-foldout__details">
            <summary className="ingresos-foldout__summary">
              <div>
                <div className="eyebrow">Detalle</div>
                <strong>Resumen completo y conexion NetSuite</strong>
              </div>
              <div className="small text-secondary">
                {formatInteger(transactionTypes.length)} tipos | Auth {authStatus?.authMode ?? '--'}
              </div>
            </summary>

            <div className="card-body pt-0">
              <div className="row g-3">
                <div className="col-xl-8">
                  <div className="eyebrow">Resumen operativo</div>
                  <h3 className="h5 mb-3">Tipos de transacciones</h3>

                  <div className="transaction-summary transaction-summary--compact">
                    {transactionTypes.length > 0 ? (
                      transactionTypes.map((item) => (
                        <div key={item.code} className="transaction-summary__row">
                          <div className="transaction-summary__copy">
                            <strong>{item.code}</strong>
                            <span>{item.definition}</span>
                          </div>

                          <div className="transaction-summary__meta">
                            <span className="transaction-summary__count">
                              {formatInteger(item.total)}
                            </span>
                            {renderTransactionActionButton(item.code, item.total)}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-secondary">
                        Todavia no hay resumen de tipos disponible para la lectura actual.
                      </div>
                    )}
                  </div>
                </div>

                <div className="col-xl-4">
                  <div className="eyebrow">Authentication</div>
                  <h3 className="h5 mb-3">Estado de conexion con NetSuite</h3>
                  <div className="summary-list">
                    <div className="summary-list__item">
                      <span>Auth mode</span>
                      <strong>{authStatus?.authMode ?? '--'}</strong>
                    </div>
                    <div className="summary-list__item">
                      <span>OAuth 2.0 configured</span>
                      <strong>{flagLabel(oauth2?.configured)}</strong>
                    </div>
                    <div className="summary-list__item">
                      <span>OAuth 2.0 connected</span>
                      <strong>{flagLabel(oauth2?.connected)}</strong>
                    </div>
                    <div className="summary-list__item">
                      <span>TBA fallback</span>
                      <strong>{authStatus?.tbaConfigured ? 'Yes' : 'No'}</strong>
                    </div>
                    <div className="summary-list__item">
                      <span>Redirect URI</span>
                      <strong className="analysis-break">{oauth2?.redirectUri ?? '--'}</strong>
                    </div>
                    <div className="summary-list__item">
                      <span>Frontend return</span>
                      <strong className="analysis-break">{oauth2?.frontendReturnUrl ?? '--'}</strong>
                    </div>
                  </div>

                  <div className="control-inline mt-3">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={beginOAuthFlow}
                      disabled={!oauth2?.configured}
                    >
                      Connect OAuth 2.0
                    </button>

                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => void disconnectOAuth()}
                      disabled={!oauth2?.connected || isDisconnecting}
                    >
                      {isDisconnecting ? 'Disconnecting...' : 'Disconnect stored session'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}

function FacturaAdjuntosPanel(props: {
  factura: Factura
  state: FacturaAdjuntosState
  onRetry: () => void
}) {
  const { factura, state, onRetry } = props

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <div className="invoice-attachment-panel">
        <div className="invoice-attachment-panel__empty">Leyendo comprobantes desde NetSuite...</div>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="invoice-attachment-panel">
        <div className="invoice-attachment-panel__header">
          <div>
            <div className="eyebrow">Comunicacion &gt; Archivos</div>
            <strong>La lectura del comprobante no se pudo completar.</strong>
          </div>

          <button type="button" className="ghost-button ghost-button--inline" onClick={onRetry}>
            Reintentar
          </button>
        </div>

        <div className="invoice-attachment-panel__error">{state.error}</div>
      </div>
    )
  }

  return (
    <div className="invoice-attachment-panel">
      <div className="invoice-attachment-panel__header">
        <div>
          <div className="eyebrow">Comunicacion &gt; Archivos</div>
          <strong>
            Factura {factura.numeroDocumento ?? factura.numeroTransaccion ?? factura.id} |{' '}
            {state.data.attachmentCount} adjunto{state.data.attachmentCount === 1 ? '' : 's'}
          </strong>
          <div className="small text-secondary">
            Ultima lectura {formatDateTime(state.data.inspectedAtUtc)}
          </div>
        </div>

        <button type="button" className="ghost-button ghost-button--inline" onClick={onRetry}>
          Releer
        </button>
      </div>

      {state.data.attachments.length > 0 ? (
        <div className="invoice-attachment-list">
          {state.data.attachments.map((attachment) => {
            const amountMatch = getAttachmentAmountMatch(attachment, factura)

            return (
              <article key={attachment.fileId} className="invoice-attachment-card">
                <div className="invoice-attachment-card__top">
                  <div className="invoice-attachment-card__title">
                    <strong>{attachment.name ?? `Archivo ${attachment.fileId}`}</strong>
                    <div className="small text-secondary">
                      File ID {attachment.fileId}
                      {attachment.mediaTypeName ? ` | ${attachment.mediaTypeName}` : ''}
                      {attachment.fileSize !== null ? ` | ${formatFileSize(attachment.fileSize)}` : ''}
                    </div>
                  </div>

                  <div className="invoice-attachment-card__badges">
                    <span className={attachmentExtractionStatusClass(attachment)}>
                      {attachmentExtractionStatusLabel(attachment)}
                    </span>

                    {amountMatch ? <span className={amountMatch.className}>{amountMatch.label}</span> : null}
                  </div>
                </div>

                <div className="invoice-attachment-grid">
                  <div className="invoice-attachment-grid__item">
                    <span>Monto detectado</span>
                    <strong>
                      {formatMoneyLike(attachment.detectedSignals?.transferAmount ?? null, factura.moneda)}
                    </strong>
                  </div>
                  <div className="invoice-attachment-grid__item">
                    <span>Referencia</span>
                    <strong>{attachment.detectedSignals?.referenceNumber ?? '--'}</strong>
                  </div>
                  <div className="invoice-attachment-grid__item">
                    <span>Banco</span>
                    <strong>{attachment.detectedSignals?.bankName ?? '--'}</strong>
                  </div>
                  <div className="invoice-attachment-grid__item">
                    <span>Fecha operacion</span>
                    <strong>{attachment.detectedSignals?.operationDateText ?? '--'}</strong>
                  </div>
                  <div className="invoice-attachment-grid__item">
                    <span>Cuenta origen</span>
                    <strong>{attachment.detectedSignals?.sourceAccountHint ?? '--'}</strong>
                  </div>
                  <div className="invoice-attachment-grid__item">
                    <span>Cuenta destino</span>
                    <strong>{attachment.detectedSignals?.destinationAccountHint ?? '--'}</strong>
                  </div>
                </div>

                <div className="invoice-attachment-card__footer">
                  <div className="invoice-attachment-card__summary">
                    <span>
                      Concepto:{' '}
                      {attachment.detectedSignals?.paymentConcept?.trim()
                        ? attachment.detectedSignals.paymentConcept
                        : 'Sin concepto reconocido.'}
                    </span>
                    {attachment.parseError ? <span>Error de parseo: {attachment.parseError}</span> : null}
                    {attachment.isInactive === true ? (
                      <span>NetSuite marca este archivo como inactivo.</span>
                    ) : null}
                  </div>

                  {attachment.url ? (
                    <a
                      href={attachment.url}
                      target="_blank"
                      rel="noreferrer"
                      className="invoice-attachment-link"
                    >
                      Abrir archivo
                    </a>
                  ) : null}
                </div>

                {attachment.parsedTextExcerpt ? (
                  <div className="invoice-attachment-excerpt">{attachment.parsedTextExcerpt}</div>
                ) : null}
              </article>
            )
          })}
        </div>
      ) : (
        <div className="invoice-attachment-panel__empty">
          Esta factura no tiene adjuntos disponibles en Comunicacion &gt; Archivos.
        </div>
      )}
    </div>
  )
}

function facturaEstadoClass(estado: Factura['estado']) {
  return `status-pill status-pill--${estado === 'abierta' ? 'review' : 'healthy'}`
}

function facturaSituacionClass(factura: Factura) {
  if (
    factura.situacion.codigo === 'K' ||
    factura.situacion.codigo === 'PPD1' ||
    factura.situacion.codigo === 'A1' ||
    factura.situacion.codigo === 'A4' ||
    factura.situacion.codigo === 'A5' ||
    factura.situacion.codigo === 'A6' ||
    factura.situacion.codigo === 'A7' ||
    factura.situacion.codigo === 'A8' ||
    factura.situacion.codigo === 'B1' ||
    factura.situacion.codigo === 'B2' ||
    factura.situacion.codigo === 'B3' ||
    factura.situacion.codigo === 'N1'
  ) {
    return 'status-pill status-pill--ready'
  }

  if (factura.situacion.codigo === 'A2' || factura.situacion.codigo === 'A3') {
    return 'status-pill status-pill--review'
  }

  return 'status-pill status-pill--idle'
}

function facturaS2Class(factura: Factura) {
  const vigencia = getFacturaVigenciaEstado(factura)

  if (vigencia === 'vencida') {
    return 'status-pill status-pill--error'
  }

  return 'status-pill status-pill--ready'
}

function facturaS2Label(factura: Factura) {
  return 'V'
}

function getFacturaVigenciaEstado(factura: Factura) {
  const dueDate = new Date(factura.vencimiento ?? factura.fecha ?? '')
  if (Number.isNaN(dueDate.getTime())) {
    return 'vencida' as const
  }

  const today = new Date()
  const todayDateOnly = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const dueDateOnly = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate())

  return dueDateOnly < todayDateOnly ? 'vencida' : 'vigente'
}

function formatDate(value: string | null) {
  if (!value) {
    return '--'
  }

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
  }).format(parsed)
}

function formatInteger(value: number | null | undefined) {
  if (typeof value !== 'number') {
    return '--'
  }

  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(value)
}

function formatNumber(value: number | null | undefined) {
  if (typeof value !== 'number') {
    return '--'
  }

  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatMoneyLike(amount: number | null, currency: string | null) {
  if (amount === null) {
    return '--'
  }

  const formattedAmount = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount))

  return `${amount < 0 ? '-$' : '$'}${formattedAmount}`
}

function getAttachmentAmountMatch(attachment: FacturaAdjunto, factura: Factura) {
  const detectedAmount = attachment.detectedSignals?.transferAmount ?? null
  const facturaAmount = factura.saldoAbierto ?? factura.total
  if (detectedAmount === null || facturaAmount === null) {
    return null
  }

  const delta = roundCurrency(detectedAmount - facturaAmount)
  if (Math.abs(delta) < 0.01) {
    return {
      className: 'status-pill status-pill--ready',
      label: 'Iguala saldo',
    }
  }

  return {
    className: 'status-pill status-pill--review',
    label: `Dif. ${formatMoneyLike(delta, factura.moneda)}`,
  }
}

function attachmentExtractionStatusClass(attachment: FacturaAdjunto) {
  if (attachment.textExtractionStatus === 'parsed') {
    return 'status-pill status-pill--healthy'
  }

  if (attachment.textExtractionStatus === 'failed') {
    return 'status-pill status-pill--exception'
  }

  return 'status-pill status-pill--idle'
}

function attachmentExtractionStatusLabel(attachment: FacturaAdjunto) {
  if (attachment.textExtractionStatus === 'parsed') {
    return 'PDF leido'
  }

  if (attachment.textExtractionStatus === 'failed') {
    return 'Error lectura'
  }

  if (attachment.textExtractionStatus === 'missing_content') {
    return 'Sin contenido'
  }

  return 'Sin OCR'
}

function formatFileSize(bytes: number | null) {
  if (typeof bytes !== 'number') {
    return '--'
  }

  if (bytes < 1024) {
    return `${bytes} B`
  }

  return `${new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(bytes / 1024)} KB`
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function parseError(reason: unknown) {
  if (reason instanceof HttpClientError) {
    const payload = safeParseBody(reason.body)
    return payload?.error ?? reason.message
  }

  if (reason instanceof Error) {
    return reason.message
  }

  return 'Unable to load open invoices from NetSuite.'
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

function flagLabel(value?: boolean) {
  if (typeof value !== 'boolean') {
    return '--'
  }

  return value ? 'Yes' : 'No'
}

