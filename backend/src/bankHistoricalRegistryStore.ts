import fs from 'node:fs'
import path from 'node:path'

import type { BankImportBankId, BankImportMappingSheet } from './types.js'

type MappingSheetKey = BankImportMappingSheet['key']

export type StoredBankHistoricalRecognition = {
  bankId: BankImportBankId
  sourceProfileId: string
  sourceFileName: string
  sourceDigest: string
  transactionType: string
  mappingSheetKey: MappingSheetKey
  mappingSheetName: string
  transactionDate: string
  processingTimestamp: string
  counterpartyName: string
  paymentConcept: string | null
  trackingKey: string | null
  referenceNumber: string | null
  hashId: string | null
  amount: number
  netsuiteName: string
  creditAccount: string
  netsuiteTransactionId: string | null
  netsuiteDocumentNumber: string | null
  createdAtUtc: string
  updatedAtUtc: string
}

type StoredBankHistoricalRecognitionFile = {
  version: 1
  items: StoredBankHistoricalRecognition[]
}

export type BankHistoricalRegistrySummary = {
  bankId: BankImportBankId
  enabled: boolean
  statementCount: number
  recognizedRowCount: number
  referenceCount: number
  lastUpdatedAtUtc: string | null
}

const HISTORICAL_REGISTRY_STORE_PATH =
  process.env.BANKS_HISTORICAL_REGISTRY_STORE_PATH?.trim() ||
  path.join(process.env.LOCALAPPDATA || process.cwd(), 'netsuite-recon', 'bank-historical-recognitions.json')

export function loadBankHistoricalRecognitions(bankId?: BankImportBankId) {
  const items = readHistoricalRecognitionItems()
  return bankId ? items.filter((item) => item.bankId === bankId) : items
}

export function isBankHistoricalRecognitionCorroborated(
  item: Pick<StoredBankHistoricalRecognition, 'netsuiteTransactionId' | 'netsuiteDocumentNumber'>,
) {
  return Boolean(getNullableString(item.netsuiteTransactionId) || getNullableString(item.netsuiteDocumentNumber))
}

export function upsertBankHistoricalRecognitions(
  inputs: Array<Omit<StoredBankHistoricalRecognition, 'createdAtUtc' | 'updatedAtUtc'>>,
) {
  const persistableInputs = inputs.map(sanitizeHistoricalRecognition).filter(isPersistableHistoricalRecognition)
  if (persistableInputs.length === 0) {
    return {
      inserted: 0,
      updated: 0,
      items: readHistoricalRecognitionItems(),
    }
  }

  const currentItems = readHistoricalRecognitionItems()
  const nextItems = [...currentItems]
  const now = new Date().toISOString()
  let inserted = 0
  let updated = 0

  persistableInputs.forEach((input) => {
    const existingIndex = nextItems.findIndex((item) => buildHistoricalRecognitionKey(item) === buildHistoricalRecognitionKey(input))
    const nextItem: StoredBankHistoricalRecognition = {
      ...input,
      createdAtUtc: existingIndex >= 0 ? nextItems[existingIndex].createdAtUtc : now,
      updatedAtUtc: now,
    }

    if (existingIndex >= 0) {
      nextItems[existingIndex] = nextItem
      updated += 1
      return
    }

    nextItems.push(nextItem)
    inserted += 1
  })

  persistHistoricalRecognitionItems(nextItems)
  return {
    inserted,
    updated,
    items: nextItems,
  }
}

export function getBankHistoricalRegistrySummary(bankId: BankImportBankId): BankHistoricalRegistrySummary {
  const items = loadBankHistoricalRecognitions(bankId).filter(isBankHistoricalRecognitionCorroborated)
  const lastUpdatedAtUtc =
    items.length > 0
      ? items
          .map((item) => item.updatedAtUtc)
          .sort((left, right) => right.localeCompare(left))[0] ?? null
      : null

  return {
    bankId,
    enabled: bankId === 'bbva',
    statementCount: new Set(items.map((item) => item.sourceDigest)).size,
    recognizedRowCount: items.length,
    referenceCount: new Set(items.flatMap((item) => buildHistoricalSummaryReferenceKeys(item))).size,
    lastUpdatedAtUtc,
  }
}

