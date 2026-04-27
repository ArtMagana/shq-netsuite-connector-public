import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_RETRY_DELAY_MS = 25
const DEFAULT_TIMEOUT_MS = 2_000
const DEFAULT_STALE_AFTER_MS = 30_000

export type FileLockOptions = {
  retryDelayMs?: number
  timeoutMs?: number
  staleAfterMs?: number
  now?: () => number
  sleep?: (milliseconds: number) => void
}

export function withFileLock<T>(filePath: string, callback: () => T, options: FileLockOptions = {}) {
  const lockPath = resolveLockPath(filePath)
  const retryDelayMs = normalizePositiveNumber(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS)
  const timeoutMs = normalizePositiveNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS)
  const staleAfterMs = normalizePositiveNumber(options.staleAfterMs, DEFAULT_STALE_AFTER_MS)
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? sleepSync
  const deadline = now() + timeoutMs

  fs.mkdirSync(path.dirname(lockPath), { recursive: true })

  while (true) {
    if (tryAcquireLock(lockPath, filePath, now)) {
      return runWithLock(lockPath, callback)
    }

    if (removeStaleLockIfPresent(lockPath, staleAfterMs, now)) {
      continue
    }

    if (now() >= deadline) {
      throw new Error(`Timed out acquiring file lock for ${filePath} after ${timeoutMs}ms.`)
    }

    sleep(retryDelayMs)
  }
}

export function resolveLockPath(filePath: string) {
  return `${filePath}.lock`
}

function runWithLock<T>(lockPath: string, callback: () => T) {
  let callbackResult: T | undefined
  let callbackError: unknown
  let didCallbackThrow = false

  try {
    callbackResult = callback()
  } catch (error) {
    didCallbackThrow = true
    callbackError = error
  }

  try {
    releaseLock(lockPath)
  } catch (error) {
    if (didCallbackThrow) {
      throw callbackError
    }

    throw error
  }

  if (didCallbackThrow) {
    throw callbackError
  }

  return callbackResult as T
}

function tryAcquireLock(lockPath: string, filePath: string, now: () => number) {
  let descriptor: number | null = null

  try {
    descriptor = fs.openSync(lockPath, 'wx')
    const metadata = `${JSON.stringify({
      pid: process.pid,
      filePath,
      createdAtUtc: new Date(now()).toISOString(),
    })}\n`

    fs.writeFileSync(descriptor, metadata, 'utf8')
    return true
  } catch (error) {
    if (isNodeError(error, 'EEXIST')) {
      return false
    }

    throw new Error(
      `Failed to acquire file lock at ${lockPath}: ${error instanceof Error ? error.message : 'Unknown lock error.'}`,
    )
  } finally {
    if (descriptor !== null) {
      fs.closeSync(descriptor)
    }
  }
}

function releaseLock(lockPath: string) {
  try {
    fs.rmSync(lockPath, { force: true })
  } catch (error) {
    throw new Error(
      `Failed to release file lock at ${lockPath}: ${error instanceof Error ? error.message : 'Unknown release error.'}`,
    )
  }
}

function removeStaleLockIfPresent(lockPath: string, staleAfterMs: number, now: () => number) {
  try {
    const stats = fs.statSync(lockPath)
    if (now() - stats.mtimeMs < staleAfterMs) {
      return false
    }

    fs.rmSync(lockPath, { force: true })
    return true
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) {
      return false
    }

    throw new Error(
      `Failed to inspect file lock at ${lockPath}: ${error instanceof Error ? error.message : 'Unknown stat error.'}`,
    )
  }
}

function sleepSync(milliseconds: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

function normalizePositiveNumber(value: number | undefined, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback
  }

  return Math.floor(value)
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === code)
}
