import {
  analyzeInventoryCertificateText,
  lookupInventoryCertificate,
  type InventoryCertificateAnalysis,
  type InventoryCertificateDetectedDate,
} from './inventoryCertificates.js'
import { findInventoryLotReplacementRegistryEntry } from './inventoryLotReplacementRegistry.js'
import { inspectNetSuiteFileFromReference } from './netsuiteAttachmentInspection.js'
import { NetSuiteClient } from './netsuiteClient.js'

type InventoryLotSummaryRequest = {
  itemId?: unknown
  lot?: unknown
  declaredNewLot?: unknown
  declaredProductionDate?: unknown
  declaredExpirationDate?: unknown
}

type InventoryLotSummaryProduct = {
  internalId: string
  itemId: string
  displayName: string | null
  label: string
}

type InventoryLotSummaryResponse = {
  generatedAtUtc: string
  product: InventoryLotSummaryProduct
  lot: {
    inventoryNumberId: string
    inventoryNumber: string
    expirationDateNetSuite: {
      raw: string | null
      normalized: string | null
    }
  }
  stock: {
    quantityOnHand: number
    quantityAvailable: number
  }
  coa: {
    source: 'netsuite_file' | 'search_directories' | 'unavailable'
    fileId: string | null
    fileName: string | null
    fileUrl: string | null
    matchedBy: string[]
    dates: {
      manufacture: InventoryCertificateDetectedDate | null
      expiration: InventoryCertificateDetectedDate | null
    }
    warnings: string[]
  }
  declaredNewLot: {
    raw: string | null
    normalized: string | null
  }
  declaredDates: {
    production: {
      raw: string | null
      normalized: string | null
    }
    expiration: {
      raw: string | null
      normalized: string | null
    }
    warnings: string[]
  }
}

type NetSuiteCertificateCandidate = {
  fileId: string
  fileName: string
  fileUrl: string | null
  matchedBy: string[]
  score: number
}

const COA_SUMMARY_CACHE_TTL_MS = 15 * 60 * 1000
const coaSummaryCache = new Map<
  string,
  {
    storedAtMs: number
    value: InventoryLotSummaryResponse['coa']
  }
>()

export function invalidateInventoryLotSummaryCache() {
  coaSummaryCache.clear()
}

export class InventoryLotSummaryError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'InventoryLotSummaryError'
  }
}

export async function fetchInventoryLotSummary(
  client: NetSuiteClient,
  rawRequest: InventoryLotSummaryRequest,
): Promise<InventoryLotSummaryResponse> {
  const itemId = normalizeRequiredString(
    rawRequest.itemId,
    'Selecciona un producto para consultar su lote.',
  )
  const lot = normalizeRequiredString(rawRequest.lot, 'Selecciona un lote para consultar su ficha.')

  const product = await fetchInventoryLotProduct(client, itemId)
  const inventoryNumber = await fetchInventoryNumberSummary(client, product.internalId, lot)
  const stock = await fetchInventoryLotStock(client, product.internalId, inventoryNumber.inventoryNumberId)
  const coa = await resolveCertificateSummary(client, product, inventoryNumber.inventoryNumber)
  const enrichedCoa = await overlayReplacementRegistryDates(product.internalId, lot, coa)
  const declaredInputs = normalizeDeclaredInputs(rawRequest, inventoryNumber.inventoryNumber)

  return {
    generatedAtUtc: new Date().toISOString(),
    product,
    lot: inventoryNumber,
    stock,
    coa: enrichedCoa,
    declaredNewLot: declaredInputs.declaredNewLot,
    declaredDates: declaredInputs.declaredDates,
  }
}

