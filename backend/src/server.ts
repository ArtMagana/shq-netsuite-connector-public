import { existsSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'

import {
  analyzeBankImport,
  analyzeBankImportSample,
  BankImportError,
  getBankImportConfig,
  getBankImportAnalysisRunStatus,
  postBankImportJournals,
  recoverBankImportAnalysisRun,
  saveBankImportCorrection,
  saveBankImportValidatedBalance,
  searchBankImportCandidates,
  startBankImportAnalysisRun,
  uploadBankHistoricalStatement,
} from './bankImports.js'
import {
  listBankIndividualPaymentFileMetadata,
  upsertBankIndividualPaymentFiles,
} from './bankIndividualPaymentStore.js'
import {
  BanxicoServiceError,
  downloadBanxicoCepDetails,
  getBanxicoCepInstitutions,
  lookupBanxicoCep,
} from './banxico.js'
import { upsertBanxicoCepRecognition } from './banxicoCepRecognitionStore.js'
import { exampleScenarios, labRules } from './exampleScenarios.js'
import {
  applyExactVendorCredit,
  fetchEgresosBootstrap,
  fetchEgresosExactReadyOverview,
  invalidateEgresosReadCache,
  prepareExactJournal,
  reconcileExactSupport,
} from './egresos.js'
import {
  applyTransaccionesK,
  applyTransaccionesPpd1,
  applyTransaccionesA1,
  applyTransaccionesA2,
  applyTransaccionesA3,
  applyTransaccionesA4,
  applyTransaccionesA5,
  applyTransaccionesA6,
  applyTransaccionesA7,
  applyTransaccionesA8,
  applyTransaccionesB1,
  applyTransaccionesB2,
  applyTransaccionesB3,
  applyTransaccionesN1,
  fetchFacturasAbiertas,
  invalidateFacturasReadAnalysisCache,
} from './facturas.js'
import { loadLocalEnv } from './loadLocalEnv.js'
import { auditItems, invoices, overview, receipts } from './mockData.js'
import { getBootstrapQueries, runBootstrapAnalysis } from './netsuiteAnalysis.js'
import {
  getNetSuiteOAuthStatus,
  NetSuiteOAuthService,
  renderOAuthCallbackPage,
} from './netsuiteOAuth.js'
import {
  ClaveSatStoreError,
  loadOrSyncClaveSatCatalogSnapshot,
  syncClaveSatCatalog,
} from './claveSatStore.js'
import {
  loadOrSyncNetSuiteEntityCatalogSnapshot,
  NetSuiteEntityStoreError,
  parseNetSuiteEntityCatalogKind,
  syncNetSuiteEntityCatalog,
} from './netsuiteEntityStore.js'
import {
  loadOrSyncNetSuiteAccountCatalogSnapshot,
  NetSuiteAccountStoreError,
  syncNetSuiteAccountCatalog,
} from './netsuiteAccountStore.js'
import {
  createNetSuiteAccountsFromImport,
  NetSuiteAccountImportError,
  previewNetSuiteAccountImport,
} from './netsuiteAccountImport.js'
import {
  inspectNetSuiteFileFromReference,
  inspectNetSuiteInvoiceAttachments,
  NetSuiteAttachmentInspectionError,
} from './netsuiteAttachmentInspection.js'
import {
  getKontempoStatus,
  importKontempoSourceFiles,
  KontempoError,
} from './kontempo.js'
import {
  executeInventoryAdjustment,
  fetchInventoryAdjustmentBootstrap,
  fetchInventoryAdjustmentItemSnapshot,
  InventoryAdjustmentError,
  previewInventoryAdjustment,
  searchInventoryAdjustmentAccounts,
  searchInventoryAdjustmentItems,
} from './inventoryAdjustments.js'
import {
  fetchInventoryLotSummary,
  InventoryLotSummaryError,
} from './inventoryLotSummary.js'
import {
  executeInventoryLotReplacement,
  InventoryLotReplacementError,
} from './inventoryLotReplacement.js'
import {
  InventoryCertificateError,
  lookupInventoryCertificate,
} from './inventoryCertificates.js'
import {
  fetchSearchTransactionEntities,
  fetchSearchTransactionsBootstrap,
  SearchTransactionsError,
  searchTransactions,
} from './searchTransactions.js'
import {
  defaultRules,
  firstProductionPolicy,
  previewReconciliation,
} from './reconciliationEngine.js'
import { NetSuiteClient } from './netsuiteClient.js'
import { ruleDefinitions } from './ruleDefinitions.js'
import {
  createSatCfdiRequest,
  downloadSatCfdiPackageFile,
  getSatDownloadHistory,
  getSatStatus,
  inspectSatCfdiPackage,
  runSatAuthenticationTest,
  SatServiceError,
  verifySatCfdiRequest,
} from './sat.js'
import { previewSatPackageForNetsuite } from './satNetsuitePreview.js'
import {
  bootstrapSatReceivedInvoicesAnalysisWindow,
  getSatAnalysisWindowsSummary,
  reconcileSatAnalysisWindow,
} from './satAnalysisWindows.js'
import {
  listSatManualHomologations,
  upsertSatManualAccountHomologation,
  upsertSatManualProviderHomologation,
} from './satManualHomologationStore.js'
import { uploadSatAnalysisInvoiceToNetSuite } from './satNetsuiteUpload.js'
import type { BankImportBankId, PreviewPayload } from './types.js'

loadLocalEnv()

const app = express()
const currentDir = dirname(fileURLToPath(import.meta.url))
const defaultFrontendDistDir = resolve(currentDir, '../../frontend/dist')
const frontendDistDir = resolve(process.env.FRONTEND_DIST_DIR ?? defaultFrontendDistDir)
const frontendIndexPath = resolve(frontendDistDir, 'index.html')
const hasFrontendBuild = existsSync(frontendIndexPath)
const host = process.env.HOST?.trim() || '127.0.0.1'
const port = Number(process.env.PORT ?? 3001)
const publicBaseUrl = process.env.APP_PUBLIC_BASE_URL?.trim().replace(/\/+$/, '') || null

app.use(cors())
app.use(express.json({ limit: '35mb' }))

app.get('/api/health', (_request, response) => {
  response.json({
    status: 'ok',
    service: 'netsuite-recon-backend',
    timestampUtc: new Date().toISOString(),
  })
})

app.get('/api/console/overview', (_request, response) => {
  response.json(overview)
})

app.get('/api/inventario/ajustes/bootstrap', async (_request, response) => {
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

app.get('/api/inventario/ajustes/items', async (request, response) => {
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

app.get('/api/inventario/ajustes/accounts', async (request, response) => {
  try {
    const client = NetSuiteClient.fromEnv()
    response.json(await searchInventoryAdjustmentAccounts(client, request.query.query, request.query.limit))
  } catch (error) {
    const status = error instanceof InventoryAdjustmentError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown inventory account search error.',
    })
  }
})

app.get('/api/inventario/ajustes/items/:itemId/snapshot', async (request, response) => {
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
    const status = error instanceof InventoryAdjustmentError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown inventory snapshot error.',
    })
  }
})

