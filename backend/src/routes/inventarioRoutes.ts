import { Router } from 'express'

function getErrorStatus(error: unknown) {
  return error instanceof Error && 'status' in error ? Number(error.status) : 503
}

export function createInventarioRoutes({ lookupInventoryCertificate, InventoryCertificateError, NetSuiteClient, executeInventoryAdjustment, executeInventoryLotReplacement, fetchInventoryAdjustmentBootstrap, fetchInventoryAdjustmentItemSnapshot, fetchInventoryLotSummary, previewInventoryAdjustment, requireInternalApiKey, searchInventoryAdjustmentAccounts, searchInventoryAdjustmentItems, InventoryAdjustmentError, InventoryLotReplacementError, InventoryLotSummaryError }: any) {
  const router = Router()









  router.post('/ajustes/reemplazar-lote', requireInternalApiKey, async (request, response) => {
    try {
      const client = NetSuiteClient.fromEnv()
      response.json(await executeInventoryLotReplacement(client, request.body))
    } catch (error) {
      const status = getErrorStatus(error)
      response.status(status).json({
        error: error instanceof Error ? error.message : 'Unknown inventory lot replacement error.',
      })
    }
  })

  router.post('/ajustes/execute', requireInternalApiKey, async (request, response) => {
    try {
      const client = NetSuiteClient.fromEnv()
      response.json(await executeInventoryAdjustment(client, request.body))
    } catch (error) {
      const status = getErrorStatus(error)
      response.status(status).json({
        error: error instanceof Error ? error.message : 'Unknown inventory execution error.',
      })
    }
  })

  router.post('/ajustes/preview', async (request, response) => {
    try {
      const client = NetSuiteClient.fromEnv()
      response.json(await previewInventoryAdjustment(client, request.body))
    } catch (error) {
      const status = getErrorStatus(error)
      response.status(status).json({
        error: error instanceof Error ? error.message : 'Unknown inventory preview error.',
      })
    }
  })

  router.post('/ajustes/lote-resumen', async (request, response) => {
    try {
      const client = NetSuiteClient.fromEnv()
      response.json(await fetchInventoryLotSummary(client, request.body))
    } catch (error) {
      const status = getErrorStatus(error)
      response.status(status).json({
        error: error instanceof Error ? error.message : 'Unknown inventory lot summary error.',
      })
    }
  })

  router.get('/ajustes/items/:itemId/snapshot', async (request, response) => {
    try {
      const client = NetSuiteClient.fromEnv()
      response.json(
        await fetchInventoryAdjustmentItemSnapshot(
          client,
          String(request.params.itemId ?? ''),
          request.query.locationId,
        ),
      )
    } catch (error) {
      const status = getErrorStatus(error)
      response.status(status).json({
        error: error instanceof Error ? error.message : 'Unknown inventory snapshot error.',
      })
    }
  })

  router.get('/ajustes/accounts', async (request, response) => {
    try {
      const client = NetSuiteClient.fromEnv()
      response.json(await searchInventoryAdjustmentAccounts(client, request.query.query, request.query.limit))
    } catch (error) {
      const status = getErrorStatus(error)
      response.status(status).json({
        error: error instanceof Error ? error.message : 'Unknown inventory account search error.',
      })
    }
  })

  router.get('/ajustes/items', async (request, response) => {
    try {
      const client = NetSuiteClient.fromEnv()
      response.json(await searchInventoryAdjustmentItems(client, request.query.query, request.query.limit))
    } catch (error) {
      const status = getErrorStatus(error)
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
      const status = getErrorStatus(error)
      response.status(status).json({
        error: error instanceof Error ? error.message : 'Unknown inventory adjustments bootstrap error.',
      })
    }
  })

  router.post('/certificados/lookup', async (request, response) => {
    try {
      response.json(await lookupInventoryCertificate(request.body))
    } catch (error) {
      const status = getErrorStatus(error)
      response.status(status).json({
        error: error instanceof Error ? error.message : 'Unknown inventory certificate lookup error.',
      })
    }
  })

  return router
}
