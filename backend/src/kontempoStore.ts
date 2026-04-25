import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type StoredKontempoCustomerHomologation = {
  matchKey: string
  kontempoCustomerId: string | null
  kontempoBuyerId: string | null
  companyName: string | null
  normalizedCompanyName: string | null
  customerName: string | null
  normalizedCustomerName: string | null
  netsuiteCustomerId: string
  netsuiteCustomerName: string
  netsuiteCustomerEntityId: string | null
  confidence: string
  evidenceOrderIds: string[]
  createdAtUtc: string
  updatedAtUtc: string
}

export type StoredKontempoInvoiceRecognition = {
  recognitionKey: string
  orderId: string
  transferId: string | null
  transferIdFragment: string | null
  transferDate: string | null
  transferAmount: number | null
  transferCurrency: string | null
  groupedOrderCount: number
  groupedOrderIds: string[]
  groupedGrossAmount: number | null
  groupedCommissionAmount: number | null
  groupedNetDisbursementAmount: number | null
  kontempoCustomerId: string | null
  kontempoBuyerId: string | null
  companyName: string | null
  customerName: string | null
  netsuiteCustomerId: string
  netsuiteCustomerName: string
  invoiceInternalId: string
  invoiceDocument: string | null
  invoiceDate: string | null
  invoiceAmount: number | null
  salesOrderInternalId: string | null
  salesOrderDocument: string | null
  salesOrderDate: string | null
  salesOrderAmount: number | null
  orderGrossAmount: number | null
  orderCommissionAmount: number | null
  orderNetDisbursementAmount: number | null
  journalTransactionId: string | null
  journalDocument: string | null
  journalDate: string | null
  journalPeriodId: string | null
  journalPeriodName: string | null
  journalAmount: number | null
  journalMemo: string | null
  status: 'matched' | 'pending_journal' | 'pending_invoice' | 'manual_review'
  sourceOrdersDigest: string
  sourceTransfersDigest: string
  createdAtUtc: string
  updatedAtUtc: string
}

export type StoredKontempoImportRun = {
  id: string
  sourceOrdersPath: string
  sourceTransfersPath: string
  sourceOrdersDigest: string
  sourceTransfersDigest: string
  generatedAtUtc: string
  counts: {
    orderRows: number
    orderRows2026: number
    transferRows: number
    transferGroups: number
    customerMatched: number
    invoiceMatched: number
    journalMatched: number
    recognizedInvoices: number
  }
}

type StoredKontempoStore = {
  version: 1
  customerHomologations: StoredKontempoCustomerHomologation[]
  invoiceRecognitions: StoredKontempoInvoiceRecognition[]
  importRuns: StoredKontempoImportRun[]
}

const DEFAULT_KONTEMPO_STORE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'storage',
  'kontempo-store.json',
)

const KONTEMPO_STORE_PATH =
  process.env.KONTEMPO_STORE_PATH?.trim() || DEFAULT_KONTEMPO_STORE_PATH

let kontempoStoreCache: StoredKontempoStore | null = null

function createEmptyKontempoStore(): StoredKontempoStore {
  return {
    version: 1,
    customerHomologations: [],
    invoiceRecognitions: [],
    importRuns: [],
  }
}

function readKontempoStore() {
  if (kontempoStoreCache) {
    return kontempoStoreCache
  }

  if (!fs.existsSync(KONTEMPO_STORE_PATH)) {
    kontempoStoreCache = createEmptyKontempoStore()
    return kontempoStoreCache
  }

  try {
    const raw = fs.readFileSync(KONTEMPO_STORE_PATH, 'utf8').replace(/^\uFEFF/u, '')
    const parsed = JSON.parse(raw) as Partial<StoredKontempoStore>
    const store: StoredKontempoStore = {
      version: 1,
      customerHomologations: Array.isArray(parsed.customerHomologations)
        ? parsed.customerHomologations
            .map(normalizeCustomerHomologation)
            .filter((item): item is StoredKontempoCustomerHomologation => item !== null)
        : [],
      invoiceRecognitions: Array.isArray(parsed.invoiceRecognitions)
        ? parsed.invoiceRecognitions
            .map(normalizeInvoiceRecognition)
            .filter((item): item is StoredKontempoInvoiceRecognition => item !== null)
        : [],
      importRuns: Array.isArray(parsed.importRuns)
        ? parsed.importRuns.map(normalizeImportRun).filter((item): item is StoredKontempoImportRun => item !== null)
        : [],
    }

    kontempoStoreCache = store
    return store
  } catch {
    kontempoStoreCache = createEmptyKontempoStore()
    return kontempoStoreCache
  }
}

