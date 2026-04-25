import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { NetSuiteClient } from './netsuiteClient.js'
import type {
  BankImportMappingSheet,
  NetSuiteEntityCatalogItem,
  NetSuiteEntityCatalogKind,
  NetSuiteEntityCatalogResponse,
} from './types.js'

type StoredNetSuiteEntityDataset = {
  kind: NetSuiteEntityCatalogKind
  lastSyncedAtUtc: string | null
  items: NetSuiteEntityCatalogItem[]
}

type StoredNetSuiteEntityStore = {
  version: 1
  datasets: Record<NetSuiteEntityCatalogKind, StoredNetSuiteEntityDataset>
}

const DEFAULT_NETSUITE_ENTITY_STORE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'storage',
  'netsuite-entities.json',
)

const NETSUITE_ENTITY_STORE_PATH =
  process.env.NETSUITE_ENTITY_STORE_PATH?.trim() || DEFAULT_NETSUITE_ENTITY_STORE_PATH

let entityStoreCache: StoredNetSuiteEntityStore | null = null

export class NetSuiteEntityStoreError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'NetSuiteEntityStoreError'
    this.status = status
  }
}

export function loadNetSuiteEntityCatalogSnapshot(kind: NetSuiteEntityCatalogKind): NetSuiteEntityCatalogResponse {
  const store = readNetSuiteEntityStore()
  const dataset = store.datasets[kind]
  return buildNetSuiteEntityCatalogResponse(kind, dataset, dataset.items.length > 0 ? 'store' : 'empty')
}

export async function syncNetSuiteEntityCatalog(kind: NetSuiteEntityCatalogKind): Promise<NetSuiteEntityCatalogResponse> {
  const client = NetSuiteClient.fromEnv()
  const rows = await fetchAllNetSuiteEntityRows(client, buildNetSuiteEntityCatalogQuery(kind))
  const items = rows
    .map((item) => parseNetSuiteEntityCatalogItem(item, kind))
    .filter((item): item is NetSuiteEntityCatalogItem => item !== null)

  const store = readNetSuiteEntityStore()
  store.datasets[kind] = {
    kind,
    lastSyncedAtUtc: new Date().toISOString(),
    items,
  }
  persistNetSuiteEntityStore(store)

  return buildNetSuiteEntityCatalogResponse(kind, store.datasets[kind], 'netsuite_sync')
}

export async function loadOrSyncNetSuiteEntityCatalog(kind: NetSuiteEntityCatalogKind) {
  const snapshot = loadNetSuiteEntityCatalogSnapshot(kind)
  if (snapshot.items.length > 0) {
    return snapshot.items
  }

  return (await syncNetSuiteEntityCatalog(kind)).items
}

export async function loadOrSyncNetSuiteEntityCatalogSnapshot(
  kind: NetSuiteEntityCatalogKind,
): Promise<NetSuiteEntityCatalogResponse> {
  const snapshot = loadNetSuiteEntityCatalogSnapshot(kind)
  if (snapshot.items.length > 0) {
    return snapshot
  }

  return await syncNetSuiteEntityCatalog(kind)
}

export function getNetSuiteEntityStorePath() {
  return NETSUITE_ENTITY_STORE_PATH
}

export function parseNetSuiteEntityCatalogKind(value: string): NetSuiteEntityCatalogKind {
  if (value === 'customers' || value === 'suppliers') {
    return value
  }

  throw new NetSuiteEntityStoreError('La base solicitada de entidades no existe.', 404)
}

function createEmptyNetSuiteEntityStore(): StoredNetSuiteEntityStore {
  return {
    version: 1,
    datasets: {
      customers: {
        kind: 'customers',
        lastSyncedAtUtc: null,
        items: [],
      },
      suppliers: {
        kind: 'suppliers',
        lastSyncedAtUtc: null,
        items: [],
      },
    },
  }
}

function readNetSuiteEntityStore() {
  if (entityStoreCache) {
    return entityStoreCache
  }

  if (!fs.existsSync(NETSUITE_ENTITY_STORE_PATH)) {
    entityStoreCache = createEmptyNetSuiteEntityStore()
    return entityStoreCache
  }

  try {
    const raw = fs.readFileSync(NETSUITE_ENTITY_STORE_PATH, 'utf8').replace(/^\uFEFF/u, '')
    const parsed = JSON.parse(raw) as Partial<StoredNetSuiteEntityStore>
    entityStoreCache = normalizeNetSuiteEntityStore(parsed)
    return entityStoreCache
  } catch {
    entityStoreCache = createEmptyNetSuiteEntityStore()
    return entityStoreCache
  }
}

function persistNetSuiteEntityStore(store: StoredNetSuiteEntityStore) {
  const directoryPath = path.dirname(NETSUITE_ENTITY_STORE_PATH)
  fs.mkdirSync(directoryPath, { recursive: true })
  fs.writeFileSync(NETSUITE_ENTITY_STORE_PATH, JSON.stringify(store, null, 2), 'utf8')
  entityStoreCache = store
}

