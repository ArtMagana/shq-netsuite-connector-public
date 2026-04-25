import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { DOMParser } from '@xmldom/xmldom'

import { fetchInventoryAdjustmentItemSnapshot } from './inventoryAdjustments.js'
import {
  cacheInventoryCertificateFile,
  invalidateInventoryCertificateIndexCache,
  removeCachedInventoryCertificatesByLot,
} from './inventoryCertificates.js'
import { cloneInventoryCoaPdf } from './inventoryCoaPdf.js'
import { upsertInventoryLotReplacementRegistryEntry } from './inventoryLotReplacementRegistry.js'
import { fetchInventoryLotSummary, invalidateInventoryLotSummaryCache } from './inventoryLotSummary.js'
import { loadLocalEnv } from './loadLocalEnv.js'
import { NetSuiteClient } from './netsuiteClient.js'

loadLocalEnv()

const SOAP_VERSION = '2025_2'
const SOAP_ENDPOINT_SUFFIX = `/services/NetSuitePort_${SOAP_VERSION}`
const SOAP_RETRY_DELAYS_MS = [600, 1600, 3200, 5200]
const NUMERIC_TOLERANCE = 0.0001

type InventoryLotReplacementRequest = {
  itemId?: unknown
  currentLot?: unknown
  newLot?: unknown
  newProductionDate?: unknown
  newExpirationDate?: unknown
  sourceCoaFileId?: unknown
  accountId?: unknown
  transactionDate?: unknown
}

type InventoryLotReplacementAccount = {
  internalId: string
  displayName: string
}

type InventoryLotReplacementProduct = {
  internalId: string
  itemId: string
  displayName: string | null
  label: string
}

type InventoryLotReplacementLocation = {
  internalId: string
  name: string | null
  subsidiaryId: string | null
  subsidiaryName: string | null
}

type InventoryLotReplacementFileRecord = {
  fileId: string
  fileName: string
  fileUrl: string | null
  folderId: string
  folderName: string | null
}

type InventoryLotReplacementTargetLot = {
  inventoryNumberId: string | null
  quantityOnHand: number
  quantityAvailable: number
  expirationDate: string | null
  reusedExistingLot: boolean
}

type InventoryLotReplacementResponse = {
  executedAtUtc: string
  transactionDate: string
  account: InventoryLotReplacementAccount
  product: InventoryLotReplacementProduct
  location: InventoryLotReplacementLocation
  quantityMoved: number
  adjustment: {
    internalId: string
    tranId: string | null
    memo: string
  }
  lots: {
    current: {
      inventoryNumberId: string
      inventoryNumber: string
      quantityOnHandBefore: number
      quantityAvailableBefore: number
      quantityOnHandAfter: number
    }
    next: {
      inventoryNumberId: string
      inventoryNumber: string
      productionDate: string
      expirationDate: string
      quantityOnHandAfter: number
    }
  }
  coa: {
    sourceFileId: string
    sourceFileName: string
    newFileName: string
    uploadedFiles: InventoryLotReplacementFileRecord[]
    deletedFiles: InventoryLotReplacementFileRecord[]
    remainingOldFiles: InventoryLotReplacementFileRecord[]
    detectedNewFiles: InventoryLotReplacementFileRecord[]
    removedLocalCachedFiles: string[]
  }
  message: string
}

type SoapTbaConfig = {
  accountId: string
  baseUrl: string
  consumerKey: string
  consumerSecret: string
  tokenId: string
  tokenSecret: string
}

export class InventoryLotReplacementError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'InventoryLotReplacementError'
  }
}

