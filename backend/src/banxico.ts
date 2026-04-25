type BanxicoQueryMode = 'status' | 'cep'
type BanxicoSearchType = 'trackingKey' | 'referenceNumber'

type BanxicoInstitutionTuple = [string, string]

type BanxicoInstitutionCatalogPayload = {
  instituciones?: BanxicoInstitutionTuple[]
  institucionesMISPEI?: BanxicoInstitutionTuple[]
  overrideCaptcha?: boolean
}

export type BanxicoInstitution = {
  id: string
  name: string
}

export type BanxicoInstitutionCatalog = {
  fetchedAtUtc: string
  date: string
  banxicoDate: string
  overrideCaptcha: boolean
  institutions: BanxicoInstitution[]
  institutionsMispei: BanxicoInstitution[]
  sourceUrl: string
}

export type BanxicoCepLookupInput = {
  operationDate: string
  searchType: string
  criteria: string
  issuerId: string
  receiverId: string
  mode?: string | null
  beneficiaryAccount?: string | null
  amount?: string | number | null
  beneficiaryIsParticipant?: boolean | null
  captcha?: string | null
}

export type BanxicoCepLookupClassification = 'error' | 'payment_status' | 'cep' | 'unknown'

export type BanxicoCepLookupResult = {
  kind: BanxicoCepLookupClassification
  title: string | null
  message: string | null
  text: string
  html: string
  contentType: string
  fileName: string | null
  download:
    | {
        contentBase64: string
        contentType: string
        fileName: string | null
      }
    | null
  found: boolean | null
  operationNotFound: boolean
  captchaInvalid: boolean
}

export type BanxicoCepLookupResponse = {
  fetchedAtUtc: string
  sourceUrl: string
  request: {
    operationDate: string
    banxicoDate: string
    searchType: BanxicoSearchType
    mode: BanxicoQueryMode
    criteria: string
    issuerId: string
    receiverId: string
    beneficiaryAccountMasked: string | null
    amount: string | null
    beneficiaryIsParticipant: boolean
    captchaSupplied: boolean
  }
  result: BanxicoCepLookupResult
}

export type BanxicoCepTransferParty = {
  bankName: string | null
  name: string | null
  account: string | null
  rfc: string | null
}

export type BanxicoCepTransferDetails = {
  operationDate: string | null
  processedAt: string | null
  concept: string | null
  amount: string | null
  vat: string | null
  trackingKey: string | null
  orderingParty: BanxicoCepTransferParty | null
  beneficiary: BanxicoCepTransferParty | null
  xml: string
}

type NormalizedOperationDate = {
  isoDate: string
  banxicoDate: string
}

type NormalizedBanxicoLookupInput = {
  operationDate: NormalizedOperationDate
  searchType: BanxicoSearchType
  mode: BanxicoQueryMode
  criteria: string
  issuerId: string
  receiverId: string
  beneficiaryAccount: string | null
  amount: string | null
  beneficiaryIsParticipant: boolean
  captcha: string
}

const DEFAULT_BANXICO_CEP_BASE_URL =
  process.env.BANXICO_CEP_BASE_URL?.trim() || 'https://www.banxico.org.mx/cep'
const DEFAULT_BANXICO_CEP_SCL_LIST_URL =
  process.env.BANXICO_CEP_SCL_LIST_URL?.trim() || 'https://www.banxico.org.mx/cep-scl/listaInstituciones.do'
const DEFAULT_BANXICO_TIMEOUT_MS = parsePositiveInteger(process.env.BANXICO_CEP_TIMEOUT_MS, 30000)
const DEFAULT_BANXICO_USER_AGENT =
  process.env.BANXICO_CEP_USER_AGENT?.trim() || 'Mozilla/5.0'

export class BanxicoServiceError extends Error {
  readonly status: number

  constructor(message: string, status = 503) {
    super(message)
    this.name = 'BanxicoServiceError'
    this.status = status
  }
}

