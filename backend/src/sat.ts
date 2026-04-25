import fs from 'node:fs'
import path from 'node:path'
import { X509Certificate } from 'node:crypto'

import {
  CfdiFileFilter,
  DateTimePeriod,
  DocumentStatus,
  DocumentType,
  DownloadType,
  Fiel,
  FielRequestBuilder,
  FilteredPackageReader,
  HttpsWebClient,
  QueryParameters,
  RequestType,
  RfcMatch,
  Service,
  Uuid,
} from '@nodecfdi/sat-ws-descarga-masiva'
import { parseSatCfdiXmlSummary } from './satCfdiXml.js'
import {
  getSatDownloadHistoryStorePath,
  loadSatDownloadHistory,
  upsertSatDownloadRecord,
  type StoredSatDownloadArtifact,
  type StoredSatDownloadRecord,
  type StoredSatDownloadedCfdi,
} from './satDownloadHistoryStore.js'

type SatPasswordSource = 'file' | 'inline' | 'none'
type SatDownloadType = 'issued' | 'received'
type SatRequestType = 'xml' | 'metadata'
type SatDocumentStatus = 'undefined' | 'active' | 'cancelled'
type SatDocumentType = 'undefined' | 'ingreso' | 'egreso' | 'traslado' | 'nomina' | 'pago'

type SatCfdiRequestPayload = {
  startAt: string | null
  endAt: string | null
  downloadType: SatDownloadType
  requestType: SatRequestType
  documentType: SatDocumentType
  documentStatus: SatDocumentStatus
  uuid: string | null
  rfcMatch: string | null
}

type SatEnvironmentConfig = {
  certPath: string | null
  keyPath: string | null
  password: string | null
  passwordSource: SatPasswordSource
  passwordFilePath: string | null
  missing: string[]
}

type SatCertificateSnapshot = {
  rfc: string | null
  serialNumber: string | null
  issuerName: string | null
  subject: string | null
  issuer: string | null
  validFrom: string | null
  validTo: string | null
}

type SatPackageInspection = {
  fileCount: number
  xmlCount: number
  metadataCount: number
  samples: Array<{
    name: string
    sizeBytes: number
    uuid: string | null
  }>
}

type SatPackageInventoryFile = {
  name: string
  sizeBytes: number
  kind: 'xml' | 'metadata' | 'other'
  uuid: string | null
}

type SatPackageInventory = {
  files: SatPackageInventoryFile[]
  fileCount: number
  xmlCount: number
  metadataCount: number
  cfdis: StoredSatDownloadedCfdi[]
  metadataFiles: StoredSatDownloadArtifact[]
  otherFiles: StoredSatDownloadArtifact[]
}

type CachedSatPackage = {
  packageId: string
  filename: string
  buffer: Buffer
  encoding: 'binary' | 'base64'
  characterLength: number
  byteLength: number
  zipSignatureDetected: boolean
  downloadedAtUtc: string
  status: {
    code: number
    message: string
    accepted: boolean
  }
}

type StoredSatPackageManifest = {
  packageId: string
  filename: string
  encoding: 'binary' | 'base64'
  characterLength: number
  byteLength: number
  zipSignatureDetected: boolean
  downloadedAtUtc: string
  status: {
    code: number
    message: string
    accepted: boolean
  }
}

export type SatPackageXmlFile = {
  name: string
  content: string
  sizeBytes: number
  uuid: string | null
}

const SAT_PACKAGE_CACHE_TTL_MS = 60 * 60 * 1000
const satPackageCache = new Map<string, { storedAtMs: number; value: CachedSatPackage }>()
const SAT_PACKAGE_CACHE_DIR = resolveSatPackageCacheDir()

export class SatServiceError extends Error {
  readonly status: number

  constructor(message: string, status = 503) {
    super(message)
    this.name = 'SatServiceError'
    this.status = status
  }
}

