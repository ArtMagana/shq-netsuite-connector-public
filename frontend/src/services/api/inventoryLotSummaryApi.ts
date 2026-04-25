import { createHttpClient, HttpClientError } from './httpClient'

function resolveDefaultApiBaseUrl() {
  if (typeof window === 'undefined') {
    return 'http://127.0.0.1:3001/api'
  }

  return `${window.location.origin}/api`
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? resolveDefaultApiBaseUrl()
const httpClient = createHttpClient({ baseUrl: apiBaseUrl })

export type InventoryLotSummaryDetectedDate = {
  label: string
  raw: string
  normalized: string | null
  line: string | null
}

export type InventoryLotSummaryDeclaredDate = {
  raw: string | null
  normalized: string | null
}

export type InventoryLotSummaryResponse = {
  generatedAtUtc: string
  product: {
    internalId: string
    itemId: string
    displayName: string | null
    label: string
  }
  lot: {
    inventoryNumberId: string
    inventoryNumber: string
    expirationDateNetSuite: {
      raw: string | null
      normalized: string | null
    }
  }
  stock: {
    quantityOnHand: number
    quantityAvailable: number
  }
  coa: {
    source: 'netsuite_file' | 'search_directories' | 'unavailable'
    fileId: string | null
    fileName: string | null
    fileUrl: string | null
    matchedBy: string[]
    dates: {
      manufacture: InventoryLotSummaryDetectedDate | null
      expiration: InventoryLotSummaryDetectedDate | null
    }
    warnings: string[]
  }
  declaredNewLot: {
    raw: string | null
    normalized: string | null
  }
  declaredDates: {
    production: InventoryLotSummaryDeclaredDate
    expiration: InventoryLotSummaryDeclaredDate
    warnings: string[]
  }
}

export function fetchInventoryLotSummary(payload: {
  itemId: string
  lot: string
  declaredNewLot?: string | null
  declaredProductionDate?: string | null
  declaredExpirationDate?: string | null
}) {
  return httpClient.request<InventoryLotSummaryResponse>('/inventario/ajustes/lote-resumen', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export { HttpClientError }
