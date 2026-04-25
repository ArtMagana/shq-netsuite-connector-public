export class HttpClientError extends Error {
  readonly status: number

  readonly body?: string

  constructor(message: string, status: number, body?: string) {
    super(message)
    this.name = 'HttpClientError'
    this.status = status
    this.body = body
  }
}

type HttpClientOptions = {
  baseUrl: string
}

type HttpRequestOptions = Omit<RequestInit, 'headers'> & {
  headers?: HeadersInit
}

function resolveUrl(baseUrl: string, path: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${normalizedBaseUrl}${normalizedPath}`
}

function resolveRequestHeaders(headers?: HeadersInit) {
  const resolvedHeaders = new Headers(headers)
  resolvedHeaders.set('Accept', 'application/json')

  const internalApiKey = import.meta.env.VITE_INTERNAL_API_KEY?.trim()
  if (internalApiKey && !resolvedHeaders.has('X-Internal-Api-Key')) {
    resolvedHeaders.set('X-Internal-Api-Key', internalApiKey)
  }

  return resolvedHeaders
}

export function createHttpClient({ baseUrl }: HttpClientOptions) {
  return {
    async request<T>(path: string, options: HttpRequestOptions = {}) {
      const response = await fetch(resolveUrl(baseUrl, path), {
        ...options,
        headers: resolveRequestHeaders(options.headers),
      })

      const body = await response.text()

      if (!response.ok) {
        throw new HttpClientError(
          `Request failed with status ${response.status}.`,
          response.status,
          body,
        )
      }

      if (!body) {
        return undefined as T
      }

      return JSON.parse(body) as T
    },
  }
}
