import type { BancosAnalysisStartRequest } from '../services/bancosService.js'

export function isBancosAnalysisStartRequest(value: unknown): value is BancosAnalysisStartRequest {
  if (!value || typeof value !== 'object') {
    return false
  }

  const body = value as Record<string, unknown>

  return (
    typeof body.bankId === 'string' &&
    body.bankId.trim().length > 0 &&
    typeof body.fileName === 'string' &&
    body.fileName.trim().length > 0 &&
    typeof body.fileBase64 === 'string' &&
    body.fileBase64.trim().length > 0
  )
}