function persistKontempoStore(store: StoredKontempoStore) {
  const directoryPath = path.dirname(KONTEMPO_STORE_PATH)
  fs.mkdirSync(directoryPath, { recursive: true })
  fs.writeFileSync(KONTEMPO_STORE_PATH, JSON.stringify(store, null, 2), 'utf8')
  kontempoStoreCache = store
}

export function getKontempoStorePath() {
  return KONTEMPO_STORE_PATH
}

export function loadKontempoCustomerHomologations() {
  return readKontempoStore().customerHomologations.map((item) => ({ ...item, evidenceOrderIds: [...item.evidenceOrderIds] }))
}

export function loadKontempoInvoiceRecognitions() {
  return readKontempoStore().invoiceRecognitions.map((item) => ({
    ...item,
    groupedOrderIds: [...item.groupedOrderIds],
  }))
}

export function listKontempoStoreStatus() {
  const store = readKontempoStore()
  return {
    generatedAtUtc: new Date().toISOString(),
    storePath: KONTEMPO_STORE_PATH,
    counts: {
      customerHomologations: store.customerHomologations.length,
      invoiceRecognitions: store.invoiceRecognitions.length,
      matchedRecognitions: store.invoiceRecognitions.filter((item) => item.status === 'matched').length,
      pendingInvoiceRecognitions: store.invoiceRecognitions.filter((item) => item.status === 'pending_invoice').length,
      pendingJournalRecognitions: store.invoiceRecognitions.filter((item) => item.status === 'pending_journal').length,
      manualReviewRecognitions: store.invoiceRecognitions.filter((item) => item.status === 'manual_review').length,
      importRuns: store.importRuns.length,
    },
    lastImportRun: store.importRuns[0] ?? null,
  }
}

