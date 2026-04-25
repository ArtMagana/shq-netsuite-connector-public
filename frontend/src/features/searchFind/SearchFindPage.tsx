import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'

import { HttpClientError } from '../../services/api/httpClient'
import {
  fetchSearchTransactionEntities,
  fetchSearchTransactionsBootstrap,
  searchTransactions,
  type SearchTransactionEntityKind,
  type SearchTransactionEntityOptionsResponse,
  type SearchTransactionsBootstrapResponse,
  type SearchTransactionsResponse,
  type SearchTransactionTypeId,
} from '../../services/api/reconciliationApi'

type SearchFindFormState = {
  entityKind: SearchTransactionEntityKind
  entityInternalId: string
  transactionTypeId: SearchTransactionTypeId
  postingPeriodStartId: string
  postingPeriodStartDate: string
  postingPeriodEndId: string
  postingPeriodEndDate: string
  limit: number
}

type SearchFindBootstrapState = SearchTransactionsBootstrapResponse | null
type SearchFindResultsState = SearchTransactionsResponse | null
type SearchFindEntityOption = SearchTransactionEntityOptionsResponse['items'][number]
type SearchFindResultItem = SearchTransactionsResponse['results'][number]
type SearchPostingPeriod = SearchTransactionsBootstrapResponse['postingPeriods'][number]
type SearchPostingPeriodBoundary = 'start' | 'end'

type EntitySearchComboboxProps = {
  label: string
  placeholder: string
  allLabel: string
  options: SearchFindEntityOption[]
  selectedInternalId: string
  disabled: boolean
  isLoading: boolean
  onChange: (nextInternalId: string) => void
}

type SearchPeriodFieldProps = {
  label: string
  value: string
  selectedPeriod: SearchPostingPeriod | null
  minDate: string | null
  maxDate: string | null
  disabled: boolean
  onChange: (nextDate: string) => void
}

