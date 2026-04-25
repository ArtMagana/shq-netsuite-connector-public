import { Router } from 'express'

export function createBancosRoutes(deps: any) {
  const {
    analyzeBankImport,
    analyzeBankImportSample,
    getBankImportConfig,
    getBankImportAnalysisRunStatus,
    postBankImportJournals,
    recoverBankImportAnalysisRun,
    saveBankImportCorrection,
    saveBankImportValidatedBalance,
    searchBankImportCandidates,
    startBankImportAnalysisRun,
    uploadBankHistoricalStatement,
    listBankIndividualPaymentFileMetadata,
    upsertBankIndividualPaymentFiles,
    getBanxicoCepInstitutions,
    lookupBanxicoCep,
    downloadBanxicoCepDetails,
  } = deps

  const router = Router()

  router.get('/config', (_req, res) => res.json(getBankImportConfig()))

  router.post('/analyze', async (req, res) =>
    res.json(await analyzeBankImport(req.body))
  )

  router.post('/analysis/start', (req, res) =>
    res.json(startBankImportAnalysisRun(req.body))
  )

  router.post('/analysis/recover', (req, res) =>
    res.json(recoverBankImportAnalysisRun(req.body))
  )

  router.get('/analysis/:analysisId', (req, res) =>
    res.json(getBankImportAnalysisRunStatus(String(req.params.analysisId ?? '')))
  )

  router.post('/history/upload', async (req, res) =>
    res.json(await uploadBankHistoricalStatement(req.body))
  )

  router.get('/pagos-individuales', (req, res) => {
    const bankId = String(req.query.bankId ?? 'bbva')
    res.json({ bankId, items: listBankIndividualPaymentFileMetadata(bankId) })
  })

  router.post('/pagos-individuales/upload', (req, res) =>
    res.json(upsertBankIndividualPaymentFiles(req.body))
  )

  router.get('/sample', async (req, res) =>
    res.json(await analyzeBankImportSample(String(req.query.bankId ?? 'payana'), null))
  )

  router.post('/sample', async (req, res) =>
    res.json(await analyzeBankImportSample(String(req.body?.bankId ?? 'payana'), null))
  )

  router.get('/candidates', async (req, res) =>
    res.json(await searchBankImportCandidates(req.query))
  )

  router.post('/corrections', (req, res) =>
    res.json(saveBankImportCorrection(req.body))
  )

  router.post('/journals/post', async (req, res) =>
    res.json(await postBankImportJournals(req.body))
  )

  router.post('/saldo-validado', (req, res) =>
    res.json(saveBankImportValidatedBalance(req.body))
  )

  router.get('/cep/status', async (_req, res) =>
    res.json(await getBanxicoCepInstitutions(null))
  )

  router.get('/cep/institutions', async (_req, res) =>
    res.json(await getBanxicoCepInstitutions(null))
  )

  router.post('/cep/lookup', async (req, res) =>
    res.json(await lookupBanxicoCep(req.body))
  )

  router.post('/cep/details', async (req, res) =>
    res.json(await downloadBanxicoCepDetails(req.body))
  )

  return router
}