export function getSatStatus() {
  const environment = readSatEnvironment()
  const certificate = readCertificateSnapshot(environment.certPath)
  let validationError: string | null = null
  let canTestAuth = environment.missing.length === 0

  if (canTestAuth) {
    try {
      const fiel = createFielFromEnvironment(environment)
      if (!fiel.isValid()) {
        validationError =
          'La e.firma configurada no es valida para el servicio de descarga masiva del SAT.'
        canTestAuth = false
      }
    } catch (error) {
      validationError = error instanceof Error ? error.message : 'Unable to validate SAT e.firma.'
      canTestAuth = false
    }
  }

  return {
    checkedAtUtc: new Date().toISOString(),
    configured: environment.missing.length === 0,
    canTestAuth,
    validationError,
    missing: environment.missing,
    endpoint: getSatAuthenticateEndpoint(),
    files: {
      certPath: environment.certPath,
      keyPath: environment.keyPath,
      passwordSource: environment.passwordSource,
      passwordFilePath: environment.passwordFilePath,
      packageCacheDir: SAT_PACKAGE_CACHE_DIR,
      downloadHistoryStorePath: getSatDownloadHistoryStorePath(),
    },
    certificate,
  }
}

export async function runSatAuthenticationTest() {
  const { fiel, service } = createSatRuntime()

  const startedAt = Date.now()
  const token = await service.authenticate()
  const latencyMs = Date.now() - startedAt

  if (!token.isValid()) {
    throw new SatServiceError('SAT returned an invalid authentication token.', 502)
  }

  return {
    success: true,
    testedAtUtc: new Date().toISOString(),
    latencyMs,
    endpoint: service.endpoints.getAuthenticate(),
    certificate: {
      rfc: fiel.getRfc(),
      serialNumber: fiel.getCertificateSerial(),
      issuerName: fiel.getCertificateIssuerName(),
    },
    token: {
      createdAtUtc: token.getCreated().formatSat(),
      expiresAtUtc: token.getExpires().formatSat(),
      isValid: token.isValid(),
    },
  }
}

export async function createSatCfdiRequest(payload: unknown) {
  const normalizedPayload = parseSatCfdiRequestPayload(payload)
  const { service } = createSatRuntime()
  const parameters = buildSatQueryParameters(normalizedPayload)
  const result = await service.query(parameters)

  return {
    success: result.getStatus().isAccepted(),
    requestedAtUtc: new Date().toISOString(),
    endpoint: service.endpoints.getQuery(),
    requestId: result.getRequestId(),
    status: serializeStatusCode(result.getStatus()),
    parameters: serializeQueryDetails(normalizedPayload),
  }
}

export async function verifySatCfdiRequest(requestId: string) {
  const normalizedRequestId = normalizeEntityId(requestId, 'requestId')
  const { service } = createSatRuntime()
  const result = await service.verify(normalizedRequestId)

  return {
    success: true,
    checkedAtUtc: new Date().toISOString(),
    endpoint: service.endpoints.getVerify(),
    requestId: normalizedRequestId,
    status: serializeStatusCode(result.getStatus()),
    statusRequest: {
      id: result.getStatusRequest().getEntryId(),
      value: result.getStatusRequest().getValue() ?? null,
      message: result.getStatusRequest().getEntryValueOnUndefined().message,
    },
    codeRequest: {
      id: result.getCodeRequest().getEntryId(),
      value: result.getCodeRequest().getValue() ?? null,
      message: result.getCodeRequest().getMessage(),
    },
    numberCfdis: result.getNumberCfdis(),
    readyToDownload: result.getPackageIds().length > 0,
    packages: result.getPackageIds().map((packageId) => ({
      packageId,
      inspectPath: `/api/sat/cfdi/package/${encodeURIComponent(packageId)}`,
      downloadPath: `/api/sat/cfdi/package/${encodeURIComponent(packageId)}/download`,
    })),
  }
}