export async function getBanxicoCepInstitutions(dateInput?: string | null): Promise<BanxicoInstitutionCatalog> {
  const operationDate = normalizeOperationDate(dateInput ?? null, {
    required: false,
    fieldName: 'date',
  })
  const sourceUrl = buildBanxicoUrl('/instituciones.do')

  try {
    const response = await fetchBanxico(sourceUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': DEFAULT_BANXICO_USER_AGENT,
      },
      query: {
        fecha: operationDate.banxicoDate,
      },
    })

    const payload = parseJsonPayload<BanxicoInstitutionCatalogPayload>(await response.text(), sourceUrl)
    return buildInstitutionCatalogResponse({
      operationDate,
      institutions: normalizeInstitutionList(payload.instituciones),
      institutionsMispei: normalizeInstitutionList(payload.institucionesMISPEI),
      overrideCaptcha: Boolean(payload.overrideCaptcha),
      sourceUrl,
    })
  } catch (error) {
    if (!(error instanceof BanxicoServiceError)) {
      throw error
    }

    return fetchBanxicoCepInstitutionsHtmlFallback(operationDate)
  }
}

export async function lookupBanxicoCep(input: BanxicoCepLookupInput): Promise<BanxicoCepLookupResponse> {
  const normalized = normalizeLookupInput(input)
  const sessionCookies = await openBanxicoSession()
  const sourceUrl = buildBanxicoUrl('/valida.do')

  const response = await fetchBanxico(sourceUrl, {
    method: 'POST',
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent': DEFAULT_BANXICO_USER_AGENT,
      ...(sessionCookies ? { Cookie: sessionCookies } : {}),
    },
    body: new URLSearchParams({
      tipoCriterio: normalized.searchType === 'trackingKey' ? 'T' : 'R',
      fecha: normalized.operationDate.banxicoDate,
      criterio: normalized.criteria,
      emisor: normalized.issuerId,
      receptor: normalized.receiverId,
      cuenta: normalized.beneficiaryAccount ?? '',
      receptorParticipante: normalized.beneficiaryIsParticipant ? '1' : '0',
      monto: normalized.amount ?? '',
      captcha: normalized.captcha,
      tipoConsulta: normalized.mode === 'cep' ? '1' : '0',
    }).toString(),
  })

  const contentType = normalizeContentType(response.headers.get('content-type'))
  if (!isTextContentType(contentType)) {
    const buffer = Buffer.from(await response.arrayBuffer())
    const fileName = buildDownloadFileName(normalized, contentType)

    return {
      fetchedAtUtc: new Date().toISOString(),
      sourceUrl,
      request: {
        operationDate: normalized.operationDate.isoDate,
        banxicoDate: normalized.operationDate.banxicoDate,
        searchType: normalized.searchType,
        mode: normalized.mode,
        criteria: normalized.criteria,
        issuerId: normalized.issuerId,
        receiverId: normalized.receiverId,
        beneficiaryAccountMasked: maskAccount(normalized.beneficiaryAccount),
        amount: normalized.amount,
        beneficiaryIsParticipant: normalized.beneficiaryIsParticipant,
        captchaSupplied: normalized.captcha.length > 0,
      },
      result: {
        kind: 'cep',
        title: 'Banxico CEP download',
        message: `Banxico returned a direct ${contentType} download.`,
        text: '',
        html: '',
        contentType,
        fileName,
        download: {
          contentBase64: buffer.toString('base64'),
          contentType,
          fileName,
        },
        found: true,
        operationNotFound: false,
        captchaInvalid: false,
      },
    }
  }

  const html = await response.text()
  const result = parseLookupHtml(html, contentType)

  return {
    fetchedAtUtc: new Date().toISOString(),
    sourceUrl,
    request: {
      operationDate: normalized.operationDate.isoDate,
      banxicoDate: normalized.operationDate.banxicoDate,
      searchType: normalized.searchType,
      mode: normalized.mode,
      criteria: normalized.criteria,
      issuerId: normalized.issuerId,
      receiverId: normalized.receiverId,
      beneficiaryAccountMasked: maskAccount(normalized.beneficiaryAccount),
      amount: normalized.amount,
      beneficiaryIsParticipant: normalized.beneficiaryIsParticipant,
      captchaSupplied: normalized.captcha.length > 0,
    },
    result,
  }
}

