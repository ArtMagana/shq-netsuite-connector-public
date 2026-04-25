import { Router } from 'express'

export function createInventarioRoutes({ lookupInventoryCertificate, InventoryCertificateError, NetSuiteClient, fetchInventoryAdjustmentBootstrap, fetchInventoryAdjustmentItemSnapshot, searchInventoryAdjustmentAccounts, searchInventoryAdjustmentItems, InventoryAdjustmentError }: any) {
  const router = Router()



  router.get('/ajustes/items', async (request, response) => {
    try {
      const client = NetSuiteClient.fromEnv()
      response.json(await searchInventoryAdjustmentItems(client, request.query.query, request.query.limit))
    } catch (error) {
      const status = error instanceof InventoryAdjustmentError ? error.status : 503
      response.status(status).json({
        error: error instanceof Error ? error.message : 'Unknown inventory item search error.',
      })
    }
  })

  router.get('/ajustes/bootstrap', async (_request, response) => {
    try {
      const client = NetSuiteClient.fromEnv()
      response.json(await fetchInventoryAdjustmentBootstrap(client))
    } catch (error) {
      const status = error instanceof InventoryAdjustmentError ? error.status : 503
      response.status(status).json({
        error: error instanceof Error ? error.message : 'Unknown inventory adjustments bootstrap error.',
      })
    }
  })

  router.post('/certificados/lookup', async (request, response) => {
    try {
      response.json(await lookupInventoryCertificate(request.body))
    } catch (error) {
      const status = error instanceof InventoryCertificateError ? error.status : 503
      response.status(status).json({
        error: error instanceof Error ? error.message : 'Unknown inventory certificate lookup error.',
      })
    }
  })

  return router
}
