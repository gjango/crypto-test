import { Socket } from 'socket.io';
import { createLogger } from '../../utils/logger';
import { RateLimitConfig } from '../config';

const logger = createLogger('WebSocketRateLimit');

interface RateLimitEntry {
  points: number;
  resetAt: number;
  blocked: boolean;
  blockUntil?: number;
}

export class RateLimitMiddleware {
  private static limiters: Map<string, Map<string, RateLimitEntry>> = new Map();
  private static cleanupInterval: NodeJS.Timeout;

  /**
   * Create rate limiting middleware
   */
  public static create(config: RateLimitConfig) {
    // Start cleanup interval if not already running
    if (!RateLimitMiddleware.cleanupInterval) {
      RateLimitMiddleware.cleanupInterval = setInterval(() => {
        RateLimitMiddleware.cleanup();
      }, 60000); // Clean up every minute
    }

    return (socket: Socket, next: (err?: Error) => void) => {
      const key = RateLimitMiddleware.getKey(socket);
      const limiterKey = `global`;
      
      if (!RateLimitMiddleware.checkLimit(key, limiterKey, config)) {
        logger.warn(`Rate limit exceeded for ${key}`);
        return next(new Error('Rate limit exceeded'));
      }

      // Add rate limit handler for events
      const originalEmit = socket.emit;
      let eventCount = 0;
      let resetTime = Date.now() + 1000;

      socket.emit = function(...args: any[]) {
        const now = Date.now();
        
        // Reset counter every second
        if (now > resetTime) {
          eventCount = 0;
          resetTime = now + 1000;
        }

        eventCount++;
        
        // Check events per second limit
        if (eventCount > config.points) {
          logger.warn(`Socket ${socket.id} exceeded events per second limit`);
          socket.disconnect(true);
          return false;
        }

        return originalEmit.apply(socket, args);
      };

      next();
    };
  }

  /**
   * Create namespace-specific rate limiter
   */
  public static createForNamespace(namespace: string, config: RateLimitConfig) {
    return (socket: Socket, next: (err?: Error) => void) => {
      const key = RateLimitMiddleware.getKey(socket);
      const limiterKey = `namespace:${namespace}`;
      
      if (!RateLimitMiddleware.checkLimit(key, limiterKey, config)) {
        logger.warn(`Rate limit exceeded for ${key} on namespace ${namespace}`);
        return next(new Error('Rate limit exceeded'));
      }

      next();
    };
  }

  /**
   * Create event-specific rate limiter
   */
  public static createForEvent(event: string, config: RateLimitConfig) {
    return (data: any, callback: (err?: Error) => void) => {
      const socket = this as Socket;
      const key = RateLimitMiddleware.getKey(socket);
      const limiterKey = `event:${event}`;
      
      if (!RateLimitMiddleware.checkLimit(key, limiterKey, config)) {
        logger.warn(`Rate limit exceeded for ${key} on event ${event}`);
        return callback(new Error('Rate limit exceeded'));
      }

      callback();
    };
  }

  /**
   * Get rate limit key for socket
   */
  private static getKey(socket: Socket): string {
    // Use user ID if authenticated, otherwise use IP + fingerprint
    if (socket.data.userId) {
      return `user:${socket.data.userId}`;
    }
    
    const ip = socket.handshake.address;
    const fingerprint = socket.data.fingerprint || 'unknown';
    return `anon:${ip}:${fingerprint}`;
  }

  /**
   * Check rate limit
   */
  private static checkLimit(
    key: string,
    limiterKey: string,
    config: RateLimitConfig
  ): boolean {
    if (!RateLimitMiddleware.limiters.has(limiterKey)) {
      RateLimitMiddleware.limiters.set(limiterKey, new Map());
    }

    const limiter = RateLimitMiddleware.limiters.get(limiterKey)!;
    const now = Date.now();
    let entry = limiter.get(key);

    // Check if blocked
    if (entry && entry.blocked && entry.blockUntil && entry.blockUntil > now) {
      return false;
    }

    // Initialize or reset entry
    if (!entry || now > entry.resetAt) {
      entry = {
        points: 0,
        resetAt: now + (config.duration * 1000),
        blocked: false,
      };
      limiter.set(key, entry);
    }

    // Increment points
    entry.points++;

    // Check if limit exceeded
    if (entry.points > config.points) {
      entry.blocked = true;
      entry.blockUntil = now + (config.blockDuration * 1000);
      logger.warn(`Blocking ${key} for ${config.blockDuration} seconds`);
      return false;
    }

    return true;
  }

  /**
   * Reset limits for a key
   */
  public static resetLimits(key: string): void {
    for (const limiter of RateLimitMiddleware.limiters.values()) {
      limiter.delete(key);
    }
  }

  /**
   * Clean up old entries
   */
  private static cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [limiterKey, limiter] of RateLimitMiddleware.limiters.entries()) {
      for (const [key, entry] of limiter.entries()) {
        // Remove entries that have been reset and not blocked
        if (now > entry.resetAt && (!entry.blocked || !entry.blockUntil || now > entry.blockUntil)) {
          limiter.delete(key);
          cleaned++;
        }
      }

      // Remove empty limiters
      if (limiter.size === 0) {
        RateLimitMiddleware.limiters.delete(limiterKey);
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned up ${cleaned} rate limit entries`);
    }
  }

  /**
   * Get statistics
   */
  public static getStats(): any {
    const stats: any = {};
    
    for (const [limiterKey, limiter] of RateLimitMiddleware.limiters.entries()) {
      const blocked = Array.from(limiter.values()).filter(e => e.blocked).length;
      stats[limiterKey] = {
        total: limiter.size,
        blocked,
        active: limiter.size - blocked,
      };
    }

    return stats;
  }

  /**
   * Shutdown cleanup
   */
  public static shutdown(): void {
    if (RateLimitMiddleware.cleanupInterval) {
      clearInterval(RateLimitMiddleware.cleanupInterval);
    }
    RateLimitMiddleware.limiters.clear();
  }
}