app.post('/api/inventario/ajustes/lote-resumen', async (request, response) => {
  try {
    const client = NetSuiteClient.fromEnv()
    response.json(await fetchInventoryLotSummary(client, request.body))
  } catch (error) {
    const status = error instanceof InventoryLotSummaryError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown inventory lot summary error.',
    })
  }
})

app.post('/api/inventario/ajustes/preview', async (request, response) => {
  try {
    const client = NetSuiteClient.fromEnv()
    response.json(await previewInventoryAdjustment(client, request.body))
  } catch (error) {
    const status = error instanceof InventoryAdjustmentError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown inventory preview error.',
    })
  }
})

app.post('/api/inventario/ajustes/execute', async (request, response) => {
  try {
    const client = NetSuiteClient.fromEnv()
    response.json(await executeInventoryAdjustment(client, request.body))
  } catch (error) {
    const status = error instanceof InventoryAdjustmentError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown inventory execution error.',
    })
  }
})

app.post('/api/inventario/ajustes/reemplazar-lote', async (request, response) => {
  try {
    const client = NetSuiteClient.fromEnv()
    response.json(await executeInventoryLotReplacement(client, request.body))
  } catch (error) {
    const status = error instanceof InventoryLotReplacementError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown inventory lot replacement error.',
    })
  }
})

app.post('/api/inventario/certificados/lookup', async (request, response) => {
  try {
    response.json(await lookupInventoryCertificate(request.body))
  } catch (error) {
    const status = error instanceof InventoryCertificateError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown inventory certificate lookup error.',
    })
  }
})

app.get('/api/bancos/config', (_request, response) => {
  try {
    response.json(getBankImportConfig())
  } catch (error) {
    const status = error instanceof BankImportError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown bank config error.',
    })
  }
})

app.post('/api/bancos/analyze', async (request, response) => {
  try {
    response.json(await analyzeBankImport(request.body))
  } catch (error) {
    const status = error instanceof BankImportError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown bank import error.',
    })
  }
})

app.post('/api/bancos/analysis/start', (request, response) => {
  try {
    response.json(startBankImportAnalysisRun(request.body))
  } catch (error) {
    const status = error instanceof BankImportError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown bank analysis start error.',
    })
  }
})

app.post('/api/bancos/analysis/recover', (request, response) => {
  try {
    response.json(recoverBankImportAnalysisRun(request.body))
  } catch (error) {
    const status = error instanceof BankImportError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown bank analysis recover error.',
    })
  }
})

app.get('/api/bancos/analysis/:analysisId', (request, response) => {
  try {
    response.json(getBankImportAnalysisRunStatus(String(request.params.analysisId ?? '')))
  } catch (error) {
    const status = error instanceof BankImportError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown bank analysis status error.',
    })
  }
})

app.post('/api/bancos/history/upload', async (request, response) => {
  try {
    response.json(await uploadBankHistoricalStatement(request.body))
  } catch (error) {
    const status = error instanceof BankImportError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown bank historical upload error.',
    })
  }
})

app.get('/api/bancos/pagos-individuales', (request, response) => {
  try {
    const bankId = String(request.query.bankId ?? 'bbva') as BankImportBankId
    response.json({
      bankId,
      items: listBankIndividualPaymentFileMetadata(bankId),
    })
  } catch (error) {
    response.status(503).json({
      error: error instanceof Error ? error.message : 'Unknown bank individual payment list error.',
    })
  }
})

app.post('/api/bancos/pagos-individuales/upload', (request, response) => {
  try {
    response.json(upsertBankIndividualPaymentFiles(request.body))
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : 'Unknown bank individual payment upload error.',
    })
  }
})

app.get('/api/bancos/sample', async (request, response) => {
  try {
    const bankId = String(request.query.bankId ?? 'payana')
    const accountingPeriod =
      typeof request.query.accountingPeriod === 'string'
        ? request.query.accountingPeriod
        : typeof request.query.cutoffDate === 'string'
          ? request.query.cutoffDate
          : null
    response.json(await analyzeBankImportSample(bankId as BankImportBankId, accountingPeriod))
  } catch (error) {
    const status = error instanceof BankImportError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown bank sample error.',
    })
  }
})

app.post('/api/bancos/sample', async (request, response) => {
  try {
    const bankId = String(request.body?.bankId ?? 'payana')
    const accountingPeriod =
      typeof request.body?.accountingPeriod === 'string'
        ? request.body.accountingPeriod
        : typeof request.body?.cutoffDate === 'string'
          ? request.body.cutoffDate
          : null
    const transientCorrections = Array.isArray(request.body?.transientCorrections)
      ? request.body.transientCorrections
      : undefined

    response.json(await analyzeBankImportSample(bankId as BankImportBankId, accountingPeriod, transientCorrections))
  } catch (error) {
    const status = error instanceof BankImportError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown bank sample error.',
    })
  }
})

app.get('/api/bancos/candidates', async (request, response) => {
  try {
    const bankId = String(request.query.bankId ?? 'payana')
    const transactionType = String(request.query.transactionType ?? '')
    const query = String(request.query.query ?? '')
    const rfc = typeof request.query.rfc === 'string' ? request.query.rfc : null
    const correctionKey = typeof request.query.correctionKey === 'string' ? request.query.correctionKey : null
    const trackingKey = typeof request.query.trackingKey === 'string' ? request.query.trackingKey : null
    const referenceNumber = typeof request.query.referenceNumber === 'string' ? request.query.referenceNumber : null

    response.json(
      await searchBankImportCandidates({
        bankId: bankId as BankImportBankId,
        transactionType,
        query,
        rfc,
        correctionKey,
        trackingKey,
        referenceNumber,
      }),
    )
  } catch (error) {
    const status = error instanceof BankImportError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown bank candidate search error.',
    })
  }
})