export async function downloadBanxicoCepDetails(
  input: BanxicoCepLookupInput,
): Promise<BanxicoCepTransferDetails | null> {
  const normalized = normalizeLookupInput({
    ...input,
    mode: 'cep',
  })
  const initialCookies = await openBanxicoSession()
  const sourceUrl = buildBanxicoUrl('/valida.do')
  const response = await fetchBanxico(sourceUrl, {
    method: 'POST',
    headers: {
      Accept: 'text/html,application/xhtml+xml,text/xml,application/xml',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent': DEFAULT_BANXICO_USER_AGENT,
      ...(initialCookies ? { Cookie: initialCookies } : {}),
    },
    body: new URLSearchParams({
      tipoCriterio: normalized.searchType === 'trackingKey' ? 'T' : 'R',
      fecha: normalized.operationDate.banxicoDate,
      criterio: normalized.criteria,
      emisor: normalized.issuerId,
      receptor: normalized.receiverId,
      cuenta: normalized.beneficiaryAccount ?? '',
      receptorParticipante: normalized.beneficiaryIsParticipant ? '1' : '0',
      monto: normalized.amount ?? '',
      captcha: normalized.captcha,
      tipoConsulta: '1',
    }).toString(),
  })

  const cookieHeader = mergeCookieHeaders(initialCookies, extractCookieHeader(response))
  const contentType = normalizeContentType(response.headers.get('content-type'))

  if (contentType === 'application/xml' || contentType === 'text/xml') {
    return parseBanxicoCepXml(await response.text())
  }

  if (!isTextContentType(contentType)) {
    return null
  }

  const html = await response.text()
  const parsedHtml = parseLookupHtml(html, contentType)
  if (parsedHtml.operationNotFound || parsedHtml.captchaInvalid || !hasBanxicoXmlDownloadLink(html)) {
    return null
  }

  const xmlResponse = await fetchBanxico(buildBanxicoUrl('/descarga.do'), {
    method: 'GET',
    headers: {
      Accept: 'application/xml,text/xml,application/xhtml+xml,text/html',
      Referer: buildBanxicoUrl('/'),
      'User-Agent': DEFAULT_BANXICO_USER_AGENT,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    query: {
      formato: 'XML',
    },
  })

  const xmlContentType = normalizeContentType(xmlResponse.headers.get('content-type'))
  if (xmlContentType !== 'application/xml' && xmlContentType !== 'text/xml' && !isTextContentType(xmlContentType)) {
    return null
  }

  return parseBanxicoCepXml(await xmlResponse.text())
}

async function openBanxicoSession() {
  const response = await fetchBanxico(buildBanxicoUrl('/'), {
    method: 'GET',
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': DEFAULT_BANXICO_USER_AGENT,
    },
  })

  return extractCookieHeader(response)
}

function normalizeLookupInput(input: BanxicoCepLookupInput): NormalizedBanxicoLookupInput {
  const operationDate = normalizeOperationDate(input.operationDate, {
    required: true,
    fieldName: 'operationDate',
  })
  const searchType = normalizeSearchType(input.searchType)
  const mode = normalizeMode(input.mode)
  const criteria = requireNonEmptyString(input.criteria, 'criteria')
  const issuerId = requireInstitutionId(input.issuerId, 'issuerId')
  const receiverId = requireInstitutionId(input.receiverId, 'receiverId')
  const beneficiaryAccount = normalizeBeneficiaryAccount(input.beneficiaryAccount ?? null, mode === 'cep')
  const amount = normalizeAmount(input.amount ?? null, mode === 'cep')
  const beneficiaryIsParticipant = Boolean(input.beneficiaryIsParticipant)
  const captcha = normalizeCaptcha(input.captcha)

  return {
    operationDate,
    searchType,
    mode,
    criteria,
    issuerId,
    receiverId,
    beneficiaryAccount,
    amount,
    beneficiaryIsParticipant,
    captcha,
  }
}

