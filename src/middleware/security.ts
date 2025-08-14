import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config/environment';
import { RateLimitError } from '../utils/errors';

export const helmetMiddleware = helmet({
  contentSecurityPolicy: config.env === 'production',
  crossOriginEmbedderPolicy: config.env === 'production',
});

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    const allowedOrigins = config.security.corsOrigin.split(',').map(o => o.trim());
    
    if (!origin || allowedOrigins.includes(origin) || config.env === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Session-Id'],
  exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Per-Page'],
});

export const createRateLimiter = (options?: Partial<{
  windowMs: number;
  max: number;
  message: string;
  keyGenerator?: (req: Request) => string;
}>) => {
  return rateLimit({
    windowMs: options?.windowMs ?? config.rateLimit.windowMs,
    max: options?.max ?? config.rateLimit.max,
    message: options?.message ?? 'Too many requests from this IP',
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: config.rateLimit.skipSuccessfulRequests,
    keyGenerator: options?.keyGenerator ?? ((req: Request) => req.ip ?? 'unknown'),
    handler: (req: Request, res: Response, next: NextFunction) => {
      throw new RateLimitError(options?.message ?? 'Too many requests');
    },
  });
};

export const globalRateLimiter = createRateLimiter();

export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many authentication attempts',
});

export const tradingRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many trading requests',
});

export const wsRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 100,
  message: 'Too many WebSocket messages',
});

export const mongoSanitizeMiddleware = mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key }: { req: Request; key: string }) => {
    console.warn(`Attempted NoSQL injection sanitized in ${key}`);
  },
});

export const securityHeaders = (req: Request, res: Response, next: NextFunction): void => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  res.removeHeader('X-Powered-By');
  
  next();
};

export const preventParameterPollution = (req: Request, res: Response, next: NextFunction): void => {
  for (const key in req.query) {
    if (Array.isArray(req.query[key])) {
      req.query[key] = (req.query[key] as string[])[0] as any;
    }
  }
  next();
};

export const requestSizeLimit = (limit: string = '10mb') => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = req.get('content-length');
    if (contentLength) {
      const bytes = parseInt(contentLength, 10);
      const maxBytes = parseSize(limit);
      if (bytes > maxBytes) {
        res.status(413).json({
          success: false,
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: `Request entity too large. Maximum size: ${limit}`,
          },
        });
        return;
      }
    }
    next();
  };
};

const parseSize = (size: string): number => {
  const units: { [key: string]: number } = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
  };
  
  const match = size.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([a-z]+)?$/);
  if (!match) return 10 * 1024 * 1024;
  
  const value = parseFloat(match[1] ?? '10');
  const unit = match[2] ?? 'mb';
  const multiplier = units[unit];
  
  return Math.floor(value * (multiplier ?? 1024 * 1024));
};