async function fetchInventoryLotProduct(client: NetSuiteClient, itemInternalId: string) {
  const response = await client.suiteql(
    `
SELECT
  item.id AS internalId,
  item.itemid AS itemId,
  item.displayname AS displayName
FROM item
WHERE item.id = ${formatSuiteQlLiteral(itemInternalId)}
FETCH FIRST 1 ROWS ONLY
    `.trim(),
    1,
    0,
  )

  const row = Array.isArray(response.json.items)
    ? (response.json.items[0] as Record<string, unknown> | undefined)
    : undefined
  const normalizedRow = normalizeSuiteQlRow(row)
  const internalId = getNullableString(normalizedRow.internalid)
  const itemId = getNullableString(normalizedRow.itemid)
  if (!internalId || !itemId) {
    throw new InventoryLotSummaryError('No encontré ese producto en NetSuite.', 404)
  }

  const displayName = getNullableString(normalizedRow.displayname)
  return {
    internalId,
    itemId,
    displayName,
    label: displayName && displayName !== itemId ? `${itemId} - ${displayName}` : itemId,
  } satisfies InventoryLotSummaryProduct
}

async function fetchInventoryNumberSummary(
  client: NetSuiteClient,
  itemInternalId: string,
  lot: string,
) {
  const response = await client.suiteql(
    `
SELECT
  inventorynumber.id AS inventoryNumberId,
  inventorynumber.inventorynumber AS inventoryNumber,
  inventorynumber.expirationdate AS expirationDate
FROM inventorynumber
WHERE inventorynumber.item = ${formatSuiteQlLiteral(itemInternalId)}
  AND UPPER(inventorynumber.inventorynumber) = ${formatSuiteQlLiteral(lot.toUpperCase())}
FETCH FIRST 1 ROWS ONLY
    `.trim(),
    1,
    0,
  )

  const row = Array.isArray(response.json.items)
    ? (response.json.items[0] as Record<string, unknown> | undefined)
    : undefined
  const normalizedRow = normalizeSuiteQlRow(row)
  const inventoryNumberId = getNullableString(normalizedRow.inventorynumberid)
  const inventoryNumber = getNullableString(normalizedRow.inventorynumber)
  if (!inventoryNumberId || !inventoryNumber) {
    throw new InventoryLotSummaryError('No encontré ese lote dentro del producto seleccionado.', 404)
  }

  const rawExpirationDate = getNullableString(normalizedRow.expirationdate)

  return {
    inventoryNumberId,
    inventoryNumber,
    expirationDateNetSuite: {
      raw: rawExpirationDate,
      normalized: normalizeDateCandidate(rawExpirationDate),
    },
  }
}

async function fetchInventoryLotStock(
  client: NetSuiteClient,
  itemInternalId: string,
  inventoryNumberId: string,
) {
  const response = await client.suiteql(
    `
SELECT
  SUM(ib.quantityonhand) AS quantityOnHand,
  SUM(ib.quantityavailable) AS quantityAvailable
FROM InventoryBalance ib
WHERE ib.item = ${formatSuiteQlLiteral(itemInternalId)}
  AND ib.inventorynumber = ${formatSuiteQlLiteral(inventoryNumberId)}
    `.trim(),
    1,
    0,
  )

  const row = Array.isArray(response.json.items)
    ? (response.json.items[0] as Record<string, unknown> | undefined)
    : undefined
  const normalizedRow = normalizeSuiteQlRow(row)

  return {
    quantityOnHand: getNullableNumber(normalizedRow.quantityonhand) ?? 0,
    quantityAvailable: getNullableNumber(normalizedRow.quantityavailable) ?? 0,
  } satisfies InventoryLotSummaryResponse['stock']
}