app.post('/api/bancos/corrections', (request, response) => {
  try {
    response.json(saveBankImportCorrection(request.body))
  } catch (error) {
    const status = error instanceof BankImportError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown bank correction error.',
    })
  }
})

app.post('/api/bancos/journals/post', async (request, response) => {
  try {
    response.json(await postBankImportJournals(request.body))
  } catch (error) {
    const status = error instanceof BankImportError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown bank journal post error.',
    })
  }
})

app.post('/api/bancos/saldo-validado', (request, response) => {
  try {
    response.json(saveBankImportValidatedBalance(request.body))
  } catch (error) {
    const status = error instanceof BankImportError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown bank validated balance error.',
    })
  }
})

app.get('/api/bancos/cep/status', async (request, response) => {
  try {
    const catalog = await getBanxicoCepInstitutions(
      typeof request.query.date === 'string' ? request.query.date : null,
    )
    response.json({
      service: 'banxico-cep',
      reachable: true,
      fetchedAtUtc: catalog.fetchedAtUtc,
      date: catalog.date,
      banxicoDate: catalog.banxicoDate,
      overrideCaptcha: catalog.overrideCaptcha,
      institutions: {
        total: catalog.institutions.length,
        mispeiTotal: catalog.institutionsMispei.length,
      },
      sourceUrl: catalog.sourceUrl,
    })
  } catch (error) {
    const status = error instanceof BanxicoServiceError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown Banxico CEP status error.',
    })
  }
})

app.get('/api/bancos/cep/institutions', async (request, response) => {
  try {
    response.json(
      await getBanxicoCepInstitutions(typeof request.query.date === 'string' ? request.query.date : null),
    )
  } catch (error) {
    const status = error instanceof BanxicoServiceError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown Banxico CEP institutions error.',
    })
  }
})

app.post('/api/bancos/cep/lookup', async (request, response) => {
  try {
    response.json(await lookupBanxicoCep(request.body))
  } catch (error) {
    const status = error instanceof BanxicoServiceError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown Banxico CEP lookup error.',
    })
  }
})

app.post('/api/bancos/cep/details', async (request, response) => {
  try {
    let details = null
    let lastError: unknown = null

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        details = await downloadBanxicoCepDetails(request.body)
        if (details) {
          break
        }
      } catch (error) {
        lastError = error
      }

      if (attempt < 2) {
        await new Promise((resolve) => {
          setTimeout(resolve, 350 * (attempt + 1))
        })
      }
    }

    if (!details && lastError) {
      throw lastError
    }

    if (!details) {
      response.json(null)
      return
    }

    upsertBanxicoCepRecognition({
      bankId: resolveBanxicoCepBankId(request.body?.bankId),
      sourceProfileId: resolveBanxicoCepSourceProfileId(
        request.body?.bankId,
        typeof request.body?.sourceProfileId === 'string' ? request.body.sourceProfileId : null,
      ),
      operationDate: String(request.body?.operationDate ?? ''),
      issuerId: String(request.body?.issuerId ?? ''),
      receiverId: String(request.body?.receiverId ?? ''),
      beneficiaryAccount: String(request.body?.beneficiaryAccount ?? ''),
      amount: String(request.body?.amount ?? ''),
      trackingKey:
        typeof request.body?.searchType === 'string' && request.body.searchType === 'trackingKey'
          ? String(request.body?.criteria ?? '')
          : null,
      referenceNumber:
        typeof request.body?.searchType === 'string' && request.body.searchType === 'referenceNumber'
          ? String(request.body?.criteria ?? '')
          : null,
      details,
      source: 'manual_cep_lookup',
    })

    const { xml: _xml, ...summary } = details
    response.json(summary)
  } catch (error) {
    const status = error instanceof BanxicoServiceError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown Banxico CEP details error.',
    })
  }
})

function resolveBanxicoCepBankId(value: unknown): BankImportBankId | null {
  return value === 'payana' || value === 'clara_corriente' || value === 'bbva' ? value : null
}

function resolveBanxicoCepSourceProfileId(bankIdValue: unknown, sourceProfileIdValue: string | null) {
  const sourceProfileId = typeof sourceProfileIdValue === 'string' ? sourceProfileIdValue.trim() : ''
  if (sourceProfileId) {
    return sourceProfileId
  }

  const bankId = resolveBanxicoCepBankId(bankIdValue)
  switch (bankId) {
    case 'bbva':
      return 'bbva_pdf'
    case 'clara_corriente':
      return 'clara_account_activity'
    case 'payana':
      return 'payana_transacciones'
    default:
      return 'clara_account_activity'
  }
}

app.get('/api/rules/default', (_request, response) => {
  response.json({
    rules: defaultRules,
  })
})

app.get('/api/entities/:kind', async (request, response) => {
  try {
    response.json(
      await loadOrSyncNetSuiteEntityCatalogSnapshot(parseNetSuiteEntityCatalogKind(String(request.params.kind ?? ''))),
    )
  } catch (error) {
    const status = error instanceof NetSuiteEntityStoreError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown NetSuite entity store error.',
    })
  }
})

app.post('/api/entities/:kind/sync', async (request, response) => {
  try {
    response.json(await syncNetSuiteEntityCatalog(parseNetSuiteEntityCatalogKind(String(request.params.kind ?? ''))))
  } catch (error) {
    const status = error instanceof NetSuiteEntityStoreError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown NetSuite entity sync error.',
    })
  }
})

app.get('/api/catalogs/sat/clave-sat', async (_request, response) => {
  try {
    response.json(await loadOrSyncClaveSatCatalogSnapshot())
  } catch (error) {
    const status = error instanceof ClaveSatStoreError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown ClaveSAT store error.',
    })
  }
})

