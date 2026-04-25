import { startBankImportAnalysisRun as startBankImportAnalysisRunCore } from '../bankImports.js'

export function startBankImportAnalysisRun(request: Parameters<typeof startBankImportAnalysisRunCore>[0]) {
  const bankId = typeof request?.bankId === 'string' ? request.bankId : 'unknown'
  const fileName = typeof request?.fileName === 'string' ? request.fileName : 'unknown'

  console.info(`Bancos analysis start requested | bank=${bankId} | file=${fileName}`)

  return startBankImportAnalysisRunCore(request)
}
