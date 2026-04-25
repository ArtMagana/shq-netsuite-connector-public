import fs from 'node:fs'
import path from 'node:path'

import type { BanxicoCepTransferDetails } from './banxico.js'
import type { BankImportBankId } from './types.js'

export type StoredBanxicoCepRecognition = {
  bankId: BankImportBankId
  sourceProfileId: string
  operationDate: string
  issuerId: string | null
  receiverId: string | null
  beneficiaryAccount: string
  amount: string
  trackingKey: string | null
  referenceNumber: string | null
  orderingPartyName: string | null
  orderingPartyRfc: string | null
  orderingPartyAccount: string | null
  orderingPartyBankName: string | null
  beneficiaryName: string | null
  beneficiaryRfc: string | null
  beneficiaryBankName: string | null
  source: string
  createdAtUtc: string
  updatedAtUtc: string
}

type StoredBanxicoCepRecognitionFile = {
  version: 2
  items: StoredBanxicoCepRecognition[]
}

const BANXICO_CEP_RECOGNITION_STORE_PATH =
  process.env.BANXICO_CEP_RECOGNITION_STORE_PATH?.trim() ||
  path.join(process.env.LOCALAPPDATA || process.cwd(), 'netsuite-recon', 'banxico-cep-recognitions.json')

export function loadBanxicoCepRecognitions() {
  if (!fs.existsSync(BANXICO_CEP_RECOGNITION_STORE_PATH)) {
    return [] as StoredBanxicoCepRecognition[]
  }

  try {
    const raw = fs.readFileSync(BANXICO_CEP_RECOGNITION_STORE_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoredBanxicoCepRecognitionFile>
    if (!Array.isArray(parsed.items)) {
      return []
    }

    return parsed.items
      .map(normalizeStoredBanxicoCepRecognition)
      .filter((item): item is StoredBanxicoCepRecognition => item !== null)
  } catch {
    return []
  }
}

export function findBanxicoCepRecognition(input: {
  bankId?: BankImportBankId | null
  sourceProfileId?: string | null
  operationDate: string
  issuerId?: string | null
  receiverId?: string | null
  beneficiaryAccount: string
  amount: string
  trackingKey?: string | null
  referenceNumber?: string | null
}) {
  const lookupKeys = buildBanxicoCepLookupKeys(input.trackingKey ?? null, input.referenceNumber ?? null)
  if (lookupKeys.size === 0) {
    return null
  }

  const normalizedOperationDate = cleanText(input.operationDate)
  const normalizedBankId = normalizeBankId(input.bankId)
  const normalizedSourceProfileId = cleanText(input.sourceProfileId)
  const normalizedIssuerId = cleanText(input.issuerId)
  const normalizedReceiverId = cleanText(input.receiverId)
  const normalizedBeneficiaryAccount = cleanDigits(input.beneficiaryAccount)
  const normalizedAmount = normalizeAmount(input.amount)
  if (!normalizedOperationDate || !normalizedBeneficiaryAccount || !normalizedAmount) {
    return null
  }

  const candidates = loadBanxicoCepRecognitions()
    .filter(
      (item) =>
        (!normalizedBankId || item.bankId === normalizedBankId) &&
        (!normalizedSourceProfileId || item.sourceProfileId === normalizedSourceProfileId) &&
        item.operationDate === normalizedOperationDate &&
        item.beneficiaryAccount === normalizedBeneficiaryAccount &&
        item.amount === normalizedAmount &&
        (!normalizedIssuerId || item.issuerId === normalizedIssuerId) &&
        (!normalizedReceiverId || item.receiverId === normalizedReceiverId) &&
        hasSharedBanxicoCepLookupKey(item, lookupKeys),
    )
    .sort((left, right) => right.updatedAtUtc.localeCompare(left.updatedAtUtc))

  return candidates[0] ?? null
}

export function upsertBanxicoCepRecognition(input: {
  bankId?: BankImportBankId | null
  sourceProfileId?: string | null
  operationDate: string
  issuerId?: string | null
  receiverId?: string | null
  beneficiaryAccount: string
  amount: string
  trackingKey?: string | null
  referenceNumber?: string | null
  details: BanxicoCepTransferDetails
  source?: string | null
}) {
  const operationDate = cleanText(input.operationDate)
  const bankId = normalizeBankId(input.bankId) ?? 'clara_corriente'
  const sourceProfileId = cleanText(input.sourceProfileId) || resolveDefaultSourceProfileId(bankId)
  const beneficiaryAccount = cleanDigits(input.beneficiaryAccount)
  const amount = normalizeAmount(input.amount)
  if (!operationDate || !beneficiaryAccount || !amount) {
    return null
  }

  const trackingKey = cleanText(input.details.trackingKey) || cleanText(input.trackingKey) || null
  const referenceNumber = cleanText(input.referenceNumber) || null
  const now = new Date().toISOString()
  const currentItems = loadBanxicoCepRecognitions()
  const lookupKeys = buildBanxicoCepLookupKeys(trackingKey, referenceNumber)
  const existingIndex = currentItems.findIndex(
    (item) =>
      item.bankId === bankId &&
      item.sourceProfileId === sourceProfileId &&
      item.operationDate === operationDate &&
      item.beneficiaryAccount === beneficiaryAccount &&
      item.amount === amount &&
      hasSharedBanxicoCepLookupKey(item, lookupKeys),
  )

  const nextItem: StoredBanxicoCepRecognition = {
    bankId,
    sourceProfileId,
    operationDate,
    issuerId: cleanText(input.issuerId) || null,
    receiverId: cleanText(input.receiverId) || null,
    beneficiaryAccount,
    amount,
    trackingKey,
    referenceNumber,
    orderingPartyName: cleanText(input.details.orderingParty?.name) || null,
    orderingPartyRfc: cleanText(input.details.orderingParty?.rfc) || null,
    orderingPartyAccount: cleanDigits(input.details.orderingParty?.account) || null,
    orderingPartyBankName: cleanText(input.details.orderingParty?.bankName) || null,
    beneficiaryName: cleanText(input.details.beneficiary?.name) || null,
    beneficiaryRfc: cleanText(input.details.beneficiary?.rfc) || null,
    beneficiaryBankName: cleanText(input.details.beneficiary?.bankName) || null,
    source: cleanText(input.source) || 'banxico_cep',
    createdAtUtc: existingIndex >= 0 ? currentItems[existingIndex].createdAtUtc : now,
    updatedAtUtc: now,
  }

  const nextItems =
    existingIndex >= 0
      ? currentItems.map((item, index) => (index === existingIndex ? nextItem : item))
      : [...currentItems, nextItem]

  persistBanxicoCepRecognitions(nextItems)
  return nextItem
}

function persistBanxicoCepRecognitions(items: StoredBanxicoCepRecognition[]) {
  const directoryPath = path.dirname(BANXICO_CEP_RECOGNITION_STORE_PATH)
  fs.mkdirSync(directoryPath, { recursive: true })

  const payload: StoredBanxicoCepRecognitionFile = {
    version: 2,
    items,
  }

  fs.writeFileSync(BANXICO_CEP_RECOGNITION_STORE_PATH, JSON.stringify(payload, null, 2), 'utf8')
}

function normalizeStoredBanxicoCepRecognition(value: unknown): StoredBanxicoCepRecognition | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const bankId = normalizeBankId(item.bankId) ?? 'clara_corriente'
  const sourceProfileId = cleanText(item.sourceProfileId) || resolveDefaultSourceProfileId(bankId)
  const normalized: StoredBanxicoCepRecognition = {
    bankId,
    sourceProfileId,
    operationDate: cleanText(item.operationDate),
    issuerId: cleanText(item.issuerId) || null,
    receiverId: cleanText(item.receiverId) || null,
    beneficiaryAccount: cleanDigits(item.beneficiaryAccount),
    amount: normalizeAmount(item.amount),
    trackingKey: cleanText(item.trackingKey) || null,
    referenceNumber: cleanText(item.referenceNumber) || null,
    orderingPartyName: cleanText(item.orderingPartyName) || null,
    orderingPartyRfc: cleanText(item.orderingPartyRfc) || null,
    orderingPartyAccount: cleanDigits(item.orderingPartyAccount) || null,
    orderingPartyBankName: cleanText(item.orderingPartyBankName) || null,
    beneficiaryName: cleanText(item.beneficiaryName) || null,
    beneficiaryRfc: cleanText(item.beneficiaryRfc) || null,
    beneficiaryBankName: cleanText(item.beneficiaryBankName) || null,
    source: cleanText(item.source) || 'banxico_cep',
    createdAtUtc: cleanText(item.createdAtUtc),
    updatedAtUtc: cleanText(item.updatedAtUtc),
  }

  return isStoredBanxicoCepRecognition(normalized) ? normalized : null
}

