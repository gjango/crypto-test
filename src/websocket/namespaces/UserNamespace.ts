import { Server, Socket, Namespace } from 'socket.io';
import { createLogger } from '../../utils/logger';
import { EVENTS, ROOMS } from '../config';
import { AuthMiddleware } from '../middleware/AuthMiddleware';
import { RateLimitMiddleware } from '../middleware/RateLimitMiddleware';

const logger = createLogger('UserNamespace');

export class UserNamespace {
  private namespace: Namespace;
  private userSockets: Map<string, Set<string>> = new Map();

  constructor(
    private io: Server,
    private namespacePath: string
  ) {
    this.namespace = this.io.of(namespacePath);
  }

  /**
   * Initialize namespace
   */
  public async initialize(): Promise<void> {
    // Apply authentication middleware
    this.namespace.use(AuthMiddleware.create(true));

    // Apply rate limiting
    this.namespace.use(RateLimitMiddleware.createForNamespace('user', {
      points: 100,
      duration: 1,
      blockDuration: 60,
    }));

    // Connection handler
    this.namespace.on('connection', (socket: Socket) => {
      logger.info(`User namespace connection: ${socket.id} (User: ${socket.data.userId})`);
      
      this.handleConnection(socket);
    });

    logger.info('User namespace initialized');
  }

  /**
   * Handle new connection
   */
  private handleConnection(socket: Socket): void {
    const userId = socket.data.userId;

    // Join user-specific rooms
    this.joinUserRooms(socket, userId);

    // Track user socket
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(socket.id);

    // Send connection confirmation
    socket.emit(EVENTS.CONNECTION_AUTHENTICATED, {
      socketId: socket.id,
      userId,
      namespace: this.namespacePath,
      timestamp: new Date(),
    });

    // Handle subscription to specific data streams
    socket.on(EVENTS.SUBSCRIBE, async (data: any, callback?: Function) => {
      try {
        await this.handleSubscribe(socket, data);
        if (callback) callback({ success: true });
      } catch (error: any) {
        logger.error('Subscription error:', error);
        if (callback) callback({ success: false, error: error.message });
      }
    });

    // Handle unsubscription
    socket.on(EVENTS.UNSUBSCRIBE, async (data: any, callback?: Function) => {
      try {
        await this.handleUnsubscribe(socket, data);
        if (callback) callback({ success: true });
      } catch (error: any) {
        logger.error('Unsubscription error:', error);
        if (callback) callback({ success: false, error: error.message });
      }
    });

    // Handle ping
    socket.on(EVENTS.PING, () => {
      socket.emit(EVENTS.PONG, { timestamp: Date.now() });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      this.handleDisconnect(socket);
    });
  }

  /**
   * Join user-specific rooms
   */
  private async joinUserRooms(socket: Socket, userId: string): Promise<void> {
    const rooms = [
      ROOMS.userRoom(userId),
      ROOMS.ordersRoom(userId),
      ROOMS.positionsRoom(userId),
      ROOMS.walletRoom(userId),
    ];

    for (const room of rooms) {
      await socket.join(room);
    }

    logger.debug(`Socket ${socket.id} joined user rooms for ${userId}`);
  }

  /**
   * Handle subscription request
   */
  private async handleSubscribe(socket: Socket, data: any): Promise<void> {
    const { streams } = data;
    const userId = socket.data.userId;

    if (!streams || !Array.isArray(streams)) {
      throw new Error('Invalid subscription request');
    }

    for (const stream of streams) {
      switch (stream) {
        case 'orders':
          await socket.join(ROOMS.ordersRoom(userId));
          break;
        case 'positions':
          await socket.join(ROOMS.positionsRoom(userId));
          break;
        case 'wallet':
          await socket.join(ROOMS.walletRoom(userId));
          break;
        default:
          logger.warn(`Unknown stream: ${stream}`);
      }
    }

    socket.emit(EVENTS.SUBSCRIPTION_CONFIRMED, {
      streams,
      timestamp: new Date(),
    });
  }

