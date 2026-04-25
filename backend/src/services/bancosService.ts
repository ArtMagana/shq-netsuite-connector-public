import { BankImportError, startBankImportAnalysisRun as startBankImportAnalysisRunCore } from '../bankImports.js'

function normalizeBankImportError(error: unknown): BankImportError {
  if (error instanceof BankImportError) {
    return error
  }

  const message = error instanceof Error ? error.message : 'Unknown bank analysis error.'

  return new BankImportError(`No se pudo iniciar el analisis bancario: ${message}`)
}

export function startBankImportAnalysisRun(request: Parameters<typeof startBankImportAnalysisRunCore>[0]) {
  try {
    if (!request || typeof request !== 'object') {
      throw new BankImportError('La solicitud de analisis bancario no es valida.')
    }

    if (typeof request.bankId !== 'string' || !request.bankId.trim()) {
      throw new BankImportError('Debes indicar el banco para iniciar el analisis.')
    }

    if (typeof request.fileName !== 'string' || !request.fileName.trim()) {
      throw new BankImportError('Debes indicar el nombre del archivo bancario.')
    }

    if (typeof request.fileBase64 !== 'string' || !request.fileBase64.trim()) {
      throw new BankImportError('Debes adjuntar el archivo bancario en base64.')
    }

    const bankId = request.bankId
    const fileName = request.fileName

    console.info(`Bancos analysis start requested | bank=${bankId} | file=${fileName}`)

    return startBankImportAnalysisRunCore(request)
  } catch (error) {
    throw normalizeBankImportError(error)
  }
}
