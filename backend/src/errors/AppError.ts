export class AppError extends Error {
  public readonly status: number
  public readonly code: string

  constructor(message: string, options?: { status?: number; code?: string }) {
    super(message)

    this.name = 'AppError'
    this.status = options?.status ?? 500
    this.code = options?.code ?? 'INTERNAL_SERVER_ERROR'
  }
}