function parseLookupHtml(html: string, contentType: string): BanxicoCepLookupResult {
  const text = collapseWhitespace(stripHtml(html))
  const title = extractFirstMatch(html, /<div class="bg-banxico title-bar">([\s\S]*?)<\/div>/i)
  const messageCandidates = [
    ...extractAllMatches(html, /<p\b[^>]*>([\s\S]*?)<\/p>/gi),
    ...extractAllMatches(html, /<strong\b[^>]*>([\s\S]*?)<\/strong>/gi),
  ]
    .map((candidate) => collapseWhitespace(stripHtml(candidate)))
    .filter((candidate) => candidate && candidate.toLowerCase() !== 'error')

  const message = messageCandidates.find((candidate) => candidate.length >= 8) ?? null
  const normalizedText = normalizeFreeText(`${title ?? ''} ${text}`)
  const normalizedTitle = normalizeFreeText(title ?? '')
  const operationNotFound = normalizedText.includes('operacionnoencontrada')
  const captchaInvalid = normalizedText.includes('codigodeseguridadesinvalido')
  const hasPaymentStatusTitle = normalizedText.includes('informaciondelestadodelpago')
  const hasCepSignals =
    normalizedText.includes('comprobanteelectronicodepago') ||
    normalizedText.includes('cadenaoriginal') ||
    normalizedText.includes('sellodigital') ||
    normalizedText.includes('foliofiscal')

  let kind: BanxicoCepLookupClassification = 'unknown'
  if (captchaInvalid || normalizedTitle === 'error' || normalizedText.startsWith('error')) {
    kind = 'error'
  } else if (hasPaymentStatusTitle) {
    kind = 'payment_status'
  } else if (hasCepSignals) {
    kind = 'cep'
  }

  const found = operationNotFound ? false : kind === 'error' ? null : kind === 'unknown' ? null : true

  return {
    kind,
    title,
    message,
    text,
    html,
    contentType,
    fileName: null,
    download: null,
    found,
    operationNotFound,
    captchaInvalid,
  }
}

function hasBanxicoXmlDownloadLink(html: string) {
  return /descarga\.do\?formato=XML/i.test(html)
}

function parseBanxicoCepXml(xml: string): BanxicoCepTransferDetails | null {
  const rootTag = extractFirstMatch(xml, /<SPEI_Tercero\b([^>]*)>/i)
  if (!rootTag) {
    return null
  }

  const rootAttributes = parseXmlAttributes(rootTag)
  const orderingAttributes = parseXmlAttributes(extractFirstMatch(xml, /<Ordenante\b([^>]*)\/>/i))
  const beneficiaryAttributes = parseXmlAttributes(extractFirstMatch(xml, /<Beneficiario\b([^>]*)\/>/i))

  return {
    operationDate: cleanXmlValue(rootAttributes.FechaOperacion),
    processedAt: cleanXmlValue(
      [rootAttributes.FechaOperacion, rootAttributes.Hora].filter((value) => cleanXmlValue(value)).join(' '),
    ),
    concept: cleanXmlValue(beneficiaryAttributes.Concepto),
    amount: cleanXmlValue(beneficiaryAttributes.MontoPago),
    vat: cleanXmlValue(beneficiaryAttributes.IVA),
    trackingKey: cleanXmlValue(rootAttributes.claveRastreo),
    orderingParty: buildBanxicoCepParty({
      bankName: orderingAttributes.BancoEmisor,
      name: orderingAttributes.Nombre,
      account: orderingAttributes.Cuenta,
      rfc: orderingAttributes.RFC,
    }),
    beneficiary: buildBanxicoCepParty({
      bankName: beneficiaryAttributes.BancoReceptor,
      name: beneficiaryAttributes.Nombre,
      account: beneficiaryAttributes.Cuenta,
      rfc: beneficiaryAttributes.RFC,
    }),
    xml,
  }
}

function buildBanxicoCepParty(attributes: {
  bankName?: string
  name?: string
  account?: string
  rfc?: string
}): BanxicoCepTransferParty | null {
  const bankName = cleanXmlValue(attributes.bankName)
  const name = cleanXmlValue(attributes.name)
  const account = cleanXmlValue(attributes.account)
  const rfc = cleanXmlValue(attributes.rfc)
  if (!bankName && !name && !account && !rfc) {
    return null
  }

  return {
    bankName,
    name,
    account,
    rfc,
  }
}

function parseXmlAttributes(rawAttributes: string | null) {
  const attributes: Record<string, string> = {}
  if (!rawAttributes) {
    return attributes
  }

  const pattern = /([A-Za-z0-9_:-]+)="([^"]*)"/g
  let match = pattern.exec(rawAttributes)
  while (match) {
    attributes[match[1]] = decodeXmlEntities(match[2])
    match = pattern.exec(rawAttributes)
  }

  return attributes
}

