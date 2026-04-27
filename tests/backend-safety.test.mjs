import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import {
  BANK_ANALYSIS_START_VALIDATION_ERROR,
  BANK_ANALYZE_VALIDATION_ERROR,
} from '../backend/dist/routes/bancosErrorCodes.js'
import {
  isBancosAnalysisStartRequest,
  isBancosAnalyzeRequest,
} from '../backend/dist/routes/bancosValidation.js'
import { requireInternalApiKey } from '../backend/dist/internalApiKey.js'
import { startBankImportAnalysisRun } from '../backend/dist/services/bancosService.js'
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

async function withEnv(overrides, callback) {
  const previousValues = new Map()

  for (const [key, value] of Object.entries(overrides)) {
    previousValues.set(key, process.env[key])
    if (typeof value === 'string') {
      process.env[key] = value
    } else {
      delete process.env[key]
    }
  }

  try {
    return await callback()
  } finally {
    for (const [key, value] of previousValues.entries()) {
      if (typeof value === 'string') {
        process.env[key] = value
      } else {
        delete process.env[key]
      }
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

test('bancos validation error codes stay stable', () => {
  assert.equal(BANK_ANALYZE_VALIDATION_ERROR, 'BANK_ANALYZE_VALIDATION_ERROR')
  assert.equal(BANK_ANALYSIS_START_VALIDATION_ERROR, 'BANK_ANALYSIS_START_VALIDATION_ERROR')
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

test('createApp wires route dependencies without throwing', async () => {
  await withEnv(
    {
      ALLOWED_ORIGINS: undefined,
      APP_ENV: undefined,
      FRONTEND_DIST_DIR: path.resolve('frontend/dist'),
      NODE_ENV: 'test',
    },
    async () => {
      const { createApp } = await import('../backend/dist/app.js')

      assert.doesNotThrow(() => {
        const app = createApp()
        assert.equal(typeof app.use, 'function')
      })
    },
  )
})

test('startBankImportAnalysisRun returns a structured failure for invalid requests without leaking fileBase64', () => {
  const originalConsoleInfo = console.info
  const capturedLogs = []
  console.info = (message) => {
    capturedLogs.push(message)
  }

  try {
    const result = startBankImportAnalysisRun({
      bankId: 'bbva',
      fileName: 'statement.csv',
      fileBase64: '',
    })

    assert.equal(result.success, false)
    assert.equal(result.error, 'Debes adjuntar el archivo bancario en base64.')
    assert.equal(result.code, 'BANK_IMPORT_ERROR')
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'fileBase64'), false)

    assert.equal(capturedLogs.length, 1)
    const payload = JSON.parse(String(capturedLogs[0]))
    assert.equal(payload.scope, 'bancos.service')
    assert.equal(payload.event, 'analysis_start_failed')
    assert.equal(payload.bankId, 'bbva')
    assert.equal(payload.fileName, 'statement.csv')
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'fileBase64'), false)
  } finally {
    console.info = originalConsoleInfo
  }
})