export async function inspectSatCfdiPackage(packageId: string) {
  const normalizedPackageId = normalizeEntityId(packageId, 'packageId')
  const packageFile = await obtainSatPackage(normalizedPackageId)
  const inspection = packageFile.buffer.length ? await tryInspectSatPackage(packageFile.buffer) : null

  return {
    success: packageFile.status.accepted,
    downloadedAtUtc: packageFile.downloadedAtUtc,
    endpoint: getSatDownloadEndpoint(),
    packageId: normalizedPackageId,
    status: packageFile.status,
    package: {
      filename: packageFile.filename,
      encoding: packageFile.encoding,
      byteLength: packageFile.byteLength,
      characterLength: packageFile.characterLength,
      zipSignatureDetected: packageFile.zipSignatureDetected,
      inspection,
    },
  }
}

export async function downloadSatCfdiPackageFile(packageId: string) {
  const normalizedPackageId = normalizeEntityId(packageId, 'packageId')
  const packageFile = await obtainSatPackage(normalizedPackageId)

  return {
    filename: packageFile.filename,
    buffer: packageFile.buffer,
    status: packageFile.status,
  }
}

export async function getSatDownloadHistory(limit?: number) {
  await syncSatDownloadHistoryWithDiskCache()

  const items = loadSatDownloadHistory()
  const normalizedLimit =
    typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : null
  const records = normalizedLimit ? items.slice(0, normalizedLimit) : items

  return {
    generatedAtUtc: new Date().toISOString(),
    storePath: getSatDownloadHistoryStorePath(),
    packageCacheDir: SAT_PACKAGE_CACHE_DIR,
    totalPackages: items.length,
    totalCfdis: items.reduce((total, item) => total + item.cfdis.length, 0),
    records,
  }
}

export async function readSatCfdiPackageXmlFiles(packageId: string) {
  const normalizedPackageId = normalizeEntityId(packageId, 'packageId')
  const packageFile = await obtainSatPackage(normalizedPackageId)
  return readSatPackageXmlFilesFromBuffer(packageFile.buffer)
}

function readSatEnvironment(): SatEnvironmentConfig {
  const certPath = resolveConfiguredPath(process.env.SAT_EFIRMA_CERT_PATH)
  const keyPath = resolveConfiguredPath(process.env.SAT_EFIRMA_KEY_PATH)
  const passwordFilePath = resolveConfiguredPath(process.env.SAT_EFIRMA_KEY_PASSWORD_FILE)
  const passwordSource =
    passwordFilePath
      ? 'file'
      : normalizeOptionalString(process.env.SAT_EFIRMA_KEY_PASSWORD)
        ? 'inline'
        : 'none'

  const missing: string[] = []
  if (!certPath || !fs.existsSync(certPath)) {
    missing.push('SAT_EFIRMA_CERT_PATH')
  }
  if (!keyPath || !fs.existsSync(keyPath)) {
    missing.push('SAT_EFIRMA_KEY_PATH')
  }

  const password = readConfiguredPassword(passwordFilePath)
  if (!password) {
    if (passwordSource === 'file') {
      missing.push('SAT_EFIRMA_KEY_PASSWORD_FILE')
    } else {
      missing.push('SAT_EFIRMA_KEY_PASSWORD')
    }
  }

  return {
    certPath,
    keyPath,
    password,
    passwordSource,
    passwordFilePath,
    missing: [...new Set(missing)],
  }
}

function createSatRuntime() {
  const environment = readSatEnvironment()
  if (environment.missing.length > 0) {
    throw new SatServiceError(
      `SAT e.firma configuration is incomplete: ${environment.missing.join(', ')}`,
      503,
    )
  }

  const fiel = createFielFromEnvironment(environment)
  if (!fiel.isValid()) {
    throw new SatServiceError(
      'The configured SAT e.firma is not valid for mass CFDI download.',
      503,
    )
  }

  const service = new Service(new FielRequestBuilder(fiel), new HttpsWebClient())
  return {
    environment,
    fiel,
    service,
  }
}

