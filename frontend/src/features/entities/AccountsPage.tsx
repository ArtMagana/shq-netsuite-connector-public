import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'

import { HttpClientError } from '../../services/api/httpClient'
import {
  createNetSuiteAccountImport,
  fetchClaveSatCatalog,
  fetchNetSuiteAccountCatalog,
  previewNetSuiteAccountImport,
  syncClaveSatCatalog,
  syncNetSuiteAccountCatalog,
  type ClaveSatCatalogItem,
  type ClaveSatCatalogResponse,
  type NetSuiteAccountCatalogItem,
  type NetSuiteAccountCatalogResponse,
  type NetSuiteAccountImportExecutionResponse,
  type NetSuiteAccountImportPreviewResponse,
} from '../../services/api/reconciliationApi'
import type { EntityTabDefinition } from './entityTabs'

type ErrorPayload = {
  error?: string
}

type AccountsPageProps = {
  tabs: EntityTabDefinition[]
}

type AccountView = 'netsuite' | 'sat'

type SatAccountRow = {
  code: string
  description: string
  displayName: string
  rowType: 'parent' | 'child'
  parentCode: string | null
  parentDescription: string | null
  hasParentInCatalog: boolean
}

type SatAccountSummary = {
  parentRows: number
  childRows: number
  orphanChildRows: number
}

const ACCOUNT_TABLE_LIMIT = 500

const ACCOUNT_IMPORT_PLACEHOLDER = [
  'acctNumber\tacctName\tacctType\tparent\tisSummary\tdescription',
  '610-00-00\tGastos comerciales\tExpense\t\ttrue\tRaiz de gastos comerciales',
  '610-01-00\tPublicidad digital\tExpense\t610-00-00\tfalse\tCampañas en plataformas',
  '610-02-00\tMarketplaces\tExpense\t610-00-00\tfalse\tComisiones de marketplaces',
].join('\n')