async function resolveCertificateSummary(
  client: NetSuiteClient,
  product: InventoryLotSummaryProduct,
  lot: string,
): Promise<InventoryLotSummaryResponse['coa']> {
  const cacheKey = `${product.internalId}:${lot.toUpperCase()}`
  const cachedSummary = readCachedCoaSummary(cacheKey)
  if (cachedSummary) {
    return cachedSummary
  }

  const candidate = await searchNetSuiteCertificateCandidate(client, product, lot)
  if (candidate) {
    try {
      const inspected = await inspectNetSuiteFileFromReference({
        fileId: candidate.fileId,
        includeText: true,
      })
      const analysis = analyzeInventoryCertificateText(inspected.attachment.parsedText, {
        lot,
        includeText: false,
        parseError: inspected.attachment.parseError,
      })

      const summary = buildCoaSummary({
        source: 'netsuite_file',
        fileId: candidate.fileId,
        fileName: candidate.fileName,
        fileUrl: candidate.fileUrl,
        matchedBy: candidate.matchedBy,
        analysis,
      })
      storeCachedCoaSummary(cacheKey, summary)
      return summary
    } catch (error) {
      const fallback = await tryResolveLocalCertificate(product.label, lot, candidate.fileName)
      if (fallback) {
        storeCachedCoaSummary(cacheKey, fallback)
        return fallback
      }

      const unavailableSummary = {
        source: 'unavailable',
        fileId: candidate.fileId,
        fileName: candidate.fileName,
        fileUrl: candidate.fileUrl,
        matchedBy: candidate.matchedBy,
        dates: {
          manufacture: null,
          expiration: null,
        },
        warnings: [
          error instanceof Error
            ? error.message
            : 'No pude inspeccionar el CoA encontrado en NetSuite.',
        ],
      } satisfies InventoryLotSummaryResponse['coa']

      return unavailableSummary
    }
  }

  const fallback = await tryResolveLocalCertificate(product.label, lot)
  if (fallback) {
    storeCachedCoaSummary(cacheKey, fallback)
    return fallback
  }

  return {
    source: 'unavailable',
    fileId: null,
    fileName: null,
    fileUrl: null,
    matchedBy: [],
    dates: {
      manufacture: null,
      expiration: null,
    },
    warnings: ['No encontré un CoA para este lote ni en NetSuite ni en las carpetas conectadas.'],
  }
}

async function tryResolveLocalCertificate(
  productLabel: string,
  lot: string,
  fileName?: string | null,
) {
  try {
    const localMatch = await lookupInventoryCertificate({
      fileName: fileName ?? undefined,
      lot,
      productQuery: productLabel,
    })

    return buildCoaSummary({
      source: 'search_directories',
      fileId: null,
      fileName: localMatch.match.fileName,
      fileUrl: null,
      matchedBy: localMatch.match.matchedBy,
      analysis: localMatch.analysis,
    })
  } catch {
    return null
  }
}

async function searchNetSuiteCertificateCandidate(
  client: NetSuiteClient,
  product: InventoryLotSummaryProduct,
  lot: string,
) {
  const response = await client.suiteql(
    `
SELECT
  file.id AS fileId,
  file.name AS fileName,
  file.url AS fileUrl
FROM File file
WHERE UPPER(file.name) LIKE ${formatSuiteQlLiteral(`%${escapeLikeValue(lot.toUpperCase())}%`)}
ORDER BY file.id DESC
FETCH FIRST 20 ROWS ONLY
    `.trim(),
    20,
    0,
  )

  const rows = Array.isArray(response.json.items)
    ? (response.json.items as Record<string, unknown>[])
    : []
  const candidates = rows
    .map((row) => scoreNetSuiteCertificateCandidate(normalizeSuiteQlRow(row), product, lot))
    .filter((candidate): candidate is NetSuiteCertificateCandidate => candidate !== null)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      return right.fileId.localeCompare(left.fileId)
    })

  return candidates[0] ?? null
}

function scoreNetSuiteCertificateCandidate(
  row: Record<string, unknown>,
  product: InventoryLotSummaryProduct,
  lot: string,
) {
  const fileId = getNullableString(row.fileid)
  const fileName = getNullableString(row.filename)
  if (!fileId || !fileName) {
    return null
  }

  const normalizedFileName = normalizeForMatch(fileName)
  const normalizedLot = normalizeForMatch(lot)
  if (!normalizedFileName.includes(normalizedLot)) {
    return null
  }

  const matchedBy = ['lot']
  let score = 900
  const productTokens = tokenizeForMatch(product.itemId)
  const displayTokens = product.displayName ? tokenizeForMatch(product.displayName) : []
  const tokenPool = Array.from(new Set([...productTokens, ...displayTokens]))
  const productMatches = tokenPool.filter((token) => normalizedFileName.includes(token))

  if (productMatches.length > 0) {
    matchedBy.push('product')
    score += productMatches.length * 120
  }

  if (normalizedFileName.includes('(shq)')) {
    matchedBy.push('shq')
    score += 40
  }

  if (normalizedFileName.includes('fi')) {
    matchedBy.push('fi')
    score += 20
  }

  return {
    fileId,
    fileName,
    fileUrl: getNullableString(row.fileurl),
    matchedBy,
    score,
  } satisfies NetSuiteCertificateCandidate
}

