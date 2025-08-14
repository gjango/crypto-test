import { Request, Response, NextFunction } from 'express';
import { AppError, isAppError, isTrustedError } from '../utils/errors';
import { createLogger } from '../utils/logger';
import { config } from '../config/environment';

const logger = createLogger('ErrorHandler');

export const errorHandler = (
  error: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (res.headersSent) {
    return next(error);
  }

  const requestInfo = {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    body: req.body,
    params: req.params,
    query: req.query,
  };

  if (isAppError(error)) {
    if (!error.isOperational) {
      logger.error('Non-operational application error occurred', error, requestInfo);
    } else {
      logger.warn('Operational error occurred', { 
        message: error.message, 
        code: error.code,
        statusCode: error.statusCode,
        details: error.details,
        ...requestInfo 
      });
    }

    res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(config.env === 'development' && { details: error.details }),
        ...(config.env === 'development' && { stack: error.stack }),
      },
    });
  } else {
    logger.error('Unexpected error occurred', error, requestInfo);

    const statusCode = 500;
    const message = config.env === 'production' 
      ? 'An unexpected error occurred' 
      : error.message;

    res.status(statusCode).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message,
        ...(config.env === 'development' && { stack: error.stack }),
      },
    });
  }
};

export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.originalUrl} not found`,
    },
  });
};

export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export const handleUncaughtExceptions = (): void => {
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception', error);
    
    if (!isTrustedError(error)) {
      process.exit(1);
    }
  });
};

export const handleUnhandledRejections = (): void => {
  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    logger.error('Unhandled Rejection', new Error(reason), { promise });
    
    if (!isTrustedError(reason)) {
      process.exit(1);
    }
  });
};

export const gracefulShutdown = (server: any): void => {
  const shutdown = (signal: string) => {
    logger.info(`${signal} received. Starting graceful shutdown...`);
    
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Forcefully shutting down');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};