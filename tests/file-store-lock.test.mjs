import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { resolveLockPath, withFileLock } from '../backend/dist/infrastructure/storage/fileStoreLock.js'

function withTempDirectory(callback) {
  const tempDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'file-store-lock-'))

  try {
    callback(tempDirectoryPath)
  } finally {
    fs.rmSync(tempDirectoryPath, { recursive: true, force: true })
  }
}

test('withFileLock executes the callback and returns its result', () => {
  withTempDirectory((tempDirectoryPath) => {
    const filePath = path.join(tempDirectoryPath, 'store.json')
    const result = withFileLock(filePath, () => 'locked')

    assert.equal(result, 'locked')
    assert.equal(fs.existsSync(resolveLockPath(filePath)), false)
  })
})

test('withFileLock releases the lock even when the callback throws', () => {
  withTempDirectory((tempDirectoryPath) => {
    const filePath = path.join(tempDirectoryPath, 'store.json')
    const lockPath = resolveLockPath(filePath)

    assert.throws(() => {
      withFileLock(filePath, () => {
        throw new Error('boom')
      })
    }, /boom/)

    assert.equal(fs.existsSync(lockPath), false)
  })
})

test('withFileLock prevents a second lock on the same file while the first lock is active', () => {
  withTempDirectory((tempDirectoryPath) => {
    const filePath = path.join(tempDirectoryPath, 'store.json')
    const lockPath = resolveLockPath(filePath)

    withFileLock(filePath, () => {
      assert.equal(fs.existsSync(lockPath), true)
      assert.throws(
        () =>
          withFileLock(
            filePath,
            () => 'nested',
            {
              retryDelayMs: 5,
              timeoutMs: 40,
              staleAfterMs: 10_000,
            },
          ),
        /Timed out acquiring file lock/,
      )
    })

    assert.equal(fs.existsSync(lockPath), false)
  })
})

test('withFileLock allows separate locks for different files', () => {
  withTempDirectory((tempDirectoryPath) => {
    const firstFilePath = path.join(tempDirectoryPath, 'first.json')
    const secondFilePath = path.join(tempDirectoryPath, 'second.json')

    const result = withFileLock(firstFilePath, () =>
      withFileLock(secondFilePath, () => `${path.basename(firstFilePath)}:${path.basename(secondFilePath)}`),
    )

    assert.equal(result, 'first.json:second.json')
    assert.equal(fs.existsSync(resolveLockPath(firstFilePath)), false)
    assert.equal(fs.existsSync(resolveLockPath(secondFilePath)), false)
  })
})

test('withFileLock removes a stale lock file before entering the callback', () => {
  withTempDirectory((tempDirectoryPath) => {
    const filePath = path.join(tempDirectoryPath, 'store.json')
    const lockPath = resolveLockPath(filePath)
    const staleTimestamp = new Date(Date.now() - 60_000)

    fs.mkdirSync(path.dirname(lockPath), { recursive: true })
    fs.writeFileSync(lockPath, '{"pid":999}\n', 'utf8')
    fs.utimesSync(lockPath, staleTimestamp, staleTimestamp)

    const result = withFileLock(
      filePath,
      () => {
        assert.equal(fs.existsSync(lockPath), true)
        return 'recovered'
      },
      {
        retryDelayMs: 5,
        timeoutMs: 100,
        staleAfterMs: 50,
      },
    )

    assert.equal(result, 'recovered')
    assert.equal(fs.existsSync(lockPath), false)
  })
})

test('withFileLock does not remove a lock file replaced by another owner before release', () => {
  withTempDirectory((tempDirectoryPath) => {
    const filePath = path.join(tempDirectoryPath, 'store.json')
    const lockPath = resolveLockPath(filePath)

    assert.throws(
      () =>
        withFileLock(filePath, () => {
          fs.rmSync(lockPath)
          fs.writeFileSync(
            lockPath,
            `${JSON.stringify({
              lockId: 'different-owner',
              pid: 999,
              filePath,
              createdAtUtc: new Date().toISOString(),
            })}\n`,
            'utf8',
          )
        }),
      /ownership mismatch/,
    )

    assert.equal(fs.existsSync(lockPath), true)
    assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).lockId, 'different-owner')
  })
})

test('withFileLock tolerates stale lock files with unexpected metadata', () => {
  withTempDirectory((tempDirectoryPath) => {
    const filePath = path.join(tempDirectoryPath, 'store.json')
    const lockPath = resolveLockPath(filePath)
    const staleTimestamp = new Date(Date.now() - 60_000)

    fs.writeFileSync(lockPath, 'not-json\n', 'utf8')
    fs.utimesSync(lockPath, staleTimestamp, staleTimestamp)

    const result = withFileLock(
      filePath,
      () => 'recovered-unexpected-metadata',
      {
        retryDelayMs: 5,
        timeoutMs: 100,
        staleAfterMs: 50,
      },
    )

    assert.equal(result, 'recovered-unexpected-metadata')
    assert.equal(fs.existsSync(lockPath), false)
  })
})
