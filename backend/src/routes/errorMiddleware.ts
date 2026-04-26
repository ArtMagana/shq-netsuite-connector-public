import type { ErrorRequestHandler } from 'express'
import { AppError } from '../errors/AppError.js'

function getErrorStatus(error: unknown): number {
  if (error instanceof AppError) {
    return error.status
  }

  return 500
}

function getErrorCode(error: unknown): string {
  if (error instanceof AppError) {
    return error.code
  }

  return 'INTERNAL_SERVER_ERROR'
}

export const errorMiddleware: ErrorRequestHandler = (error, _request, response, _next) => {
  const status = getErrorStatus(error)

  response.status(status).json({
    success: false,
    error: error instanceof Error ? error.message : 'Internal server error.',
    code: getErrorCode(error),
  })
}
