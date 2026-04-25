import { createHttpClient, HttpClientError } from './httpClient'

function resolveDefaultApiBaseUrl() {
  if (typeof window === 'undefined') {
    return 'http://127.0.0.1:3001/api'
  }

  return `${window.location.origin}/api`
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? resolveDefaultApiBaseUrl()
const httpClient = createHttpClient({ baseUrl: apiBaseUrl })

export type InventoryLotReplacementResponse = {
  executedAtUtc: string
  transactionDate: string
  account: {
    internalId: string
    displayName: string
  }
  product: {
    internalId: string
    itemId: string
    displayName: string | null
    label: string
  }
  location: {
    internalId: string
    name: string | null
    subsidiaryId: string | null
    subsidiaryName: string | null
  }
  quantityMoved: number
  adjustment: {
    internalId: string
    tranId: string | null
    memo: string
  }
  lots: {
    current: {
      inventoryNumberId: string
      inventoryNumber: string
      quantityOnHandBefore: number
      quantityAvailableBefore: number
      quantityOnHandAfter: number
    }
    next: {
      inventoryNumberId: string
      inventoryNumber: string
      productionDate: string
      expirationDate: string
      quantityOnHandAfter: number
    }
  }
  coa: {
    sourceFileId: string
    sourceFileName: string
    newFileName: string
    uploadedFiles: Array<{
      fileId: string
      fileName: string
      fileUrl: string | null
      folderId: string
      folderName: string | null
    }>
    deletedFiles: Array<{
      fileId: string
      fileName: string
      fileUrl: string | null
      folderId: string
      folderName: string | null
    }>
    remainingOldFiles: Array<{
      fileId: string
      fileName: string
      fileUrl: string | null
      folderId: string
      folderName: string | null
    }>
    detectedNewFiles: Array<{
      fileId: string
      fileName: string
      fileUrl: string | null
      folderId: string
      folderName: string | null
    }>
    removedLocalCachedFiles: string[]
  }
  message: string
}

export function executeInventoryLotReplacement(payload: {
  itemId: string
  currentLot: string
  newLot: string
  newProductionDate: string
  newExpirationDate: string
  sourceCoaFileId: string
  accountId: string
  transactionDate?: string | null
}) {
  return httpClient.request<InventoryLotReplacementResponse>('/inventario/ajustes/reemplazar-lote', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export { HttpClientError }
