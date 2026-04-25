import fs from 'node:fs'
import path from 'node:path'

import { loadOrSyncNetSuiteAccountCatalog } from './netsuiteAccountStore.js'
import { loadOrSyncNetSuiteEntityCatalog } from './netsuiteEntityStore.js'
import { SatServiceError } from './sat.js'

type StoredSatManualProviderOverride = {
  id: string
  matchBy: 'name' | 'rfc'
  matchValue: string
  normalizedMatchValue: string
  proveedorNetsuite: string
  supplierInternalId: string | null
  cc: string
  ccInternalId: string | null
  createdAtUtc: string
  updatedAtUtc: string
}

type StoredSatManualAccountOverride = {
  id: string
  claveProdServ: string
  normalizedClaveProdServ: string
  cuentaGastos: string
  accountInternalId: string | null
  createdAtUtc: string
  updatedAtUtc: string
}

type StoredSatManualHomologationStore = {
  version: 1
  providerOverrides: StoredSatManualProviderOverride[]
  accountOverrides: StoredSatManualAccountOverride[]
}

export type SatManualProviderOverride = StoredSatManualProviderOverride
export type SatManualAccountOverride = StoredSatManualAccountOverride

const SAT_MANUAL_HOMOLOGATION_STORE_PATH =
  process.env.SAT_MANUAL_HOMOLOGATION_STORE_PATH?.trim() ||
  path.join(process.env.LOCALAPPDATA || process.cwd(), 'netsuite-recon', 'sat-manual-homologation.json')

let satManualHomologationStoreCache: StoredSatManualHomologationStore | null = null

export function getSatManualHomologationStorePath() {
  return SAT_MANUAL_HOMOLOGATION_STORE_PATH
}

export function listSatManualHomologations() {
  const store = readSatManualHomologationStore()

  return {
    generatedAtUtc: new Date().toISOString(),
    storePath: SAT_MANUAL_HOMOLOGATION_STORE_PATH,
    providerOverrides: store.providerOverrides.map((item) => ({ ...item })),
    accountOverrides: store.accountOverrides.map((item) => ({ ...item })),
    counts: {
      providerOverrides: store.providerOverrides.length,
      accountOverrides: store.accountOverrides.length,
    },
  }
}

export function loadSatManualHomologationOverrides() {
  const store = readSatManualHomologationStore()
  return {
    providerOverrides: store.providerOverrides.map((item) => ({ ...item })),
    accountOverrides: store.accountOverrides.map((item) => ({ ...item })),
  }
}

