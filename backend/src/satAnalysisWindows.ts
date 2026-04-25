import fs from 'node:fs'
import path from 'node:path'

import { NetSuiteClient } from './netsuiteClient.js'
import {
  createSatCfdiRequest,
  getSatDownloadHistory,
  inspectSatCfdiPackage,
  SatServiceError,
  verifySatCfdiRequest,
} from './sat.js'
import { loadSatDownloadHistory, type StoredSatDownloadedCfdi } from './satDownloadHistoryStore.js'
import { archiveSatIgnoredCfdis, type SatIgnoredCfdiReason } from './satIgnoredCfdiStore.js'

type SatAnalysisWindowStatus = 'pending_sat' | 'ready'
type SatProcessedReason = 'already_in_netsuite' | 'uploaded_to_netsuite'
type SatAnalysisDocumentType = 'undefined' | 'ingreso' | 'egreso' | 'traslado' | 'nomina' | 'pago'

export type SatAnalysisNetSuiteMatch = {
  internalId: string
  transactionNumber: string | null
  tranId: string | null
  vendorName: string | null
  transactionDate: string | null
  total: number | null
  currencyName: string | null
  matchType: 'uuid-field' | 'tranid' | 'externalid'
}

export type StoredSatAnalysisItem = {
  packageId: string
  fileName: string
  uuid: string | null
  fecha: string | null
  serie: string | null
  folio: string | null
  emisorNombre: string | null
  emisorRfc: string | null
  receptorNombre: string | null
  receptorRfc: string | null
  subtotal: number | null
  total: number | null
  moneda: string | null
  packageDownloadedAtUtc: string | null
  netsuiteMatches: SatAnalysisNetSuiteMatch[]
  createdAtUtc: string
  updatedAtUtc: string
}

export type StoredSatProcessedItem = StoredSatAnalysisItem & {
  processedReason: SatProcessedReason
  processedAtUtc: string
}

export type StoredSatAnalysisWindow = {
  id: string
  label: string
  status: SatAnalysisWindowStatus
  requestId: string | null
  pendingRequestId: string | null
  subset: {
    startAtUtc: string
    endAtUtc: string
    downloadType: 'received'
    requestType: 'xml'
    documentType: SatAnalysisDocumentType
    documentStatus: 'active'
  }
  packageIds: string[]
  analysisItems: StoredSatAnalysisItem[]
  processedItems: StoredSatProcessedItem[]
  createdAtUtc: string
  updatedAtUtc: string
  lastSatSyncAtUtc: string | null
  lastNetSuiteSyncAtUtc: string | null
}

export type SatAnalysisWorkflowSuggestedExtraction = {
  startAtUtc: string
  endAtUtc: string
  startDate: string
  endDate: string
  basis: 'latest_window_overlap' | 'current_month_fallback'
  overlapDays: number
  sourceWindowId: string | null
  sourceWindowEndAtUtc: string | null
}

export type SatAnalysisWorkflowSummary = {
  overlapDays: number
  latestWindow: {
    id: string
    label: string
    status: SatAnalysisWindowStatus
    startAtUtc: string
    endAtUtc: string
    updatedAtUtc: string
    lastSatSyncAtUtc: string | null
    lastNetSuiteSyncAtUtc: string | null
  } | null
  suggestedExtraction: SatAnalysisWorkflowSuggestedExtraction
}

type StoredSatAnalysisWindowsFile = {
  version: 1
  windows: StoredSatAnalysisWindow[]
}

type SatHistoryCfdiCandidate = StoredSatDownloadedCfdi & {
  packageId: string
  packageDownloadedAtUtc: string | null
}

type NetSuiteExactMatch = SatAnalysisNetSuiteMatch

const SAT_ANALYSIS_WINDOWS_STORE_PATH =
  process.env.SAT_ANALYSIS_WINDOWS_STORE_PATH?.trim() ||
  path.join(process.env.LOCALAPPDATA || process.cwd(), 'netsuite-recon', 'sat-analysis-windows.json')
const SAT_ANALYSIS_EXTRACTION_OVERLAP_DAYS = 2

