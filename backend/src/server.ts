import { loadLocalEnv } from './loadLocalEnv.js'
import { createApp } from './app.js'

loadLocalEnv()

const host = process.env.HOST?.trim() || '127.0.0.1'
const port = Number(process.env.PORT ?? 3001)
const app = createApp()

app.listen(port, host, () => {
  console.log(`NetSuite reconciliation backend listening at http://${host}:${port}`)
})
