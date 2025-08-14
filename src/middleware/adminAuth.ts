import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createLogger } from '../utils/logger';
import { User } from '../models/User.model';
import { ITokenPayload } from '../types/auth';
import { UserRole } from '../types/enums';

const logger = createLogger('AdminAuth');

// Extend Request interface to include admin info
declare global {
  namespace Express {
    interface Request {
      admin?: {
        id: string;
        email: string;
        isAdmin: boolean;
      };
    }
  }
}

/**
 * Admin authentication middleware
 */
export const adminAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        message: 'No token provided',
      });
      return;
    }
    
    const token = authHeader.substring(7);
    
    // Verify token
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'your-secret-key'
    ) as ITokenPayload;
    
    // Get user from database
    const user = await User.findById(decoded.userId)
      .select('+roles')
      .lean();
    
    if (!user) {
      res.status(401).json({
        success: false,
        message: 'User not found',
      });
      return;
    }
    
    // Check if user is admin (roles is an array)
    const isAdmin = user.roles && user.roles.includes(UserRole.ADMIN);
    
    if (!isAdmin) {
      res.status(403).json({
        success: false,
        message: 'Admin access required',
      });
      return;
    }
    
    // Set admin info on request
    req.admin = {
      id: user._id.toString(),
      email: user.email,
      isAdmin: true,
    };
    
    // Set user info for compatibility with ITokenPayload
    req.user = {
      userId: user._id.toString(),
      email: user.email,
      username: user.username || user.email,
      roles: user.roles || [UserRole.ADMIN],
      permissions: [],
      type: 'access',
    };
    
    // Log admin action
    logger.info(`Admin action by ${user.email}: ${req.method} ${req.path}`);
    
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      res.status(401).json({
        success: false,
        message: 'Token expired',
      });
      return;
    }
    
    if (error.name === 'JsonWebTokenError') {
      res.status(401).json({
        success: false,
        message: 'Invalid token',
      });
      return;
    }
    
    logger.error('Admin auth error', error);
    res.status(500).json({
      success: false,
      message: 'Authentication error',
    });
  }
};

/**
 * Simple admin check - all admins have full access
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.admin || !req.admin.isAdmin) {
    res.status(403).json({
      success: false,
      message: 'Admin access required',
    });
    return;
  }
  
  next();
};

/**
 * Rate limiting for admin endpoints
 */
const adminRateLimits = new Map<string, { count: number; resetTime: number }>();

export const adminRateLimit = (
  maxRequests: number = 100,
  windowMs: number = 60000 // 1 minute
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.admin) {
      next();
      return;
    }
    
    const key = `${req.admin.id}:${req.path}`;
    const now = Date.now();
    
    const limit = adminRateLimits.get(key);
    
    if (!limit || limit.resetTime < now) {
      // Create new limit window
      adminRateLimits.set(key, {
        count: 1,
        resetTime: now + windowMs,
      });
      next();
      return;
    }
    
    if (limit.count >= maxRequests) {
      const retryAfter = Math.ceil((limit.resetTime - now) / 1000);
      
      res.status(429).json({
        success: false,
        message: 'Too many requests',
        retryAfter,
      });
      return;
    }
    
    limit.count++;
    next();
  };
};

/**
 * Log admin actions
 */
export const logAdminAction = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Log the action after response is sent
  res.on('finish', () => {
    if (req.admin && res.statusCode < 400) {
      logger.info(`Admin action completed: ${req.method} ${req.path} by ${req.admin.email} - Status: ${res.statusCode}`);
    }
  });
  
  next();
};

/**
 * Validate admin session
 */
export const validateAdminSession = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.admin) {
    next();
    return;
  }
  
  // Check if user is still active and admin
  const user = await User.findById(req.admin.id)
    .select('roles isActive')
    .lean();
  
  if (!user || !user.isActive) {
    res.status(401).json({
      success: false,
      message: 'Account inactive',
    });
    return;
  }
  
  if (!user.roles || !user.roles.includes(UserRole.ADMIN)) {
    res.status(403).json({
      success: false,
      message: 'Admin privileges revoked',
    });
    return;
  }
  
  next();
};