export function loadSatAnalysisWindows() {
  if (!fs.existsSync(SAT_ANALYSIS_WINDOWS_STORE_PATH)) {
    return [] as StoredSatAnalysisWindow[]
  }

  try {
    const raw = fs.readFileSync(SAT_ANALYSIS_WINDOWS_STORE_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoredSatAnalysisWindowsFile>
    if (!Array.isArray(parsed.windows)) {
      return []
    }

    return parsed.windows
      .map(normalizeStoredSatAnalysisWindow)
      .filter((window): window is StoredSatAnalysisWindow => window !== null)
      .sort(compareSatAnalysisWindows)
  } catch {
    return []
  }
}

export async function bootstrapSatReceivedInvoicesAnalysisWindow(params: {
  startAtUtc: string
  endAtUtc: string
  documentType?: string | null
}) {
  const startAtUtc = normalizeIsoDateTime(params.startAtUtc, 'startAtUtc')
  const endAtUtc = normalizeSatAnalysisEndAtUtc(normalizeIsoDateTime(params.endAtUtc, 'endAtUtc'))
  if (new Date(startAtUtc).getTime() > new Date(endAtUtc).getTime()) {
    throw new SatServiceError('La fecha inicial del subset SAT no puede ser mayor a la final.', 400)
  }
  const documentType = normalizeSatAnalysisDocumentType(params.documentType)
  const windowId = buildSatAnalysisWindowId(startAtUtc, endAtUtc, documentType)
  const label = buildSatAnalysisWindowLabel(startAtUtc, endAtUtc, documentType)
  const now = new Date().toISOString()
  const existing = loadSatAnalysisWindows().find((window) => window.id === windowId)

  const requestResult = await createSatCfdiRequest({
    startAt: startAtUtc,
    endAt: endAtUtc,
    downloadType: 'received',
    requestType: 'xml',
    documentType,
    documentStatus: 'active',
  })

  if (!requestResult.success || !requestResult.requestId) {
    throw new SatServiceError(requestResult.status.message || 'El SAT rechazo la solicitud de descarga.', 400)
  }

  const verifyResult = await waitForSatPackages(requestResult.requestId)
  const packageIds = verifyResult?.packages.map((item) => item.packageId) ?? []

  const nextWindow = packageIds.length
    ? await classifyDownloadedSatAnalysisWindow({
        id: windowId,
        label,
        requestId: requestResult.requestId,
        startAtUtc,
        endAtUtc,
        documentType,
        packageIds,
        createdAtUtc: existing?.createdAtUtc,
        uploadedToNetSuiteByUuid: buildUploadedToNetSuiteMap(existing?.processedItems ?? []),
      })
    : existing
      ? buildPendingSatAnalysisRefreshWindow({
          existing,
          label,
          startAtUtc,
          endAtUtc,
          documentType,
          pendingRequestId: requestResult.requestId,
          updatedAtUtc: now,
        })
      : buildPendingSatAnalysisWindow({
          id: windowId,
          label,
          requestId: requestResult.requestId,
          startAtUtc,
          endAtUtc,
          documentType,
          createdAtUtc: now,
        })

  saveSatAnalysisWindow(nextWindow)
  return nextWindow
}

export async function reconcileSatAnalysisWindow(windowId: string) {
  const existing = loadSatAnalysisWindows().find((window) => window.id === windowId)
  if (!existing) {
    throw new SatServiceError(`No existe la ventana SAT ${windowId}.`, 404)
  }

  let resolvedPackageIds: string[] = []
  let resolvedRequestId = existing.requestId

  if (existing.pendingRequestId) {
    resolvedPackageIds = (await verifySatCfdiRequest(existing.pendingRequestId)).packages.map((item) => item.packageId)
    if (resolvedPackageIds.length > 0) {
      resolvedRequestId = existing.pendingRequestId
    } else if (
      existing.packageIds.length > 0 ||
      existing.analysisItems.length > 0 ||
      existing.processedItems.length > 0
    ) {
      const pendingWindow: StoredSatAnalysisWindow = {
        ...existing,
        status: 'pending_sat',
        updatedAtUtc: new Date().toISOString(),
        lastNetSuiteSyncAtUtc: new Date().toISOString(),
      }
      saveSatAnalysisWindow(pendingWindow)
      return pendingWindow
    }
  }

  if (resolvedPackageIds.length === 0) {
    resolvedPackageIds =
      existing.packageIds.length > 0
        ? existing.packageIds
        : existing.requestId
          ? (await verifySatCfdiRequest(existing.requestId)).packages.map((item) => item.packageId)
          : []
  }

  if (resolvedPackageIds.length === 0) {
    const pendingWindow: StoredSatAnalysisWindow = {
      ...existing,
      status: 'pending_sat',
      updatedAtUtc: new Date().toISOString(),
      lastNetSuiteSyncAtUtc: new Date().toISOString(),
    }
    saveSatAnalysisWindow(pendingWindow)
    return pendingWindow
  }

  const nextWindow = await classifyDownloadedSatAnalysisWindow({
    id: existing.id,
    label: existing.label,
    requestId: resolvedRequestId,
    startAtUtc: existing.subset.startAtUtc,
    endAtUtc: existing.subset.endAtUtc,
    documentType: existing.subset.documentType,
    packageIds: resolvedPackageIds,
    createdAtUtc: existing.createdAtUtc,
    uploadedToNetSuiteByUuid: buildUploadedToNetSuiteMap(existing.processedItems),
  })

  saveSatAnalysisWindow(nextWindow)
  return nextWindow
}

async function classifyDownloadedSatAnalysisWindow(params: {
  id: string
  label: string
  requestId: string | null
  startAtUtc: string
  endAtUtc: string
  documentType: SatAnalysisDocumentType
  packageIds: string[]
  createdAtUtc?: string
  uploadedToNetSuiteByUuid?: Map<string, string>
}) {
  for (const packageId of params.packageIds) {
    await inspectSatCfdiPackage(packageId)
  }
  await getSatDownloadHistory()

  return classifySatAnalysisWindow(params)
}

export function getSatAnalysisWindowsSummary() {
  const windows = loadSatAnalysisWindows()
  return {
    generatedAtUtc: new Date().toISOString(),
    storePath: SAT_ANALYSIS_WINDOWS_STORE_PATH,
    windows,
    workflow: buildSatAnalysisWorkflowSummary(windows),
  }
}

export function markSatAnalysisWindowInvoiceUploaded(params: {
  windowId: string
  uuid: string
  netsuiteMatch: SatAnalysisNetSuiteMatch
  processedAtUtc?: string
}) {
  return markSatAnalysisWindowInvoiceProcessed({
    windowId: params.windowId,
    uuid: params.uuid,
    netsuiteMatches: [params.netsuiteMatch],
    processedReason: 'uploaded_to_netsuite',
    processedAtUtc: params.processedAtUtc,
  })
}

export function markSatAnalysisWindowInvoiceAlreadyInNetSuite(params: {
  windowId: string
  uuid: string
  netsuiteMatches: SatAnalysisNetSuiteMatch[]
  processedAtUtc?: string
}) {
  return markSatAnalysisWindowInvoiceProcessed({
    windowId: params.windowId,
    uuid: params.uuid,
    netsuiteMatches: params.netsuiteMatches,
    processedReason: 'already_in_netsuite',
    processedAtUtc: params.processedAtUtc,
  })
}

function markSatAnalysisWindowInvoiceProcessed(params: {
  windowId: string
  uuid: string
  netsuiteMatches: SatAnalysisNetSuiteMatch[]
  processedReason: SatProcessedReason
  processedAtUtc?: string
}) {
  const existing = loadSatAnalysisWindows().find((window) => window.id === params.windowId)
  if (!existing) {
    throw new SatServiceError(`No existe la ventana SAT ${params.windowId}.`, 404)
  }

  const normalizedUuid = normalizeUuid(params.uuid)
  if (!normalizedUuid) {
    throw new SatServiceError('El UUID indicado no es valido para marcar la factura como subida.', 400)
  }

  const processedAtUtc = normalizeIsoDateTime(params.processedAtUtc ?? new Date().toISOString(), 'processedAtUtc')
  const analysisItems = [...existing.analysisItems]
  const processedItems = existing.processedItems.filter((item) => normalizeUuid(item.uuid) !== normalizedUuid)
  const analysisIndex = analysisItems.findIndex((item) => normalizeUuid(item.uuid) === normalizedUuid)

  const sourceItem =
    analysisIndex >= 0
      ? analysisItems.splice(analysisIndex, 1)[0]
      : existing.processedItems.find((item) => normalizeUuid(item.uuid) === normalizedUuid) ?? null

  if (!sourceItem) {
    throw new SatServiceError(
      `La factura ${params.uuid} no existe en la ventana SAT ${params.windowId}.`,
      404,
    )
  }

  processedItems.push({
    ...sourceItem,
    netsuiteMatches: dedupeNetSuiteMatches([...params.netsuiteMatches, ...sourceItem.netsuiteMatches]),
    updatedAtUtc: processedAtUtc,
    processedReason: params.processedReason,
    processedAtUtc,
  })

  const nextWindow: StoredSatAnalysisWindow = {
    ...existing,
    analysisItems: sortAnalysisItems(analysisItems),
    processedItems: sortProcessedItems(processedItems),
    updatedAtUtc: processedAtUtc,
    lastNetSuiteSyncAtUtc: processedAtUtc,
  }

  saveSatAnalysisWindow(nextWindow)
  return nextWindow
}

async function classifySatAnalysisWindow(params: {
  id: string
  label: string
  requestId: string | null
  startAtUtc: string
  endAtUtc: string
  documentType: SatAnalysisDocumentType
  packageIds: string[]
  createdAtUtc?: string
  uploadedToNetSuiteByUuid?: Map<string, string>
}) {
  const now = new Date().toISOString()
  const sourceItems = loadSatAnalysisCandidatesByPackageIds(params.packageIds)
  const ignoredItems = sourceItems
    .map((item) => ({
      item,
      reason: resolveIgnoredCfdiReason(item.tipoComprobante),
    }))
    .filter((entry): entry is { item: SatHistoryCfdiCandidate; reason: SatIgnoredCfdiReason } => Boolean(entry.reason))
  const operationalItems = sourceItems.filter((item) => !resolveIgnoredCfdiReason(item.tipoComprobante))

  archiveSatIgnoredCfdis(
    ignoredItems.map(({ item, reason }) => ({
      cfdi: item,
      packageId: item.packageId,
      packageDownloadedAtUtc: item.packageDownloadedAtUtc,
      windowId: params.id,
      windowLabel: params.label,
      reason,
      ignoredAtUtc: now,
    })),
  )

  const matchesByUuid = await findNetSuiteExactMatchesByUuid(
    operationalItems.map((item) => item.uuid).filter((uuid): uuid is string => Boolean(uuid)),
  )
  const uploadedToNetSuiteByUuid = params.uploadedToNetSuiteByUuid ?? new Map<string, string>()
  const analysisItems: StoredSatAnalysisItem[] = []
  const processedItems: StoredSatProcessedItem[] = []

  for (const item of operationalItems) {
    const normalizedUuid = normalizeUuid(item.uuid)
    const netsuiteMatches = normalizedUuid ? matchesByUuid.get(normalizedUuid) ?? [] : []
    const baseItem = buildAnalysisItem(item, netsuiteMatches, now)
    const uploadedProcessedAtUtc = normalizedUuid ? uploadedToNetSuiteByUuid.get(normalizedUuid) ?? null : null

    if (uploadedProcessedAtUtc) {
      processedItems.push({
        ...baseItem,
        processedReason: 'uploaded_to_netsuite',
        processedAtUtc: uploadedProcessedAtUtc,
      })
      continue
    }

    if (netsuiteMatches.length > 0) {
      processedItems.push({
        ...baseItem,
        processedReason: 'already_in_netsuite',
        processedAtUtc: now,
      })
      continue
    }

    analysisItems.push(baseItem)
  }

  return {
    id: params.id,
    label: params.label,
    status: 'ready' as const,
    requestId: params.requestId,
    pendingRequestId: null,
    subset: {
      startAtUtc: params.startAtUtc,
      endAtUtc: params.endAtUtc,
      downloadType: 'received' as const,
      requestType: 'xml' as const,
      documentType: params.documentType,
      documentStatus: 'active' as const,
    },
    packageIds: [...new Set(params.packageIds)].sort(),
    analysisItems: sortAnalysisItems(analysisItems),
    processedItems: sortProcessedItems(processedItems),
    createdAtUtc: params.createdAtUtc ?? now,
    updatedAtUtc: now,
    lastSatSyncAtUtc: now,
    lastNetSuiteSyncAtUtc: now,
  }
}

function buildPendingSatAnalysisWindow(params: {
  id: string
  label: string
  requestId: string
  startAtUtc: string
  endAtUtc: string
  documentType: SatAnalysisDocumentType
  createdAtUtc: string
}): StoredSatAnalysisWindow {
  return {
    id: params.id,
    label: params.label,
    status: 'pending_sat',
    requestId: params.requestId,
    pendingRequestId: null,
    subset: {
      startAtUtc: params.startAtUtc,
      endAtUtc: params.endAtUtc,
      downloadType: 'received',
      requestType: 'xml',
      documentType: params.documentType,
      documentStatus: 'active',
    },
    packageIds: [],
    analysisItems: [],
    processedItems: [],
    createdAtUtc: params.createdAtUtc,
    updatedAtUtc: params.createdAtUtc,
    lastSatSyncAtUtc: null,
    lastNetSuiteSyncAtUtc: null,
  }
}

function buildPendingSatAnalysisRefreshWindow(params: {
  existing: StoredSatAnalysisWindow
  label: string
  startAtUtc: string
  endAtUtc: string
  documentType: SatAnalysisDocumentType
  pendingRequestId: string
  updatedAtUtc: string
}): StoredSatAnalysisWindow {
  return {
    ...params.existing,
    label: params.label,
    status: 'pending_sat',
    pendingRequestId: params.pendingRequestId,
    subset: {
      ...params.existing.subset,
      startAtUtc: params.startAtUtc,
      endAtUtc: params.endAtUtc,
      documentType: params.documentType,
    },
    updatedAtUtc: params.updatedAtUtc,
    lastSatSyncAtUtc: params.updatedAtUtc,
  }
}

function loadSatAnalysisCandidatesByPackageIds(packageIds: string[]) {
  const historyByPackageId = new Map(
    loadSatDownloadHistory().map((record) => [record.packageId, record] as const),
  )
  const candidates: SatHistoryCfdiCandidate[] = []
  const seenKeys = new Set<string>()

  for (const packageId of [...new Set(packageIds)]) {
    const record = historyByPackageId.get(packageId)
    if (!record) {
      continue
    }

    for (const cfdi of record.cfdis) {
      const candidateKey = buildSatHistoryCandidateKey(packageId, cfdi)
      if (seenKeys.has(candidateKey)) {
        continue
      }

      seenKeys.add(candidateKey)
      candidates.push({
        ...cfdi,
        packageId,
        packageDownloadedAtUtc: record.lastDownloadedAtUtc,
      })
    }
  }

  return candidates
}

async function waitForSatPackages(requestId: string) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const verification = await verifySatCfdiRequest(requestId)
    if (verification.readyToDownload || verification.numberCfdis === 0) {
      return verification
    }

    if (attempt < 7) {
      await new Promise((resolve) => {
        setTimeout(resolve, 4000)
      })
    }
  }

  return null
}

