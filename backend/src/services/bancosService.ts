import { startBankImportAnalysisRun as startBankImportAnalysisRunCore } from '../bankImports.js'

export function startBankImportAnalysisRun(request: Parameters<typeof startBankImportAnalysisRunCore>[0]) {
  return startBankImportAnalysisRunCore(request)
}
