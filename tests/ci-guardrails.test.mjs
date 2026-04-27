import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('CI workflow enforces npm ci, encoding checks, and npm test', async () => {
  const ciSource = await readFile(
    new URL('../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  )

  assert.match(ciSource, /npm --prefix backend ci/)
  assert.match(ciSource, /npm --prefix frontend ci/)
  assert.match(ciSource, /python3 tools\/check-text-encoding\.py/)
  assert.match(ciSource, /npm test/)
})

test('encoding diagnostic scans the repo for BOM and dangerous hidden Unicode', async () => {
  const scriptSource = await readFile(
    new URL('../tools/check-text-encoding.py', import.meta.url),
    'utf8',
  )

  assert.match(scriptSource, /BIDI_CODEPOINTS/)
  assert.match(scriptSource, /INVISIBLE_DANGEROUS_CODEPOINTS/)
  assert.match(scriptSource, /def iter_files\(\)/)
  assert.match(scriptSource, /dangerous hidden Unicode/i)
})
