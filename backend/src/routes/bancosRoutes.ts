import { Router } from 'express'
import { requireInternalApiKey } from '../internalApiKey.js'

function getErrorStatus(error: unknown) {
  return error instanceof Error && 'status' in error ? Number(error.status) : 503
}

export function createBancosRoutes(deps: any) {
  const { analyzeBankImport, startBankImportAnalysisRun, getBankImportConfig, BankImportError } = deps
  const router = Router()

  router.post('/analyze', async (request, response) => {
    try {
      response.json(await analyzeBankImport(request.body))
    } catch (error) {
      const status = getErrorStatus(error)
      response.status(status).json({
        error: error instanceof Error ? error.message : 'Unknown bank import error.',
      })
    }
  })


  router.post('/analysis/start, requireInternalApiKey, (request, response) => {
  try {
    response.json(startBankImportAnalysisRun(request.body))
  } catch (error) {
    response.status(getErrorStatus(error)).json({
      error: error instanceof Error ? error.message : 'Could not start bank analysis.',
    })
  }
})


  router.get('/config', (_request, response) => {
    try {
      response.json(getBankImportConfig())
    } catch (error: any) {
      const status = getErrorStatus(error)
      response.status(status).json({
        error: error instanceof Error ? error.message : 'Unknown bank config error.',
      })
    }
  })

  return router
}

