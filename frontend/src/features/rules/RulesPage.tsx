import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  fetchPolicy,
  fetchPreviewDemo,
  fetchRules,
  fetchRuleDefinitions,
} from '../../services/api/reconciliationApi'

type RulesState = Awaited<ReturnType<typeof fetchRules>> | null
type PreviewState = Awaited<ReturnType<typeof fetchPreviewDemo>> | null
type PolicyState = Awaited<ReturnType<typeof fetchPolicy>> | null
type DefinitionsState = Awaited<ReturnType<typeof fetchRuleDefinitions>> | null

export function RulesPage() {
  const [rules, setRules] = useState<RulesState>(null)
  const [preview, setPreview] = useState<PreviewState>(null)
  const [policy, setPolicy] = useState<PolicyState>(null)
  const [definitions, setDefinitions] = useState<DefinitionsState>(null)
  const [error, setError] = useState<string | null>(null)
  const location = useLocation()
  const highlightedCode = new URLSearchParams(location.search).get('highlight')

  useEffect(() => {
    Promise.all([fetchRules(), fetchPreviewDemo(), fetchPolicy(), fetchRuleDefinitions()])
      .then(([rulesResponse, previewResponse, policyResponse, definitionsResponse]) => {
        setRules(rulesResponse)
        setPreview(previewResponse)
        setPolicy(policyResponse)
        setDefinitions(definitionsResponse)
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Unable to load rules.')
      })
  }, [])

  return (
    <div className="row g-4">
      <div className="col-12">
        <div className="surface-card card">
          <div className="card-body">
            <div className="eyebrow">Definiciones</div>
            <h2 className="h4 mb-3">Criterios operativos vigentes</h2>
            <div className="table-responsive analysis-table">
              <table className="table align-middle mb-0">
                <thead>
                  <tr>
                    <th>Codigo</th>
                    <th>Definicion</th>
                  </tr>
                </thead>
                <tbody>
                  {definitions?.items.length ? (
                    definitions.items.map((definition) => (
                      <tr
                        key={definition.code}
                        id={`rule-${definition.code}`}
                        className={
                          highlightedCode === definition.code ? 'rule-definition-row rule-definition-row--active' : ''
                        }
                      >
                        <td>
                          <span className="status-pill status-pill--ready">{definition.title}</span>
                        </td>
                        <td>{definition.definition}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={2} className="text-secondary">
                        Loading definitions...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="col-xl-5">
        <div className="surface-card card">
          <div className="card-body">
            <div className="eyebrow">Rule Baseline</div>
            <h2 className="h4 mb-3">Parametros configurables del motor</h2>
            <div className="summary-list">
              {rules
                ? Object.entries(rules.rules).map(([key, value]) => (
                    <div key={key} className="summary-list__item">
                      <span>{key}</span>
                      <strong>{String(value)}</strong>
                    </div>
                  ))
                : 'Loading rules...'}
            </div>
          </div>
        </div>
      </div>

      <div className="col-xl-7">
        <div className="surface-card card">
          <div className="card-body">
            <div className="eyebrow">First Production Rule</div>
            <h2 className="h4 mb-3">{policy?.policy.name ?? 'Loading policy...'}</h2>
            <p className="text-secondary">
              {policy?.policy.description ??
                'Loading the first production rule definition for exact journal-to-invoice matching.'}
            </p>

            <div className="row g-3 mb-4">
              <div className="col-md-4">
                <div className="flow-step h-100">
                  <strong>Auto-apply</strong>
                  <ul className="mb-0 ps-3">
                    {policy?.policy.autoApplyCriteria.map((item) => (
                      <li key={item}>{item}</li>
                    )) ?? <li>Loading...</li>}
                  </ul>
                </div>
              </div>

              <div className="col-md-4">
                <div className="flow-step h-100">
                  <strong>Needs review</strong>
                  <ul className="mb-0 ps-3">
                    {policy?.policy.reviewCriteria.map((item) => (
                      <li key={item}>{item}</li>
                    )) ?? <li>Loading...</li>}
                  </ul>
                </div>
              </div>

              <div className="col-md-4">
                <div className="flow-step h-100">
                  <strong>Blocked</strong>
                  <ul className="mb-0 ps-3">
                    {policy?.policy.blockedCriteria.map((item) => (
                      <li key={item}>{item}</li>
                    )) ?? <li>Loading...</li>}
                  </ul>
                </div>
              </div>
            </div>

            <div className="eyebrow">Preview Output</div>
            <h2 className="h4 mb-3">Decision sample before posting anything</h2>
            <div className="rules-preview">
              {preview ? (
                <div className="preview-decision-list">
                  {preview.decisions.map((decision) => (
                    <div key={decision.receiptId} className="preview-decision-list__item">
                      <div>
                        <strong>{decision.receiptId}</strong>
                        <div className="text-secondary small">
                          Facturas: {decision.matchedInvoiceIds.join(', ') || 'Sin match automatico'}
                        </div>
                      </div>
                      <div className="text-md-end">
                        <div className="text-white fw-semibold">{decisionLabel(decision.action)}</div>
                        <div className="text-info-emphasis small">{decision.nextStep}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                'Loading preview...'
              )}
            </div>
            <p className="text-secondary mt-3 mb-0">
              Esta pantalla es donde luego conectaremos tus reglas reales: tolerancias, periodos,
              jerarquia de referencias, criterios por cliente y aprobaciones. Para ver cada caso con
              detalle operativo, la nueva pestana Bancos ya concentra fecha de corte, homologacion
              de contrapartes y carga inicial de archivos bancarios.
            </p>
            {error ? <div className="alert alert-warning mt-3 mb-0">{error}</div> : null}
          </div>
        </div>
      </div>
    </div>
  )
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
