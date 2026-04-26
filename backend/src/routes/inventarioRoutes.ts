import { Router } from 'express'
import type { requireInternalApiKey as RequireInternalApiKeyFn } from '../internalApiKey.js'
import type {
  executeInventoryAdjustment as ExecuteInventoryAdjustmentFn,
  fetchInventoryAdjustmentBootstrap as FetchInventoryAdjustmentBootstrapFn,
  fetchInventoryAdjustmentItemSnapshot as FetchInventoryAdjustmentItemSnapshotFn,
  previewInventoryAdjustment as PreviewInventoryAdjustmentFn,
  searchInventoryAdjustmentAccounts as SearchInventoryAdjustmentAccountsFn,
  searchInventoryAdjustmentItems as SearchInventoryAdjustmentItemsFn,
} from '../inventoryAdjustments.js'
import type { lookupInventoryCertificate as LookupInventoryCertificateFn } from '../inventoryCertificates.js'
import type { executeInventoryLotReplacement as ExecuteInventoryLotReplacementFn } from '../inventoryLotReplacement.js'
import type { fetchInventoryLotSummary as FetchInventoryLotSummaryFn } from '../inventoryLotSummary.js'
import type { NetSuiteClient as NetSuiteClientCtor } from '../netsuiteClient.js'

function getErrorStatus(error: unknown) {
  return error instanceof Error && 'status' in error ? Number(error.status) : 503
}

type InventarioRouteDeps = {
  lookupInventoryCertificate: typeof LookupInventoryCertificateFn
  NetSuiteClient: typeof NetSuiteClientCtor
  executeInventoryAdjustment: typeof ExecuteInventoryAdjustmentFn
  executeInventoryLotReplacement: typeof ExecuteInventoryLotReplacementFn
  fetchInventoryAdjustmentBootstrap: typeof FetchInventoryAdjustmentBootstrapFn
  fetchInventoryAdjustmentItemSnapshot: typeof FetchInventoryAdjustmentItemSnapshotFn
  fetchInventoryLotSummary: typeof FetchInventoryLotSummaryFn
  previewInventoryAdjustment: typeof PreviewInventoryAdjustmentFn
  requireInternalApiKey: typeof RequireInternalApiKeyFn
  searchInventoryAdjustmentAccounts: typeof SearchInventoryAdjustmentAccountsFn
  searchInventoryAdjustmentItems: typeof SearchInventoryAdjustmentItemsFn
}

export function createInventarioRoutes({
  lookupInventoryCertificate,
  NetSuiteClient,
  executeInventoryAdjustment,
  executeInventoryLotReplacement,
  fetchInventoryAdjustmentBootstrap,
  fetchInventoryAdjustmentItemSnapshot,
  fetchInventoryLotSummary,
  previewInventoryAdjustment,
  requireInternalApiKey,
  searchInventoryAdjustmentAccounts,
  searchInventoryAdjustmentItems,
}: InventarioRouteDeps) {
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