async function findNetSuiteExactMatchesByUuid(uuids: string[]) {
  const normalizedUuids = uniqueStrings(uuids.map((uuid) => normalizeUuid(uuid)).filter((uuid): uuid is string => Boolean(uuid)))
  const matchesByUuid = new Map<string, NetSuiteExactMatch[]>()

  if (normalizedUuids.length === 0) {
    return matchesByUuid
  }

  const client = NetSuiteClient.fromEnv()

  for (const chunk of chunkArray(normalizedUuids, 20)) {
    const inClause = chunk.map(toSuiteQlString).join(', ')
    const query = `
SELECT
  transaction.id,
  transaction.tranid,
  transaction.transactionnumber,
  transaction.trandate,
  transaction.foreigntotal,
  BUILTIN.DF(transaction.entity) AS vendorName,
  BUILTIN.DF(transaction.currency) AS currencyName,
  transaction.externalid,
  transaction.custbody_mx_cfdi_uuid AS mxCfdiUuid,
  transaction.custbody_mx_inbound_bill_uuid AS inboundUuid
FROM transaction
WHERE transaction.type IN ('VendBill', 'VendCred')
  AND (
    UPPER(NVL(transaction.custbody_mx_cfdi_uuid, '')) IN (${inClause})
    OR UPPER(NVL(transaction.custbody_mx_inbound_bill_uuid, '')) IN (${inClause})
    OR UPPER(NVL(transaction.tranid, '')) IN (${inClause})
    OR UPPER(NVL(transaction.externalid, '')) IN (${inClause})
  )
    `.trim()

    const response = await client.suiteql(query, 200, 0)
    const items = readSuiteQlItems(response.json)

    for (const item of items) {
      const matchedUuids = inferMatchedUuidsFromSuiteQlRow(item)
      if (matchedUuids.length === 0) {
        continue
      }

      const normalizedMatch = normalizeNetSuiteMatch(item)
      for (const uuid of matchedUuids) {
        const existing = matchesByUuid.get(uuid) ?? []
        existing.push(normalizedMatch)
        matchesByUuid.set(uuid, existing)
      }
    }
  }

  for (const [uuid, matches] of matchesByUuid.entries()) {
    matchesByUuid.set(uuid, dedupeNetSuiteMatches(matches))
  }

  return matchesByUuid
}

