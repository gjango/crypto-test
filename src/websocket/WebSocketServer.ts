import { Server as HttpServer } from 'http';
import { Server, Socket, Namespace } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { createLogger } from '../utils/logger';
import { 
  WEBSOCKET_CONFIG, 
  REDIS_CONFIG, 
  NAMESPACES,
  EVENTS,
  ROOMS,
  SUBSCRIPTION_LIMITS,
  RATE_LIMIT_CONFIG
} from './config';
import { ConnectionManager } from './ConnectionManager';
import { SubscriptionManager } from './SubscriptionManager';
import { AuthMiddleware } from './middleware/AuthMiddleware';
import { RateLimitMiddleware } from './middleware/RateLimitMiddleware';
import { PriceNamespace } from './namespaces/PriceNamespace';
import { UserNamespace } from './namespaces/UserNamespace';
import { AdminNamespace } from './namespaces/AdminNamespace';
import { MarketNamespace } from './namespaces/MarketNamespace';
import { WebSocketMetrics } from './metrics/WebSocketMetrics';

const logger = createLogger('WebSocketServer');

export class WebSocketServer {
  private static instance: WebSocketServer;
  private io: Server;
  private pubClient: Redis;
  private subClient: Redis;
  private connectionManager: ConnectionManager;
  private subscriptionManager: SubscriptionManager;
  private metrics: WebSocketMetrics;
  private namespaces: Map<string, Namespace> = new Map();
  private isRunning: boolean = false;

  private constructor() {
    this.connectionManager = new ConnectionManager();
    this.subscriptionManager = new SubscriptionManager();
    this.metrics = new WebSocketMetrics();
  }

  public static getInstance(): WebSocketServer {
    if (!WebSocketServer.instance) {
      WebSocketServer.instance = new WebSocketServer();
    }
    return WebSocketServer.instance;
  }

  /**
   * Initialize WebSocket server
   */
  public async initialize(httpServer: HttpServer): Promise<void> {
    try {
      logger.info('Initializing WebSocket server...');

      // Create Socket.IO server
      this.io = new Server(httpServer, WEBSOCKET_CONFIG);

      // Setup Redis adapter for horizontal scaling
      await this.setupRedisAdapter();

      // Setup global middleware
      this.setupGlobalMiddleware();

      // Initialize namespaces
      await this.initializeNamespaces();

      // Setup connection handlers
      this.setupConnectionHandlers();

      // Start metrics collection
      this.metrics.startCollection(this.io);

      this.isRunning = true;
      logger.info('WebSocket server initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize WebSocket server:', error);
      throw error;
    }
  }

  /**
   * Setup Redis adapter for horizontal scaling
   */
  private async setupRedisAdapter(): Promise<void> {
    try {
      this.pubClient = new Redis({
        ...REDIS_CONFIG,
        retryStrategy: (times) => {
          if (times > 3) {
            logger.warn('Redis connection failed after 3 attempts, running without Redis adapter');
            return null; // Stop retrying
          }
          return Math.min(times * 200, 1000);
        },
        enableOfflineQueue: false,
      });
      
      this.subClient = this.pubClient.duplicate();

      this.pubClient.on('error', (err) => {
        // Only log once to avoid spam
        if (!this.pubClient.status || this.pubClient.status === 'connecting') {
          logger.warn('Redis not available for WebSocket adapter:', err.message);
        }
      });

      this.subClient.on('error', (err) => {
        // Silent error handler to prevent unhandled errors
      });

      // Wait for Redis connections with timeout
      await Promise.race([
        Promise.all([
          new Promise((resolve) => this.pubClient.once('connect', resolve)),
          new Promise((resolve) => this.subClient.once('connect', resolve)),
        ]),
        new Promise((resolve) => setTimeout(resolve, 2000)), // 2 second timeout
      ]);

      if (this.pubClient.status === 'ready' && this.subClient.status === 'ready') {
        // Create and set adapter
        const adapter = createAdapter(this.pubClient, this.subClient);
        this.io.adapter(adapter);
        logger.info('Redis adapter configured for WebSocket scaling');
      } else {
        logger.warn('Running WebSocket server without Redis adapter (single instance mode)');
        // Close Redis connections if they're not ready
        this.pubClient.disconnect();
        this.subClient.disconnect();
      }
    } catch (error) {
      logger.warn('Failed to setup Redis adapter, running in single instance mode:', error);
    }
  }

  /**
   * Setup global middleware
   */
  private setupGlobalMiddleware(): void {
    // Apply rate limiting to all namespaces
    this.io.use(RateLimitMiddleware.create(RATE_LIMIT_CONFIG));

    // Connection fingerprinting
    this.io.use((socket: Socket, next) => {
      const fingerprint = this.generateFingerprint(socket);
      socket.data.fingerprint = fingerprint;
      socket.data.connectedAt = Date.now();
      next();
    });

    logger.info('Global middleware configured');
  }

