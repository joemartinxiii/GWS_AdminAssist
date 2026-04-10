import { Request, Response, NextFunction } from 'express';

export interface AppError extends Error {
  statusCode?: number;
  status?: number;
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const statusCode = err.statusCode || err.status || 500;

  // Log full error details securely
  console.error('Error:', {
    message: err.message,
    statusCode,
    path: req.path,
    method: req.method,
    // Only include stack in development
    ...(isDevelopment && { stack: err.stack })
  });

  // Generic error messages for production to prevent information disclosure
  const clientMessage = isDevelopment ? err.message : 'An unexpected error occurred';

  res.status(statusCode).json({
    error: clientMessage,
    ...(isDevelopment && { stack: err.stack })
  });
}

export function notFoundHandler(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  res.status(404).json({
    error: `Route ${req.method} ${req.path} not found`,
  });
}
