import fs from 'node:fs'
import path from 'node:path'

import type { StoredSatDownloadedCfdi } from './satDownloadHistoryStore.js'

export type SatIgnoredCfdiReason = 'unsupported_traslado' | 'unsupported_pago'

export type StoredSatIgnoredCfdiItem = StoredSatDownloadedCfdi & {
  packageId: string
  packageDownloadedAtUtc: string | null
  windowId: string
  windowLabel: string
  reason: SatIgnoredCfdiReason
  firstIgnoredAtUtc: string
  updatedAtUtc: string
}

type StoredSatIgnoredCfdiFile = {
  version: 1
  items: StoredSatIgnoredCfdiItem[]
}

const SAT_IGNORED_CFDI_STORE_PATH =
  process.env.SAT_IGNORED_CFDI_STORE_PATH?.trim() || resolveDefaultSatIgnoredCfdiStorePath()

function resolveDefaultSatIgnoredCfdiStorePath() {
  const siblingStorePath =
    process.env.SAT_ANALYSIS_WINDOWS_STORE_PATH?.trim() || process.env.SAT_DOWNLOAD_HISTORY_STORE_PATH?.trim()

  if (siblingStorePath) {
    return path.join(path.dirname(siblingStorePath), 'sat-ignored-cfdis.json')
  }

  return path.join(process.env.LOCALAPPDATA || process.cwd(), 'netsuite-recon', 'sat-ignored-cfdis.json')
}

export function getSatIgnoredCfdiStorePath() {
  return SAT_IGNORED_CFDI_STORE_PATH
}

export function loadSatIgnoredCfdis() {
  if (!fs.existsSync(SAT_IGNORED_CFDI_STORE_PATH)) {
    return [] as StoredSatIgnoredCfdiItem[]
  }

  try {
    const raw = fs.readFileSync(SAT_IGNORED_CFDI_STORE_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoredSatIgnoredCfdiFile>
    if (!Array.isArray(parsed.items)) {
      return []
    }

    return parsed.items
      .map(normalizeStoredSatIgnoredCfdiItem)
      .filter((item): item is StoredSatIgnoredCfdiItem => item !== null)
      .sort(compareIgnoredCfdis)
  } catch {
    return []
  }
}

export function getSatIgnoredCfdiArchiveSummary() {
  const items = loadSatIgnoredCfdis()
  return {
    generatedAtUtc: new Date().toISOString(),
    storePath: SAT_IGNORED_CFDI_STORE_PATH,
    count: items.length,
    byReason: countBy(items, (item) => item.reason),
    byTipoComprobante: countBy(items, (item) => item.tipoComprobante ?? 'sin_tipo'),
    items,
  }
}

export function archiveSatIgnoredCfdis(
  items: Array<{
    cfdi: StoredSatDownloadedCfdi
    packageId: string
    packageDownloadedAtUtc: string | null
    windowId: string
    windowLabel: string
    reason: SatIgnoredCfdiReason
    ignoredAtUtc: string
  }>,
) {
  if (items.length === 0) {
    return loadSatIgnoredCfdis()
  }

  const currentItems = loadSatIgnoredCfdis()
  const nextItems = [...currentItems]

  for (const item of items) {
    const archiveKey = buildArchiveKey(item.packageId, item.cfdi)
    const existingIndex = nextItems.findIndex((entry) => buildArchiveKey(entry.packageId, entry) === archiveKey)
    const existing = existingIndex >= 0 ? nextItems[existingIndex] : null
    const archivedItem: StoredSatIgnoredCfdiItem = {
      ...cloneStoredCfdi(item.cfdi),
      packageId: item.packageId,
      packageDownloadedAtUtc: item.packageDownloadedAtUtc,
      windowId: item.windowId,
      windowLabel: item.windowLabel,
      reason: item.reason,
      firstIgnoredAtUtc: existing?.firstIgnoredAtUtc ?? item.ignoredAtUtc,
      updatedAtUtc: item.ignoredAtUtc,
    }

    if (existingIndex >= 0) {
      nextItems[existingIndex] = archivedItem
    } else {
      nextItems.push(archivedItem)
    }
  }

  persistSatIgnoredCfdis(nextItems)
  return loadSatIgnoredCfdis()
}

function persistSatIgnoredCfdis(items: StoredSatIgnoredCfdiItem[]) {
  const directoryPath = path.dirname(SAT_IGNORED_CFDI_STORE_PATH)
  fs.mkdirSync(directoryPath, { recursive: true })
  fs.writeFileSync(
    SAT_IGNORED_CFDI_STORE_PATH,
    JSON.stringify({ version: 1, items: [...items].sort(compareIgnoredCfdis) } satisfies StoredSatIgnoredCfdiFile, null, 2),
    'utf8',
  )
}

function normalizeStoredSatIgnoredCfdiItem(value: unknown): StoredSatIgnoredCfdiItem | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const reason =
    item.reason === 'unsupported_traslado' || item.reason === 'unsupported_pago' ? item.reason : null
  if (!reason) {
    return null
  }

  const normalized: StoredSatIgnoredCfdiItem = {
    fileName: getStringValue(item.fileName),
    sizeBytes: normalizeNumber(item.sizeBytes),
    uuid: getNullableString(item.uuid),
    fecha: getNullableString(item.fecha),
    serie: getNullableString(item.serie),
    folio: getNullableString(item.folio),
    tipoComprobante: getNullableString(item.tipoComprobante),
    emisorNombre: getNullableString(item.emisorNombre),
    emisorRfc: getNullableString(item.emisorRfc),
    receptorNombre: getNullableString(item.receptorNombre),
    receptorRfc: getNullableString(item.receptorRfc),
    subtotal: normalizeNullableNumber(item.subtotal),
    total: normalizeNullableNumber(item.total),
    moneda: getNullableString(item.moneda),
    packageId: getStringValue(item.packageId),
    packageDownloadedAtUtc: getNullableString(item.packageDownloadedAtUtc),
    windowId: getStringValue(item.windowId),
    windowLabel: getStringValue(item.windowLabel),
    reason,
    firstIgnoredAtUtc: getStringValue(item.firstIgnoredAtUtc),
    updatedAtUtc: getStringValue(item.updatedAtUtc),
  }

  return isStoredSatIgnoredCfdiItem(normalized) ? normalized : null
}