export function AccountsPage({ tabs }: AccountsPageProps) {
  const [activeView, setActiveView] = useState<AccountView>('netsuite')
  const [catalog, setCatalog] = useState<NetSuiteAccountCatalogResponse | null>(null)
  const [search, setSearch] = useState('')
  const [satCatalog, setSatCatalog] = useState<ClaveSatCatalogResponse | null>(null)
  const [satSearch, setSatSearch] = useState('')
  const [importText, setImportText] = useState(ACCOUNT_IMPORT_PLACEHOLDER)
  const [preview, setPreview] = useState<NetSuiteAccountImportPreviewResponse | null>(null)
  const [execution, setExecution] = useState<NetSuiteAccountImportExecutionResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isSatLoading, setIsSatLoading] = useState(true)
  const [isSatSyncing, setIsSatSyncing] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [satError, setSatError] = useState<string | null>(null)

  useEffect(() => {
    setIsLoading(true)
    setError(null)

    fetchNetSuiteAccountCatalog()
      .then((response) => {
        setCatalog(response)
      })
      .catch((reason: unknown) => {
        setError(parseError(reason, 'No pude cargar el catálogo local de cuentas.'))
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [])

  useEffect(() => {
    setIsSatLoading(true)
    setSatError(null)

    fetchClaveSatCatalog()
      .then((response) => {
        setSatCatalog(response)
      })
      .catch((reason: unknown) => {
        setSatError(parseError(reason, 'No pude cargar las cuentas SAT locales.'))
      })
      .finally(() => {
        setIsSatLoading(false)
      })
  }, [])

  const filteredItems = filterAccountCatalog(catalog?.items ?? [], search)
  const visibleNetSuiteItems = filteredItems.slice(0, ACCOUNT_TABLE_LIMIT)
  const satRows = buildSatAccountRows(satCatalog?.items ?? [])
  const satSummary = buildSatAccountSummary(satRows)
  const filteredSatRows = filterSatAccountRows(satRows, satSearch)
  const visibleSatRows = filteredSatRows.slice(0, ACCOUNT_TABLE_LIMIT)
  const activeImportResponse = execution ?? preview
  const canCreatePreviewRows = Boolean(preview && preview.summary.readyRows > 0)

  const handleSync = async () => {
    try {
      setIsSyncing(true)
      setError(null)
      setCatalog(await syncNetSuiteAccountCatalog())
    } catch (reason: unknown) {
      setError(parseError(reason, 'No pude sincronizar el catálogo de cuentas desde NetSuite.'))
    } finally {
      setIsSyncing(false)
    }
  }

  const handleSatSync = async () => {
    try {
      setIsSatSyncing(true)
      setSatError(null)
      setSatCatalog(await syncClaveSatCatalog())
    } catch (reason: unknown) {
      setSatError(parseError(reason, 'No pude actualizar las cuentas SAT desde ClaveSAT.xlsx.'))
    } finally {
      setIsSatSyncing(false)
    }
  }

  const handlePreview = async () => {
    try {
      setIsPreviewing(true)
      setError(null)
      setExecution(null)
      setPreview(await previewNetSuiteAccountImport(importText))
    } catch (reason: unknown) {
      setPreview(null)
      setExecution(null)
      setError(parseError(reason, 'No pude preparar el preview de las cuentas.'))
    } finally {
      setIsPreviewing(false)
    }
  }

  const handleCreate = async () => {
    try {
      setIsCreating(true)
      setError(null)
      const response = await createNetSuiteAccountImport(importText)
      setExecution(response)
      if (response.syncedCatalog) {
        setCatalog(response.syncedCatalog)
      }
      setPreview(await previewNetSuiteAccountImport(importText))
    } catch (reason: unknown) {
      setError(parseError(reason, 'No pude crear las cuentas faltantes en NetSuite.'))
    } finally {
      setIsCreating(false)
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
                <h2 className="h4 mb-2">Catalogo local de cuentas contables</h2>
                <p className="text-secondary mb-0">
                  Revisa por separado las cuentas sincronizadas desde NetSuite y el catalogo SAT cargado desde
                  ClaveSAT.xlsx.
                </p>
              </div>

              <div className="analysis-toolbar__actions">
                {activeView === 'sat' ? (
                  <button type="button" className="ghost-button" onClick={handleSatSync} disabled={isSatSyncing}>
                    {isSatSyncing ? 'Actualizando Cuentas SAT...' : 'Actualizar Cuentas SAT'}
                  </button>
                ) : (
                  <button type="button" className="ghost-button" onClick={handleSync} disabled={isSyncing}>
                    {isSyncing ? 'Actualizando Cuentas NetSuite...' : 'Actualizar Cuentas NetSuite'}
                  </button>
                )}
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

            <div className="bank-tabs mt-4">
              <button
                type="button"
                className={`bank-tab${activeView === 'netsuite' ? ' bank-tab--active' : ''}`}
                onClick={() => setActiveView('netsuite')}
              >
                Cuentas NetSuite
              </button>
              <button
                type="button"
                className={`bank-tab${activeView === 'sat' ? ' bank-tab--active' : ''}`}
                onClick={() => setActiveView('sat')}
              >
                Cuentas SAT
              </button>
            </div>
          </div>
        </div>
      </div>

      {activeView === 'netsuite' ? (
        <>
          <div className="col-xl-4">
            <div className="surface-card card">
              <div className="card-body">
                <div className="eyebrow">Estado</div>
                <h2 className="h4 mb-3">{catalog?.label ?? 'Cuentas contables'}</h2>
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
                    <span>Última sincronización</span>
                    <strong>
                      {catalog?.lastSyncedAtUtc ? formatUtcLabel(catalog.lastSyncedAtUtc) : 'Sin sincronizar'}
                    </strong>
                  </div>
                  <div className="summary-list__item">
                    <span>Store</span>
                    <strong className="entity-store-path">{catalog?.storePath ?? 'Cargando...'}</strong>
                  </div>
                </div>

                <div className="note-strip note-strip--accent mt-4">
                  La carga no crea nada al pedir preview. El alta real ocurre solo cuando pulsas{' '}
                  <strong>Cargar faltantes en NetSuite</strong>.
                </div>

                <details className="bank-response-details mt-4">
                  <summary>Formato sugerido</summary>
                  <pre>{ACCOUNT_IMPORT_PLACEHOLDER}</pre>
                </details>

                {activeImportResponse?.accountTypeOptions.length ? (
                  <div className="mt-4">
                    <div className="eyebrow mb-2">Tipos aceptados</div>
                    <div className="account-type-pills">
                      {activeImportResponse.accountTypeOptions.map((option) => (
                        <span key={option.id} className="account-type-pill">
                          <strong>{option.id}</strong>
                          <small>{option.label}</small>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {error ? <div className="alert alert-warning mt-4 mb-0">{error}</div> : null}
              </div>
            </div>
          </div>

          <div className="col-xl-8">
            <div className="surface-card card">
              <div className="card-body">
                <div className="analysis-toolbar mb-3">
                  <div>
                    <div className="eyebrow">Catálogo local</div>
                    <h2 className="h4 mb-1">Cuentas sincronizadas</h2>
                    <p className="text-secondary mb-0">
                      Filtra por número, nombre o jerarquía para revisar el catálogo persistido en backend.
                    </p>
                  </div>

                  <label className="bank-field entity-search">
                    <span>Buscar</span>
                    <input
                      type="search"
                      className="bank-input"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Buscar en cuentas..."
                    />
                  </label>
                </div>

                <div className="table-responsive analysis-table">
                  <table className="table align-middle mb-0">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Cuenta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {isLoading ? (
                        <tr>
                          <td colSpan={2} className="text-secondary">
                            Cargando catálogo local...
                          </td>
                        </tr>
                      ) : visibleNetSuiteItems.length > 0 ? (
                        visibleNetSuiteItems.map((item) => <AccountCatalogRow key={item.internalId} item={item} />)
                      ) : (
                        <tr>
                          <td colSpan={2} className="text-secondary">
                            No hay cuentas que coincidan con el filtro actual.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <div className="col-12">
            <div className="surface-card card">
              <div className="card-body">
                <div className="analysis-toolbar mb-3">
                  <div>
                    <div className="eyebrow">Carga masiva</div>
                    <h2 className="h4 mb-1">Preview y alta de cuentas faltantes</h2>
                    <p className="text-secondary mb-0">
                      Acepta TSV pegado desde Excel, CSV con encabezados o el orden por defecto:
                      <code>
                        {' '}
                        acctNumber, acctName, acctType, parent, description, externalId, isInactive, isSummary
                      </code>
                      .
                    </p>
                  </div>

                  <div className="bank-actions">
                    <button type="button" className="ghost-button" onClick={handlePreview} disabled={isPreviewing}>
                      {isPreviewing ? 'Preparando preview...' : 'Previsualizar carga'}
                    </button>
                    <button
                      type="button"
                      className="hero-button"
                      onClick={handleCreate}
                      disabled={isCreating || !canCreatePreviewRows}
                    >
                      {isCreating ? 'Creando cuentas...' : 'Cargar faltantes en NetSuite'}
                    </button>
                  </div>
                </div>

                <label className="bank-field bank-field--wide">
                  <span>Lote de cuentas</span>
                  <textarea
                    className="bank-input account-import-textarea"
                    value={importText}
                    onChange={(event) => setImportText(event.target.value)}
                    placeholder={ACCOUNT_IMPORT_PLACEHOLDER}
                  />
                </label>

                {activeImportResponse ? (
                  <>
                    <div className="bank-summary-grid mt-4">
                      <div className="bank-stat">
                        <span>Filas detectadas</span>
                        <strong>{activeImportResponse.summary.parsedRows}</strong>
                      </div>
                      {'readyRows' in activeImportResponse.summary ? (
                        <div className="bank-stat">
                          <span>Listas</span>
                          <strong>{activeImportResponse.summary.readyRows}</strong>
                        </div>
                      ) : (
                        <div className="bank-stat">
                          <span>Creadas</span>
                          <strong>{activeImportResponse.summary.createdRows}</strong>
                        </div>
                      )}
                      {'existingRows' in activeImportResponse.summary ? (
                        <div className="bank-stat">
                          <span>Ya existentes</span>
                          <strong>{activeImportResponse.summary.existingRows}</strong>
                        </div>
                      ) : (
                        <div className="bank-stat">
                          <span>Omitidas</span>
                          <strong>{activeImportResponse.summary.skippedExistingRows}</strong>
                        </div>
                      )}
                      <div className="bank-stat">
                        <span>Bloqueadas</span>
                        <strong>{activeImportResponse.summary.blockedRows}</strong>
                      </div>
                    </div>

                    <div className="note-strip note-strip--soft mt-4">
                      Delimitador detectado: <strong>{formatDelimiter(activeImportResponse.detectedDelimiter)}</strong>.
                      Encabezado detectado: <strong>{activeImportResponse.detectedHeader ? 'Sí' : 'No'}</strong>.
                      Columnas leídas: <strong>{activeImportResponse.acceptedColumns.join(', ')}</strong>.
                    </div>

                    <div className="table-responsive analysis-table mt-4">
                      <table className="table align-middle mb-0">
                        <thead>
                          <tr>
                            <th>Fila</th>
                            <th>Estatus</th>
                            <th>Número</th>
                            <th>Nombre</th>
                            <th>Tipo</th>
                            <th>Padre</th>
                            <th>Resultado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {execution
                            ? execution.items.map((item) => <ExecutionRow key={item.rowNumber} item={item} />)
                            : preview
                              ? preview.items.map((item) => <PreviewRow key={item.rowNumber} item={item} />)
                              : null}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="col-xl-4">
            <div className="surface-card card">
              <div className="card-body">
                <div className="eyebrow">Estado SAT</div>
                <h2 className="h4 mb-3">{satCatalog?.label ?? 'Cuentas SAT'}</h2>
                <div className="summary-list">
                  <div className="summary-list__item">
                    <span>Origen</span>
                    <strong>
                      {resolveClaveSatSourceLabel(satCatalog?.source ?? (isSatLoading ? 'empty' : 'store'))}
                    </strong>
                  </div>
                  <div className="summary-list__item">
                    <span>Registros Excel</span>
                    <strong>{(satCatalog?.count ?? 0).toLocaleString('es-MX')}</strong>
                  </div>
                  <div className="summary-list__item">
                    <span>Cuentas padre</span>
                    <strong>{satSummary.parentRows.toLocaleString('es-MX')}</strong>
                  </div>
                  <div className="summary-list__item">
                    <span>Cuentas hijas</span>
                    <strong>{satSummary.childRows.toLocaleString('es-MX')}</strong>
                  </div>
                  <div className="summary-list__item">
                    <span>Hijas sin padre en Excel</span>
                    <strong>{satSummary.orphanChildRows.toLocaleString('es-MX')}</strong>
                  </div>
                  <div className="summary-list__item">
                    <span>Ultima sincronizacion</span>
                    <strong>
                      {satCatalog?.lastSyncedAtUtc ? formatUtcLabel(satCatalog.lastSyncedAtUtc) : 'Sin sincronizar'}
                    </strong>
                  </div>
                  <div className="summary-list__item">
                    <span>Workbook</span>
                    <strong className="entity-store-path">{satCatalog?.workbookPath ?? 'Cargando...'}</strong>
                  </div>
                  <div className="summary-list__item">
                    <span>Store</span>
                    <strong className="entity-store-path">{satCatalog?.storePath ?? 'Cargando...'}</strong>
                  </div>
                </div>

                <div className="note-strip note-strip--accent mt-4">
                  Esta seccion es local: no crea ni modifica cuentas en NetSuite.
                </div>

                {satError ? <div className="alert alert-warning mt-4 mb-0">{satError}</div> : null}
              </div>
            </div>
          </div>

          <div className="col-xl-8">
            <div className="surface-card card">
              <div className="card-body">
                <div className="analysis-toolbar mb-3">
                  <div>
                    <div className="eyebrow">Catalogo SAT</div>
                    <h2 className="h4 mb-1">Cuentas padre e hijas desde ClaveSAT.xlsx</h2>
                    <p className="text-secondary mb-0">
                      Las claves terminadas en 00 se muestran como padres; el resto queda colgado de su familia de seis
                      digitos.
                    </p>
                  </div>

                  <label className="bank-field entity-search">
                    <span>Buscar</span>
                    <input
                      type="search"
                      className="bank-input"
                      value={satSearch}
                      onChange={(event) => setSatSearch(event.target.value)}
                      placeholder="Buscar clave SAT..."
                    />
                  </label>
                </div>

                <div className="note-strip note-strip--soft mb-4">
                  Mostrando {visibleSatRows.length.toLocaleString('es-MX')} de{' '}
                  {filteredSatRows.length.toLocaleString('es-MX')} coincidencias. Refina el filtro para revisar una
                  familia o clave concreta.
                </div>

                <div className="table-responsive analysis-table">
                  <table className="table align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Clave SAT</th>
                        <th>Tipo</th>
                        <th>Cuenta SAT</th>
                        <th>Padre</th>
                      </tr>
                    </thead>
                    <tbody>
                      {isSatLoading ? (
                        <tr>
                          <td colSpan={4} className="text-secondary">
                            Cargando catalogo SAT...
                          </td>
                        </tr>
                      ) : visibleSatRows.length > 0 ? (
                        visibleSatRows.map((item) => <SatAccountCatalogRow key={item.code} item={item} />)
                      ) : (
                        <tr>
                          <td colSpan={4} className="text-secondary">
                            No hay cuentas SAT que coincidan con el filtro actual.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function AccountCatalogRow({ item }: { item: NetSuiteAccountCatalogItem }) {
  return (
    <tr>
      <td className="text-nowrap">{item.internalId}</td>
      <td>{item.displayName}</td>
    </tr>
  )
}

function SatAccountCatalogRow({ item }: { item: SatAccountRow }) {
  return (
    <tr>
      <td className="text-nowrap">{item.code}</td>
      <td>
        <span
          className={item.rowType === 'parent' ? 'status-pill status-pill--healthy' : 'status-pill status-pill--review'}
        >
          {item.rowType === 'parent' ? 'Padre' : 'Hija'}
        </span>
      </td>
      <td>{item.displayName}</td>
      <td>
        {item.parentCode
          ? item.parentDescription
            ? `${item.parentCode} ${item.parentDescription}`
            : `${item.parentCode} no viene en Excel`
          : '--'}
      </td>
    </tr>
  )
}

function PreviewRow({ item }: { item: NetSuiteAccountImportPreviewResponse['items'][number] }) {
  return (
    <tr>
      <td>{item.rowNumber}</td>
      <td>
        <span className={resolvePreviewStatusClassName(item.previewStatus)}>
          {formatPreviewStatus(item.previewStatus)}
        </span>
      </td>
      <td>{item.acctNumber ?? '--'}</td>
      <td>{item.acctName ?? '--'}</td>
      <td>{item.acctTypeLabel ?? item.acctTypeInput ?? '--'}</td>
      <td>{item.resolvedParent?.displayName ?? item.parentReference ?? '--'}</td>
      <td>{item.issues[0] ?? item.existingAccount?.displayName ?? 'Lista para crear'}</td>
    </tr>
  )
}

function ExecutionRow({ item }: { item: NetSuiteAccountImportExecutionResponse['items'][number] }) {
  return (
    <tr>
      <td>{item.rowNumber}</td>
      <td>
        <span className={resolveExecutionStatusClassName(item.executionStatus)}>
          {formatExecutionStatus(item.executionStatus)}
        </span>
      </td>
      <td>{item.acctNumber ?? '--'}</td>
      <td>{item.acctName ?? '--'}</td>
      <td>{item.acctTypeLabel ?? item.acctTypeInput ?? '--'}</td>
      <td>{item.resolvedParent?.displayName ?? item.parentReference ?? '--'}</td>
      <td>{item.message}</td>
    </tr>
  )
}

function filterAccountCatalog(items: NetSuiteAccountCatalogItem[], search: string) {
  const normalizedSearch = normalizeSearchText(search)
  if (!normalizedSearch) {
    return items
  }

  return items.filter((item) => normalizeSearchText(item.displayName).includes(normalizedSearch))
}

function buildSatAccountRows(items: ClaveSatCatalogItem[]): SatAccountRow[] {
  const itemsByCode = new Map(items.map((item) => [item.code, item]))

  return items.map((item) => {
    const isParent = item.code.endsWith('00')
    const parentCode = isParent ? null : `${item.code.slice(0, 6)}00`
    const parent = parentCode ? (itemsByCode.get(parentCode) ?? null) : null

    return {
      code: item.code,
      description: item.description,
      displayName: parent
        ? `${item.code} ${parent.description} : ${item.description}`
        : `${item.code} ${item.description}`,
      rowType: isParent ? 'parent' : 'child',
      parentCode,
      parentDescription: parent?.description ?? null,
      hasParentInCatalog: Boolean(parent),
    }
  })
}

function buildSatAccountSummary(items: SatAccountRow[]): SatAccountSummary {
  return items.reduce<SatAccountSummary>(
    (summary, item) => {
      if (item.rowType === 'parent') {
        summary.parentRows += 1
      } else {
        summary.childRows += 1
        if (!item.hasParentInCatalog) {
          summary.orphanChildRows += 1
        }
      }

      return summary
    },
    { parentRows: 0, childRows: 0, orphanChildRows: 0 },
  )
}

function filterSatAccountRows(items: SatAccountRow[], search: string) {
  const normalizedSearch = normalizeSearchText(search)
  if (!normalizedSearch) {
    return items
  }

  return items.filter((item) =>
    [
      item.code,
      item.description,
      item.displayName,
      item.parentCode,
      item.parentDescription,
      item.rowType === 'parent' ? 'padre' : 'hija',
    ].some((value) => normalizeSearchText(value).includes(normalizedSearch)),
  )
}

function resolvePreviewStatusClassName(value: NetSuiteAccountImportPreviewResponse['items'][number]['previewStatus']) {
  switch (value) {
    case 'ready':
      return 'status-pill status-pill--ready'
    case 'existing':
      return 'status-pill status-pill--healthy'
    default:
      return 'status-pill status-pill--exception'
  }
}

function resolveExecutionStatusClassName(
  value: NetSuiteAccountImportExecutionResponse['items'][number]['executionStatus'],
) {
  switch (value) {
    case 'created':
      return 'status-pill status-pill--ready'
    case 'skipped_existing':
      return 'status-pill status-pill--healthy'
    case 'blocked':
      return 'status-pill status-pill--review'
    default:
      return 'status-pill status-pill--exception'
  }
}

function formatPreviewStatus(value: NetSuiteAccountImportPreviewResponse['items'][number]['previewStatus']) {
  switch (value) {
    case 'ready':
      return 'Lista'
    case 'existing':
      return 'Existe'
    default:
      return 'Bloqueada'
  }
}

function formatExecutionStatus(value: NetSuiteAccountImportExecutionResponse['items'][number]['executionStatus']) {
  switch (value) {
    case 'created':
      return 'Creada'
    case 'skipped_existing':
      return 'Omitida'
    case 'blocked':
      return 'Bloqueada'
    case 'failed':
      return 'Error'
  }
}

function formatDelimiter(value: NetSuiteAccountImportPreviewResponse['detectedDelimiter']) {
  switch (value) {
    case 'tab':
      return 'Tabulador'
    case 'comma':
      return 'Coma'
    case 'semicolon':
      return 'Punto y coma'
    case 'pipe':
      return 'Pipe'
    default:
      return 'No identificado'
  }
}

function resolveSourceLabel(source: NetSuiteAccountCatalogResponse['source']) {
  switch (source) {
    case 'netsuite_sync':
      return 'Sincronizado desde NetSuite'
    case 'store':
      return 'Base local'
    default:
      return 'Sin datos'
  }
}

function resolveClaveSatSourceLabel(source: ClaveSatCatalogResponse['source']) {
  switch (source) {
    case 'excel_sync':
      return 'Sincronizado desde ClaveSAT.xlsx'
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

function normalizeSearchText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

function parseError(reason: unknown, fallback: string) {
  if (reason instanceof HttpClientError) {
    const payload = safeParseBody(reason.body)
    return payload?.error ?? reason.message
  }

  if (reason instanceof Error) {
    return reason.message
  }

  return fallback
}

function safeParseBody(body?: string) {
  if (!body) {
    return null
  }

  try {
    return JSON.parse(body) as ErrorPayload
  } catch {
    return null
  }
}
