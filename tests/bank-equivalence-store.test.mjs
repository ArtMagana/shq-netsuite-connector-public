import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  loadBankEquivalenceOverrides,
  upsertBankEquivalenceOverride,
} from '../backend/dist/bankEquivalenceStore.js'

const MULTI_PROCESS_WORKER_PATH = path.join(process.cwd(), 'tests', 'fixtures', 'bank-equivalence-upsert-worker.mjs')

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

function runUpsertWorker(filePath, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MULTI_PROCESS_WORKER_PATH, JSON.stringify(payload)], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BANKS_EQUIVALENCE_OVERRIDE_STORE_PATH: filePath,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    })

    let stderr = ''

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve(undefined)
        return
      }

      reject(new Error(`Worker exited with code ${code}: ${stderr.trim() || 'No stderr output.'}`))
    })
  })
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

test('upsertBankEquivalenceOverride recovers from a stale lock file and cleans it up', { concurrency: false }, () => {
  withTempDirectory((tempDirectoryPath) => {
    const filePath = path.join(tempDirectoryPath, 'bank-equivalence-overrides.json')
    const lockPath = `${filePath}.lock`
    const staleTimestamp = new Date(Date.now() - 60_000)

    fs.writeFileSync(lockPath, '{"pid":999}\n', 'utf8')
    fs.utimesSync(lockPath, staleTimestamp, staleTimestamp)

    withEquivalenceStorePath(filePath, () => {
      const stored = upsertBankEquivalenceOverride(createOverrideInput())
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))

      assert.equal(parsed.items.length, 1)
      assert.equal(parsed.items[0].normalizedCounterpartyName, 'ACME SA DE CV')
      assert.equal(stored.normalizedCounterpartyName, 'ACME SA DE CV')
      assert.equal(fs.existsSync(lockPath), false)
    })
  })
})

test('upsertBankEquivalenceOverride preserves all records across multi-process upserts', { concurrency: false }, async () => {
  const tempDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-equivalence-multiprocess-'))

  try {
    const filePath = path.join(tempDirectoryPath, 'bank-equivalence-overrides.json')
    const payloads = Array.from({ length: 5 }, (_, index) =>
      createOverrideInput({
        counterpartyName: `Counterparty ${index + 1}`,
        normalizedCounterpartyName: `COUNTERPARTY ${index + 1}`,
        compactCounterpartyName: `COUNTERPARTY${index + 1}`,
        selectedBankName: `BANK ${index + 1}`,
        netsuiteName: `NETSUITE ${index + 1}`,
      }),
    )

    await Promise.all(payloads.map((payload) => runUpsertWorker(filePath, payload)))

    withEquivalenceStorePath(filePath, () => {
      const items = loadBankEquivalenceOverrides()
      const normalizedNames = items.map((item) => item.normalizedCounterpartyName).sort()

      assert.equal(items.length, payloads.length)
      assert.deepEqual(
        normalizedNames,
        payloads.map((payload) => payload.normalizedCounterpartyName).sort(),
      )
      assert.equal(fs.existsSync(`${filePath}.lock`), false)
    })
  } finally {
    fs.rmSync(tempDirectoryPath, { recursive: true, force: true })
  }
})
