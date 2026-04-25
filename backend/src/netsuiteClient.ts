import crypto from 'node:crypto'
import { loadLocalEnv } from './loadLocalEnv.js'
import { NetSuiteOAuthService } from './netsuiteOAuth.js'

type NetSuiteTbaCredentials = {
  accountId: string
  baseUrl: string
  consumerKey: string
  consumerSecret: string
  tokenId: string
  tokenSecret: string
}

type NetSuiteAuthMode = 'tba' | 'oauth2' | 'auto'

type NetSuiteTbaAuth = {
  mode: 'tba'
  credentials: NetSuiteTbaCredentials
}

type NetSuiteOAuthAuth = {
  mode: 'oauth2'
  accountId: string
  baseUrl: string
  oauthService: NetSuiteOAuthService
}

const RETRYABLE_STATUS_CODES = new Set([429])
const MAX_RETRY_ATTEMPTS = 4
const RETRY_BASE_DELAY_MS = 1200

export class NetSuiteClient {
  constructor(
    private readonly auth: NetSuiteTbaAuth | NetSuiteOAuthAuth,
    private readonly timeoutMs = 30000,
  ) {}

  static fromEnv() {
    loadLocalEnv()

    const authMode = normalizeAuthMode(process.env.NETSUITE_AUTH_MODE)
    const oauthService = NetSuiteOAuthService.fromEnvIfConfigured()
    const tbaCredentials = {
      accountId: process.env.NETSUITE_ACCOUNT_ID?.trim() ?? '',
      baseUrl: process.env.NETSUITE_BASE_URL?.trim() ?? '',
      consumerKey: process.env.NETSUITE_CONSUMER_KEY?.trim() ?? '',
      consumerSecret: process.env.NETSUITE_CONSUMER_SECRET?.trim() ?? '',
      tokenId: process.env.NETSUITE_TOKEN_ID?.trim() ?? '',
      tokenSecret: process.env.NETSUITE_TOKEN_SECRET?.trim() ?? '',
    }

    if (authMode === 'oauth2') {
      if (!oauthService) {
        throw new Error(
          'OAuth 2.0 mode is enabled but NETSUITE_OAUTH_CLIENT_ID / NETSUITE_OAUTH_CLIENT_SECRET are not configured.',
        )
      }

      return new NetSuiteClient({
        mode: 'oauth2',
        accountId: process.env.NETSUITE_ACCOUNT_ID?.trim() ?? '',
        baseUrl: process.env.NETSUITE_BASE_URL?.trim() ?? '',
        oauthService,
      })
    }

    if (authMode === 'auto' && oauthService?.getStatus().connected) {
      return new NetSuiteClient({
        mode: 'oauth2',
        accountId: process.env.NETSUITE_ACCOUNT_ID?.trim() ?? '',
        baseUrl: process.env.NETSUITE_BASE_URL?.trim() ?? '',
        oauthService,
      })
    }

    const missing = Object.entries(tbaCredentials)
      .filter(([, value]) => !value)
      .map(([key]) => key)

    if (missing.length > 0) {
      if (authMode === 'auto' && oauthService) {
        throw new Error(
          'OAuth 2.0 is configured but no authorized session is stored yet. Open the Ingresos tab and connect NetSuite with OAuth 2.0.',
        )
      }

      throw new Error(`Missing NetSuite credentials: ${missing.join(', ')}`)
    }

    return new NetSuiteClient({
      mode: 'tba',
      credentials: tbaCredentials,
    })
  }

  async ping(recordType = 'contact') {
    return this.requestJson('GET', '/services/rest/record/v1/metadata-catalog', {
      select: recordType,
    })
  }

  async suiteql(query: string, limit = 5, offset = 0) {
    return this.requestJson(
      'POST',
      '/services/rest/query/v1/suiteql',
      { limit, offset },
      { q: query },
      { Prefer: 'transient' },
    )
  }

  async getRecord(recordType: string, recordId: string, query?: Record<string, string | number | boolean>) {
    return this.requestJson('GET', `/services/rest/record/v1/${recordType}/${recordId}`, query)
  }

  async listRecords(recordType: string, query?: Record<string, string | number | boolean>) {
    return this.requestJson('GET', `/services/rest/record/v1/${recordType}`, query)
  }

  async getRecordSubresource(
    recordType: string,
    recordId: string,
    subresource: string,
    query?: Record<string, string | number | boolean>,
  ) {
    return this.requestJson(
      'GET',
      `/services/rest/record/v1/${recordType}/${recordId}/${subresource}`,
      query,
    )
  }

  async getRecordSchema(recordType: string) {
    return this.requestJson(
      'GET',
      `/services/rest/record/v1/metadata-catalog/${recordType}`,
      undefined,
      undefined,
      { Accept: 'application/schema+json' },
    )
  }

  async transformRecord(
    fromRecordType: string,
    fromRecordId: string,
    toRecordType: string,
    body?: unknown,
  ) {
    return this.requestJson(
      'POST',
      `/services/rest/record/v1/${fromRecordType}/${fromRecordId}/!transform/${toRecordType}`,
      undefined,
      body,
    )
  }

  async createRecord(recordType: string, body: unknown) {
    return this.requestJson('POST', `/services/rest/record/v1/${recordType}`, undefined, body)
  }

  async patchRecord(recordType: string, recordId: string, body: unknown, query?: Record<string, string | number | boolean>) {
    return this.requestJson('PATCH', `/services/rest/record/v1/${recordType}/${recordId}`, query, body)
  }

