import { randomUUID } from 'node:crypto'
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

type FileLockMetadata = {
  lockId: string
  pid: number
  filePath: string
  createdAtUtc: string
}

type FileLockHandle = {
  lockId: string
  lockPath: string
}

type FileLockSnapshot = {
  metadata: FileLockMetadata | null
  raw: string
  size: number
  mtimeMs: number
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
    const lockHandle = tryAcquireLock(lockPath, filePath, now)
    if (lockHandle) {
      return runWithLock(lockHandle, callback)
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

function runWithLock<T>(lockHandle: FileLockHandle, callback: () => T) {
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
    releaseLock(lockHandle)
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
  const metadata: FileLockMetadata = {
    lockId: randomUUID(),
    pid: process.pid,
    filePath,
    createdAtUtc: new Date(now()).toISOString(),
  }

  try {
    descriptor = fs.openSync(lockPath, 'wx')
    const serializedMetadata = `${JSON.stringify(metadata)}\n`

    fs.writeFileSync(descriptor, serializedMetadata, 'utf8')
    return {
      lockId: metadata.lockId,
      lockPath,
    }
  } catch (error) {
    if (isNodeError(error, 'EEXIST')) {
      return null
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

function releaseLock(lockHandle: FileLockHandle) {
  const snapshot = readLockSnapshot(lockHandle.lockPath)
  if (!snapshot) {
    throw new Error(`Failed to release file lock at ${lockHandle.lockPath}: lock file is missing.`)
  }

  if (!snapshot.metadata) {
    throw new Error(
      `Failed to release file lock at ${lockHandle.lockPath}: lock metadata is unreadable, ownership cannot be verified.`,
    )
  }

  if (snapshot.metadata.lockId !== lockHandle.lockId) {
    throw new Error(
      `Failed to release file lock at ${lockHandle.lockPath}: ownership mismatch for lockId ${lockHandle.lockId}.`,
    )
  }

  try {
    fs.rmSync(lockHandle.lockPath)
  } catch (error) {
    throw new Error(
      `Failed to release file lock at ${lockHandle.lockPath}: ${error instanceof Error ? error.message : 'Unknown release error.'}`,
    )
  }
}

function removeStaleLockIfPresent(lockPath: string, staleAfterMs: number, now: () => number) {
  const firstSnapshot = readLockSnapshot(lockPath)
  if (!firstSnapshot) {
    return false
  }

  if (now() - firstSnapshot.mtimeMs < staleAfterMs) {
    return false
  }

  const secondSnapshot = readLockSnapshot(lockPath)
  if (!secondSnapshot) {
    return false
  }

  if (!isSameSnapshot(firstSnapshot, secondSnapshot)) {
    return false
  }

  try {
    fs.rmSync(lockPath)
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

function readLockSnapshot(lockPath: string): FileLockSnapshot | null {
  try {
    const stats = fs.statSync(lockPath)
    const raw = fs.readFileSync(lockPath, 'utf8')
    return {
      metadata: parseLockMetadata(raw),
      raw,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    }
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) {
      return null
    }

    throw new Error(
      `Failed to inspect file lock at ${lockPath}: ${error instanceof Error ? error.message : 'Unknown stat error.'}`,
    )
  }
}

function parseLockMetadata(raw: string): FileLockMetadata | null {
  try {
    const parsed = JSON.parse(raw) as Partial<FileLockMetadata>
    if (
      typeof parsed.lockId !== 'string' ||
      typeof parsed.pid !== 'number' ||
      typeof parsed.filePath !== 'string' ||
      typeof parsed.createdAtUtc !== 'string'
    ) {
      return null
    }

    return {
      lockId: parsed.lockId,
      pid: parsed.pid,
      filePath: parsed.filePath,
      createdAtUtc: parsed.createdAtUtc,
    }
  } catch {
    return null
  }
}

function isSameSnapshot(firstSnapshot: FileLockSnapshot, secondSnapshot: FileLockSnapshot) {
  return (
    firstSnapshot.raw === secondSnapshot.raw &&
    firstSnapshot.size === secondSnapshot.size &&
    firstSnapshot.mtimeMs === secondSnapshot.mtimeMs
  )
}