export async function executeInventoryLotReplacement(
  client: NetSuiteClient,
  rawRequest: InventoryLotReplacementRequest,
): Promise<InventoryLotReplacementResponse> {
  const request = normalizeReplacementRequest(rawRequest)
  const account = await fetchAccountById(client, request.accountId)
  const summary = await fetchInventoryLotSummary(client, {
    itemId: request.itemId,
    lot: request.currentLot,
  })
  const snapshot = await fetchInventoryAdjustmentItemSnapshot(client, request.itemId)
  const currentLotContext = resolveCurrentLotContext(snapshot, summary.lot.inventoryNumber)
  await resolveTargetLotAvailability(client, request.itemId, request.newLot)

  const oldFiles = await searchNetSuiteLotFiles(client, summary.product, request.currentLot)
  if (oldFiles.length === 0) {
    throw new InventoryLotReplacementError(
      `No encontre archivos PDF del lote ${request.currentLot} en NetSuite.`,
      404,
    )
  }

  const existingNewFiles = await searchNetSuiteLotFiles(client, summary.product, request.newLot)
  if (existingNewFiles.length > 0) {
    throw new InventoryLotReplacementError(
      `Ya existen archivos del lote ${request.newLot} en NetSuite. No voy a duplicarlos.`,
      409,
    )
  }

  const sourceProductionDate = summary.coa.dates.manufacture?.normalized
  const sourceExpirationDate = summary.coa.dates.expiration?.normalized
  if (!sourceProductionDate || !sourceExpirationDate) {
    throw new InventoryLotReplacementError(
      'No pude leer del CoA actual la fecha de produccion y la fecha de caducidad. Primero hay que corregir esa lectura.',
      409,
    )
  }

  const sourceFile = pickTemplateFile(oldFiles, request.sourceCoaFileId, summary.coa.fileId)
  const sourceFileBinary = await downloadNetSuiteFileBinary(sourceFile.fileId)
  const clonedCoa = await cloneInventoryCoaPdfWithFallback({
    sourcePdfBuffer: sourceFileBinary.fileBuffer,
    sourceFileName: sourceFile.fileName,
    currentLot: request.currentLot,
    currentProductionDate: sourceProductionDate,
    currentExpirationDate: sourceExpirationDate,
    newLot: request.newLot,
    newProductionDate: request.newProductionDate,
    newExpirationDate: request.newExpirationDate,
  })

  await cacheInventoryCertificateFile(clonedCoa.fileName, clonedCoa.pdfBuffer)

  const uploadedFiles: InventoryLotReplacementFileRecord[] = []
  let adjustment:
    | {
        internalId: string
        tranId: string | null
        memo: string
      }
    | null = null

  try {
    const uploadFolder = await resolveCoaUploadFolder(client, oldFiles)
    const uploadedFile = await uploadNetSuitePdfFile({
      folderId: uploadFolder.folderId,
      fileName: clonedCoa.fileName,
      fileBuffer: clonedCoa.pdfBuffer,
      isInactive: true,
    })
    await attachNetSuiteFileToProduct(client, summary.product.internalId, uploadedFile.fileId)
    uploadedFiles.push({
      ...uploadedFile,
      folderName: uploadFolder.folderName,
    })

    adjustment = await createReplacementInventoryAdjustment(client, {
      transactionDate: request.transactionDate,
      account,
      product: summary.product,
      location: {
        internalId: currentLotContext.locationId,
        name: currentLotContext.locationName,
        subsidiaryId: currentLotContext.subsidiaryId,
        subsidiaryName: currentLotContext.subsidiaryName,
      },
      currentLotId: summary.lot.inventoryNumberId,
      currentLot: summary.lot.inventoryNumber,
      newLot: request.newLot,
      quantityMoved: currentLotContext.quantityOnHand,
      quantityAvailable: currentLotContext.quantityAvailable,
      newProductionDate: request.newProductionDate,
      newExpirationDate: request.newExpirationDate,
      coaFileName: clonedCoa.fileName,
    })

    const deletedFiles = await deleteFilesWithVerification(
      client,
      summary.product,
      oldFiles,
      request.currentLot,
    )
    await upsertInventoryLotReplacementRegistryEntry({
      itemId: request.itemId,
      lot: request.newLot,
      productionDate: request.newProductionDate,
      expirationDate: request.newExpirationDate,
      coaFileName: clonedCoa.fileName,
      adjustmentId: adjustment.internalId,
      tranId: adjustment.tranId,
      accountId: account.internalId,
      executedAtUtc: new Date().toISOString(),
    })
    const removedLocalCachedFiles = await removeCachedInventoryCertificatesByLot(request.currentLot)
    invalidateInventoryCertificateIndexCache()
    invalidateInventoryLotSummaryCache()

    const detectedNewFiles = await searchNetSuiteLotFiles(client, summary.product, request.newLot)
    const remainingOldFiles = await searchNetSuiteLotFiles(client, summary.product, request.currentLot)
    const nextLotState = await fetchLotState(client, request.itemId, request.newLot)
    await syncTargetInventoryNumberRecord(client, {
      sourceInventoryNumberId: summary.lot.inventoryNumberId,
      targetInventoryNumberId: nextLotState.inventoryNumberId,
      sourceLot: request.currentLot,
      targetLot: request.newLot,
      desiredExpirationDate: request.newExpirationDate,
    })
    const currentLotState = await fetchLotState(client, request.itemId, request.currentLot, {
      inventoryNumberId: summary.lot.inventoryNumberId,
    })

    return {
      executedAtUtc: new Date().toISOString(),
      transactionDate: request.transactionDate,
      account,
      product: summary.product,
      location: {
        internalId: currentLotContext.locationId,
        name: currentLotContext.locationName,
        subsidiaryId: currentLotContext.subsidiaryId,
        subsidiaryName: currentLotContext.subsidiaryName,
      },
      quantityMoved: currentLotContext.quantityOnHand,
      adjustment,
      lots: {
        current: {
          inventoryNumberId: summary.lot.inventoryNumberId,
          inventoryNumber: summary.lot.inventoryNumber,
          quantityOnHandBefore: currentLotContext.quantityOnHand,
          quantityAvailableBefore: currentLotContext.quantityAvailable,
          quantityOnHandAfter: currentLotState.quantityOnHand,
        },
        next: {
          inventoryNumberId: nextLotState.inventoryNumberId,
          inventoryNumber: request.newLot,
          productionDate: request.newProductionDate,
          expirationDate: request.newExpirationDate,
          quantityOnHandAfter: nextLotState.quantityOnHand,
        },
      },
      coa: {
        sourceFileId: sourceFile.fileId,
        sourceFileName: sourceFile.fileName,
        newFileName: clonedCoa.fileName,
        uploadedFiles,
        deletedFiles,
        remainingOldFiles,
        detectedNewFiles,
        removedLocalCachedFiles,
      },
      message: `Reemplace el lote ${request.currentLot} por ${request.newLot}, subi el nuevo CoA y retire los PDFs viejos.`,
    }
  } catch (error) {
    if (!adjustment) {
      for (const uploadedFile of uploadedFiles) {
        await deleteNetSuiteFile(uploadedFile.fileId).catch(() => undefined)
      }

      await removeCachedInventoryCertificatesByLot(request.newLot).catch(() => undefined)
      invalidateInventoryCertificateIndexCache()
      invalidateInventoryLotSummaryCache()
    }

    throw error
  }
}