function normalizeNetSuiteMatch(item: Record<string, unknown>): NetSuiteExactMatch {
  const mxCfdiUuid = asOptionalString(item.mxcfdiuuid)
  const inboundUuid = asOptionalString(item.inbounduuid)
  const tranId = asOptionalString(item.tranid)

  return {
    internalId: asOptionalString(item.id) ?? '',
    transactionNumber: asOptionalString(item.transactionnumber),
    tranId,
    vendorName: asOptionalString(item.vendorname),
    transactionDate: asOptionalString(item.trandate),
    total: parseNumber(asOptionalString(item.foreigntotal)),
    currencyName: asOptionalString(item.currencyname),
    matchType: mxCfdiUuid || inboundUuid ? 'uuid-field' : tranId ? 'tranid' : 'externalid',
  }
}

function inferMatchedUuidsFromSuiteQlRow(item: Record<string, unknown>) {
  const rawCandidates = [
    asOptionalString(item.mxcfdiuuid),
    asOptionalString(item.inbounduuid),
    asOptionalString(item.tranid),
    asOptionalString(item.externalid),
  ]

  return uniqueStrings(rawCandidates.map((value) => normalizeUuid(value)).filter((value): value is string => Boolean(value)))
}

function dedupeNetSuiteMatches(matches: NetSuiteExactMatch[]) {
  const seen = new Set<string>()
  const unique: NetSuiteExactMatch[] = []

  for (const match of matches) {
    const key = [match.internalId, match.transactionNumber ?? '', match.tranId ?? '', match.matchType].join('|')
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    unique.push(match)
  }

  return unique
}

