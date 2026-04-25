import fs from 'node:fs'
import path from 'node:path'

import type { BankImportBankId, BankImportMappingSheet } from './types.js'

type MappingSheetKey = BankImportMappingSheet['key']

export type StoredBankRecognitionOverride = {
  bankId: BankImportBankId
  sourceProfileId: string
  transactionType: string
  transactionDate: string
  amount: number
  counterpartyName: string | null
  trackingKey: string | null
  referenceNumber: string | null
  orderingPartyAccount: string | null
  originBankName: string | null
  destinationBankName: string | null
  netsuiteTransactionId: string
  netsuiteDocumentNumber: string | null
  netsuiteTransactionDate: string
  netsuiteTransactionType: string | null
  netsuiteEntityName: string | null
  netsuiteLineMemo: string | null
  netsuiteHeaderMemo: string | null
  mappingSheetKey: MappingSheetKey | null
  mappingSheetName: string | null
  creditAccount: string | null
  source: string
  createdAtUtc: string
  updatedAtUtc: string
}

type StoredBankRecognitionOverrideFile = {
  version: 1
  items: StoredBankRecognitionOverride[]
}

const OVERRIDE_STORE_PATH =
  process.env.BANKS_RECOGNITION_OVERRIDE_STORE_PATH?.trim() ||
  path.join(process.env.LOCALAPPDATA || process.cwd(), 'netsuite-recon', 'bank-recognition-overrides.json')

const SEEDED_RECOGNITION_OVERRIDES: StoredBankRecognitionOverride[] = [
  {
    bankId: 'clara_corriente',
    sourceProfileId: 'clara_account_activity',
    transactionType: 'DEPOSIT',
    transactionDate: '2026-04-07',
    amount: 500000,
    counterpartyName: 'SHQ Fondeo',
    trackingKey: '31621605000000004071452',
    referenceNumber: '75216',
    orderingPartyAccount: '646180569300100001',
    originBankName: 'STP',
    destinationBankName: 'STP',
    netsuiteTransactionId: '320942',
    netsuiteDocumentNumber: '28872',
    netsuiteTransactionDate: '2026-04-07',
    netsuiteTransactionType: 'Diario',
    netsuiteEntityName: 'CF Tech',
    netsuiteLineMemo: 'CF Tech',
    netsuiteHeaderMemo: 'Fondeo',
    mappingSheetKey: 'customers',
    mappingSheetName: 'Ingresos (Clientes)',
    creditAccount: null,
    source: 'seeded_manual_recognition',
    createdAtUtc: '2026-04-21T00:00:00.000Z',
    updatedAtUtc: '2026-04-21T00:00:00.000Z',
  },
]

export function loadBankRecognitionOverrides() {
  const fileItems = loadStoredBankRecognitionOverrides()
  return mergeOverrides([...SEEDED_RECOGNITION_OVERRIDES, ...fileItems])
}

export function findBankRecognitionOverride(input: {
  bankId: BankImportBankId
  sourceProfileId: string
  transactionType: string
  transactionDate: string
  amount: number
  counterpartyName?: string | null
  trackingKey?: string | null
  referenceNumber?: string | null
  orderingPartyAccount?: string | null
  originBankName?: string | null
  destinationBankName?: string | null
}) {
  const normalizedTransactionType = normalizeText(input.transactionType)
  const normalizedCounterpartyName = normalizeText(input.counterpartyName)
  const normalizedTrackingKey = compactText(input.trackingKey)
  const normalizedReferenceNumber = compactText(input.referenceNumber)
  const normalizedOrderingPartyAccount = cleanDigits(input.orderingPartyAccount)
  const normalizedOriginBankName = normalizeText(input.originBankName)
  const normalizedDestinationBankName = normalizeText(input.destinationBankName)

  return loadBankRecognitionOverrides()
    .filter(
      (item) =>
        item.bankId === input.bankId &&
        item.sourceProfileId === input.sourceProfileId &&
        normalizeText(item.transactionType) === normalizedTransactionType &&
        item.transactionDate === cleanText(input.transactionDate) &&
        amountsMatch(item.amount, input.amount),
    )
    .sort((left, right) => right.updatedAtUtc.localeCompare(left.updatedAtUtc))
    .find((item) => {
      const itemTrackingKey = compactText(item.trackingKey)
      if (normalizedTrackingKey && itemTrackingKey) {
        return normalizedTrackingKey === itemTrackingKey
      }

      const itemReferenceNumber = compactText(item.referenceNumber)
      if (normalizedReferenceNumber && itemReferenceNumber && normalizedReferenceNumber === itemReferenceNumber) {
        return true
      }

      const itemOrderingPartyAccount = cleanDigits(item.orderingPartyAccount)
      if (
        normalizedOrderingPartyAccount &&
        itemOrderingPartyAccount &&
        normalizedOrderingPartyAccount === itemOrderingPartyAccount
      ) {
        return true
      }

      return (
        normalizedCounterpartyName &&
        normalizeText(item.counterpartyName) === normalizedCounterpartyName &&
        normalizeText(item.originBankName) === normalizedOriginBankName &&
        normalizeText(item.destinationBankName) === normalizedDestinationBankName
      )
    })
}