function normalizeReplacementRequest(rawRequest: InventoryLotReplacementRequest) {
  const itemId = normalizeRequiredString(
    rawRequest.itemId,
    'Selecciona el producto que vas a reemplazar.',
  )
  const currentLot = normalizeRequiredLot(
    rawRequest.currentLot,
    'Selecciona el lote actual que quieres dar de baja.',
  )
  const newLot = normalizeRequiredLot(
    rawRequest.newLot,
    'Captura el lote nuevo que quieres dar de alta.',
  )
  const newProductionDate = normalizeRequiredDate(
    rawRequest.newProductionDate,
    'La nueva fecha de produccion no tiene un formato valido.',
  )
  const newExpirationDate = normalizeRequiredDate(
    rawRequest.newExpirationDate,
    'La nueva fecha de caducidad no tiene un formato valido.',
  )
  const accountId = normalizeRequiredString(
    rawRequest.accountId,
    'Falta la cuenta contable del ajuste.',
  )
  const sourceCoaFileId = getNullableString(rawRequest.sourceCoaFileId)
  const transactionDate = rawRequest.transactionDate
    ? normalizeRequiredDate(
        rawRequest.transactionDate,
        'La fecha contable del ajuste no tiene un formato valido.',
      )
    : formatDateOnly(new Date())

  if (normalizeForMatch(currentLot) === normalizeForMatch(newLot)) {
    throw new InventoryLotReplacementError('El lote nuevo no puede ser igual al lote actual.', 400)
  }

  if (newExpirationDate.localeCompare(newProductionDate) < 0) {
    throw new InventoryLotReplacementError(
      'La nueva fecha de caducidad no puede ser anterior a la nueva fecha de produccion.',
      400,
    )
  }

  return {
    itemId,
    currentLot,
    newLot,
    newProductionDate,
    newExpirationDate,
    sourceCoaFileId,
    accountId,
    transactionDate,
  }
}

