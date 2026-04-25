import {
  startTransition,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'

import { HttpClientError } from '../../services/api/httpClient'
import {
  fetchInventoryAdjustmentItemSnapshot,
  searchInventoryAdjustmentItems,
  type InventoryAdjustmentItemSearchResult,
  type InventoryAdjustmentItemSnapshotResponse,
  type InventoryAdjustmentLotBalance,
} from '../../services/api/inventoryAdjustmentsApi'
import {
  fetchInventoryLotSummary,
  type InventoryLotSummaryResponse,
} from '../../services/api/inventoryLotSummaryApi'
import {
  executeInventoryLotReplacement,
  type InventoryLotReplacementResponse,
} from '../../services/api/inventoryLotReplacementApi'

const FIXED_REPLACEMENT_ACCOUNT_ID = '445'
const FIXED_REPLACEMENT_ACCOUNT_LABEL =
  '115-01-00 Inventario : inventario'

type AsyncSearchComboboxProps<T> = {
  label: string
  placeholder: string
  helper: string
  emptyLabel: string
  search: (query: string) => Promise<T[]>
  selectedOption: T | null
  disabled: boolean
  onSelect: (option: T | null) => void
  getKey: (option: T) => string
  getTitle: (option: T) => string
  getMeta: (option: T) => string
}

export function InventoryAdjustmentsPage() {
  const [selectedItem, setSelectedItem] = useState<InventoryAdjustmentItemSearchResult | null>(null)
  const [snapshot, setSnapshot] = useState<InventoryAdjustmentItemSnapshotResponse | null>(null)
  const [selectedLotId, setSelectedLotId] = useState('')
  const [manualLot, setManualLot] = useState('')
  const [declaredNewLot, setDeclaredNewLot] = useState('')
  const [declaredProductionDate, setDeclaredProductionDate] = useState('')
  const [declaredExpirationDate, setDeclaredExpirationDate] = useState('')
  const [summary, setSummary] = useState<InventoryLotSummaryResponse | null>(null)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(false)
  const [isLoadingSummary, setIsLoadingSummary] = useState(false)
  const [isExecutingReplacement, setIsExecutingReplacement] = useState(false)
  const [replacementError, setReplacementError] = useState<string | null>(null)
  const [replacementResult, setReplacementResult] = useState<InventoryLotReplacementResponse | null>(
    null,
  )
  const [hasAcknowledgedAdvisoryWarnings, setHasAcknowledgedAdvisoryWarnings] = useState(false)

  function resetReplacementState() {
    setReplacementError(null)
    setReplacementResult(null)
    setHasAcknowledgedAdvisoryWarnings(false)
  }

  useEffect(() => {
    if (!selectedItem?.internalId) {
      setSnapshot(null)
      setSelectedLotId('')
      setManualLot('')
      return
    }

    let active = true
    setIsLoadingSnapshot(true)

    fetchInventoryAdjustmentItemSnapshot(selectedItem.internalId)
      .then((response) => {
        if (!active) {
          return
        }

        startTransition(() => {
          setSnapshot(response)
          setSnapshotError(null)
        })
      })
      .catch((reason) => {
        if (!active) {
          return
        }

        setSnapshot(null)
        setSnapshotError(parseApiError(reason, 'No pude leer los lotes del producto en NetSuite.'))
      })
      .finally(() => {
        if (active) {
          setIsLoadingSnapshot(false)
        }
      })

    return () => {
      active = false
    }
  }, [selectedItem?.internalId])

  const lotOptions = useMemo(() => dedupeLotOptions(snapshot?.lots ?? []), [snapshot?.lots])
  const selectedLot = useMemo(
    () => lotOptions.find((lot) => lot.inventoryNumberId === selectedLotId) ?? null,
    [lotOptions, selectedLotId],
  )

  useEffect(() => {
    setSelectedLotId((current) => {
      if (current && lotOptions.some((lot) => lot.inventoryNumberId === current)) {
        return current
      }

      return lotOptions[0]?.inventoryNumberId ?? ''
    })

    if (lotOptions.length > 0) {
      setManualLot('')
    }
  }, [lotOptions])

  const cleanedManualLot = cleanText(manualLot)
  const manualLotReady = cleanedManualLot.length >= 6
  const effectiveLot = selectedLot?.inventoryNumber ?? (manualLotReady ? cleanedManualLot : '')
  const deferredLot = useDeferredValue(effectiveLot)
  const deferredDeclaredNewLot = useDeferredValue(declaredNewLot)
  const deferredDeclaredProductionDate = useDeferredValue(declaredProductionDate)
  const deferredDeclaredExpirationDate = useDeferredValue(declaredExpirationDate)

  useEffect(() => {
    if (!selectedItem?.internalId) {
      setSummary(null)
      setSummaryError(null)
      return
    }

    if (!deferredLot) {
      setSummary(null)
      setSummaryError(null)
      return
    }

    let active = true
    setIsLoadingSummary(true)

    fetchInventoryLotSummary({
      itemId: selectedItem.internalId,
      lot: deferredLot,
      declaredNewLot: deferredDeclaredNewLot || undefined,
      declaredProductionDate: deferredDeclaredProductionDate || undefined,
      declaredExpirationDate: deferredDeclaredExpirationDate || undefined,
    })
      .then((response) => {
        if (!active) {
          return
        }

        startTransition(() => {
          setSummary(response)
          setSummaryError(null)
        })
      })
      .catch((reason) => {
        if (!active) {
          return
        }

        setSummary(null)
        setSummaryError(parseApiError(reason, 'No pude construir la ficha del lote.'))
      })
      .finally(() => {
        if (active) {
          setIsLoadingSummary(false)
        }
      })

    return () => {
      active = false
    }
  }, [
    deferredDeclaredNewLot,
    deferredDeclaredExpirationDate,
    deferredDeclaredProductionDate,
    deferredLot,
    selectedItem?.internalId,
  ])

  function handleItemSelect(item: InventoryAdjustmentItemSearchResult | null) {
    setSelectedItem(item)
    setSnapshot(null)
    setSummary(null)
    setSnapshotError(null)
    setSummaryError(null)
    resetReplacementState()
    setSelectedLotId('')
    setManualLot('')
    setDeclaredNewLot('')
    setDeclaredProductionDate('')
    setDeclaredExpirationDate('')
  }

  const statusLabel = summary
    ? summary.coa.source === 'netsuite_file'
      ? 'CoA desde NetSuite'
      : summary.coa.source === 'search_directories'
        ? 'CoA desde archivos'
        : 'CoA no disponible'
    : isLoadingSnapshot
      ? 'Cargando lotes'
      : isLoadingSummary
        ? 'Consultando lote'
        : selectedItem
          ? effectiveLot
            ? 'Preparando resumen'
            : 'Elige un lote'
          : 'Busca un producto'

  const helperText = selectedItem
    ? [selectedItem.itemId, selectedItem.displayName].filter(Boolean).join(' | ')
    : 'Consulta directa a NetSuite.'
  const lotHelper = lotOptions.length > 0
    ? `NetSuite devolvio ${lotOptions.length} lote(s) para este producto.`
    : selectedItem
      ? 'Si el lote no aparece, escribelo manualmente.'
      : 'Primero elige un producto.'
  const shouldShowEmptyState = !selectedItem || (!effectiveLot && !isLoadingSnapshot)
  const declaredDateWarnings = summary?.declaredDates.warnings ?? []
  const blockingDeclaredDateWarnings = declaredDateWarnings.filter(isBlockingReplacementWarning)
  const advisoryDeclaredDateWarnings = declaredDateWarnings.filter(
    (warning) => !isBlockingReplacementWarning(warning),
  )
  const declaredNewLotLabel = summary?.declaredNewLot.normalized ?? normalizeLotLabel(declaredNewLot)
  const declaredProductionLabel = summary?.declaredDates.production.normalized ?? declaredProductionDate
  const declaredExpirationLabel = summary?.declaredDates.expiration.normalized ?? declaredExpirationDate
  const canExecuteReplacement =
    Boolean(summary) &&
    Boolean(selectedItem?.internalId) &&
    Boolean(effectiveLot) &&
    Boolean(declaredNewLotLabel) &&
    Boolean(declaredProductionLabel) &&
    Boolean(declaredExpirationLabel) &&
    Boolean(summary?.coa.fileId) &&
    Boolean(summary?.coa.fileName) &&
    Boolean(summary?.coa.dates.manufacture?.normalized) &&
    Boolean(summary?.coa.dates.expiration?.normalized) &&
    blockingDeclaredDateWarnings.length === 0 &&
    (advisoryDeclaredDateWarnings.length === 0 || hasAcknowledgedAdvisoryWarnings) &&
    !isLoadingSummary &&
    !isLoadingSnapshot &&
    !isExecutingReplacement

  async function handleExecuteReplacement() {
    if (
      !summary ||
      !selectedItem?.internalId ||
      !effectiveLot ||
      !declaredNewLotLabel ||
      !declaredProductionLabel ||
      !declaredExpirationLabel ||
      !summary.coa.fileId
    ) {
      return
    }

    setIsExecutingReplacement(true)
    setReplacementError(null)
    setReplacementResult(null)

    try {
      const result = await executeInventoryLotReplacement({
        itemId: selectedItem.internalId,
        currentLot: effectiveLot,
        newLot: declaredNewLotLabel,
        newProductionDate: declaredProductionLabel,
        newExpirationDate: declaredExpirationLabel,
        sourceCoaFileId: summary.coa.fileId,
        accountId: FIXED_REPLACEMENT_ACCOUNT_ID,
      })

      const refreshedSnapshot = await fetchInventoryAdjustmentItemSnapshot(selectedItem.internalId)

      startTransition(() => {
        setSnapshot(refreshedSnapshot)
        setSelectedLotId('')
        setManualLot('')
        setReplacementResult(result)
        setReplacementError(null)
      })
    } catch (reason) {
      setReplacementResult(null)
      setReplacementError(
        parseApiError(reason, 'No pude ejecutar el reemplazo real del lote en NetSuite.'),
      )
    } finally {
      setIsExecutingReplacement(false)
    }
  }

  return (
    <div className="inventory-page inventory-adjustments-clean">
      <section className="surface-card card inventory-adjustments-workbench">
        <div className="card-body">
          <div className="inventory-adjustments-workbench__header">
            <div className="inventory-adjustments-workbench__copy">
              <div className="eyebrow">Ajustes</div>
              <h2>Datos del lote</h2>
              <p>
                Busca el producto, elige el lote y prepara el cambio con fechas, lote nuevo y
                cantidades visibles antes de tocar NetSuite.
              </p>
            </div>

            <div className="inventory-adjustments-workbench__status">{statusLabel}</div>
          </div>

          <div className="inventory-adjustments-workbench__controls">
            <AsyncSearchCombobox<InventoryAdjustmentItemSearchResult>
              label="Producto"
              placeholder="Buscar producto por nombre o SKU..."
              helper={helperText}
              emptyLabel="No encontre productos con ese criterio."
              search={(query) =>
                searchInventoryAdjustmentItems(query).then((response) => response.items)
              }
              selectedOption={selectedItem}
              disabled={isLoadingSnapshot || isLoadingSummary}
              onSelect={handleItemSelect}
              getKey={(option) => option.internalId}
              getTitle={(option) => option.displayName ?? option.itemId}
              getMeta={(option) =>
                [option.itemId, option.isLotTracked ? 'Lotes' : 'Sin lotes']
                  .filter(Boolean)
                  .join(' | ')
              }
            />

            <label className="inventory-adjustments-field">
              <span>Lote</span>

              {lotOptions.length > 0 ? (
                <select
                  className="inventory-adjustments-select"
                  value={selectedLotId}
                  onChange={(event) => {
                    setSelectedLotId(event.target.value)
                    setSummary(null)
                    setSummaryError(null)
                    resetReplacementState()
                  }}
                  disabled={!selectedItem || isLoadingSnapshot || isLoadingSummary}
                >
                  {lotOptions.map((lot) => (
                    <option key={lot.inventoryNumberId} value={lot.inventoryNumberId}>
                      {lot.inventoryNumber ?? lot.inventoryNumberId}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  className="inventory-adjustments-input"
                  value={manualLot}
                  onChange={(event) => {
                    setManualLot(event.target.value)
                    setSummary(null)
                    setSummaryError(null)
                    resetReplacementState()
                  }}
                  placeholder="CHHA210819"
                  disabled={!selectedItem || isLoadingSummary}
                />
              )}

              <small>{lotHelper}</small>
            </label>
          </div>

          <div className="inventory-adjustments-declare-grid">
            <label className="inventory-adjustments-field">
              <span>Lote (nuevo)</span>
              <input
                type="text"
                className="inventory-adjustments-input"
                value={declaredNewLot}
                onChange={(event) => {
                  setDeclaredNewLot(event.target.value.toUpperCase())
                  setSummaryError(null)
                  resetReplacementState()
                }}
                placeholder="CHHA150823"
              />
              <small>
                {declaredNewLotLabel
                  ? `Lote listo: ${declaredNewLotLabel}`
                  : 'Captura el lote nuevo que quieres dar de alta.'}
              </small>
            </label>

            <label className="inventory-adjustments-field">
              <span>Nueva fecha de produccion</span>
              <input
                type="date"
                className="inventory-adjustments-input"
                value={declaredProductionDate}
                onChange={(event) => {
                  setDeclaredProductionDate(event.target.value)
                  setSummaryError(null)
                  resetReplacementState()
                }}
                max="2099-12-31"
              />
              <small>
                {declaredProductionLabel
                  ? `Formato listo: ${formatDateLabel(declaredProductionLabel)}`
                  : 'Usa formato de fecha para declarar la produccion nueva.'}
              </small>
            </label>

            <label className="inventory-adjustments-field">
              <span>Nueva fecha de caducidad</span>
              <input
                type="date"
                className="inventory-adjustments-input"
                value={declaredExpirationDate}
                onChange={(event) => {
                  setDeclaredExpirationDate(event.target.value)
                  setSummaryError(null)
                  resetReplacementState()
                }}
                max="2099-12-31"
              />
              <small>
                {declaredExpirationLabel
                  ? `Formato listo: ${formatDateLabel(declaredExpirationLabel)}`
                  : 'Usa formato de fecha para declarar la caducidad nueva.'}
              </small>
            </label>
          </div>

          {snapshotError ? <div className="alert alert-warning mb-0">{snapshotError}</div> : null}

          {selectedItem && !isLoadingSnapshot && lotOptions.length === 0 ? (
            <div className="note-strip">
              NetSuite no devolvio lotes visibles para este producto. Si ya conoces el lote,
              escribelo manualmente para consultar el CoA.
            </div>
          ) : null}

          {isLoadingSnapshot ? (
            <div className="inventory-adjustments-empty inventory-adjustments-empty--loading">
              Cargando lotes del producto...
            </div>
          ) : null}

          {shouldShowEmptyState ? (
            <div className="inventory-adjustments-empty">
              {!selectedItem
                ? 'Empieza buscando un producto para cargar el lote y sus fechas.'
                : 'Elige un lote para ver el resumen.'}
            </div>
          ) : null}

          {selectedItem && effectiveLot && isLoadingSummary ? (
            <div className="inventory-adjustments-empty inventory-adjustments-empty--loading">
              Consultando NetSuite y leyendo el certificado del lote...
            </div>
          ) : null}

          {summary ? (
            <>
              <div className="inventory-adjustments-record-shell">
                <div className="eyebrow mb-0">Ficha operativa</div>

                <div className="inventory-adjustments-record-strip" role="list" aria-label="Datos del lote">
                  <RecordMetric
                    label="Producto"
                    value={summary.product.displayName ?? summary.product.itemId}
                    note={summary.product.itemId}
                  />
                  <RecordMetric
                    label="Lote actual"
                    value={summary.lot.inventoryNumber}
                    note={summary.lot.inventoryNumberId}
                  />
                  <RecordMetric
                    label="Lote (nuevo)"
                    value={summary.declaredNewLot.normalized ?? 'Sin capturar'}
                    note={summary.declaredNewLot.raw ?? 'Pendiente'}
                  />
                  <RecordMetric
                    label="Disponible para vender"
                    value={formatQuantityLabel(summary.stock.quantityAvailable)}
                    note="Disponible en NetSuite"
                  />
                  <RecordMetric
                    label="Cantidad total"
                    value={formatQuantityLabel(summary.stock.quantityOnHand)}
                    note="Existencia del lote"
                  />
                  <RecordMetric
                    label="Caducidad (NetSuite)"
                    value={formatDateLabel(summary.lot.expirationDateNetSuite.normalized)}
                    note={summary.lot.expirationDateNetSuite.raw ?? 'Sin fecha en NetSuite'}
                  />
                  <RecordMetric
                    label="Manufactura (CoA)"
                    value={formatDateLabel(summary.coa.dates.manufacture?.normalized ?? null)}
                    note={summary.coa.fileName ?? 'CoA no localizado'}
                  />
                  <RecordMetric
                    label="Caducidad (CoA)"
                    value={formatDateLabel(summary.coa.dates.expiration?.normalized ?? null)}
                    note={summary.coa.fileName ?? 'CoA no localizado'}
                  />
                  <RecordMetric
                    label="Nueva produccion"
                    value={formatDateLabel(summary.declaredDates.production.normalized)}
                    note={summary.declaredDates.production.raw ?? 'Sin capturar'}
                  />
                  <RecordMetric
                    label="Nueva caducidad"
                    value={formatDateLabel(summary.declaredDates.expiration.normalized)}
                    note={summary.declaredDates.expiration.raw ?? 'Sin capturar'}
                  />
                </div>
              </div>

              {summary.coa.fileName ? (
                <div className="inventory-adjustments-source">
                  Modelo CoA confirmado: <strong>{summary.coa.fileName}</strong>{' '}
                  <span>· File ID {summary.coa.fileId ?? 'sin id'}</span>
                </div>
              ) : null}

              <section className="inventory-adjustments-execution">
                <div className="inventory-adjustments-execution__copy">
                  <div className="eyebrow mb-0">Ejecucion real</div>
                  <h3>Reemplazo del lote</h3>
                  <p>
                    La accion usa la cuenta fija <strong>{FIXED_REPLACEMENT_ACCOUNT_ID}</strong>{' '}
                    y hace cuatro cosas seguidas: crea el CoA nuevo, lo sube a archivos, mueve el
                    inventario del lote actual al lote nuevo y elimina los PDF del lote viejo.
                    El modelo para clonar sera exactamente el CoA confirmado arriba.
                  </p>
                </div>

                <div className="inventory-adjustments-execution__rail">
                  {advisoryDeclaredDateWarnings.length > 0 ? (
                    <label className="inventory-adjustments-confirmation">
                      <input
                        type="checkbox"
                        checked={hasAcknowledgedAdvisoryWarnings}
                        onChange={(event) => {
                          setHasAcknowledgedAdvisoryWarnings(event.target.checked)
                        }}
                      />
                      <span>
                        Confirmo que revise la advertencia del lote nuevo y aun asi quiero
                        continuar con este reemplazo.
                      </span>
                    </label>
                  ) : null}

                  <div className="inventory-adjustments-account">
                    <span>Cuenta fija</span>
                    <strong>{FIXED_REPLACEMENT_ACCOUNT_ID}</strong>
                    <small>{FIXED_REPLACEMENT_ACCOUNT_LABEL}</small>
                  </div>

                  <button
                    type="button"
                    className="inventory-adjustments-submit"
                    onClick={() => {
                      void handleExecuteReplacement()
                    }}
                    disabled={!canExecuteReplacement}
                  >
                    {isExecutingReplacement ? 'Ejecutando reemplazo...' : 'Ejecutar reemplazo real'}
                  </button>
                </div>
              </section>
            </>
          ) : null}

          {replacementError ? (
            <div className="alert alert-warning mb-0">{replacementError}</div>
          ) : null}

          {replacementResult ? (
            <section className="inventory-adjustments-result">
              <div className="inventory-adjustments-result__header">
                <div>
                  <div className="eyebrow mb-0">Operacion aplicada</div>
                  <h3>{replacementResult.message}</h3>
                </div>

                <div className="inventory-adjustments-result__badge">
                  {replacementResult.adjustment.tranId ?? replacementResult.adjustment.internalId}
                </div>
              </div>

              <div className="inventory-adjustments-result__grid">
                <ResultLine
                  label="Ajuste NetSuite"
                  value={replacementResult.adjustment.tranId ?? 'Sin tranId'}
                  note={`Internal ID ${replacementResult.adjustment.internalId}`}
                />
                <ResultLine
                  label="Lote nuevo"
                  value={replacementResult.lots.next.inventoryNumber}
                  note={`Existencia final ${formatQuantityLabel(
                    replacementResult.lots.next.quantityOnHandAfter,
                  )}`}
                />
                <ResultLine
                  label="Lote viejo"
                  value={replacementResult.lots.current.inventoryNumber}
                  note={`Existencia final ${formatQuantityLabel(
                    replacementResult.lots.current.quantityOnHandAfter,
                  )}`}
                />
                <ResultLine
                  label="Modelo CoA usado"
                  value={replacementResult.coa.sourceFileName}
                  note={`File ID ${replacementResult.coa.sourceFileId}`}
                />
                <ResultLine
                  label="Nuevo CoA"
                  value={replacementResult.coa.newFileName}
                  note={`${replacementResult.coa.detectedNewFiles.length} archivo(s) detectados`}
                />
                <ResultLine
                  label="PDF nuevos subidos"
                  value={String(replacementResult.coa.uploadedFiles.length)}
                  note={replacementResult.account.displayName}
                />
                <ResultLine
                  label="PDF viejos eliminados"
                  value={String(replacementResult.coa.deletedFiles.length)}
                  note={`${replacementResult.coa.remainingOldFiles.length} restantes`}
                />
              </div>
            </section>
          ) : null}

          {summaryError ? <div className="alert alert-warning mb-0">{summaryError}</div> : null}

          {summary?.coa.warnings.length ? (
            <div className="inventory-adjustments-warning-list">
              {summary.coa.warnings.map((warning) => (
                <div key={warning} className="inventory-adjustments-warning-item">
                  {warning}
                </div>
              ))}
            </div>
          ) : null}

          {declaredDateWarnings.length > 0 ? (
            <div className="inventory-adjustments-warning-list">
              {declaredDateWarnings.map((warning) => (
                <div key={warning} className="inventory-adjustments-warning-item">
                  {warning}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}

function RecordMetric({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note: string
}) {
  return (
    <article className="inventory-adjustments-record-metric" role="listitem">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  )
}

function ResultLine({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note: string
}) {
  return (
    <article className="inventory-adjustments-result-line">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  )
}

function AsyncSearchCombobox<T>({
  label,
  placeholder,
  helper,
  emptyLabel,
  search,
  selectedOption,
  disabled,
  onSelect,
  getKey,
  getTitle,
  getMeta,
}: AsyncSearchComboboxProps<T>) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputId = useId()
  const listboxId = `${inputId}-listbox`
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [options, setOptions] = useState<T[]>([])
  const [error, setError] = useState<string | null>(null)
  const [highlightedIndex, setHighlightedIndex] = useState(0)

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
    if (!isOpen) {
      return
    }

    let active = true
    setIsLoading(true)

    search(deferredQuery)
      .then((items) => {
        if (!active) {
          return
        }

        startTransition(() => {
          setOptions(items)
          setError(null)
        })
      })
      .catch((reason) => {
        if (!active) {
          return
        }

        setOptions([])
        setError(parseApiError(reason, 'No pude buscar opciones en NetSuite.'))
      })
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [deferredQuery, isOpen, search])

  useEffect(() => {
    setHighlightedIndex(0)
  }, [deferredQuery, isOpen, options.length])

  function handleSelect(option: T | null) {
    onSelect(option)
    setQuery('')
    setIsOpen(false)
    setHighlightedIndex(0)
  }

  function handleClear() {
    if (query) {
      setQuery('')
      setIsOpen(true)
      return
    }

    handleSelect(null)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!isOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      setIsOpen(true)
      event.preventDefault()
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex((current) => (options.length > 0 ? (current + 1) % options.length : 0))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex((current) =>
        options.length > 0 ? (current - 1 + options.length) % options.length : 0,
      )
      return
    }

    if (event.key === 'Escape') {
      setIsOpen(false)
      return
    }

    if (event.key === 'Enter' && isOpen) {
      const activeOption = options[highlightedIndex]
      if (!activeOption) {
        return
      }

      event.preventDefault()
      handleSelect(activeOption)
    }
  }

  const selectedKey = selectedOption ? getKey(selectedOption) : null
  const activeOption = options[highlightedIndex]

  return (
    <label className="inventory-adjustments-field">
      <span>{label}</span>

      <div
        ref={rootRef}
        className={`search-combobox search-combobox--slim${
          isOpen ? ' search-combobox--open' : ''
        }${disabled ? ' search-combobox--disabled' : ''}`}
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
              isOpen && activeOption ? `${inputId}-option-${highlightedIndex}` : undefined
            }
          />

          {query || selectedOption ? (
            <button
              type="button"
              className="search-combobox__clear"
              onClick={handleClear}
              disabled={disabled}
            >
              Limpiar
            </button>
          ) : null}
        </div>

        {isOpen ? (
          <div className="search-combobox__panel" role="listbox" id={listboxId}>
            {isLoading ? (
              <div className="search-combobox__empty">Buscando en NetSuite...</div>
            ) : error ? (
              <div className="search-combobox__empty">{error}</div>
            ) : options.length > 0 ? (
              options.map((option, index) => {
                const optionKey = getKey(option)
                const isSelected = optionKey === selectedKey

                return (
                  <button
                    key={optionKey}
                    id={`${inputId}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`search-combobox__option${
                      highlightedIndex === index ? ' search-combobox__option--highlighted' : ''
                    }${isSelected ? ' search-combobox__option--selected' : ''}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleSelect(option)}
                  >
                    <strong>{getTitle(option)}</strong>
                    <span>{getMeta(option)}</span>
                  </button>
                )
              })
            ) : (
              <div className="search-combobox__empty">{emptyLabel}</div>
            )}
          </div>
        ) : null}
      </div>

      <div className="search-combobox__meta-row">
        <small>{selectedOption ? getMeta(selectedOption) : helper}</small>

        {selectedOption ? (
          <button
            type="button"
            className="search-combobox__clear-link"
            onClick={() => handleSelect(null)}
            disabled={disabled}
          >
            Quitar
          </button>
        ) : null}
      </div>
    </label>
  )
}

function dedupeLotOptions(lots: InventoryAdjustmentLotBalance[]) {
  const uniqueLots = new Map<string, InventoryAdjustmentLotBalance>()

  for (const lot of lots) {
    if (!lot.inventoryNumberId || uniqueLots.has(lot.inventoryNumberId)) {
      continue
    }

    uniqueLots.set(lot.inventoryNumberId, lot)
  }

  return Array.from(uniqueLots.values())
}

function cleanText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function formatDateLabel(value: string | null | undefined) {
  if (!value) {
    return 'Sin dato'
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    return value
  }

  return `${match[3]}/${match[2]}/${match[1]}`
}

function normalizeLotLabel(value: string) {
  const cleaned = value.replace(/\s+/g, '').toUpperCase()
  return cleaned || null
}

function isBlockingReplacementWarning(warning: string) {
  const normalizedWarning = warning.toLowerCase()
  return (
    normalizedWarning.includes('no puede ser igual al lote actual') ||
    normalizedWarning.includes('no puede ser anterior a la nueva fecha de produccion')
  )
}

function formatQuantityLabel(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Sin dato'
  }

  return new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(value)
}

function parseApiError(reason: unknown, fallback: string) {
  if (reason instanceof HttpClientError) {
    const messageFromBody = parseErrorMessage(reason.body)
    return messageFromBody ?? `${fallback} Status ${reason.status}.`
  }

  if (reason instanceof Error) {
    return reason.message
  }

  return fallback
}

function parseErrorMessage(body: string | undefined) {
  if (!body) {
    return null
  }

  try {
    const parsed = JSON.parse(body) as { error?: unknown }
    return typeof parsed.error === 'string' ? parsed.error : null
  } catch {
    return body.trim() || null
  }
}
