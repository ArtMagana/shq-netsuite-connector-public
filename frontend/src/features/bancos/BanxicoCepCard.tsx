import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  fetchBanxicoCepInstitutions,
  HttpClientError,
  lookupBanxicoCep,
  type BanxicoCepInstitution,
  type BanxicoCepInstitutionsResponse,
  type BanxicoCepLookupMode,
  type BanxicoCepLookupResponse,
  type BanxicoCepSearchType,
} from '../../services/api/reconciliationApi'

type BanxicoCepFormState = {
  operationDate: string
  searchType: BanxicoCepSearchType
  mode: BanxicoCepLookupMode
  criteria: string
  issuerId: string
  receiverId: string
  beneficiaryAccount: string
  amount: string
  beneficiaryIsParticipant: boolean
}

export function BanxicoCepCard() {
  const [form, setForm] = useState<BanxicoCepFormState>(() => ({
    operationDate: getTodayInMexico(),
    searchType: 'trackingKey',
    mode: 'status',
    criteria: '',
    issuerId: '',
    receiverId: '',
    beneficiaryAccount: '',
    amount: '',
    beneficiaryIsParticipant: false,
  }))
  const [catalog, setCatalog] = useState<BanxicoCepInstitutionsResponse | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [lookupResult, setLookupResult] = useState<BanxicoCepLookupResponse | null>(null)
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false)
  const [isLookingUp, setIsLookingUp] = useState(false)

  useEffect(() => {
    if (!form.operationDate) {
      return
    }

    let cancelled = false
    setIsLoadingCatalog(true)
    setCatalogError(null)

    fetchBanxicoCepInstitutions(form.operationDate)
      .then((nextCatalog) => {
        if (cancelled) {
          return
        }

        setCatalog(nextCatalog)
        setForm((current) => {
          const nextIssuerId = resolveInstitutionSelection(
            current.issuerId,
            nextCatalog.institutionsMispei,
            nextCatalog.institutionsMispei[0]?.id ?? nextCatalog.institutions[0]?.id ?? '',
          )
          const nextReceiverId = resolveReceiverSelection(current.receiverId, nextCatalog.institutions, nextIssuerId)

          if (nextIssuerId === current.issuerId && nextReceiverId === current.receiverId) {
            return current
          }

          return {
            ...current,
            issuerId: nextIssuerId,
            receiverId: nextReceiverId,
          }
        })
      })
      .catch((reason: unknown) => {
        if (cancelled) {
          return
        }

        setCatalog(null)
        setCatalogError(extractError(reason, 'No fue posible cargar el catalogo de instituciones Banxico.'))
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingCatalog(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [form.operationDate])

  const issuerOptions = catalog?.institutionsMispei ?? []
  const receiverOptions = catalog?.institutions ?? []
  const requiresCepFields = form.mode === 'cep'
  const canLookup =
    form.operationDate.trim().length > 0 &&
    form.criteria.trim().length > 0 &&
    form.issuerId.trim().length > 0 &&
    form.receiverId.trim().length > 0 &&
    (!requiresCepFields ||
      (form.beneficiaryAccount.trim().length > 0 && form.amount.trim().length > 0))

  const lookupBadgeClassName = useMemo(() => {
    if (!lookupResult) {
      return 'status-pill status-pill--idle'
    }

    if (lookupResult.result.kind === 'error') {
      return 'status-pill status-pill--exception'
    }

    if (lookupResult.result.found === false) {
      return 'status-pill status-pill--review'
    }

    if (lookupResult.result.found === true) {
      return 'status-pill status-pill--ready'
    }

    return 'status-pill status-pill--healthy'
  }, [lookupResult])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canLookup) {
      setLookupError(
        requiresCepFields
          ? 'Para descargar CEP debes capturar fecha, criterio, bancos, cuenta beneficiaria y monto.'
          : 'Captura fecha, criterio y bancos para consultar el estado del pago.',
      )
      return
    }

    setIsLookingUp(true)
    setLookupError(null)

    try {
      const response = await lookupBanxicoCep({
        operationDate: form.operationDate,
        searchType: form.searchType,
        criteria: form.criteria.trim(),
        issuerId: form.issuerId,
        receiverId: form.receiverId,
        mode: form.mode,
        beneficiaryAccount: form.beneficiaryAccount.trim() || null,
        amount: form.amount.trim() || null,
        beneficiaryIsParticipant: form.beneficiaryIsParticipant,
      })
      setLookupResult(response)
    } catch (reason: unknown) {
      setLookupResult(null)
      setLookupError(extractError(reason, 'No fue posible consultar Banxico CEP.'))
    } finally {
      setIsLookingUp(false)
    }
  }

  function updateField<Key extends keyof BanxicoCepFormState>(key: Key, value: BanxicoCepFormState[Key]) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function handleDownload() {
    const download = lookupResult?.result.download
    if (!download) {
      return
    }

    downloadBase64File(download.contentBase64, download.contentType, download.fileName ?? 'banxico-cep.bin')
  }

  return (
    <div className="surface-card card">
      <div className="card-body">
        <div className="analysis-card__header mb-3">
          <div>
            <div className="eyebrow">Bancos / Banxico CEP</div>
            <h3 className="h5 mb-1">Consulta estado SPEI y prepara descarga de comprobante.</h3>
            <p className="text-secondary mb-0">
              Esta tarjeta usa el backend como proxy sobre Banxico para evitar CORS y dejar la consulta dentro
              del flujo de <strong>Bancos</strong>.
            </p>
          </div>
          <div className="analysis-card__meta">
            <div className={lookupBadgeClassName}>{getLookupBadgeLabel(lookupResult)}</div>
            {catalog ? (
              <div className="analysis-card__summary">
                {catalog.institutions.length} bancos receptores / {catalog.institutionsMispei.length} emisores
              </div>
            ) : null}
          </div>
        </div>

        <form onSubmit={(event) => void handleSubmit(event)}>
          <div className="bank-form-grid">
            <label className="bank-field">
              <span>Fecha de operacion</span>
              <input
                className="bank-input"
                type="date"
                value={form.operationDate}
                disabled={isLoadingCatalog || isLookingUp}
                onChange={(event) => updateField('operationDate', event.target.value)}
              />
            </label>

            <label className="bank-field">
              <span>Modo</span>
              <select
                className="bank-select"
                value={form.mode}
                disabled={isLookingUp}
                onChange={(event) => updateField('mode', event.target.value as BanxicoCepLookupMode)}
              >
                <option value="status">Consultar estado</option>
                <option value="cep">Descargar CEP</option>
              </select>
            </label>

            <label className="bank-field">
              <span>Criterio de busqueda</span>
              <select
                className="bank-select"
                value={form.searchType}
                disabled={isLookingUp}
                onChange={(event) => updateField('searchType', event.target.value as BanxicoCepSearchType)}
              >
                <option value="trackingKey">Clave de rastreo</option>
                <option value="referenceNumber">Numero de referencia</option>
              </select>
            </label>

            <label className="bank-field">
              <span>{form.searchType === 'trackingKey' ? 'Clave de rastreo' : 'Numero de referencia'}</span>
              <input
                className="bank-input"
                type="text"
                value={form.criteria}
                disabled={isLookingUp}
                placeholder={form.searchType === 'trackingKey' ? 'Ej. ABC123XYZ' : 'Ej. 1234567'}
                onChange={(event) => updateField('criteria', event.target.value)}
              />
            </label>

            <label className="bank-field">
              <span>Banco emisor</span>
              <select
                className="bank-select"
                value={form.issuerId}
                disabled={isLoadingCatalog || isLookingUp || issuerOptions.length === 0}
                onChange={(event) => updateField('issuerId', event.target.value)}
              >
                <option value="">Selecciona banco emisor</option>
                {issuerOptions.map((institution) => (
                  <option key={institution.id} value={institution.id}>
                    {institution.name} ({institution.id})
                  </option>
                ))}
              </select>
            </label>

            <label className="bank-field">
              <span>Banco receptor</span>
              <select
                className="bank-select"
                value={form.receiverId}
                disabled={isLoadingCatalog || isLookingUp || receiverOptions.length === 0}
                onChange={(event) => updateField('receiverId', event.target.value)}
              >
                <option value="">Selecciona banco receptor</option>
                {receiverOptions.map((institution) => (
                  <option key={institution.id} value={institution.id}>
                    {institution.name} ({institution.id})
                  </option>
                ))}
              </select>
            </label>

            <label className="bank-field">
              <span>Cuenta beneficiaria {requiresCepFields ? '*' : '(opcional)'}</span>
              <input
                className="bank-input"
                type="text"
                value={form.beneficiaryAccount}
                disabled={isLookingUp}
                placeholder="CLABE, tarjeta o celular"
                onChange={(event) => updateField('beneficiaryAccount', event.target.value.replace(/[^\d]/g, ''))}
              />
            </label>

            <label className="bank-field">
              <span>Monto {requiresCepFields ? '*' : '(opcional)'}</span>
              <input
                className="bank-input"
                type="text"
                value={form.amount}
                disabled={isLookingUp}
                placeholder="Ej. 1200.50"
                onChange={(event) => updateField('amount', sanitizeAmountInput(event.target.value))}
              />
            </label>

            <label className="bank-field bank-field--wide">
              <span className="bank-checkbox">
                <input
                  type="checkbox"
                  checked={form.beneficiaryIsParticipant}
                  disabled={isLookingUp}
                  onChange={(event) => updateField('beneficiaryIsParticipant', event.target.checked)}
                />
                Pago directo a banco receptor
              </span>
              <small>
                Banxico reporta si el portal sigue con captcha forzado u omitible. Hoy el backend opera el flujo
                sin pedirte resolver imagen.
              </small>
            </label>
          </div>

          <div className="bank-actions mt-3">
            <button type="submit" className="ghost-button" disabled={isLookingUp || isLoadingCatalog || !canLookup}>
              {isLookingUp ? 'Consultando Banxico...' : form.mode === 'cep' ? 'Buscar CEP' : 'Consultar estado'}
            </button>
            {catalog ? (
              <span className="text-secondary small">
                Catalogo {catalog.banxicoDate}. Captcha omitible: {catalog.overrideCaptcha ? 'si' : 'no'}.
              </span>
            ) : null}
            {isLoadingCatalog ? <span className="text-secondary small">Actualizando bancos Banxico...</span> : null}
          </div>
        </form>

        {catalogError ? <div className="alert alert-warning mt-3 mb-0">{catalogError}</div> : null}
        {lookupError ? <div className="alert alert-warning mt-3 mb-0">{lookupError}</div> : null}

        {lookupResult ? (
          <div className="mt-4">
            <div className="summary-list">
              <div className="summary-list__item">
                <span>Resultado</span>
                <strong>{getLookupResultSummary(lookupResult)}</strong>
              </div>
              <div className="summary-list__item">
                <span>Titulo</span>
                <strong>{lookupResult.result.title ?? 'Sin titulo'}</strong>
              </div>
              <div className="summary-list__item">
                <span>Mensaje</span>
                <strong>{lookupResult.result.message ?? 'Sin mensaje adicional'}</strong>
              </div>
              <div className="summary-list__item">
                <span>Tipo de contenido</span>
                <strong>{lookupResult.result.contentType}</strong>
              </div>
              <div className="summary-list__item">
                <span>Consulta realizada</span>
                <strong>{formatDateTime(lookupResult.fetchedAtUtc)}</strong>
              </div>
            </div>

            {lookupResult.result.download ? (
              <div className="bank-actions mt-3">
                <button type="button" className="ghost-button" onClick={handleDownload}>
                  Descargar archivo Banxico
                </button>
                <span className="text-secondary small">
                  {lookupResult.result.download.fileName ?? 'Archivo sin nombre'} listo para guardarse desde el
                  navegador.
                </span>
              </div>
            ) : null}

            {lookupResult.result.text ? (
              <details className="bank-response-details mt-3">
                <summary>Ver respuesta normalizada de Banxico</summary>
                <pre>{lookupResult.result.text}</pre>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function resolveInstitutionSelection(
  currentValue: string,
  institutions: BanxicoCepInstitution[],
  fallbackValue: string,
) {
  if (institutions.some((item) => item.id === currentValue)) {
    return currentValue
  }

  return fallbackValue
}

function resolveReceiverSelection(
  currentValue: string,
  institutions: BanxicoCepInstitution[],
  issuerId: string,
) {
  if (institutions.some((item) => item.id === currentValue)) {
    return currentValue
  }

  return institutions.find((item) => item.id !== issuerId)?.id ?? institutions[0]?.id ?? ''
}

function getLookupBadgeLabel(result: BanxicoCepLookupResponse | null) {
  if (!result) {
    return 'Sin consulta'
  }

  if (result.result.kind === 'error') {
    return 'Respuesta con error'
  }

  if (result.result.found === false) {
    return 'Operacion no encontrada'
  }

  if (result.result.download) {
    return 'Archivo listo'
  }

  if (result.result.found === true) {
    return 'Consulta encontrada'
  }

  return 'Respuesta recibida'
}

function getLookupResultSummary(result: BanxicoCepLookupResponse) {
  if (result.result.captchaInvalid) {
    return 'Banxico rechazo el codigo de seguridad.'
  }

  if (result.result.operationNotFound) {
    return 'Banxico no encontro una operacion con ese criterio.'
  }

  if (result.result.download) {
    return 'Banxico devolvio un archivo descargable.'
  }

  if (result.result.found === true) {
    return 'Banxico devolvio informacion para la operacion consultada.'
  }

  return 'Banxico devolvio una respuesta sin clasificacion cerrada.'
}

function sanitizeAmountInput(value: string) {
  return value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')
}

function extractError(reason: unknown, fallback: string) {
  if (reason instanceof HttpClientError) {
    try {
      const parsed = JSON.parse(reason.body ?? '{}') as { error?: string }
      if (parsed.error) {
        return parsed.error
      }
    } catch {
      return reason.message
    }

    return reason.message
  }

  return reason instanceof Error ? reason.message : fallback
}

function getTodayInMexico() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function formatDateTime(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return parsed.toLocaleString('es-MX', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function downloadBase64File(contentBase64: string, contentType: string, fileName: string) {
  const binary = window.atob(contentBase64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  const blob = new Blob([bytes], { type: contentType })
  const objectUrl = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  anchor.click()
  window.URL.revokeObjectURL(objectUrl)
}
