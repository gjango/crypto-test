import { Socket } from 'socket.io';
import { createLogger } from '../utils/logger';

const logger = createLogger('ConnectionManager');

export interface ConnectionInfo {
  id: string;
  userId?: string;
  fingerprint: string;
  address: string;
  userAgent: string;
  connectedAt: Date;
  lastActivity: Date;
  subscriptions: Set<string>;
  metadata: Map<string, any>;
}

export class ConnectionManager {
  private connections: Map<string, ConnectionInfo> = new Map();
  private userConnections: Map<string, Set<string>> = new Map();
  private fingerprintConnections: Map<string, Set<string>> = new Map();

  /**
   * Add a new connection
   */
  public addConnection(socket: Socket): void {
    const info: ConnectionInfo = {
      id: socket.id,
      userId: socket.data.userId,
      fingerprint: socket.data.fingerprint,
      address: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent'] || 'unknown',
      connectedAt: new Date(),
      lastActivity: new Date(),
      subscriptions: new Set(),
      metadata: new Map(),
    };

    this.connections.set(socket.id, info);

    // Track user connections
    if (info.userId) {
      if (!this.userConnections.has(info.userId)) {
        this.userConnections.set(info.userId, new Set());
      }
      this.userConnections.get(info.userId)!.add(socket.id);
    }

    // Track fingerprint connections
    if (!this.fingerprintConnections.has(info.fingerprint)) {
      this.fingerprintConnections.set(info.fingerprint, new Set());
    }
    this.fingerprintConnections.get(info.fingerprint)!.add(socket.id);

    logger.debug(`Connection added: ${socket.id}`);
  }

  /**
   * Remove a connection
   */
  public removeConnection(socketId: string): void {
    const info = this.connections.get(socketId);
    if (!info) return;

    // Remove from user connections
    if (info.userId) {
      const userSockets = this.userConnections.get(info.userId);
      if (userSockets) {
        userSockets.delete(socketId);
        if (userSockets.size === 0) {
          this.userConnections.delete(info.userId);
        }
      }
    }

    // Remove from fingerprint connections
    const fingerprintSockets = this.fingerprintConnections.get(info.fingerprint);
    if (fingerprintSockets) {
      fingerprintSockets.delete(socketId);
      if (fingerprintSockets.size === 0) {
        this.fingerprintConnections.delete(info.fingerprint);
      }
    }

    this.connections.delete(socketId);
    logger.debug(`Connection removed: ${socketId}`);
  }

  /**
   * Update connection activity
   */
  public updateActivity(socketId: string): void {
    const info = this.connections.get(socketId);
    if (info) {
      info.lastActivity = new Date();
    }
  }

  /**
   * Set user ID for connection
   */
  public setUserId(socketId: string, userId: string): void {
    const info = this.connections.get(socketId);
    if (!info) return;

    // Remove from old user connections if exists
    if (info.userId && info.userId !== userId) {
      const oldUserSockets = this.userConnections.get(info.userId);
      if (oldUserSockets) {
        oldUserSockets.delete(socketId);
        if (oldUserSockets.size === 0) {
          this.userConnections.delete(info.userId);
        }
      }
    }

    // Add to new user connections
    info.userId = userId;
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    this.userConnections.get(userId)!.add(socketId);
  }

  /**
   * Get connection info
   */
  public getConnection(socketId: string): ConnectionInfo | undefined {
    return this.connections.get(socketId);
  }

  /**
   * Get user connections
   */
  public getUserConnections(userId: string): string[] {
    const socketIds = this.userConnections.get(userId);
    return socketIds ? Array.from(socketIds) : [];
  }

  /**
   * Get connections by fingerprint
   */
  public getFingerprintConnections(fingerprint: string): string[] {
    const socketIds = this.fingerprintConnections.get(fingerprint);
    return socketIds ? Array.from(socketIds) : [];
  }

  /**
   * Get total connection count
   */
  public getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Get user count
   */
  public getUserCount(): number {
    return this.userConnections.size;
  }

  /**
   * Check if user is connected
   */
  public isUserConnected(userId: string): boolean {
    return this.userConnections.has(userId);
  }

  /**
   * Get connection statistics
   */
  public getStats(): any {
    const now = Date.now();
    const connections = Array.from(this.connections.values());
    
    return {
      total: this.connections.size,
      authenticated: connections.filter(c => c.userId).length,
      anonymous: connections.filter(c => !c.userId).length,
      uniqueUsers: this.userConnections.size,
      uniqueFingerprints: this.fingerprintConnections.size,
      averageConnectionTime: connections.reduce((sum, c) => 
        sum + (now - c.connectedAt.getTime()), 0) / connections.length || 0,
      connectionsByUserAgent: this.getConnectionsByUserAgent(),
    };
  }

  /**
   * Get connections grouped by user agent
   */
  private getConnectionsByUserAgent(): Map<string, number> {
    const byUserAgent = new Map<string, number>();
    
    for (const conn of this.connections.values()) {
      const ua = conn.userAgent;
      byUserAgent.set(ua, (byUserAgent.get(ua) || 0) + 1);
    }
    
    return byUserAgent;
  }

  /**
   * Clean up stale connections
   */
  public cleanupStaleConnections(maxIdleTime: number = 300000): number {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [socketId, info] of this.connections.entries()) {
      if (now - info.lastActivity.getTime() > maxIdleTime) {
        this.removeConnection(socketId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} stale connections`);
    }
    
    return cleaned;
  }
}