function buildAnalysisItem(
  item: SatHistoryCfdiCandidate,
  netsuiteMatches: SatAnalysisNetSuiteMatch[],
  now: string,
): StoredSatAnalysisItem {
  return {
    packageId: item.packageId,
    fileName: item.fileName,
    uuid: item.uuid,
    fecha: item.fecha,
    serie: item.serie,
    folio: item.folio,
    emisorNombre: item.emisorNombre,
    emisorRfc: item.emisorRfc,
    receptorNombre: item.receptorNombre,
    receptorRfc: item.receptorRfc,
    subtotal: item.subtotal,
    total: item.total,
    moneda: item.moneda,
    packageDownloadedAtUtc: item.packageDownloadedAtUtc,
    netsuiteMatches,
    createdAtUtc: now,
    updatedAtUtc: now,
  }
}

function saveSatAnalysisWindow(window: StoredSatAnalysisWindow) {
  const currentWindows = loadSatAnalysisWindows()
  const nextWindows = [...currentWindows]
  const existingIndex = nextWindows.findIndex((item) => item.id === window.id)

  if (existingIndex >= 0) {
    nextWindows[existingIndex] = window
  } else {
    nextWindows.push(window)
  }

  const directoryPath = path.dirname(SAT_ANALYSIS_WINDOWS_STORE_PATH)
  fs.mkdirSync(directoryPath, { recursive: true })

  const payload: StoredSatAnalysisWindowsFile = {
    version: 1,
    windows: nextWindows.sort(compareSatAnalysisWindows),
  }

  fs.writeFileSync(SAT_ANALYSIS_WINDOWS_STORE_PATH, JSON.stringify(payload, null, 2), 'utf8')
}

