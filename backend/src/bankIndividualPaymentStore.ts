import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type {
  BankImportBankId,
  BankImportIndividualPaymentFileMetadata,
  BankImportIndividualPaymentUploadRequest,
  BankImportIndividualPaymentUploadResponse,
} from './types.js'

type StoredBankIndividualPaymentFile = BankImportIndividualPaymentFileMetadata & {
  fileBase64: string
}

type StoredBankIndividualPaymentFileStore = {
  version: 1
  items: StoredBankIndividualPaymentFile[]
}

const INDIVIDUAL_PAYMENT_STORE_PATH =
  process.env.BANKS_INDIVIDUAL_PAYMENT_STORE_PATH?.trim() ||
  path.join(process.env.LOCALAPPDATA || process.cwd(), 'netsuite-recon', 'bank-individual-payment-files.json')

export function getBankIndividualPaymentFileSummary(bankId: BankImportBankId) {
  const items = loadBankIndividualPaymentFiles(bankId)
  const lastUpdatedAtUtc =
    items.length > 0
      ? items
          .map((item) => item.updatedAtUtc)
          .sort((left, right) => right.localeCompare(left))[0] ?? null
      : null

  return {
    bankId,
    count: items.length,
    lastUpdatedAtUtc,
  }
}

export function listBankIndividualPaymentFileMetadata(bankId: BankImportBankId) {
  return loadBankIndividualPaymentFiles(bankId).map(stripFileContent)
}

export function upsertBankIndividualPaymentFiles(
  request: BankImportIndividualPaymentUploadRequest,
): BankImportIndividualPaymentUploadResponse {
  const bankId = request.bankId
  const files = Array.isArray(request.files) ? request.files.map(normalizeUploadFile).filter(isUploadFileReady) : []

  if (!bankId) {
    throw new Error('Debes indicar el banco de los PagosIndividuales.')
  }

  if (files.length === 0) {
    throw new Error('Adjunta al menos un comprobante BBVA para guardar en PagosIndividuales.')
  }

  const currentItems = readStoreItems()
  const nextItems = [...currentItems]
  const now = new Date().toISOString()
  let inserted = 0
  let updated = 0
  const storedItems: StoredBankIndividualPaymentFile[] = []

  files.forEach((file) => {
    const fileDigest = createHash('sha1').update(file.fileBase64).digest('hex')
    const existingIndex = nextItems.findIndex((item) => item.bankId === bankId && item.fileDigest === fileDigest)
    const nextItem: StoredBankIndividualPaymentFile = {
      id: existingIndex >= 0 ? nextItems[existingIndex].id : randomUUID(),
      bankId,
      fileName: file.fileName,
      mimeType: file.mimeType,
      fileDigest,
      fileSizeBytes: getBase64SizeBytes(file.fileBase64),
      fileBase64: file.fileBase64,
      createdAtUtc: existingIndex >= 0 ? nextItems[existingIndex].createdAtUtc : now,
      updatedAtUtc: now,
    }

    if (existingIndex >= 0) {
      nextItems[existingIndex] = nextItem
      updated += 1
    } else {
      nextItems.push(nextItem)
      inserted += 1
    }

    storedItems.push(nextItem)
  })

  persistStoreItems(nextItems)
  const summary = getBankIndividualPaymentFileSummary(bankId)

  return {
    bankId,
    uploadedFiles: storedItems.length,
    insertedFiles: inserted,
    updatedFiles: updated,
    totalFiles: summary.count,
    lastUpdatedAtUtc: summary.lastUpdatedAtUtc,
    items: storedItems.map(stripFileContent),
  }
}

function loadBankIndividualPaymentFiles(bankId?: BankImportBankId) {
  const items = readStoreItems()
  return bankId ? items.filter((item) => item.bankId === bankId) : items
}

function readStoreItems() {
  if (!fs.existsSync(INDIVIDUAL_PAYMENT_STORE_PATH)) {
    return [] as StoredBankIndividualPaymentFile[]
  }

  try {
    const raw = fs.readFileSync(INDIVIDUAL_PAYMENT_STORE_PATH, 'utf8').replace(/^\uFEFF/u, '')
    const parsed = JSON.parse(raw) as Partial<StoredBankIndividualPaymentFileStore>
    if (!Array.isArray(parsed.items)) {
      return []
    }

    return parsed.items
      .map(normalizeStoredItem)
      .filter((item): item is StoredBankIndividualPaymentFile => item !== null)
  } catch {
    return []
  }
}

function persistStoreItems(items: StoredBankIndividualPaymentFile[]) {
  const directoryPath = path.dirname(INDIVIDUAL_PAYMENT_STORE_PATH)
  fs.mkdirSync(directoryPath, { recursive: true })

  const payload: StoredBankIndividualPaymentFileStore = {
    version: 1,
    items,
  }

  fs.writeFileSync(INDIVIDUAL_PAYMENT_STORE_PATH, JSON.stringify(payload, null, 2), 'utf8')
}

function normalizeUploadFile(value: unknown) {
  const item = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    fileName: cleanText(item.fileName),
    fileBase64: cleanText(item.fileBase64),
    mimeType: cleanText(item.mimeType) || null,
  }
}

function isUploadFileReady(value: ReturnType<typeof normalizeUploadFile>) {
  return Boolean(value.fileName && value.fileBase64)
}

function normalizeStoredItem(value: unknown): StoredBankIndividualPaymentFile | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const bankId = typeof item.bankId === 'string' ? (item.bankId as BankImportBankId) : null
  const fileName = cleanText(item.fileName)
  const fileBase64 = cleanText(item.fileBase64)
  const fileDigest = cleanText(item.fileDigest) || createHash('sha1').update(fileBase64).digest('hex')

  if (!bankId || !fileName || !fileBase64 || !fileDigest) {
    return null
  }

  return {
    id: cleanText(item.id) || randomUUID(),
    bankId,
    fileName,
    mimeType: cleanText(item.mimeType) || null,
    fileDigest,
    fileSizeBytes: normalizeNumber(item.fileSizeBytes) || getBase64SizeBytes(fileBase64),
    fileBase64,
    createdAtUtc: cleanText(item.createdAtUtc),
    updatedAtUtc: cleanText(item.updatedAtUtc),
  }
}

function stripFileContent(item: StoredBankIndividualPaymentFile): BankImportIndividualPaymentFileMetadata {
  return {
    id: item.id,
    bankId: item.bankId,
    fileName: item.fileName,
    mimeType: item.mimeType,
    fileDigest: item.fileDigest,
    fileSizeBytes: item.fileSizeBytes,
    createdAtUtc: item.createdAtUtc,
    updatedAtUtc: item.updatedAtUtc,
  }
}

function getBase64SizeBytes(value: string) {
  try {
    return Buffer.byteLength(value, 'base64')
  } catch {
    return 0
  }
}

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}
