import { BankImportError, startBankImportAnalysisRun as startBankImportAnalysisRunCore } from '../bankImports.js'
import { logBancosServiceEvent } from './bancosLogger.js'

export type BancosAnalysisStartResult = ReturnType<typeof startBankImportAnalysisRunCore>

export type BancosAnalysisStartRequest = Parameters<typeof startBankImportAnalysisRunCore>[0]

export type BancosServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

function success<T>(data: T): BancosServiceResult<T> {
  return {
    success: true,
    data,
  }
}

function failure<T>(error: BankImportError): BancosServiceResult<T> {
  return {
    success: false,
    error: error.message,
  }
}

function normalizeBankImportError(error: unknown): BankImportError {
  if (error instanceof BankImportError) {
    return error
  }

  const message = error instanceof Error ? error.message : 'Unknown bank analysis error.'

  return new BankImportError(`No se pudo iniciar el analisis bancario: ${message}`)
}

export function startBankImportAnalysisRun(
  request: Parameters<typeof startBankImportAnalysisRunCore>[0],
): BancosServiceResult<BancosAnalysisStartResult> {
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

    logBancosServiceEvent('analysis_start_requested', {
      bankId,
      fileName,
    })

    return success(startBankImportAnalysisRunCore(request))
  } catch (error) {
    const normalizedError = normalizeBankImportError(error)

    const safeData: Record<string, unknown> = {
      error: normalizedError.message,
    }

    if (request && typeof request === 'object') {
      const maybe = request as Record<string, unknown>
      if (typeof maybe.bankId === 'string') safeData.bankId = maybe.bankId
      if (typeof maybe.fileName === 'string') safeData.fileName = maybe.fileName
    }

    logBancosServiceEvent('analysis_start_failed', safeData)

    return failure(normalizedError)
  }
}