const DEFAULT_LIMIT = 25
const MAX_VISIBLE_ENTITY_OPTIONS = 12
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function SearchFindPage() {
  const [bootstrap, setBootstrap] = useState<SearchFindBootstrapState>(null)
  const [results, setResults] = useState<SearchFindResultsState>(null)
  const [entityOptionsByKind, setEntityOptionsByKind] = useState<
    Partial<Record<SearchTransactionEntityKind, SearchFindEntityOption[]>>
  >({})
  const [formState, setFormState] = useState<SearchFindFormState>(() => createDefaultFormState())
  const [isLoadingBootstrap, setIsLoadingBootstrap] = useState(true)
  const [isLoadingEntityOptions, setIsLoadingEntityOptions] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadBootstrap()
  }, [])

  useEffect(() => {
    if (!bootstrap) {
      return
    }

    if (entityOptionsByKind[formState.entityKind]) {
      return
    }

    void loadEntityOptions(formState.entityKind)
  }, [bootstrap, entityOptionsByKind, formState.entityKind])

  const postingPeriods = bootstrap?.postingPeriods ?? []
  const availableTransactionTypes =
    bootstrap?.transactionTypes.filter((item) => item.supportedEntityKinds.includes(formState.entityKind)) ?? []
  const activeEntityOptions = entityOptionsByKind[formState.entityKind] ?? []
  const specificEntityLabel = formState.entityKind === 'supplier' ? 'Proveedor' : 'Cliente'
  const allEntitiesLabel =
    formState.entityKind === 'supplier' ? 'Todos los proveedores' : 'Todos los clientes'

  const selectedStartPeriod = useMemo(
    () => postingPeriods.find((period) => period.internalId === formState.postingPeriodStartId) ?? null,
    [formState.postingPeriodStartId, postingPeriods],
  )
  const selectedEndPeriod = useMemo(
    () => postingPeriods.find((period) => period.internalId === formState.postingPeriodEndId) ?? null,
    [formState.postingPeriodEndId, postingPeriods],
  )

  const minPostingPeriodDate = useMemo(() => getPostingPeriodBoundaryDate(postingPeriods, 'start'), [postingPeriods])
  const maxPostingPeriodDate = useMemo(() => getPostingPeriodBoundaryDate(postingPeriods, 'end'), [postingPeriods])
  const resultTotals = useMemo(
    () => ({
      subtotalBeforeTax: sumSearchResultValues(results?.results ?? [], 'subtotalBeforeTax'),
      taxes: sumSearchResultValues(results?.results ?? [], 'taxes'),
      totalWithTax: sumSearchResultValues(results?.results ?? [], 'totalWithTax'),
    }),
    [results],
  )
  const totalsCurrencyName = useMemo(() => {
    const currencyNames = [...new Set((results?.results ?? []).map((item) => item.currencyName).filter(Boolean))]
    return currencyNames.length === 1 ? currencyNames[0] : null
  }, [results])

  async function loadBootstrap() {
    setIsLoadingBootstrap(true)

    try {
      const response = await fetchSearchTransactionsBootstrap()
      setBootstrap(response)
      setFormState((current) => hydrateFormState(current, response))
      setError(null)
    } catch (reason) {
      setBootstrap(null)
      setError(parseError(reason))
    } finally {
      setIsLoadingBootstrap(false)
    }
  }

  async function loadEntityOptions(entityKind: SearchTransactionEntityKind) {
    setIsLoadingEntityOptions(true)

    try {
      const response = await fetchSearchTransactionEntities(entityKind)
      setEntityOptionsByKind((current) => ({
        ...current,
        [entityKind]: response.items,
      }))
      setFormState((current) =>
        current.entityKind !== entityKind
          ? current
          : {
              ...current,
              entityInternalId: response.items.some((item) => item.internalId === current.entityInternalId)
                ? current.entityInternalId
                : '',
            },
      )
      setError(null)
    } catch (reason) {
      setEntityOptionsByKind((current) => ({
        ...current,
        [entityKind]: [],
      }))
      setError(parseError(reason))
    } finally {
      setIsLoadingEntityOptions(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!formState.postingPeriodStartId || !formState.postingPeriodEndId) {
      setError('Selecciona fechas validas para el periodo contable inicial y final.')
      return
    }

    setIsSearching(true)

    try {
      const response = await searchTransactions({
        entityKind: formState.entityKind,
        transactionTypeId: formState.transactionTypeId,
        postingPeriodStartId: formState.postingPeriodStartId,
        postingPeriodEndId: formState.postingPeriodEndId,
        entityInternalId: formState.entityInternalId || null,
        limit: formState.limit,
      })

      setResults(response)
      setHasSearched(true)
      setError(null)
    } catch (reason) {
      setResults(null)
      setHasSearched(true)
      setError(parseError(reason))
    } finally {
      setIsSearching(false)
    }
  }

  function handleEntityKindChange(entityKind: SearchTransactionEntityKind) {
    setFormState((current) => {
      const nextTransactionType =
        bootstrap?.transactionTypes.find((item) => item.supportedEntityKinds.includes(entityKind))?.id ??
        current.transactionTypeId

      return {
        ...current,
        entityKind,
        entityInternalId: '',
        transactionTypeId: nextTransactionType,
      }
    })
  }

  function handlePostingPeriodDateChange(
    field: SearchPostingPeriodBoundary,
    nextDate: string,
  ) {
    const resolvedPeriod = nextDate ? resolvePostingPeriodFromDate(postingPeriods, nextDate, field) : null

    setFormState((current) => {
      if (field === 'start') {
        return {
          ...current,
          postingPeriodStartDate: nextDate,
          postingPeriodStartId: resolvedPeriod?.internalId ?? '',
        }
      }

      return {
        ...current,
        postingPeriodEndDate: nextDate,
        postingPeriodEndId: resolvedPeriod?.internalId ?? '',
      }
    })

    if (nextDate && !resolvedPeriod) {
      setError('La fecha elegida no pudo convertirse a un periodo contable disponible.')
      return
    }

    setError(null)
  }

  function clearResults() {
    setResults(null)
    setHasSearched(false)
    setError(null)
  }

  return (
    <div className="row g-4">
      <div className="col-xl-8">
        <div className="surface-card card">
          <div className="card-body">
            <div className="analysis-toolbar">
              <div>
                <div className="eyebrow">Search / Find</div>
                <h2 className="h4 mb-2">Buscador independiente de transacciones NetSuite</h2>
                <p className="text-secondary mb-0">
                  Esta seccion corre en modo solo lectura y no ejecuta procesos de otros modulos.
                  Solo consulta NetSuite con filtros propios para ubicar facturas por entidad y
                  periodo contable.
                </p>
              </div>

              <div className="analysis-toolbar__actions">
                <div className="lab-sync">
                  {bootstrap?.generatedAtUtc
                    ? `Catalogos cargados: ${formatUtcLabel(bootstrap.generatedAtUtc)}`
                    : 'Cargando catalogos base...'}
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => void loadBootstrap()}
                  disabled={isLoadingBootstrap}
                >
                  {isLoadingBootstrap ? 'Actualizando filtros...' : 'Recargar filtros'}
                </button>
              </div>
            </div>

            <form className="bank-form-grid mt-4" onSubmit={(event) => void handleSubmit(event)}>
              <label className="bank-field">
                <span>Entidad</span>
                <select
                  className="bank-select"
                  value={formState.entityKind}
                  onChange={(event) =>
                    handleEntityKindChange(event.target.value as SearchTransactionEntityKind)
                  }
                  disabled={isLoadingBootstrap || isSearching}
                >
                  {(bootstrap?.entityKinds ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              <EntitySearchCombobox
                key={formState.entityKind}
                label={specificEntityLabel}
                placeholder={`Teclea nombre, RFC o codigo del ${specificEntityLabel.toLowerCase()}...`}
                allLabel={allEntitiesLabel}
                options={activeEntityOptions}
                selectedInternalId={formState.entityInternalId}
                disabled={isLoadingBootstrap || isLoadingEntityOptions || isSearching}
                isLoading={isLoadingEntityOptions}
                onChange={(nextInternalId) =>
                  setFormState((current) => ({
                    ...current,
                    entityInternalId: nextInternalId,
                  }))
                }
              />

              <label className="bank-field">
                <span>Tipo de transaccion</span>
                <select
                  className="bank-select"
                  value={formState.transactionTypeId}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      transactionTypeId: event.target.value as SearchTransactionTypeId,
                    }))
                  }
                  disabled={isLoadingBootstrap || isSearching}
                >
                  {availableTransactionTypes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <small>
                  La base ya queda preparada para crecer a otros tipos, pero este primer corte
                  trabaja con facturas.
                </small>
              </label>

              <div className="bank-field bank-field--wide">
                <span>Periodo contable</span>
                <div className="search-period-grid">
                  <SearchPeriodField
                    label="Fecha inicial"
                    value={formState.postingPeriodStartDate}
                    selectedPeriod={selectedStartPeriod}
                    minDate={minPostingPeriodDate}
                    maxDate={maxPostingPeriodDate}
                    disabled={isLoadingBootstrap || isSearching}
                    onChange={(nextDate) => handlePostingPeriodDateChange('start', nextDate)}
                  />
                  <SearchPeriodField
                    label="Fecha final"
                    value={formState.postingPeriodEndDate}
                    selectedPeriod={selectedEndPeriod}
                    minDate={minPostingPeriodDate}
                    maxDate={maxPostingPeriodDate}
                    disabled={isLoadingBootstrap || isSearching}
                    onChange={(nextDate) => handlePostingPeriodDateChange('end', nextDate)}
                  />
                </div>
                <small>
                  El calendario traduce cada fecha al periodo contable correspondiente de NetSuite.
                </small>
              </div>

              <label className="bank-field">
                <span>Limite de resultados</span>
                <input
                  type="number"
                  min={1}
                  max={40}
                  className="bank-input"
                  value={formState.limit}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      limit: normalizeLimit(event.target.value),
                    }))
                  }
                  disabled={isLoadingBootstrap || isSearching}
                />
                <small>Se consulta en modo controlado para no pegarle de mas a NetSuite.</small>
              </label>

              <div className="bank-actions bank-field bank-field--wide">
                <button
                  type="submit"
                  className="ghost-button"
                  disabled={isLoadingBootstrap || isSearching || postingPeriods.length === 0}
                >
                  {isSearching ? 'Buscando transacciones...' : 'Buscar transacciones'}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={clearResults}
                  disabled={isSearching || (!results && !hasSearched)}
                >
                  Limpiar resultados
                </button>
              </div>
            </form>

            <div className="note-strip note-strip--accent mt-4">
              Search / Find usa un endpoint propio (`/api/search/*`) y no comparte flujo operativo
              con `Ingresos`, `Bancos`, `SAT` ni `Rules`. Solo toma la capa base de autenticacion a
              NetSuite.
            </div>

            {error ? <div className="alert alert-warning mt-3 mb-0">{error}</div> : null}
          </div>
        </div>
      </div>

      <div className="col-xl-4">
        <div className="surface-card card">
          <div className="card-body">
            <div className="eyebrow">Governance</div>
            <h2 className="h4 mb-3">Aislamiento del modulo</h2>
            <div className="summary-list">
              <div className="summary-list__item">
                <span>Modo</span>
                <strong>Read-only</strong>
              </div>
              <div className="summary-list__item">
                <span>Endpoint</span>
                <strong>/api/search/*</strong>
              </div>
              <div className="summary-list__item">
                <span>Procesos vivos</span>
                <strong>No intervenidos</strong>
              </div>
              <div className="summary-list__item">
                <span>Fuentes</span>
                <strong>NetSuite + mapeo local UI</strong>
              </div>
            </div>

            <div className="summary-list mt-4">
              <div className="summary-list__item">
                <span>Resultados</span>
                <strong>{results?.summary.transactions ?? 0}</strong>
              </div>
              <div className="summary-list__item">
                <span>Con folio fiscal</span>
                <strong>{results?.summary.transactionsWithFolioFiscal ?? 0}</strong>
              </div>
              <div className="summary-list__item">
                <span>Lineas SAT</span>
                <strong>{results?.summary.satLines ?? 0}</strong>
              </div>
              <div className="summary-list__item">
                <span>Ultima consulta</span>
                <strong>{results?.generatedAtUtc ? formatUtcLabel(results.generatedAtUtc) : 'Sin ejecutar'}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="col-12">
        <div className="surface-card card">
          <div className="card-body">
            <div className="analysis-card__header">
              <div>
                <div className="eyebrow">Resultados</div>
                <h3 className="h4 mb-1">Transacciones encontradas</h3>
                <p className="text-secondary mb-0">
                  Cada fila conserva el folio fiscal detectado, el subtotal, impuestos, total y la
                  lectura de claves SAT por linea.
                </p>
              </div>

              <div className="analysis-card__meta">
                <span className="status-pill status-pill--healthy">
                  {results ? `Rows ${results.results.length}` : hasSearched ? 'Sin resultados' : 'Pendiente'}
                </span>
                <div className="small text-secondary">
                  {results
                    ? `${results.filters.entityLabel} | ${results.filters.postingPeriodStartName} a ${results.filters.postingPeriodEndName}`
                    : 'Ejecuta una busqueda para poblar esta tabla.'}
                </div>
              </div>
            </div>

            <div className="table-responsive analysis-table mt-3">
              <table className="table align-middle mb-0">
                <thead>
                  <tr>
                    <th>Documento</th>
                    <th>Entidad</th>
                    <th>Fecha</th>
                    <th>Periodo</th>
                    <th>Folio fiscal</th>
                    <th>Clave SAT por linea</th>
                    <th>Subtotal</th>
                    <th>Impuestos</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {isSearching ? (
                    <tr>
                      <td colSpan={9} className="text-secondary">
                        Consultando NetSuite...
                      </td>
                    </tr>
                  ) : results && results.results.length > 0 ? (
                    results.results.map((result) => (
                      <tr key={`${result.recordType}:${result.internalId}`}>
                        <td>
                          <div className="search-result-heading">
                            <strong>{result.transactionNumber ?? result.tranId ?? result.internalId}</strong>
                            <span>{result.recordType === 'vendorBill' ? 'Vendor Bill' : 'Invoice'}</span>
                          </div>
                        </td>
                        <td>
                          <div className="search-result-heading">
                            <strong>{result.entityName ?? '--'}</strong>
                            <span>{result.entityInternalId ?? 'Sin ID'}</span>
                          </div>
                        </td>
                        <td>{formatDateLabel(result.transactionDate)}</td>
                        <td>{result.postingPeriodName ?? '--'}</td>
                        <td className="analysis-break">{result.folioFiscal ?? '--'}</td>
                        <td>
                          {result.satLineCodes.length > 0 ? (
                            <div className="search-line-list">
                              {result.satLineCodes.map((line) => (
                                <div
                                  key={`${result.internalId}:${line.source}:${line.lineNumber}`}
                                  className="search-line-item"
                                >
                                  <strong>
                                    L{line.lineNumber}: {line.satCode ?? '--'}
                                  </strong>
                                  <span>{line.description ?? `Linea ${line.source}`}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-secondary">Sin clave SAT detectable</span>
                          )}
                        </td>
                        <td>{formatAmount(result.subtotalBeforeTax, result.currencyName)}</td>
                        <td>{formatAmount(result.taxes, result.currencyName)}</td>
                        <td>{formatAmount(result.totalWithTax, result.currencyName)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={9} className="text-secondary">
                        {hasSearched
                          ? 'No se encontraron transacciones con ese criterio.'
                          : 'Selecciona entidad, periodo y tipo para ejecutar la primera busqueda.'}
                      </td>
                    </tr>
                  )}
                </tbody>
                {results && results.results.length > 0 ? (
                  <tfoot>
                    <tr className="search-results-total-row">
                      <td colSpan={6}>
                        <div className="search-results-total-label">
                          <strong>Totales</strong>
                          <span>{results.results.length} transacciones en esta consulta</span>
                        </div>
                      </td>
                      <td>{formatAmount(resultTotals.subtotalBeforeTax, totalsCurrencyName)}</td>
                      <td>{formatAmount(resultTotals.taxes, totalsCurrencyName)}</td>
                      <td>{formatAmount(resultTotals.totalWithTax, totalsCurrencyName)}</td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function EntitySearchCombobox({
  label,
  placeholder,
  allLabel,
  options,
  selectedInternalId,
  disabled,
  isLoading,
  onChange,
}: EntitySearchComboboxProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputId = useId()
  const listboxId = `${inputId}-listbox`
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const deferredQuery = useDeferredValue(query)

  const selectedOption = useMemo(
    () => options.find((item) => item.internalId === selectedInternalId) ?? null,
    [options, selectedInternalId],
  )

  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalizeSearchText(deferredQuery)
    const matchingItems = normalizedQuery
      ? options.filter((item) => matchesEntityOption(item, normalizedQuery))
      : options

    return matchingItems.slice(0, MAX_VISIBLE_ENTITY_OPTIONS)
  }, [deferredQuery, options])

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [])

  useEffect(() => {
    setHighlightedIndex(0)
  }, [deferredQuery, isOpen, options.length])

  useEffect(() => {
    if (!selectedInternalId) {
      setQuery('')
    }
  }, [selectedInternalId])

  function handleSelect(nextInternalId: string) {
    onChange(nextInternalId)
    setQuery('')
    setIsOpen(false)
    setHighlightedIndex(0)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!isOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      setIsOpen(true)
      event.preventDefault()
      return
    }

    const itemCount = filteredOptions.length + 1

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex((current) => (current + 1) % Math.max(itemCount, 1))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex((current) => (current - 1 + itemCount) % Math.max(itemCount, 1))
      return
    }

    if (event.key === 'Escape') {
      setIsOpen(false)
      return
    }

    if (event.key === 'Enter' && isOpen) {
      event.preventDefault()
      if (highlightedIndex === 0) {
        handleSelect('')
        return
      }

      const activeOption = filteredOptions[highlightedIndex - 1]
      if (activeOption) {
        handleSelect(activeOption.internalId)
      }
    }
  }

  const resultLabel = isLoading
    ? 'Cargando opciones desde NetSuite...'
    : query.trim()
      ? `${filteredOptions.length} coincidencias visibles`
      : `${options.length} opciones disponibles`

  return (
    <div className="bank-field search-combobox-field">
      <span>{label}</span>
      <div
        ref={rootRef}
        className={`search-combobox${isOpen ? ' search-combobox--open' : ''}${disabled ? ' search-combobox--disabled' : ''}`}
      >
        <div className="search-combobox__control">
          <input
            id={inputId}
            type="search"
            className="search-combobox__input"
            value={query}
            placeholder={placeholder}
            onChange={(event) => {
              setQuery(event.target.value)
              setIsOpen(true)
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            autoComplete="off"
            role="combobox"
            aria-expanded={isOpen}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={
              isOpen ? `${inputId}-option-${highlightedIndex}` : undefined
            }
          />
          <button
            type="button"
            className="search-combobox__toggle"
            onClick={() => setIsOpen((current) => !current)}
            disabled={disabled}
          >
            {isOpen ? 'Cerrar' : 'Abrir'}
          </button>
        </div>

        {isOpen ? (
          <div className="search-combobox__panel" role="listbox" id={listboxId}>
            <button
              id={`${inputId}-option-0`}
              type="button"
              role="option"
              aria-selected={!selectedInternalId}
              className={`search-combobox__option${highlightedIndex === 0 ? ' search-combobox__option--highlighted' : ''}${!selectedInternalId ? ' search-combobox__option--selected' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handleSelect('')}
            >
              <strong>{allLabel}</strong>
              <span>Ejecuta la busqueda sobre toda la base disponible.</span>
            </button>

            {filteredOptions.length > 0 ? (
              filteredOptions.map((item, index) => {
                const isSelected = item.internalId === selectedInternalId
                const optionIndex = index + 1

                return (
                  <button
                    key={item.internalId}
                    id={`${inputId}-option-${optionIndex}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`search-combobox__option${highlightedIndex === optionIndex ? ' search-combobox__option--highlighted' : ''}${isSelected ? ' search-combobox__option--selected' : ''}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleSelect(item.internalId)}
                  >
                    <strong>{item.displayName}</strong>
                    <span>{buildEntityOptionMeta(item)}</span>
                  </button>
                )
              })
            ) : (
              <div className="search-combobox__empty">
                No encontré coincidencias con lo que escribiste.
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="search-combobox__footer">
        <small>{resultLabel}</small>
        {selectedOption ? (
          <div className="search-combobox__selection">
            <div className="search-combobox__selection-copy">
              <span>Filtro activo</span>
              <strong>{formatEntityOptionLabel(selectedOption)}</strong>
            </div>
            <button
              type="button"
              className="ghost-button ghost-button--inline"
              onClick={() => handleSelect('')}
              disabled={disabled}
            >
              Quitar
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function SearchPeriodField({
  label,
  value,
  selectedPeriod,
  minDate,
  maxDate,
  disabled,
  onChange,
}: SearchPeriodFieldProps) {
  return (
    <div className="search-period-card">
      <div className="search-period-card__copy">
        <span>{label}</span>
        <strong>{selectedPeriod?.name ?? 'Selecciona una fecha'}</strong>
        <small>
          {selectedPeriod
            ? formatPostingPeriodRange(selectedPeriod)
            : 'El calendario elegira el periodo contable equivalente.'}
        </small>
      </div>

      <input
        type="date"
        className="search-date-input"
        value={value}
        min={minDate ?? undefined}
        max={maxDate ?? undefined}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
    </div>
  )
}

function createDefaultFormState(): SearchFindFormState {
  return {
    entityKind: 'supplier',
    entityInternalId: '',
    transactionTypeId: 'invoice',
    postingPeriodStartId: '',
    postingPeriodStartDate: '',
    postingPeriodEndId: '',
    postingPeriodEndDate: '',
    limit: DEFAULT_LIMIT,
  }
}

function hydrateFormState(
  current: SearchFindFormState,
  bootstrap: SearchTransactionsBootstrapResponse,
): SearchFindFormState {
  const entityKind = bootstrap.entityKinds.some((item) => item.id === current.entityKind)
    ? current.entityKind
    : bootstrap.entityKinds[0]?.id ?? 'supplier'

  const transactionTypeId =
    bootstrap.transactionTypes.find(
      (item) =>
        item.id === current.transactionTypeId && item.supportedEntityKinds.includes(entityKind),
    )
      ?.id ??
    bootstrap.transactionTypes.find((item) => item.supportedEntityKinds.includes(entityKind))?.id ??
    'invoice'

  const defaultPeriod = bootstrap.postingPeriods[0] ?? null
  const selectedStartPeriod =
    bootstrap.postingPeriods.find((period) => period.internalId === current.postingPeriodStartId) ?? defaultPeriod
  const selectedEndPeriod =
    bootstrap.postingPeriods.find((period) => period.internalId === current.postingPeriodEndId) ?? defaultPeriod

  return {
    entityKind,
    entityInternalId: '',
    transactionTypeId,
    postingPeriodStartId: selectedStartPeriod?.internalId ?? '',
    postingPeriodStartDate: current.postingPeriodStartDate || toDateInputValue(selectedStartPeriod?.startDate) || '',
    postingPeriodEndId: selectedEndPeriod?.internalId ?? '',
    postingPeriodEndDate: current.postingPeriodEndDate || toDateInputValue(selectedEndPeriod?.endDate) || '',
    limit: normalizeLimit(current.limit),
  }
}

function normalizeLimit(value: string | number) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIMIT
  }

  return Math.max(1, Math.min(40, Math.trunc(parsed)))
}

function resolvePostingPeriodFromDate(
  postingPeriods: SearchPostingPeriod[],
  dateValue: string,
  boundary: SearchPostingPeriodBoundary,
) {
  const targetMs = parseFlexibleDateToUtcMs(dateValue)
  if (targetMs === null) {
    return null
  }

  const datedPeriods = postingPeriods
    .map((period) => {
      const startMs = parseFlexibleDateToUtcMs(period.startDate)
      const endMs = parseFlexibleDateToUtcMs(period.endDate) ?? startMs

      if (startMs === null || endMs === null) {
        return null
      }

      return {
        period,
        startMs: Math.min(startMs, endMs),
        endMs: Math.max(startMs, endMs),
      }
    })
    .filter((item): item is { period: SearchPostingPeriod; startMs: number; endMs: number } => item !== null)

  const exactMatch = datedPeriods.find((item) => targetMs >= item.startMs && targetMs <= item.endMs)
  if (exactMatch) {
    return exactMatch.period
  }

  const targetYearMonth = getYearMonthKey(targetMs)
  const sameMonthMatch = datedPeriods.find(
    (item) =>
      getYearMonthKey(item.startMs) === targetYearMonth || getYearMonthKey(item.endMs) === targetYearMonth,
  )
  if (sameMonthMatch) {
    return sameMonthMatch.period
  }

  const nearestMatch = [...datedPeriods].sort((left, right) => {
    const leftAnchor = boundary === 'start' ? left.startMs : left.endMs
    const rightAnchor = boundary === 'start' ? right.startMs : right.endMs
    return Math.abs(leftAnchor - targetMs) - Math.abs(rightAnchor - targetMs)
  })[0]

  return nearestMatch?.period ?? null
}

function getPostingPeriodBoundaryDate(
  postingPeriods: SearchPostingPeriod[],
  boundary: SearchPostingPeriodBoundary,
) {
  const values = postingPeriods
    .map((period) => toDateInputValue(boundary === 'start' ? period.startDate : period.endDate))
    .filter((value): value is string => Boolean(value))
    .sort()

  if (values.length === 0) {
    return null
  }

  return boundary === 'start' ? values[0] : values[values.length - 1]
}

function formatUtcLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('es-MX')
}

function formatDateLabel(value: string | null) {
  const dateInputValue = toDateInputValue(value)
  if (!dateInputValue) {
    return value ?? '--'
  }

  const parsed = new Date(`${dateInputValue}T12:00:00`)
  return Number.isNaN(parsed.getTime()) ? value ?? '--' : parsed.toLocaleDateString('es-MX')
}

function formatAmount(value: number | null, currencyName: string | null) {
  if (value === null) {
    return '--'
  }

  const formatted = new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)

  return currencyName ? `${formatted} ${currencyName}` : formatted
}

function formatPostingPeriodRange(period: SearchPostingPeriod) {
  const rangeParts = [formatDateLabel(period.startDate), formatDateLabel(period.endDate)].filter(
    (value) => value !== '--',
  )

  return rangeParts.length === 2 ? `${rangeParts[0]} a ${rangeParts[1]}` : period.name
}

function formatEntityOptionLabel(item: SearchFindEntityOption) {
  const secondaryParts = [item.entityId, item.rfc].filter(Boolean)
  return secondaryParts.length > 0
    ? `${item.displayName} | ${secondaryParts.join(' | ')}`
    : item.displayName
}

function buildEntityOptionMeta(item: SearchFindEntityOption) {
  const metaParts = [item.entityId, item.rfc, item.altName, item.companyName].filter(
    (value, index, values) => Boolean(value) && values.indexOf(value) === index,
  )

  return metaParts.join(' | ') || 'Sin metadatos adicionales'
}

function matchesEntityOption(item: SearchFindEntityOption, normalizedQuery: string) {
  return [item.displayName, item.entityId, item.altName, item.companyName, item.rfc]
    .map((value) => normalizeSearchText(value))
    .some((value) => value.includes(normalizedQuery))
}

function normalizeSearchText(value: string | null | undefined) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
}

function toDateInputValue(value: string | null | undefined) {
  if (!value) {
    return null
  }

  if (ISO_DATE_PATTERN.test(value)) {
    return value
  }

  const dotDateMatch = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (dotDateMatch) {
    const [, day, month, year] = dotDateMatch
    return `${year}-${String(Number(month)).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return [
    parsed.getFullYear(),
    String(parsed.getMonth() + 1).padStart(2, '0'),
    String(parsed.getDate()).padStart(2, '0'),
  ].join('-')
}

function parseFlexibleDateToUtcMs(value: string | null | undefined) {
  const normalized = toDateInputValue(value)
  if (!normalized) {
    return null
  }

  const [year, month, day] = normalized.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

function getYearMonthKey(utcMs: number) {
  const date = new Date(utcMs)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function sumSearchResultValues(
  results: SearchFindResultItem[],
  field: 'subtotalBeforeTax' | 'taxes' | 'totalWithTax',
) {
  let total = 0
  let hasValue = false

  for (const result of results) {
    const value = result[field]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      continue
    }

    total += value
    hasValue = true
  }

  return hasValue ? total : null
}

function parseError(reason: unknown) {
  if (reason instanceof HttpClientError) {
    try {
      const parsed = reason.body ? (JSON.parse(reason.body) as { error?: string }) : null
      return parsed?.error ?? reason.message
    } catch {
      return reason.body ?? reason.message
    }
  }

  return reason instanceof Error ? reason.message : 'No pude ejecutar la busqueda en Search / Find.'
}
