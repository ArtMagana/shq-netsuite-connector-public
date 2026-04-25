import { NavLink } from 'react-router-dom'

function revealStyle(delayMs: number) {
  return {
    animationDelay: `${delayMs}ms`,
  }
}

export function InventoryPage() {
  return (
    <div className="inventory-page">
      <section className="surface-card card inventory-route-header" data-reveal style={revealStyle(0)}>
        <div className="card-body">
          <div className="inventory-route-header__tabs" role="tablist" aria-label="Secciones de inventario">
            <NavLink
              to="/inventario/ajustes"
              className={({ isActive }) =>
                `inventory-route-header__tab${isActive ? ' active' : ''}`
              }
            >
              Ajustes
            </NavLink>
          </div>
        </div>
      </section>
    </div>
  )
}