function normalizeStoredSatAnalysisWindow(value: unknown): StoredSatAnalysisWindow | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const subset = item.subset as Record<string, unknown> | undefined
  if (!subset) {
    return null
  }

  const status = item.status === 'pending_sat' ? 'pending_sat' : item.status === 'ready' ? 'ready' : null
  if (!status) {
    return null
  }

  const normalized: StoredSatAnalysisWindow = {
    id: getStringValue(item.id),
    label: getStringValue(item.label),
    status,
    requestId: getNullableString(item.requestId),
    pendingRequestId: getNullableString(item.pendingRequestId),
    subset: {
      startAtUtc: getStringValue(subset.startAtUtc),
      endAtUtc: getStringValue(subset.endAtUtc),
      downloadType: 'received',
      requestType: 'xml',
      documentType: normalizeSatAnalysisDocumentType(getNullableString(subset.documentType)),
      documentStatus: 'active',
    },
    packageIds: Array.isArray(item.packageIds)
      ? item.packageIds.map((entry) => getStringValue(entry)).filter((entry) => entry.length > 0)
      : [],
    analysisItems: Array.isArray(item.analysisItems)
      ? item.analysisItems
          .map(normalizeStoredAnalysisItem)
          .filter((entry): entry is StoredSatAnalysisItem => entry !== null)
      : [],
    processedItems: Array.isArray(item.processedItems)
      ? item.processedItems
          .map(normalizeStoredProcessedItem)
          .filter((entry): entry is StoredSatProcessedItem => entry !== null)
      : [],
    createdAtUtc: getStringValue(item.createdAtUtc),
    updatedAtUtc: getStringValue(item.updatedAtUtc),
    lastSatSyncAtUtc: getNullableString(item.lastSatSyncAtUtc),
    lastNetSuiteSyncAtUtc: getNullableString(item.lastNetSuiteSyncAtUtc),
  }

  return isStoredSatAnalysisWindow(normalized) ? normalized : null
}

function normalizeStoredAnalysisItem(value: unknown): StoredSatAnalysisItem | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const normalized: StoredSatAnalysisItem = {
    packageId: getStringValue(item.packageId),
    fileName: getStringValue(item.fileName),
    uuid: getNullableString(item.uuid),
    fecha: getNullableString(item.fecha),
    serie: getNullableString(item.serie),
    folio: getNullableString(item.folio),
    emisorNombre: getNullableString(item.emisorNombre),
    emisorRfc: getNullableString(item.emisorRfc),
    receptorNombre: getNullableString(item.receptorNombre),
    receptorRfc: getNullableString(item.receptorRfc),
    subtotal: normalizeNullableNumber(item.subtotal),
    total: normalizeNullableNumber(item.total),
    moneda: getNullableString(item.moneda),
    packageDownloadedAtUtc: getNullableString(item.packageDownloadedAtUtc),
    netsuiteMatches: Array.isArray(item.netsuiteMatches)
      ? item.netsuiteMatches
          .map(normalizeNetSuiteMatchValue)
          .filter((entry): entry is SatAnalysisNetSuiteMatch => entry !== null)
      : [],
    createdAtUtc: getStringValue(item.createdAtUtc),
    updatedAtUtc: getStringValue(item.updatedAtUtc),
  }

  return isStoredSatAnalysisItem(normalized) ? normalized : null
}

