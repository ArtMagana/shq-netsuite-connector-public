import { NavLink } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { fetchOverview, type OverviewResponse } from '../../services/api/reconciliationApi'

type OverviewState = OverviewResponse | null
type InventorySnapshot = NonNullable<OverviewResponse['inventory']>
type InventoryLensId = InventorySnapshot['recommendedLens']
type InventoryHeaderSection = 'resumen' | 'ajustes'

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

const quickLinks = [
  {
    to: '/ingresos',
    label: 'Ingresos',
    description: 'Entradas, pendientes y movimientos de llegada conectados a la operacion.',
  },
  {
    to: '/bancos',
    label: 'Bancos',
    description: 'Cruza pagos y trazabilidad financiera que impacta compras o recepcion.',
  },
  {
    to: '/facturas-sat',
    label: 'Facturas SAT',
    description: 'Documentos soporte para abastecimiento, validacion y seguimiento.',
  },
  {
    to: '/entidades',
    label: 'Entidades',
    description: 'Catalogos de proveedores, cuentas y referencias listas para trabajar.',
  },
] as const

const priorities = [
  {
    title: 'SKU 45-XL con diferencia en piso',
    detail: 'El fisico no coincide con la ultima ola confirmada y puede frenar surtido.',
    owner: 'Surtido',
    eta: 'Resolver antes de 13:30',
  },
  {
    title: 'Recepcion retenida por etiquetado incompleto',
    detail: 'Mercancia lista para entrar, pero falta cerrar validacion de lote y ubicacion.',
    owner: 'Recibo',
    eta: 'Liberar en el siguiente bloque',
  },
  {
    title: 'Conteo ciclico en rack F-12',
    detail: 'La variacion supera el umbral operativo y requiere segunda revision.',
    owner: 'Conteos',
    eta: 'Escalar si sigue abierto al cierre',
  },
] as const

const timeline = [
  {
    time: '08:10',
    title: 'Inicio de turno',
    detail: 'Se abrieron recepciones y conteos del bloque norte para arrancar sin cola.',
  },
  {
    time: '09:05',
    title: 'Primera ola liberada',
    detail: 'Picking corto para ordenes urgentes con prioridad en producto de alta rotacion.',
  },
  {
    time: '10:20',
    title: 'Revision de diferencias',
    detail: 'Se detecto una variacion en rack F-12 y se aparto el lote para reconteo.',
  },
  {
    time: '11:40',
    title: 'Ventana de reabasto',
    detail: 'Movimiento programado desde reserva para sostener la segunda mitad del dia.',
  },
] as const

const playbook = [
  {
    step: '1',
    title: 'Recibir',
    detail: 'Registrar llegada, validar empaque y mover a staging sin ruido operativo.',
  },
  {
    step: '2',
    title: 'Ubicar',
    detail: 'Definir destino de rack, visibilidad y prioridad de resurtido desde una misma vista.',
  },
  {
    step: '3',
    title: 'Despachar',
    detail: 'Lanzar olas de surtido con alertas claras para diferencias y bloqueos.',
  },
] as const

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

