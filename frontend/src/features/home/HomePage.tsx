import { NavLink } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { fetchOverview, type OverviewResponse } from '../../services/api/reconciliationApi'

type OverviewState = OverviewResponse | null
type InventorySnapshot = NonNullable<OverviewResponse['inventory']>

const defaultInventory: InventorySnapshot = {
  inboundLoads: 8,
  activePickWaves: 3,
  cycleCountTasks: 12,
  criticalAlerts: 4,
  occupancyRate: 82,
  stagingUtilizationRate: 64,
  reserveUtilizationRate: 47,
  pickAccuracyRate: 98,
  dispatchReadinessRate: 91,
  recommendedLens: 'recepcion',
}

function revealStyle(delayMs: number) {
  return {
    animationDelay: `${delayMs}ms`,
  }
}

function formatSyncLabel(value?: string | null) {
  if (!value) {
    return 'Sin dato reciente'
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

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat('es-MX', {
    maximumFractionDigits: 0,
  }).format(value)
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`
}

function resolveHealthTone(health?: string | null) {
  switch (health) {
    case 'healthy':
      return 'healthy'
    case 'ready':
      return 'ready'
    case 'review':
    case 'period-review':
      return 'review'
    case 'exception':
    case 'error':
      return 'error'
    default:
      return 'idle'
  }
}

function resolveHealthLabel(health?: string | null, telemetryError = false) {
  switch (health) {
    case 'healthy':
      return 'Conector estable'
    case 'ready':
      return 'Listo para operar'
    case 'review':
    case 'period-review':
      return 'Requiere atencion'
    case 'exception':
    case 'error':
      return 'Incidencia detectada'
    default:
      return telemetryError ? 'Sin telemetria' : 'Sincronizando'
  }
}

export function HomePage() {
  const [overview, setOverview] = useState<OverviewState>(null)
  const [telemetryError, setTelemetryError] = useState(false)

  useEffect(() => {
    let active = true

    fetchOverview()
      .then((response) => {
        if (active) {
          setOverview(response)
        }
      })
      .catch(() => {
        if (active) {
          setTelemetryError(true)
        }
      })

    return () => {
      active = false
    }
  }, [])

  const inventory = overview?.inventory ?? defaultInventory
  const healthTone = resolveHealthTone(overview?.health)
  const healthLabel = resolveHealthLabel(overview?.health, telemetryError)

  const homePulse = [
    {
      title: 'Recepciones pendientes',
      value: formatCompactNumber(overview?.pendingReceipts ?? inventory.inboundLoads),
      caption: 'Movimientos esperando validacion o entrada formal a piso.',
    },
    {
      title: 'Frentes listos',
      value: formatCompactNumber(overview?.readyToApply ?? inventory.activePickWaves),
      caption: 'Bloques que ya pueden moverse sin abrir una revision adicional.',
    },
    {
      title: 'Casos en revision',
      value: formatCompactNumber(overview?.needsReview ?? inventory.criticalAlerts),
      caption: 'Items que necesitan atencion antes de cerrar el siguiente corte.',
    },
    {
      title: 'Reglas activas',
      value: formatCompactNumber(overview?.totalRules ?? 0),
      caption: 'Reglas operativas disponibles para soporte del flujo general.',
    },
  ]

  const moduleCards = [
    {
      to: '/inventario/',
      eyebrow: 'Modulo central',
      title: 'Inventario',
      detail: 'Recibo, surtido, conteos, control y la nueva seccion de Ajustes.',
      metricLabel: 'Alertas activas',
      metricValue: formatCompactNumber(inventory.criticalAlerts),
    },
    {
      to: '/ingresos',
      eyebrow: 'Operacion',
      title: 'Ingresos',
      detail: 'Entradas, pendientes y estados listos para seguimiento comercial.',
      metricLabel: 'Recepciones',
      metricValue: formatCompactNumber(overview?.pendingReceipts ?? inventory.inboundLoads),
    },
    {
      to: '/bancos',
      eyebrow: 'Finanzas',
      title: 'Bancos',
      detail: 'Cruces bancarios, homologacion y trazabilidad de pagos o depositos.',
      metricLabel: 'Revision',
      metricValue: formatCompactNumber(overview?.needsReview ?? inventory.criticalAlerts),
    },
    {
      to: '/facturas-sat',
      eyebrow: 'Documentos',
      title: 'Facturas SAT',
      detail: 'Analisis fiscal y soporte documental ligado a la operacion.',
      metricLabel: 'Listos',
      metricValue: formatCompactNumber(overview?.readyToApply ?? inventory.activePickWaves),
    },
    {
      to: '/entidades',
      eyebrow: 'Catalogos',
      title: 'Entidades',
      detail: 'Referencias maestras, cuentas y datos de soporte para ejecutar.',
      metricLabel: 'Reglas',
      metricValue: formatCompactNumber(overview?.totalRules ?? 0),
    },
    {
      to: '/search-find',
      eyebrow: 'Consulta',
      title: 'Busqueda',
      detail: 'Busquedas y localizacion rapida para revisar el estado de cualquier frente.',
      metricLabel: 'Sincronizacion',
      metricValue: formatSyncLabel(overview?.lastSyncUtc),
    },
  ]

  const focusItems = [
    {
      title: 'HOME ya concentra la vista general',
      detail:
        'Desde aqui se entra a Inventario, Ingresos, Bancos y el resto de modulos sin depender del dashboard anterior.',
    },
    {
      title: 'Inventario queda como ruta separada',
      detail:
        'La cabecera principal ahora manda a un modulo dedicado para trabajar recibo, surtido, conteos y ajustes.',
    },
    {
      title: 'Salud operativa en una sola mirada',
      detail: telemetryError
        ? 'No se logro leer telemetria en este momento, pero HOME sigue util con un snapshot base.'
        : `${formatPercent(inventory.dispatchReadinessRate)} del despacho y ${formatPercent(
            inventory.pickAccuracyRate,
          )} de precision estimada sostienen la jornada actual.`,
    },
  ]

  return (
    <div className="home-dashboard">
      <section className="surface-card card home-hero" data-reveal style={revealStyle(0)}>
        <div className="card-body">
          <div className="row g-4 align-items-stretch">
            <div className="col-xl-7">
              <div className="home-hero__copy">
                <div className="eyebrow">HOME</div>
                <h2>Vista general de toda la operacion</h2>
                <p>
                  Esta ruta queda como el acceso principal para recorrer el sistema completo,
                  revisar el estado general y entrar a cada modulo desde una sola portada.
                </p>

                <div className="home-hero__actions">
                  <NavLink to="/inventario/" className="home-cta home-cta--primary">
                    Abrir Inventario
                  </NavLink>
                  <NavLink to="/ingresos" className="home-cta">
                    Ir a Ingresos
                  </NavLink>
                </div>
              </div>
            </div>

            <div className="col-xl-5">
              <div className="home-hero__status">
                <div className="home-hero__status-top">
                  <div>
                    <span>Estado general</span>
                    <strong>{healthLabel}</strong>
                  </div>
                  <div className={`status-pill status-pill--${healthTone}`}>{healthLabel}</div>
                </div>

                <div className="home-hero__metrics">
                  <div className="home-mini-metric">
                    <span>Ultima senal</span>
                    <strong>{formatSyncLabel(overview?.lastSyncUtc)}</strong>
                  </div>
                  <div className="home-mini-metric">
                    <span>Ocupacion</span>
                    <strong>{formatPercent(inventory.occupancyRate)}</strong>
                  </div>
                  <div className="home-mini-metric">
                    <span>Despacho listo</span>
                    <strong>{formatPercent(inventory.dispatchReadinessRate)}</strong>
                  </div>
                </div>

                <p className="home-hero__note">
                  {telemetryError
                    ? 'La portada HOME sigue activa con datos base mientras se recupera la telemetria.'
                    : `Inventario marca ${formatCompactNumber(
                        inventory.criticalAlerts,
                      )} alertas activas y ${formatCompactNumber(
                        inventory.cycleCountTasks,
                      )} conteos abiertos en este momento.`}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="row g-4">
        {homePulse.map((item, index) => (
          <div key={item.title} className="col-md-6 col-xl-3">
            <div
              className="surface-card card home-pulse-card"
              data-reveal
              style={revealStyle(90 + index * 70)}
            >
              <div className="card-body">
                <div className="eyebrow">{item.title}</div>
                <div className="metric-value">{item.value}</div>
                <p className="metric-caption mt-2">{item.caption}</p>
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="row g-4">
        <div className="col-xl-8">
          <div className="surface-card card" data-reveal style={revealStyle(320)}>
            <div className="card-body">
              <div className="eyebrow">Mapa general</div>
              <h3 className="h4 mb-3">Entradas disponibles en HOME</h3>

              <div className="home-route-grid">
                {moduleCards.map((card) => (
                  <NavLink key={card.to} to={card.to} className="home-route-card">
                    <span>{card.eyebrow}</span>
                    <strong>{card.title}</strong>
                    <p>{card.detail}</p>
                    <small>{card.metricLabel}</small>
                    <div className="home-route-card__metric">{card.metricValue}</div>
                  </NavLink>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="col-xl-4">
          <div className="surface-card card" data-reveal style={revealStyle(420)}>
            <div className="card-body">
              <div className="eyebrow">Foco del dia</div>
              <h3 className="h4 mb-3">Que esta moviendo la operacion</h3>

              <div className="home-focus-list">
                {focusItems.map((item) => (
                  <div key={item.title} className="home-focus-item">
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
