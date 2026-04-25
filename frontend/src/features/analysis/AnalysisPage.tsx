import { useEffect, useMemo, useState } from 'react'
import { HttpClientError } from '../../services/api/httpClient'
import {
  fetchNetSuiteAnalysisBootstrap,
  fetchNetSuiteAuthStatus,
  netsuiteOAuthLoginUrl,
  revokeNetSuiteOAuthSession,
  type NetSuiteAnalysisQueryDefinition,
  type NetSuiteAnalysisQueryResult,
} from '../../services/api/reconciliationApi'

type AnalysisState = Awaited<ReturnType<typeof fetchNetSuiteAnalysisBootstrap>> | null
type AuthState = Awaited<ReturnType<typeof fetchNetSuiteAuthStatus>> | null

type AnalysisErrorPayload = {
  error?: string
  starterQueries?: NetSuiteAnalysisQueryDefinition[]
}

type OAuthPopupMessage = {
  source?: string
  success?: boolean
  message?: string
}

export function AnalysisPage() {
  const [analysis, setAnalysis] = useState<AnalysisState>(null)
  const [authStatus, setAuthStatus] = useState<AuthState>(null)
  const [starterQueries, setStarterQueries] = useState<NetSuiteAnalysisQueryDefinition[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)

  useEffect(() => {
    void Promise.all([loadAuthStatus(), loadAnalysis()])
  }, [])

  useEffect(() => {
    function handleMessage(event: MessageEvent<OAuthPopupMessage>) {
      if (event.data?.source !== 'netsuite-oauth') {
        return
      }

      if (event.data.success) {
        setError(null)
        void Promise.all([loadAuthStatus(), loadAnalysis()])
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

  const metrics = useMemo(() => {
    const queries = analysis?.queries ?? []

    return {
      connected: queries.filter((query) => query.status === 'ok').length,
      blocked: queries.filter((query) => query.status === 'error').length,
      rows: queries.reduce((sum, query) => sum + (query.items?.length ?? 0), 0),
    }
  }, [analysis])

  const oauth2 = authStatus?.oauth2

  async function loadAuthStatus() {
    try {
      const response = await fetchNetSuiteAuthStatus()
      setAuthStatus(response)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load NetSuite auth status.')
    }
  }

  async function loadAnalysis() {
    setIsRefreshing(true)

    try {
      const response = await fetchNetSuiteAnalysisBootstrap()
      setAnalysis(response)
      setStarterQueries([])
      setError(null)
    } catch (reason) {
      const details = parseAnalysisError(reason)
      setAnalysis(null)
      setStarterQueries(details.starterQueries ?? [])
      setError(details.error)
    } finally {
      setIsRefreshing(false)
    }
  }

  async function disconnectOAuth() {
    setIsDisconnecting(true)

    try {
      await revokeNetSuiteOAuthSession()
      await Promise.all([loadAuthStatus(), loadAnalysis()])
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

  return (
    <div className="row g-4">
      <div className="col-12">
        <div className="surface-card card">
          <div className="card-body">
            <div className="analysis-toolbar">
              <div>
                <div className="eyebrow">NetSuite Read-Only Analysis</div>
                <h2 className="h3 mb-3">Lectura real del ERP para empezar a analizar cobros y facturas.</h2>
                <p className="text-secondary mb-0">
                  Esta pantalla ya no usa ejemplos mock. Primero resuelve la autenticacion y luego corre
                  tres consultas `SuiteQL` de diagnostico por bloque, para mostrarnos que tan listo esta el
                  ambiente antes de automatizar la aplicacion de pagos.
                </p>
              </div>

              <div className="analysis-toolbar__actions">
                <div className="lab-sync">
                  {analysis?.generatedAtUtc
                    ? `Ultima lectura: ${analysis.generatedAtUtc}`
                    : 'Sin lectura exitosa todavia'}
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => void loadAnalysis()}
                  disabled={isRefreshing}
                >
                  {isRefreshing ? 'Refreshing...' : 'Run read-only bootstrap'}
                </button>
              </div>
            </div>

            {error ? <div className="alert alert-warning mt-3 mb-0">{error}</div> : null}
          </div>
        </div>
      </div>

      <div className="col-xl-6">
        <div className="surface-card card">
          <div className="card-body">
            <div className="eyebrow">Authentication</div>
            <h3 className="h4 mb-3">OAuth 2.0 authorization code flow</h3>
            <p className="text-secondary">
              Esta es la ruta recomendada para integraciones nuevas de NetSuite REST. La app abre el login
              de NetSuite, recibe el `authorization code`, guarda el `refresh token` localmente y despues
              renueva el `access token` automaticamente.
            </p>

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
                <span>Scopes</span>
                <strong>{oauth2?.scopes.length ? oauth2.scopes.join(', ') : '--'}</strong>
              </div>
              <div className="summary-list__item">
                <span>Redirect URI</span>
                <strong className="analysis-break">{oauth2?.redirectUri ?? '--'}</strong>
              </div>
              <div className="summary-list__item">
                <span>Access token expires</span>
                <strong>{oauth2?.accessTokenExpiresAt ?? '--'}</strong>
              </div>
              <div className="summary-list__item">
                <span>Refresh token expires</span>
                <strong>{oauth2?.refreshTokenExpiresAt ?? '--'}</strong>
              </div>
            </div>

            <div className="control-inline mt-4">
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

            {!oauth2?.configured ? (
              <div className="note-strip note-strip--accent mt-3">
                Configura `NETSUITE_AUTH_MODE=oauth2`, `NETSUITE_OAUTH_CLIENT_ID`,
                `NETSUITE_OAUTH_CLIENT_SECRET` y una `NETSUITE_OAUTH_REDIRECT_URI` con `https://` en
                `backend/.env.local`.
              </div>
            ) : !oauth2.connected ? (
              <div className="note-strip note-strip--accent mt-3">
                La app ya esta configurada para OAuth 2.0. El siguiente paso es pulsar `Connect OAuth 2.0`
                y autorizar la integracion en NetSuite.
              </div>
            ) : (
              <div className="note-strip note-strip--accent mt-3">
                La sesion OAuth 2.0 ya esta conectada. Las lecturas reales de NetSuite usaran bearer token
                y el backend se encargara del refresh del access token.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="col-xl-6">
        <div className="surface-card card">
          <div className="card-body">
            <div className="eyebrow">Configuration Checklist</div>
            <h3 className="h4 mb-3">Que debes preparar en NetSuite</h3>
            <div className="summary-list">
              <div className="summary-list__item">
                <span>Integration record</span>
                <strong>Authorization Code Grant</strong>
              </div>
              <div className="summary-list__item">
                <span>Scopes</span>
                <strong>REST Web Services</strong>
              </div>
              <div className="summary-list__item">
                <span>Redirect URI</span>
                <strong className="analysis-break">{oauth2?.redirectUri ?? 'https://your-domain.example/api/auth/netsuite/callback'}</strong>
              </div>
              <div className="summary-list__item">
                <span>Consent policy</span>
                <strong>Ask First Time or Never Ask</strong>
              </div>
              <div className="summary-list__item">
                <span>Frontend return</span>
                <strong className="analysis-break">{oauth2?.frontendReturnUrl ?? 'http://127.0.0.1:3000/#/analysis'}</strong>
              </div>
              <div className="summary-list__item">
                <span>Fallback available</span>
                <strong>{authStatus?.tbaConfigured ? 'TBA configured' : 'OAuth only'}</strong>
              </div>
            </div>
            <p className="text-secondary mt-3 mb-0">
              Si habilitas OAuth 2.0 sobre una integration record existente, NetSuite indica que cuando la
              integracion ya usaba TBA puedes reutilizar el mismo client ID y client secret o resetearlos
              para generar nuevos. Para desarrollo local, usa un tunnel HTTPS hacia este backend o una URL
              HTTPS de staging.
            </p>
          </div>
        </div>
      </div>

      <div className="col-12">
        <div className="lab-kpi-grid">
          <div className="lab-kpi">
            <span>Connected blocks</span>
            <strong>{analysis ? metrics.connected : '--'}</strong>
          </div>
          <div className="lab-kpi">
            <span>Errored blocks</span>
            <strong>{analysis ? metrics.blocked : starterQueries.length > 0 ? starterQueries.length : '--'}</strong>
          </div>
          <div className="lab-kpi">
            <span>Rows sampled</span>
            <strong>{analysis ? metrics.rows : '--'}</strong>
          </div>
        </div>
      </div>

      {analysis ? (
        analysis.queries.map((query) => <AnalysisQueryCard key={query.id} query={query} />)
      ) : starterQueries.length > 0 ? (
        starterQueries.map((query) => <StarterQueryCard key={query.id} query={query} />)
      ) : (
        <div className="col-12">
          <div className="surface-card card">
            <div className="card-body text-secondary">
              {isRefreshing
                ? 'Consultando NetSuite...'
                : 'La consola esta lista para correr el bootstrap en cuanto el backend tenga acceso.'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function AnalysisQueryCard({ query }: { query: NetSuiteAnalysisQueryResult }) {
  const columns = query.items?.length ? Object.keys(query.items[0]) : []

  return (
    <div className="col-12">
      <div className="surface-card card analysis-card">
        <div className="card-body">
          <div className="analysis-card__header">
            <div>
              <div className="eyebrow">{query.id}</div>
              <h3 className="h4 mb-2">{query.title}</h3>
              <p className="text-secondary mb-0">{query.purpose}</p>
            </div>

            <div className="analysis-card__meta">
              <span className={analysisStatusClass(query.status)}>
                {query.status === 'ok' ? 'Ready' : 'Error'}
              </span>
              <div className="small text-secondary">
                Limit {query.limit}
                {typeof query.count === 'number' ? ` | Count ${query.count}` : ''}
                {typeof query.totalResults === 'number' ? ` | Total ${query.totalResults}` : ''}
              </div>
            </div>
          </div>

          <div className="row g-3 mt-1">
            <div className="col-xl-7">
              <div className="example-panel">
                <div className="example-panel__title">SuiteQL</div>
                <pre className="sql-panel mb-0">{query.query}</pre>
              </div>
            </div>

            <div className="col-xl-5">
              <div className="example-panel h-100">
                <div className="example-panel__title">Estado</div>
                <div className="summary-list">
                  <div className="summary-list__item">
                    <span>HTTP status</span>
                    <strong>{query.statusCode ?? '--'}</strong>
                  </div>
                  <div className="summary-list__item">
                    <span>Rows returned</span>
                    <strong>{query.items?.length ?? 0}</strong>
                  </div>
                  <div className="summary-list__item">
                    <span>Backend block</span>
                    <strong>{query.status}</strong>
                  </div>
                </div>

                {query.error ? <div className="alert alert-warning mt-3 mb-0">{query.error}</div> : null}
              </div>
            </div>
          </div>

          {query.status === 'ok' ? (
            query.items && query.items.length > 0 ? (
              <div className="table-responsive analysis-table mt-3">
                <table className="table align-middle mb-0">
                  <thead>
                    <tr>
                      {columns.map((column) => (
                        <th key={column}>{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {query.items.map((row, index) => (
                      <tr key={`${query.id}-${index}`}>
                        {columns.map((column) => (
                          <td key={`${query.id}-${index}-${column}`}>{formatCell(row[column])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="note-strip mt-3">
                La consulta corrio bien, pero no devolvio filas con este muestreo.
              </div>
            )
          ) : null}
        </div>
      </div>
    </div>
  )
}

function StarterQueryCard({ query }: { query: NetSuiteAnalysisQueryDefinition }) {
  return (
    <div className="col-12">
      <div className="surface-card card analysis-card">
        <div className="card-body">
          <div className="analysis-card__header">
            <div>
              <div className="eyebrow">{query.id}</div>
              <h3 className="h4 mb-2">{query.title}</h3>
              <p className="text-secondary mb-0">{query.purpose}</p>
            </div>

            <div className="analysis-card__meta">
              <span className="status-pill status-pill--idle">Waiting for credentials</span>
              <div className="small text-secondary">Limit {query.limit}</div>
            </div>
          </div>

          <div className="note-strip note-strip--accent mt-3">
            Aun no hay una sesion OAuth 2.0 activa o el backend sigue en otro modo. En cuanto autorices la
            integracion, esta misma pantalla correra la lectura real.
          </div>

          <div className="example-panel mt-3">
            <div className="example-panel__title">Starter SuiteQL</div>
            <pre className="sql-panel mb-0">{query.query}</pre>
          </div>
        </div>
      </div>
    </div>
  )
}

function analysisStatusClass(status: 'ok' | 'error') {
  return `status-pill status-pill--${status === 'ok' ? 'healthy' : 'error'}`
}

function parseAnalysisError(reason: unknown) {
  if (reason instanceof HttpClientError) {
    const payload = safeParseBody(reason.body)
    return {
      error: payload?.error ?? reason.message,
      starterQueries: payload?.starterQueries ?? [],
    }
  }

  if (reason instanceof Error) {
    return {
      error: reason.message,
      starterQueries: [],
    }
  }

  return {
    error: 'Unable to load NetSuite analysis bootstrap.',
    starterQueries: [],
  }
}

function safeParseBody(body?: string) {
  if (!body) {
    return null
  }

  try {
    return JSON.parse(body) as AnalysisErrorPayload
  } catch {
    return null
  }
}

function formatCell(value: unknown) {
  if (value === null || typeof value === 'undefined') {
    return '--'
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }

  return String(value)
}

function flagLabel(value?: boolean) {
  if (typeof value !== 'boolean') {
    return '--'
  }

  return value ? 'Yes' : 'No'
}
