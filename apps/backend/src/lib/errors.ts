function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number }
  err.statusCode = statusCode
  return err
}

export const unauthorized = (msg = 'Authentication required') => httpError(401, msg)
export const forbidden = (msg = 'Insufficient permissions') => httpError(403, msg)
export const notFound = (msg = 'Resource not found') => httpError(404, msg)
export const conflict = (msg: string) => httpError(409, msg)
export const badRequest = (msg: string) => httpError(400, msg)
