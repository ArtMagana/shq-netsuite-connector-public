import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BANK_ANALYSIS_START_VALIDATION_ERROR,
  BANK_ANALYZE_VALIDATION_ERROR,
} from '../backend/dist/routes/bancosErrorCodes.js'
import {
  isBancosAnalysisStartRequest,
  isBancosAnalyzeRequest,
} from '../backend/dist/routes/bancosValidation.js'
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

test('bancos validation error codes stay stable', () => {
  assert.equal(BANK_ANALYZE_VALIDATION_ERROR, 'BANK_ANALYZE_VALIDATION_ERROR')
  assert.equal(BANK_ANALYSIS_START_VALIDATION_ERROR, 'BANK_ANALYSIS_START_VALIDATION_ERROR')
})

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

test('validateBody responds with bancos-specific validation code', () => {
  const middleware = validateBody(
    isBancosAnalyzeRequest,
    'Body invalido.',
    BANK_ANALYZE_VALIDATION_ERROR,
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
    code: BANK_ANALYZE_VALIDATION_ERROR,
  })
})

test('startBankImportAnalysisRun returns a structured failure for invalid requests', () => {
  const result = startBankImportAnalysisRun({
    bankId: 'bbva',
    fileName: 'statement.csv',
    fileBase64: '',
  })

  assert.equal(result.success, false)
  assert.equal(result.code, 'BANK_IMPORT_ERROR')
  assert.equal(result.error, 'Debes adjuntar el archivo bancario en base64.')
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'fileBase64'), false)
})
