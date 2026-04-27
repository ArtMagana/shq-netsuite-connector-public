import assert from 'node:assert/strict'
import test from 'node:test'

import { requireInternalApiKey } from '../backend/dist/internalApiKey.js'

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