app.post('/api/catalogs/sat/clave-sat/sync', async (_request, response) => {
  try {
    response.json(await syncClaveSatCatalog())
  } catch (error) {
    const status = error instanceof ClaveSatStoreError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown ClaveSAT sync error.',
    })
  }
})

app.get('/api/catalogs/netsuite/accounts', async (_request, response) => {
  try {
    response.json(await loadOrSyncNetSuiteAccountCatalogSnapshot())
  } catch (error) {
    const status = error instanceof NetSuiteAccountStoreError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown NetSuite account store error.',
    })
  }
})

app.post('/api/catalogs/netsuite/accounts/sync', async (_request, response) => {
  try {
    response.json(await syncNetSuiteAccountCatalog())
  } catch (error) {
    const status = error instanceof NetSuiteAccountStoreError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown NetSuite account sync error.',
    })
  }
})

app.post('/api/catalogs/netsuite/accounts/import/preview', async (request, response) => {
  try {
    response.json(await previewNetSuiteAccountImport(typeof request.body?.rawText === 'string' ? request.body.rawText : null))
  } catch (error) {
    const status = error instanceof NetSuiteAccountImportError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown NetSuite account import preview error.',
    })
  }
})

app.post('/api/catalogs/netsuite/accounts/import/create', async (request, response) => {
  try {
    response.json(
      await createNetSuiteAccountsFromImport(typeof request.body?.rawText === 'string' ? request.body.rawText : null),
    )
  } catch (error) {
    const status = error instanceof NetSuiteAccountImportError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown NetSuite account import execution error.',
    })
  }
})

app.get('/api/rules/definitions', (_request, response) => {
  response.json({
    items: ruleDefinitions,
  })
})

app.get('/api/kontempo/status', (_request, response) => {
  response.json(getKontempoStatus())
})

app.post('/api/kontempo/import', async (request, response) => {
  try {
    const client = NetSuiteClient.fromEnv()
    const payload = await importKontempoSourceFiles(client, {
      filePaths: request.body?.filePaths,
      exampleJournalDocument: request.body?.exampleJournalDocument,
    })
    invalidateFacturasReadAnalysisCache()
    response.json(payload)
  } catch (error) {
    const status = error instanceof KontempoError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown Kontempo import error.',
    })
  }
})

app.get('/api/reconcile/policy', (_request, response) => {
  response.json({
    policy: firstProductionPolicy,
  })
})

app.get('/api/reconcile/examples', (_request, response) => {
  response.json({
    rules: labRules,
    examples: exampleScenarios,
  })
})

app.get('/api/search/bootstrap', async (_request, response) => {
  try {
    const client = NetSuiteClient.fromEnv()
    response.json(await fetchSearchTransactionsBootstrap(client))
  } catch (error) {
    const status = error instanceof SearchTransactionsError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown Search / Find bootstrap error.',
    })
  }
})

app.get('/api/search/entities', async (request, response) => {
  try {
    const client = NetSuiteClient.fromEnv()
    response.json(await fetchSearchTransactionEntities(client, request.query.entityKind))
  } catch (error) {
    const status = error instanceof SearchTransactionsError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown Search / Find entity catalog error.',
    })
  }
})

app.post('/api/search/transactions', async (request, response) => {
  try {
    const client = NetSuiteClient.fromEnv()
    response.json(await searchTransactions(client, request.body))
  } catch (error) {
    const status = error instanceof SearchTransactionsError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown Search / Find query error.',
    })
  }
})

app.get('/api/audit', (_request, response) => {
  response.json({
    items: auditItems,
  })
})

app.post('/api/reconcile/preview', (request, response) => {
  const payload = request.body as PreviewPayload
  response.json(previewReconciliation(payload))
})

app.get('/api/reconcile/demo', (_request, response) => {
  response.json(
    previewReconciliation({
      rules: labRules,
      receipts,
      invoices,
    }),
  )
})

app.get('/api/netsuite/ping', async (request, response) => {
  try {
    const recordType = String(request.query.recordType ?? 'contact')
    const client = NetSuiteClient.fromEnv()
    response.json(await client.ping(recordType))
  } catch (error) {
    response.status(503).json({
      error: error instanceof Error ? error.message : 'Unknown NetSuite error.',
    })
  }
})

app.get('/api/egresos/bootstrap', async (request, response) => {
  try {
    let client: NetSuiteClient | null = null

    try {
      client = NetSuiteClient.fromEnv()
    } catch {
      client = null
    }

    response.json(
      await fetchEgresosBootstrap({
        client,
        forceRefresh: request.query.forceRefresh === 'true',
        limit: request.query.limit,
        offset: request.query.offset,
      }),
    )
  } catch (error) {
    response.status(503).json({
      error: error instanceof Error ? error.message : 'Unknown egresos bootstrap error.',
    })
  }
})

app.get('/api/egresos/exact-ready-overview', async (request, response) => {
  try {
    let client: NetSuiteClient | null = null

    try {
      client = NetSuiteClient.fromEnv()
    } catch {
      client = null
    }

    response.json(
      await fetchEgresosExactReadyOverview({
        client,
        forceRefresh: request.query.forceRefresh === 'true',
        pageSize: request.query.pageSize,
      }),
    )
  } catch (error) {
    response.status(503).json({
      error:
        error instanceof Error ? error.message : 'Unknown egresos exact-ready overview error.',
    })
  }
})

app.post('/api/egresos/:billInternalId/apply-exact-credit', async (request, response) => {
  try {
    const client = NetSuiteClient.fromEnv()
    const result = await applyExactVendorCredit({
      client,
      billInternalId: String(request.params.billInternalId ?? ''),
      creditInternalId:
        typeof request.body?.creditInternalId === 'string'
          ? request.body.creditInternalId
          : null,
      dryRun: Boolean(request.body?.dryRun),
    })
    invalidateEgresosReadCache()
    response.json(result)
  } catch (error) {
    response.status(503).json({
      error: error instanceof Error ? error.message : 'Unknown egresos apply error.',
    })
  }
})