function createFielFromEnvironment(environment: SatEnvironmentConfig) {
  if (!environment.certPath || !environment.keyPath || !environment.password) {
    throw new SatServiceError('SAT e.firma is not fully configured in the backend.', 503)
  }

  try {
    return Fiel.create(
      fs.readFileSync(environment.certPath, 'binary'),
      fs.readFileSync(environment.keyPath, 'binary'),
      environment.password,
    )
  } catch (error) {
    throw new SatServiceError(
      error instanceof Error
        ? `Unable to open the configured SAT e.firma: ${error.message}`
        : 'Unable to open the configured SAT e.firma.',
      503,
    )
  }
}

function parseSatCfdiRequestPayload(payload: unknown): SatCfdiRequestPayload {
  if (!isRecord(payload)) {
    throw new SatServiceError('SAT request payload must be a JSON object.', 400)
  }

  const uuid = normalizeOptionalString(readOptionalString(payload.uuid))?.toUpperCase() ?? null
  const period = normalizeSatRequestPeriod({
    startAt: normalizeOptionalString(readOptionalString(payload.startAt)),
    endAt: normalizeOptionalString(readOptionalString(payload.endAt)),
  })
  const startAt = period.startAt
  const endAt = period.endAt

  if (!uuid && (!startAt || !endAt)) {
    throw new SatServiceError('Provide either a UUID or both startAt and endAt for SAT queries.', 400)
  }

  return {
    startAt,
    endAt,
    downloadType: readEnumValue(payload.downloadType, ['issued', 'received'], 'downloadType'),
    requestType: readEnumValue(payload.requestType, ['xml', 'metadata'], 'requestType'),
    documentType: readEnumValue(
      payload.documentType ?? 'undefined',
      ['undefined', 'ingreso', 'egreso', 'traslado', 'nomina', 'pago'],
      'documentType',
    ),
    documentStatus: readEnumValue(
      payload.documentStatus ?? 'undefined',
      ['undefined', 'active', 'cancelled'],
      'documentStatus',
    ),
    uuid,
    rfcMatch: normalizeOptionalString(readOptionalString(payload.rfcMatch))?.toUpperCase() ?? null,
  }
}

function buildSatQueryParameters(payload: SatCfdiRequestPayload) {
  const normalizedDocumentStatus =
    !payload.uuid &&
    payload.downloadType === 'received' &&
    payload.requestType === 'xml' &&
    payload.documentStatus === 'undefined'
      ? 'active'
      : payload.documentStatus

  const period =
    payload.startAt && payload.endAt
      ? DateTimePeriod.createFromValues(payload.startAt, payload.endAt)
      : undefined

  const parameters = QueryParameters.create(
    period,
    new DownloadType(payload.downloadType),
    new RequestType(payload.requestType),
  )

  if (payload.documentType !== 'undefined') {
    parameters.withDocumentType(new DocumentType(payload.documentType))
  }

  if (normalizedDocumentStatus !== 'undefined') {
    parameters.withDocumentStatus(new DocumentStatus(normalizedDocumentStatus))
  }

  if (payload.uuid) {
    parameters.withUuid(Uuid.create(payload.uuid))
  }

  if (payload.rfcMatch) {
    parameters.withRfcMatch(RfcMatch.create(payload.rfcMatch))
  }

  const validationErrors = parameters.validate()
  if (validationErrors.length > 0) {
    throw new SatServiceError(validationErrors.join(' '), 400)
  }

  return parameters
}

function serializeQueryDetails(payload: SatCfdiRequestPayload) {
  const normalizedDocumentStatus =
    !payload.uuid &&
    payload.downloadType === 'received' &&
    payload.requestType === 'xml' &&
    payload.documentStatus === 'undefined'
      ? 'active'
      : payload.documentStatus

  return {
    period:
      payload.startAt && payload.endAt
        ? {
            startAtUtc: new Date(payload.startAt).toISOString(),
            endAtUtc: new Date(payload.endAt).toISOString(),
          }
        : null,
    downloadType: payload.downloadType,
    requestType: payload.requestType,
    documentType: payload.documentType,
    documentStatus: normalizedDocumentStatus,
    uuid: payload.uuid,
    rfcMatch: payload.rfcMatch,
  }
}

