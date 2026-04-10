import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';

export function requestLogger(req: AuthRequest, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms - User: ${req.user?.email || 'anonymous'}`);
  });

  next();
}