app.post('/api/egresos/:billInternalId/prepare-exact-journal', async (request, response) => {
  try {
    const billInternalId = String(request.params.billInternalId ?? '')
    const journalInternalId =
      typeof request.body?.journalInternalId === 'string'
        ? request.body.journalInternalId
        : null
    const client = NetSuiteClient.fromEnv()
    const result = await prepareExactJournal({
      client,
      billInternalId,
      journalInternalId,
    })
    console.info(
      `Egresos exact conciliation start ok | bill=${billInternalId} | journal=${journalInternalId ?? 'auto'} | preparedAt=${result.preparedAtUtc} | code=${result.operationalCode}`,
    )
    response.json(result)
  } catch (error) {
    console.warn(
      `Egresos exact conciliation start failed | bill=${String(request.params.billInternalId ?? '')} | journal=${
        typeof request.body?.journalInternalId === 'string'
          ? request.body.journalInternalId
          : 'auto'
      }`,
      error,
    )
    response.status(503).json({
      error:
        error instanceof Error ? error.message : 'Unknown egresos exact conciliation start error.',
    })
  }
})

app.post('/api/egresos/:billInternalId/reconcile-exact-support', async (request, response) => {
  try {
    const billInternalId = String(request.params.billInternalId ?? '')
    const supportInternalId =
      typeof request.body?.supportInternalId === 'string'
        ? request.body.supportInternalId
        : null
    const client = NetSuiteClient.fromEnv()
    const result = await reconcileExactSupport({
      client,
      billInternalId,
      supportInternalId,
    })
    invalidateEgresosReadCache()
    console.info(
      `Egresos exact reconciliation saved | bill=${billInternalId} | support=${supportInternalId ?? 'auto'} | reconciledAt=${result.reconciledAtUtc} | code=${result.operationalCode ?? 'none'}`,
    )
    response.json(result)
  } catch (error) {
    console.warn(
      `Egresos exact reconciliation failed | bill=${String(request.params.billInternalId ?? '')} | support=${
        typeof request.body?.supportInternalId === 'string'
          ? request.body.supportInternalId
          : 'auto'
      }`,
      error,
    )
    response.status(503).json({
      error:
        error instanceof Error ? error.message : 'Unknown egresos exact reconciliation error.',
    })
  }
})

app.get('/api/facturas/open', async (request, response) => {
  try {
    const client = NetSuiteClient.fromEnv()
    response.json(
      await fetchFacturasAbiertas(client, request.query.limit, request.query.offset, {
        includeRaw: request.query.includeRaw === 'true',
        forceRefresh: request.query.forceRefresh === 'true',
      }),
    )
  } catch (error) {
    response.status(503).json({
      error: error instanceof Error ? error.message : 'Unknown NetSuite invoice error.',
    })
  }
})

app.get('/api/facturas/:invoiceInternalId/adjuntos', async (request, response) => {
  try {
    response.json(
      await inspectNetSuiteInvoiceAttachments(String(request.params.invoiceInternalId ?? ''), {
        includeText: request.query.includeText === 'true',
        fileId: typeof request.query.fileId === 'string' ? request.query.fileId : null,
      }),
    )
  } catch (error) {
    const status = error instanceof NetSuiteAttachmentInspectionError ? error.status : 503
    response.status(status).json({
      error:
        error instanceof Error
          ? error.message
          : 'Unknown NetSuite invoice attachment inspection error.',
    })
  }
})

app.get('/api/netsuite/archivos/inspect', async (request, response) => {
  try {
    response.json(
      await inspectNetSuiteFileFromReference({
        includeText: request.query.includeText === 'true',
        fileId: typeof request.query.fileId === 'string' ? request.query.fileId : null,
        mediaUrl: typeof request.query.mediaUrl === 'string' ? request.query.mediaUrl : null,
      }),
    )
  } catch (error) {
    const status = error instanceof NetSuiteAttachmentInspectionError ? error.status : 503
    response.status(status).json({
      error:
        error instanceof Error
          ? error.message
          : 'Unknown NetSuite file inspection error.',
    })
  }
})

app.post('/api/facturas/apply/k', async (request, response) => {
  try {
    invalidateFacturasReadAnalysisCache()
    const client = NetSuiteClient.fromEnv()
    response.json(
      await applyTransaccionesK(client, {
        dryRun: Boolean(request.body?.dryRun),
        invoiceInternalId:
          typeof request.body?.invoiceInternalId === 'string'
            ? request.body.invoiceInternalId
            : null,
        limit:
          typeof request.body?.limit === 'number' && Number.isFinite(request.body.limit)
            ? request.body.limit
            : null,
      }),
    )
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to apply K transactions in NetSuite.',
    })
  }
})

app.post('/api/facturas/apply/ppd1', async (request, response) => {
  try {
    invalidateFacturasReadAnalysisCache()
    const client = NetSuiteClient.fromEnv()
    response.json(
      await applyTransaccionesPpd1(client, {
        dryRun: Boolean(request.body?.dryRun),
        invoiceInternalId:
          typeof request.body?.invoiceInternalId === 'string'
            ? request.body.invoiceInternalId
            : null,
        limit:
          typeof request.body?.limit === 'number' && Number.isFinite(request.body.limit)
            ? request.body.limit
            : null,
      }),
    )
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to apply PPD1 transactions in NetSuite.',
    })
  }
})

app.post('/api/facturas/apply/a1', async (request, response) => {
  try {
    invalidateFacturasReadAnalysisCache()
    const client = NetSuiteClient.fromEnv()
    response.json(
      await applyTransaccionesA1(client, {
        dryRun: Boolean(request.body?.dryRun),
        invoiceInternalId:
          typeof request.body?.invoiceInternalId === 'string'
            ? request.body.invoiceInternalId
            : null,
        limit:
          typeof request.body?.limit === 'number' && Number.isFinite(request.body.limit)
            ? request.body.limit
            : null,
      }),
    )
  } catch (error) {
    response.status(503).json({
      error: error instanceof Error ? error.message : 'Unknown NetSuite A1 apply error.',
    })
  }
})

app.post('/api/facturas/apply/a2', async (request, response) => {
  try {
    invalidateFacturasReadAnalysisCache()
    const client = NetSuiteClient.fromEnv()
    response.json(
      await applyTransaccionesA2(client, {
        dryRun: Boolean(request.body?.dryRun),
        invoiceInternalId:
          typeof request.body?.invoiceInternalId === 'string'
            ? request.body.invoiceInternalId
            : null,
        limit:
          typeof request.body?.limit === 'number' && Number.isFinite(request.body.limit)
            ? request.body.limit
            : null,
      }),
    )
  } catch (error) {
    response.status(503).json({
      error: error instanceof Error ? error.message : 'Unknown NetSuite A2 apply error.',
    })
  }
})

