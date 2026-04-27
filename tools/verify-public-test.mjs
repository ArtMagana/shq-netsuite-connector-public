import assert from 'node:assert/strict'

function resolveBaseUrl(input) {
  if (!input) {
    throw new Error('Usage: node tools/verify-public-test.mjs <base-url>')
  }

  return input.replace(/\/+$/, '')
}

async function fetchText(url, options) {
  const response = await fetch(url, options)
  const body = await response.text()
  return { response, body }
}

async function verifyHealth(baseUrl) {
  const { response, body } = await fetchText(`${baseUrl}/api/health`)
  assert.equal(response.status, 200, 'GET /api/health must return HTTP 200')

  const payload = JSON.parse(body)
  assert.equal(payload.status, 'ok', 'GET /api/health must report status ok')
  assert.equal(
    payload.service,
    'netsuite-recon-backend',
    'GET /api/health must report the backend service name',
  )

  return payload
}

async function verifyRootHtml(baseUrl) {
  const { response, body } = await fetchText(`${baseUrl}/`)
  assert.equal(response.status, 200, 'GET / must return HTTP 200')
  assert.match(body, /<html/i, 'GET / must return HTML')
  assert.match(body, /id="root"/i, 'GET / must include the frontend root node')
  return body
}

async function verifyProtectedValidation(baseUrl) {
  const invalidPayload = JSON.stringify({
    bankId: '',
    fileName: '',
    fileBase64: '',
  })

  const withoutKey = await fetchText(`${baseUrl}/api/bancos/analysis/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: invalidPayload,
  })

  assert.equal(withoutKey.response.status, 401, 'Protected route must reject missing key')
  assert.deepEqual(JSON.parse(withoutKey.body), {
    error: 'Invalid internal API key.',
    code: 'INTERNAL_API_KEY_INVALID',
  })

  const withDummyKey = await fetchText(`${baseUrl}/api/bancos/analysis/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Internal-Api-Key': 'dummy-public-test-key',
    },
    body: invalidPayload,
  })

  assert.equal(withDummyKey.response.status, 400, 'Protected route must reach validation with dummy key')
  assert.deepEqual(JSON.parse(withDummyKey.body), {
    error: 'La solicitud de analisis bancario no es valida.',
    code: 'BANK_ANALYSIS_START_VALIDATION_ERROR',
  })
}

async function verifyFrontendBundleContainsDummyKey(baseUrl, html) {
  const assetPaths = Array.from(
    html.matchAll(/<script[^>]+src="([^"]+assets\/[^"]+\.js)"/gi),
    (match) => match[1],
  )

  assert.ok(assetPaths.length > 0, 'Frontend HTML must reference at least one JS asset bundle')

  const bundleBodies = await Promise.all(
    assetPaths.map(async (assetPath) => {
      const assetUrl = assetPath.startsWith('http') ? assetPath : `${baseUrl}${assetPath}`
      const { response, body } = await fetchText(assetUrl)
      assert.equal(response.status, 200, `Asset ${assetPath} must be reachable`)
      return body
    }),
  )

  assert.ok(
    bundleBodies.some((body) => body.includes('dummy-public-test-key')),
    'Frontend bundle must contain the dummy VITE_INTERNAL_API_KEY value',
  )
}

async function main() {
  const baseUrl = resolveBaseUrl(process.argv[2])
  const health = await verifyHealth(baseUrl)
  const html = await verifyRootHtml(baseUrl)
  await verifyProtectedValidation(baseUrl)
  await verifyFrontendBundleContainsDummyKey(baseUrl, html)

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        checks: {
          health: 'ok',
          rootHtml: 'ok',
          protectedValidation: 'ok',
          frontendDummyKey: 'ok',
        },
        health,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