function normalizeNetSuiteEntityStore(value: Partial<StoredNetSuiteEntityStore> | null | undefined): StoredNetSuiteEntityStore {
  const emptyStore = createEmptyNetSuiteEntityStore()
  if (!value || typeof value !== 'object') {
    return emptyStore
  }

  return {
    version: 1,
    datasets: {
      customers: normalizeNetSuiteEntityDataset(value.datasets?.customers, 'customers'),
      suppliers: normalizeNetSuiteEntityDataset(value.datasets?.suppliers, 'suppliers'),
    },
  }
}

function normalizeNetSuiteEntityDataset(
  value: Partial<StoredNetSuiteEntityDataset> | null | undefined,
  kind: NetSuiteEntityCatalogKind,
): StoredNetSuiteEntityDataset {
  const items = Array.isArray(value?.items)
    ? value.items
        .map((item) => normalizeNetSuiteEntityCatalogItem(item))
        .filter((item): item is NetSuiteEntityCatalogItem => item !== null)
    : []

  return {
    kind,
    lastSyncedAtUtc: getNullableString(value?.lastSyncedAtUtc),
    items,
  }
}

function normalizeNetSuiteEntityCatalogItem(value: unknown): NetSuiteEntityCatalogItem | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const internalId = cleanText(item.internalId)
  const entityId = cleanText(item.entityId)
  const altName = cleanText(item.altName)
  const companyName = cleanText(item.companyName)
  const displayName = cleanText(item.displayName)
  const rfc = cleanText(item.rfc)
  const recordType = cleanText(item.recordType)
  const accountDisplayName = getNullableString(item.accountDisplayName)

  if (!internalId || !displayName || (recordType !== 'customer' && recordType !== 'vendor')) {
    return null
  }

  return {
    internalId,
    recordType,
    entityId,
    altName,
    companyName,
    displayName,
    rfc,
    accountDisplayName,
  }
}

async function fetchAllNetSuiteEntityRows(client: NetSuiteClient, query: string) {
  const items: Record<string, unknown>[] = []
  const limit = 1000
  let offset = 0

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await client.suiteql(query, limit, offset)
    const pageItems = Array.isArray(response.json.items) ? response.json.items : []
    items.push(...pageItems)
    if (pageItems.length < limit) {
      break
    }

    offset += limit
  }

  return items
}

function buildNetSuiteEntityCatalogQuery(kind: NetSuiteEntityCatalogKind) {
  const recordType = kind === 'customers' ? 'customer' : 'vendor'
  const accountField = kind === 'customers' ? 'receivablesaccount' : 'payablesaccount'

  return `
    SELECT
      entityrecord.id AS id,
      entityrecord.entityid AS entityid,
      entityrecord.altname AS altname,
      entityrecord.companyname AS companyname,
      entityrecord.custentity_mx_rfc AS rfc,
      entityrecord.${accountField} AS ${accountField},
      account.displaynamewithhierarchy AS accountdisplayname
    FROM ${recordType} entityrecord
    LEFT JOIN account
      ON account.id = entityrecord.${accountField}
    WHERE entityrecord.isinactive = 'F'
    ORDER BY entityrecord.id ASC
  `.trim()
}

function parseNetSuiteEntityCatalogItem(
  value: Record<string, unknown>,
  kind: NetSuiteEntityCatalogKind,
): NetSuiteEntityCatalogItem | null {
  const internalId = cleanText(value.id)
  const entityId = cleanText(value.entityid)
  const altName = cleanText(value.altname)
  const companyName = cleanText(value.companyname)
  const rfc = cleanText(value.rfc)
  const rawAccountDisplayName = cleanText(value.accountdisplayname)
  const rawAccountId = kind === 'customers' ? cleanText(value.receivablesaccount) : cleanText(value.payablesaccount)
  const accountDisplayName =
    rawAccountDisplayName ||
    (kind === 'customers' && rawAccountId === '-10' ? '105-01-00 Clientes : Clientes nacionales' : null)

  if (!internalId || (!entityId && !altName && !companyName)) {
    return null
  }

  return {
    internalId,
    recordType: kind === 'customers' ? 'customer' : 'vendor',
    entityId,
    altName,
    companyName,
    displayName: formatNetSuiteEntityDisplayName(entityId, altName, companyName),
    rfc,
    accountDisplayName,
  }
}

function buildNetSuiteEntityCatalogResponse(
  kind: NetSuiteEntityCatalogKind,
  dataset: StoredNetSuiteEntityDataset,
  source: NetSuiteEntityCatalogResponse['source'],
): NetSuiteEntityCatalogResponse {
  return {
    generatedAtUtc: new Date().toISOString(),
    kind,
    label: kind === 'customers' ? 'Clientes' : 'Proveedores',
    source,
    storePath: NETSUITE_ENTITY_STORE_PATH,
    lastSyncedAtUtc: dataset.lastSyncedAtUtc,
    count: dataset.items.length,
    items: dataset.items.map((item) => ({ ...item })),
  }
}

function formatNetSuiteEntityDisplayName(entityId: string, altName: string, companyName: string) {
  const preferredName = cleanText(companyName || altName || entityId)
  if (/^\d+$/.test(entityId) && preferredName) {
    return `${entityId} ${preferredName}`.trim()
  }

  return preferredName || entityId
}

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function getNullableString(value: unknown) {
  const text = cleanText(value)
  return text ? text : null
}
