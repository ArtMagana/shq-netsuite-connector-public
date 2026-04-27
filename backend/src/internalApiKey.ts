import type { NextFunction, Request, Response } from 'express'
import type { AuthErrorResponse } from './routes/httpTypes.js'

const INTERNAL_API_KEY_HEADER = 'x-internal-api-key'

export function requireInternalApiKey(
  request: Request,
  response: Response<AuthErrorResponse>,
  next: NextFunction,
) {
  const expectedApiKey = process.env.INTERNAL_API_KEY?.trim()

  if (!expectedApiKey) {
    response.status(503).json({
      error: 'Internal API key is not configured.',
      code: 'INTERNAL_API_KEY_MISSING',
    })
    return
  }

  const receivedApiKey = request.header(INTERNAL_API_KEY_HEADER)?.trim()

  if (!receivedApiKey || receivedApiKey !== expectedApiKey) {
    response.status(401).json({
      error: 'Invalid internal API key.',
      code: 'INTERNAL_API_KEY_INVALID',
    })
    return
  }

  next()
}
