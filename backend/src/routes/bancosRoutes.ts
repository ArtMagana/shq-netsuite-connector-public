import { Router } from 'express'
import type { Request, Response } from 'express'
import { requireInternalApiKey } from '../internalApiKey.js'
import type { analyzeBankImport as AnalyzeBankImportFn, getBankImportConfig as GetBankImportConfigFn, BankImportError as BankImportErrorCtor } from '../bankImports.js'
import type { BancosAnalysisStartRequest, BancosAnalysisStartResult, BancosServiceResult } from '../services/bancosService.js'

function getErrorStatus(error: unknown): number {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number' && Number.isFinite(status)) {
      return status
    }
  }

  return 503
}

type BancosAnalyzeRequestBody = Parameters<typeof AnalyzeBankImportFn>[0]

type BancosRouteDeps = {
  analyzeBankImport: typeof AnalyzeBankImportFn
  startBankImportAnalysisRun: (body: BancosAnalysisStartRequest) => BancosServiceResult<BancosAnalysisStartResult>
  getBankImportConfig: typeof GetBankImportConfigFn
  BankImportError: typeof BankImportErrorCtor
}

export function createBancosRoutes(deps: BancosRouteDeps) {
  const { analyzeBankImport, startBankImportAnalysisRun, getBankImportConfig, BankImportError } = deps
  const router = Router()

  router.post('/analyze', async (request: Request<unknown, unknown, BancosAnalyzeRequestBody>, response: Response) => {
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

  function handleConfig(_request: Request, response: Response) {
    try {
      response.json(getBankImportConfig())
    } catch (error) {
      const status = getErrorStatus(error)
      response.status(status).json({
        error: error instanceof Error ? error.message : 'Unknown bank config error.',
      })
    }
  }

  router.get('/config', handleConfig)

  return router
}