async function fetchAccountById(client: NetSuiteClient, accountId: string) {
  const response = await client.suiteql(
    `
SELECT
  account.id AS internalId,
  account.displaynamewithhierarchy AS displayName
FROM account
WHERE account.id = ${formatSuiteQlLiteral(accountId)}
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
  const displayName = getNullableString(normalizedRow.displayname)
  if (!internalId || !displayName) {
    throw new InventoryLotReplacementError(`No encontre la cuenta ${accountId} en NetSuite.`, 404)
  }

  return {
    internalId,
    displayName,
  } satisfies InventoryLotReplacementAccount
}

function resolveCurrentLotContext(
  snapshot: Awaited<ReturnType<typeof fetchInventoryAdjustmentItemSnapshot>>,
  inventoryNumber: string,
) {
  const matches = snapshot.lots.filter(
    (lot) =>
      normalizeForMatch(lot.inventoryNumber ?? '') === normalizeForMatch(inventoryNumber) &&
      lot.quantityOnHand > NUMERIC_TOLERANCE,
  )

  if (matches.length === 0) {
    throw new InventoryLotReplacementError(
      `El lote ${inventoryNumber} ya no tiene existencia disponible para mover.`,
      409,
    )
  }

  const distinctLocations = Array.from(new Set(matches.map((lot) => lot.locationId)))
  if (distinctLocations.length > 1) {
    throw new InventoryLotReplacementError(
      `El lote ${inventoryNumber} existe en varias ubicaciones. Necesito que esta pantalla capture la ubicacion antes de ejecutar un reemplazo real.`,
      409,
    )
  }

  const [winner] = matches
  const location = snapshot.locations.find((candidate) => candidate.locationId === winner.locationId)

  return {
    locationId: winner.locationId,
    locationName: winner.locationName,
    subsidiaryId: location?.subsidiaryId ?? null,
    subsidiaryName: location?.subsidiaryName ?? null,
    quantityOnHand: roundQuantity(winner.quantityOnHand),
    quantityAvailable: roundQuantity(winner.quantityAvailable),
  }
}

async function ensureNewLotDoesNotExist(client: NetSuiteClient, itemId: string, newLot: string) {
  return resolveTargetLotAvailability(client, itemId, newLot)
}

async function resolveTargetLotAvailability(
  client: NetSuiteClient,
  itemId: string,
  newLot: string,
): Promise<InventoryLotReplacementTargetLot> {
  const response = await client.suiteql(
    `
SELECT
  inventorynumber.id AS inventoryNumberId,
  inventorynumber.expirationdate AS expirationDate,
  SUM(ib.quantityonhand) AS quantityOnHand,
  SUM(ib.quantityavailable) AS quantityAvailable
FROM inventorynumber
LEFT JOIN InventoryBalance ib ON ib.inventorynumber = inventorynumber.id
WHERE inventorynumber.item = ${formatSuiteQlLiteral(itemId)}
  AND UPPER(inventorynumber.inventorynumber) = ${formatSuiteQlLiteral(newLot.toUpperCase())}
GROUP BY inventorynumber.id, inventorynumber.expirationdate
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
  if (!inventoryNumberId) {
    return {
      inventoryNumberId: null,
      quantityOnHand: 0,
      quantityAvailable: 0,
      expirationDate: null,
      reusedExistingLot: false,
    }
  }

  const quantityOnHand = roundQuantity(getNullableNumber(normalizedRow.quantityonhand) ?? 0)
  const quantityAvailable = roundQuantity(getNullableNumber(normalizedRow.quantityavailable) ?? 0)
  if (quantityOnHand > NUMERIC_TOLERANCE || quantityAvailable > NUMERIC_TOLERANCE) {
    throw new InventoryLotReplacementError(
      `El lote nuevo ${newLot} ya existe en NetSuite para este producto.`,
      409,
    )
  }

  return {
    inventoryNumberId,
    quantityOnHand,
    quantityAvailable,
    expirationDate: normalizeDateOnly(getNullableString(normalizedRow.expirationdate) ?? '') ?? null,
    reusedExistingLot: true,
  }
}

async function syncTargetInventoryNumberRecord(
  client: NetSuiteClient,
  params: {
    sourceInventoryNumberId: string
    targetInventoryNumberId: string
    sourceLot: string
    targetLot: string
    desiredExpirationDate: string
  },
) {
  if (!params.targetInventoryNumberId) {
    return
  }

  const targetRecord = await client.getRecord('inventoryNumber', params.targetInventoryNumberId)
  const targetExpirationDate = getNullableString(
    getNullableRecord(targetRecord.json)?.expirationDate,
  )

  const patchPayload: Record<string, unknown> = {}
  if (targetExpirationDate !== params.desiredExpirationDate) {
    patchPayload.expirationDate = params.desiredExpirationDate
  }

  const sourceRecord = await client.getRecord('inventoryNumber', params.sourceInventoryNumberId)
  const sourceData = getNullableRecord(sourceRecord.json)
  const sourceExpirationDate = getNullableString(sourceData?.expirationDate)
  const sourceLabelUrl = getNullableString(sourceData?.custitemnumber_shq_etiqueta_lote)
  if (
    sourceLabelUrl &&
    sourceExpirationDate === params.desiredExpirationDate &&
    sourceLabelUrl.includes(params.sourceLot)
  ) {
    patchPayload.custitemnumber_shq_etiqueta_lote = sourceLabelUrl.replaceAll(
      params.sourceLot,
      params.targetLot,
    )
  }

  if (Object.keys(patchPayload).length === 0) {
    return
  }

  await client.patchRecord('inventoryNumber', params.targetInventoryNumberId, patchPayload)
}

async function cloneInventoryCoaPdfWithFallback(
  request: Omit<Parameters<typeof cloneInventoryCoaPdf>[0], 'sourcePdfBuffer'> & {
    sourcePdfBuffer: Buffer | null
  },
) {
  const cachedSourcePdfBuffer = await readCachedInventoryCertificateFile(request.sourceFileName)
  const sourceCandidates = [
    request.sourcePdfBuffer
      ? {
          label: `NetSuite file ${request.sourceFileName}`,
          fileBuffer: request.sourcePdfBuffer,
        }
      : null,
    cachedSourcePdfBuffer
      ? {
          label: `cached file ${request.sourceFileName}`,
          fileBuffer: cachedSourcePdfBuffer,
        }
      : null,
  ].filter(
    (candidate): candidate is { label: string; fileBuffer: Buffer } =>
      Boolean(candidate?.fileBuffer?.length),
  )

  if (sourceCandidates.length === 0) {
    throw new InventoryLotReplacementError(
      `NetSuite no devolvio contenido util del archivo ${request.sourceFileName} y no encontre una copia local en cache.`,
      502,
    )
  }

  let lastError: unknown = null
  for (const candidate of sourceCandidates) {
    try {
      return await cloneInventoryCoaPdf({
        ...request,
        sourcePdfBuffer: candidate.fileBuffer,
      })
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new InventoryLotReplacementError(
        `No pude clonar el CoA base ${request.sourceFileName} ni desde NetSuite ni desde la cache local.`,
        502,
      )
}

async function readCachedInventoryCertificateFile(fileName: string) {
  const targetPath = path.join(process.cwd(), 'storage', 'inventory-certificates', fileName)

  try {
    return await fs.readFile(targetPath)
  } catch {
    return null
  }
}

async function searchNetSuiteLotFiles(
  client: NetSuiteClient,
  product: InventoryLotReplacementProduct,
  lot: string,
) {
  const response = await client.suiteql(
    `
SELECT
  file.id AS fileId,
  file.name AS fileName,
  file.url AS fileUrl,
  file.folder AS folderId,
  BUILTIN.DF(file.folder) AS folderName
FROM File file
WHERE UPPER(file.name) LIKE ${formatSuiteQlLiteral(`%${escapeLikeValue(lot.toUpperCase())}%`)}
  AND UPPER(file.name) LIKE '%.PDF'
ORDER BY file.id DESC
FETCH FIRST 50 ROWS ONLY
    `.trim(),
    50,
    0,
  )

  const productTokens = tokenizeForMatch([product.itemId, product.displayName ?? ''].join(' '))
  const rows = Array.isArray(response.json.items)
    ? (response.json.items as Record<string, unknown>[])
    : []

  return rows
    .map((row) => normalizeNetSuiteFileRow(row))
    .filter((row): row is InventoryLotReplacementFileRecord => row !== null)
    .filter((row) => {
      const normalizedFileName = normalizeForMatch(row.fileName)
      const normalizedLot = normalizeForMatch(lot)
      if (!normalizedFileName.includes(normalizedLot)) {
        return false
      }

      return productTokens.every((token) => normalizedFileName.includes(token))
    })
}

function pickTemplateFile(
  files: InventoryLotReplacementFileRecord[],
  requestedFileId: string | null,
  preferredFileId: string | null,
) {
  if (requestedFileId) {
    const exactMatch = files.find((file) => file.fileId === requestedFileId)
    if (!exactMatch) {
      throw new InventoryLotReplacementError(
        `El CoA ${requestedFileId} que viste en pantalla ya no coincide con los archivos actuales de NetSuite. Recarga la ficha antes de ejecutar el reemplazo.`,
        409,
      )
    }

    return exactMatch
  }

  const scoredFiles = [...files].sort((left, right) => {
    const leftScore = scoreTemplateFile(left, preferredFileId)
    const rightScore = scoreTemplateFile(right, preferredFileId)
    if (rightScore !== leftScore) {
      return rightScore - leftScore
    }

    return right.fileId.localeCompare(left.fileId)
  })

  const winner = scoredFiles[0]
  if (!winner) {
    throw new InventoryLotReplacementError('No pude elegir un CoA origen para clonar.', 404)
  }

  return winner
}

function scoreTemplateFile(
  file: InventoryLotReplacementFileRecord,
  preferredFileId: string | null,
) {
  let score = 0
  const normalizedFolder = normalizeForMatch(file.folderName ?? '')

  if (preferredFileId && file.fileId === preferredFileId) {
    score += 300
  }

  if (normalizedFolder.includes('certificatesofanalysis')) {
    score += 120
  }

  if (normalizedFolder.includes('documentacion')) {
    score += 80
  }

  if (normalizedFolder.includes('adjuntosparaenviar')) {
    score += 40
  }

  return score
}

function dedupeFilesByFolder(files: InventoryLotReplacementFileRecord[]) {
  const uniqueFiles = new Map<string, InventoryLotReplacementFileRecord>()

  for (const file of files) {
    if (!uniqueFiles.has(file.folderId)) {
      uniqueFiles.set(file.folderId, file)
    }
  }

  return Array.from(uniqueFiles.values())
}

async function resolveCoaUploadFolder(
  client: NetSuiteClient,
  files: InventoryLotReplacementFileRecord[],
) {
  const localFolder = pickCoaFolderFromFiles(files)
  if (localFolder) {
    return localFolder
  }

  const response = await client.suiteql(
    `
SELECT
  folder.id AS folderId,
  folder.name AS folderName
FROM MediaItemFolder folder
WHERE UPPER(folder.name) = 'CERTIFICATES OF ANALYSIS'
ORDER BY folder.id
FETCH FIRST 1 ROWS ONLY
    `.trim(),
    1,
    0,
  )

  const row = Array.isArray(response.json.items)
    ? (response.json.items[0] as Record<string, unknown> | undefined)
    : undefined
  const normalizedRow = normalizeSuiteQlRow(row)
  const folderId = getNullableString(normalizedRow.folderid)
  if (!folderId) {
    throw new InventoryLotReplacementError(
      'No encontre la carpeta Certificates of Analysis para subir el nuevo CoA.',
      404,
    )
  }

  return {
    folderId,
    folderName: getNullableString(normalizedRow.foldername) ?? 'Certificates of Analysis',
  }
}

function pickCoaFolderFromFiles(files: InventoryLotReplacementFileRecord[]) {
  const candidates = dedupeFilesByFolder(files)
    .map((file) => ({
      file,
      score: scoreCoaFolderCandidate(file),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      return right.file.fileId.localeCompare(left.file.fileId)
    })

  const winner = candidates[0]
  if (!winner || winner.score <= 0) {
    return null
  }

  return {
    folderId: winner.file.folderId,
    folderName: winner.file.folderName,
  }
}

function scoreCoaFolderCandidate(file: InventoryLotReplacementFileRecord) {
  const normalizedFolder = normalizeForMatch(file.folderName ?? '')
  if (normalizedFolder.includes('certificatesofanalysis')) {
    return 300
  }

  if (normalizedFolder.includes('documentacion')) {
    return 80
  }

  if (normalizedFolder.includes('adjuntosparaenviar')) {
    return 40
  }

  return 0
}

async function downloadNetSuiteFileBinary(fileId: string) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:platformMsgs="urn:messages_${SOAP_VERSION}.platform.webservices.netsuite.com"
  xmlns:platformCore="urn:core_${SOAP_VERSION}.platform.webservices.netsuite.com"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soapenv:Header>
    ${buildSoapTokenPassportHeader()}
  </soapenv:Header>
  <soapenv:Body>
    <platformMsgs:get>
      <platformMsgs:baseRef internalId="${escapeXml(fileId)}" type="file" xsi:type="platformCore:RecordRef"/>
    </platformMsgs:get>
  </soapenv:Body>
</soapenv:Envelope>`

  const document = await postSoapRequest('get', xml)
  const record = getFirstDescendantByLocalName(document, 'record')
  if (!record) {
    throw new InventoryLotReplacementError(`NetSuite no devolvio el archivo ${fileId}.`, 502)
  }

  const fileName = getFirstDescendantText(record, 'name')
  const base64Content = compactBase64(getFirstDescendantText(record, 'content'))
  return {
    fileName,
    fileBuffer: base64Content ? Buffer.from(base64Content, 'base64') : null,
  }
}

async function uploadNetSuitePdfFile(params: {
  folderId: string
  fileName: string
  fileBuffer: Buffer
  isInactive?: boolean
}) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:platformMsgs="urn:messages_${SOAP_VERSION}.platform.webservices.netsuite.com"
  xmlns:platformCore="urn:core_${SOAP_VERSION}.platform.webservices.netsuite.com"
  xmlns:fileCab="urn:filecabinet_${SOAP_VERSION}.documents.webservices.netsuite.com"
  xmlns:fileTypes="urn:types.filecabinet_${SOAP_VERSION}.documents.webservices.netsuite.com"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soapenv:Header>
    ${buildSoapTokenPassportHeader()}
  </soapenv:Header>
  <soapenv:Body>
    <platformMsgs:add>
      <platformMsgs:record xsi:type="fileCab:File">
        <fileCab:name xsi:type="xsd:string">${escapeXml(params.fileName)}</fileCab:name>
        <fileCab:attachFrom xsi:type="fileTypes:FileAttachFrom">_computer</fileCab:attachFrom>
        <fileCab:fileType xsi:type="fileTypes:MediaType">_PDF</fileCab:fileType>
        <fileCab:folder internalId="${escapeXml(params.folderId)}" xsi:type="platformCore:RecordRef"/>
        <fileCab:isOnline xsi:type="xsd:boolean">false</fileCab:isOnline>
        <fileCab:isInactive xsi:type="xsd:boolean">${params.isInactive ? 'true' : 'false'}</fileCab:isInactive>
        <fileCab:content xsi:type="xsd:base64Binary">${params.fileBuffer.toString('base64')}</fileCab:content>
      </platformMsgs:record>
    </platformMsgs:add>
  </soapenv:Body>
</soapenv:Envelope>`

  const document = await postSoapRequest('add', xml)
  const baseRef = getFirstDescendantByLocalName(document, 'baseRef')
  const internalId = baseRef?.getAttribute('internalId')?.trim() ?? ''
  if (!internalId) {
    throw new InventoryLotReplacementError(
      `NetSuite acepto la subida del archivo ${params.fileName}, pero no devolvio internalId.`,
      502,
    )
  }

  return {
    fileId: internalId,
    fileName: params.fileName,
    fileUrl: null,
    folderId: params.folderId,
    folderName: null,
  } satisfies InventoryLotReplacementFileRecord
}

async function deleteFilesWithVerification(
  client: NetSuiteClient,
  product: InventoryLotReplacementProduct,
  files: InventoryLotReplacementFileRecord[],
  oldLot: string,
) {
  for (const file of files) {
    await deleteNetSuiteFile(file.fileId)
  }

  let remaining = await searchNetSuiteLotFiles(
    client,
    product,
    oldLot,
  )

  if (remaining.length > 0) {
    for (const file of remaining) {
      await deleteNetSuiteFile(file.fileId).catch(() => undefined)
    }
  }

  remaining = await searchNetSuiteLotFiles(
    client,
    product,
    oldLot,
  )

  if (remaining.length > 0) {
    throw new InventoryLotReplacementError(
      `El ajuste ya quedo publicado, pero siguen existiendo ${remaining.length} PDF(s) con el lote viejo ${oldLot} en NetSuite.`,
      409,
    )
  }

  return files
}

async function attachNetSuiteFileToProduct(
  client: NetSuiteClient,
  itemId: string,
  fileId: string,
) {
  const recordTypes = ['lotNumberedInventoryItem', 'inventoryItem']
  const failures: string[] = []
  let successCount = 0

  for (const recordType of recordTypes) {
    try {
      await client.attachFileToRecord(recordType, itemId, fileId)
      successCount += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`${recordType}: ${message}`)
    }
  }

  if (successCount > 0) {
    return
  }

  throw new InventoryLotReplacementError(
    `Subi el PDF ${fileId} al File Cabinet, pero no pude adjuntarlo al item ${itemId}. ${failures.join(' | ')}`,
    502,
  )
}

async function deleteNetSuiteFile(fileId: string) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:platformMsgs="urn:messages_${SOAP_VERSION}.platform.webservices.netsuite.com"
  xmlns:platformCore="urn:core_${SOAP_VERSION}.platform.webservices.netsuite.com"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soapenv:Header>
    ${buildSoapTokenPassportHeader()}
  </soapenv:Header>
  <soapenv:Body>
    <platformMsgs:delete>
      <platformMsgs:baseRef internalId="${escapeXml(fileId)}" type="file" xsi:type="platformCore:RecordRef"/>
    </platformMsgs:delete>
  </soapenv:Body>
</soapenv:Envelope>`

  await postSoapRequest('delete', xml)
}

async function createReplacementInventoryAdjustment(
  client: NetSuiteClient,
  params: {
    transactionDate: string
    account: InventoryLotReplacementAccount
    product: InventoryLotReplacementProduct
    location: InventoryLotReplacementLocation
    currentLotId: string
    currentLot: string
    newLot: string
    quantityMoved: number
    quantityAvailable: number
    newProductionDate: string
    newExpirationDate: string
    coaFileName: string
  },
) {
  const memo = `Reemplazo de lote ${params.currentLot} -> ${params.newLot}`
  const payload = {
    tranDate: params.transactionDate,
    memo,
    account: {
      id: params.account.internalId,
    },
    adjLocation: {
      id: params.location.internalId,
    },
    inventory: {
      items: [
        {
          line: 1,
          item: {
            id: params.product.internalId,
          },
          location: {
            id: params.location.internalId,
          },
          memo: `Salida lote ${params.currentLot}`,
          adjustQtyBy: roundQuantity(-params.quantityMoved),
          inventoryDetail: {
            inventoryAssignment: {
              items: [
                {
                  quantity: roundQuantity(-params.quantityMoved),
                  issueInventoryNumber: {
                    id: params.currentLotId,
                  },
                },
              ],
            },
          },
        },
        {
          line: 2,
          item: {
            id: params.product.internalId,
          },
          location: {
            id: params.location.internalId,
          },
          memo: `Entrada lote ${params.newLot}`,
          adjustQtyBy: roundQuantity(params.quantityMoved),
          custcol_fecha_produccion: params.newProductionDate,
          custcol_crt_fecha_expiracion: params.newExpirationDate,
          custcol_crt_lote: params.newLot,
          custcol_shq_disp_sell: roundQuantity(params.quantityAvailable),
          custcol_coa_lote_shq: params.coaFileName,
          inventoryDetail: {
            inventoryAssignment: {
              items: [
                {
                  quantity: roundQuantity(params.quantityMoved),
                  receiptInventoryNumber: params.newLot,
                  expirationDate: params.newExpirationDate,
                },
              ],
            },
          },
        },
      ],
    },
  }

  const createResponse = await client.createRecord('inventoryAdjustment', payload)
  const internalId =
    getNullableString((getNullableRecord(createResponse.json) ?? {}).id) ??
    parseRecordIdFromLocation(createResponse.location)

  if (!internalId) {
    throw new InventoryLotReplacementError(
      'NetSuite creo el ajuste, pero no devolvio un internalId utilizable.',
      502,
    )
  }

  let tranId: string | null = null
  try {
    const freshRecord = await client.getRecord('inventoryAdjustment', internalId)
    tranId = getNullableString((getNullableRecord(freshRecord.json) ?? {}).tranId)
  } catch {
    tranId = null
  }

  return {
    internalId,
    tranId,
    memo,
  }
}

async function fetchLotState(
  client: NetSuiteClient,
  itemId: string,
  lot: string,
  options?: {
    inventoryNumberId?: string | null
  },
) {
  const response = await client.suiteql(
    `
SELECT
  inventorynumber.id AS inventoryNumberId,
  SUM(ib.quantityonhand) AS quantityOnHand
FROM inventorynumber
LEFT JOIN InventoryBalance ib ON ib.inventorynumber = inventorynumber.id
WHERE inventorynumber.item = ${formatSuiteQlLiteral(itemId)}
  AND UPPER(inventorynumber.inventorynumber) = ${formatSuiteQlLiteral(lot.toUpperCase())}
GROUP BY inventorynumber.id
FETCH FIRST 1 ROWS ONLY
    `.trim(),
    1,
    0,
  )

  const row = Array.isArray(response.json.items)
    ? (response.json.items[0] as Record<string, unknown> | undefined)
    : undefined
  const normalizedRow = normalizeSuiteQlRow(row)
  const inventoryNumberId =
    getNullableString(normalizedRow.inventorynumberid) ?? options?.inventoryNumberId ?? null

  return {
    inventoryNumberId: inventoryNumberId ?? '',
    quantityOnHand: getNullableNumber(normalizedRow.quantityonhand) ?? 0,
  }
}

function normalizeNetSuiteFileRow(value: Record<string, unknown>) {
  const row = normalizeSuiteQlRow(value)
  const fileId = getNullableString(row.fileid)
  const fileName = getNullableString(row.filename)
  const folderId = getNullableString(row.folderid)
  if (!fileId || !fileName || !folderId) {
    return null
  }

  return {
    fileId,
    fileName,
    fileUrl: getNullableString(row.fileurl),
    folderId,
    folderName: getNullableString(row.foldername),
  } satisfies InventoryLotReplacementFileRecord
}

function normalizeRequiredString(value: unknown, message: string) {
  const normalized = getNullableString(value)
  if (!normalized) {
    throw new InventoryLotReplacementError(message, 400)
  }

  return normalized
}

function normalizeRequiredLot(value: unknown, message: string) {
  const normalized = normalizeRequiredString(value, message).replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z0-9._/-]+$/.test(normalized)) {
    throw new InventoryLotReplacementError(message, 400)
  }

  return normalized
}

function normalizeRequiredDate(value: unknown, message: string) {
  const normalized = getNullableString(value)
  const dateOnly = normalized ? normalizeDateOnly(normalized) : null
  if (!dateOnly) {
    throw new InventoryLotReplacementError(message, 400)
  }

  return dateOnly
}

function normalizeDateOnly(value: string) {
  const parts = value.split(/[./-]/).map((segment) => segment.trim())
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

function formatDateOnly(value: Date) {
  return `${value.getUTCFullYear().toString().padStart(4, '0')}-${(value.getUTCMonth() + 1)
    .toString()
    .padStart(2, '0')}-${value.getUTCDate().toString().padStart(2, '0')}`
}

function roundQuantity(value: number) {
  return Math.round(value * 1000) / 1000
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

function normalizeForMatch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
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

function parseRecordIdFromLocation(location: string | null) {
  if (!location) {
    return null
  }

  const match = location.match(/\/inventoryAdjustment\/([^/?#]+)/i)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

async function postSoapRequest(soapAction: string, body: string) {
  const config = loadSoapConfig()
  let lastError: unknown = null

  for (let attempt = 0; attempt < SOAP_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await postSoapRequestOnce(config, soapAction, body)
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      const shouldRetry =
        attempt < SOAP_RETRY_DELAYS_MS.length - 1 &&
        /concurrent request limit exceeded|request blocked|temporarily unavailable/i.test(message)

      if (!shouldRetry) {
        break
      }

      await sleep(SOAP_RETRY_DELAYS_MS[attempt])
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new InventoryLotReplacementError(`NetSuite SOAP error during ${soapAction}.`, 503)
}

async function postSoapRequestOnce(config: SoapTbaConfig, soapAction: string, body: string) {
  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}${SOAP_ENDPOINT_SUFFIX}`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: soapAction,
    },
    body,
  })

  const responseText = await response.text()
  if (!response.ok) {
    throw new InventoryLotReplacementError(`NetSuite SOAP HTTP ${response.status}: ${responseText}`, 503)
  }

  const document = new DOMParser().parseFromString(responseText, 'text/xml')
  const status = getFirstDescendantByLocalName(document, 'status')
  const isSuccess = status?.getAttribute('isSuccess')?.trim()
  if (isSuccess === 'false') {
    const details = getDescendantsByLocalName(document, 'statusDetail')
      .map((detail) => {
        const code = getFirstDescendantText(detail, 'code')
        const message = getFirstDescendantText(detail, 'message')
        return [code, message].filter(Boolean).join(': ')
      })
      .filter(Boolean)
    const faultString = getFirstDescendantText(document, 'faultstring')
    throw new InventoryLotReplacementError(
      details[0] || faultString || `NetSuite SOAP ${soapAction} failed.`,
      503,
    )
  }

  const faultString = getFirstDescendantText(document, 'faultstring')
  if (faultString) {
    throw new InventoryLotReplacementError(faultString, 503)
  }

  return document
}

