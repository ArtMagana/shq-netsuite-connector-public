import fs from 'node:fs'
import path from 'node:path'

export type StoredSatDownloadArtifact = {
  name: string
  sizeBytes: number
}

export type StoredSatDownloadedCfdi = {
  fileName: string
  sizeBytes: number
  uuid: string | null
  fecha: string | null
  serie: string | null
  folio: string | null
  tipoComprobante: string | null
  emisorNombre: string | null
  emisorRfc: string | null
  receptorNombre: string | null
  receptorRfc: string | null
  subtotal: number | null
  total: number | null
  moneda: string | null
}

export type StoredSatDownloadRecord = {
  packageId: string
  filename: string
  firstDownloadedAtUtc: string
  lastDownloadedAtUtc: string
  lastSeenAtUtc: string
  byteLength: number
  characterLength: number
  zipSignatureDetected: boolean
  status: {
    code: number
    message: string
    accepted: boolean
  }
  fileCount: number
  xmlCount: number
  metadataCount: number
  cfdis: StoredSatDownloadedCfdi[]
  metadataFiles: StoredSatDownloadArtifact[]
  otherFiles: StoredSatDownloadArtifact[]
  createdAtUtc: string
  updatedAtUtc: string
}

type StoredSatDownloadHistoryFile = {
  version: 1
  items: StoredSatDownloadRecord[]
}

export type UpsertSatDownloadRecordInput = Omit<
  StoredSatDownloadRecord,
  'firstDownloadedAtUtc' | 'lastDownloadedAtUtc' | 'lastSeenAtUtc' | 'createdAtUtc' | 'updatedAtUtc'
> & {
  downloadedAtUtc: string
}

const SAT_DOWNLOAD_HISTORY_STORE_PATH =
  process.env.SAT_DOWNLOAD_HISTORY_STORE_PATH?.trim() ||
  path.join(process.env.LOCALAPPDATA || process.cwd(), 'netsuite-recon', 'sat-download-history.json')

export function getSatDownloadHistoryStorePath() {
  return SAT_DOWNLOAD_HISTORY_STORE_PATH
}

export function loadSatDownloadHistory() {
  if (!fs.existsSync(SAT_DOWNLOAD_HISTORY_STORE_PATH)) {
    return [] as StoredSatDownloadRecord[]
  }

  try {
    const raw = fs.readFileSync(SAT_DOWNLOAD_HISTORY_STORE_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoredSatDownloadHistoryFile>
    if (!Array.isArray(parsed.items)) {
      return []
    }

    return parsed.items
      .map(normalizeStoredSatDownloadRecord)
      .filter((item): item is StoredSatDownloadRecord => item !== null)
      .sort(compareSatDownloadRecords)
  } catch {
    return []
  }
}

export function upsertSatDownloadRecord(input: UpsertSatDownloadRecordInput) {
  const currentItems = loadSatDownloadHistory()
  const nextItems = [...currentItems]
  const now = new Date().toISOString()
  const existingIndex = nextItems.findIndex((item) => item.packageId === input.packageId)
  const existing = existingIndex >= 0 ? nextItems[existingIndex] : null

  const nextItem: StoredSatDownloadRecord = {
    packageId: input.packageId,
    filename: input.filename,
    firstDownloadedAtUtc: earliestIsoString(existing?.firstDownloadedAtUtc, input.downloadedAtUtc),
    lastDownloadedAtUtc: latestIsoString(existing?.lastDownloadedAtUtc, input.downloadedAtUtc),
    lastSeenAtUtc: now,
    byteLength: input.byteLength,
    characterLength: input.characterLength,
    zipSignatureDetected: input.zipSignatureDetected,
    status: {
      code: input.status.code,
      message: input.status.message,
      accepted: input.status.accepted,
    },
    fileCount: input.fileCount,
    xmlCount: input.xmlCount,
    metadataCount: input.metadataCount,
    cfdis: input.cfdis.map(cloneStoredCfdi),
    metadataFiles: input.metadataFiles.map(cloneStoredArtifact),
    otherFiles: input.otherFiles.map(cloneStoredArtifact),
    createdAtUtc: existing?.createdAtUtc ?? now,
    updatedAtUtc: now,
  }

  if (existingIndex >= 0) {
    nextItems[existingIndex] = nextItem
  } else {
    nextItems.push(nextItem)
  }

  persistSatDownloadHistory(nextItems)
  return nextItem
}

function persistSatDownloadHistory(items: StoredSatDownloadRecord[]) {
  const directoryPath = path.dirname(SAT_DOWNLOAD_HISTORY_STORE_PATH)
  fs.mkdirSync(directoryPath, { recursive: true })

  const payload: StoredSatDownloadHistoryFile = {
    version: 1,
    items: [...items].sort(compareSatDownloadRecords),
  }

  fs.writeFileSync(SAT_DOWNLOAD_HISTORY_STORE_PATH, JSON.stringify(payload, null, 2), 'utf8')
}

function normalizeStoredSatDownloadRecord(value: unknown): StoredSatDownloadRecord | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const status = normalizeStatus(item.status)
  if (!status) {
    return null
  }

  const normalized: StoredSatDownloadRecord = {
    packageId: getStringValue(item.packageId),
    filename: getStringValue(item.filename),
    firstDownloadedAtUtc: getStringValue(item.firstDownloadedAtUtc),
    lastDownloadedAtUtc: getStringValue(item.lastDownloadedAtUtc),
    lastSeenAtUtc: getStringValue(item.lastSeenAtUtc),
    byteLength: normalizeNumber(item.byteLength),
    characterLength: normalizeNumber(item.characterLength),
    zipSignatureDetected: Boolean(item.zipSignatureDetected),
    status,
    fileCount: normalizeNumber(item.fileCount),
    xmlCount: normalizeNumber(item.xmlCount),
    metadataCount: normalizeNumber(item.metadataCount),
    cfdis: Array.isArray(item.cfdis)
      ? item.cfdis.map(normalizeStoredCfdi).filter((entry): entry is StoredSatDownloadedCfdi => entry !== null)
      : [],
    metadataFiles: Array.isArray(item.metadataFiles)
      ? item.metadataFiles
          .map(normalizeStoredArtifact)
          .filter((entry): entry is StoredSatDownloadArtifact => entry !== null)
      : [],
    otherFiles: Array.isArray(item.otherFiles)
      ? item.otherFiles
          .map(normalizeStoredArtifact)
          .filter((entry): entry is StoredSatDownloadArtifact => entry !== null)
      : [],
    createdAtUtc: getStringValue(item.createdAtUtc),
    updatedAtUtc: getStringValue(item.updatedAtUtc),
  }

  return isStoredSatDownloadRecord(normalized) ? normalized : null
}

