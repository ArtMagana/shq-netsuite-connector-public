import type { NextFunction, Request, Response } from 'express'

export function validateBody<T>(guard: (value: unknown) => value is T, errorMessage: string) {
  return function validateRequestBody(request: Request<unknown, unknown, unknown>, response: Response, next: NextFunction) {
    if (!guard(request.body)) {
      response.status(400).json({
        error: errorMessage,
      })
      return
    }

    next()
  }
}
