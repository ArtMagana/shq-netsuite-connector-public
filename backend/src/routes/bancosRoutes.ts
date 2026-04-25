import { Router } from 'express'

function getErrorStatus(error: unknown) {
  return error instanceof Error && 'status' in error ? Number(error.status) : 503
}

export function createBancosRoutes(deps: any) {
  const { analyzeBankImport, getBankImportConfig, BankImportError } = deps
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