app.post('/api/facturas/apply/a3', async (request, response) => {
  try {
    invalidateFacturasReadAnalysisCache()
    const client = NetSuiteClient.fromEnv()
    response.json(
      await applyTransaccionesA3(client, {
        dryRun: Boolean(request.body?.dryRun),
        invoiceInternalId:
          typeof request.body?.invoiceInternalId === 'string'
            ? request.body.invoiceInternalId
            : null,
        limit:
          typeof request.body?.limit === 'number' && Number.isFinite(request.body.limit)
            ? request.body.limit
            : null,
      }),
    )
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to apply A3 transactions in NetSuite.',
    })
  }
})

app.post('/api/facturas/apply/a4', async (request, response) => {
  try {
    invalidateFacturasReadAnalysisCache()
    const client = NetSuiteClient.fromEnv()
    response.json(
      await applyTransaccionesA4(client, {
        dryRun: Boolean(request.body?.dryRun),
        invoiceInternalId:
          typeof request.body?.invoiceInternalId === 'string'
            ? request.body.invoiceInternalId
            : null,
        limit:
          typeof request.body?.limit === 'number' && Number.isFinite(request.body.limit)
            ? request.body.limit
            : null,
      }),
    )
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to apply A4 transactions in NetSuite.',
    })
  }
})

app.post('/api/facturas/apply/a5', async (request, response) => {
  try {
    invalidateFacturasReadAnalysisCache()
    const client = NetSuiteClient.fromEnv()
    response.json(
      await applyTransaccionesA5(client, {
        dryRun: Boolean(request.body?.dryRun),
        invoiceInternalId:
          typeof request.body?.invoiceInternalId === 'string'
            ? request.body.invoiceInternalId
            : null,
        limit:
          typeof request.body?.limit === 'number' && Number.isFinite(request.body.limit)
            ? request.body.limit
            : null,
      }),
    )
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to apply A5 transactions in NetSuite.',
    })
  }
})

app.post('/api/facturas/apply/a6', async (request, response) => {
  try {
    invalidateFacturasReadAnalysisCache()
    const client = NetSuiteClient.fromEnv()
    response.json(
      await applyTransaccionesA6(client, {
        dryRun: Boolean(request.body?.dryRun),
        invoiceInternalId:
          typeof request.body?.invoiceInternalId === 'string'
            ? request.body.invoiceInternalId
            : null,
        limit:
          typeof request.body?.limit === 'number' && Number.isFinite(request.body.limit)
            ? request.body.limit
            : null,
      }),
    )
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to apply A6 transactions in NetSuite.',
    })
  }
})

app.post('/api/facturas/apply/a7', async (request, response) => {
  try {
    invalidateFacturasReadAnalysisCache()
    const client = NetSuiteClient.fromEnv()
    response.json(
      await applyTransaccionesA7(client, {
        dryRun: Boolean(request.body?.dryRun),
        invoiceInternalId:
          typeof request.body?.invoiceInternalId === 'string'
            ? request.body.invoiceInternalId
            : null,
        limit:
          typeof request.body?.limit === 'number' && Number.isFinite(request.body.limit)
            ? request.body.limit
            : null,
      }),
    )
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to apply A7 transactions in NetSuite.',
    })
  }
})

app.post('/api/facturas/apply/a8', async (request, response) => {
  try {
    invalidateFacturasReadAnalysisCache()
    const client = NetSuiteClient.fromEnv()
    response.json(
      await applyTransaccionesA8(client, {
        dryRun: Boolean(request.body?.dryRun),
        invoiceInternalId:
          typeof request.body?.invoiceInternalId === 'string'
            ? request.body.invoiceInternalId
            : null,
        limit:
          typeof request.body?.limit === 'number' && Number.isFinite(request.body.limit)
            ? request.body.limit
            : null,
      }),
    )
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to apply A8 transactions in NetSuite.',
    })
  }
})

app.post('/api/facturas/apply/b1', async (request, response) => {
  try {
    invalidateFacturasReadAnalysisCache()
    const client = NetSuiteClient.fromEnv()
    response.json(
      await applyTransaccionesB1(client, {
        dryRun: Boolean(request.body?.dryRun),
        invoiceInternalId:
          typeof request.body?.invoiceInternalId === 'string'
            ? request.body.invoiceInternalId
            : null,
        limit:
          typeof request.body?.limit === 'number' && Number.isFinite(request.body.limit)
            ? request.body.limit
            : null,
      }),
    )
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to apply B1 transactions in NetSuite.',
    })
  }
})

app.post('/api/facturas/apply/b2', async (request, response) => {
  try {
    invalidateFacturasReadAnalysisCache()
    const client = NetSuiteClient.fromEnv()
    response.json(
      await applyTransaccionesB2(client, {
        dryRun: Boolean(request.body?.dryRun),
        invoiceInternalId:
          typeof request.body?.invoiceInternalId === 'string'
            ? request.body.invoiceInternalId
            : null,
        limit:
          typeof request.body?.limit === 'number' && Number.isFinite(request.body.limit)
            ? request.body.limit
            : null,
      }),
    )
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to apply B2 transactions in NetSuite.',
    })
  }
})

app.post('/api/facturas/apply/b3', async (request, response) => {
  try {
    invalidateFacturasReadAnalysisCache()
    const client = NetSuiteClient.fromEnv()
    response.json(
      await applyTransaccionesB3(client, {
        dryRun: Boolean(request.body?.dryRun),
        invoiceInternalId:
          typeof request.body?.invoiceInternalId === 'string'
            ? request.body.invoiceInternalId
            : null,
        limit:
          typeof request.body?.limit === 'number' && Number.isFinite(request.body.limit)
            ? request.body.limit
            : null,
      }),
    )
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to apply B3 transactions in NetSuite.',
    })
  }
})