function normalizeSatPackage(packageContent: string) {
  const rawBinaryBuffer = Buffer.from(packageContent, 'binary')
  if (looksLikeZipBuffer(rawBinaryBuffer)) {
    return {
      buffer: rawBinaryBuffer,
      encoding: 'binary' as const,
      zipSignatureDetected: true,
    }
  }

  const trimmedContent = packageContent.trim()
  const decodedBase64Buffer =
    trimmedContent && /^[A-Za-z0-9+/=\r\n]+$/.test(trimmedContent)
      ? Buffer.from(trimmedContent, 'base64')
      : Buffer.alloc(0)

  if (looksLikeZipBuffer(decodedBase64Buffer)) {
    return {
      buffer: decodedBase64Buffer,
      encoding: 'base64' as const,
      zipSignatureDetected: true,
    }
  }

  return {
    buffer: rawBinaryBuffer,
    encoding: 'binary' as const,
    zipSignatureDetected: false,
  }
}

async function obtainSatPackage(packageId: string): Promise<CachedSatPackage> {
  const cachedPackage = readCachedSatPackage(packageId)
  if (cachedPackage) {
    return cachedPackage
  }

  const { service } = createSatRuntime()
  const result = await service.download(packageId)
  const serializedStatus = serializeStatusCode(result.getStatus())

  if (!serializedStatus.accepted) {
    throw new SatServiceError(
      `SAT rejected package download (${serializedStatus.code}): ${serializedStatus.message}`,
      502,
    )
  }

  const normalizedPackage = normalizeSatPackage(result.getPackageContent())
  if (!normalizedPackage.buffer.length) {
    throw new SatServiceError('SAT returned an empty package.', 502)
  }

  const packageFile: CachedSatPackage = {
    packageId,
    filename: `${packageId}.zip`,
    buffer: normalizedPackage.buffer,
    encoding: normalizedPackage.encoding,
    characterLength: result.getPackageSize(),
    byteLength: normalizedPackage.buffer.byteLength,
    zipSignatureDetected: normalizedPackage.zipSignatureDetected,
    downloadedAtUtc: new Date().toISOString(),
    status: serializedStatus,
  }

  await writeCachedSatPackage(packageFile)
  return packageFile
}

function readCachedSatPackage(packageId: string) {
  const now = Date.now()

  for (const [cachedPackageId, cachedPackage] of satPackageCache.entries()) {
    if (now - cachedPackage.storedAtMs > SAT_PACKAGE_CACHE_TTL_MS) {
      satPackageCache.delete(cachedPackageId)
    }
  }

  const memoryCachedPackage = satPackageCache.get(packageId)?.value ?? null
  if (memoryCachedPackage) {
    return memoryCachedPackage
  }

  const diskCachedPackage = readDiskCachedSatPackage(packageId)
  if (diskCachedPackage) {
    satPackageCache.set(diskCachedPackage.packageId, {
      storedAtMs: Date.now(),
      value: diskCachedPackage,
    })
  }

  return diskCachedPackage
}

async function writeCachedSatPackage(packageFile: CachedSatPackage) {
  satPackageCache.set(packageFile.packageId, {
    storedAtMs: Date.now(),
    value: packageFile,
  })

  writeDiskCachedSatPackage(packageFile)
  await persistSatDownloadHistoryFromPackage(packageFile)
}

