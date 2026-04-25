import { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

const modules = [
  { to: '/home', label: 'HOME' },
  { to: '/inventario/', label: 'Inventario' },
  { to: '/ingresos', label: 'Ingresos' },
  { to: '/egresos', label: 'Egresos' },
  { to: '/bancos', label: 'Bancos' },
  { to: '/facturas-sat', label: 'Facturas (SAT)' },
  { to: '/entidades', label: 'Entidades' },
  { to: '/search-find', label: 'Search / Find' },
]

type ConsoleHeaderSection = {
  badge: string
  eyebrow: string
  title: string
  to: string
  detail: string
}

const defaultHeaderSection: ConsoleHeaderSection = {
  badge: 'HM',
  eyebrow: 'Centro operativo general',
  title: 'HOME',
  to: '/home',
  detail:
    'Portada general para entrar a Inventario, Ingresos, Bancos, Facturas (SAT), Entidades y Search / Find.',
}

const bankTitleBySlug: Record<string, string> = {
  payana: 'Payana - Higo',
  'payana-higo': 'Payana - Higo',
  clara_corriente: 'Clara Corriente',
  'clara-corriente': 'Clara Corriente',
  bbva: 'BBVA',
}

const facturasSatPanelTitleBySlug: Record<string, string> = {
  status: 'Operacion SAT local',
  request: 'Solicitud SAT',
  solicitud: 'Solicitud SAT',
  packages: 'Paquetes SAT',
  paquetes: 'Paquetes SAT',
  analysis: 'Analisis SAT',
  analisis: 'Analisis SAT',
  homologation: 'Homologacion manual',
  homologacion: 'Homologacion manual',
  preview: 'Preview NetSuite',
}

const entityTitleByKind: Record<string, string> = {
  clientes: 'Clientes',
  proveedores: 'Proveedores',
  cuentas: 'Cuentas',
}

function normalizePathname(pathname: string) {
  if (!pathname || pathname === '/') {
    return '/'
  }

  return pathname.endsWith('/') ? pathname.slice(0, -1) || '/' : pathname
}

function resolveHeaderSection(pathname: string): ConsoleHeaderSection {
  const normalizedPathname = normalizePathname(pathname)

  if (normalizedPathname === '/inventario' || normalizedPathname.startsWith('/inventario/')) {
    return {
      badge: 'IN',
      eyebrow: 'Centro operativo general',
      title: 'Inventario',
      to: '/inventario/',
      detail: 'Ruta dedicada a recibo, surtido, conteos y ajustes de inventario.',
    }
  }

  if (normalizedPathname === '/ingresos' || normalizedPathname.startsWith('/ingresos/')) {
    return {
      badge: 'IG',
      eyebrow: 'Centro operativo general',
      title: 'Ingresos',
      to: '/ingresos',
      detail:
        'Conciliacion y aplicacion de facturas abiertas de NetSuite, con reglas, creditos y revision de pagos.',
    }
  }

  if (normalizedPathname === '/egresos' || normalizedPathname.startsWith('/egresos/')) {
    return {
      badge: 'EG',
      eyebrow: 'Centro operativo general',
      title: 'Egresos',
      to: '/egresos',
      detail: 'Analisis y aplicacion de creditos sobre facturas recibidas, con foco en conciliacion fiscal.',
    }
  }

  if (normalizedPathname === '/bancos' || normalizedPathname.startsWith('/bancos/')) {
    return {
      badge: 'BK',
      eyebrow: 'Centro operativo general',
      title: 'Bancos',
      to: '/bancos',
      detail: 'Importacion, homologacion y conciliacion bancaria con trazabilidad operativa.',
    }
  }

  if (normalizedPathname === '/facturas-sat' || normalizedPathname.startsWith('/facturas-sat/')) {
    return {
      badge: 'SAT',
      eyebrow: 'Centro operativo general',
      title: 'Facturas (SAT)',
      to: '/facturas-sat',
      detail: 'Descarga, analisis, homologacion y procesamiento de facturas SAT dentro de la operacion.',
    }
  }

  if (normalizedPathname === '/entidades' || normalizedPathname.startsWith('/entidades/')) {
    return {
      badge: 'EN',
      eyebrow: 'Centro operativo general',
      title: 'Entidades',
      to: '/entidades',
      detail: 'Catalogos, homologaciones y referencias maestras para clientes, proveedores y cuentas.',
    }
  }

  if (normalizedPathname === '/search-find' || normalizedPathname.startsWith('/search-find/')) {
    return {
      badge: 'SF',
      eyebrow: 'Centro operativo general',
      title: 'Search / Find',
      to: '/search-find',
      detail: 'Busqueda puntual de transacciones, CFDI y referencias operativas dentro del sistema.',
    }
  }

  return defaultHeaderSection
}

function resolveFacturasSatPanelTitle(pathname: string, search: string) {
  const normalizedPathname = normalizePathname(pathname)
  const searchParams = new URLSearchParams(search)
  const panelFromSearch = searchParams.get('panel')?.trim().toLowerCase() ?? ''

  if (panelFromSearch && facturasSatPanelTitleBySlug[panelFromSearch]) {
    return facturasSatPanelTitleBySlug[panelFromSearch]
  }

  const relativePath = normalizedPathname.replace(/^\/facturas-sat\/?/, '')
  const legacyPanel = relativePath.split('/').filter(Boolean)[0]?.trim().toLowerCase() ?? ''
  return legacyPanel ? facturasSatPanelTitleBySlug[legacyPanel] ?? null : null
}

function resolveDocumentTitle(pathname: string, search: string) {
  const normalizedPathname = normalizePathname(pathname)

  if (normalizedPathname === '/' || normalizedPathname === '/home') {
    return 'HOME'
  }

  if (normalizedPathname === '/inventario/ajustes') {
    return 'Inventario | Ajustes'
  }

  if (normalizedPathname === '/inventario' || normalizedPathname.startsWith('/inventario/')) {
    return 'Inventario'
  }

  if (normalizedPathname === '/ingresos' || normalizedPathname.startsWith('/ingresos/')) {
    return 'Ingresos | Conciliacion'
  }

  if (normalizedPathname === '/egresos/detalleconciliacion') {
    return 'Egresos | Detalle de conciliacion'
  }

  if (normalizedPathname === '/egresos' || normalizedPathname.startsWith('/egresos/')) {
    return 'Egresos | Conciliacion'
  }

  if (normalizedPathname === '/bancos') {
    return 'Bancos'
  }

  if (normalizedPathname.startsWith('/bancos/')) {
    const bankSlug = normalizedPathname.slice('/bancos/'.length).split('/')[0]?.trim().toLowerCase()
    const bankTitle = bankSlug ? bankTitleBySlug[bankSlug] : null
    return bankTitle ? `Bancos | ${bankTitle}` : 'Bancos'
  }

  if (normalizedPathname === '/facturas-sat' || normalizedPathname.startsWith('/facturas-sat/')) {
    const panelTitle = resolveFacturasSatPanelTitle(normalizedPathname, search)
    return panelTitle ? `Facturas (SAT) | ${panelTitle}` : 'Facturas (SAT)'
  }

  if (normalizedPathname === '/entidades') {
    return 'Entidades'
  }

  if (normalizedPathname.startsWith('/entidades/')) {
    const entityKind = normalizedPathname.slice('/entidades/'.length).split('/')[0]?.trim().toLowerCase()
    const entityTitle = entityKind ? entityTitleByKind[entityKind] : null
    return entityTitle ? `Entidades | ${entityTitle}` : 'Entidades'
  }

  if (normalizedPathname === '/search-find' || normalizedPathname.startsWith('/search-find/')) {
    return 'Search / Find'
  }

  return resolveHeaderSection(normalizedPathname).title
}

export function AppShell() {
  const location = useLocation()
  const headerSection = resolveHeaderSection(location.pathname)

  useEffect(() => {
    document.title = resolveDocumentTitle(location.pathname, location.search)
  }, [location.pathname, location.search])

  return (
    <div className="console-shell">
      <div className="console-frame">
        <header className="console-topbar">
          <div className="container-fluid px-0">
            <div className="row g-4 align-items-center">
              <div className="col-lg-5">
                <div className="console-brand">
                  <div className="console-brand__badge">{headerSection.badge}</div>
                  <div className="console-brand__copy">
                    <div className="eyebrow text-white-50 mb-2">{headerSection.eyebrow}</div>
                    <NavLink to={headerSection.to} className="console-brand__title-link">
                      <h1 className="h3 mb-1">{headerSection.title}</h1>
                    </NavLink>
                    <p className="mb-0 text-white-50">{headerSection.detail}</p>
                  </div>
                </div>
              </div>

              <div className="col-lg-7">
                <nav className="console-nav justify-content-lg-end">
                  {modules.map((module) => (
                    <NavLink
                      key={module.to}
                      to={module.to}
                      className={({ isActive }) =>
                        `console-nav__link${isActive ? ' active' : ''}`
                      }
                    >
                      {module.label}
                    </NavLink>
                  ))}
                </nav>
              </div>
            </div>
          </div>
        </header>

        <main className="console-content">
          <div className="container-fluid px-0">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
