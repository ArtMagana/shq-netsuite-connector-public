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

export function createHttpClient({ baseUrl }: HttpClientOptions) {
  return {
    async request<T>(path: string, options: HttpRequestOptions = {}) {
      const response = await fetch(resolveUrl(baseUrl, path), {
        ...options,
        headers: {
          Accept: 'application/json',
          ...options.headers,
        },
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
