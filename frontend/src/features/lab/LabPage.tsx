import { startTransition, useEffect, useMemo, useState } from 'react'
import {
  fetchExampleScenarios,
  fetchPreview,
  type ExampleScenariosResponse,
  type PreviewDecision,
} from '../../services/api/reconciliationApi'

type LabState = Awaited<ReturnType<typeof fetchExampleScenarios>> | null
type LabExample = ExampleScenariosResponse['examples'][number]

const MAX_TOLERANCE = 10

export function LabPage() {
  const [lab, setLab] = useState<LabState>(null)
  const [error, setError] = useState<string | null>(null)
  const [amountTolerance, setAmountTolerance] = useState(0)
  const [liveDecisions, setLiveDecisions] = useState<Record<string, PreviewDecision>>({})
  const [isRefreshing, setIsRefreshing] = useState(false)

  const examples = lab?.examples ?? []
  const recommendedTolerance = lab?.rules.amountTolerance ?? 0

  useEffect(() => {
    fetchExampleScenarios()
      .then((response) => {
        setLab(response)
        setAmountTolerance(response.rules.amountTolerance)
        startTransition(() => {
          setLiveDecisions(Object.fromEntries(response.examples.map((example) => [example.id, example.decision])))
        })
        setError(null)
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Unable to load example scenarios.')
      })
  }, [])

  useEffect(() => {
    if (!lab || examples.length === 0) {
      return
    }

    let cancelled = false
    const timer = setTimeout(() => {
      setIsRefreshing(true)

      Promise.all(
        examples.map(async (example) => {
          const preview = await fetchPreview({
            rules: {
              ...lab.rules,
              amountTolerance,
            },
            receipts: [example.receipt],
            invoices: example.candidateInvoices,
          })

          return [example.id, preview.decisions[0] ?? example.decision] as const
        }),
      )
        .then((entries) => {
          if (cancelled) {
            return
          }

          startTransition(() => {
            setLiveDecisions(Object.fromEntries(entries))
          })
          setError(null)
        })
        .catch((reason: unknown) => {
          if (cancelled) {
            return
          }

          setError(reason instanceof Error ? reason.message : 'Unable to refresh live preview.')
        })
        .finally(() => {
          if (!cancelled) {
            setIsRefreshing(false)
          }
        })
    }, 180)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [amountTolerance, examples, lab])

  const scenarioCards = useMemo(
    () =>
      examples.map((example) => ({
        ...example,
        liveDecision: liveDecisions[example.id] ?? example.decision,
        renderedChecks: renderedRuleChecks(example, amountTolerance),
      })),
    [amountTolerance, examples, liveDecisions],
  )

  const summary = useMemo(() => {
    return scenarioCards.reduce(
      (totals, example) => {
        switch (example.liveDecision.action) {
          case 'AUTO_APPLY':
            totals.autoApply += 1
            break
          case 'EXCEPTION_CASE':
            totals.exception += 1
            break
          default:
            totals.review += 1
            break
        }
        return totals
      },
      { autoApply: 0, review: 0, exception: 0 },
    )
  }, [scenarioCards])

  return (
    <div className="row g-4">
      <div className="col-12">
        <div className="surface-card card">
          <div className="card-body">
            <div className="row g-4 align-items-center">
              <div className="col-lg-8">
                <div className="eyebrow">Bancos</div>
                <h2 className="h3 mb-3">Aqui puedes ver exactamente como esta pensando el motor.</h2>
                <p className="text-secondary mb-0">
                  Esta vista convierte la logica de conciliacion en ejemplos concretos. Cada caso ensena
                  el diario de entrada, las facturas candidatas, los chequeos que pasan o se bloquean y
                  la decision final antes de ejecutar cualquier accion real en NetSuite.
                </p>
              </div>

              <div className="col-lg-4">
                <div className="lab-summary">
                  <div className="lab-summary__item">
                    <span>Escenarios cargados</span>
                    <strong>{examples.length || '--'}</strong>
                  </div>
                  <div className="lab-summary__item">
                    <span>Tolerancia actual</span>
                    <strong>{lab ? `USD ${amountTolerance.toFixed(2)}` : '--'}</strong>
                  </div>
                  <div className="lab-summary__item">
                    <span>Estado del preview</span>
                    <strong>{isRefreshing ? 'Refreshing...' : 'In sync'}</strong>
                  </div>
                </div>
              </div>
            </div>
            {error ? <div className="alert alert-warning mt-3 mb-0">{error}</div> : null}
          </div>
        </div>
      </div>

      <div className="col-xl-7">
        <div className="surface-card card">
          <div className="card-body">
            <div className="eyebrow">Tolerance Simulator</div>
            <h3 className="h5 mb-3">Mueve la perilla y vuelve a correr el preview.</h3>

            <div className="simulator-grid">
              <div className="slider-row">
                <input
                  className="slider-control"
                  type="range"
                  min="0"
                  max={String(MAX_TOLERANCE)}
                  step="0.1"
                  value={amountTolerance}
                  disabled={!lab}
                  onChange={(event) => setAmountTolerance(normalizeTolerance(event.target.value))}
                />
                <div className="slider-meta">
                  <span>USD 0.00</span>
                  <span>USD {MAX_TOLERANCE.toFixed(2)}</span>
                </div>
              </div>

              <div className="control-inline">
                <label className="number-field">
                  <span>Tolerancia manual</span>
                  <input
                    className="number-input"
                    type="number"
                    min="0"
                    max={String(MAX_TOLERANCE)}
                    step="0.1"
                    value={amountTolerance}
                    disabled={!lab}
                    onChange={(event) => setAmountTolerance(normalizeTolerance(event.target.value))}
                  />
                </label>

                <button
                  type="button"
                  className="ghost-button"
                  disabled={!lab}
                  onClick={() => setAmountTolerance(recommendedTolerance)}
                >
                  Reset to recommended
                </button>
              </div>
            </div>

            <div className={`lab-sync mt-3${isRefreshing ? ' lab-sync--busy' : ''}`}>
              {isRefreshing
                ? 'Refreshing scenario decisions with POST /api/reconcile/preview...'
                : 'Using the same backend preview endpoint that will drive real execution later.'}
            </div>
          </div>
        </div>
      </div>

      <div className="col-xl-5">
        <div className="surface-card card">
          <div className="card-body">
            <div className="eyebrow">Active Rule Snapshot</div>
            <div className="summary-list">
              <div className="summary-list__item">
                <span>Recommended baseline</span>
                <strong>{lab ? `USD ${recommendedTolerance.toFixed(2)}` : '--'}</strong>
              </div>
              <div className="summary-list__item">
                <span>Require same subsidiary</span>
                <strong>{flagLabel(lab?.rules.requireSameSubsidiary)}</strong>
              </div>
              <div className="summary-list__item">
                <span>Require same A/R account</span>
                <strong>{flagLabel(lab?.rules.requireSameArAccount)}</strong>
              </div>
              <div className="summary-list__item">
                <span>Many-to-one combinations</span>
                <strong>{enabledLabel(lab?.rules.allowManyToOne)}</strong>
              </div>
              <div className="summary-list__item">
                <span>Evaluation window</span>
                <strong>{lab?.rules.daysWindow ?? '--'} days</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="col-12">
        <div className="lab-kpi-grid">
          <div className="lab-kpi">
            <span>Auto-apply</span>
            <strong>{summary.autoApply}</strong>
          </div>
          <div className="lab-kpi">
            <span>Needs review</span>
            <strong>{summary.review}</strong>
          </div>
          <div className="lab-kpi">
            <span>Exception queue</span>
            <strong>{summary.exception}</strong>
          </div>
        </div>
      </div>

      {scenarioCards.length > 0 ? (
        scenarioCards.map((example, index) => (
          <div key={example.id} className="col-12">
            <div className="surface-card card example-card">
              <div className="card-body">
                <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-4">
                  <div>
                    <div className="eyebrow">Scenario {index + 1}</div>
                    <h3 className="h4 mb-2">{example.title}</h3>
                    <p className="text-secondary mb-0">{example.summary}</p>
                  </div>

                  <div className="text-md-end">
                    <span className={decisionClass(example.liveDecision.action)}>
                      {decisionLabel(example.liveDecision.action)}
                    </span>
                    <div className="text-secondary small mt-2">
                      Stage: {stageLabel(example.liveDecision.stage)}
                    </div>
                  </div>
                </div>

                <div className="row g-4">
                  <div className="col-xl-5">
                    <div className="example-panel">
                      <div className="example-panel__title">Diario de entrada</div>
                      <div className="record-grid">
                        <div>
                          <span>Id</span>
                          <strong>{example.receipt.id}</strong>
                        </div>
                        <div>
                          <span>Cliente</span>
                          <strong>{example.receipt.customerId}</strong>
                        </div>
                        <div>
                          <span>Monto</span>
                          <strong>{formatMoney(example.receipt.currency, example.receipt.amount)}</strong>
                        </div>
                        <div>
                          <span>Periodo</span>
                          <strong>{example.receipt.postingPeriod}</strong>
                        </div>
                        <div>
                          <span>Cuenta A/R</span>
                          <strong>{example.receipt.arAccountId}</strong>
                        </div>
                        <div>
                          <span>Referencia</span>
                          <strong>{example.receipt.reference ?? 'Sin referencia'}</strong>
                        </div>
                      </div>
                      <div className="note-strip mt-3">{example.receipt.memo ?? 'Sin memo operativo.'}</div>
                    </div>

                    <div className="example-panel mt-3">
                      <div className="example-panel__title">Facturas candidatas</div>
                      <div className="summary-list">
                        {example.candidateInvoices.map((invoice) => (
                          <div key={invoice.id} className="summary-list__item">
                            <div>
                              <strong>{invoice.documentNumber ?? invoice.id}</strong>
                              <div className="text-secondary small">{invoice.postingPeriod}</div>
                            </div>
                            <div className="text-end">
                              <strong>{formatMoney(invoice.currency, invoice.openAmount)}</strong>
                              <div className="text-secondary small">{invoice.transactionDate}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="col-xl-7">
                    <div className="example-panel">
                      <div className="example-panel__title">Chequeos evaluados</div>
                      <div className="check-list">
                        {example.renderedChecks.map((check) => (
                          <div key={`${example.id}-${check.label}`} className="check-list__item">
                            <div className="d-flex flex-wrap align-items-center gap-2">
                              <span className={checkClass(check.status)}>{checkLabel(check.status)}</span>
                              <strong>{check.label}</strong>
                            </div>
                            <p className="text-secondary mb-0">{check.detail}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="row g-3 mt-1">
                      <div className="col-md-4">
                        <div className="metric-tile">
                          <span>Confidence</span>
                          <strong>{example.liveDecision.confidence}</strong>
                        </div>
                      </div>
                      <div className="col-md-4">
                        <div className="metric-tile">
                          <span>Diferencia</span>
                          <strong>
                            {formatMoney(example.receipt.currency, example.liveDecision.amountDifference)}
                          </strong>
                        </div>
                      </div>
                      <div className="col-md-4">
                        <div className="metric-tile">
                          <span>Facturas ligadas</span>
                          <strong>{example.liveDecision.matchedInvoiceIds.length}</strong>
                        </div>
                      </div>
                    </div>

                    <div className="example-panel mt-3">
                      <div className="example-panel__title">Salida del motor</div>
                      <div className="summary-list">
                        {example.liveDecision.reasons.map((reason) => (
                          <div key={`${example.id}-${reason}`} className="summary-list__item">
                            <span>{reason}</span>
                          </div>
                        ))}
                      </div>
                      <div className="note-strip mt-3">
                        Simulado con tolerancia de {formatMoney(example.receipt.currency, amountTolerance)}.
                      </div>
                      <div className="note-strip note-strip--accent mt-3">{example.liveDecision.nextStep}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))
      ) : (
        <div className="col-12">
          <div className="surface-card card">
            <div className="card-body text-secondary">Loading example scenarios...</div>
          </div>
        </div>
      )}
    </div>
  )
}

function decisionClass(action: string) {
  switch (action) {
    case 'AUTO_APPLY':
      return 'decision-pill decision-pill--auto'
    case 'EXCEPTION_CASE':
      return 'decision-pill decision-pill--block'
    default:
      return 'decision-pill decision-pill--review'
  }
}

function decisionLabel(action: string) {
  switch (action) {
    case 'AUTO_APPLY':
      return 'Auto-apply'
    case 'REVIEW_TOLERANCE':
      return 'Review tolerance'
    case 'REVIEW_CROSS_PERIOD':
      return 'Review cross period'
    default:
      return 'Exception case'
  }
}

function stageLabel(stage: string) {
  switch (stage) {
    case 'STRICT_EXACT':
      return 'Strict exact match'
    case 'TOLERANCE_REVIEW':
      return 'Tolerance review'
    case 'CROSS_PERIOD_REVIEW':
      return 'Cross-period review'
    default:
      return 'Unmatched'
  }
}

function checkClass(status: 'pass' | 'watch' | 'block') {
  return `check-pill check-pill--${status}`
}

function checkLabel(status: 'pass' | 'watch' | 'block') {
  switch (status) {
    case 'pass':
      return 'Pass'
    case 'watch':
      return 'Watch'
    default:
      return 'Block'
  }
}

function formatMoney(currency: string, amount: number) {
  return `${currency} ${amount.toFixed(2)}`
}

function flagLabel(value?: boolean) {
  if (typeof value !== 'boolean') {
    return '--'
  }
  return value ? 'Yes' : 'No'
}

function enabledLabel(value?: boolean) {
  if (typeof value !== 'boolean') {
    return '--'
  }
  return value ? 'Enabled' : 'Disabled'
}

function normalizeTolerance(value: string) {
  const parsed = Number.parseFloat(value)
  if (Number.isNaN(parsed)) {
    return 0
  }
  return Math.min(MAX_TOLERANCE, Math.max(0, round1(parsed)))
}

function renderedRuleChecks(example: LabExample, amountTolerance: number) {
  if (example.id !== 'tolerance-review') {
    return example.ruleChecks
  }

  return example.ruleChecks.map((check) => {
    if (check.label === 'Importe') {
      return {
        ...check,
        detail: `Existe una diferencia de 0.80 USD. Tolerancia actual: USD ${amountTolerance.toFixed(2)}.`,
      }
    }

    if (check.label === 'Siguiente accion') {
      return {
        ...check,
        detail:
          amountTolerance >= 0.8
            ? 'La diferencia cae dentro de tolerancia y el caso se mantiene en revision para decidir si requiere ajuste.'
            : 'La diferencia supera la tolerancia actual y el caso termina en excepcion.',
      }
    }

    return check
  })
}

function round1(value: number) {
  return Math.round(value * 10) / 10
}
