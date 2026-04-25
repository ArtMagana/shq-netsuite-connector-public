import { createHttpClient, HttpClientError } from './httpClient'

function resolveDefaultApiBaseUrl() {
  if (typeof window === 'undefined') {
    return 'http://127.0.0.1:3001/api'
  }

  return `${window.location.origin}/api`
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? resolveDefaultApiBaseUrl()
const httpClient = createHttpClient({ baseUrl: apiBaseUrl })

export type InventoryAdjustmentLocationOption = {
  internalId: string
  name: string
  subsidiaryId: string | null
  subsidiaryName: string | null
}

export type InventoryAdjustmentPostingPeriod = {
  internalId: string
  name: string
  startDate: string | null
  endDate: string | null
}

export type InventoryAdjustmentItemSearchResult = {
  internalId: string
  itemId: string
  displayName: string | null
  itemType: string
  costingMethod: string | null
  isLotTracked: boolean
  isSerialTracked: boolean
  usesBins: boolean
  stockUnitId: string | null
  stockUnitName: string | null
}

export type InventoryAdjustmentAccountSearchResult = {
  internalId: string
  displayName: string
  accountType: string | null
}

export type InventoryAdjustmentLocationBalance = {
  locationId: string
  locationName: string | null
  quantityOnHand: number
  quantityAvailable: number
  subsidiaryId: string | null
  subsidiaryName: string | null
}

export type InventoryAdjustmentLotBalance = {
  inventoryNumberId: string
  inventoryNumber: string | null
  expirationDate: string | null
  locationId: string
  locationName: string | null
  quantityOnHand: number
  quantityAvailable: number
}

export type InventoryAdjustmentBootstrapResponse = {
  generatedAtUtc: string
  todayDate: string
  locations: InventoryAdjustmentLocationOption[]
  postingPeriods: InventoryAdjustmentPostingPeriod[]
}

export type InventoryAdjustmentItemSnapshotResponse = {
  generatedAtUtc: string
  item: InventoryAdjustmentItemSearchResult
  requestedLocation: InventoryAdjustmentLocationOption | null
  totals: {
    quantityOnHand: number
    quantityAvailable: number
    locationCount: number
    lotCount: number
  }
  locations: InventoryAdjustmentLocationBalance[]
  lots: InventoryAdjustmentLotBalance[]
  requirements: {
    needsInventoryDetail: boolean
    requiresInventoryNumberSelection: boolean
    requiresReceiptInventoryNumber: boolean
    usesBins: boolean
  }
}

export type InventoryAdjustmentAssignmentDraft = {
  quantity: number
  issueInventoryNumberId: string | null
  receiptInventoryNumber: string | null
  expirationDate?: string | null
}

export type InventoryAdjustmentDraftRequest = {
  transactionDate: string
  postingPeriodId: string | null
  accountId: string
  locationId: string
  itemId: string
  memo: string | null
  lineMemo: string | null
  adjustmentMode: 'delta' | 'set'
  quantity: number
  unitCost: number | null
  assignments: InventoryAdjustmentAssignmentDraft[]
}

export type InventoryAdjustmentAssignmentPreview = {
  quantity: number
  direction: 'issue' | 'receipt'
  issueInventoryNumberId: string | null
  issueInventoryNumber: string | null
  receiptInventoryNumber: string | null
}

export type InventoryAdjustmentPreviewResponse = {
  generatedAtUtc: string
  transactionDate: string
  account: InventoryAdjustmentAccountSearchResult
  location: InventoryAdjustmentLocationOption
  postingPeriod: InventoryAdjustmentPostingPeriod | null
  item: InventoryAdjustmentItemSearchResult
  memo: string | null
  lineMemo: string | null
  currentStock: InventoryAdjustmentItemSnapshotResponse['totals'] & {
    selectedLocationQuantityOnHand: number
    selectedLocationQuantityAvailable: number
  }
  computed: {
    adjustmentMode: InventoryAdjustmentDraftRequest['adjustmentMode']
    requestedQuantity: number
    adjustQtyBy: number
    newQuantity: number
    direction: 'increase' | 'decrease'
  }
  validation: {
    isValid: boolean
    issues: string[]
    warnings: string[]
    requiresInventoryDetail: boolean
  }
  assignments: InventoryAdjustmentAssignmentPreview[]
  payloadPreview: Record<string, unknown> | null
}

export type InventoryAdjustmentExecuteResponse = {
  executedAtUtc: string
  record: {
    internalId: string
    tranId: string | null
  }
  item: InventoryAdjustmentItemSearchResult
  location: InventoryAdjustmentLocationOption
  account: InventoryAdjustmentAccountSearchResult
  summary: InventoryAdjustmentPreviewResponse['computed'] & {
    previousQuantityOnHand: number
  }
  message: string
}

export type InventoryAdjustmentSearchItemsResponse = {
  generatedAtUtc: string
  query: string
  count: number
  items: InventoryAdjustmentItemSearchResult[]
}

export type InventoryAdjustmentSearchAccountsResponse = {
  generatedAtUtc: string
  query: string
  count: number
  items: InventoryAdjustmentAccountSearchResult[]
}

export function fetchInventoryAdjustmentBootstrap() {
  return httpClient.request<InventoryAdjustmentBootstrapResponse>('/inventario/ajustes/bootstrap')
}

export function searchInventoryAdjustmentItems(query: string, limit = 12) {
  const params = new URLSearchParams({
    query,
    limit: String(limit),
  })

  return httpClient.request<InventoryAdjustmentSearchItemsResponse>(
    `/inventario/ajustes/items?${params.toString()}`,
  )
}

export function searchInventoryAdjustmentAccounts(query: string, limit = 12) {
  const params = new URLSearchParams({
    query,
    limit: String(limit),
  })

  return httpClient.request<InventoryAdjustmentSearchAccountsResponse>(
    `/inventario/ajustes/accounts?${params.toString()}`,
  )
}

export function fetchInventoryAdjustmentItemSnapshot(itemId: string, locationId?: string | null) {
  const params = new URLSearchParams()
  if (locationId) {
    params.set('locationId', locationId)
  }

  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  return httpClient.request<InventoryAdjustmentItemSnapshotResponse>(
    `/inventario/ajustes/items/${encodeURIComponent(itemId)}/snapshot${suffix}`,
  )
}

export function previewInventoryAdjustment(payload: InventoryAdjustmentDraftRequest) {
  return httpClient.request<InventoryAdjustmentPreviewResponse>('/inventario/ajustes/preview', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function executeInventoryAdjustment(payload: InventoryAdjustmentDraftRequest) {
  return httpClient.request<InventoryAdjustmentExecuteResponse>('/inventario/ajustes/execute', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export { HttpClientError }