function buildCoaSummary(params: {
  source: InventoryLotSummaryResponse['coa']['source']
  fileId: string | null
  fileName: string | null
  fileUrl: string | null
  matchedBy: string[]
  analysis: InventoryCertificateAnalysis
}) {
  return {
    source: params.source,
    fileId: params.fileId,
    fileName: params.fileName,
    fileUrl: params.fileUrl,
    matchedBy: params.matchedBy,
    dates: {
      manufacture: params.analysis.dates.production,
      expiration: params.analysis.dates.expiration,
    },
    warnings: params.analysis.warnings,
  }
}

function readCachedCoaSummary(cacheKey: string) {
  const cachedEntry = coaSummaryCache.get(cacheKey)
  if (!cachedEntry) {
    return null
  }

  if (Date.now() - cachedEntry.storedAtMs > COA_SUMMARY_CACHE_TTL_MS) {
    coaSummaryCache.delete(cacheKey)
    return null
  }

  return cachedEntry.value
}

function storeCachedCoaSummary(cacheKey: string, value: InventoryLotSummaryResponse['coa']) {
  coaSummaryCache.set(cacheKey, {
    storedAtMs: Date.now(),
    value,
  })
}

async function overlayReplacementRegistryDates(
  itemId: string,
  lot: string,
  coa: InventoryLotSummaryResponse['coa'],
) {
  const replacementEntry = await findInventoryLotReplacementRegistryEntry(itemId, lot)
  if (!replacementEntry) {
    return coa
  }

  if (
    replacementEntry.coaFileName &&
    coa.fileName &&
    normalizeForMatch(replacementEntry.coaFileName) !== normalizeForMatch(coa.fileName)
  ) {
    return coa
  }

  return {
    ...coa,
    dates: {
      manufacture: {
        label: 'fecha de produccion',
        raw: formatWarningDate(replacementEntry.productionDate),
        normalized: replacementEntry.productionDate,
        line: replacementEntry.coaFileName,
      },
      expiration: {
        label: 'fecha de caducidad',
        raw: formatWarningDate(replacementEntry.expirationDate),
        normalized: replacementEntry.expirationDate,
        line: replacementEntry.coaFileName,
      },
    },
  }
}

function normalizeDeclaredInputs(rawRequest: InventoryLotSummaryRequest, currentLot: string) {
  const newLotRaw = getNullableString(rawRequest.declaredNewLot)
  const newLotNormalized = normalizeDeclaredLotValue(newLotRaw)
  const productionRaw = getNullableString(rawRequest.declaredProductionDate)
  const expirationRaw = getNullableString(rawRequest.declaredExpirationDate)
  const productionNormalized = normalizeDeclaredDateValue(
    productionRaw,
    'La nueva fecha de produccion no tiene un formato valido.',
  )
  const expirationNormalized = normalizeDeclaredDateValue(
    expirationRaw,
    'La nueva fecha de caducidad no tiene un formato valido.',
  )
  const warnings: string[] = []

  if (newLotNormalized && normalizeForMatch(newLotNormalized) === normalizeForMatch(currentLot)) {
    warnings.push('El lote nuevo no puede ser igual al lote actual.')
  }

  const inferredProductionDateFromLot = inferDateFromLotToken(newLotNormalized)
  if (
    inferredProductionDateFromLot &&
    productionNormalized &&
    inferredProductionDateFromLot !== productionNormalized
  ) {
    warnings.push(
      `El lote nuevo parece codificar ${formatWarningDate(inferredProductionDateFromLot)}, pero la nueva fecha de produccion declarada es ${formatWarningDate(productionNormalized)}.`,
    )
  }

  if (
    productionNormalized &&
    expirationNormalized &&
    expirationNormalized.localeCompare(productionNormalized) < 0
  ) {
    warnings.push(
      'La nueva fecha de caducidad no puede ser anterior a la nueva fecha de produccion.',
    )
  }

  return {
    declaredNewLot: {
      raw: newLotRaw,
      normalized: newLotNormalized,
    },
    declaredDates: {
      production: {
        raw: productionRaw,
        normalized: productionNormalized,
      },
      expiration: {
        raw: expirationRaw,
        normalized: expirationNormalized,
      },
      warnings,
    },
  }
}

