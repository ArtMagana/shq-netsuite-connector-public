import { HttpClientError } from './httpClient'

export function isHttpClientError(error: unknown): error is HttpClientError {
  return error instanceof HttpClientError
}

export function getHttpErrorCode(error: unknown): string | undefined {
  return isHttpClientError(error) ? error.errorCode : undefined
}

export function getHttpErrorMessage(error: unknown, fallback: string): string {
  if (isHttpClientError(error)) {
    if (error.errorMessage) {
      return error.errorMessage
    }

    const body = error.body?.trim()
    if (body) {
      return body
    }

    return error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return fallback
}
