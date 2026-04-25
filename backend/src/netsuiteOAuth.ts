import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { loadLocalEnv } from './loadLocalEnv.js'

type PendingAuthorization = {
  codeVerifier: string
  createdAt: number
}

type NetSuiteOAuthConfig = {
  accountId: string
  baseUrl: string
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes: string[]
  authorizeUrl: string
  frontendReturnUrl: string
  tokenStorePath: string
}

type TokenEndpointResponse = {
  access_token: string
  refresh_token?: string
  token_type: string
  expires_in: number
  id_token?: string
  scope?: string
  error?: string
  error_description?: string
}

export type StoredOAuthSession = {
  accessToken: string
  refreshToken: string
  tokenType: string
  scopes: string[]
  accessTokenExpiresAt: string
  refreshTokenExpiresAt?: string
  idToken?: string
  createdAtUtc: string
  updatedAtUtc: string
}

export type NetSuiteOAuthStatus = {
  configured: boolean
  connected: boolean
  redirectUri?: string
  scopes: string[]
  authorizationPath: string
  frontendReturnUrl?: string
  accessTokenExpiresAt?: string
  refreshTokenExpiresAt?: string
}

const pendingAuthorizations = new Map<string, PendingAuthorization>()
const AUTH_STATE_TTL_MS = 10 * 60 * 1000
const DEFAULT_FRONTEND_RETURN_URL = 'http://127.0.0.1:3000/#/ingresos'
const DEFAULT_REDIRECT_URI = 'https://your-domain.example/api/auth/netsuite/callback'
const DEFAULT_SCOPES = ['rest_webservices']
const DEFAULT_AUTHORIZE_URL = 'https://system.netsuite.com/app/login/oauth2/authorize.nl'
const DEFAULT_STORE_FILE = 'netsuite-oauth-session.json'
const DEFAULT_REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

export class NetSuiteOAuthService {
  constructor(private readonly config: NetSuiteOAuthConfig) {}

  static fromEnv() {
    loadLocalEnv()

    const accountId = process.env.NETSUITE_ACCOUNT_ID?.trim() ?? ''
    const baseUrl = process.env.NETSUITE_BASE_URL?.trim() ?? ''
    const clientId = process.env.NETSUITE_OAUTH_CLIENT_ID?.trim() ?? ''
    const clientSecret = process.env.NETSUITE_OAUTH_CLIENT_SECRET?.trim() ?? ''

    const missing = [
      ['NETSUITE_ACCOUNT_ID', accountId],
      ['NETSUITE_BASE_URL', baseUrl],
      ['NETSUITE_OAUTH_CLIENT_ID', clientId],
      ['NETSUITE_OAUTH_CLIENT_SECRET', clientSecret],
    ]
      .filter(([, value]) => !value)
      .map(([key]) => key)

    if (missing.length > 0) {
      throw new Error(`Missing NetSuite OAuth configuration: ${missing.join(', ')}`)
    }

    const scopes = parseScopes(process.env.NETSUITE_OAUTH_SCOPES)
    const redirectUri = process.env.NETSUITE_OAUTH_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI
    const authorizeUrl = process.env.NETSUITE_OAUTH_AUTHORIZE_URL?.trim() || DEFAULT_AUTHORIZE_URL
    const frontendReturnUrl =
      process.env.NETSUITE_OAUTH_FRONTEND_RETURN_URL?.trim() || resolveDefaultFrontendReturnUrl()

    return new NetSuiteOAuthService({
      accountId,
      baseUrl: baseUrl.replace(/\/+$/, ''),
      clientId,
      clientSecret,
      redirectUri,
      scopes,
      authorizeUrl,
      frontendReturnUrl,
      tokenStorePath: resolveTokenStorePath(process.env.NETSUITE_OAUTH_TOKEN_STORE_PATH),
    })
  }

  static fromEnvIfConfigured() {
    loadLocalEnv()

    if (!process.env.NETSUITE_OAUTH_CLIENT_ID?.trim() || !process.env.NETSUITE_OAUTH_CLIENT_SECRET?.trim()) {
      return null
    }

    return NetSuiteOAuthService.fromEnv()
  }

  getStatus(): NetSuiteOAuthStatus {
    const session = this.loadSession()

    return {
      configured: true,
      connected: session !== null,
      redirectUri: this.config.redirectUri,
      scopes: this.config.scopes,
      authorizationPath: '/api/auth/netsuite/login',
      frontendReturnUrl: this.config.frontendReturnUrl,
      accessTokenExpiresAt: session?.accessTokenExpiresAt,
      refreshTokenExpiresAt: session?.refreshTokenExpiresAt,
    }
  }

