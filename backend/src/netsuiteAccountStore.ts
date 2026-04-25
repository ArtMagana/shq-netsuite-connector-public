import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { NetSuiteClient } from './netsuiteClient.js'
import type { NetSuiteAccountCatalogItem, NetSuiteAccountCatalogResponse } from './types.js'

type StoredNetSuiteAccountDataset = {
  lastSyncedAtUtc: string | null
  items: NetSuiteAccountCatalogItem[]
}

type StoredNetSuiteAccountStore = {
  version: 1
  dataset: StoredNetSuiteAccountDataset
}

const DEFAULT_NETSUITE_ACCOUNT_STORE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'storage',
  'netsuite-accounts.json',
)

const NETSUITE_ACCOUNT_STORE_PATH =
  process.env.NETSUITE_ACCOUNT_STORE_PATH?.trim() || DEFAULT_NETSUITE_ACCOUNT_STORE_PATH

let accountStoreCache: StoredNetSuiteAccountStore | null = null

export class NetSuiteAccountStoreError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'NetSuiteAccountStoreError'
    this.status = status
  }
}

export function loadNetSuiteAccountCatalogSnapshot(): NetSuiteAccountCatalogResponse {
  const store = readNetSuiteAccountStore()
  return buildNetSuiteAccountCatalogResponse(store.dataset, store.dataset.items.length > 0 ? 'store' : 'empty')
}

export async function syncNetSuiteAccountCatalog(): Promise<NetSuiteAccountCatalogResponse> {
  const client = NetSuiteClient.fromEnv()
  const rows = await fetchAllNetSuiteAccountRows(client)
  const items = rows
    .map((row) => normalizeNetSuiteAccountCatalogItem(row))
    .filter((item): item is NetSuiteAccountCatalogItem => item !== null)

  const store = readNetSuiteAccountStore()
  store.dataset = {
    lastSyncedAtUtc: new Date().toISOString(),
    items,
  }
  persistNetSuiteAccountStore(store)

  return buildNetSuiteAccountCatalogResponse(store.dataset, 'netsuite_sync')
}

export async function loadOrSyncNetSuiteAccountCatalog() {
  const snapshot = loadNetSuiteAccountCatalogSnapshot()
  if (snapshot.items.length > 0) {
    return snapshot.items
  }

  return (await syncNetSuiteAccountCatalog()).items
}

export async function loadOrSyncNetSuiteAccountCatalogSnapshot(): Promise<NetSuiteAccountCatalogResponse> {
  const snapshot = loadNetSuiteAccountCatalogSnapshot()
  if (snapshot.items.length > 0) {
    return snapshot
  }

  return await syncNetSuiteAccountCatalog()
}

export function getNetSuiteAccountStorePath() {
  return NETSUITE_ACCOUNT_STORE_PATH
}

function createEmptyNetSuiteAccountStore(): StoredNetSuiteAccountStore {
  return {
    version: 1,
    dataset: {
      lastSyncedAtUtc: null,
      items: [],
    },
  }
}

function readNetSuiteAccountStore() {
  if (accountStoreCache) {
    return accountStoreCache
  }

  if (!fs.existsSync(NETSUITE_ACCOUNT_STORE_PATH)) {
    accountStoreCache = createEmptyNetSuiteAccountStore()
    return accountStoreCache
  }

  try {
    const raw = fs.readFileSync(NETSUITE_ACCOUNT_STORE_PATH, 'utf8').replace(/^\uFEFF/u, '')
    const parsed = JSON.parse(raw) as Partial<StoredNetSuiteAccountStore>
    accountStoreCache = normalizeNetSuiteAccountStore(parsed)
    return accountStoreCache
  } catch {
    accountStoreCache = createEmptyNetSuiteAccountStore()
    return accountStoreCache
  }
}

function persistNetSuiteAccountStore(store: StoredNetSuiteAccountStore) {
  const directoryPath = path.dirname(NETSUITE_ACCOUNT_STORE_PATH)
  fs.mkdirSync(directoryPath, { recursive: true })
  fs.writeFileSync(NETSUITE_ACCOUNT_STORE_PATH, JSON.stringify(store, null, 2), 'utf8')
  accountStoreCache = store
}

function normalizeNetSuiteAccountStore(value: Partial<StoredNetSuiteAccountStore> | null | undefined): StoredNetSuiteAccountStore {
  const dataset = value?.dataset
  const items = Array.isArray(dataset?.items)
    ? dataset.items
        .map((item) => normalizeNetSuiteAccountCatalogItem(item))
        .filter((item): item is NetSuiteAccountCatalogItem => item !== null)
    : []

  return {
    version: 1,
    dataset: {
      lastSyncedAtUtc: getNullableString(dataset?.lastSyncedAtUtc),
      items,
    },
  }
}

async function fetchAllNetSuiteAccountRows(client: NetSuiteClient) {
  const items: Record<string, unknown>[] = []
  const query = `
    SELECT
      account.id AS id,
      account.displaynamewithhierarchy AS displayname
    FROM account
    WHERE account.isinactive = 'F'
    ORDER BY account.id ASC
  `.trim()
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

function normalizeNetSuiteAccountCatalogItem(value: unknown): NetSuiteAccountCatalogItem | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const internalId = cleanText(item.internalId ?? item.id)
  const displayName = cleanText(item.displayName ?? item.displayname)
  if (!internalId || !displayName) {
    return null
  }

  return {
    internalId,
    displayName,
  }
}

function buildNetSuiteAccountCatalogResponse(
  dataset: StoredNetSuiteAccountDataset,
  source: NetSuiteAccountCatalogResponse['source'],
): NetSuiteAccountCatalogResponse {
  return {
    generatedAtUtc: new Date().toISOString(),
    label: 'Cuentas contables',
    source,
    storePath: NETSUITE_ACCOUNT_STORE_PATH,
    lastSyncedAtUtc: dataset.lastSyncedAtUtc,
    count: dataset.items.length,
    items: dataset.items.map((item) => ({ ...item })),
  }
}

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function getNullableString(value: unknown) {
  const text = cleanText(value)
  return text ? text : null
}
