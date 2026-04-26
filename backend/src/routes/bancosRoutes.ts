import { Router } from 'express'
import type { Request, Response } from 'express'
import { requireInternalApiKey } from '../internalApiKey.js'
import type {
  analyzeBankImport as AnalyzeBankImportFn,
  BankImportError as BankImportErrorCtor,
  getBankImportAnalysisRunStatus as GetBankImportAnalysisRunStatusFn,
  getBankImportConfig as GetBankImportConfigFn,
  recoverBankImportAnalysisRun as RecoverBankImportAnalysisRunFn,
} from '../bankImports.js'
import type { BancosAnalysisStartRequest, BancosAnalysisStartResult, BancosServiceResult } from '../services/bancosService.js'
import { BANK_ANALYSIS_START_VALIDATION_ERROR, BANK_ANALYZE_VALIDATION_ERROR } from './bancosErrorCodes.js'
import { isBancosAnalysisStartRequest, isBancosAnalyzeRequest } from './bancosValidation.js'
import { validateBody } from './validationMiddleware.js'

type BancosAnalyzeRequestBody = Parameters<typeof AnalyzeBankImportFn>[0]
type BancosAnalyzeResponseBody = Awaited<ReturnType<typeof AnalyzeBankImportFn>>
type BancosAnalysisRecoverResponseBody = ReturnType<typeof RecoverBankImportAnalysisRunFn>
type BancosAnalysisStatusResponseBody = ReturnType<typeof GetBankImportAnalysisRunStatusFn>

type BancosRouteDeps = {
  analyzeBankImport: typeof AnalyzeBankImportFn
  startBankImportAnalysisRun: (body: BancosAnalysisStartRequest) => BancosServiceResult<BancosAnalysisStartResult>
  recoverBankImportAnalysisRun: typeof RecoverBankImportAnalysisRunFn
  getBankImportAnalysisRunStatus: typeof GetBankImportAnalysisRunStatusFn
  getBankImportConfig: typeof GetBankImportConfigFn
  BankImportError: typeof BankImportErrorCtor
}

export function createBancosRoutes(deps: BancosRouteDeps) {
  const {
    analyzeBankImport,
    startBankImportAnalysisRun,
    recoverBankImportAnalysisRun,
    getBankImportAnalysisRunStatus,
    getBankImportConfig,
    BankImportError,
  } = deps
  const router = Router()

  function getBankImportErrorStatus(error: unknown): number {
    return error instanceof BankImportError ? error.status : 503
  }

  async function handleAnalyze(request: Request<unknown, unknown, BancosAnalyzeRequestBody>, response: Response) {
    const result: BancosAnalyzeResponseBody = await analyzeBankImport(request.body)
    response.json(result)
  }

  router.post(
    '/analyze',
    validateBody(
      isBancosAnalyzeRequest,
      'La solicitud de analisis bancario no es valida.',
      BANK_ANALYZE_VALIDATION_ERROR,
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
      BANK_ANALYSIS_START_VALIDATION_ERROR,
    ),
    handleAnalysisStart,
  )

  function handleAnalysisRecover(request: Request<unknown, unknown, BancosAnalysisStartRequest>, response: Response) {
    try {
      const result: BancosAnalysisRecoverResponseBody = recoverBankImportAnalysisRun(request.body)
      response.json(result)
    } catch (error) {
      response.status(getBankImportErrorStatus(error)).json({
        error: error instanceof Error ? error.message : 'Unknown bank analysis recover error.',
      })
    }
  }

  router.post('/analysis/recover', requireInternalApiKey, handleAnalysisRecover)

  function handleAnalysisStatus(request: Request<{ analysisId: string }>, response: Response) {
    try {
      const result: BancosAnalysisStatusResponseBody = getBankImportAnalysisRunStatus(
        String(request.params.analysisId ?? ''),
      )
      response.json(result)
    } catch (error) {
      response.status(getBankImportErrorStatus(error)).json({
        error: error instanceof Error ? error.message : 'Unknown bank analysis status error.',
      })
    }
  }

  router.get('/analysis/:analysisId', handleAnalysisStatus)

  function handleConfig(_request: Request, response: Response) {
    response.json(getBankImportConfig())
  }

  router.get('/config', handleConfig)

  return router
}
