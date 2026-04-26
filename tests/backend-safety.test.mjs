import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isBancosAnalysisStartRequest,
  isBancosAnalyzeRequest,
} from '../backend/dist/routes/bancosValidation.js'
import { requireInternalApiKey } from '../backend/dist/internalApiKey.js'
import { validateBody } from '../backend/dist/routes/validationMiddleware.js'

function createMockResponse() {
  return {
    statusCode: undefined,
    payload: undefined,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.payload = payload
      return this
    },
  }
}

function withInternalApiKey(value, callback) {
  const previousValue = process.env.INTERNAL_API_KEY

  if (typeof value === 'string') {
    process.env.INTERNAL_API_KEY = value
  } else {
    delete process.env.INTERNAL_API_KEY
  }

  try {
    callback()
  } finally {
    if (typeof previousValue === 'string') {
      process.env.INTERNAL_API_KEY = previousValue
    } else {
      delete process.env.INTERNAL_API_KEY
    }
  }
}

test('isBancosAnalyzeRequest accepts a non-empty bankId', () => {
  assert.equal(isBancosAnalyzeRequest({ bankId: 'bbva' }), true)
  assert.equal(isBancosAnalyzeRequest({ bankId: '   ' }), false)
  assert.equal(isBancosAnalyzeRequest(null), false)
})

test('isBancosAnalysisStartRequest requires bankId, fileName and fileBase64', () => {
  assert.equal(
    isBancosAnalysisStartRequest({
      bankId: 'bbva',
      fileName: 'statement.csv',
      fileBase64: 'ZHVtbXk=',
    }),
    true,
  )
  assert.equal(
    isBancosAnalysisStartRequest({
      bankId: 'bbva',
      fileName: 'statement.csv',
    }),
    false,
  )
})

test('validateBody responds with error and code when the request body is invalid', () => {
  const middleware = validateBody(
    isBancosAnalyzeRequest,
    'Body invalido.',
    'BANK_ANALYZE_VALIDATION_ERROR',
  )
  const response = createMockResponse()
  let nextCalled = false

  middleware(
    { body: { bankId: '' } },
    response,
    () => {
      nextCalled = true
    },
  )

  assert.equal(nextCalled, false)
  assert.equal(response.statusCode, 400)
  assert.deepEqual(response.payload, {
    error: 'Body invalido.',
    code: 'BANK_ANALYZE_VALIDATION_ERROR',
  })
})

test('validateBody delegates to next when the request body is valid', () => {
  const middleware = validateBody(
    isBancosAnalyzeRequest,
    'Body invalido.',
    'BANK_ANALYZE_VALIDATION_ERROR',
  )
  const response = createMockResponse()
  let nextCalled = false

  middleware(
    { body: { bankId: 'bbva' } },
    response,
    () => {
      nextCalled = true
    },
  )

  assert.equal(nextCalled, true)
  assert.equal(response.statusCode, undefined)
  assert.equal(response.payload, undefined)
})

test('requireInternalApiKey returns 503 with code when the server is not configured', () => {
  withInternalApiKey(undefined, () => {
    const response = createMockResponse()
    let nextCalled = false

    requireInternalApiKey(
      { header: () => undefined },
      response,
      () => {
        nextCalled = true
      },
    )

    assert.equal(nextCalled, false)
    assert.equal(response.statusCode, 503)
    assert.deepEqual(response.payload, {
      error: 'Internal API key is not configured.',
      code: 'INTERNAL_API_KEY_MISSING',
    })
  })
})

test('requireInternalApiKey returns 401 with code when the key is invalid', () => {
  withInternalApiKey('expected-key', () => {
    const response = createMockResponse()
    let nextCalled = false

    requireInternalApiKey(
      { header: () => 'wrong-key' },
      response,
      () => {
        nextCalled = true
      },
    )

    assert.equal(nextCalled, false)
    assert.equal(response.statusCode, 401)
    assert.deepEqual(response.payload, {
      error: 'Invalid internal API key.',
      code: 'INTERNAL_API_KEY_INVALID',
    })
  })
})

test('requireInternalApiKey delegates to next when the key is valid', () => {
  withInternalApiKey('expected-key', () => {
    const response = createMockResponse()
    let nextCalled = false

    requireInternalApiKey(
      { header: () => 'expected-key' },
      response,
      () => {
        nextCalled = true
      },
    )

    assert.equal(nextCalled, true)
    assert.equal(response.statusCode, undefined)
    assert.equal(response.payload, undefined)
  })
})