export async function upsertSatManualProviderHomologation(params: {
  nombreEmisor?: string | null
  emisorRfc?: string | null
  saveByName?: boolean
  saveByRfc?: boolean
  supplierInternalId?: string | null
  supplierDisplayName?: string | null
  ccDisplayName?: string | null
  ccInternalId?: string | null
}) {
  const saveByName = params.saveByName !== false
  const saveByRfc = params.saveByRfc !== false
  const normalizedName = normalizeComparisonKey(params.nombreEmisor)
  const normalizedRfc = normalizeRfc(params.emisorRfc)

  if (!saveByName && !saveByRfc) {
    throw new SatServiceError('Debes guardar la homologacion por nombre, RFC o ambos.', 400)
  }

  if (saveByName && !normalizedName) {
    throw new SatServiceError('La factura no trae NombreEmisor valido para guardar la homologacion.', 400)
  }

  if (saveByRfc && !normalizedRfc) {
    throw new SatServiceError('La factura no trae RFC emisor valido para guardar la homologacion.', 400)
  }

  const supplierCatalog = await loadOrSyncNetSuiteEntityCatalog('suppliers')
  const supplier = resolveSupplierCatalogItem(supplierCatalog, {
    internalId: params.supplierInternalId,
    displayName: params.supplierDisplayName,
  })
  if (!supplier) {
    throw new SatServiceError('No pude resolver el proveedor de NetSuite para esta homologacion manual.', 400)
  }

  const accountCatalog = await loadOrSyncNetSuiteAccountCatalog()
  const account = resolveAccountCatalogItem(accountCatalog, {
    internalId: params.ccInternalId,
    displayName: params.ccDisplayName ?? supplier.accountDisplayName,
  })
  if (!account) {
    throw new SatServiceError(
      'No pude resolver la cuenta proveedor para la homologacion manual del proveedor.',
      400,
    )
  }

  const now = new Date().toISOString()
  const store = readSatManualHomologationStore()
  const savedOverrides: StoredSatManualProviderOverride[] = []

  if (saveByName && params.nombreEmisor) {
    savedOverrides.push(
      upsertProviderOverride(store.providerOverrides, {
        matchBy: 'name',
        matchValue: params.nombreEmisor,
        normalizedMatchValue: normalizedName as string,
        proveedorNetsuite: supplier.displayName,
        supplierInternalId: supplier.internalId,
        cc: account.displayName,
        ccInternalId: account.internalId,
        now,
      }),
    )
  }

  if (saveByRfc && params.emisorRfc) {
    savedOverrides.push(
      upsertProviderOverride(store.providerOverrides, {
        matchBy: 'rfc',
        matchValue: params.emisorRfc,
        normalizedMatchValue: normalizedRfc as string,
        proveedorNetsuite: supplier.displayName,
        supplierInternalId: supplier.internalId,
        cc: account.displayName,
        ccInternalId: account.internalId,
        now,
      }),
    )
  }

  persistSatManualHomologationStore(store)

  return {
    success: true as const,
    savedAtUtc: now,
    supplier: {
      internalId: supplier.internalId,
      displayName: supplier.displayName,
      rfc: supplier.rfc,
    },
    account: {
      internalId: account.internalId,
      displayName: account.displayName,
    },
    overrides: savedOverrides.map((item) => ({ ...item })),
    store: listSatManualHomologations(),
  }
}

export async function upsertSatManualAccountHomologation(params: {
  claveProdServ?: string | null
  accountDisplayName?: string | null
  accountInternalId?: string | null
}) {
  const normalizedClave = normalizeComparisonKey(params.claveProdServ)
  if (!normalizedClave || !params.claveProdServ?.trim()) {
    throw new SatServiceError('La ClaveProdServ es obligatoria para guardar la homologacion manual.', 400)
  }

  const accountCatalog = await loadOrSyncNetSuiteAccountCatalog()
  const account = resolveAccountCatalogItem(accountCatalog, {
    internalId: params.accountInternalId,
    displayName: params.accountDisplayName,
  })
  if (!account) {
    throw new SatServiceError('No pude resolver la cuenta de gasto elegida para la ClaveProdServ.', 400)
  }

  const now = new Date().toISOString()
  const store = readSatManualHomologationStore()
  const override = upsertAccountOverride(store.accountOverrides, {
    claveProdServ: params.claveProdServ,
    normalizedClaveProdServ: normalizedClave,
    cuentaGastos: account.displayName,
    accountInternalId: account.internalId,
    now,
  })

  persistSatManualHomologationStore(store)

  return {
    success: true as const,
    savedAtUtc: now,
    override: { ...override },
    store: listSatManualHomologations(),
  }
}

function upsertProviderOverride(
  target: StoredSatManualProviderOverride[],
  params: {
    matchBy: 'name' | 'rfc'
    matchValue: string
    normalizedMatchValue: string
    proveedorNetsuite: string
    supplierInternalId: string | null
    cc: string
    ccInternalId: string | null
    now: string
  },
) {
  const existing = target.find(
    (item) => item.matchBy === params.matchBy && item.normalizedMatchValue === params.normalizedMatchValue,
  )

  if (existing) {
    existing.matchValue = cleanText(params.matchValue)
    existing.proveedorNetsuite = params.proveedorNetsuite
    existing.supplierInternalId = params.supplierInternalId
    existing.cc = params.cc
    existing.ccInternalId = params.ccInternalId
    existing.updatedAtUtc = params.now
    return existing
  }

  const created: StoredSatManualProviderOverride = {
    id: `provider-${params.matchBy}-${params.normalizedMatchValue}`,
    matchBy: params.matchBy,
    matchValue: cleanText(params.matchValue),
    normalizedMatchValue: params.normalizedMatchValue,
    proveedorNetsuite: params.proveedorNetsuite,
    supplierInternalId: params.supplierInternalId,
    cc: params.cc,
    ccInternalId: params.ccInternalId,
    createdAtUtc: params.now,
    updatedAtUtc: params.now,
  }
  target.push(created)
  target.sort(compareProviderOverrides)
  return created
}

