import { upsertBankEquivalenceOverride } from '../../backend/dist/bankEquivalenceStore.js'

const serializedPayload = process.argv[2]

if (typeof serializedPayload !== 'string' || serializedPayload.length === 0) {
  console.error('Missing upsert payload argument.')
  process.exit(1)
}

try {
  upsertBankEquivalenceOverride(JSON.parse(serializedPayload))
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
}
