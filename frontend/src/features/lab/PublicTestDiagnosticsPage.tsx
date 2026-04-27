import { useEffect, useState } from 'react'

type HealthPayload = {
  status?: string
  service?: string
  timestampUtc?: string
}

type DiagnosticsState = {
  apiBaseUrl: string
  frontendInternalApiKeyConfigured: boolean
  health: HealthPayload | null
  healthStatus: 'idle' | 'ok' | 'error'
  healthError: string | null
  checkedAtUtc: string | null
}

function resolveDefaultApiBaseUrl() {
  if (typeof window === 'undefined') {
    return 'http://127.0.0.1:3001/api'
  }

  return `${window.location.origin}/api`
}

function createInitialState(): DiagnosticsState {
  return {
    apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? resolveDefaultApiBaseUrl(),
    frontendInternalApiKeyConfigured: Boolean(import.meta.env.VITE_INTERNAL_API_KEY?.trim()),
    health: null,
    healthStatus: 'idle',
    healthError: null,
    checkedAtUtc: null,
  }
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return 'Sin dato'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) {
    return value
  }

  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}

function getHealthBadgeClassName(status: DiagnosticsState['healthStatus']) {
  switch (status) {
    case 'ok':
      return 'status-pill status-pill--healthy'
    case 'error':
      return 'status-pill status-pill--error'
    default:
      return 'status-pill'
  }
}

function getHealthLabel(status: DiagnosticsState['healthStatus']) {
  switch (status) {
    case 'ok':
      return 'Healthcheck OK'
    case 'error':
      return 'Healthcheck FAIL'
    default:
      return 'Pendiente'
  }
}

export function PublicTestDiagnosticsPage() {
  const [state, setState] = useState<DiagnosticsState>(() => createInitialState())

  useEffect(() => {
    let active = true
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? resolveDefaultApiBaseUrl()

    fetch(`${apiBaseUrl}/health`, {
      headers: {
        Accept: 'application/json',
      },
    })
      .then(async (response) => {
        const body = await response.text()
        if (!response.ok) {
          throw new Error(`Healthcheck failed with status ${response.status}.`)
        }

        const payload = JSON.parse(body) as HealthPayload

        if (!active) {
          return
        }

        setState({
          apiBaseUrl,
          frontendInternalApiKeyConfigured: Boolean(import.meta.env.VITE_INTERNAL_API_KEY?.trim()),
          health: payload,
          healthStatus: payload.status === 'ok' ? 'ok' : 'error',
          healthError: payload.status === 'ok' ? null : 'Healthcheck returned an unexpected payload.',
          checkedAtUtc: new Date().toISOString(),
        })
      })
      .catch((error) => {
        if (!active) {
          return
        }

        setState({
          apiBaseUrl,
          frontendInternalApiKeyConfigured: Boolean(import.meta.env.VITE_INTERNAL_API_KEY?.trim()),
          health: null,
          healthStatus: 'error',
          healthError: error instanceof Error ? error.message : 'Unknown healthcheck error.',
          checkedAtUtc: new Date().toISOString(),
        })
      })

    return () => {
      active = false
    }
  }, [])

  return (
    <div className="row g-4">
      <div className="col-12">
        <section className="surface-card card">
          <div className="card-body">
            <div className="eyebrow">Laboratorio web</div>
            <h2 className="h4 mb-3">Diagnostico de la instancia publica de prueba</h2>
            <p className="text-muted mb-4">
              Vista ligera para comprobar que el frontend de laboratorio esta hablando con el backend
              publicado en este ambiente sin exponer secretos ni tocar integraciones reales.
            </p>

            <div className="d-flex flex-wrap gap-3 align-items-center mb-4">
              <span className={getHealthBadgeClassName(state.healthStatus)}>
                {getHealthLabel(state.healthStatus)}
              </span>
              <span className="status-pill">
                Ambiente: <strong>public-test / lab</strong>
              </span>
            </div>

            <div className="row g-3">
              <div className="col-md-6 col-xl-4">
                <div className="border rounded p-3 h-100">
                  <div className="eyebrow mb-2">API base URL</div>
                  <strong>{state.apiBaseUrl}</strong>
                </div>
              </div>

              <div className="col-md-6 col-xl-4">
                <div className="border rounded p-3 h-100">
                  <div className="eyebrow mb-2">Frontend internal API key</div>
                  <strong>{state.frontendInternalApiKeyConfigured ? 'Configured' : 'Missing'}</strong>
                  <p className="mb-0 mt-2 text-muted">
                    Solo se reporta presencia, nunca el valor.
                  </p>
                </div>
              </div>

              <div className="col-md-6 col-xl-4">
                <div className="border rounded p-3 h-100">
                  <div className="eyebrow mb-2">Ultima verificacion</div>
                  <strong>{formatTimestamp(state.checkedAtUtc)}</strong>
                </div>
              </div>

              <div className="col-md-6 col-xl-4">
                <div className="border rounded p-3 h-100">
                  <div className="eyebrow mb-2">Backend service</div>
                  <strong>{state.health?.service ?? 'Sin dato'}</strong>
                </div>
              </div>

              <div className="col-md-6 col-xl-4">
                <div className="border rounded p-3 h-100">
                  <div className="eyebrow mb-2">Health status</div>
                  <strong>{state.health?.status ?? 'Sin dato'}</strong>
                </div>
              </div>

              <div className="col-md-6 col-xl-4">
                <div className="border rounded p-3 h-100">
                  <div className="eyebrow mb-2">Timestamp backend</div>
                  <strong>{formatTimestamp(state.health?.timestampUtc)}</strong>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="eyebrow mb-2">Ultima respuesta de healthcheck</div>
              {state.healthError ? (
                <div className="alert alert-danger mb-0" role="alert">
                  {state.healthError}
                </div>
              ) : (
                <pre className="mb-0 p-3 border rounded bg-light">
                  {JSON.stringify(state.health, null, 2)}
                </pre>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