function upsertAccountOverride(
  target: StoredSatManualAccountOverride[],
  params: {
    claveProdServ: string
    normalizedClaveProdServ: string
    cuentaGastos: string
    accountInternalId: string | null
    now: string
  },
) {
  const existing = target.find((item) => item.normalizedClaveProdServ === params.normalizedClaveProdServ)

  if (existing) {
    existing.claveProdServ = cleanText(params.claveProdServ)
    existing.cuentaGastos = params.cuentaGastos
    existing.accountInternalId = params.accountInternalId
    existing.updatedAtUtc = params.now
    return existing
  }

  const created: StoredSatManualAccountOverride = {
    id: `account-${params.normalizedClaveProdServ}`,
    claveProdServ: cleanText(params.claveProdServ),
    normalizedClaveProdServ: params.normalizedClaveProdServ,
    cuentaGastos: params.cuentaGastos,
    accountInternalId: params.accountInternalId,
    createdAtUtc: params.now,
    updatedAtUtc: params.now,
  }
  target.push(created)
  target.sort(compareAccountOverrides)
  return created
}

function readSatManualHomologationStore() {
  if (satManualHomologationStoreCache) {
    return satManualHomologationStoreCache
  }

  if (!fs.existsSync(SAT_MANUAL_HOMOLOGATION_STORE_PATH)) {
    const empty = createEmptySatManualHomologationStore()
    persistSatManualHomologationStore(empty)
    return empty
  }

  try {
    const raw = fs.readFileSync(SAT_MANUAL_HOMOLOGATION_STORE_PATH, 'utf8').replace(/^\uFEFF/u, '')
    const parsed = JSON.parse(raw) as Partial<StoredSatManualHomologationStore>
    const normalized = normalizeSatManualHomologationStore(parsed)
    satManualHomologationStoreCache = normalized
    return normalized
  } catch {
    const empty = createEmptySatManualHomologationStore()
    persistSatManualHomologationStore(empty)
    return empty
  }
}

function persistSatManualHomologationStore(store: StoredSatManualHomologationStore) {
  const directoryPath = path.dirname(SAT_MANUAL_HOMOLOGATION_STORE_PATH)
  fs.mkdirSync(directoryPath, { recursive: true })
  fs.writeFileSync(SAT_MANUAL_HOMOLOGATION_STORE_PATH, JSON.stringify(store, null, 2), 'utf8')
  satManualHomologationStoreCache = store
}

function createEmptySatManualHomologationStore(): StoredSatManualHomologationStore {
  return {
    version: 1,
    providerOverrides: [],
    accountOverrides: [],
  }
}

function normalizeSatManualHomologationStore(
  value: Partial<StoredSatManualHomologationStore> | null | undefined,
) {
  return {
    version: 1,
    providerOverrides: Array.isArray(value?.providerOverrides)
      ? value.providerOverrides
          .map((item) => normalizeProviderOverride(item))
          .filter((item): item is StoredSatManualProviderOverride => item !== null)
          .sort(compareProviderOverrides)
      : [],
    accountOverrides: Array.isArray(value?.accountOverrides)
      ? value.accountOverrides
          .map((item) => normalizeAccountOverride(item))
          .filter((item): item is StoredSatManualAccountOverride => item !== null)
          .sort(compareAccountOverrides)
      : [],
  } satisfies StoredSatManualHomologationStore
}