function isStoredSatIgnoredCfdiItem(value: unknown): value is StoredSatIgnoredCfdiItem {
  if (!value || typeof value !== 'object') {
    return false
  }

  const item = value as Record<string, unknown>
  return (
    typeof item.fileName === 'string' &&
    typeof item.sizeBytes === 'number' &&
    Number.isFinite(item.sizeBytes) &&
    (item.uuid === null || typeof item.uuid === 'string') &&
    (item.fecha === null || typeof item.fecha === 'string') &&
    (item.serie === null || typeof item.serie === 'string') &&
    (item.folio === null || typeof item.folio === 'string') &&
    (item.tipoComprobante === null || typeof item.tipoComprobante === 'string') &&
    (item.emisorNombre === null || typeof item.emisorNombre === 'string') &&
    (item.emisorRfc === null || typeof item.emisorRfc === 'string') &&
    (item.receptorNombre === null || typeof item.receptorNombre === 'string') &&
    (item.receptorRfc === null || typeof item.receptorRfc === 'string') &&
    (item.subtotal === null || (typeof item.subtotal === 'number' && Number.isFinite(item.subtotal))) &&
    (item.total === null || (typeof item.total === 'number' && Number.isFinite(item.total))) &&
    (item.moneda === null || typeof item.moneda === 'string') &&
    typeof item.packageId === 'string' &&
    (item.packageDownloadedAtUtc === null || typeof item.packageDownloadedAtUtc === 'string') &&
    typeof item.windowId === 'string' &&
    typeof item.windowLabel === 'string' &&
    (item.reason === 'unsupported_traslado' || item.reason === 'unsupported_pago') &&
    typeof item.firstIgnoredAtUtc === 'string' &&
    typeof item.updatedAtUtc === 'string'
  )
}

function cloneStoredCfdi(entry: StoredSatDownloadedCfdi): StoredSatDownloadedCfdi {
  return {
    fileName: entry.fileName,
    sizeBytes: entry.sizeBytes,
    uuid: entry.uuid,
    fecha: entry.fecha,
    serie: entry.serie,
    folio: entry.folio,
    tipoComprobante: entry.tipoComprobante,
    emisorNombre: entry.emisorNombre,
    emisorRfc: entry.emisorRfc,
    receptorNombre: entry.receptorNombre,
    receptorRfc: entry.receptorRfc,
    subtotal: entry.subtotal,
    total: entry.total,
    moneda: entry.moneda,
  }
}

function buildArchiveKey(packageId: string, item: Pick<StoredSatDownloadedCfdi, 'uuid' | 'fileName'>) {
  return [packageId, normalizeUuid(item.uuid) ?? '', item.fileName].join('|')
}

function compareIgnoredCfdis(left: StoredSatIgnoredCfdiItem, right: StoredSatIgnoredCfdiItem) {
  return (
    right.updatedAtUtc.localeCompare(left.updatedAtUtc) ||
    (left.fecha ?? '').localeCompare(right.fecha ?? '') ||
    (left.uuid ?? left.fileName).localeCompare(right.uuid ?? right.fileName)
  )
}

function countBy<T>(items: T[], getKey: (item: T) => string) {
  const counts = new Map<string, number>()
  for (const item of items) {
    const key = getKey(item)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([key, count]) => ({ key, count }))
}

function normalizeUuid(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().toUpperCase() : null
}

function getStringValue(value: unknown) {
  return typeof value === 'string' ? value : String(value ?? '')
}

function getNullableString(value: unknown) {
  const text = getStringValue(value).trim()
  return text.length > 0 ? text : null
}

function normalizeNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