function cleanXmlValue(value: string | null | undefined) {
  const cleaned = collapseWhitespace((value ?? '').trim())
  return cleaned || null
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

async function fetchBanxico(
  url: string,
  options: {
    method: 'GET' | 'POST'
    headers?: Record<string, string>
    query?: Record<string, string>
    body?: string
  },
) {
  const requestUrl = new URL(url)
  Object.entries(options.query ?? {}).forEach(([key, value]) => {
    requestUrl.searchParams.set(key, value)
  })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_BANXICO_TIMEOUT_MS)

  try {
    const response = await fetch(requestUrl, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
      redirect: 'follow',
    })

    if (!response.ok) {
      const payload = await response.text()
      throw new BanxicoServiceError(
        `Banxico CEP HTTP ${response.status}: ${collapseWhitespace(stripHtml(payload)).slice(0, 240) || 'empty response'}`,
        response.status,
      )
    }

    return response
  } catch (error) {
    if (error instanceof BanxicoServiceError) {
      throw error
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new BanxicoServiceError(
        `Banxico CEP request timed out after ${DEFAULT_BANXICO_TIMEOUT_MS} ms.`,
        504,
      )
    }

    throw new BanxicoServiceError(
      error instanceof Error ? `Unable to reach Banxico CEP: ${error.message}` : 'Unable to reach Banxico CEP.',
      503,
    )
  } finally {
    clearTimeout(timeout)
  }
}

function parseJsonPayload<T>(text: string, sourceUrl: string): T {
  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new BanxicoServiceError(
      error instanceof Error
        ? `Banxico CEP returned invalid JSON from ${sourceUrl}: ${error.message}`
        : `Banxico CEP returned invalid JSON from ${sourceUrl}.`,
      502,
    )
  }
}

function buildInstitutionCatalogResponse({
  operationDate,
  institutions,
  institutionsMispei,
  overrideCaptcha,
  sourceUrl,
}: {
  operationDate: NormalizedOperationDate
  institutions: BanxicoInstitution[]
  institutionsMispei: BanxicoInstitution[]
  overrideCaptcha: boolean
  sourceUrl: string
}): BanxicoInstitutionCatalog {
  return {
    fetchedAtUtc: new Date().toISOString(),
    date: operationDate.isoDate,
    banxicoDate: operationDate.banxicoDate,
    overrideCaptcha,
    institutions,
    institutionsMispei,
    sourceUrl,
  }
}

function normalizeInstitutionList(value: BanxicoInstitutionTuple[] | undefined): BanxicoInstitution[] {
  return (value ?? [])
    .filter(
      (item): item is BanxicoInstitutionTuple =>
        Array.isArray(item) &&
        typeof item[0] === 'string' &&
        item[0].trim().length > 0 &&
        typeof item[1] === 'string' &&
        item[1].trim().length > 0,
    )
    .map(([id, name]) => ({
      id: id.trim(),
      name: collapseWhitespace(name),
    }))
}

async function fetchBanxicoCepInstitutionsHtmlFallback(operationDate: NormalizedOperationDate) {
  const sourceUrl = DEFAULT_BANXICO_CEP_SCL_LIST_URL
  const response = await fetchBanxico(sourceUrl, {
    method: 'GET',
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': DEFAULT_BANXICO_USER_AGENT,
    },
  })

  const institutions = parseInstitutionListHtml(await response.text(), sourceUrl)
  return buildInstitutionCatalogResponse({
    operationDate,
    institutions,
    institutionsMispei: institutions,
    overrideCaptcha: false,
    sourceUrl,
  })
}

function parseInstitutionListHtml(html: string, sourceUrl: string) {
  const matches = Array.from(
    html.matchAll(/<tr>\s*<td[^>]*>(\d{3,6})<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/giu),
  )

  const institutions = matches
    .map((match) => ({
      id: match[1]?.trim() ?? '',
      name: decodeHtmlEntities(collapseWhitespace(stripHtml(match[2] ?? ''))),
    }))
    .filter((item) => item.id.length > 0 && item.name.length > 0)

  if (institutions.length === 0) {
    throw new BanxicoServiceError(
      `Banxico CEP fallback returned no institutions from ${sourceUrl}.`,
      502,
    )
  }

  return institutions
}