function isStoredBanxicoCepRecognition(value: unknown): value is StoredBanxicoCepRecognition {
  if (!value || typeof value !== 'object') {
    return false
  }

  const item = value as Record<string, unknown>
  return (
    typeof item.bankId === 'string' &&
    typeof item.sourceProfileId === 'string' &&
    typeof item.operationDate === 'string' &&
    typeof item.beneficiaryAccount === 'string' &&
    typeof item.amount === 'string' &&
    (item.issuerId === null || typeof item.issuerId === 'string') &&
    (item.receiverId === null || typeof item.receiverId === 'string') &&
    (item.trackingKey === null || typeof item.trackingKey === 'string') &&
    (item.referenceNumber === null || typeof item.referenceNumber === 'string') &&
    (item.orderingPartyName === null || typeof item.orderingPartyName === 'string') &&
    (item.orderingPartyRfc === null || typeof item.orderingPartyRfc === 'string') &&
    (item.orderingPartyAccount === null || typeof item.orderingPartyAccount === 'string') &&
    (item.orderingPartyBankName === null || typeof item.orderingPartyBankName === 'string') &&
    (item.beneficiaryName === null || typeof item.beneficiaryName === 'string') &&
    (item.beneficiaryRfc === null || typeof item.beneficiaryRfc === 'string') &&
    (item.beneficiaryBankName === null || typeof item.beneficiaryBankName === 'string') &&
    typeof item.source === 'string' &&
    typeof item.createdAtUtc === 'string' &&
    typeof item.updatedAtUtc === 'string'
  )
}

