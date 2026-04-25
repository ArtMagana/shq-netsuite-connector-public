import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import XLSX from 'xlsx'

import type { ClaveSatCatalogItem, ClaveSatCatalogResponse } from './types.js'

type StoredClaveSatDataset = {
  workbookPath: string | null
  sheetName: string
  lastSyncedAtUtc: string | null
  items: ClaveSatCatalogItem[]
}

type StoredClaveSatStore = {
  version: 1
  dataset: StoredClaveSatDataset
}

const DEFAULT_CLAVE_SAT_STORE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'storage',
  'clave-sat.json',
)

const DEFAULT_CLAVE_SAT_WORKBOOK_PATH = 'C:/Users/artur/Mi unidad/SHQ Transit/ClaveSAT.xlsx'
const DEFAULT_CLAVE_SAT_SHEET_NAME = 'c_ClaveProdServ'
const DEFAULT_CLAVE_SAT_HEADER_ROW_NUMBER = 5

const CLAVE_SAT_STORE_PATH =
  process.env.CLAVE_SAT_STORE_PATH?.trim() || DEFAULT_CLAVE_SAT_STORE_PATH
const CLAVE_SAT_WORKBOOK_PATH =
  normalizeOptionalPath(process.env.CLAVE_SAT_WORKBOOK_PATH) ?? DEFAULT_CLAVE_SAT_WORKBOOK_PATH
const CLAVE_SAT_SHEET_NAME =
  normalizeOptionalString(process.env.CLAVE_SAT_WORKBOOK_SHEET) ?? DEFAULT_CLAVE_SAT_SHEET_NAME
const CLAVE_SAT_HEADER_ROW_NUMBER = normalizeHeaderRowNumber(
  process.env.CLAVE_SAT_HEADER_ROW_NUMBER,
  DEFAULT_CLAVE_SAT_HEADER_ROW_NUMBER,
)

let claveSatStoreCache: StoredClaveSatStore | null = null

export class ClaveSatStoreError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'ClaveSatStoreError'
    this.status = status
  }
}

export function loadClaveSatCatalogSnapshot(): ClaveSatCatalogResponse {
  const store = readClaveSatStore()
  return buildClaveSatCatalogResponse(store.dataset, store.dataset.items.length > 0 ? 'store' : 'empty')
}

export async function syncClaveSatCatalog(): Promise<ClaveSatCatalogResponse> {
  const items = readClaveSatWorkbookItems()
  const store = readClaveSatStore()
  store.dataset = {
    workbookPath: CLAVE_SAT_WORKBOOK_PATH,
    sheetName: CLAVE_SAT_SHEET_NAME,
    lastSyncedAtUtc: new Date().toISOString(),
    items,
  }
  persistClaveSatStore(store)

  return buildClaveSatCatalogResponse(store.dataset, 'excel_sync')
}

export async function loadOrSyncClaveSatCatalogSnapshot(): Promise<ClaveSatCatalogResponse> {
  const snapshot = loadClaveSatCatalogSnapshot()
  if (snapshot.items.length > 0) {
    return snapshot
  }

  return await syncClaveSatCatalog()
}

export function getClaveSatStorePath() {
  return CLAVE_SAT_STORE_PATH
}

export function getClaveSatWorkbookPath() {
  return CLAVE_SAT_WORKBOOK_PATH
}

function readClaveSatWorkbookItems() {
  if (!CLAVE_SAT_WORKBOOK_PATH) {
    throw new ClaveSatStoreError('Falta configurar CLAVE_SAT_WORKBOOK_PATH.', 503)
  }

  if (!fs.existsSync(CLAVE_SAT_WORKBOOK_PATH)) {
    throw new ClaveSatStoreError(
      `No existe el archivo de ClaveSAT en ${CLAVE_SAT_WORKBOOK_PATH}.`,
      503,
    )
  }

  const workbook = XLSX.readFile(CLAVE_SAT_WORKBOOK_PATH, {
    raw: false,
    dense: false,
  })
  const sheet = workbook.Sheets[CLAVE_SAT_SHEET_NAME]
  if (!sheet) {
    throw new ClaveSatStoreError(
      `No existe la hoja ${CLAVE_SAT_SHEET_NAME} dentro de ClaveSAT.xlsx.`,
      503,
    )
  }

  const rows = XLSX.utils.sheet_to_json<Array<string | number | null>>(sheet, {
    header: 1,
    defval: null,
    blankrows: true,
  })
  const headerRowIndex = CLAVE_SAT_HEADER_ROW_NUMBER - 1
  if (rows.length <= headerRowIndex) {
    throw new ClaveSatStoreError(
      `La hoja ${CLAVE_SAT_SHEET_NAME} no contiene la fila de encabezados esperada (${CLAVE_SAT_HEADER_ROW_NUMBER}).`,
      503,
    )
  }

  validateClaveSatHeaderRow(rows[headerRowIndex] ?? [])

  const itemsByCode = new Map<string, ClaveSatCatalogItem>()
  for (const row of rows.slice(headerRowIndex + 1)) {
    const code = normalizeClaveSatCode(row?.[0])
    const description = cleanText(row?.[1])
    if (!code || !description || itemsByCode.has(code)) {
      continue
    }

    itemsByCode.set(code, {
      code,
      description,
    })
  }

  return Array.from(itemsByCode.values()).sort(compareClaveSatCatalogItems)
}

