import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  createBackupFile,
  readJsonFile,
  safeJsonStringify,
  writeJsonFileAtomic,
} from '../backend/dist/infrastructure/storage/fileStoreUtils.js'

function withTempDirectory(callback) {
  const tempDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'file-store-utils-'))

  try {
    callback(tempDirectoryPath)
  } finally {
    fs.rmSync(tempDirectoryPath, { recursive: true, force: true })
  }
}

test('readJsonFile returns the fallback when the file does not exist', () => {
  withTempDirectory((tempDirectoryPath) => {
    const filePath = path.join(tempDirectoryPath, 'missing.json')

    assert.deepEqual(readJsonFile(filePath, { items: [] }), { items: [] })
  })
})

test('readJsonFile reads valid JSON content', () => {
  withTempDirectory((tempDirectoryPath) => {
    const filePath = path.join(tempDirectoryPath, 'valid.json')
    fs.writeFileSync(filePath, '{\n  "value": 42\n}\n', 'utf8')

    assert.deepEqual(readJsonFile(filePath, { value: 0 }), { value: 42 })
  })
})

test('readJsonFile fails explicitly when the JSON is invalid', () => {
  withTempDirectory((tempDirectoryPath) => {
    const filePath = path.join(tempDirectoryPath, 'invalid.json')
    fs.writeFileSync(filePath, '{ invalid json }\n', 'utf8')

    assert.throws(
      () => readJsonFile(filePath, { value: 0 }),
      (error) =>
        error instanceof Error &&
        error.message.includes('Failed to parse JSON file at') &&
        error.message.includes(filePath),
    )
  })
})

test('writeJsonFileAtomic creates a JSON file with a final newline', () => {
  withTempDirectory((tempDirectoryPath) => {
    const filePath = path.join(tempDirectoryPath, 'payload.json')

    writeJsonFileAtomic(filePath, { ok: true })

    const written = fs.readFileSync(filePath, 'utf8')
    assert.equal(written, '{\n  "ok": true\n}\n')
    assert.equal(written.endsWith('\n'), true)
  })
})

test('writeJsonFileAtomic replaces existing content', () => {
  withTempDirectory((tempDirectoryPath) => {
    const filePath = path.join(tempDirectoryPath, 'payload.json')
    fs.writeFileSync(filePath, '{\n  "old": true\n}\n', 'utf8')

    writeJsonFileAtomic(filePath, { next: 'value' })

    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), { next: 'value' })
  })
})

test('createBackupFile creates a .bak copy when the original file exists', () => {
  withTempDirectory((tempDirectoryPath) => {
    const filePath = path.join(tempDirectoryPath, 'payload.json')
    fs.writeFileSync(filePath, safeJsonStringify({ source: 'original' }), 'utf8')

    const backupPath = createBackupFile(filePath)

    assert.equal(backupPath, `${filePath}.bak`)
    assert.equal(fs.existsSync(`${filePath}.bak`), true)
    assert.deepEqual(JSON.parse(fs.readFileSync(`${filePath}.bak`, 'utf8')), { source: 'original' })
  })
})

test('createBackupFile does not fail when the original file does not exist', () => {
  withTempDirectory((tempDirectoryPath) => {
    const filePath = path.join(tempDirectoryPath, 'missing.json')

    assert.equal(createBackupFile(filePath), null)
    assert.equal(fs.existsSync(`${filePath}.bak`), false)
  })
})
