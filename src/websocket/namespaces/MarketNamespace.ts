import { Server, Socket, Namespace } from 'socket.io';
import { createLogger } from '../../utils/logger';
import { EVENTS, ROOMS, SUBSCRIPTION_LIMITS } from '../config';
import { RateLimitMiddleware } from '../middleware/RateLimitMiddleware';

const logger = createLogger('MarketNamespace');

export class MarketNamespace {
  private namespace: Namespace;
  private marketSubscriptions: Map<string, Set<string>> = new Map();

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
    this.namespace.use(RateLimitMiddleware.createForNamespace('market', {
      points: 100,
      duration: 1,
      blockDuration: 60,
    }));

    // Connection handler
    this.namespace.on('connection', (socket: Socket) => {
      logger.info(`Market namespace connection: ${socket.id}`);
      
      this.handleConnection(socket);
    });

    logger.info('Market namespace initialized');
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
    const { markets, channels } = data;

    // Handle market subscriptions
    if (markets && Array.isArray(markets)) {
      const currentMarkets = this.getSocketMarkets(socket.id);
      
      // Check subscription limit
      if (currentMarkets.size + markets.length > SUBSCRIPTION_LIMITS.maxSymbolsPerConnection) {
        throw new Error('Market subscription limit exceeded');
      }

      for (const market of markets) {
        await this.subscribeToMarket(socket, market);
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
   * Subscribe to market
   */
  private async subscribeToMarket(socket: Socket, symbol: string): Promise<void> {
    // Join market stats room
    const statsRoom = ROOMS.marketStatsRoom(symbol);
    await socket.join(statsRoom);

    // Track subscription
    if (!this.marketSubscriptions.has(symbol)) {
      this.marketSubscriptions.set(symbol, new Set());
    }
    this.marketSubscriptions.get(symbol)!.add(socket.id);

    // Send confirmation
    socket.emit(EVENTS.SUBSCRIPTION_CONFIRMED, {
      type: 'market',
      symbol,
      rooms: [statsRoom],
      timestamp: new Date(),
    });

    logger.debug(`Socket ${socket.id} subscribed to market ${symbol}`);
  }

  /**
   * Subscribe to channel
   */
  private async subscribeToChannel(socket: Socket, channel: any): Promise<void> {
    const { type, symbol, depth } = channel;

    switch (type) {
      case 'depth':
        if (symbol) {
          const room = ROOMS.marketDepthRoom(symbol);
          await socket.join(room);
          
          socket.emit(EVENTS.SUBSCRIPTION_CONFIRMED, {
            type: 'depth',
            symbol,
            depth: depth || 20,
            room,
            timestamp: new Date(),
          });
        }
        break;

      case 'trades':
        if (symbol) {
          const room = ROOMS.marketTradesRoom(symbol);
          await socket.join(room);
          
          socket.emit(EVENTS.SUBSCRIPTION_CONFIRMED, {
            type: 'trades',
            symbol,
            room,
            timestamp: new Date(),
          });
        }
        break;

      case 'ticker':
        // Subscribe to all market tickers
        await socket.join('market:ticker:all');
        
        socket.emit(EVENTS.SUBSCRIPTION_CONFIRMED, {
          type: 'ticker',
          room: 'market:ticker:all',
          timestamp: new Date(),
        });
        break;

      default:
        logger.warn(`Unknown market channel type: ${type}`);
    }
  }

  /**
   * Handle unsubscription request
   */
  private async handleUnsubscribe(socket: Socket, data: any): Promise<void> {
    const { markets, channels } = data;

    // Handle market unsubscriptions
    if (markets && Array.isArray(markets)) {
      for (const market of markets) {
        await this.unsubscribeFromMarket(socket, market);
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
   * Unsubscribe from market
   */
  private async unsubscribeFromMarket(socket: Socket, symbol: string): Promise<void> {
    // Leave market rooms
    const rooms = [
      ROOMS.marketStatsRoom(symbol),
      ROOMS.marketDepthRoom(symbol),
      ROOMS.marketTradesRoom(symbol),
    ];

    for (const room of rooms) {
      await socket.leave(room);
    }

    // Remove from tracking
    const subscribers = this.marketSubscriptions.get(symbol);
    if (subscribers) {
      subscribers.delete(socket.id);
      if (subscribers.size === 0) {
        this.marketSubscriptions.delete(symbol);
      }
    }

    logger.debug(`Socket ${socket.id} unsubscribed from market ${symbol}`);
  }

  /**
   * Unsubscribe from channel
   */
  private async unsubscribeFromChannel(socket: Socket, channel: any): Promise<void> {
    const { type, symbol } = channel;

    switch (type) {
      case 'depth':
        if (symbol) {
          await socket.leave(ROOMS.marketDepthRoom(symbol));
        }
        break;

      case 'trades':
        if (symbol) {
          await socket.leave(ROOMS.marketTradesRoom(symbol));
        }
        break;

      case 'ticker':
        await socket.leave('market:ticker:all');
        break;
    }
  }

  /**
   * Handle disconnect
   */
  private handleDisconnect(socket: Socket): void {
    // Clean up market subscriptions
    for (const [symbol, subscribers] of this.marketSubscriptions.entries()) {
      subscribers.delete(socket.id);
      if (subscribers.size === 0) {
        this.marketSubscriptions.delete(symbol);
      }
    }

    logger.info(`Market namespace disconnection: ${socket.id}`);
  }

  /**
   * Get markets subscribed by socket
   */
  private getSocketMarkets(socketId: string): Set<string> {
    const markets = new Set<string>();
    
    for (const [symbol, subscribers] of this.marketSubscriptions.entries()) {
      if (subscribers.has(socketId)) {
        markets.add(symbol);
      }
    }
    
    return markets;
  }

  /**
   * Broadcast market stats
   */
  public broadcastMarketStats(symbol: string, stats: any): void {
    const room = ROOMS.marketStatsRoom(symbol);
    this.namespace.to(room).emit(EVENTS.MARKET_STATS, {
      symbol,
      stats,
      timestamp: new Date(),
    });
  }

  /**
   * Broadcast market depth
   */
  public broadcastMarketDepth(symbol: string, depth: any): void {
    const room = ROOMS.marketDepthRoom(symbol);
    this.namespace.to(room).emit(EVENTS.MARKET_DEPTH, {
      symbol,
      bids: depth.bids,
      asks: depth.asks,
      timestamp: new Date(),
    });
  }

  /**
   * Broadcast market trades
   */
  public broadcastMarketTrades(symbol: string, trades: any[]): void {
    const room = ROOMS.marketTradesRoom(symbol);
    this.namespace.to(room).emit(EVENTS.MARKET_TRADES, {
      symbol,
      trades,
      timestamp: new Date(),
    });
  }

  /**
   * Broadcast ticker update
   */
  public broadcastTickerUpdate(tickers: any[]): void {
    this.namespace.to('market:ticker:all').emit('market.ticker', {
      tickers,
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
      subscribedMarkets: this.marketSubscriptions.size,
      subscriptions: Array.from(this.marketSubscriptions.entries()).map(([symbol, subs]) => ({
        symbol,
        subscribers: subs.size,
      })),
    };
  }
}