  /**
   * Initialize all namespaces
   */
  private async initializeNamespaces(): Promise<void> {
    // Public price feed namespace
    const priceNamespace = new PriceNamespace(this.io, NAMESPACES.PRICES);
    await priceNamespace.initialize();
    this.namespaces.set(NAMESPACES.PRICES, priceNamespace.getNamespace());

    // Authenticated user namespace
    const userNamespace = new UserNamespace(this.io, NAMESPACES.USER);
    await userNamespace.initialize();
    this.namespaces.set(NAMESPACES.USER, userNamespace.getNamespace());

    // Admin monitoring namespace
    const adminNamespace = new AdminNamespace(this.io, NAMESPACES.ADMIN);
    await adminNamespace.initialize();
    this.namespaces.set(NAMESPACES.ADMIN, adminNamespace.getNamespace());

    // Public market data namespace
    const marketNamespace = new MarketNamespace(this.io, NAMESPACES.MARKET);
    await marketNamespace.initialize();
    this.namespaces.set(NAMESPACES.MARKET, marketNamespace.getNamespace());

    logger.info('All namespaces initialized');
  }

  /**
   * Setup connection handlers
   */
  private setupConnectionHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      logger.info(`New connection: ${socket.id} from ${socket.handshake.address}`);
      
      // Track connection
      this.connectionManager.addConnection(socket);
      this.metrics.recordConnection(socket);

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        logger.info(`Connection disconnected: ${socket.id}, reason: ${reason}`);
        this.connectionManager.removeConnection(socket.id);
        this.subscriptionManager.removeAllSubscriptions(socket.id);
        this.metrics.recordDisconnection(socket, reason);
      });

      // Handle errors
      socket.on('error', (error) => {
        logger.error(`Socket error for ${socket.id}:`, error);
        this.metrics.recordError(socket, error);
      });
    });
  }

  /**
   * Generate client fingerprint
   */
  private generateFingerprint(socket: Socket): string {
    const { headers, address, auth } = socket.handshake;
    const userAgent = headers['user-agent'] || '';
    const origin = headers.origin || '';
    const fingerprint = `${address}-${userAgent}-${origin}`;
    return Buffer.from(fingerprint).toString('base64');
  }

  /**
   * Broadcast price update to all subscribers
   */
  public broadcastPriceUpdate(symbol: string, data: any): void {
    const room = ROOMS.priceRoom(symbol);
    this.io.of(NAMESPACES.PRICES).to(room).emit(EVENTS.PRICE_UPDATE, data);
    this.metrics.recordBroadcast(EVENTS.PRICE_UPDATE, room);
  }

  /**
   * Broadcast to specific user
   */
  public broadcastToUser(userId: string, event: string, data: any): void {
    const room = ROOMS.userRoom(userId);
    this.io.of(NAMESPACES.USER).to(room).emit(event, data);
    this.metrics.recordBroadcast(event, room);
  }

  /**
   * Broadcast order update
   */
  public broadcastOrderUpdate(userId: string, order: any): void {
    const room = ROOMS.ordersRoom(userId);
    this.io.of(NAMESPACES.USER).to(room).emit(EVENTS.ORDER_UPDATE, order);
    this.metrics.recordBroadcast(EVENTS.ORDER_UPDATE, room);
  }

  /**
   * Broadcast position update
   */
  public broadcastPositionUpdate(userId: string, position: any): void {
    const room = ROOMS.positionsRoom(userId);
    this.io.of(NAMESPACES.USER).to(room).emit(EVENTS.POSITION_UPDATE, position);
    this.metrics.recordBroadcast(EVENTS.POSITION_UPDATE, room);
  }

  /**
   * Broadcast market stats
   */
  public broadcastMarketStats(symbol: string, stats: any): void {
    const room = ROOMS.marketStatsRoom(symbol);
    this.io.of(NAMESPACES.MARKET).to(room).emit(EVENTS.MARKET_STATS, stats);
    this.metrics.recordBroadcast(EVENTS.MARKET_STATS, room);
  }

  /**
   * Broadcast system message
   */
  public broadcastSystemMessage(message: any, namespace?: string): void {
    const target = namespace ? this.io.of(namespace) : this.io;
    target.emit(EVENTS.SYSTEM_MESSAGE, message);
    this.metrics.recordBroadcast(EVENTS.SYSTEM_MESSAGE, 'global');
  }

  /**
   * Get connection statistics
   */
  public getStats(): any {
    return {
      connections: this.connectionManager.getConnectionCount(),
      namespaces: {
        prices: this.io.of(NAMESPACES.PRICES).sockets.size,
        user: this.io.of(NAMESPACES.USER).sockets.size,
        admin: this.io.of(NAMESPACES.ADMIN).sockets.size,
        market: this.io.of(NAMESPACES.MARKET).sockets.size,
      },
      subscriptions: this.subscriptionManager.getStats(),
      metrics: this.metrics.getMetrics(),
    };
  }

  /**
   * Graceful shutdown
   */
  public async shutdown(): Promise<void> {
    logger.info('Shutting down WebSocket server...');
    
    this.isRunning = false;

    // Notify all clients
    this.broadcastSystemMessage({
      type: 'shutdown',
      message: 'Server is shutting down',
      timestamp: new Date(),
    });

    // Close all connections
    this.io.disconnectSockets(true);

    // Close Redis connections
    await Promise.all([
      this.pubClient?.quit(),
      this.subClient?.quit(),
    ]);

    // Close Socket.IO server
    await new Promise<void>((resolve) => {
      this.io.close(() => {
        logger.info('WebSocket server shut down successfully');
        resolve();
      });
    });
  }

  /**
   * Get Socket.IO instance
   */
  public getIO(): Server {
    return this.io;
  }

  /**
   * Check if server is running
   */
  public isServerRunning(): boolean {
    return this.isRunning;
  }
}

export default WebSocketServer;