  beginAuthorization() {
    pruneExpiredAuthorizations()

    const state = crypto.randomBytes(24).toString('base64url')
    const codeVerifier = crypto.randomBytes(64).toString('base64url')
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
    pendingAuthorizations.set(state, {
      codeVerifier,
      createdAt: Date.now(),
    })

    const url = new URL(this.config.authorizeUrl)
    url.searchParams.set('scope', this.config.scopes.join(' '))
    url.searchParams.set('redirect_uri', this.config.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', this.config.clientId)
    url.searchParams.set('state', state)
    url.searchParams.set('code_challenge', codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')

    return {
      state,
      authorizationUrl: url.toString(),
    }
  }

  async exchangeAuthorizationCode(code: string, state: string) {
    const pending = pendingAuthorizations.get(state)
    pendingAuthorizations.delete(state)

    if (!pending) {
      throw new Error('Invalid or expired OAuth state. Start the authorization flow again.')
    }

    const tokenResponse = await this.requestToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      code_verifier: pending.codeVerifier,
    })

    const session = buildStoredSession(tokenResponse, this.config.scopes)
    this.saveSession(session)

    return session
  }

  async getValidAccessToken() {
    const session = this.loadSession()
    if (!session) {
      throw new Error('No stored NetSuite OAuth session. Authorize the application first.')
    }

    const expiresAt = Date.parse(session.accessTokenExpiresAt)
    if (Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000) {
      return session.accessToken
    }

    return (await this.refreshAccessToken(session)).accessToken
  }

  async revokeStoredSession() {
    const session = this.loadSession()
    if (!session) {
      return {
        revoked: false,
      }
    }

    const url = `${this.config.baseUrl}/services/rest/auth/oauth2/v1/revoke`
    const body = new URLSearchParams({
      token: session.refreshToken,
    })

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: buildBasicAuthorization(this.config.clientId, this.config.clientSecret),
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`NetSuite OAuth revoke HTTP ${response.status}: ${text}`)
      }
    } finally {
      this.clearSession()
    }

    return {
      revoked: true,
    }
  }

  private loadSession() {
    if (!fs.existsSync(this.config.tokenStorePath)) {
      return null
    }

    const raw = fs.readFileSync(this.config.tokenStorePath, 'utf8')
    return JSON.parse(raw) as StoredOAuthSession
  }

  private saveSession(session: StoredOAuthSession) {
    fs.mkdirSync(path.dirname(this.config.tokenStorePath), { recursive: true })
    fs.writeFileSync(this.config.tokenStorePath, JSON.stringify(session, null, 2), 'utf8')
  }

  private clearSession() {
    if (fs.existsSync(this.config.tokenStorePath)) {
      fs.rmSync(this.config.tokenStorePath, { force: true })
    }
  }

  private async refreshAccessToken(session: StoredOAuthSession) {
    const refreshTokenExpiresAt = session.refreshTokenExpiresAt ? Date.parse(session.refreshTokenExpiresAt) : NaN
    if (Number.isFinite(refreshTokenExpiresAt) && refreshTokenExpiresAt <= Date.now()) {
      this.clearSession()
      throw new Error('The stored NetSuite refresh token expired. Authorize the application again.')
    }

    const tokenResponse = await this.requestToken({
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken,
    })

    const now = new Date()
    const refreshedSession: StoredOAuthSession = {
      ...session,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token ?? session.refreshToken,
      tokenType: tokenResponse.token_type,
      accessTokenExpiresAt: new Date(now.getTime() + tokenResponse.expires_in * 1000).toISOString(),
      refreshTokenExpiresAt: tokenResponse.refresh_token
        ? new Date(now.getTime() + DEFAULT_REFRESH_TOKEN_TTL_MS).toISOString()
        : session.refreshTokenExpiresAt,
      idToken: tokenResponse.id_token ?? session.idToken,
      updatedAtUtc: now.toISOString(),
    }

    this.saveSession(refreshedSession)
    return refreshedSession
  }

  private async requestToken(bodyParams: Record<string, string>) {
    const url = `${this.config.baseUrl}/services/rest/auth/oauth2/v1/token`
    const body = new URLSearchParams(bodyParams)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: buildBasicAuthorization(this.config.clientId, this.config.clientSecret),
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })

    const text = await response.text()
    const json = text ? (JSON.parse(text) as TokenEndpointResponse) : null

    if (!response.ok || !json?.access_token) {
      const message = json?.error_description || json?.error || text || 'Unknown NetSuite OAuth error.'
      throw new Error(`NetSuite OAuth token HTTP ${response.status}: ${message}`)
    }

    return json
  }
}