export function upsertKontempoCustomerHomologations(
  inputs: Array<Omit<StoredKontempoCustomerHomologation, 'createdAtUtc' | 'updatedAtUtc'>>,
) {
  const store = readKontempoStore()
  const nextItems = [...store.customerHomologations]
  const now = new Date().toISOString()
  let inserted = 0
  let updated = 0

  inputs.forEach((input) => {
    const existingIndex = nextItems.findIndex((item) => item.matchKey === input.matchKey)
    const nextItem: StoredKontempoCustomerHomologation = {
      ...input,
      evidenceOrderIds: [...new Set(input.evidenceOrderIds)].sort((left, right) => left.localeCompare(right, 'es')),
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
  })

  nextItems.sort((left, right) => left.matchKey.localeCompare(right.matchKey, 'es'))
  store.customerHomologations = nextItems
  persistKontempoStore(store)

  return {
    inserted,
    updated,
    items: nextItems.map((item) => ({ ...item, evidenceOrderIds: [...item.evidenceOrderIds] })),
  }
}

export function upsertKontempoInvoiceRecognitions(
  inputs: Array<Omit<StoredKontempoInvoiceRecognition, 'createdAtUtc' | 'updatedAtUtc'>>,
) {
  const store = readKontempoStore()
  const nextItems = [...store.invoiceRecognitions]
  const now = new Date().toISOString()
  let inserted = 0
  let updated = 0

  inputs.forEach((input) => {
    const existingIndex = nextItems.findIndex((item) => item.recognitionKey === input.recognitionKey)
    const nextItem: StoredKontempoInvoiceRecognition = {
      ...input,
      groupedOrderIds: [...new Set(input.groupedOrderIds)].sort((left, right) => left.localeCompare(right, 'es')),
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
  })

  nextItems.sort((left, right) => {
    const leftDate = left.transferDate ?? left.invoiceDate ?? ''
    const rightDate = right.transferDate ?? right.invoiceDate ?? ''
    if (leftDate !== rightDate) {
      return rightDate.localeCompare(leftDate)
    }

    return left.recognitionKey.localeCompare(right.recognitionKey, 'es')
  })
  store.invoiceRecognitions = nextItems
  persistKontempoStore(store)

  return {
    inserted,
    updated,
    items: nextItems.map((item) => ({ ...item, groupedOrderIds: [...item.groupedOrderIds] })),
  }
}

export function recordKontempoImportRun(input: StoredKontempoImportRun) {
  const store = readKontempoStore()
  const nextRuns = [input, ...store.importRuns.filter((item) => item.id !== input.id)].slice(0, 50)
  store.importRuns = nextRuns
  persistKontempoStore(store)
  return input
}

function normalizeCustomerHomologation(value: unknown): StoredKontempoCustomerHomologation | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const matchKey = cleanString(item.matchKey)
  const netsuiteCustomerId = cleanString(item.netsuiteCustomerId)
  const netsuiteCustomerName = cleanString(item.netsuiteCustomerName)
  if (!matchKey || !netsuiteCustomerId || !netsuiteCustomerName) {
    return null
  }

  return {
    matchKey,
    kontempoCustomerId: cleanNullableString(item.kontempoCustomerId),
    kontempoBuyerId: cleanNullableString(item.kontempoBuyerId),
    companyName: cleanNullableString(item.companyName),
    normalizedCompanyName: cleanNullableString(item.normalizedCompanyName),
    customerName: cleanNullableString(item.customerName),
    normalizedCustomerName: cleanNullableString(item.normalizedCustomerName),
    netsuiteCustomerId,
    netsuiteCustomerName,
    netsuiteCustomerEntityId: cleanNullableString(item.netsuiteCustomerEntityId),
    confidence: cleanString(item.confidence),
    evidenceOrderIds: normalizeStringArray(item.evidenceOrderIds),
    createdAtUtc: cleanString(item.createdAtUtc),
    updatedAtUtc: cleanString(item.updatedAtUtc),
  }
}

function normalizeInvoiceRecognition(value: unknown): StoredKontempoInvoiceRecognition | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const recognitionKey = cleanString(item.recognitionKey)
  const orderId = cleanString(item.orderId)
  const netsuiteCustomerId = cleanString(item.netsuiteCustomerId)
  const netsuiteCustomerName = cleanString(item.netsuiteCustomerName)
  const invoiceInternalId = cleanString(item.invoiceInternalId)
  const sourceOrdersDigest = cleanString(item.sourceOrdersDigest)
  const sourceTransfersDigest = cleanString(item.sourceTransfersDigest)
  const status = cleanString(item.status)
  if (
    !recognitionKey ||
    !orderId ||
    !netsuiteCustomerId ||
    !netsuiteCustomerName ||
    !invoiceInternalId ||
    !sourceOrdersDigest ||
    !sourceTransfersDigest ||
    (
      status !== 'matched' &&
      status !== 'pending_journal' &&
      status !== 'pending_invoice' &&
      status !== 'manual_review'
    )
  ) {
    return null
  }

  return {
    recognitionKey,
    orderId,
    transferId: cleanNullableString(item.transferId),
    transferIdFragment: cleanNullableString(item.transferIdFragment),
    transferDate: cleanNullableString(item.transferDate),
    transferAmount: normalizeNullableNumber(item.transferAmount),
    transferCurrency: cleanNullableString(item.transferCurrency),
    groupedOrderCount: normalizeInteger(item.groupedOrderCount),
    groupedOrderIds: normalizeStringArray(item.groupedOrderIds),
    groupedGrossAmount: normalizeNullableNumber(item.groupedGrossAmount),
    groupedCommissionAmount: normalizeNullableNumber(item.groupedCommissionAmount),
    groupedNetDisbursementAmount: normalizeNullableNumber(item.groupedNetDisbursementAmount),
    kontempoCustomerId: cleanNullableString(item.kontempoCustomerId),
    kontempoBuyerId: cleanNullableString(item.kontempoBuyerId),
    companyName: cleanNullableString(item.companyName),
    customerName: cleanNullableString(item.customerName),
    netsuiteCustomerId,
    netsuiteCustomerName,
    invoiceInternalId,
    invoiceDocument: cleanNullableString(item.invoiceDocument),
    invoiceDate: cleanNullableString(item.invoiceDate),
    invoiceAmount: normalizeNullableNumber(item.invoiceAmount),
    salesOrderInternalId: cleanNullableString(item.salesOrderInternalId),
    salesOrderDocument: cleanNullableString(item.salesOrderDocument),
    salesOrderDate: cleanNullableString(item.salesOrderDate),
    salesOrderAmount: normalizeNullableNumber(item.salesOrderAmount),
    orderGrossAmount: normalizeNullableNumber(item.orderGrossAmount),
    orderCommissionAmount: normalizeNullableNumber(item.orderCommissionAmount),
    orderNetDisbursementAmount: normalizeNullableNumber(item.orderNetDisbursementAmount),
    journalTransactionId: cleanNullableString(item.journalTransactionId),
    journalDocument: cleanNullableString(item.journalDocument),
    journalDate: cleanNullableString(item.journalDate),
    journalPeriodId: cleanNullableString(item.journalPeriodId),
    journalPeriodName: cleanNullableString(item.journalPeriodName),
    journalAmount: normalizeNullableNumber(item.journalAmount),
    journalMemo: cleanNullableString(item.journalMemo),
    status,
    sourceOrdersDigest,
    sourceTransfersDigest,
    createdAtUtc: cleanString(item.createdAtUtc),
    updatedAtUtc: cleanString(item.updatedAtUtc),
  }
}