function loadSoapConfig(): SoapTbaConfig {
  const config = {
    accountId: process.env.NETSUITE_ACCOUNT_ID?.trim() ?? '',
    baseUrl: process.env.NETSUITE_BASE_URL?.trim() ?? '',
    consumerKey: process.env.NETSUITE_CONSUMER_KEY?.trim() ?? '',
    consumerSecret: process.env.NETSUITE_CONSUMER_SECRET?.trim() ?? '',
    tokenId: process.env.NETSUITE_TOKEN_ID?.trim() ?? '',
    tokenSecret: process.env.NETSUITE_TOKEN_SECRET?.trim() ?? '',
  }

  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (missing.length > 0) {
    throw new InventoryLotReplacementError(
      `Faltan credenciales SOAP de NetSuite: ${missing.join(', ')}`,
      500,
    )
  }

  return config
}

function buildSoapTokenPassportHeader() {
  const config = loadSoapConfig()
  const nonce = crypto.randomBytes(12).toString('hex')
  const timestamp = String(Math.floor(Date.now() / 1000))
  const baseString = [config.accountId, config.consumerKey, config.tokenId, nonce, timestamp].join('&')
  const signingKey = `${encodeURIComponent(config.consumerSecret)}&${encodeURIComponent(config.tokenSecret)}`
  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(baseString)
    .digest('base64')

  return `<platformMsgs:tokenPassport xmlns:platformMsgs="urn:messages_${SOAP_VERSION}.platform.webservices.netsuite.com">
    <platformCore:account xmlns:platformCore="urn:core_${SOAP_VERSION}.platform.webservices.netsuite.com">${escapeXml(config.accountId)}</platformCore:account>
    <platformCore:consumerKey xmlns:platformCore="urn:core_${SOAP_VERSION}.platform.webservices.netsuite.com">${escapeXml(config.consumerKey)}</platformCore:consumerKey>
    <platformCore:token xmlns:platformCore="urn:core_${SOAP_VERSION}.platform.webservices.netsuite.com">${escapeXml(config.tokenId)}</platformCore:token>
    <platformCore:nonce xmlns:platformCore="urn:core_${SOAP_VERSION}.platform.webservices.netsuite.com">${escapeXml(nonce)}</platformCore:nonce>
    <platformCore:timestamp xmlns:platformCore="urn:core_${SOAP_VERSION}.platform.webservices.netsuite.com">${timestamp}</platformCore:timestamp>
    <platformCore:signature algorithm="HMAC_SHA256" xmlns:platformCore="urn:core_${SOAP_VERSION}.platform.webservices.netsuite.com">${escapeXml(signature)}</platformCore:signature>
  </platformMsgs:tokenPassport>`
}

function compactBase64(value: string | null) {
  if (!value) {
    return null
  }

  const compact = value.replace(/\s+/g, '')
  return compact || null
}

function getFirstDescendantText(node: any, localName: string) {
  return getFirstDescendantByLocalName(node, localName)?.textContent?.trim() || null
}

function getFirstDescendantByLocalName(node: any, localName: string): any | null {
  return getDescendantsByLocalName(node, localName)[0] ?? null
}

function getDescendantsByLocalName(node: any, localName: string): any[] {
  const descendants: any[] = []

  function walk(currentNode: any) {
    if (!currentNode?.childNodes?.length) {
      return
    }

    for (let index = 0; index < currentNode.childNodes.length; index += 1) {
      const childNode = currentNode.childNodes[index]
      const childLocalName = childNode?.localName ?? childNode?.nodeName?.split(':').pop() ?? null
      if (childLocalName === localName) {
        descendants.push(childNode)
      }

      walk(childNode)
    }
  }

  walk(node)
  return descendants
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