function readHistoricalRecognitionItems() {
  if (!fs.existsSync(HISTORICAL_REGISTRY_STORE_PATH)) {
    return [] as StoredBankHistoricalRecognition[]
  }

  try {
    const raw = fs.readFileSync(HISTORICAL_REGISTRY_STORE_PATH, 'utf8').replace(/^\uFEFF/u, '')
    const parsed = JSON.parse(raw) as Partial<StoredBankHistoricalRecognitionFile>
    if (!Array.isArray(parsed.items)) {
      return []
    }

    return parsed.items
      .map(normalizeStoredHistoricalRecognition)
      .filter((item): item is StoredBankHistoricalRecognition => item !== null)
      .map(sanitizeHistoricalRecognition)
      .filter(isPersistableHistoricalRecognition)
  } catch {
    return []
  }
}

function persistHistoricalRecognitionItems(items: StoredBankHistoricalRecognition[]) {
  const directoryPath = path.dirname(HISTORICAL_REGISTRY_STORE_PATH)
  fs.mkdirSync(directoryPath, { recursive: true })

  const payload: StoredBankHistoricalRecognitionFile = {
    version: 1,
    items,
  }

  fs.writeFileSync(HISTORICAL_REGISTRY_STORE_PATH, JSON.stringify(payload, null, 2), 'utf8')
}

function normalizeStoredHistoricalRecognition(value: unknown): StoredBankHistoricalRecognition | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const bankId = typeof item.bankId === 'string' ? (item.bankId as BankImportBankId) : null
  const mappingSheetKey = typeof item.mappingSheetKey === 'string' ? (item.mappingSheetKey as MappingSheetKey) : null
  if (!bankId || !mappingSheetKey) {
    return null
  }

  const normalized: StoredBankHistoricalRecognition = {
    bankId,
    sourceProfileId: getStringValue(item.sourceProfileId),
    sourceFileName: getStringValue(item.sourceFileName),
    sourceDigest: getStringValue(item.sourceDigest),
    transactionType: getStringValue(item.transactionType),
    mappingSheetKey,
    mappingSheetName: getStringValue(item.mappingSheetName),
    transactionDate: getStringValue(item.transactionDate),
    processingTimestamp: getStringValue(item.processingTimestamp),
    counterpartyName: getStringValue(item.counterpartyName),
    paymentConcept: getNullableString(item.paymentConcept),
    trackingKey: getNullableString(item.trackingKey),
    referenceNumber: getNullableString(item.referenceNumber),
    hashId: getNullableString(item.hashId),
    amount: normalizeAmount(item.amount),
    netsuiteName: getStringValue(item.netsuiteName),
    creditAccount: getStringValue(item.creditAccount),
    netsuiteTransactionId: getNullableString(item.netsuiteTransactionId),
    netsuiteDocumentNumber: getNullableString(item.netsuiteDocumentNumber),
    createdAtUtc: getStringValue(item.createdAtUtc),
    updatedAtUtc: getStringValue(item.updatedAtUtc),
  }

  return isStoredHistoricalRecognition(normalized) ? normalized : null
}

function isStoredHistoricalRecognition(value: unknown): value is StoredBankHistoricalRecognition {
  if (!value || typeof value !== 'object') {
    return false
  }

  const item = value as Record<string, unknown>
  return (
    typeof item.bankId === 'string' &&
    typeof item.sourceProfileId === 'string' &&
    typeof item.sourceFileName === 'string' &&
    typeof item.sourceDigest === 'string' &&
    typeof item.transactionType === 'string' &&
    typeof item.mappingSheetKey === 'string' &&
    typeof item.mappingSheetName === 'string' &&
    typeof item.transactionDate === 'string' &&
    typeof item.processingTimestamp === 'string' &&
    typeof item.counterpartyName === 'string' &&
    (item.paymentConcept === null || typeof item.paymentConcept === 'string') &&
    (item.trackingKey === null || typeof item.trackingKey === 'string') &&
    (item.referenceNumber === null || item.referenceNumber === undefined || typeof item.referenceNumber === 'string') &&
    (item.hashId === null || typeof item.hashId === 'string') &&
    typeof item.amount === 'number' &&
    Number.isFinite(item.amount) &&
    typeof item.netsuiteName === 'string' &&
    typeof item.creditAccount === 'string' &&
    (item.netsuiteTransactionId === null || typeof item.netsuiteTransactionId === 'string') &&
    (item.netsuiteDocumentNumber === null || typeof item.netsuiteDocumentNumber === 'string') &&
    typeof item.createdAtUtc === 'string' &&
    typeof item.updatedAtUtc === 'string'
  )
}