function normalizeProviderOverride(
  value: Partial<StoredSatManualProviderOverride> | null | undefined,
) {
  const matchBy = value?.matchBy === 'rfc' ? 'rfc' : value?.matchBy === 'name' ? 'name' : null
  const matchValue = cleanText(value?.matchValue)
  const proveedorNetsuite = cleanText(value?.proveedorNetsuite)
  const cc = cleanText(value?.cc)

  if (!matchBy || !matchValue || !proveedorNetsuite || !cc) {
    return null
  }

  const normalizedMatchValue =
    matchBy === 'name' ? normalizeComparisonKey(matchValue) : normalizeRfc(matchValue)
  if (!normalizedMatchValue) {
    return null
  }

  return {
    id: cleanText(value?.id) || `provider-${matchBy}-${normalizedMatchValue}`,
    matchBy,
    matchValue,
    normalizedMatchValue,
    proveedorNetsuite,
    supplierInternalId: getNullableString(value?.supplierInternalId),
    cc,
    ccInternalId: getNullableString(value?.ccInternalId),
    createdAtUtc: cleanText(value?.createdAtUtc) || new Date().toISOString(),
    updatedAtUtc: cleanText(value?.updatedAtUtc) || new Date().toISOString(),
  } satisfies StoredSatManualProviderOverride
}

function normalizeAccountOverride(
  value: Partial<StoredSatManualAccountOverride> | null | undefined,
) {
  const claveProdServ = cleanText(value?.claveProdServ)
  const cuentaGastos = cleanText(value?.cuentaGastos)
  const normalizedClaveProdServ = normalizeComparisonKey(claveProdServ)

  if (!claveProdServ || !cuentaGastos || !normalizedClaveProdServ) {
    return null
  }

  return {
    id: cleanText(value?.id) || `account-${normalizedClaveProdServ}`,
    claveProdServ,
    normalizedClaveProdServ,
    cuentaGastos,
    accountInternalId: getNullableString(value?.accountInternalId),
    createdAtUtc: cleanText(value?.createdAtUtc) || new Date().toISOString(),
    updatedAtUtc: cleanText(value?.updatedAtUtc) || new Date().toISOString(),
  } satisfies StoredSatManualAccountOverride
}

function resolveSupplierCatalogItem(
  suppliers: Awaited<ReturnType<typeof loadOrSyncNetSuiteEntityCatalog>>,
  params: {
    internalId?: string | null
    displayName?: string | null
  },
) {
  const normalizedInternalId = cleanText(params.internalId)
  if (normalizedInternalId) {
    const byId = suppliers.find((item) => item.internalId === normalizedInternalId)
    if (byId) {
      return byId
    }
  }

  const normalizedDisplayName = normalizeComparisonKey(params.displayName)
  if (!normalizedDisplayName) {
    return null
  }

  return (
    suppliers.find((item) => normalizeComparisonKey(item.displayName) === normalizedDisplayName) ?? null
  )
}

function resolveAccountCatalogItem(
  accounts: Awaited<ReturnType<typeof loadOrSyncNetSuiteAccountCatalog>>,
  params: {
    internalId?: string | null
    displayName?: string | null
  },
) {
  const normalizedInternalId = cleanText(params.internalId)
  if (normalizedInternalId) {
    const byId = accounts.find((item) => item.internalId === normalizedInternalId)
    if (byId) {
      return byId
    }
  }

  const normalizedDisplayName = normalizeComparisonKey(params.displayName)
  if (!normalizedDisplayName) {
    return null
  }

  return (
    accounts.find((item) => normalizeComparisonKey(item.displayName) === normalizedDisplayName) ?? null
  )
}

function compareProviderOverrides(
  left: StoredSatManualProviderOverride,
  right: StoredSatManualProviderOverride,
) {
  return left.matchValue.localeCompare(right.matchValue, 'es')
}

function compareAccountOverrides(
  left: StoredSatManualAccountOverride,
  right: StoredSatManualAccountOverride,
) {
  return left.claveProdServ.localeCompare(right.claveProdServ, 'es')
}

function normalizeComparisonKey(value: unknown) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/gi, ' ')
    .trim()
    .toUpperCase()
}

function normalizeRfc(value: unknown) {
  return cleanText(value).replace(/[^A-Z0-9]+/gi, '').trim().toUpperCase() || null
}

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function getNullableString(value: unknown) {
  const text = cleanText(value)
  return text ? text : null
}
