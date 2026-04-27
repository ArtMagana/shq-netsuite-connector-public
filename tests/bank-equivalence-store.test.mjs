import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  loadBankEquivalenceOverrides,
  upsertBankEquivalenceOverride,
} from '../backend/dist/bankEquivalenceStore.js'

function withTempDirectory(callback) {
  const tempDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-equivalence-store-'))

  try {
    callback(tempDirectoryPath)
  } finally {
    fs.rmSync(tempDirectoryPath, { recursive: true, force: true })
  }
}

function withEquivalenceStorePath(filePath, callback) {
  const previousValue = process.env.BANKS_EQUIVALENCE_OVERRIDE_STORE_PATH

  process.env.BANKS_EQUIVALENCE_OVERRIDE_STORE_PATH = filePath

  try {
    callback()
  } finally {
    if (typeof previousValue === 'string') {
      process.env.BANKS_EQUIVALENCE_OVERRIDE_STORE_PATH = previousValue
    } else {
      delete process.env.BANKS_EQUIVALENCE_OVERRIDE_STORE_PATH
    }
  }
}

function createOverrideInput(overrides = {}) {
  return {
    bankId: 'bbva',
    sourceProfileId: 'bbva_pdf',
    mappingSheetKey: 'customers',
    counterpartyName: 'Acme SA de CV',
    normalizedCounterpartyName: 'ACME SA DE CV',
    compactCounterpartyName: 'ACMESADECV',
    selectedBankName: 'ACME SA',
    netsuiteName: 'ACME CUSTOMER',
    creditAccount: '1150',
    ...overrides,
  }
}

test('loadBankEquivalenceOverrides returns an empty array when the file does not exist', { concurrency: false }, () => {
  withTempDirectory((tempDirectoryPath) => {
    const filePath = path.join(tempDirectoryPath, 'bank-equivalence-overrides.json')

    withEquivalenceStorePath(filePath, () => {
      assert.deepEqual(loadBankEquivalenceOverrides(), [])
    })
  })
})

test('upsertBankEquivalenceOverride creates a version 2 file with one item', { concurrency: false }, () => {
  withTempDirectory((tempDirectoryPath) => {
    const filePath = path.join(tempDirectoryPath, 'bank-equivalence-overrides.json')

    withEquivalenceStorePath(filePath, () => {
      const stored = upsertBankEquivalenceOverride(createOverrideInput())
      const rawFile = fs.readFileSync(filePath, 'utf8')
      const parsed = JSON.parse(rawFile)

      assert.equal(parsed.version, 2)
      assert.equal(parsed.items.length, 1)
      assert.equal(parsed.items[0].bankId, 'bbva')
      assert.equal(typeof parsed.items[0].createdAtUtc, 'string')
      assert.equal(typeof parsed.items[0].updatedAtUtc, 'string')
      assert.equal(stored.createdAtUtc, parsed.items[0].createdAtUtc)
      assert.equal(stored.updatedAtUtc, parsed.items[0].updatedAtUtc)
    })
  })
})

test('upsertBankEquivalenceOverride updates the same item without duplicating it and creates a backup', { concurrency: false }, () => {
  withTempDirectory((tempDirectoryPath) => {
    const filePath = path.join(tempDirectoryPath, 'bank-equivalence-overrides.json')

    withEquivalenceStorePath(filePath, () => {
      const first = upsertBankEquivalenceOverride(createOverrideInput())
      const second = upsertBankEquivalenceOverride(
        createOverrideInput({
          selectedBankName: 'ACME SA UPDATED',
          netsuiteName: 'ACME CUSTOMER UPDATED',
        }),
      )

      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      const backup = JSON.parse(fs.readFileSync(`${filePath}.bak`, 'utf8'))

      assert.equal(parsed.items.length, 1)
      assert.equal(parsed.items[0].selectedBankName, 'ACME SA UPDATED')
      assert.equal(parsed.items[0].netsuiteName, 'ACME CUSTOMER UPDATED')
      assert.equal(second.createdAtUtc, first.createdAtUtc)
      assert.equal(second.updatedAtUtc >= first.updatedAtUtc, true)
      assert.equal(fs.existsSync(`${filePath}.bak`), true)
      assert.equal(backup.items.length, 1)
      assert.equal(backup.items[0].selectedBankName, 'ACME SA')
    })
  })
})

test('loadBankEquivalenceOverrides throws an explicit error when the JSON file is corrupt', { concurrency: false }, () => {
  withTempDirectory((tempDirectoryPath) => {
    const filePath = path.join(tempDirectoryPath, 'bank-equivalence-overrides.json')
    fs.writeFileSync(filePath, '{ invalid json }\n', 'utf8')

    withEquivalenceStorePath(filePath, () => {
      assert.throws(
        () => loadBankEquivalenceOverrides(),
        (error) =>
          error instanceof Error &&
          error.message.includes('Failed to parse JSON file at') &&
          error.message.includes(filePath),
      )
    })
  })
})