function readDiskCachedSatPackage(packageId: string): CachedSatPackage | null {
  try {
    const manifestPath = getSatPackageManifestPath(packageId)
    const zipPath = getSatPackageZipPath(packageId)

    if (!fs.existsSync(manifestPath) || !fs.existsSync(zipPath)) {
      return null
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as StoredSatPackageManifest
    const buffer = fs.readFileSync(zipPath)

    return {
      packageId: manifest.packageId,
      filename: manifest.filename,
      buffer,
      encoding: manifest.encoding,
      characterLength: manifest.characterLength,
      byteLength: buffer.byteLength,
      zipSignatureDetected: manifest.zipSignatureDetected,
      downloadedAtUtc: manifest.downloadedAtUtc,
      status: manifest.status,
    }
  } catch {
    return null
  }
}

function writeDiskCachedSatPackage(packageFile: CachedSatPackage) {
  try {
    fs.mkdirSync(SAT_PACKAGE_CACHE_DIR, { recursive: true })
    const manifestPath = getSatPackageManifestPath(packageFile.packageId)
    const zipPath = getSatPackageZipPath(packageFile.packageId)
    const manifest: StoredSatPackageManifest = {
      packageId: packageFile.packageId,
      filename: packageFile.filename,
      encoding: packageFile.encoding,
      characterLength: packageFile.characterLength,
      byteLength: packageFile.byteLength,
      zipSignatureDetected: packageFile.zipSignatureDetected,
      downloadedAtUtc: packageFile.downloadedAtUtc,
      status: packageFile.status,
    }

    fs.writeFileSync(zipPath, packageFile.buffer)
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  } catch {
    // Si el cache en disco falla, seguimos con el cache en memoria para no romper el flujo SAT.
  }
}

function resolveSatPackageCacheDir() {
  const configuredPath = resolveConfiguredPath(process.env.SAT_PACKAGE_CACHE_DIR)
  if (configuredPath) {
    return configuredPath
  }

  return path.resolve(process.cwd(), '.sat-cache', 'packages')
}

function getSatPackageManifestPath(packageId: string) {
  return path.join(SAT_PACKAGE_CACHE_DIR, `${packageId}.json`)
}

function getSatPackageZipPath(packageId: string) {
  return path.join(SAT_PACKAGE_CACHE_DIR, `${packageId}.zip`)
}

function classifySatPackageFile(filename: string): SatPackageInventoryFile['kind'] {
  if (filename.endsWith('.xml')) {
    return 'xml'
  }

  if (filename.endsWith('.txt') || filename.endsWith('.csv')) {
    return 'metadata'
  }

  return 'other'
}

async function persistSatDownloadHistoryFromPackage(packageFile: CachedSatPackage) {
  const inventory = await readSatPackageInventoryFromBuffer(packageFile.buffer)
  upsertSatDownloadRecord({
    packageId: packageFile.packageId,
    filename: packageFile.filename,
    downloadedAtUtc: packageFile.downloadedAtUtc,
    byteLength: packageFile.byteLength,
    characterLength: packageFile.characterLength,
    zipSignatureDetected: packageFile.zipSignatureDetected,
    status: packageFile.status,
    fileCount: inventory.fileCount,
    xmlCount: inventory.xmlCount,
    metadataCount: inventory.metadataCount,
    cfdis: inventory.cfdis,
    metadataFiles: inventory.metadataFiles,
    otherFiles: inventory.otherFiles,
  })
}

async function syncSatDownloadHistoryWithDiskCache() {
  if (!fs.existsSync(SAT_PACKAGE_CACHE_DIR)) {
    return
  }

  const knownRecordsByPackageId = new Map(loadSatDownloadHistory().map((item) => [item.packageId, item] as const))
  const manifestFiles = fs
    .readdirSync(SAT_PACKAGE_CACHE_DIR)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .sort()

  for (const manifestFile of manifestFiles) {
    const packageId = manifestFile.slice(0, -5)
    const existingRecord = knownRecordsByPackageId.get(packageId)
    if (existingRecord && !shouldRefreshSatDownloadRecord(existingRecord)) {
      continue
    }

    const packageFile = readDiskCachedSatPackage(packageId)
    if (!packageFile) {
      continue
    }

    await persistSatDownloadHistoryFromPackage(packageFile)
    knownRecordsByPackageId.delete(packageId)
  }
}

function shouldRefreshSatDownloadRecord(record: StoredSatDownloadRecord) {
  return record.cfdis.some((cfdi) => !cfdi.tipoComprobante)
}

async function tryInspectSatPackage(buffer: Buffer) {
  try {
    return await inspectSatPackageBuffer(buffer)
  } catch (error) {
    return {
      fileCount: 0,
      xmlCount: 0,
      metadataCount: 0,
      samples: [],
      error: error instanceof Error ? error.message : 'Unable to inspect SAT package.',
    }
  }
}

async function inspectSatPackageBuffer(buffer: Buffer): Promise<SatPackageInspection> {
  const inventory = await readSatPackageInventoryFromBuffer(buffer)

  return {
    fileCount: inventory.fileCount,
    xmlCount: inventory.xmlCount,
    metadataCount: inventory.metadataCount,
    samples: inventory.files.slice(0, 10).map((file) => ({
      name: file.name,
      sizeBytes: file.sizeBytes,
      uuid: file.uuid,
    })),
  }
}

async function readSatPackageInventoryFromBuffer(buffer: Buffer): Promise<SatPackageInventory> {
  const packageReader = await FilteredPackageReader.createFromContents(buffer.toString('binary'))
  packageReader.setFilter()

  try {
    const files: SatPackageInventoryFile[] = []
    const cfdis: StoredSatDownloadedCfdi[] = []
    const metadataFiles: StoredSatDownloadArtifact[] = []
    const otherFiles: StoredSatDownloadArtifact[] = []

    for await (const contents of packageReader.fileContents()) {
      for (const [name, content] of contents) {
        const lowercaseName = name.toLowerCase()
        const sizeBytes = Buffer.byteLength(content, 'binary')
        const kind = classifySatPackageFile(lowercaseName)
        const uuid = kind === 'xml' ? extractUuidFromXml(lowercaseName, content) : null

        files.push({
          name,
          sizeBytes,
          kind,
          uuid,
        })

        if (kind === 'xml') {
          const summary = parseSatCfdiXmlSummary(content)
          cfdis.push({
            fileName: name,
            sizeBytes,
            uuid: summary?.uuid ?? uuid,
            fecha: summary?.fecha ?? null,
            serie: summary?.serie ?? null,
            folio: summary?.folio ?? null,
            tipoComprobante: summary?.tipoComprobante ?? null,
            emisorNombre: summary?.emisorNombre ?? null,
            emisorRfc: summary?.emisorRfc ?? null,
            receptorNombre: summary?.receptorNombre ?? null,
            receptorRfc: summary?.receptorRfc ?? null,
            subtotal: summary?.subtotal ?? null,
            total: summary?.total ?? null,
            moneda: summary?.moneda ?? null,
          })
          continue
        }

        if (kind === 'metadata') {
          metadataFiles.push({
            name,
            sizeBytes,
          })
          continue
        }

        otherFiles.push({
          name,
          sizeBytes,
        })
      }
    }

    return {
      files,
      fileCount: files.length,
      xmlCount: cfdis.length,
      metadataCount: metadataFiles.length,
      cfdis,
      metadataFiles,
      otherFiles,
    }
  } finally {
    await packageReader.destruct()
  }
}

async function readSatPackageXmlFilesFromBuffer(buffer: Buffer): Promise<SatPackageXmlFile[]> {
  const packageReader = await FilteredPackageReader.createFromContents(buffer.toString('binary'))
  packageReader.setFilter()

  try {
    const files: SatPackageXmlFile[] = []

    for await (const contents of packageReader.fileContents()) {
      for (const [name, content] of contents) {
        if (!name.toLowerCase().endsWith('.xml')) {
          continue
        }

        files.push({
          name,
          content,
          sizeBytes: Buffer.byteLength(content, 'binary'),
          uuid: extractUuidFromXml(name.toLowerCase(), content),
        })
      }
    }

    return files
  } finally {
    await packageReader.destruct()
  }
}

function extractUuidFromXml(filename: string, content: string) {
  if (!filename.endsWith('.xml')) {
    return null
  }

  try {
    return CfdiFileFilter.obtainUuidFromXmlCfdi(content)
  } catch {
    return null
  }
}

function looksLikeZipBuffer(buffer: Buffer) {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    ((buffer[2] === 0x03 && buffer[3] === 0x04) ||
      (buffer[2] === 0x05 && buffer[3] === 0x06) ||
      (buffer[2] === 0x07 && buffer[3] === 0x08))
  )
}

