import { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { createLogger } from '../../utils/logger';
import { User } from '../../models/User.model';
import { ITokenPayload } from '../../types/auth';

const logger = createLogger('WebSocketAuth');

export class AuthMiddleware {
  /**
   * Create authentication middleware
   */
  public static create(requireAuth: boolean = false) {
    return async (socket: Socket, next: (err?: Error) => void) => {
      try {
        const token = AuthMiddleware.extractToken(socket);

        if (!token) {
          if (requireAuth) {
            return next(new Error('Authentication required'));
          }
          // Allow anonymous connections for public namespaces
          socket.data.authenticated = false;
          return next();
        }

        // Verify token
        const payload = await AuthMiddleware.verifyToken(token);
        if (!payload) {
          if (requireAuth) {
            return next(new Error('Invalid authentication token'));
          }
          socket.data.authenticated = false;
          return next();
        }

        // Check if user exists and is active
        const user = await User.findById(payload.userId).lean();
        if (!user || !user.isActive) {
          if (requireAuth) {
            return next(new Error('User not found or inactive'));
          }
          socket.data.authenticated = false;
          return next();
        }

        // Attach user data to socket
        socket.data.userId = payload.userId;
        socket.data.email = user.email;
        socket.data.role = payload.role;
        socket.data.permissions = payload.permissions;
        socket.data.authenticated = true;

        logger.debug(`Socket ${socket.id} authenticated as user ${payload.userId}`);
        next();
      } catch (error) {
        logger.error('Authentication error:', error);
        if (requireAuth) {
          next(new Error('Authentication failed'));
        } else {
          socket.data.authenticated = false;
          next();
        }
      }
    };
  }

  /**
   * Extract token from socket
   */
  private static extractToken(socket: Socket): string | null {
    // Try auth object first (preferred method)
    if (socket.handshake.auth && socket.handshake.auth.token) {
      return socket.handshake.auth.token;
    }

    // Try query parameter
    if (socket.handshake.query && socket.handshake.query.token) {
      return socket.handshake.query.token as string;
    }

    // Try authorization header
    const authHeader = socket.handshake.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    return null;
  }

  /**
   * Verify JWT token
   */
  private static async verifyToken(token: string): Promise<ITokenPayload | null> {
    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        logger.error('JWT_SECRET not configured');
        return null;
      }

      const payload = jwt.verify(token, secret) as ITokenPayload;
      
      // Check token expiration
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        logger.debug('Token expired');
        return null;
      }

      return payload;
    } catch (error) {
      logger.debug('Token verification failed:', error);
      return null;
    }
  }

  /**
   * Create admin-only middleware
   */
  public static adminOnly() {
    return async (socket: Socket, next: (err?: Error) => void) => {
      // First authenticate
      await AuthMiddleware.create(true)(socket, (err) => {
        if (err) return next(err);

        // Check admin role
        if (socket.data.role !== 'admin') {
          return next(new Error('Admin access required'));
        }

        next();
      });
    };
  }

  /**
   * Create permission-based middleware
   */
  public static requirePermission(permission: string) {
    return async (socket: Socket, next: (err?: Error) => void) => {
      // First authenticate
      await AuthMiddleware.create(true)(socket, (err) => {
        if (err) return next(err);

        // Check permission
        const permissions = socket.data.permissions || [];
        if (!permissions.includes(permission)) {
          return next(new Error(`Missing required permission: ${permission}`));
        }

        next();
      });
    };
  }

  /**
   * Refresh authentication
   */
  public static async refreshAuth(socket: Socket): Promise<boolean> {
    try {
      const token = AuthMiddleware.extractToken(socket);
      if (!token) {
        socket.data.authenticated = false;
        return false;
      }

      const payload = await AuthMiddleware.verifyToken(token);
      if (!payload) {
        socket.data.authenticated = false;
        return false;
      }

      // Update socket data
      socket.data.userId = payload.userId;
      socket.data.role = payload.role;
      socket.data.permissions = payload.permissions;
      socket.data.authenticated = true;

      return true;
    } catch (error) {
      logger.error('Auth refresh error:', error);
      socket.data.authenticated = false;
      return false;
    }
  }
}