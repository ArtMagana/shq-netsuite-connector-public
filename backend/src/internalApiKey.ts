import type { NextFunction, Request, Response } from 'express'

const INTERNAL_API_KEY_HEADER = 'x-internal-api-key'

export function requireInternalApiKey(request: Request, response: Response, next: NextFunction) {
  const expectedApiKey = process.env.INTERNAL_API_KEY?.trim()

  if (!expectedApiKey) {
    response.status(503).json({
      error: 'Internal API key is not configured.',
    })
    return
  }

  const receivedApiKey = request.header(INTERNAL_API_KEY_HEADER)?.trim()

  if (!receivedApiKey || receivedApiKey !== expectedApiKey) {
    response.status(401).json({
      error: 'Unauthorized.',
    })
    return
  }

  next()
}
