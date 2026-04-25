import fs from 'node:fs'
import path from 'node:path'

let localEnvLoaded = false

export function loadLocalEnv() {
  if (localEnvLoaded) {
    return
  }

  localEnvLoaded = true

  const envFilePath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envFilePath)) {
    return
  }

  const fileContents = fs.readFileSync(envFilePath, 'utf8')
  for (const rawLine of fileContents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    const rawValue = line.slice(separatorIndex + 1).trim()
    if (!key || process.env[key]) {
      continue
    }

    process.env[key] = stripWrappingQuotes(rawValue)
  }
}

function stripWrappingQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}