function normalizeStoredProcessedItem(value: unknown): StoredSatProcessedItem | null {
  const baseItem = normalizeStoredAnalysisItem(value)
  if (!baseItem || !value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const processedReason =
    item.processedReason === 'already_in_netsuite'
      ? 'already_in_netsuite'
      : item.processedReason === 'uploaded_to_netsuite'
        ? 'uploaded_to_netsuite'
        : null

  if (!processedReason) {
    return null
  }

  return {
    ...baseItem,
    processedReason,
    processedAtUtc: getStringValue(item.processedAtUtc),
  }
}

function normalizeNetSuiteMatchValue(value: unknown): SatAnalysisNetSuiteMatch | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const matchType =
    item.matchType === 'uuid-field'
      ? 'uuid-field'
      : item.matchType === 'tranid'
        ? 'tranid'
        : item.matchType === 'externalid'
          ? 'externalid'
          : null

  if (!matchType) {
    return null
  }

  return {
    internalId: getStringValue(item.internalId),
    transactionNumber: getNullableString(item.transactionNumber),
    tranId: getNullableString(item.tranId),
    vendorName: getNullableString(item.vendorName),
    transactionDate: getNullableString(item.transactionDate),
    total: normalizeNullableNumber(item.total),
    currencyName: getNullableString(item.currencyName),
    matchType,
  }
}

function isStoredSatAnalysisWindow(value: unknown): value is StoredSatAnalysisWindow {
  if (!value || typeof value !== 'object') {
    return false
  }

  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.label === 'string' &&
    (item.status === 'pending_sat' || item.status === 'ready') &&
    (item.requestId === null || typeof item.requestId === 'string') &&
    (item.pendingRequestId === null || typeof item.pendingRequestId === 'string') &&
    typeof item.createdAtUtc === 'string' &&
    typeof item.updatedAtUtc === 'string' &&
    Array.isArray(item.packageIds) &&
    Array.isArray(item.analysisItems) &&
    Array.isArray(item.processedItems)
  )
}

function isStoredSatAnalysisItem(value: unknown): value is StoredSatAnalysisItem {
  if (!value || typeof value !== 'object') {
    return false
  }

  const item = value as Record<string, unknown>
  return (
    typeof item.packageId === 'string' &&
    typeof item.fileName === 'string' &&
    (item.uuid === null || typeof item.uuid === 'string') &&
    (item.fecha === null || typeof item.fecha === 'string') &&
    (item.serie === null || typeof item.serie === 'string') &&
    (item.folio === null || typeof item.folio === 'string') &&
    (item.emisorNombre === null || typeof item.emisorNombre === 'string') &&
    (item.emisorRfc === null || typeof item.emisorRfc === 'string') &&
    (item.receptorNombre === null || typeof item.receptorNombre === 'string') &&
    (item.receptorRfc === null || typeof item.receptorRfc === 'string') &&
    (item.subtotal === null || (typeof item.subtotal === 'number' && Number.isFinite(item.subtotal))) &&
    (item.total === null || (typeof item.total === 'number' && Number.isFinite(item.total))) &&
    (item.moneda === null || typeof item.moneda === 'string') &&
    (item.packageDownloadedAtUtc === null || typeof item.packageDownloadedAtUtc === 'string') &&
    Array.isArray(item.netsuiteMatches) &&
    typeof item.createdAtUtc === 'string' &&
    typeof item.updatedAtUtc === 'string'
  )
}

function buildSatAnalysisWindowId(
  startAtUtc: string,
  endAtUtc: string,
  documentType: SatAnalysisDocumentType,
) {
  return `sat-received-${formatSatAnalysisDocumentTypeForId(documentType)}-${startAtUtc.slice(0, 10)}-${endAtUtc.slice(0, 10)}`
}

function buildSatAnalysisWindowLabel(
  startAtUtc: string,
  endAtUtc: string,
  documentType: SatAnalysisDocumentType,
) {
  const documentTypeLabel =
    documentType === 'undefined' ? 'todos CFDI' : `CFDI ${documentType}`
  return `SAT recibidas proveedor ${documentTypeLabel} ${startAtUtc.slice(0, 10)} a ${endAtUtc.slice(0, 10)}`
}

function normalizeSatAnalysisDocumentType(value: unknown): SatAnalysisDocumentType {
  return value === 'undefined' ||
    value === 'ingreso' ||
    value === 'egreso' ||
    value === 'traslado' ||
    value === 'nomina' ||
    value === 'pago'
    ? value
    : 'ingreso'
}

function normalizeTipoComprobante(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim().toUpperCase() : null
}

function resolveIgnoredCfdiReason(tipoComprobante: string | null | undefined): SatIgnoredCfdiReason | null {
  const normalized = normalizeTipoComprobante(tipoComprobante)
  if (normalized === 'T') {
    return 'unsupported_traslado'
  }

  if (normalized === 'P') {
    return 'unsupported_pago'
  }

  return null
}

function formatSatAnalysisDocumentTypeForId(documentType: SatAnalysisDocumentType) {
  return documentType === 'undefined' ? 'all' : documentType
}

function buildSatHistoryCandidateKey(packageId: string, item: StoredSatDownloadedCfdi) {
  return [packageId, normalizeUuid(item.uuid) ?? '', item.fileName].join('|')
}