  async attachFileToRecord(recordType: string, recordId: string, fileId: string) {
    return this.requestJson(
      'POST',
      `/services/rest/record/v1/${recordType}/${recordId}/!attach/file/${fileId}`,
      undefined,
      {},
    )
  }

  private async requestJson(
    method: string,
    path: string,
    query?: Record<string, string | number | boolean>,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ) {
    const url = this.buildUrl(path, query)
    const serializedBody = body ? JSON.stringify(body) : undefined

    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt += 1) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

      try {
        const authorizationHeader = await this.buildAuthorizationHeader(method, url)
        const response = await fetch(url, {
          method,
          headers: {
            Authorization: authorizationHeader,
            Accept: 'application/json',
            ...(serializedBody ? { 'Content-Type': 'application/json' } : {}),
            ...extraHeaders,
          },
          body: serializedBody,
          signal: controller.signal,
        })

        const text = await response.text()
        if (!response.ok) {
          if (shouldRetry(response.status, attempt)) {
            await sleep(getRetryDelayMs(attempt, response.headers.get('Retry-After')))
            continue
          }

          throw new Error(`NetSuite HTTP ${response.status}: ${text}`)
        }

        return {
          statusCode: response.status,
          url,
          location: response.headers.get('Location'),
          json: text ? JSON.parse(text) : {},
        }
      } finally {
        clearTimeout(timeout)
      }
    }

    throw new Error('NetSuite request exhausted retry attempts.')
  }

  private buildUrl(path: string, query?: Record<string, string | number | boolean>) {
    const baseUrl = this.auth.mode === 'tba' ? this.auth.credentials.baseUrl : this.auth.baseUrl
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    const url = new URL(`${normalizedBaseUrl}${normalizedPath}`)
    Object.entries(query ?? {}).forEach(([key, value]) => url.searchParams.set(key, String(value)))
    return url.toString()
  }

  private async buildAuthorizationHeader(method: string, requestUrl: string) {
    if (this.auth.mode === 'oauth2') {
      return `Bearer ${await this.auth.oauthService.getValidAccessToken()}`
    }

    const oauthValues: Record<string, string> = {
      realm: this.auth.credentials.accountId,
      oauth_token: this.auth.credentials.tokenId,
      oauth_consumer_key: this.auth.credentials.consumerKey,
      oauth_nonce: this.randomNonce(),
      oauth_timestamp: String(Math.floor(Date.now() / 1000)),
      oauth_signature_method: 'HMAC-SHA256',
      oauth_version: '1.0',
    }

    oauthValues.oauth_signature = this.sign(method, requestUrl, oauthValues)

    const orderedKeys = [
      'realm',
      'oauth_token',
      'oauth_consumer_key',
      'oauth_nonce',
      'oauth_timestamp',
      'oauth_signature_method',
      'oauth_version',
      'oauth_signature',
    ]

    return `OAuth ${orderedKeys
      .map((key) => `${key}="${this.encode(oauthValues[key])}"`)
      .join(', ')}`
  }

  private sign(method: string, requestUrl: string, oauthValues: Record<string, string>) {
    const credentials = this.getTbaCredentials()
    const url = new URL(requestUrl)
    const baseUrl = `${url.protocol}//${url.host}${url.pathname}`
    const parameterPairs: Array<[string, string]> = []

    url.searchParams.forEach((value, key) => parameterPairs.push([key, value]))
    Object.entries(oauthValues).forEach(([key, value]) => {
      if (key !== 'realm' && key !== 'oauth_signature') {
        parameterPairs.push([key, value])
      }
    })

    const normalized = parameterPairs
      .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
        leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey),
      )
      .map(([key, value]) => `${this.encode(key)}=${this.encode(value)}`)
      .join('&')

    const baseString = [method.toUpperCase(), this.encode(baseUrl), this.encode(normalized)].join('&')
    const signingKey = `${this.encode(credentials.consumerSecret)}&${this.encode(credentials.tokenSecret)}`

    return crypto.createHmac('sha256', signingKey).update(baseString).digest('base64')
  }

  private randomNonce() {
    return crypto.randomBytes(18).toString('base64url')
  }

  private encode(value: string) {
    return encodeURIComponent(value)
      .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
      .replace(/%7E/g, '~')
  }

  private getTbaCredentials() {
    if (this.auth.mode !== 'tba') {
      throw new Error('TBA credentials are not available while OAuth 2.0 mode is active.')
    }

    return this.auth.credentials
  }
}

function normalizeAuthMode(rawValue?: string): NetSuiteAuthMode {
  switch (rawValue?.trim().toLowerCase()) {
    case 'oauth2':
      return 'oauth2'
    case 'auto':
      return 'auto'
    default:
      return 'tba'
  }
}

function shouldRetry(statusCode: number, attempt: number) {
  return RETRYABLE_STATUS_CODES.has(statusCode) && attempt < MAX_RETRY_ATTEMPTS - 1
}

function getRetryDelayMs(attempt: number, retryAfterHeader: string | null) {
  const retryAfterMs = parseRetryAfterMs(retryAfterHeader)
  if (retryAfterMs !== null) {
    return retryAfterMs
  }

  const exponentialDelay = RETRY_BASE_DELAY_MS * 2 ** attempt
  const jitter = Math.floor(Math.random() * 250)
  return exponentialDelay + jitter
}

function parseRetryAfterMs(headerValue: string | null) {
  if (!headerValue) {
    return null
  }

  const seconds = Number(headerValue)
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000)
  }

  const retryDate = new Date(headerValue)
  if (Number.isNaN(retryDate.getTime())) {
    return null
  }

  return Math.max(0, retryDate.getTime() - Date.now())
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