function normalizeOperationDate(
  rawValue: string | null,
  options: {
    required: boolean
    fieldName: string
  },
): NormalizedOperationDate {
  const normalized = rawValue?.trim()
  if (!normalized) {
    if (options.required) {
      throw new BanxicoServiceError(`${options.fieldName} is required.`, 400)
    }

    const today = getCurrentMexicoDate()
    return {
      isoDate: today,
      banxicoDate: isoDateToBanxicoDate(today),
    }
  }

  const isoMatch = normalized.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/)
  if (isoMatch) {
    const [, year, month, day] = isoMatch
    return buildNormalizedDate(year, month, day, options.fieldName)
  }

  const localMatch = normalized.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/)
  if (localMatch) {
    const [, day, month, year] = localMatch
    return buildNormalizedDate(year, month, day, options.fieldName)
  }

  throw new BanxicoServiceError(
    `${options.fieldName} must use YYYY-MM-DD or DD-MM-YYYY format.`,
    400,
  )
}

function buildNormalizedDate(year: string, month: string, day: string, fieldName: string): NormalizedOperationDate {
  const isoDate = `${year}-${month}-${day}`
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== isoDate) {
    throw new BanxicoServiceError(`${fieldName} is not a valid calendar date.`, 400)
  }

  return {
    isoDate,
    banxicoDate: `${day}-${month}-${year}`,
  }
}

function normalizeSearchType(rawValue: string): BanxicoSearchType {
  switch (normalizeFreeText(rawValue)) {
    case 't':
    case 'tracking':
    case 'trackingkey':
    case 'claverastreo':
    case 'rastreo':
      return 'trackingKey'
    case 'r':
    case 'reference':
    case 'referencia':
    case 'referencenumber':
    case 'numeroreferencia':
      return 'referenceNumber'
    default:
      throw new BanxicoServiceError(
        'searchType must be trackingKey or referenceNumber.',
        400,
      )
  }
}

function normalizeMode(rawValue: string | null | undefined): BanxicoQueryMode {
  switch (normalizeFreeText(rawValue ?? 'status')) {
    case '':
    case 'status':
    case 'consult':
    case 'consulta':
    case 'estado':
      return 'status'
    case 'cep':
    case 'download':
    case 'descargar':
      return 'cep'
    default:
      throw new BanxicoServiceError('mode must be status or cep.', 400)
  }
}

function requireNonEmptyString(rawValue: string, fieldName: string) {
  const normalized = rawValue?.trim()
  if (!normalized) {
    throw new BanxicoServiceError(`${fieldName} is required.`, 400)
  }

  return normalized
}

function requireInstitutionId(rawValue: string, fieldName: string) {
  const normalized = requireNonEmptyString(rawValue, fieldName)
  if (!/^\d{3,6}$/.test(normalized)) {
    throw new BanxicoServiceError(`${fieldName} must be a Banxico institution code.`, 400)
  }

  return normalized
}

function normalizeBeneficiaryAccount(rawValue: string | null, required: boolean) {
  const normalized = rawValue?.trim() ?? ''
  if (!normalized) {
    if (required) {
      throw new BanxicoServiceError('beneficiaryAccount is required when mode=cep.', 400)
    }
    return null
  }

  if (!/^\d{10,18}$/.test(normalized)) {
    throw new BanxicoServiceError(
      'beneficiaryAccount must contain 10 to 18 digits.',
      400,
    )
  }

  return normalized
}

function normalizeAmount(rawValue: string | number | null, required: boolean) {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    if (required) {
      throw new BanxicoServiceError('amount is required when mode=cep.', 400)
    }
    return null
  }

  if (typeof rawValue === 'number') {
    if (!Number.isFinite(rawValue) || rawValue < 0) {
      throw new BanxicoServiceError('amount must be a finite positive number.', 400)
    }

    return rawValue.toFixed(2)
  }

  const normalized = rawValue.trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new BanxicoServiceError('amount must use digits with optional decimals.', 400)
  }

  return normalized
}

