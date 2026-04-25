import fs from 'node:fs'
import path from 'node:path'

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

const OVERRIDE_STORE_PATH =
  process.env.BANKS_EQUIVALENCE_OVERRIDE_STORE_PATH?.trim() ||
  path.join(process.env.LOCALAPPDATA || process.cwd(), 'netsuite-recon', 'bank-equivalence-overrides.json')

export function loadBankEquivalenceOverrides() {
  if (!fs.existsSync(OVERRIDE_STORE_PATH)) {
    return []
  }

  try {
    const raw = fs.readFileSync(OVERRIDE_STORE_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoredBankEquivalenceOverrideFile>
    if (!Array.isArray(parsed.items)) {
      return []
    }

    return parsed.items
      .map(normalizeStoredOverride)
      .filter((item): item is StoredBankEquivalenceOverride => item !== null)
  } catch {
    return []
  }
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
  const directoryPath = path.dirname(OVERRIDE_STORE_PATH)
  fs.mkdirSync(directoryPath, { recursive: true })

  const payload: StoredBankEquivalenceOverrideFile = {
    version: 2,
    items,
  }

  fs.writeFileSync(OVERRIDE_STORE_PATH, JSON.stringify(payload, null, 2), 'utf8')
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