function buildHistoricalRecognitionKey(
  item: Omit<StoredBankHistoricalRecognition, 'createdAtUtc' | 'updatedAtUtc'> | StoredBankHistoricalRecognition,
) {
  const primaryReferenceKey = buildHistoricalReferenceKeys(item)[0] ?? `hash:${normalizeReference(item.hashId) || ''}`
  return [
    item.bankId,
    item.sourceProfileId,
    item.mappingSheetKey,
    item.transactionDate,
    item.amount.toFixed(2),
    primaryReferenceKey,
    normalizeReference(item.netsuiteName),
    normalizeReference(item.creditAccount),
  ].join('|')
}

function buildHistoricalReferenceKeys(
  item: Pick<StoredBankHistoricalRecognition, 'bankId' | 'trackingKey' | 'referenceNumber'>,
) {
  const keys = new Set<string>()
  const trackingKey = normalizeReference(item.trackingKey)
  const referenceNumber = normalizeReference(item.referenceNumber)

  if (trackingKey && (item.bankId !== 'bbva' || isBbvaStableHistoricalTrackingKey(trackingKey))) {
    keys.add(`tracking:${trackingKey}`)
  }

  if (referenceNumber && (item.bankId !== 'bbva' || isBbvaStableHistoricalReferenceNumber(referenceNumber))) {
    keys.add(`reference:${referenceNumber}`)
  }

  return Array.from(keys)
}

function buildHistoricalSummaryReferenceKeys(
  item: Pick<StoredBankHistoricalRecognition, 'bankId' | 'trackingKey' | 'referenceNumber'>,
) {
  const keys = new Set<string>()
  const trackingKey = normalizeReference(item.trackingKey)
  const referenceNumber = normalizeReference(item.referenceNumber)

  if (trackingKey && (item.bankId !== 'bbva' || isBbvaStableHistoricalTrackingKey(trackingKey))) {
    keys.add(`tracking:${trackingKey}`)
  }

  if (referenceNumber && (item.bankId !== 'bbva' || isBbvaStableHistoricalReferenceNumber(referenceNumber))) {
    keys.add(`reference:${referenceNumber}`)
  }

  return Array.from(keys)
}

function isBbvaStableHistoricalTrackingKey(value: string | null | undefined) {
  return /^(?:REF)?BNTC[0-9A-Z]+$/iu.test(normalizeReference(value) ?? '')
}

function isBbvaStableHistoricalReferenceNumber(value: string | null | undefined) {
  return /^[0-9]{10,}$/u.test(String(value ?? '').replace(/\D+/g, ''))
}

function isPersistableHistoricalRecognition(
  item: Pick<StoredBankHistoricalRecognition, 'bankId' | 'trackingKey' | 'referenceNumber'>,
) {
  return item.bankId !== 'bbva' || buildHistoricalReferenceKeys(item).length > 0
}

function sanitizeHistoricalRecognition<T extends Pick<StoredBankHistoricalRecognition, 'bankId' | 'trackingKey' | 'referenceNumber'>>(
  item: T,
) {
  if (item.bankId !== 'bbva') {
    return item
  }

  const trackingKey = isBbvaStableHistoricalTrackingKey(item.trackingKey) ? normalizeReference(item.trackingKey) : null
  const referenceNumber = isBbvaStableHistoricalReferenceNumber(item.referenceNumber)
    ? String(item.referenceNumber ?? '').replace(/\D+/g, '')
    : null

  return {
    ...item,
    trackingKey,
    referenceNumber,
  } as T
}

function normalizeReference(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().toUpperCase() : null
}

function getStringValue(value: unknown) {
  return typeof value === 'string' ? value : String(value ?? '')
}

function getNullableString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function normalizeAmount(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}
