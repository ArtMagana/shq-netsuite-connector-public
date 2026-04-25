import type { ErrorRequestHandler } from 'express'

function getErrorStatus(error: unknown): number {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number' && Number.isFinite(status)) {
      return status
    }
  }

  return 500
}

export const errorMiddleware: ErrorRequestHandler = (error, _request, response, _next) => {
  const status = getErrorStatus(error)

  response.status(status).json({
    error: error instanceof Error ? error.message : 'Internal server error.',
  })
}