app.post('/api/facturas/apply/n1', async (request, response) => {
  try {
    invalidateFacturasReadAnalysisCache()
    const client = NetSuiteClient.fromEnv()
    response.json(
      await applyTransaccionesN1(client, {
        dryRun: Boolean(request.body?.dryRun),
        invoiceInternalId:
          typeof request.body?.invoiceInternalId === 'string'
            ? request.body.invoiceInternalId
            : null,
        limit:
          typeof request.body?.limit === 'number' && Number.isFinite(request.body.limit)
            ? request.body.limit
            : null,
      }),
    )
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to apply N1 transactions in NetSuite.',
    })
  }
})

app.get('/api/auth/netsuite/status', (_request, response) => {
  try {
    response.json({
      authMode: String(process.env.NETSUITE_AUTH_MODE ?? 'tba'),
      oauth2: getNetSuiteOAuthStatus(),
      tbaConfigured: Boolean(
        process.env.NETSUITE_ACCOUNT_ID &&
          process.env.NETSUITE_BASE_URL &&
          process.env.NETSUITE_CONSUMER_KEY &&
          process.env.NETSUITE_CONSUMER_SECRET &&
          process.env.NETSUITE_TOKEN_ID &&
          process.env.NETSUITE_TOKEN_SECRET,
      ),
    })
  } catch (error) {
    response.status(503).json({
      error: error instanceof Error ? error.message : 'Unknown NetSuite OAuth status error.',
    })
  }
})

app.get('/api/sat/status', (_request, response) => {
  try {
    response.json(getSatStatus())
  } catch (error) {
    const status = error instanceof SatServiceError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown SAT status error.',
    })
  }
})

app.post('/api/sat/auth/test', async (_request, response) => {
  try {
    response.json(await runSatAuthenticationTest())
  } catch (error) {
    const status = error instanceof SatServiceError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown SAT authentication error.',
    })
  }
})

app.post('/api/sat/cfdi/request', async (request, response) => {
  try {
    response.json(await createSatCfdiRequest(request.body))
  } catch (error) {
    const status = error instanceof SatServiceError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown SAT request error.',
    })
  }
})

app.get('/api/sat/cfdi/request/:requestId', async (request, response) => {
  try {
    response.json(await verifySatCfdiRequest(String(request.params.requestId ?? '')))
  } catch (error) {
    const status = error instanceof SatServiceError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown SAT verify error.',
    })
  }
})

app.get('/api/sat/cfdi/package/:packageId', async (request, response) => {
  try {
    response.json(await inspectSatCfdiPackage(String(request.params.packageId ?? '')))
  } catch (error) {
    const status = error instanceof SatServiceError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown SAT package inspect error.',
    })
  }
})

app.get('/api/sat/cfdi/package/:packageId/netsuite-preview', async (request, response) => {
  try {
    response.json(await previewSatPackageForNetsuite(String(request.params.packageId ?? '')))
  } catch (error) {
    const status = error instanceof SatServiceError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown SAT NetSuite preview error.',
    })
  }
})

app.get('/api/sat/cfdi/package/:packageId/download', async (request, response) => {
  try {
    const packageFile = await downloadSatCfdiPackageFile(String(request.params.packageId ?? ''))
    response
      .status(200)
      .setHeader('Content-Type', 'application/zip')
      .setHeader('Content-Disposition', `attachment; filename="${packageFile.filename}"`)
      .send(packageFile.buffer)
  } catch (error) {
    const status = error instanceof SatServiceError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown SAT package download error.',
    })
  }
})

app.get('/api/sat/download-history', async (request, response) => {
  try {
    const rawLimit = typeof request.query.limit === 'string' ? Number(request.query.limit) : undefined
    response.json(await getSatDownloadHistory(rawLimit))
  } catch (error) {
    const status = error instanceof SatServiceError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown SAT download history error.',
    })
  }
})

app.get('/api/sat/analysis/windows', (_request, response) => {
  try {
    response.json(getSatAnalysisWindowsSummary())
  } catch (error) {
    const status = error instanceof SatServiceError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown SAT analysis windows error.',
    })
  }
})

app.post('/api/sat/analysis/windows/bootstrap', async (request, response) => {
  try {
    response.json(
      await bootstrapSatReceivedInvoicesAnalysisWindow({
        startAtUtc: String(request.body?.startAtUtc ?? ''),
        endAtUtc: String(request.body?.endAtUtc ?? ''),
        documentType:
          typeof request.body?.documentType === 'string' ? request.body.documentType : undefined,
      }),
    )
  } catch (error) {
    const status = error instanceof SatServiceError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown SAT analysis bootstrap error.',
    })
  }
})

app.post('/api/sat/analysis/windows/:windowId/reconcile', async (request, response) => {
  try {
    response.json(await reconcileSatAnalysisWindow(String(request.params.windowId ?? '')))
  } catch (error) {
    const status = error instanceof SatServiceError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown SAT analysis reconcile error.',
    })
  }
})

app.post('/api/sat/analysis/windows/:windowId/invoices/:uuid/upload', async (request, response) => {
  try {
    response.json(
      await uploadSatAnalysisInvoiceToNetSuite({
        windowId: String(request.params.windowId ?? ''),
        uuid: String(request.params.uuid ?? ''),
        dryRun: Boolean(request.body?.dryRun),
      }),
    )
  } catch (error) {
    const status = error instanceof SatServiceError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown SAT upload to NetSuite error.',
    })
  }
})

app.get('/api/sat/homologation/manual', (_request, response) => {
  try {
    response.json(listSatManualHomologations())
  } catch (error) {
    const status = error instanceof SatServiceError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown SAT manual homologation error.',
    })
  }
})

app.post('/api/sat/homologation/manual/provider', async (request, response) => {
  try {
    response.json(
      await upsertSatManualProviderHomologation({
        nombreEmisor: typeof request.body?.nombreEmisor === 'string' ? request.body.nombreEmisor : null,
        emisorRfc: typeof request.body?.emisorRfc === 'string' ? request.body.emisorRfc : null,
        saveByName: request.body?.saveByName !== false,
        saveByRfc: request.body?.saveByRfc !== false,
        supplierInternalId:
          typeof request.body?.supplierInternalId === 'string' ? request.body.supplierInternalId : null,
        supplierDisplayName:
          typeof request.body?.supplierDisplayName === 'string' ? request.body.supplierDisplayName : null,
        ccDisplayName: typeof request.body?.ccDisplayName === 'string' ? request.body.ccDisplayName : null,
        ccInternalId: typeof request.body?.ccInternalId === 'string' ? request.body.ccInternalId : null,
      }),
    )
  } catch (error) {
    const status = error instanceof SatServiceError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown SAT provider homologation error.',
    })
  }
})

