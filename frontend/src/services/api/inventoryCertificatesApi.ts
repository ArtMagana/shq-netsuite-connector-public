import { createHttpClient, HttpClientError } from './httpClient'

function resolveDefaultApiBaseUrl() {
  if (typeof window === 'undefined') {
    return 'http://127.0.0.1:3001/api'
  }

  return `${window.location.origin}/api`
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? resolveDefaultApiBaseUrl()
const httpClient = createHttpClient({ baseUrl: apiBaseUrl })

export type InventoryCertificateLookupRequest = {
  fileName?: string | null
  lot?: string | null
  productQuery?: string | null
}

export type InventoryCertificateDetectedDate = {
  label: string
  raw: string
  normalized: string | null
  line: string | null
}

export type InventoryCertificateLookupResponse = {
  inspectedAtUtc: string
  query: {
    fileName: string | null
    lot: string | null
    productQuery: string | null
  }
  searchedDirectories: string[]
  scannedFiles: number
  match: {
    fileName: string
    filePath: string
    matchedBy: string[]
    fileSizeBytes: number
    modifiedAtUtc: string | null
  }
  analysis: {
    textExtractionStatus: 'parsed' | 'failed'
    warnings: string[]
    lotMatches: string[]
    relevantLines: string[]
    dates: {
      production: InventoryCertificateDetectedDate | null
      expiration: InventoryCertificateDetectedDate | null
    }
    parsedText: string | null
  }
}

export function lookupInventoryCertificate(payload: InventoryCertificateLookupRequest) {
  return httpClient.request<InventoryCertificateLookupResponse>('/inventario/certificados/lookup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export { HttpClientError }
