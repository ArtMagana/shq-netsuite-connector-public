import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export type StoredEgresoConciliation = {
  id: string
  billInternalId: string
  billDocumentNumber: string
  supplierId: string | null
  supplierName: string | null
  supportInternalId: string
  supportDocumentNumber: string | null
  supportSource: 'vendor-credit' | 'journal' | 'payment' | 'prepayment' | 'mixed'
  supportAmount: number | null
  billTargetAmount: number | null
  billOpenAmount: number | null
  currency: string | null
  payableAccountNumber: string | null
  postingPeriodName: string | null
  statusCode: string
  operationalCode: string | null
  active: boolean
  createdAtUtc: string
  updatedAtUtc: string
}

type StoredEgresoConciliationStore = {
  version: 1
  items: StoredEgresoConciliation[]
}

const EGRESOS_CONCILIATION_STORE_PATH =
  process.env.EGRESOS_CONCILIATION_STORE_PATH?.trim() ||
  path.join(process.env.LOCALAPPDATA || process.cwd(), 'netsuite-recon', 'egresos-conciliations.json')

export function listActiveEgresoConciliations() {
  return readStoreItems().filter((item) => item.active)
}

export function upsertEgresoConciliation(
  input: Omit<StoredEgresoConciliation, 'id' | 'createdAtUtc' | 'updatedAtUtc' | 'active'>,
) {
  const items = readStoreItems()
  const now = new Date().toISOString()
  const existingIndex = items.findIndex(
    (item) =>
      item.billInternalId === input.billInternalId &&
      item.supportInternalId === input.supportInternalId,
  )

  const nextItem: StoredEgresoConciliation = {
    id: existingIndex >= 0 ? items[existingIndex].id : randomUUID(),
    createdAtUtc: existingIndex >= 0 ? items[existingIndex].createdAtUtc : now,
    updatedAtUtc: now,
    active: true,
    ...input,
  }

  if (existingIndex >= 0) {
    items[existingIndex] = nextItem
  } else {
    items.push(nextItem)
  }

  persistStoreItems(items)
  return nextItem
}

function readStoreItems() {
  if (!fs.existsSync(EGRESOS_CONCILIATION_STORE_PATH)) {
    return [] as StoredEgresoConciliation[]
  }

  try {
    const raw = fs.readFileSync(EGRESOS_CONCILIATION_STORE_PATH, 'utf8').replace(/^\uFEFF/u, '')
    const parsed = JSON.parse(raw) as Partial<StoredEgresoConciliationStore>
    if (!Array.isArray(parsed.items)) {
      return []
    }

    return parsed.items
      .map(normalizeStoredItem)
      .filter((item): item is StoredEgresoConciliation => item !== null)
  } catch {
    return []
  }
}

function persistStoreItems(items: StoredEgresoConciliation[]) {
  const directoryPath = path.dirname(EGRESOS_CONCILIATION_STORE_PATH)
  fs.mkdirSync(directoryPath, { recursive: true })
  const payload: StoredEgresoConciliationStore = {
    version: 1,
    items,
  }
  fs.writeFileSync(EGRESOS_CONCILIATION_STORE_PATH, JSON.stringify(payload, null, 2), 'utf8')
}

function normalizeStoredItem(value: unknown): StoredEgresoConciliation | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const billInternalId = cleanText(item.billInternalId)
  const supportInternalId = cleanText(item.supportInternalId)
  const billDocumentNumber = cleanText(item.billDocumentNumber)

  if (!billInternalId || !supportInternalId || !billDocumentNumber) {
    return null
  }

  return {
    id: cleanText(item.id) || randomUUID(),
    billInternalId,
    billDocumentNumber,
    supplierId: cleanText(item.supplierId) || null,
    supplierName: cleanText(item.supplierName) || null,
    supportInternalId,
    supportDocumentNumber: cleanText(item.supportDocumentNumber) || null,
    supportSource: normalizeSupportSource(item.supportSource),
    supportAmount: normalizeNullableNumber(item.supportAmount),
    billTargetAmount: normalizeNullableNumber(item.billTargetAmount),
    billOpenAmount: normalizeNullableNumber(item.billOpenAmount),
    currency: cleanText(item.currency) || null,
    payableAccountNumber: cleanText(item.payableAccountNumber) || null,
    postingPeriodName: cleanText(item.postingPeriodName) || null,
    statusCode: cleanText(item.statusCode) || 'E1',
    operationalCode: cleanText(item.operationalCode) || null,
    active: item.active !== false,
    createdAtUtc: cleanText(item.createdAtUtc),
    updatedAtUtc: cleanText(item.updatedAtUtc),
  }
}

function normalizeSupportSource(value: unknown): StoredEgresoConciliation['supportSource'] {
  switch (cleanText(value)) {
    case 'vendor-credit':
    case 'journal':
    case 'payment':
    case 'prepayment':
    case 'mixed':
      return cleanText(value) as StoredEgresoConciliation['supportSource']
    default:
      return 'mixed'
  }
}

function normalizeNullableNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}
