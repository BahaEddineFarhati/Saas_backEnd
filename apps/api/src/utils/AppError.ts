/**
 * Custom application error class for operational errors.
 * Extends native Error with status code and error code for API responses.
 */
export class AppError extends Error {
  public readonly isOperational: boolean = true;

  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}