export function upsertBankRecognitionOverride(
  input: Omit<StoredBankRecognitionOverride, 'createdAtUtc' | 'updatedAtUtc'>,
) {
  const currentItems = loadStoredBankRecognitionOverrides()
  const now = new Date().toISOString()
  const existingIndex = currentItems.findIndex(
    (item) =>
      item.bankId === input.bankId &&
      item.sourceProfileId === input.sourceProfileId &&
      item.transactionDate === input.transactionDate &&
      amountsMatch(item.amount, input.amount) &&
      compactText(item.trackingKey) === compactText(input.trackingKey) &&
      compactText(item.referenceNumber) === compactText(input.referenceNumber),
  )

  const nextItem: StoredBankRecognitionOverride = {
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

function loadStoredBankRecognitionOverrides() {
  if (!fs.existsSync(OVERRIDE_STORE_PATH)) {
    return [] as StoredBankRecognitionOverride[]
  }

  try {
    const raw = fs.readFileSync(OVERRIDE_STORE_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoredBankRecognitionOverrideFile>
    if (!Array.isArray(parsed.items)) {
      return []
    }

    return parsed.items
      .map(normalizeStoredOverride)
      .filter((item): item is StoredBankRecognitionOverride => item !== null)
  } catch {
    return []
  }
}

function persistOverrides(items: StoredBankRecognitionOverride[]) {
  const directoryPath = path.dirname(OVERRIDE_STORE_PATH)
  fs.mkdirSync(directoryPath, { recursive: true })

  const payload: StoredBankRecognitionOverrideFile = {
    version: 1,
    items,
  }

  fs.writeFileSync(OVERRIDE_STORE_PATH, JSON.stringify(payload, null, 2), 'utf8')
}

function normalizeStoredOverride(value: unknown): StoredBankRecognitionOverride | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const bankId = typeof item.bankId === 'string' ? (item.bankId as BankImportBankId) : null
  const sourceProfileId = cleanText(item.sourceProfileId)
  if (!bankId || !sourceProfileId) {
    return null
  }

  return {
    bankId,
    sourceProfileId,
    transactionType: cleanText(item.transactionType),
    transactionDate: cleanText(item.transactionDate),
    amount: parseAmount(item.amount),
    counterpartyName: cleanText(item.counterpartyName) || null,
    trackingKey: cleanText(item.trackingKey) || null,
    referenceNumber: cleanText(item.referenceNumber) || null,
    orderingPartyAccount: cleanDigits(item.orderingPartyAccount) || null,
    originBankName: cleanText(item.originBankName) || null,
    destinationBankName: cleanText(item.destinationBankName) || null,
    netsuiteTransactionId: cleanText(item.netsuiteTransactionId),
    netsuiteDocumentNumber: cleanText(item.netsuiteDocumentNumber) || null,
    netsuiteTransactionDate: cleanText(item.netsuiteTransactionDate),
    netsuiteTransactionType: cleanText(item.netsuiteTransactionType) || null,
    netsuiteEntityName: cleanText(item.netsuiteEntityName) || null,
    netsuiteLineMemo: cleanText(item.netsuiteLineMemo) || null,
    netsuiteHeaderMemo: cleanText(item.netsuiteHeaderMemo) || null,
    mappingSheetKey:
      item.mappingSheetKey === 'customers' || item.mappingSheetKey === 'suppliers'
        ? (item.mappingSheetKey as MappingSheetKey)
        : null,
    mappingSheetName: cleanText(item.mappingSheetName) || null,
    creditAccount: cleanText(item.creditAccount) || null,
    source: cleanText(item.source) || 'manual_override',
    createdAtUtc: cleanText(item.createdAtUtc),
    updatedAtUtc: cleanText(item.updatedAtUtc),
  }
}

function mergeOverrides(items: StoredBankRecognitionOverride[]) {
  const merged = new Map<string, StoredBankRecognitionOverride>()

  items.forEach((item) => {
    const key = [
      item.bankId,
      item.sourceProfileId,
      item.transactionType,
      item.transactionDate,
      round2(item.amount).toFixed(2),
      compactText(item.trackingKey),
      compactText(item.referenceNumber),
    ].join(':')
    const current = merged.get(key)
    if (!current || item.updatedAtUtc > current.updatedAtUtc) {
      merged.set(key, item)
    }
  })

  return Array.from(merged.values())
}

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeText(value: unknown) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
}

function compactText(value: unknown) {
  return normalizeText(value).replace(/[^A-Z0-9]/g, '')
}

function cleanDigits(value: unknown) {
  return String(value ?? '').replace(/\D+/g, '')
}

function parseAmount(value: unknown) {
  const normalized = Number(String(value ?? '').replace(/[,$\s]/g, ''))
  return Number.isFinite(normalized) ? round2(normalized) : 0
}

function round2(value: number) {
  return Math.round(value * 100) / 100
}

function amountsMatch(left: number, right: number) {
  return round2(left) === round2(right)
}
