import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const requiredDocs = [
  '../docs/codex/claude-audit-triage.md',
  '../docs/codex/error-contract-roadmap.md',
  '../docs/codex/runtime-validation-plan.md',
  '../docs/codex/testing-plan.md',
  '../docs/codex/csrf-threat-model.md',
  '../docs/codex/env-validation-plan.md',
  '../docs/codex/frontend-premium-plan.md',
  '../docs/codex/token-vault-design.md',
]

test('architecture roadmap docs exist and keep file-store work out of this PR', async () => {
  for (const relativePath of requiredDocs) {
    await access(new URL(relativePath, import.meta.url))
  }

  const triageSource = await readFile(
    new URL('../docs/codex/claude-audit-triage.md', import.meta.url),
    'utf8',
  )

  assert.match(triageSource, /## File locks \/ file stores/)
  assert.match(triageSource, /tratarlo en una rama y PR separados/)

  await assert.rejects(
    access(new URL('../docs/codex/file-store-reliability-plan.md', import.meta.url)),
  )
})
