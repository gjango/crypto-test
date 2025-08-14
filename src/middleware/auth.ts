import { Request, Response, NextFunction } from 'express';
import authService from '../services/auth.service';
import { hasPermission } from '../config/rbac';
import { createLogger } from '../utils/logger';
import { AuthenticationError, AuthorizationError } from '../utils/errors';
import { ITokenPayload, Permission } from '../types/auth';
import { User } from '../models/User.model';

const logger = createLogger('AuthMiddleware');

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: ITokenPayload;
      sessionId?: string;
    }
  }
}

/**
 * Authenticate JWT token
 */
export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    
    if (!token) {
      throw new AuthenticationError('No token provided');
    }
    
    // Verify token
    const payload = await authService.verifyToken(token);
    
    // Check if user still exists and is active
    const user = await User.findById(payload.userId);
    if (!user || !user.isActive || user.isDeleted) {
      throw new AuthenticationError('User not found or inactive');
    }
    
    // Update last activity
    user.lastActivity = new Date();
    await user.save();
    
    // Attach user to request
    req.user = payload;
    req.sessionId = payload.sessionId;
    
    next();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      res.status(401).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_ERROR',
          message: error.message,
        },
      });
    } else {
      logger.error('Authentication error', error as Error);
      res.status(401).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_ERROR',
          message: 'Authentication failed',
        },
      });
    }
  }
};

/**
 * Optional authentication - doesn't fail if no token
 */
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token) {
      const payload = await authService.verifyToken(token);
      const user = await User.findById(payload.userId);
      
      if (user && user.isActive && !user.isDeleted) {
        req.user = payload;
        req.sessionId = payload.sessionId;
        
        // Update last activity
        user.lastActivity = new Date();
        await user.save();
      }
    }
    
    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};

/**
 * Authorize based on permissions
 */
export const authorize = (...requiredPermissions: Permission[]) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Not authenticated');
      }
      
      // Check if user has any of the required permissions
      const hasAnyPermission = requiredPermissions.some(permission =>
        hasPermission(req.user!.roles, permission, req.user!.permissions)
      );
      
      if (!hasAnyPermission) {
        logger.warn(
          `User ${req.user.email} denied access. Required: ${requiredPermissions.join(', ')}`
        );
        throw new AuthorizationError(
          `Insufficient permissions. Required: ${requiredPermissions.join(' or ')}`
        );
      }
      
      next();
    } catch (error) {
      if (error instanceof AuthorizationError) {
        res.status(403).json({
          success: false,
          error: {
            code: 'AUTHORIZATION_ERROR',
            message: error.message,
          },
        });
      } else if (error instanceof AuthenticationError) {
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTHENTICATION_ERROR',
            message: error.message,
          },
        });
      } else {
        logger.error('Authorization error', error as Error);
        res.status(403).json({
          success: false,
          error: {
            code: 'AUTHORIZATION_ERROR',
            message: 'Authorization failed',
          },
        });
      }
    }
  };
};

/**
 * Authorize based on roles
 */
export const authorizeRoles = (...requiredRoles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Not authenticated');
      }
      
      // Check if user has any of the required roles
      const hasRole = req.user.roles.some(role => requiredRoles.includes(role));
      
      if (!hasRole) {
        logger.warn(
          `User ${req.user.email} denied access. Required roles: ${requiredRoles.join(', ')}`
        );
        throw new AuthorizationError(
          `Insufficient role. Required: ${requiredRoles.join(' or ')}`
        );
      }
      
      next();
    } catch (error) {
      if (error instanceof AuthorizationError) {
        res.status(403).json({
          success: false,
          error: {
            code: 'AUTHORIZATION_ERROR',
            message: error.message,
          },
        });
      } else if (error instanceof AuthenticationError) {
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTHENTICATION_ERROR',
            message: error.message,
          },
        });
      } else {
        logger.error('Authorization error', error as Error);
        res.status(403).json({
          success: false,
          error: {
            code: 'AUTHORIZATION_ERROR',
            message: 'Authorization failed',
          },
        });
      }
    }
  };
};

/**
 * Check if user owns the resource
 */
export const authorizeOwnership = (userIdParam: string = 'userId') => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Not authenticated');
      }
      
      const resourceUserId = req.params[userIdParam] || req.body[userIdParam];
      
      if (!resourceUserId) {
        throw new AuthorizationError('Resource user ID not found');
      }
      
      // Allow if user owns the resource or is an admin
      const isOwner = req.user.userId === resourceUserId;
      const isAdmin = hasPermission(req.user.roles, Permission.USERS_MANAGE, req.user.permissions);
      
      if (!isOwner && !isAdmin) {
        logger.warn(
          `User ${req.user.email} denied access to resource owned by ${resourceUserId}`
        );
        throw new AuthorizationError('You do not have permission to access this resource');
      }
      
      next();
    } catch (error) {
      if (error instanceof AuthorizationError) {
        res.status(403).json({
          success: false,
          error: {
            code: 'AUTHORIZATION_ERROR',
            message: error.message,
          },
        });
      } else if (error instanceof AuthenticationError) {
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTHENTICATION_ERROR',
            message: error.message,
          },
        });
      } else {
        logger.error('Authorization error', error as Error);
        res.status(403).json({
          success: false,
          error: {
            code: 'AUTHORIZATION_ERROR',
            message: 'Authorization failed',
          },
        });
      }
    }
  };
};

/**
 * Rate limit by user ID
 */
export const userRateLimit = (limit: number = 100, windowMs: number = 60000) => {
  const requests = new Map<string, { count: number; resetTime: number }>();
  
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next();
    }
    
    const userId = req.user.userId;
    const now = Date.now();
    
    const userRequests = requests.get(userId);
    
    if (!userRequests || now > userRequests.resetTime) {
      // Reset window
      requests.set(userId, {
        count: 1,
        resetTime: now + windowMs,
      });
      return next();
    }
    
    if (userRequests.count >= limit) {
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_ERROR',
          message: 'Too many requests',
          retryAfter: Math.ceil((userRequests.resetTime - now) / 1000),
        },
      });
      return;
    }
    
    userRequests.count++;
    next();
  };
};

/**
 * Check if API access is allowed
 */
export const requireApiAccess = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new AuthenticationError('Not authenticated');
    }
    
    const hasApiAccess = 
      hasPermission(req.user.roles, Permission.API_TRADING, req.user.permissions) ||
      hasPermission(req.user.roles, Permission.API_UNLIMITED, req.user.permissions);
    
    if (!hasApiAccess) {
      throw new AuthorizationError('API access not enabled for this account');
    }
    
    next();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      res.status(403).json({
        success: false,
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: error.message,
        },
      });
    } else if (error instanceof AuthenticationError) {
      res.status(401).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_ERROR',
          message: error.message,
        },
      });
    } else {
      next(error);
    }
  }
};

/**
 * Log API access
 */
export const logApiAccess = (req: Request, res: Response, next: NextFunction): void => {
  if (req.user) {
    logger.info(`API Access: ${req.user.email} - ${req.method} ${req.path}`);
  }
  next();
};