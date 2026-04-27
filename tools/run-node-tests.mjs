import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const toolsDir = dirname(fileURLToPath(import.meta.url))
const testsDir = resolve(toolsDir, '../tests')

const testFiles = readdirSync(testsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.test.mjs'))
  .map((entry) => relative(process.cwd(), resolve(testsDir, entry.name)))
  .sort()

if (testFiles.length === 0) {
  console.error('No test files matched tests/*.test.mjs')
  process.exit(1)
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