function compareSatAnalysisWindows(left: StoredSatAnalysisWindow, right: StoredSatAnalysisWindow) {
  return right.updatedAtUtc.localeCompare(left.updatedAtUtc) || right.id.localeCompare(left.id)
}

function buildSatAnalysisWorkflowSummary(windows: StoredSatAnalysisWindow[]): SatAnalysisWorkflowSummary {
  const now = new Date()
  const latestWindow =
    [...windows].sort((left, right) => {
      return (
        right.subset.endAtUtc.localeCompare(left.subset.endAtUtc) ||
        right.updatedAtUtc.localeCompare(left.updatedAtUtc) ||
        right.id.localeCompare(left.id)
      )
    })[0] ?? null

  const suggestedEndAtUtc = now.toISOString()
  const suggestedStartAtUtc = latestWindow
    ? (() => {
        const latestEndAt = new Date(latestWindow.subset.endAtUtc)
        return new Date(
          Date.UTC(
            latestEndAt.getUTCFullYear(),
            latestEndAt.getUTCMonth(),
            latestEndAt.getUTCDate() - (SAT_ANALYSIS_EXTRACTION_OVERLAP_DAYS - 1),
            0,
            0,
            0,
            0,
          ),
        ).toISOString()
      })()
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString()

  return {
    overlapDays: SAT_ANALYSIS_EXTRACTION_OVERLAP_DAYS,
    latestWindow: latestWindow
      ? {
          id: latestWindow.id,
          label: latestWindow.label,
          status: latestWindow.status,
          startAtUtc: latestWindow.subset.startAtUtc,
          endAtUtc: latestWindow.subset.endAtUtc,
          updatedAtUtc: latestWindow.updatedAtUtc,
          lastSatSyncAtUtc: latestWindow.lastSatSyncAtUtc,
          lastNetSuiteSyncAtUtc: latestWindow.lastNetSuiteSyncAtUtc,
        }
      : null,
    suggestedExtraction: {
      startAtUtc: suggestedStartAtUtc,
      endAtUtc: suggestedEndAtUtc,
      startDate: suggestedStartAtUtc.slice(0, 10),
      endDate: suggestedEndAtUtc.slice(0, 10),
      basis: latestWindow ? 'latest_window_overlap' : 'current_month_fallback',
      overlapDays: SAT_ANALYSIS_EXTRACTION_OVERLAP_DAYS,
      sourceWindowId: latestWindow?.id ?? null,
      sourceWindowEndAtUtc: latestWindow?.subset.endAtUtc ?? null,
    },
  }
}

function sortAnalysisItems(items: StoredSatAnalysisItem[]) {
  return [...items].sort((left, right) => {
    const leftDate = left.fecha ?? ''
    const rightDate = right.fecha ?? ''
    return (
      leftDate.localeCompare(rightDate) ||
      (left.emisorNombre ?? '').localeCompare(right.emisorNombre ?? '') ||
      (left.uuid ?? left.fileName).localeCompare(right.uuid ?? right.fileName)
    )
  })
}

function sortProcessedItems(items: StoredSatProcessedItem[]) {
  return [...items].sort((left, right) => {
    return (
      right.processedAtUtc.localeCompare(left.processedAtUtc) ||
      (left.emisorNombre ?? '').localeCompare(right.emisorNombre ?? '') ||
      (left.uuid ?? left.fileName).localeCompare(right.uuid ?? right.fileName)
    )
  })
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)]
}

function buildUploadedToNetSuiteMap(processedItems: StoredSatProcessedItem[]) {
  return new Map<string, string>(
    processedItems.reduce<Array<[string, string]>>((entries, item) => {
      if (item.processedReason !== 'uploaded_to_netsuite') {
        return entries
      }

      const normalizedUuid = normalizeUuid(item.uuid)
      if (!normalizedUuid) {
        return entries
      }

      entries.push([normalizedUuid, item.processedAtUtc])
      return entries
    }, []),
  )
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

function readSuiteQlItems(json: unknown) {
  if (!json || typeof json !== 'object') {
    return []
  }

  const items = (json as { items?: Array<Record<string, unknown>> }).items
  return Array.isArray(items) ? items : []
}

function toSuiteQlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function normalizeUuid(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().toUpperCase() : null
}

function normalizeIsoDateTime(value: string, fieldName: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new SatServiceError(`La fecha ${fieldName} no es valida.`, 400)
  }

  return parsed.toISOString()
}

function normalizeSatAnalysisEndAtUtc(value: string) {
  const now = new Date()
  return new Date(value).getTime() > now.getTime() ? now.toISOString() : value
}

function getStringValue(value: unknown) {
  return typeof value === 'string' ? value : String(value ?? '')
}

function getNullableString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function normalizeNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function asOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function parseNumber(value: string | null) {
  if (!value) {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
