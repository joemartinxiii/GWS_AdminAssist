import { Request, Response, NextFunction } from 'express';
import { normalizeApiError } from '../utils/apiError';

export interface AppError extends Error {
  statusCode?: number;
  status?: number;
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const { status, message, code, hint } = normalizeApiError(err);

  console.error('Error:', {
    message,
    code,
    statusCode: status,
    path: req.path,
    method: req.method,
    ...(isProduction ? {} : { stack: err.stack }),
  });

  const isServerError = status >= 500;
  const clientMessage = isServerError && isProduction ? 'An unexpected error occurred' : message;

  res.status(status).json({
    error: clientMessage,
    ...(code ? { code } : {}),
    ...(hint ? { hint } : {}),
    ...(isProduction ? {} : { stack: err.stack }),
  });
}

export function notFoundHandler(
  req: Request,
  _res: Response,
  _next: NextFunction
): void {
  _res.status(404).json({
    error: `Route ${req.method} ${req.path} not found`,
  });
}
