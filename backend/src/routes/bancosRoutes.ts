import { Router } from 'express'

export function createBancosRoutes(deps: any) {
  const { getBankImportConfig, BankImportError } = deps
  const router = Router()

  router.get('/config', (_request, response) => {
    try {
      response.json(getBankImportConfig())
    } catch (error: any) {
      const status = error instanceof BankImportError ? error.status : 503
      response.status(status).json({
        error: error instanceof Error ? error.message : 'Unknown bank config error.',
      })
    }
  })

  return router
}
