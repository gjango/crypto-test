import { Server, Socket, Namespace } from 'socket.io';
import { createLogger } from '../../utils/logger';
import { EVENTS, ROOMS, SUBSCRIPTION_LIMITS } from '../config';
import { RateLimitMiddleware } from '../middleware/RateLimitMiddleware';

const logger = createLogger('PriceNamespace');

export class PriceNamespace {
  private namespace: Namespace;
  private symbolSubscriptions: Map<string, Set<string>> = new Map();

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
    // Apply rate limiting
    this.namespace.use(RateLimitMiddleware.createForNamespace('prices', {
      points: 50,
      duration: 1,
      blockDuration: 60,
    }));

    // Connection handler
    this.namespace.on('connection', (socket: Socket) => {
      logger.info(`Price namespace connection: ${socket.id}`);
      
      this.handleConnection(socket);
    });

    logger.info('Price namespace initialized');
  }

  /**
   * Handle new connection
   */
  private handleConnection(socket: Socket): void {
    // Send connection confirmation
    socket.emit(EVENTS.CONNECTION_AUTHENTICATED, {
      socketId: socket.id,
      namespace: this.namespacePath,
      timestamp: new Date(),
    });

    // Handle subscription
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
   * Handle subscription request
   */
  private async handleSubscribe(socket: Socket, data: any): Promise<void> {
    const { symbols, channels } = data;

    // Handle symbol subscriptions
    if (symbols && Array.isArray(symbols)) {
      const currentSymbols = this.getSocketSymbols(socket.id);
      
      // Check subscription limit
      if (currentSymbols.size + symbols.length > SUBSCRIPTION_LIMITS.maxSymbolsPerConnection) {
        throw new Error('Symbol subscription limit exceeded');
      }

      for (const symbol of symbols) {
        await this.subscribeToSymbol(socket, symbol);
      }
    }

    // Handle channel subscriptions
    if (channels && Array.isArray(channels)) {
      for (const channel of channels) {
        await this.subscribeToChannel(socket, channel);
      }
    }
  }

  /**
   * Subscribe to symbol
   */
  private async subscribeToSymbol(socket: Socket, symbol: string): Promise<void> {
    const room = ROOMS.priceRoom(symbol);
    
    // Join room
    await socket.join(room);
    
    // Track subscription
    if (!this.symbolSubscriptions.has(symbol)) {
      this.symbolSubscriptions.set(symbol, new Set());
    }
    this.symbolSubscriptions.get(symbol)!.add(socket.id);

    // Send confirmation
    socket.emit(EVENTS.SUBSCRIPTION_CONFIRMED, {
      type: 'symbol',
      symbol,
      room,
      timestamp: new Date(),
    });

    logger.debug(`Socket ${socket.id} subscribed to symbol ${symbol}`);
  }

  /**
   * Subscribe to channel
   */
  private async subscribeToChannel(socket: Socket, channel: string): Promise<void> {
    const { type, symbol, interval } = channel;

    if (type === 'candle' && symbol && interval) {
      const room = ROOMS.candleRoom(symbol, interval);
      await socket.join(room);

      socket.emit(EVENTS.SUBSCRIPTION_CONFIRMED, {
        type: 'candle',
        symbol,
        interval,
        room,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Handle unsubscription request
   */
  private async handleUnsubscribe(socket: Socket, data: any): Promise<void> {
    const { symbols, channels } = data;

    // Handle symbol unsubscriptions
    if (symbols && Array.isArray(symbols)) {
      for (const symbol of symbols) {
        await this.unsubscribeFromSymbol(socket, symbol);
      }
    }

    // Handle channel unsubscriptions
    if (channels && Array.isArray(channels)) {
      for (const channel of channels) {
        await this.unsubscribeFromChannel(socket, channel);
      }
    }
  }

  /**
   * Unsubscribe from symbol
   */
  private async unsubscribeFromSymbol(socket: Socket, symbol: string): Promise<void> {
    const room = ROOMS.priceRoom(symbol);
    
    // Leave room
    await socket.leave(room);
    
    // Remove from tracking
    const subscribers = this.symbolSubscriptions.get(symbol);
    if (subscribers) {
      subscribers.delete(socket.id);
      if (subscribers.size === 0) {
        this.symbolSubscriptions.delete(symbol);
      }
    }

    logger.debug(`Socket ${socket.id} unsubscribed from symbol ${symbol}`);
  }

  /**
   * Unsubscribe from channel
   */
  private async unsubscribeFromChannel(socket: Socket, channel: any): Promise<void> {
    const { type, symbol, interval } = channel;

    if (type === 'candle' && symbol && interval) {
      const room = ROOMS.candleRoom(symbol, interval);
      await socket.leave(room);
    }
  }

  /**
   * Handle disconnect
   */
  private handleDisconnect(socket: Socket): void {
    // Clean up symbol subscriptions
    for (const [symbol, subscribers] of this.symbolSubscriptions.entries()) {
      subscribers.delete(socket.id);
      if (subscribers.size === 0) {
        this.symbolSubscriptions.delete(symbol);
      }
    }

    logger.info(`Price namespace disconnection: ${socket.id}`);
  }

  /**
   * Get symbols subscribed by socket
   */
  private getSocketSymbols(socketId: string): Set<string> {
    const symbols = new Set<string>();
    
    for (const [symbol, subscribers] of this.symbolSubscriptions.entries()) {
      if (subscribers.has(socketId)) {
        symbols.add(symbol);
      }
    }
    
    return symbols;
  }

  /**
   * Broadcast price update
   */
  public broadcastPriceUpdate(symbol: string, data: any): void {
    const room = ROOMS.priceRoom(symbol);
    this.namespace.to(room).emit(EVENTS.PRICE_UPDATE, {
      symbol,
      ...data,
      timestamp: new Date(),
    });
  }

  /**
   * Broadcast trade
   */
  public broadcastTrade(symbol: string, trade: any): void {
    const room = ROOMS.priceRoom(symbol);
    this.namespace.to(room).emit(EVENTS.PRICE_TRADE, {
      symbol,
      ...trade,
      timestamp: new Date(),
    });
  }

  /**
   * Broadcast candle update
   */
  public broadcastCandleUpdate(symbol: string, interval: string, candle: any): void {
    const room = ROOMS.candleRoom(symbol, interval);
    this.namespace.to(room).emit(EVENTS.CANDLE_UPDATE, {
      symbol,
      interval,
      candle,
      timestamp: new Date(),
    });
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
      subscribedSymbols: this.symbolSubscriptions.size,
      subscriptions: Array.from(this.symbolSubscriptions.entries()).map(([symbol, subs]) => ({
        symbol,
        subscribers: subs.size,
      })),
    };
  }
}