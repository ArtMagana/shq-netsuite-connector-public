type StructuredErrorBody = {
  error?: unknown
  code?: unknown
}

type HttpClientErrorOptions = {
  body?: string
  parsedBody?: unknown
  errorCode?: string
  errorMessage?: string
}

export class HttpClientError extends Error {
  readonly status: number

  readonly body?: string

  readonly parsedBody?: unknown

  readonly errorCode?: string

  readonly errorMessage?: string

  constructor(message: string, status: number, options: HttpClientErrorOptions = {}) {
    super(message)
    this.name = 'HttpClientError'
    this.status = status
    this.body = options.body
    this.parsedBody = options.parsedBody
    this.errorCode = options.errorCode
    this.errorMessage = options.errorMessage
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

function tryParseJsonBody(body: string) {
  try {
    return JSON.parse(body) as unknown
  } catch {
    return undefined
  }
}

function resolveStructuredError(parsedBody: unknown) {
  if (!parsedBody || typeof parsedBody !== 'object') {
    return {
      errorCode: undefined,
      errorMessage: undefined,
    }
  }

  const payload = parsedBody as StructuredErrorBody

  return {
    errorCode: typeof payload.code === 'string' && payload.code.trim() ? payload.code : undefined,
    errorMessage: typeof payload.error === 'string' && payload.error.trim() ? payload.error : undefined,
  }
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
        const parsedBody = body ? tryParseJsonBody(body) : undefined
        const { errorCode, errorMessage } = resolveStructuredError(parsedBody)
        throw new HttpClientError(
          `Request failed with status ${response.status}.`,
          response.status,
          {
            body,
            parsedBody,
            errorCode,
            errorMessage,
          },
        )
      }

      if (!body) {
        return undefined as T
      }

      return JSON.parse(body) as T
    },
  }
}
