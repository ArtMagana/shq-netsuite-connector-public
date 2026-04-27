import path from 'node:path'

import {
  createBackupFile,
  readJsonFile,
  writeJsonFileAtomic,
} from './infrastructure/storage/fileStoreUtils.js'
import type { BankImportBankId, BankImportMappingSheet } from './types.js'

type MappingSheetKey = BankImportMappingSheet['key']

export type StoredBankEquivalenceOverride = {
  bankId: BankImportBankId
  sourceProfileId: string
  mappingSheetKey: MappingSheetKey
  counterpartyName: string
  normalizedCounterpartyName: string
  compactCounterpartyName: string
  selectedBankName: string
  netsuiteName: string
  creditAccount: string
  createdAtUtc: string
  updatedAtUtc: string
}

type StoredBankEquivalenceOverrideFile = {
  version: 2
  items: StoredBankEquivalenceOverride[]
}

export function loadBankEquivalenceOverrides() {
  const parsed = readJsonFile<Partial<StoredBankEquivalenceOverrideFile>>(resolveOverrideStorePath(), {
    version: 2,
    items: [],
  })

  if (!Array.isArray(parsed.items)) {
    return []
  }

  return parsed.items
    .map(normalizeStoredOverride)
    .filter((item): item is StoredBankEquivalenceOverride => item !== null)
}

export function upsertBankEquivalenceOverride(
  input: Omit<StoredBankEquivalenceOverride, 'createdAtUtc' | 'updatedAtUtc'>,
) {
  const currentItems = loadBankEquivalenceOverrides()
  const now = new Date().toISOString()
  const existingIndex = currentItems.findIndex(
    (item) =>
      item.bankId === input.bankId &&
      item.sourceProfileId === input.sourceProfileId &&
      item.mappingSheetKey === input.mappingSheetKey &&
      item.normalizedCounterpartyName === input.normalizedCounterpartyName,
  )

  const nextItem: StoredBankEquivalenceOverride = {
    ...input,
    createdAtUtc: existingIndex >= 0 ? currentItems[existingIndex].createdAtUtc : now,
    updatedAtUtc: now,
  }

  const nextItems =
    existingIndex >= 0
      ? currentItems.map((item, index) => (index === existingIndex ? nextItem : item))
      : [...currentItems, nextItem]

  persistOverrides(nextItems)
  return nextItem
}

function persistOverrides(items: StoredBankEquivalenceOverride[]) {
  const payload: StoredBankEquivalenceOverrideFile = {
    version: 2,
    items,
  }
  const storePath = resolveOverrideStorePath()

  createBackupFile(storePath)
  writeJsonFileAtomic(storePath, payload)
}

function isStoredOverride(value: unknown): value is StoredBankEquivalenceOverride {
  if (!value || typeof value !== 'object') {
    return false
  }

  const item = value as Record<string, unknown>
  return (
    typeof item.bankId === 'string' &&
    typeof item.sourceProfileId === 'string' &&
    typeof item.mappingSheetKey === 'string' &&
    typeof item.counterpartyName === 'string' &&
    typeof item.normalizedCounterpartyName === 'string' &&
    typeof item.compactCounterpartyName === 'string' &&
    typeof item.selectedBankName === 'string' &&
    typeof item.netsuiteName === 'string' &&
    typeof item.creditAccount === 'string' &&
    typeof item.createdAtUtc === 'string' &&
    typeof item.updatedAtUtc === 'string'
  )
}

function normalizeStoredOverride(value: unknown): StoredBankEquivalenceOverride | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const bankId = typeof item.bankId === 'string' ? (item.bankId as BankImportBankId) : null
  const mappingSheetKey = typeof item.mappingSheetKey === 'string' ? (item.mappingSheetKey as MappingSheetKey) : null
  if (!bankId || !mappingSheetKey) {
    return null
  }

  const sourceProfileId =
    typeof item.sourceProfileId === 'string' && item.sourceProfileId.trim().length > 0
      ? item.sourceProfileId.trim()
      : resolveLegacySourceProfileId(bankId, mappingSheetKey)

  const normalized: StoredBankEquivalenceOverride = {
    bankId,
    sourceProfileId,
    mappingSheetKey,
    counterpartyName: String(item.counterpartyName ?? ''),
    normalizedCounterpartyName: String(item.normalizedCounterpartyName ?? ''),
    compactCounterpartyName: String(item.compactCounterpartyName ?? ''),
    selectedBankName: String(item.selectedBankName ?? ''),
    netsuiteName: String(item.netsuiteName ?? ''),
    creditAccount: String(item.creditAccount ?? ''),
    createdAtUtc: String(item.createdAtUtc ?? ''),
    updatedAtUtc: String(item.updatedAtUtc ?? ''),
  }

  return isStoredOverride(normalized) ? normalized : null
}

function resolveLegacySourceProfileId(bankId: BankImportBankId, mappingSheetKey: MappingSheetKey) {
  if (bankId === 'clara_corriente') {
    return mappingSheetKey === 'suppliers' ? 'clara_payments' : 'clara_account_activity'
  }

  if (bankId === 'bbva') {
    return 'bbva_pdf'
  }

  return 'payana_transacciones'
}

function resolveOverrideStorePath() {
  return (
    process.env.BANKS_EQUIVALENCE_OVERRIDE_STORE_PATH?.trim() ||
    path.join(process.env.LOCALAPPDATA || process.cwd(), 'netsuite-recon', 'bank-equivalence-overrides.json')
  )
}