function normalizeDeclaredLotValue(value: string | null) {
  if (!value) {
    return null
  }

  const normalized = value.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z0-9._/-]+$/.test(normalized)) {
    throw new InventoryLotSummaryError('El lote nuevo tiene caracteres no validos.', 400)
  }

  return normalized
}

function normalizeDeclaredDateValue(value: string | null, errorMessage: string) {
  if (!value) {
    return null
  }

  const normalized = normalizeDateCandidate(value)
  if (!normalized) {
    throw new InventoryLotSummaryError(errorMessage, 400)
  }

  return normalized
}

function normalizeRequiredString(value: unknown, message: string) {
  const normalized = getNullableString(value)
  if (!normalized) {
    throw new InventoryLotSummaryError(message, 400)
  }

  return normalized
}

function normalizeSuiteQlRow(value: unknown) {
  const record = getNullableRecord(value)
  if (!record) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, rowValue]) => [key.toLowerCase(), rowValue]),
  ) as Record<string, unknown>
}

function getNullableRecord(value: unknown) {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return null
}

function getNullableString(value: unknown) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value)
  }

  return null
}

function getNullableNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function formatSuiteQlLiteral(value: string) {
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return value
  }

  return `'${value.replace(/'/g, "''")}'`
}

function escapeLikeValue(value: string) {
  return value.replace(/'/g, "''")
}

function normalizeForMatch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function tokenizeForMatch(value: string) {
  return Array.from(
    new Set(
      normalizeForMatch(value)
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3),
    ),
  )
}

function normalizeDateCandidate(rawDate: string | null) {
  if (!rawDate) {
    return null
  }

  const parts = rawDate.split(/[./-]/).map((segment) => segment.trim())
  if (parts.length !== 3) {
    return null
  }

  let year = 0
  let month = 0
  let day = 0

  if (parts[0].length === 4) {
    year = Number.parseInt(parts[0], 10)
    month = Number.parseInt(parts[1], 10)
    day = Number.parseInt(parts[2], 10)
  } else {
    day = Number.parseInt(parts[0], 10)
    month = Number.parseInt(parts[1], 10)
    year = Number.parseInt(parts[2], 10)
    if (parts[2].length === 2) {
      year += year >= 70 ? 1900 : 2000
    }
  }

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null
  }

  const candidateDate = new Date(Date.UTC(year, month - 1, day))
  if (
    candidateDate.getUTCFullYear() !== year ||
    candidateDate.getUTCMonth() !== month - 1 ||
    candidateDate.getUTCDate() !== day
  ) {
    return null
  }

  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
}

function inferDateFromLotToken(value: string | null) {
  if (!value) {
    return null
  }

  const sixDigitMatch = value.match(/(\d{6})$/)
  if (!sixDigitMatch) {
    return null
  }

  const token = sixDigitMatch[1]
  return normalizeDateCandidate(`${token.slice(0, 2)}/${token.slice(2, 4)}/20${token.slice(4, 6)}`)
}

function formatWarningDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    return value
  }

  return `${match[3]}/${match[2]}/${match[1]}`
}