  /**
   * Handle unsubscription request
   */
  private async handleUnsubscribe(socket: Socket, data: any): Promise<void> {
    const { streams } = data;
    const userId = socket.data.userId;

    if (!streams || !Array.isArray(streams)) {
      throw new Error('Invalid unsubscription request');
    }

    for (const stream of streams) {
      switch (stream) {
        case 'orders':
          await socket.leave(ROOMS.ordersRoom(userId));
          break;
        case 'positions':
          await socket.leave(ROOMS.positionsRoom(userId));
          break;
        case 'wallet':
          await socket.leave(ROOMS.walletRoom(userId));
          break;
      }
    }
  }

  /**
   * Handle disconnect
   */
  private handleDisconnect(socket: Socket): void {
    const userId = socket.data.userId;

    // Remove from user sockets
    const userSocketSet = this.userSockets.get(userId);
    if (userSocketSet) {
      userSocketSet.delete(socket.id);
      if (userSocketSet.size === 0) {
        this.userSockets.delete(userId);
      }
    }

    logger.info(`User namespace disconnection: ${socket.id} (User: ${userId})`);
  }

  /**
   * Broadcast order update to user
   */
  public broadcastOrderUpdate(userId: string, order: any): void {
    const room = ROOMS.ordersRoom(userId);
    this.namespace.to(room).emit(EVENTS.ORDER_UPDATE, order);
  }

  /**
   * Broadcast new order to user
   */
  public broadcastNewOrder(userId: string, order: any): void {
    const room = ROOMS.ordersRoom(userId);
    this.namespace.to(room).emit(EVENTS.ORDER_NEW, order);
  }

  /**
   * Broadcast order fill to user
   */
  public broadcastOrderFill(userId: string, fill: any): void {
    const room = ROOMS.ordersRoom(userId);
    this.namespace.to(room).emit(EVENTS.ORDER_FILLED, fill);
  }

  /**
   * Broadcast order cancellation to user
   */
  public broadcastOrderCancellation(userId: string, order: any): void {
    const room = ROOMS.ordersRoom(userId);
    this.namespace.to(room).emit(EVENTS.ORDER_CANCELLED, order);
  }

  /**
   * Broadcast position update to user
   */
  public broadcastPositionUpdate(userId: string, position: any): void {
    const room = ROOMS.positionsRoom(userId);
    this.namespace.to(room).emit(EVENTS.POSITION_UPDATE, position);
  }

  /**
   * Broadcast position liquidation to user
   */
  public broadcastPositionLiquidation(userId: string, liquidation: any): void {
    const room = ROOMS.positionsRoom(userId);
    this.namespace.to(room).emit(EVENTS.POSITION_LIQUIDATED, liquidation);
  }

  /**
   * Broadcast wallet update to user
   */
  public broadcastWalletUpdate(userId: string, wallet: any): void {
    const room = ROOMS.walletRoom(userId);
    this.namespace.to(room).emit(EVENTS.WALLET_UPDATE, wallet);
  }

  /**
   * Broadcast margin call to user
   */
  public broadcastMarginCall(userId: string, marginCall: any): void {
    const room = ROOMS.userRoom(userId);
    this.namespace.to(room).emit(EVENTS.MARGIN_CALL, marginCall);
  }

  /**
   * Send direct message to user
   */
  public sendToUser(userId: string, event: string, data: any): void {
    const room = ROOMS.userRoom(userId);
    this.namespace.to(room).emit(event, data);
  }

  /**
   * Check if user is connected
   */
  public isUserConnected(userId: string): boolean {
    return this.userSockets.has(userId);
  }

  /**
   * Get user socket count
   */
  public getUserSocketCount(userId: string): number {
    const sockets = this.userSockets.get(userId);
    return sockets ? sockets.size : 0;
  }

  /**
   * Get namespace
   */
  public getNamespace(): Namespace {
    return this.namespace;
  }

  /**
   * Get statistics
   */
  public getStats(): any {
    return {
      connections: this.namespace.sockets.size,
      uniqueUsers: this.userSockets.size,
      userConnections: Array.from(this.userSockets.entries()).map(([userId, sockets]) => ({
        userId,
        connections: sockets.size,
      })),
    };
  }
}