export function getNetSuiteOAuthStatus() {
  const service = NetSuiteOAuthService.fromEnvIfConfigured()
  if (!service) {
    return {
      configured: false,
      connected: false,
      scopes: [],
      authorizationPath: '/api/auth/netsuite/login',
    } satisfies NetSuiteOAuthStatus
  }

  return service.getStatus()
}

export function renderOAuthCallbackPage(options: {
  success: boolean
  title: string
  message: string
  frontendReturnUrl?: string
}) {
  const payload = JSON.stringify({
    source: 'netsuite-oauth',
    success: options.success,
    message: options.message,
  })
  const escapedPayload = payload.replace(/</g, '\\u003c')
  const returnUrl = options.frontendReturnUrl ?? resolveDefaultFrontendReturnUrl()
  const safeTitle = escapeHtml(options.title)
  const safeMessage = escapeHtml(options.message)
  const safeReturnUrl = escapeHtml(returnUrl)

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <style>
      body {
        margin: 0;
        font-family: Segoe UI, Arial, sans-serif;
        background: #f3f6fb;
        color: #142034;
      }
      main {
        max-width: 640px;
        margin: 4rem auto;
        padding: 2rem;
        background: white;
        border-radius: 20px;
        box-shadow: 0 20px 48px rgba(20, 32, 52, 0.12);
      }
      h1 {
        margin-top: 0;
      }
      a {
        color: #145a88;
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${safeTitle}</h1>
      <p>${safeMessage}</p>
      <p><a href="${safeReturnUrl}">Return to the reconciliation console</a></p>
      <p>You can close this window.</p>
    </main>
    <script>
      (function () {
        var payload = ${escapedPayload};
        if (window.opener && typeof window.opener.postMessage === 'function') {
          window.opener.postMessage(payload, '*');
        }
        window.setTimeout(function () {
          window.close();
        }, 1200);
      })();
    </script>
  </body>
</html>`
}

function resolveTokenStorePath(explicitPath?: string) {
  if (explicitPath?.trim()) {
    return explicitPath.trim()
  }

  if (process.env.LOCALAPPDATA?.trim()) {
    return path.join(process.env.LOCALAPPDATA, 'NetSuiteRecon', DEFAULT_STORE_FILE)
  }

  return path.join(process.cwd(), DEFAULT_STORE_FILE)
}

function resolveDefaultFrontendReturnUrl() {
  const publicBaseUrl = process.env.APP_PUBLIC_BASE_URL?.trim().replace(/\/+$/, '')
  if (publicBaseUrl) {
    return `${publicBaseUrl}/#/ingresos`
  }

  return DEFAULT_FRONTEND_RETURN_URL
}

function parseScopes(rawValue?: string) {
  const parsed = rawValue
    ?.split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean)

  return parsed && parsed.length > 0 ? parsed : [...DEFAULT_SCOPES]
}

function buildBasicAuthorization(clientId: string, clientSecret: string) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
}

function buildStoredSession(
  response: TokenEndpointResponse,
  scopes: string[],
): StoredOAuthSession {
  if (!response.refresh_token) {
    throw new Error('NetSuite OAuth did not return a refresh token for the authorization code exchange.')
  }

  const now = new Date()

  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    tokenType: response.token_type,
    scopes,
    accessTokenExpiresAt: new Date(now.getTime() + response.expires_in * 1000).toISOString(),
    refreshTokenExpiresAt: response.refresh_token
      ? new Date(now.getTime() + DEFAULT_REFRESH_TOKEN_TTL_MS).toISOString()
      : undefined,
    idToken: response.id_token,
    createdAtUtc: now.toISOString(),
    updatedAtUtc: now.toISOString(),
  }
}

function pruneExpiredAuthorizations() {
  const cutoff = Date.now() - AUTH_STATE_TTL_MS
  for (const [state, pending] of pendingAuthorizations.entries()) {
    if (pending.createdAt < cutoff) {
      pendingAuthorizations.delete(state)
    }
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
