import { loadLocalEnv } from './loadLocalEnv.js'
import { createApp, getAppRuntimeInfo } from './app.js'

loadLocalEnv()

const host = process.env.HOST?.trim() || '127.0.0.1'
const port = Number(process.env.PORT ?? 3001)
const publicBaseUrl = process.env.APP_PUBLIC_BASE_URL?.trim().replace(/\/+$/, '') || null
const app = createApp()
const { frontendDistDir, hasFrontendBuild } = getAppRuntimeInfo()

app.listen(port, host, () => {
  if (hasFrontendBuild) {
    console.log(`NetSuite recon frontend served from ${frontendDistDir}`)
  } else {
    console.log(`Frontend build not found at ${frontendDistDir}. API mode only.`)
  }

  console.log(`NetSuite recon backend listening on ${publicBaseUrl ?? `http://${host}:${port}`}`)
})
