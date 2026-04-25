import { NavLink } from 'react-router-dom'

import { getEntityTabPath, type EntityTabDefinition } from './entityTabs'

type EntitiesOverviewPageProps = {
  tabs: EntityTabDefinition[]
}

export function EntitiesOverviewPage({ tabs }: EntitiesOverviewPageProps) {
  return (
    <div className="row g-4">
      <div className="col-12">
        <div className="surface-card card">
          <div className="card-body entities-overview-panel">
            <div className="analysis-toolbar">
              <div>
                <div className="eyebrow">Entidades</div>
                <h2 className="h4 mb-2">Vista general de Entidades</h2>
                <p className="text-secondary mb-0">
                  Desde aqui puedes entrar al catalogo local de clientes, proveedores y cuentas
                  contables sin depender de una sola ruta fija.
                </p>
              </div>
            </div>

            <div className="bank-tabs">
              {tabs.map((tab) => (
                <NavLink key={tab.slug} to={getEntityTabPath(tab.slug)} className="bank-tab">
                  {tab.label}
                </NavLink>
              ))}
            </div>

            <div className="entities-route-grid">
              {tabs.map((tab, index) => (
                <NavLink key={tab.slug} to={getEntityTabPath(tab.slug)} className="entities-route-card">
                  <span>Ruta {index + 1}</span>
                  <strong>{tab.label}</strong>
                  <p>{tab.description}</p>
                  <small>Abrir modulo</small>
                </NavLink>
              ))}
            </div>

            <div className="note-strip note-strip--soft">
              Clientes y Proveedores trabajan con base local sincronizada desde NetSuite. El catalogo SAT
              ahora vive dentro de Cuentas SAT para mantener una sola vista de cuentas.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
