import { useEffect, useMemo, useState } from 'react'

import {
  HttpClientError,
  lookupInventoryCertificate,
  type InventoryCertificateLookupResponse,
} from '../../services/api/inventoryCertificatesApi'
import type { InventoryAdjustmentLotBalance } from '../../services/api/inventoryAdjustmentsApi'

type InventoryCertificateLookupCardProps = {
  itemLabel: string | null
  lotOptions: InventoryAdjustmentLotBalance[]
  disabled?: boolean
  revealDelayMs?: number
}

function revealStyle(delayMs: number) {
  return {
    animationDelay: `${delayMs}ms`,
  }
}

export function InventoryCertificateLookupCard({
  itemLabel,
  lotOptions,
  disabled = false,
  revealDelayMs = 110,
}: InventoryCertificateLookupCardProps) {
  const [lot, setLot] = useState('')
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState<InventoryCertificateLookupResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const lotChoices = useMemo(() => {
    const uniqueLots = new Map<string, string>()
    for (const lotOption of lotOptions) {
      const rawLot = lotOption.inventoryNumber?.trim()
      if (rawLot && !uniqueLots.has(rawLot)) {
        uniqueLots.set(rawLot, rawLot)
      }
    }

    return Array.from(uniqueLots.values())
  }, [lotOptions])

  useEffect(() => {
    if (!lotChoices.length) {
      return
    }

    setLot((current) => {
      if (current && lotChoices.includes(current)) {
        return current
      }

      return lotChoices[0]
    })
  }, [lotChoices])

  const canSearch = Boolean(itemLabel || lot.trim() || fileName.trim())

  async function handleLookup() {
    if (!canSearch) {
      setError('Escribe un lote o un nombre de archivo para buscar el certificado.')
      return
    }

    setIsLoading(true)

    try {
      const response = await lookupInventoryCertificate({
        lot: lot.trim() || null,
        fileName: fileName.trim() || null,
        productQuery: itemLabel,
      })

      setResult(response)
      setError(null)
    } catch (reason) {
      setResult(null)
      setError(parseCertificateError(reason))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section
      className="surface-card card inventory-adjustments-snapshot-card"
      data-reveal
      style={revealStyle(revealDelayMs)}
    >
      <div className="card-body">
        <div className="inventory-adjustments-section-heading inventory-adjustments-section-heading--compact">
          <div>
            <div className="eyebrow">Certificado</div>
            <h3 className="h4 mb-1">CoA del lote</h3>
          </div>
          <div className="inventory-adjustments-section-badge">
            {result ? 'Encontrado' : 'Pendiente'}
          </div>
        </div>

        <div className="inventory-adjustments-item-meta">
          <div className="inventory-adjustments-item-meta__row">
            <span>Item base</span>
            <strong>{itemLabel ?? 'Puedes buscar solo por lote o archivo'}</strong>
          </div>
        </div>

        <div className="inventory-adjustments-grid-2 mt-3">
          <label className="inventory-adjustments-field">
            <span>Lote</span>
            {lotChoices.length > 0 ? (
              <select
                className="inventory-adjustments-select"
                value={lot}
                onChange={(event) => setLot(event.target.value)}
                disabled={disabled || isLoading}
              >
                <option value="">Selecciona un lote</option>
                {lotChoices.map((lotValue) => (
                  <option key={lotValue} value={lotValue}>
                    {lotValue}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className="inventory-adjustments-input"
                value={lot}
                onChange={(event) => setLot(event.target.value)}
                placeholder="CHHA210819"
                disabled={disabled || isLoading}
              />
            )}
            <small>Usa el lote para encontrar el PDF correcto en el backend.</small>
          </label>

          <label className="inventory-adjustments-field">
            <span>Archivo PDF</span>
            <input
              type="text"
              className="inventory-adjustments-input"
              value={fileName}
              onChange={(event) => setFileName(event.target.value)}
              placeholder="FI - CHHA210819 (SHQ).pdf"
              disabled={disabled || isLoading}
            />
            <small>Opcional. Si lo conoces, acelera la busqueda.</small>
          </label>
        </div>

        <div className="inventory-adjustments-actions mt-3">
          <button
            type="button"
            className="inventory-adjustments-secondary"
            onClick={() => void handleLookup()}
            disabled={disabled || isLoading || !canSearch}
          >
            {isLoading ? 'Buscando certificado...' : 'Buscar certificado'}
          </button>
        </div>

        {result ? (
          <>
            <div className="inventory-adjustments-summary-grid mt-3">
              <div className="inventory-adjustments-summary-card">
                <span>Archivo</span>
                <strong>{result.match.fileName}</strong>
                <small>{result.match.matchedBy.join(' | ') || 'match'}</small>
              </div>
              <div className="inventory-adjustments-summary-card">
                <span>Produccion</span>
                <strong>{formatDetectedDate(result.analysis.dates.production)}</strong>
                <small>{result.analysis.dates.production?.raw ?? 'No detectada'}</small>
              </div>
              <div className="inventory-adjustments-summary-card">
                <span>Caducidad</span>
                <strong>{formatDetectedDate(result.analysis.dates.expiration)}</strong>
                <small>{result.analysis.dates.expiration?.raw ?? 'No detectada'}</small>
              </div>
              <div className="inventory-adjustments-summary-card">
                <span>Lote</span>
                <strong>{lot.trim() || 'Sin filtro'}</strong>
                <small>{result.analysis.lotMatches[0] ?? 'Sin linea coincidente visible'}</small>
              </div>
            </div>

            {result.analysis.relevantLines.length ? (
              <div className="inventory-adjustments-assignment-preview mt-3">
                <div className="eyebrow">Lineas detectadas</div>
                {result.analysis.relevantLines.map((line) => (
                  <div key={line} className="inventory-adjustments-assignment-preview__item">
                    <strong>{line}</strong>
                    <span>Extraido del PDF analizado</span>
                  </div>
                ))}
              </div>
            ) : null}

            {result.analysis.warnings.length ? (
              <div className="inventory-adjustments-message-list inventory-adjustments-message-list--warning mt-3">
                {result.analysis.warnings.map((warning) => (
                  <div key={warning} className="inventory-adjustments-message-item">
                    {warning}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div className="note-strip mt-3">
            Busca el certificado para extraer fecha de produccion y fecha de caducidad desde el
            PDF.
          </div>
        )}

        {error ? <div className="alert alert-warning mt-3 mb-0">{error}</div> : null}
      </div>
    </section>
  )
}

function formatDetectedDate(
  value: InventoryCertificateLookupResponse['analysis']['dates']['production'],
) {
  if (!value?.normalized) {
    return 'No detectada'
  }

  const [year, month, day] = value.normalized.split('-')
  if (!year || !month || !day) {
    return value.normalized
  }

  return `${day}/${month}/${year}`
}

function parseCertificateError(reason: unknown) {
  if (reason instanceof HttpClientError) {
    const messageFromBody = parseErrorMessage(reason.body)
    return messageFromBody ?? `La busqueda del certificado fallo con status ${reason.status}.`
  }

  if (reason instanceof Error) {
    return reason.message
  }

  return 'No pude consultar el certificado del lote.'
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
