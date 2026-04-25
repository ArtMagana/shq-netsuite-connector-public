import type { CorsOptions } from 'cors'

const DEFAULT_LOCAL_ALLOWED_ORIGINS = [
  'http://127.0.0.1:3000',
  'http://localhost:3000',
]

export const LARGE_JSON_BODY_LIMIT = '35mb'

export function getJsonBodyLimit() {
  return process.env.JSON_BODY_LIMIT?.trim() || '1mb'
}

export function resolveCorsOptions(): CorsOptions {
  const configuredOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS)
  const allowedOrigins = configuredOrigins.length > 0 ? configuredOrigins : getDefaultAllowedOrigins()

  if (isProductionRuntime() && allowedOrigins.length === 0) {
    throw new Error('ALLOWED_ORIGINS must be configured in production.')
  }

  const allowedOriginSet = new Set(allowedOrigins)

  return {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true)
        return
      }

      callback(null, allowedOriginSet.has(origin))
    },
  }
}

function parseAllowedOrigins(value: string | undefined) {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

function getDefaultAllowedOrigins() {
  return isProductionRuntime() ? [] : DEFAULT_LOCAL_ALLOWED_ORIGINS
}

function isProductionRuntime() {
  return process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production'
}