function hasSharedBanxicoCepLookupKey(
  item: Pick<StoredBanxicoCepRecognition, 'trackingKey' | 'referenceNumber'>,
  lookupKeys: Set<string>,
) {
  return Array.from(buildBanxicoCepLookupKeys(item.trackingKey, item.referenceNumber)).some((key) => lookupKeys.has(key))
}

function buildBanxicoCepLookupKeys(trackingKey: string | null, referenceNumber: string | null) {
  const lookupKeys = new Set<string>()
  const cleanedTrackingKey = compactText(trackingKey)
  const cleanedReferenceNumber = compactText(referenceNumber)

  if (cleanedTrackingKey) {
    lookupKeys.add(`tracking:${cleanedTrackingKey}`)
  }

  if (cleanedReferenceNumber) {
    lookupKeys.add(`reference:${cleanedReferenceNumber}`)
  }

  return lookupKeys
}

function normalizeBankId(value: unknown): BankImportBankId | null {
  return value === 'payana' || value === 'clara_corriente' || value === 'bbva' ? value : null
}

function resolveDefaultSourceProfileId(bankId: BankImportBankId) {
  switch (bankId) {
    case 'bbva':
      return 'bbva_pdf'
    case 'clara_corriente':
      return 'clara_account_activity'
    default:
      return 'payana_transacciones'
  }
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim()
}

function compactText(value: unknown) {
  return cleanText(value).replace(/[^A-Za-z0-9]+/g, '').toUpperCase()
}

function cleanDigits(value: unknown) {
  return cleanText(value).replace(/[^\d]/g, '')
}

function normalizeAmount(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toFixed(2)
  }

  const cleaned = cleanText(value)
  if (!cleaned) {
    return ''
  }

  const numericValue = Number(cleaned.replace(/,/g, ''))
  return Number.isFinite(numericValue) ? numericValue.toFixed(2) : ''
}