function validateClaveSatHeaderRow(row: Array<string | number | null>) {
  const codeHeader = normalizeHeader(row[0])
  const descriptionHeader = normalizeHeader(row[1])

  if (!codeHeader.includes('CLAVEPRODSERV') || !descriptionHeader.includes('DESCRIPCION')) {
    throw new ClaveSatStoreError(
      `La hoja ${CLAVE_SAT_SHEET_NAME} no trae las columnas esperadas en A y B.`,
      503,
    )
  }
}

function createEmptyClaveSatStore(): StoredClaveSatStore {
  return {
    version: 1,
    dataset: {
      workbookPath: CLAVE_SAT_WORKBOOK_PATH,
      sheetName: CLAVE_SAT_SHEET_NAME,
      lastSyncedAtUtc: null,
      items: [],
    },
  }
}

function readClaveSatStore() {
  if (claveSatStoreCache) {
    return claveSatStoreCache
  }

  if (!fs.existsSync(CLAVE_SAT_STORE_PATH)) {
    claveSatStoreCache = createEmptyClaveSatStore()
    return claveSatStoreCache
  }

  try {
    const raw = fs.readFileSync(CLAVE_SAT_STORE_PATH, 'utf8').replace(/^\uFEFF/u, '')
    const parsed = JSON.parse(raw) as Partial<StoredClaveSatStore>
    claveSatStoreCache = normalizeClaveSatStore(parsed)
    return claveSatStoreCache
  } catch {
    claveSatStoreCache = createEmptyClaveSatStore()
    return claveSatStoreCache
  }
}

function persistClaveSatStore(store: StoredClaveSatStore) {
  const directoryPath = path.dirname(CLAVE_SAT_STORE_PATH)
  fs.mkdirSync(directoryPath, { recursive: true })
  fs.writeFileSync(CLAVE_SAT_STORE_PATH, JSON.stringify(store, null, 2), 'utf8')
  claveSatStoreCache = store
}

function normalizeClaveSatStore(value: Partial<StoredClaveSatStore> | null | undefined): StoredClaveSatStore {
  const dataset = value?.dataset
  const items = Array.isArray(dataset?.items)
    ? dataset.items
        .map((item) => normalizeClaveSatCatalogItem(item))
        .filter((item): item is ClaveSatCatalogItem => item !== null)
        .sort(compareClaveSatCatalogItems)
    : []

  return {
    version: 1,
    dataset: {
      workbookPath: normalizeOptionalPath(dataset?.workbookPath) ?? CLAVE_SAT_WORKBOOK_PATH,
      sheetName: normalizeOptionalString(dataset?.sheetName) ?? CLAVE_SAT_SHEET_NAME,
      lastSyncedAtUtc: normalizeOptionalString(dataset?.lastSyncedAtUtc),
      items,
    },
  }
}

function normalizeClaveSatCatalogItem(value: unknown): ClaveSatCatalogItem | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const code = normalizeClaveSatCode(item.code)
  const description = cleanText(item.description)
  if (!code || !description) {
    return null
  }

  return {
    code,
    description,
  }
}

function buildClaveSatCatalogResponse(
  dataset: StoredClaveSatDataset,
  source: ClaveSatCatalogResponse['source'],
): ClaveSatCatalogResponse {
  return {
    generatedAtUtc: new Date().toISOString(),
    label: 'ClaveSAT',
    source,
    storePath: CLAVE_SAT_STORE_PATH,
    workbookPath: dataset.workbookPath,
    sheetName: dataset.sheetName,
    lastSyncedAtUtc: dataset.lastSyncedAtUtc,
    count: dataset.items.length,
    items: dataset.items.map((item) => ({ ...item })),
  }
}

function compareClaveSatCatalogItems(left: ClaveSatCatalogItem, right: ClaveSatCatalogItem) {
  return left.code.localeCompare(right.code, 'es')
}

function normalizeClaveSatCode(value: unknown) {
  const digits = String(value ?? '').replace(/\D+/g, '').trim()
  if (!digits) {
    return null
  }

  return digits.length >= 8 ? digits : digits.padStart(8, '0')
}

function normalizeHeader(value: unknown) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/gi, '')
    .trim()
    .toUpperCase()
}

function normalizeOptionalString(value: unknown) {
  const text = cleanText(value)
  return text ? text : null
}

function normalizeOptionalPath(value: unknown) {
  const normalized = normalizeOptionalString(value)
  return normalized ? normalized.replace(/\\/g, '/') : null
}

function normalizeHeaderRowNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback
}

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}