export function DashboardPage() {
  const [overview, setOverview] = useState<OverviewState>(null)
  const [telemetryError, setTelemetryError] = useState(false)
  const [activeLens, setActiveLens] = useState<InventoryLensId>('recepcion')
  const [activeHeaderSection, setActiveHeaderSection] = useState<InventoryHeaderSection>('resumen')
  const summarySectionRef = useRef<HTMLElement | null>(null)
  const settingsSectionRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    let active = true

    fetchOverview()
      .then((response) => {
        if (active) {
          setOverview(response)
          setActiveLens(response.inventory?.recommendedLens ?? 'recepcion')
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

  const healthTone = resolveHealthTone(overview?.health)
  const healthLabel = resolveHealthLabel(overview?.health, telemetryError)
  const inventory = overview?.inventory ?? defaultInventory

  const heroNote = telemetryError
    ? 'No se pudo leer la telemetria del overview. La vista se mantiene funcional con datos base.'
    : `${formatCompactNumber(inventory.inboundLoads)} recepciones activas, ${formatCompactNumber(
        inventory.activePickWaves,
      )} olas abiertas y ${formatPercent(inventory.pickAccuracyRate)} de precision proyectada.`

  const focusSignals = [
    {
      title: 'Recepciones activas',
      value: formatCompactNumber(inventory.inboundLoads),
      caption: `${formatCompactNumber(
        overview?.pendingReceipts ?? inventory.inboundLoads,
      )} movimientos siguen pendientes de validacion.`,
    },
    {
      title: 'Olas de surtido',
      value: formatCompactNumber(inventory.activePickWaves),
      caption: `${formatPercent(
        inventory.dispatchReadinessRate,
      )} del despacho se perfila listo en esta ventana.`,
    },
    {
      title: 'Conteos ciclicos',
      value: formatCompactNumber(inventory.cycleCountTasks),
      caption: `${formatPercent(
        inventory.pickAccuracyRate,
      )} de precision estimada protege el cierre operativo.`,
    },
    {
      title: 'Alertas rojas',
      value: formatCompactNumber(inventory.criticalAlerts),
      caption: `${formatCompactNumber(
        overview?.needsReview ?? inventory.criticalAlerts,
      )} frentes requieren seguimiento inmediato.`,
    },
  ]

  const commandLenses = [
    {
      id: 'recepcion' as const,
      label: 'Recepcion',
      badge: formatCompactNumber(inventory.inboundLoads),
      eyebrow: 'Mesa de control',
      title: 'Entradas listas para confirmar',
      summary:
        'Prioriza andenes, staging y etiquetado inicial sin romper la trazabilidad de lo que entra.',
      primaryMetricLabel: 'Movimientos por validar',
      primaryMetricValue: formatCompactNumber(overview?.pendingReceipts ?? inventory.inboundLoads),
      pills: ['Andenes', 'Etiquetado', 'Staging'],
      stats: [
        {
          label: 'Staging usado',
          value: formatPercent(inventory.stagingUtilizationRate),
        },
        {
          label: 'Ocupacion general',
          value: formatPercent(inventory.occupancyRate),
        },
        {
          label: 'Ultima senal',
          value: formatSyncLabel(overview?.lastSyncUtc),
        },
      ],
      checklist: [
        'Liberar entradas con etiqueta pendiente antes de abrir una nueva cola.',
        'Confirmar ubicacion temporal para lo que aun no sube a rack definitivo.',
        'Separar recibos de alta rotacion para alimentar la siguiente ola de surtido.',
      ],
    },
    {
      id: 'surtido' as const,
      label: 'Surtido',
      badge: formatCompactNumber(inventory.activePickWaves),
      eyebrow: 'Mesa de control',
      title: 'Olas abiertas para despacho',
      summary:
        'Mide cuantas tandas estan activas y cuanto del turno ya se puede empujar hacia packing o salida.',
      primaryMetricLabel: 'Olas en ejecucion',
      primaryMetricValue: formatCompactNumber(inventory.activePickWaves),
      pills: ['Picks', 'Reabasto', 'Packing'],
      stats: [
        {
          label: 'Despacho listo',
          value: formatPercent(inventory.dispatchReadinessRate),
        },
        {
          label: 'Precision estimada',
          value: formatPercent(inventory.pickAccuracyRate),
        },
        {
          label: 'Casos listos',
          value: formatCompactNumber(overview?.readyToApply ?? inventory.activePickWaves),
        },
      ],
      checklist: [
        'Empujar primero los picks cortos para limpiar urgencias sin abrir nuevas excepciones.',
        'Programar reabasto rapido para ubicaciones de alta rotacion antes del siguiente corte.',
        'Cerrar packing de las ordenes ya completas para sostener el ritmo del despacho.',
      ],
    },
    {
      id: 'conteos' as const,
      label: 'Conteos',
      badge: formatCompactNumber(inventory.cycleCountTasks),
      eyebrow: 'Mesa de control',
      title: 'Conteos que sostienen el cierre',
      summary:
        'Combina tareas de conteo ciclico, reconteos y alertas para que la operacion no llegue ciega al cierre.',
      primaryMetricLabel: 'Conteos activos',
      primaryMetricValue: formatCompactNumber(inventory.cycleCountTasks),
      pills: ['Ciclico', 'Reconteo', 'Ajustes'],
      stats: [
        {
          label: 'Alertas criticas',
          value: formatCompactNumber(inventory.criticalAlerts),
        },
        {
          label: 'Reserva usada',
          value: formatPercent(inventory.reserveUtilizationRate),
        },
        {
          label: 'Reglas activas',
          value: formatCompactNumber(overview?.totalRules ?? 0),
        },
      ],
      checklist: [
        'Atacar primero variaciones que impactan surtido o reabasto del mismo turno.',
        'Separar las diferencias repetidas para analisis antes de publicar ajustes.',
        'Cerrar reconteos de pasillos criticos antes del corte del dia.',
      ],
    },
    {
      id: 'control' as const,
      label: 'Control',
      badge: formatCompactNumber(inventory.criticalAlerts),
      eyebrow: 'Mesa de control',
      title: 'Salud operativa y decisiones',
      summary:
        'Une la salud del conector con alertas y revision operativa para leer el estado general del tablero.',
      primaryMetricLabel: 'Frentes en revision',
      primaryMetricValue: formatCompactNumber(
        overview?.needsReview ?? inventory.criticalAlerts,
      ),
      pills: ['Conector', 'Revision', 'Sincronizacion'],
      stats: [
        {
          label: 'Conector',
          value: healthLabel,
        },
        {
          label: 'Ultima senal',
          value: formatSyncLabel(overview?.lastSyncUtc),
        },
        {
          label: 'Precision picking',
          value: formatPercent(inventory.pickAccuracyRate),
        },
      ],
      checklist: [
        'Resolver alertas que bloquean la siguiente accion del turno, no solo las mas visibles.',
        'Mantener sincronizacion util antes de abrir nuevas decisiones de operacion.',
        'Usar reglas y metricas como soporte, no como sustituto del criterio de piso.',
      ],
    },
  ]

  const activeCommandLens =
    commandLenses.find((lens) => lens.id === activeLens) ?? commandLenses[0]

  const serviceCards = [
    {
      title: 'Ocupacion general',
      value: formatPercent(inventory.occupancyRate),
      progress: inventory.occupancyRate,
      detail: 'Capacidad hoy comprometida en zonas activas del almacen.',
    },
    {
      title: 'Precision de picking',
      value: formatPercent(inventory.pickAccuracyRate),
      progress: inventory.pickAccuracyRate,
      detail: 'Lectura operativa para evitar retrabajo, faltantes y correcciones.',
    },
    {
      title: 'Despacho listo',
      value: formatPercent(inventory.dispatchReadinessRate),
      progress: inventory.dispatchReadinessRate,
      detail: 'Ordenes preparadas para sostener la siguiente ventana de salida.',
    },
  ]

  const zoneCards = [
    {
      name: 'Picking A',
      fill: inventory.occupancyRate,
      status: inventory.occupancyRate >= 80 ? 'Alta demanda' : 'Operacion estable',
      detail: 'Zona principal de rotacion y surtido corto durante esta jornada.',
    },
    {
      name: 'Staging Norte',
      fill: inventory.stagingUtilizationRate,
      status: inventory.stagingUtilizationRate >= 70 ? 'Recepcion activa' : 'Recepcion estable',
      detail: 'Buffer de recibo y validacion antes de ubicar o liberar a piso.',
    },
    {
      name: 'Reserva Fria',
      fill: inventory.reserveUtilizationRate,
      status: inventory.reserveUtilizationRate >= 60 ? 'Capacidad media' : 'Monitoreo',
      detail: 'Pulmon de reabasto para sostener el segundo bloque del turno.',
    },
  ]

  const inventorySettings = [
    {
      title: 'Conteos y diferencias',
      detail: 'Reservamos este espacio para los ajustes de conteos, variaciones y criterios de cierre.',
    },
    {
      title: 'Reglas operativas',
      detail: 'Aqui podemos agregar configuracion de flujos, validaciones o permisos del modulo.',
    },
    {
      title: 'Alertas y umbrales',
      detail: 'Este bloque queda listo para definir niveles de alerta, semaforos o excepciones.',
    },
  ]

  function handleHeaderSectionChange(section: InventoryHeaderSection) {
    setActiveHeaderSection(section)

    const target = section === 'ajustes' ? settingsSectionRef.current : summarySectionRef.current
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="inventory-page">
      <section className="surface-card card inventory-route-header" data-reveal style={revealStyle(0)}>
        <div className="card-body">
          <div className="inventory-route-header__top">
            <div className="inventory-route-header__copy">
              <div className="eyebrow">Ruta separada</div>
              <h2>Inventario</h2>
              <p>
                Este modulo ahora vive fuera de HOME para que el recorrido general quede aparte y
                aqui podamos crecer la operacion con mas detalle.
              </p>
            </div>

            <NavLink to="/home" className="inventory-route-header__backlink">
              Volver a HOME
            </NavLink>
          </div>

          <div className="inventory-route-header__tabs" role="tablist" aria-label="Secciones de inventario">
            <button
              type="button"
              role="tab"
              aria-selected={activeHeaderSection === 'resumen'}
              className={`inventory-route-header__tab${
                activeHeaderSection === 'resumen' ? ' active' : ''
              }`}
              onClick={() => handleHeaderSectionChange('resumen')}
            >
              Resumen
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeHeaderSection === 'ajustes'}
              className={`inventory-route-header__tab${
                activeHeaderSection === 'ajustes' ? ' active' : ''
              }`}
              onClick={() => handleHeaderSectionChange('ajustes')}
            >
              Ajustes
            </button>
          </div>
        </div>
      </section>

      <div className="ahora-dashboard">
        <section
          ref={summarySectionRef}
          className="surface-card card ahora-hero"
          data-reveal
          style={revealStyle(70)}
        >
          <div className="card-body">
            <div className="row g-4 align-items-stretch">
              <div className="col-xl-7">
                <div className="ahora-hero__lead">
                  <div className="eyebrow">Modulo Inventario</div>
                  <h2>Inventario</h2>
                  <p>
                    Centro operativo para recibir, ubicar, surtir y vigilar el inventario
                    conectado a NetSuite desde una sola vista.
                  </p>

                  <div className="ahora-chip-row">
                    <div className="ahora-chip">Recepcion</div>
                    <div className="ahora-chip">Ubicaciones</div>
                    <div className="ahora-chip">Conteos</div>
                    <div className="ahora-chip">Surtido</div>
                    <div className="ahora-chip">Alertas</div>
                  </div>
                </div>
              </div>

              <div className="col-xl-5">
                <div className="ahora-hero__glance">
                  <div className="ahora-hero__glance-top">
                    <div>
                      <span>Estado del conector</span>
                      <strong>{healthLabel}</strong>
                    </div>
                    <div className={`status-pill status-pill--${healthTone}`}>{healthLabel}</div>
                  </div>

                  <div className="ahora-hero__metrics">
                    <div className="ahora-mini-metric">
                      <span>Ultima senal</span>
                      <strong>{formatSyncLabel(overview?.lastSyncUtc)}</strong>
                    </div>
                    <div className="ahora-mini-metric">
                      <span>Despacho listo</span>
                      <strong>{formatPercent(inventory.dispatchReadinessRate)}</strong>
                    </div>
                    <div className="ahora-mini-metric">
                      <span>Ocupacion</span>
                      <strong>{formatPercent(inventory.occupancyRate)}</strong>
                    </div>
                  </div>

                  <p className="ahora-hero__note">{heroNote}</p>
                  {telemetryError ? (
                    <div className="ahora-inline-alert">
                      No se pudo leer el overview del backend. La vista usa un snapshot base para que
                      sigamos avanzando.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          ref={settingsSectionRef}
          className="surface-card card inventory-settings-card"
          data-reveal
          style={revealStyle(140)}
        >
          <div className="card-body">
            <div className="inventory-settings-card__top">
              <div>
                <div className="eyebrow">Ajustes</div>
                <h3 className="h4 mb-1">Header de ajustes listo para continuar</h3>
                <p className="text-secondary mb-0">
                  Deje esta seccion creada dentro de Inventario para que me digas el siguiente paso.
                </p>
              </div>

              <div className="inventory-settings-card__status">Pendiente de definir</div>
            </div>

            <div className="inventory-settings-grid">
              {inventorySettings.map((item) => (
                <div key={item.title} className="inventory-settings-item">
                  <span>{item.title}</span>
                  <strong>Espacio reservado</strong>
                  <p>{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="row g-4">
          {focusSignals.map((signal, index) => (
            <div key={signal.title} className="col-md-6 col-xl-3">
              <div
                className="surface-card card ahora-signal-card"
                data-reveal
                style={revealStyle(190 + index * 70)}
              >
                <div className="card-body">
                  <div className="eyebrow">{signal.title}</div>
                  <div className="metric-value">{signal.value}</div>
                  <p className="metric-caption mt-2">{signal.caption}</p>
                </div>
              </div>
            </div>
          ))}
        </section>

        <section className="row g-4">
        <div className="col-xl-7">
          <div className="surface-card card" data-reveal style={revealStyle(240)}>
            <div className="card-body">
              <div className="ahora-section-heading">
                <div>
                  <div className="eyebrow">Mesa principal</div>
                  <h3 className="h4 mb-1">Control por frente operativo</h3>
                  <p className="text-secondary mb-0">
                    Cambia de lente para leer recibo, surtido, conteos o control general sin salir
                    de Inventario.
                  </p>
                </div>
                <div className="ahora-section-tag">{healthLabel}</div>
              </div>

              <div className="ahora-lens-nav" role="tablist" aria-label="Frentes operativos">
                {commandLenses.map((lens) => (
                  <button
                    key={lens.id}
                    type="button"
                    role="tab"
                    aria-selected={activeLens === lens.id}
                    className={`ahora-lens-button${activeLens === lens.id ? ' active' : ''}`}
                    onClick={() => setActiveLens(lens.id)}
                  >
                    <span>{lens.label}</span>
                    <strong>{lens.badge}</strong>
                  </button>
                ))}
              </div>

              <div className="ahora-lens-panel">
                <div className="ahora-lens-panel__top">
                  <div className="ahora-lens-panel__copy">
                    <div className="eyebrow">{activeCommandLens.eyebrow}</div>
                    <h4>{activeCommandLens.title}</h4>
                    <p>{activeCommandLens.summary}</p>
                  </div>

                  <div className="ahora-lens-panel__metric">
                    <span>{activeCommandLens.primaryMetricLabel}</span>
                    <strong>{activeCommandLens.primaryMetricValue}</strong>
                  </div>
                </div>

                <div className="ahora-lens-pill-row">
                  {activeCommandLens.pills.map((pill) => (
                    <div key={pill} className="ahora-lens-pill">
                      {pill}
                    </div>
                  ))}
                </div>

                <div className="ahora-lens-panel__stats">
                  {activeCommandLens.stats.map((stat) => (
                    <div key={stat.label} className="ahora-lens-stat">
                      <span>{stat.label}</span>
                      <strong>{stat.value}</strong>
                    </div>
                  ))}
                </div>

                <div className="ahora-lens-checklist">
                  {activeCommandLens.checklist.map((item, index) => (
                    <div key={item} className="ahora-lens-checklist__item">
                      <strong>{`0${index + 1}`}</strong>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="col-xl-5">
          <div className="surface-card card" data-reveal style={revealStyle(320)}>
            <div className="card-body">
              <div className="eyebrow">Accesos rapidos</div>
              <h3 className="h4 mb-3">Entrar directo a los modulos clave</h3>
              <div className="ahora-link-grid">
                {quickLinks.map((link) => (
                  <NavLink key={link.to} to={link.to} className="ahora-link-card">
                    <span>Modulo</span>
                    <strong>{link.label}</strong>
                    <p>{link.description}</p>
                  </NavLink>
                ))}
              </div>
            </div>
          </div>
        </div>
        </section>

        <section className="row g-4">
        <div className="col-xl-6">
          <div className="surface-card card" data-reveal style={revealStyle(400)}>
            <div className="card-body">
              <div className="eyebrow">Niveles de servicio</div>
              <h3 className="h4 mb-3">Lectura rapida del turno</h3>
              <div className="ahora-service-grid">
                {serviceCards.map((service) => (
                  <div key={service.title} className="ahora-service-card">
                    <div className="ahora-service-card__top">
                      <span>{service.title}</span>
                      <strong>{service.value}</strong>
                    </div>
                    <div className="ahora-service-card__meter" aria-hidden="true">
                      <div
                        className="ahora-service-card__fill"
                        style={{ width: `${service.progress}%` }}
                      />
                    </div>
                    <p>{service.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="col-xl-6">
          <div className="surface-card card" data-reveal style={revealStyle(480)}>
            <div className="card-body">
              <div className="eyebrow">Mapa operativo</div>
              <h3 className="h4 mb-3">Zonas con lectura rapida</h3>
              <div className="ahora-zone-grid">
                {zoneCards.map((zone) => (
                  <div key={zone.name} className="ahora-zone-card">
                    <div className="ahora-zone-card__top">
                      <strong>{zone.name}</strong>
                      <span>{formatPercent(zone.fill)}</span>
                    </div>
                    <div className="ahora-zone-card__meter" aria-hidden="true">
                      <div
                        className="ahora-zone-card__fill"
                        style={{ width: `${zone.fill}%` }}
                      />
                    </div>
                    <div className="ahora-zone-card__meta">
                      <small>{zone.status}</small>
                      <p>{zone.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        </section>

        <section className="row g-4">
        <div className="col-xl-6">
          <div className="surface-card card" data-reveal style={revealStyle(560)}>
            <div className="card-body">
              <div className="eyebrow">Alertas prioritarias</div>
              <h3 className="h4 mb-3">Pendientes que no deben esperar</h3>
              <div className="ahora-priority-list">
                {priorities.map((priority) => (
                  <div key={priority.title} className="ahora-priority-item">
                    <div className="ahora-priority-item__header">
                      <strong>{priority.title}</strong>
                      <span className="ahora-owner-tag">{priority.owner}</span>
                    </div>
                    <p>{priority.detail}</p>
                    <small>{priority.eta}</small>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="col-xl-6">
          <div className="surface-card card" data-reveal style={revealStyle(640)}>
            <div className="card-body">
              <div className="eyebrow">Bitacora en vivo</div>
              <h3 className="h4 mb-3">Ritmo del turno</h3>
              <div className="ahora-timeline">
                {timeline.map((item) => (
                  <div key={`${item.time}-${item.title}`} className="ahora-timeline__item">
                    <div className="ahora-timeline__time">{item.time}</div>
                    <div className="ahora-timeline__dot" aria-hidden="true" />
                    <div className="ahora-timeline__copy">
                      <strong>{item.title}</strong>
                      <p>{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        </section>

        <section className="row g-4">
        <div className="col-12">
          <div className="surface-card card" data-reveal style={revealStyle(720)}>
            <div className="card-body">
              <div className="eyebrow">Modo de trabajo</div>
              <h3 className="h4 mb-3">Como esta pensada la operacion</h3>
              <div className="ahora-playbook">
                {playbook.map((item) => (
                  <div key={item.step} className="ahora-playbook__step">
                    <div className="ahora-playbook__step-index">{item.step}</div>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                  </div>
                ))}
              </div>

              <div className="ahora-callout">
                Inventario ya queda separado de HOME y tambien tiene lista la nueva seccion de
                Ajustes para seguir construyendo contigo.
              </div>
            </div>
          </div>
        </div>
        </section>
      </div>
    </div>
  )
}