function serializeStatusCode(status: {
  getCode(): number
  getMessage(): string
  isAccepted(): boolean
}) {
  return {
    code: status.getCode(),
    message: status.getMessage(),
    accepted: status.isAccepted(),
  }
}

function normalizeEntityId(value: string, fieldName: string) {
  const normalized = normalizeOptionalString(value)
  if (!normalized) {
    throw new SatServiceError(`SAT ${fieldName} is required.`, 400)
  }

  return normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function readEnumValue<const T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  fieldName: string,
): T {
  const normalized = normalizeOptionalString(readOptionalString(value))
  if (!normalized || !allowedValues.includes(normalized as T)) {
    throw new SatServiceError(
      `Invalid SAT ${fieldName}. Allowed values: ${allowedValues.join(', ')}.`,
      400,
    )
  }

  return normalized as T
}

function readConfiguredPassword(passwordFilePath: string | null) {
  if (passwordFilePath) {
    if (!fs.existsSync(passwordFilePath)) {
      return null
    }

    const value = fs.readFileSync(passwordFilePath, 'utf8').trim()
    return value ? value : null
  }

  return normalizeOptionalString(process.env.SAT_EFIRMA_KEY_PASSWORD)
}

function readCertificateSnapshot(certPath: string | null): SatCertificateSnapshot | null {
  if (!certPath || !fs.existsSync(certPath)) {
    return null
  }

  try {
    const certificate = new X509Certificate(fs.readFileSync(certPath))
    return {
      rfc: extractRfcFromSubject(certificate.subject),
      serialNumber: certificate.serialNumber || null,
      issuerName: certificate.issuer || null,
      subject: certificate.subject || null,
      issuer: certificate.issuer || null,
      validFrom: normalizeDateString(certificate.validFrom),
      validTo: normalizeDateString(certificate.validTo),
    }
  } catch {
    return null
  }
}

