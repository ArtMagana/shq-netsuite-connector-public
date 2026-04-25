import { Router } from 'express'
import type { Request, Response } from 'express'
import { requireInternalApiKey } from '../internalApiKey.js'
import type { BancosAnalysisStartRequest, BancosServiceResult } from '../services/bancosService.js'

function getErrorStatus(error: unknown) {
  return error instanceof Error && 'status' in error ? Number(error.status) : 503
}

type BancosRouteDeps = {
  analyzeBankImport: (body: any) => Promise<any>
  startBankImportAnalysisRun: (body: BancosAnalysisStartRequest) => BancosServiceResult<any>
  getBankImportConfig: () => any
  BankImportError: any
}

export function createBancosRoutes(deps: BancosRouteDeps) {
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

  function handleAnalysisStart(request: Request, response: Response) {
    try {
      const result = startBankImportAnalysisRun(request.body as BancosAnalysisStartRequest)

      if (!result.success) {
        response.status(400).json(result)
        return
      }

      response.json(result)
    } catch (error) {
      response.status(getErrorStatus(error)).json({
        error: error instanceof Error ? error.message : 'Could not start bank analysis.',
      })
    }
  }

  router.post('/analysis/start', requireInternalApiKey, handleAnalysisStart)

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
