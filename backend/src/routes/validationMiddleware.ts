import type { NextFunction, Request, Response } from 'express'
import type { ValidationErrorResponse } from './httpTypes.js'

export function validateBody<T>(
  guard: (value: unknown) => value is T,
  errorMessage: string,
  code = 'VALIDATION_ERROR',
) {
  return function validateRequestBody(
    request: Request<unknown, unknown, unknown>,
    response: Response<ValidationErrorResponse>,
    next: NextFunction,
  ) {
    if (!guard(request.body)) {
      response.status(400).json({
        error: errorMessage,
        code,
      })
      return
    }

    next()
  }
}
