import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const httpClientPath = new URL('../frontend/src/services/api/httpClient.ts', import.meta.url)

test('httpClient preserves structured error fields for callers', async () => {
  const source = await readFile(httpClientPath, 'utf8')

  assert.match(source, /readonly parsedBody\?: unknown/)
  assert.match(source, /readonly errorCode\?: string/)
  assert.match(source, /readonly errorMessage\?: string/)
  assert.match(source, /function tryParseJsonBody\(body: string\)/)
  assert.match(source, /function resolveStructuredError\(parsedBody: unknown\)/)
  assert.match(source, /const parsedBody = body \? tryParseJsonBody\(body\) : undefined/)
  assert.match(source, /const \{ errorCode, errorMessage \} = resolveStructuredError\(parsedBody\)/)
})