function extractRfcFromSubject(subject: string) {
  const match = subject.match(/x500UniqueIdentifier=([^/\r\n]+)\/?/i)
  return match?.[1]?.trim() ?? null
}

function normalizeDateString(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function resolveConfiguredPath(rawValue: string | undefined) {
  const normalized = normalizeOptionalString(rawValue)
  if (!normalized) {
    return null
  }

  return path.isAbsolute(normalized) ? normalized : path.resolve(process.cwd(), normalized)
}

function normalizeOptionalString(value: string | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function normalizeSatRequestPeriod(period: Pick<SatCfdiRequestPayload, 'startAt' | 'endAt'>) {
  if (!period.startAt || !period.endAt) {
    return period
  }

  const startAt = normalizeSatRequestPeriodDate(period.startAt, 'startAt')
  let endAt = normalizeSatRequestPeriodDate(period.endAt, 'endAt')
  const now = new Date()

  if (new Date(endAt).getTime() > now.getTime()) {
    endAt = now.toISOString()
  }

  if (new Date(startAt).getTime() > new Date(endAt).getTime()) {
    throw new SatServiceError('SAT startAt must be before or equal to endAt.', 400)
  }

  return {
    startAt,
    endAt,
  }
}

function normalizeSatRequestPeriodDate(value: string, fieldName: 'startAt' | 'endAt') {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new SatServiceError(`SAT ${fieldName} is not a valid date.`, 400)
  }

  return parsed.toISOString()
}

function getSatAuthenticateEndpoint() {
  return 'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/Autenticacion/Autenticacion.svc'
}

function getSatDownloadEndpoint() {
  return 'https://cfdidescargamasiva.clouda.sat.gob.mx/DescargaMasivaService.svc'
}
