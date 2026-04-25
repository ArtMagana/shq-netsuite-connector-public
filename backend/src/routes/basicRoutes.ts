import { Router } from 'express'

import type { PreviewPayload } from '../types.js'

type BasicRoutesDependencies = {
  overview: unknown
  auditItems: unknown
  defaultRules: unknown
  ruleDefinitions: unknown
  firstProductionPolicy: unknown
  labRules: unknown
  exampleScenarios: unknown
  receipts: unknown
  invoices: unknown
  previewReconciliation: (payload: PreviewPayload) => unknown
}

export function createBasicRoutes({
  overview,
  auditItems,
  defaultRules,
  ruleDefinitions,
  firstProductionPolicy,
  labRules,
  exampleScenarios,
  receipts,
  invoices,
  previewReconciliation,
}: BasicRoutesDependencies) {
  const router = Router()

  router.get('/health', (_request, response) => {
    response.json({
      status: 'ok',
      service: 'netsuite-recon-backend',
      timestampUtc: new Date().toISOString(),
    })
  })

  router.get('/console/overview', (_request, response) => {
    response.json(overview)
  })

  router.get('/audit', (_request, response) => {
    response.json({
      items: auditItems,
    })
  })

  router.get('/rules/default', (_request, response) => {
    response.json({
      rules: defaultRules,
    })
  })

  router.get('/rules/definitions', (_request, response) => {
    response.json({
      items: ruleDefinitions,
    })
  })

  router.get('/reconcile/policy', (_request, response) => {
    response.json({
      policy: firstProductionPolicy,
    })
  })

  router.get('/reconcile/examples', (_request, response) => {
    response.json({
      rules: labRules,
      examples: exampleScenarios,
    })
  })

  router.post('/reconcile/preview', (request, response) => {
    const payload = request.body as PreviewPayload
    response.json(previewReconciliation(payload))
  })

  router.get('/reconcile/demo', (_request, response) => {
    response.json(
      previewReconciliation({
        rules: labRules,
        receipts,
        invoices,
      }),
    )
  })

  return router
}