function normalizeCaptcha(rawValue: string | null | undefined) {
  const normalized = rawValue?.trim()
  return normalized && normalized.length > 0 ? normalized : 'c'
}

function maskAccount(value: string | null) {
  if (!value) {
    return null
  }

  if (value.length <= 4) {
    return value
  }

  return `${'*'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`
}

function buildBanxicoUrl(pathname: string) {
  const baseUrl = DEFAULT_BANXICO_CEP_BASE_URL.replace(/\/+$/, '')
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`
  return `${baseUrl}${normalizedPath}`
}

function normalizeContentType(rawValue: string | null) {
  return rawValue?.split(';', 1)[0]?.trim().toLowerCase() || 'application/octet-stream'
}

function isTextContentType(contentType: string) {
  return (
    contentType === 'text/html' ||
    contentType === 'application/xhtml+xml' ||
    contentType === 'application/json' ||
    contentType === 'text/plain'
  )
}

function buildDownloadFileName(input: NormalizedBanxicoLookupInput, contentType: string) {
  const criteriaToken = sanitizeFileNameToken(input.criteria).slice(0, 30) || 'consulta'
  const extension = guessExtension(contentType)
  return `banxico-cep-${input.operationDate.isoDate}-${criteriaToken}.${extension}`
}

function guessExtension(contentType: string) {
  switch (contentType) {
    case 'application/pdf':
      return 'pdf'
    case 'application/xml':
    case 'text/xml':
      return 'xml'
    case 'application/zip':
      return 'zip'
    case 'text/plain':
      return 'txt'
    default:
      return 'bin'
  }
}

function sanitizeFileNameToken(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

function extractCookieHeader(response: Response) {
  const responseHeaders = response.headers as Headers & { getSetCookie?: () => string[] }
  const rawCookies =
    typeof responseHeaders.getSetCookie === 'function'
      ? responseHeaders.getSetCookie()
      : splitSetCookieHeader(response.headers.get('set-cookie'))

  return rawCookies
    .map((cookie) => cookie.split(';', 1)[0]?.trim() ?? '')
    .filter(Boolean)
    .join('; ')
}

function mergeCookieHeaders(...cookieHeaders: Array<string | null | undefined>) {
  const cookieMap = new Map<string, string>()

  cookieHeaders
    .flatMap((header) => (header ?? '').split(';'))
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((cookie) => {
      const [name, value] = cookie.split('=', 2)
      if (!name || value === undefined) {
        return
      }

      cookieMap.set(name.trim(), value.trim())
    })

  return Array.from(cookieMap.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

function splitSetCookieHeader(rawValue: string | null) {
  if (!rawValue) {
    return []
  }

  return rawValue.split(/,(?=[^;,=\s]+=[^;,]+)/g).map((item) => item.trim())
}

function extractFirstMatch(value: string, pattern: RegExp) {
  const match = value.match(pattern)
  if (!match?.[1]) {
    return null
  }

  const normalized = collapseWhitespace(stripHtml(match[1]))
  return normalized || null
}

function extractAllMatches(value: string, pattern: RegExp) {
  const matches = Array.from(value.matchAll(pattern))
  return matches.map((match) => match[1] ?? '')
}

function stripHtml(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
}

function decodeHtmlEntities(value: string) {
  const namedEntities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    aacute: 'a',
    eacute: 'e',
    iacute: 'i',
    oacute: 'o',
    uacute: 'u',
    Aacute: 'A',
    Eacute: 'E',
    Iacute: 'I',
    Oacute: 'O',
    Uacute: 'U',
    auml: 'a',
    euml: 'e',
    iuml: 'i',
    ouml: 'o',
    uuml: 'u',
    ntilde: 'n',
    Ntilde: 'N',
    ordm: 'o',
    reg: '(R)',
  }

  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_fullMatch, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ''
    }

    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ''
    }

    return namedEntities[entity] ?? ''
  })
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeFreeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase()
}

function getCurrentMexicoDate() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  return formatter.format(new Date())
}

function isoDateToBanxicoDate(value: string) {
  const [year, month, day] = value.split('-')
  return `${day}-${month}-${year}`
}

function parsePositiveInteger(rawValue: string | undefined, fallback: number) {
  const parsed = Number.parseInt(rawValue ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