function normalizeStatus(value: unknown) {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const code = normalizeNumber(item.code)
  const message = getStringValue(item.message)
  if (!Number.isFinite(code) || !message) {
    return null
  }

  return {
    code,
    message,
    accepted: Boolean(item.accepted),
  }
}

function normalizeStoredCfdi(value: unknown): StoredSatDownloadedCfdi | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const normalized: StoredSatDownloadedCfdi = {
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
  }

  return isStoredCfdi(normalized) ? normalized : null
}

function normalizeStoredArtifact(value: unknown): StoredSatDownloadArtifact | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const normalized: StoredSatDownloadArtifact = {
    name: getStringValue(item.name),
    sizeBytes: normalizeNumber(item.sizeBytes),
  }

  return isStoredArtifact(normalized) ? normalized : null
}

function isStoredSatDownloadRecord(value: unknown): value is StoredSatDownloadRecord {
  if (!value || typeof value !== 'object') {
    return false
  }

  const item = value as Record<string, unknown>
  return (
    typeof item.packageId === 'string' &&
    typeof item.filename === 'string' &&
    typeof item.firstDownloadedAtUtc === 'string' &&
    typeof item.lastDownloadedAtUtc === 'string' &&
    typeof item.lastSeenAtUtc === 'string' &&
    typeof item.byteLength === 'number' &&
    Number.isFinite(item.byteLength) &&
    typeof item.characterLength === 'number' &&
    Number.isFinite(item.characterLength) &&
    typeof item.zipSignatureDetected === 'boolean' &&
    isStatusRecord(item.status) &&
    typeof item.fileCount === 'number' &&
    Number.isFinite(item.fileCount) &&
    typeof item.xmlCount === 'number' &&
    Number.isFinite(item.xmlCount) &&
    typeof item.metadataCount === 'number' &&
    Number.isFinite(item.metadataCount) &&
    Array.isArray(item.cfdis) &&
    Array.isArray(item.metadataFiles) &&
    Array.isArray(item.otherFiles) &&
    typeof item.createdAtUtc === 'string' &&
    typeof item.updatedAtUtc === 'string'
  )
}

function isStoredCfdi(value: unknown): value is StoredSatDownloadedCfdi {
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
    (item.moneda === null || typeof item.moneda === 'string')
  )
}

function isStoredArtifact(value: unknown): value is StoredSatDownloadArtifact {
  if (!value || typeof value !== 'object') {
    return false
  }

  const item = value as Record<string, unknown>
  return typeof item.name === 'string' && typeof item.sizeBytes === 'number' && Number.isFinite(item.sizeBytes)
}

function isStatusRecord(value: unknown) {
  if (!value || typeof value !== 'object') {
    return false
  }

  const item = value as Record<string, unknown>
  return (
    typeof item.code === 'number' &&
    Number.isFinite(item.code) &&
    typeof item.message === 'string' &&
    typeof item.accepted === 'boolean'
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

function cloneStoredArtifact(entry: StoredSatDownloadArtifact): StoredSatDownloadArtifact {
  return {
    name: entry.name,
    sizeBytes: entry.sizeBytes,
  }
}

function compareSatDownloadRecords(left: StoredSatDownloadRecord, right: StoredSatDownloadRecord) {
  return (
    right.lastDownloadedAtUtc.localeCompare(left.lastDownloadedAtUtc) ||
    right.updatedAtUtc.localeCompare(left.updatedAtUtc) ||
    right.packageId.localeCompare(left.packageId)
  )
}

function earliestIsoString(left: string | null | undefined, right: string) {
  return left && left.localeCompare(right) < 0 ? left : right
}

function latestIsoString(left: string | null | undefined, right: string) {
  return left && left.localeCompare(right) > 0 ? left : right
}

function getStringValue(value: unknown) {
  return typeof value === 'string' ? value : String(value ?? '')
}

function getNullableString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function normalizeNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function normalizeNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
