import { useEffect, useState } from 'react'
import { NavLink, useParams } from 'react-router-dom'

import { AccountsPage } from './AccountsPage'
import { EntitiesOverviewPage } from './EntitiesOverviewPage'
import { entityTabs, resolveEntityTab, type EntityTabDefinition } from './entityTabs'
import {
  fetchNetSuiteEntityCatalog,
  syncNetSuiteEntityCatalog,
  type NetSuiteEntityCatalogItem,
  type NetSuiteEntityCatalogKind,
  type NetSuiteEntityCatalogResponse,
} from '../../services/api/reconciliationApi'

type EntityCatalogState = NetSuiteEntityCatalogResponse | null

export function EntitiesPage() {
  const { entityKind } = useParams<{ entityKind?: string }>()
  const activeTab = resolveEntityTab(entityKind)

  if (!entityKind || !activeTab) {
    return <EntitiesOverviewPage tabs={entityTabs} />
  }

  if (activeTab.slug === 'cuentas') {
    return <AccountsPage tabs={entityTabs} />
  }

  return <NetSuiteEntityCatalogPage activeTab={activeTab} tabs={entityTabs} />
}

function NetSuiteEntityCatalogPage({
  activeTab,
  tabs,
}: {
  activeTab: EntityTabDefinition
  tabs: EntityTabDefinition[]
}) {
  const activeEntityKind: NetSuiteEntityCatalogKind =
    activeTab.slug === 'clientes' ? 'customers' : 'suppliers'

  const [catalog, setCatalog] = useState<EntityCatalogState>(null)
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setIsLoading(true)
    setError(null)

    fetchNetSuiteEntityCatalog(activeEntityKind)
      .then((response) => {
        setCatalog(response)
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'No pude cargar la base local de entidades.')
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [activeEntityKind])

  const filteredItems = (catalog?.items ?? []).filter((item) => {
    const normalizedQuery = search.trim().toUpperCase()
    if (!normalizedQuery) {
      return true
    }

    return [item.displayName, item.entityId, item.altName, item.companyName, item.rfc, item.accountDisplayName]
      .map((value) => String(value ?? '').toUpperCase())
      .some((value) => value.includes(normalizedQuery))
  })

  const handleSync = async () => {
    try {
      setIsSyncing(true)
      setError(null)
      setCatalog(await syncNetSuiteEntityCatalog(activeEntityKind))
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'No pude sincronizar la base desde NetSuite.')
    } finally {
      setIsSyncing(false)
    }
  }

  return (
    <div className="row g-4">
      <div className="col-12">
        <div className="surface-card card">
          <div className="card-body">
            <div className="analysis-toolbar">
              <div>
                <div className="eyebrow">Entidades</div>
                <h2 className="h4 mb-2">Base local de clientes y proveedores para equivalencias</h2>
                <p className="text-secondary mb-0">
                  Esta seccion guarda en backend la base de entidades NetSuite y sirve como apoyo local
                  para busquedas, sugerencias y homologaciones sin pegarle a NetSuite cada vez.
                </p>
              </div>

              <div className="analysis-toolbar__actions">
                <button type="button" className="ghost-button" onClick={handleSync} disabled={isSyncing}>
                  {isSyncing ? 'Actualizando base...' : `Actualizar ${activeTab.label} desde NetSuite`}
                </button>
              </div>
            </div>

            <div className="bank-tabs mt-4">
              {tabs.map((tab) => (
                <NavLink
                  key={tab.slug}
                  to={`/entidades/${tab.slug}`}
                  className={({ isActive }) => `bank-tab${isActive ? ' bank-tab--active' : ''}`}
                >
                  {tab.label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="col-xl-4">
        <div className="surface-card card">
          <div className="card-body">
            <div className="eyebrow">Estado</div>
            <h2 className="h4 mb-3">{catalog?.label ?? activeTab.label}</h2>
            <div className="summary-list">
              <div className="summary-list__item">
                <span>Origen</span>
                <strong>{resolveSourceLabel(catalog?.source ?? (isLoading ? 'empty' : 'store'))}</strong>
              </div>
              <div className="summary-list__item">
                <span>Registros</span>
                <strong>{catalog?.count ?? 0}</strong>
              </div>
              <div className="summary-list__item">
                <span>Ultima sincronizacion</span>
                <strong>{catalog?.lastSyncedAtUtc ? formatUtcLabel(catalog.lastSyncedAtUtc) : 'Sin sincronizar'}</strong>
              </div>
              <div className="summary-list__item">
                <span>Store</span>
                <strong className="entity-store-path">{catalog?.storePath ?? 'Cargando...'}</strong>
              </div>
            </div>
            {error ? <div className="alert alert-warning mt-3 mb-0">{error}</div> : null}
          </div>
        </div>
      </div>

      <div className="col-xl-8">
        <div className="surface-card card">
          <div className="card-body">
            <div className="analysis-toolbar mb-3">
              <div>
                <div className="eyebrow">Catalogo local</div>
                <h2 className="h4 mb-1">{activeTab.label}</h2>
                <p className="text-secondary mb-0">
                  Filtra por nombre, codigo, RFC o cuenta contable para revisar la base persistida.
                </p>
              </div>

              <label className="bank-field entity-search">
                <span>Buscar</span>
                <input
                  type="search"
                  className="bank-input"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={`Buscar en ${activeTab.label.toLowerCase()}...`}
                />
              </label>
            </div>

            <div className="note-strip note-strip--accent mb-3">
              El motor de equivalencias ya puede reutilizar esta base local. Si la dejas vacia, el
              backend intentara sembrarla una vez desde NetSuite y luego trabajara sobre el store en NAS.
            </div>

            <div className="table-responsive analysis-table">
              <table className="table align-middle mb-0">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Entidad</th>
                    <th>RFC</th>
                    <th>Cuenta</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={4} className="text-secondary">
                        Cargando base local...
                      </td>
                    </tr>
                  ) : filteredItems.length > 0 ? (
                    filteredItems.map((item) => <EntityCatalogRow key={`${item.recordType}:${item.internalId}`} item={item} />)
                  ) : (
                    <tr>
                      <td colSpan={4} className="text-secondary">
                        No hay entidades que coincidan con el filtro actual.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function EntityCatalogRow({ item }: { item: NetSuiteEntityCatalogItem }) {
  return (
    <tr>
      <td className="text-nowrap">{item.internalId}</td>
      <td>
        <div className="entity-name-cell">
          <strong>{item.displayName}</strong>
          <span>
            {[item.entityId, item.altName, item.companyName]
              .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
              .join(' | ') || 'Sin alias adicional'}
          </span>
        </div>
      </td>
      <td>{item.rfc || 'Sin RFC'}</td>
      <td>{item.accountDisplayName || 'Sin cuenta configurada'}</td>
    </tr>
  )
}

function resolveSourceLabel(source: NetSuiteEntityCatalogResponse['source']) {
  switch (source) {
    case 'netsuite_sync':
      return 'Sincronizado desde NetSuite'
    case 'store':
      return 'Base local'
    default:
      return 'Sin datos'
  }
}

function formatUtcLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('es-MX')
}