function normalizeImportRun(value: unknown): StoredKontempoImportRun | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const id = cleanString(item.id)
  const sourceOrdersPath = cleanString(item.sourceOrdersPath)
  const sourceTransfersPath = cleanString(item.sourceTransfersPath)
  const sourceOrdersDigest = cleanString(item.sourceOrdersDigest)
  const sourceTransfersDigest = cleanString(item.sourceTransfersDigest)
  const generatedAtUtc = cleanString(item.generatedAtUtc)
  const counts = item.counts as Record<string, unknown> | undefined
  if (
    !id ||
    !sourceOrdersPath ||
    !sourceTransfersPath ||
    !sourceOrdersDigest ||
    !sourceTransfersDigest ||
    !generatedAtUtc ||
    !counts
  ) {
    return null
  }

  return {
    id,
    sourceOrdersPath,
    sourceTransfersPath,
    sourceOrdersDigest,
    sourceTransfersDigest,
    generatedAtUtc,
    counts: {
      orderRows: normalizeInteger(counts.orderRows),
      orderRows2026: normalizeInteger(counts.orderRows2026),
      transferRows: normalizeInteger(counts.transferRows),
      transferGroups: normalizeInteger(counts.transferGroups),
      customerMatched: normalizeInteger(counts.customerMatched),
      invoiceMatched: normalizeInteger(counts.invoiceMatched),
      journalMatched: normalizeInteger(counts.journalMatched),
      recognizedInvoices: normalizeInteger(counts.recognizedInvoices),
    },
  }
}

function cleanString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanNullableString(value: unknown) {
  const normalized = cleanString(value)
  return normalized.length > 0 ? normalized : null
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[]
  }

  return value.map((entry) => cleanString(entry)).filter((entry) => entry.length > 0)
}

function normalizeNullableNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function normalizeInteger(value: unknown) {
  const parsed = normalizeNullableNumber(value)
  return parsed === null ? 0 : Math.max(0, Math.floor(parsed))
}
