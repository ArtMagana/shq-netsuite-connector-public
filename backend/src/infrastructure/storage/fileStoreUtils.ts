import fs from 'node:fs'
import path from 'node:path'

type JsonFallback<T> = T | (() => T)

export function readJsonFile<T>(filePath: string, fallback: JsonFallback<T>) {
  if (!fs.existsSync(filePath)) {
    return resolveFallback(fallback)
  }

  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, '')

  try {
    return JSON.parse(raw) as T
  } catch (error) {
    throw new Error(
      `Failed to parse JSON file at ${filePath}: ${error instanceof Error ? error.message : 'Unknown parse error.'}`,
    )
  }
}

export function writeJsonFileAtomic(filePath: string, data: unknown) {
  const directoryPath = path.dirname(filePath)
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  const payload = safeJsonStringify(data)

  fs.mkdirSync(directoryPath, { recursive: true })

  try {
    fs.writeFileSync(temporaryPath, payload, 'utf8')
    fs.renameSync(temporaryPath, filePath)
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.rmSync(temporaryPath, { force: true })
    }
  }
}

export function createBackupFile(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return null
  }

  const backupPath = `${filePath}.bak`
  fs.copyFileSync(filePath, backupPath)
  return backupPath
}

export function safeJsonStringify(data: unknown) {
  const serialized = JSON.stringify(data, null, 2)

  if (typeof serialized !== 'string') {
    throw new Error('Unable to serialize JSON payload for file store persistence.')
  }

  return `${serialized}\n`
}

function resolveFallback<T>(fallback: JsonFallback<T>) {
  return typeof fallback === 'function' ? (fallback as () => T)() : fallback
}
