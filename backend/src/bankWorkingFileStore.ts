import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { BankImportBankId } from './types.js'

export type StoredBankWorkingFile = {
  bankId: BankImportBankId
  fileName: string
  fileBase64: string
  sourceFileHash: string
  createdAtUtc: string
  updatedAtUtc: string
}

type StoredBankWorkingFileStore = {
  version: 1
  items: StoredBankWorkingFile[]
}

const BANK_WORKING_FILE_STORE_PATH =
  process.env.BANKS_WORKING_FILE_STORE_PATH?.trim() ||
  (process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'netsuite-recon', 'bank-working-files.json')
    : path.join(process.cwd(), 'data', 'bank-working-files.json'))

export function getBankWorkingFile(bankId: BankImportBankId) {
  return loadBankWorkingFiles().find((item) => item.bankId === bankId) ?? null
}

export function upsertBankWorkingFile(input: {
  bankId: BankImportBankId
  fileName: string
  fileBase64: string
}) {
  const cleanedFileName = cleanText(input.fileName)
  const cleanedFileBase64 = cleanText(input.fileBase64)
  if (!cleanedFileName || !cleanedFileBase64) {
    throw new Error('No se puede resguardar un archivo bancario sin nombre y contenido.')
  }

  const currentItems = loadBankWorkingFiles()
  const now = new Date().toISOString()
  const existingIndex = currentItems.findIndex((item) => item.bankId === input.bankId)

  const nextItem: StoredBankWorkingFile = {
    bankId: input.bankId,
    fileName: cleanedFileName,
    fileBase64: cleanedFileBase64,
    sourceFileHash: createHash('sha1').update(cleanedFileBase64).digest('hex'),
    createdAtUtc: existingIndex >= 0 ? currentItems[existingIndex].createdAtUtc : now,
    updatedAtUtc: now,
  }

  const nextItems =
    existingIndex >= 0
      ? currentItems.map((item, index) => (index === existingIndex ? nextItem : item))
      : [...currentItems, nextItem]

  persistBankWorkingFiles(nextItems)
  return nextItem
}

function loadBankWorkingFiles() {
  if (!fs.existsSync(BANK_WORKING_FILE_STORE_PATH)) {
    return [] as StoredBankWorkingFile[]
  }

  try {
    const raw = fs.readFileSync(BANK_WORKING_FILE_STORE_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoredBankWorkingFileStore>
    if (!Array.isArray(parsed.items)) {
      return []
    }

    return parsed.items
      .map(normalizeStoredBankWorkingFile)
      .filter((item): item is StoredBankWorkingFile => item !== null)
  } catch {
    return []
  }
}

function persistBankWorkingFiles(items: StoredBankWorkingFile[]) {
  const directoryPath = path.dirname(BANK_WORKING_FILE_STORE_PATH)
  fs.mkdirSync(directoryPath, { recursive: true })

  const payload: StoredBankWorkingFileStore = {
    version: 1,
    items,
  }

  fs.writeFileSync(BANK_WORKING_FILE_STORE_PATH, JSON.stringify(payload, null, 2), 'utf8')
}

function normalizeStoredBankWorkingFile(value: unknown): StoredBankWorkingFile | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const bankId = typeof item.bankId === 'string' ? (item.bankId as BankImportBankId) : null
  if (!bankId) {
    return null
  }

  const normalized: StoredBankWorkingFile = {
    bankId,
    fileName: cleanText(item.fileName),
    fileBase64: cleanText(item.fileBase64),
    sourceFileHash: cleanText(item.sourceFileHash),
    createdAtUtc: cleanText(item.createdAtUtc),
    updatedAtUtc: cleanText(item.updatedAtUtc),
  }

  return isStoredBankWorkingFile(normalized) ? normalized : null
}

function isStoredBankWorkingFile(value: StoredBankWorkingFile) {
  return (
    Boolean(value.bankId) &&
    Boolean(value.fileName) &&
    Boolean(value.fileBase64) &&
    Boolean(value.sourceFileHash) &&
    Boolean(value.createdAtUtc) &&
    Boolean(value.updatedAtUtc)
  )
}

function cleanText(value: unknown) {
  return String(value ?? '').trim()
}
