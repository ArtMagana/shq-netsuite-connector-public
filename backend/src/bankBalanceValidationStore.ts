import fs from 'node:fs'
import path from 'node:path'

import type { BankImportBankId } from './types.js'

export type StoredBankBalanceValidation = {
  bankId: BankImportBankId
  sourceFileHash: string
  sourceFileName: string
  cutoffDate: string
  movementMinProcessingDate: string | null
  movementMaxProcessingDate: string | null
  validatedClosingBalance: number
  validatedAtUtc: string
  createdAtUtc: string
  updatedAtUtc: string
}

type StoredBankBalanceValidationFile = {
  version: 1
  items: StoredBankBalanceValidation[]
}

const BANK_BALANCE_VALIDATION_STORE_PATH =
  process.env.BANKS_BALANCE_VALIDATION_STORE_PATH?.trim() ||
  path.join(process.env.LOCALAPPDATA || process.cwd(), 'netsuite-recon', 'bank-balance-validations.json')

export function findBankBalanceValidation(input: {
  bankId: BankImportBankId
  sourceFileHash: string
  cutoffDate: string
}) {
  const sourceFileHash = cleanText(input.sourceFileHash)
  const cutoffDate = cleanText(input.cutoffDate)
  return (
    loadBankBalanceValidations().find(
      (item) => item.bankId === input.bankId && item.sourceFileHash === sourceFileHash && item.cutoffDate === cutoffDate,
    ) ?? null
  )
}

export function findLatestBankBalanceValidationBefore(input: {
  bankId: BankImportBankId
  beforeProcessingDate: string | null
}) {
  const beforeProcessingDate = cleanText(input.beforeProcessingDate)
  if (!beforeProcessingDate) {
    return null
  }

  return (
    loadBankBalanceValidations()
      .filter(
        (item) =>
          item.bankId === input.bankId &&
          Boolean(item.movementMaxProcessingDate) &&
          (item.movementMaxProcessingDate as string) < beforeProcessingDate,
      )
      .sort(
        (left, right) =>
          (right.movementMaxProcessingDate ?? '').localeCompare(left.movementMaxProcessingDate ?? '') ||
          right.validatedAtUtc.localeCompare(left.validatedAtUtc),
      )[0] ?? null
  )
}

export function upsertBankBalanceValidation(input: {
  bankId: BankImportBankId
  sourceFileHash: string
  sourceFileName: string
  cutoffDate: string
  movementMinProcessingDate: string | null
  movementMaxProcessingDate: string | null
  validatedClosingBalance: number
}) {
  const normalizedBalance = round2(Number(input.validatedClosingBalance))
  if (!Number.isFinite(normalizedBalance)) {
    throw new Error('No se puede guardar un saldo validado vacio o invalido.')
  }

  const sourceFileHash = cleanText(input.sourceFileHash)
  const sourceFileName = cleanText(input.sourceFileName)
  const cutoffDate = cleanText(input.cutoffDate)
  if (!sourceFileHash || !sourceFileName || !cutoffDate) {
    throw new Error('Falta contexto para guardar el saldo validado de esta carga.')
  }

  const currentItems = loadBankBalanceValidations()
  const now = new Date().toISOString()
  const existingIndex = currentItems.findIndex(
    (item) => item.bankId === input.bankId && item.sourceFileHash === sourceFileHash && item.cutoffDate === cutoffDate,
  )

  const nextItem: StoredBankBalanceValidation = {
    bankId: input.bankId,
    sourceFileHash,
    sourceFileName,
    cutoffDate,
    movementMinProcessingDate: cleanNullableDate(input.movementMinProcessingDate),
    movementMaxProcessingDate: cleanNullableDate(input.movementMaxProcessingDate),
    validatedClosingBalance: normalizedBalance,
    validatedAtUtc: now,
    createdAtUtc: existingIndex >= 0 ? currentItems[existingIndex].createdAtUtc : now,
    updatedAtUtc: now,
  }

  const nextItems =
    existingIndex >= 0
      ? currentItems.map((item, index) => (index === existingIndex ? nextItem : item))
      : [...currentItems, nextItem]

  persistBankBalanceValidations(nextItems)
  return nextItem
}

function loadBankBalanceValidations() {
  if (!fs.existsSync(BANK_BALANCE_VALIDATION_STORE_PATH)) {
    return [] as StoredBankBalanceValidation[]
  }

  try {
    const raw = fs.readFileSync(BANK_BALANCE_VALIDATION_STORE_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoredBankBalanceValidationFile>
    if (!Array.isArray(parsed.items)) {
      return []
    }

    return parsed.items
      .map(normalizeStoredBankBalanceValidation)
      .filter((item): item is StoredBankBalanceValidation => item !== null)
  } catch {
    return []
  }
}

function persistBankBalanceValidations(items: StoredBankBalanceValidation[]) {
  const directoryPath = path.dirname(BANK_BALANCE_VALIDATION_STORE_PATH)
  fs.mkdirSync(directoryPath, { recursive: true })

  const payload: StoredBankBalanceValidationFile = {
    version: 1,
    items,
  }

  fs.writeFileSync(BANK_BALANCE_VALIDATION_STORE_PATH, JSON.stringify(payload, null, 2), 'utf8')
}

function normalizeStoredBankBalanceValidation(value: unknown): StoredBankBalanceValidation | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const bankId = typeof item.bankId === 'string' ? (item.bankId as BankImportBankId) : null
  const validatedClosingBalance = Number(item.validatedClosingBalance)
  if (!bankId || !Number.isFinite(validatedClosingBalance)) {
    return null
  }

  return {
    bankId,
    sourceFileHash: cleanText(item.sourceFileHash),
    sourceFileName: cleanText(item.sourceFileName),
    cutoffDate: cleanText(item.cutoffDate),
    movementMinProcessingDate: cleanNullableDate(item.movementMinProcessingDate),
    movementMaxProcessingDate: cleanNullableDate(item.movementMaxProcessingDate),
    validatedClosingBalance: round2(validatedClosingBalance),
    validatedAtUtc: cleanText(item.validatedAtUtc),
    createdAtUtc: cleanText(item.createdAtUtc),
    updatedAtUtc: cleanText(item.updatedAtUtc),
  }
}

function cleanNullableDate(value: unknown) {
  const cleaned = cleanText(value)
  return cleaned || null
}

function cleanText(value: unknown) {
  return String(value ?? '').trim()
}

function round2(value: number) {
  return Math.round(value * 100) / 100
}
