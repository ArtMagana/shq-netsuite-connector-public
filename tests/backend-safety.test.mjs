import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

async function withEnv(overrides, callback) {
  const previousValues = new Map()

  for (const [key, value] of Object.entries(overrides)) {
    previousValues.set(key, process.env[key])
    if (typeof value === 'string') {
      process.env[key] = value
    } else {
      delete process.env[key]
    }
  }

  try {
    return await callback()
  } finally {
    for (const [key, value] of previousValues.entries()) {
      if (typeof value === 'string') {
        process.env[key] = value
      } else {
        delete process.env[key]
      }
    }
  }
}

test('createApp wires route dependencies without throwing', async () => {
  await withEnv(
    {
      ALLOWED_ORIGINS: undefined,
      APP_ENV: undefined,
      FRONTEND_DIST_DIR: path.resolve('frontend/dist'),
      NODE_ENV: 'test',
    },
    async () => {
      const { createApp } = await import('../backend/dist/app.js')

      assert.doesNotThrow(() => {
        const app = createApp()
        assert.equal(typeof app.use, 'function')
      })
    },
  )
})
