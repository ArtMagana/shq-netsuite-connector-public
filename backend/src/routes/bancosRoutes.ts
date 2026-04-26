import { Router } from 'express'
import type { Request, Response } from 'express'
import { requireInternalApiKey } from '../internalApiKey.js'
import type { analyzeBankImport as AnalyzeBankImportFn, getBankImportConfig as GetBankImportConfigFn } from '../bankImports.js'
import type { BancosAnalysisStartRequest, BancosAnalysisStartResult, BancosServiceResult } from '../services/bancosService.js'
import { isBancosAnalysisStartRequest, isBancosAnalyzeRequest } from './bancosValidation.js'
import { validateBody } from './validationMiddleware.js'

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
type BancosAnalyzeResponseBody = Awaited<ReturnType<typeof AnalyzeBankImportFn>>

type BancosRouteDeps = {
  analyzeBankImport: typeof AnalyzeBankImportFn
  startBankImportAnalysisRun: (body: BancosAnalysisStartRequest) => BancosServiceResult<BancosAnalysisStartResult>
  getBankImportConfig: typeof GetBankImportConfigFn
}

export function createBancosRoutes(deps: BancosRouteDeps) {
  const { analyzeBankImport, startBankImportAnalysisRun, getBankImportConfig } = deps
  const router = Router()

  async function handleAnalyze(request: Request<unknown, unknown, BancosAnalyzeRequestBody>, response: Response) {
    const result: BancosAnalyzeResponseBody = await analyzeBankImport(request.body)
    response.json(result)
  }

  router.post(
    '/analyze',
    validateBody(
      isBancosAnalyzeRequest,
      'La solicitud de analisis bancario no es valida.',
      'BANK_ANALYZE_VALIDATION_ERROR',
    ),
    handleAnalyze,
  )

  function handleAnalysisStart(request: Request<unknown, unknown, BancosAnalysisStartRequest>, response: Response) {
    const result = startBankImportAnalysisRun(request.body)

    if (!result.success) {
      response.status(400).json(result)
      return
    }

    response.json(result)
  }

  router.post(
    '/analysis/start',
    requireInternalApiKey,
    validateBody(
      isBancosAnalysisStartRequest,
      'La solicitud de analisis bancario no es valida.',
      'BANK_ANALYSIS_START_VALIDATION_ERROR',
    ),
    handleAnalysisStart,
  )

  function handleConfig(_request: Request, response: Response) {
    response.json(getBankImportConfig())
  }

  router.get('/config', handleConfig)

  return router
}