app.post('/api/sat/homologation/manual/account', async (request, response) => {
  try {
    response.json(
      await upsertSatManualAccountHomologation({
        claveProdServ: typeof request.body?.claveProdServ === 'string' ? request.body.claveProdServ : null,
        accountDisplayName:
          typeof request.body?.accountDisplayName === 'string' ? request.body.accountDisplayName : null,
        accountInternalId:
          typeof request.body?.accountInternalId === 'string' ? request.body.accountInternalId : null,
      }),
    )
  } catch (error) {
    const status = error instanceof SatServiceError ? error.status : 503
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Unknown SAT account homologation error.',
    })
  }
})

app.get('/api/auth/netsuite/login', (_request, response) => {
  try {
    const oauthService = NetSuiteOAuthService.fromEnv()
    const { authorizationUrl } = oauthService.beginAuthorization()
    response.redirect(authorizationUrl)
  } catch (error) {
    response
      .status(503)
      .type('html')
      .send(
        renderOAuthCallbackPage({
          success: false,
          title: 'NetSuite OAuth unavailable',
          message: error instanceof Error ? error.message : 'Unknown NetSuite OAuth login error.',
        }),
      )
  }
})

app.get('/api/auth/netsuite/callback', async (request, response) => {
  const oauthService = NetSuiteOAuthService.fromEnvIfConfigured()
  const frontendReturnUrl = oauthService?.getStatus().frontendReturnUrl

  const providerError = request.query.error
  const providerErrorDescription = request.query.error_description
  if (providerError) {
    response
      .status(400)
      .type('html')
      .send(
        renderOAuthCallbackPage({
          success: false,
          title: 'NetSuite authorization failed',
          message: `${String(providerError)}${providerErrorDescription ? `: ${String(providerErrorDescription)}` : ''}`,
          frontendReturnUrl,
        }),
      )
    return
  }

  if (!oauthService) {
    response
      .status(503)
      .type('html')
      .send(
        renderOAuthCallbackPage({
          success: false,
          title: 'NetSuite OAuth unavailable',
          message: 'OAuth 2.0 is not configured in the backend yet.',
          frontendReturnUrl,
        }),
      )
    return
  }

  try {
    const code = String(request.query.code ?? '')
    const state = String(request.query.state ?? '')

    if (!code || !state) {
      throw new Error('The callback is missing the authorization code or state.')
    }

    await oauthService.exchangeAuthorizationCode(code, state)

    response
      .status(200)
      .type('html')
      .send(
        renderOAuthCallbackPage({
          success: true,
          title: 'NetSuite connected',
          message: 'OAuth 2.0 authorization finished successfully. The console can now refresh live data.',
          frontendReturnUrl,
        }),
      )
  } catch (error) {
    response
      .status(400)
      .type('html')
      .send(
        renderOAuthCallbackPage({
          success: false,
          title: 'NetSuite callback error',
          message: error instanceof Error ? error.message : 'Unknown NetSuite OAuth callback error.',
          frontendReturnUrl,
        }),
      )
  }
})

app.post('/api/auth/netsuite/revoke', async (_request, response) => {
  try {
    const oauthService = NetSuiteOAuthService.fromEnv()
    response.json(await oauthService.revokeStoredSession())
  } catch (error) {
    response.status(503).json({
      error: error instanceof Error ? error.message : 'Unknown NetSuite OAuth revoke error.',
    })
  }
})

app.post('/api/netsuite/suiteql', async (request, response) => {
  try {
    const client = NetSuiteClient.fromEnv()
    const query = String(request.body.query ?? '')
    const limit = Number(request.body.limit ?? 5)
    const offset = Number(request.body.offset ?? 0)
    response.json(await client.suiteql(query, limit, offset))
  } catch (error) {
    response.status(503).json({
      error: error instanceof Error ? error.message : 'Unknown NetSuite error.',
    })
  }
})

app.get('/api/netsuite/analysis/bootstrap', async (request, response) => {
  try {
    const client = NetSuiteClient.fromEnv()
    const limits = {
      openInvoices: request.query.openInvoices,
      arJournalCandidates: request.query.arJournalCandidates,
      postingPeriods: request.query.postingPeriods,
    }

    response.json(await runBootstrapAnalysis(client, limits))
  } catch (error) {
    response.status(503).json({
      error: error instanceof Error ? error.message : 'Unknown NetSuite analysis error.',
      starterQueries: getBootstrapQueries({
        openInvoices: request.query.openInvoices,
        arJournalCandidates: request.query.arJournalCandidates,
        postingPeriods: request.query.postingPeriods,
      }),
    })
  }
})

if (hasFrontendBuild) {
  app.use(
    express.static(frontendDistDir, {
      index: false,
      setHeaders(response, filePath) {
        if (filePath.endsWith('.html')) {
          response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
          response.setHeader('Pragma', 'no-cache')
          response.setHeader('Expires', '0')
          return
        }

        if (filePath.includes(`${sep}assets${sep}`)) {
          response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
          response.setHeader('Pragma', 'no-cache')
          response.setHeader('Expires', '0')
        }
      },
    }),
  )
  app.use((request, response, next) => {
    const isApiRequest = request.path === '/api' || request.path.startsWith('/api/')
    const isPageRequest = request.method === 'GET' || request.method === 'HEAD'

    if (!isPageRequest || isApiRequest) {
      next()
      return
    }

    response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
    response.setHeader('Pragma', 'no-cache')
    response.setHeader('Expires', '0')
    response.sendFile(frontendIndexPath, (error) => {
      if (error) {
        next(error)
      }
    })
  })
}

app.listen(port, host, () => {
  if (hasFrontendBuild) {
    console.log(`NetSuite recon frontend served from ${frontendDistDir}`)
  } else {
    console.log(`Frontend build not found at ${frontendDistDir}. API mode only.`)
  }
  console.log(`NetSuite recon backend listening on ${publicBaseUrl ?? `http://${host}:${port}`}`)
})
