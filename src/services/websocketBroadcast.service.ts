import { Server, Socket } from 'socket.io';
import { createLogger } from '../utils/logger';
import feedManagerService from './feedManager.service';
import { 
  IPriceTick, 
  IPriceUpdate, 
  IWebSocketMessage,
  IPriceSubscription,
  FeedSource 
} from '../types/priceFeed';
import { authMiddleware } from '../middleware/auth';
import { User } from '../models/User.model';

const logger = createLogger('WebSocketBroadcast');

interface IClientData {
  userId?: string;
  clientId: string;
  subscription: IPriceSubscription;
  lastActivity: Date;
  messagesSent: number;
  connected: boolean;
}

export class WebSocketBroadcastService {
  private static instance: WebSocketBroadcastService;
  private io: Server | null = null;
  private clients: Map<string, IClientData> = new Map();
  private symbolSubscribers: Map<string, Set<string>> = new Map(); // symbol -> clientIds
  private broadcastInterval: NodeJS.Timeout | null = null;
  private priceBuffer: Map<string, IPriceUpdate> = new Map();
  private broadcastThrottle: number = 100; // milliseconds
  private maxClientsPerSymbol: number = 10000;
  private statsInterval: NodeJS.Timeout | null = null;
  
  // Statistics
  private totalMessagesSent: number = 0;
  private totalBytesTransmitted: number = 0;
  private connectionCount: number = 0;
  private peakConnections: number = 0;
  
  private constructor() {}
  
  public static getInstance(): WebSocketBroadcastService {
    if (!WebSocketBroadcastService.instance) {
      WebSocketBroadcastService.instance = new WebSocketBroadcastService();
    }
    return WebSocketBroadcastService.instance;
  }
  
  /**
   * Initialize WebSocket broadcasting
   */
  initialize(io: Server): void {
    logger.info('Initializing WebSocket broadcast service');
    this.io = io;
    
    // Setup authentication middleware
    this.setupAuthMiddleware();
    
    // Setup connection handlers
    this.setupConnectionHandlers();
    
    // Subscribe to feed manager events
    this.subscribeFeedEvents();
    
    // Start broadcast interval
    this.startBroadcasting();
    
    // Start statistics collection
    this.startStatisticsCollection();
    
    logger.info('WebSocket broadcast service initialized');
  }
  
  /**
   * Setup authentication middleware
   */
  private setupAuthMiddleware(): void {
    if (!this.io) return;
    
    this.io.use(async (socket: Socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) {
          // Allow anonymous connections with limited features
          socket.data.authenticated = false;
          return next();
        }
        
        // Verify JWT token
        const user = await this.verifyToken(token);
        if (user) {
          socket.data.user = user;
          socket.data.authenticated = true;
        }
        
        next();
      } catch (error) {
        logger.error('WebSocket authentication error', error);
        next(new Error('Authentication failed'));
      }
    });
  }
  
  /**
   * Verify JWT token
   */
  private async verifyToken(token: string): Promise<any> {
    // TODO: Implement JWT verification
    return null;
  }
  
  /**
   * Setup connection handlers
   */
  private setupConnectionHandlers(): void {
    if (!this.io) return;
    
    this.io.on('connection', (socket: Socket) => {
      this.handleConnection(socket);
      
      socket.on('subscribe', (data) => this.handleSubscribe(socket, data));
      socket.on('unsubscribe', (data) => this.handleUnsubscribe(socket, data));
      socket.on('ping', () => this.handlePing(socket));
      socket.on('disconnect', () => this.handleDisconnect(socket));
      socket.on('error', (error) => this.handleError(socket, error));
    });
  }
  
  /**
   * Handle new connection
   */
  private handleConnection(socket: Socket): void {
    const clientId = socket.id;
    const userId = socket.data.user?.id;
    
    logger.info(`Client connected: ${clientId} (User: ${userId || 'anonymous'})`);
    
    // Create client data
    const clientData: IClientData = {
      clientId,
      userId,
      subscription: {
        clientId,
        symbols: [],
        channels: ['ticker'],
        throttleMs: 100,
        lastSent: new Date(),
      },
      lastActivity: new Date(),
      messagesSent: 0,
      connected: true,
    };
    
    this.clients.set(clientId, clientData);
    this.connectionCount++;
    
    if (this.connectionCount > this.peakConnections) {
      this.peakConnections = this.connectionCount;
    }
    
    // Send welcome message with current prices
    this.sendWelcomeMessage(socket);
  }
  
  /**
   * Send welcome message
   */
  private sendWelcomeMessage(socket: Socket): void {
    const welcomeMessage: IWebSocketMessage = {
      type: 'heartbeat',
      data: {
        connected: true,
        serverTime: new Date(),
        authenticated: socket.data.authenticated,
        features: this.getClientFeatures(socket),
      },
      timestamp: new Date(),
    };
    
    socket.emit('welcome', welcomeMessage);
    
    // Send current prices for top symbols
    const topPrices = feedManagerService.getAllPrices().slice(0, 20);
    if (topPrices.length > 0) {
      const priceMessage: IWebSocketMessage = {
        type: 'price',
        data: topPrices,
        timestamp: new Date(),
      };
      socket.emit('price_snapshot', priceMessage);
    }
  }
  
  /**
   * Get client features based on authentication
   */
  private getClientFeatures(socket: Socket): string[] {
    const features = ['ticker', 'price_updates'];
    
    if (socket.data.authenticated) {
      features.push('trades', 'orders', 'positions', 'advanced_data');
    }
    
    return features;
  }
  
  /**
   * Handle subscribe request
   */
  private handleSubscribe(socket: Socket, data: any): void {
    const clientData = this.clients.get(socket.id);
    if (!clientData) return;
    
    const { symbols, channels } = data;
    
    if (!Array.isArray(symbols)) {
      socket.emit('error', { message: 'Invalid symbols format' });
      return;
    }
    
    // Limit subscriptions for non-authenticated users
    if (!socket.data.authenticated && symbols.length > 10) {
      socket.emit('error', { message: 'Subscription limit exceeded. Please authenticate.' });
      return;
    }
    
    // Update client subscription
    clientData.subscription.symbols = [...new Set([...clientData.subscription.symbols, ...symbols])];
    if (channels) {
      clientData.subscription.channels = channels;
    }
    
    // Update symbol subscribers
    symbols.forEach(symbol => {
      if (!this.symbolSubscribers.has(symbol)) {
        this.symbolSubscribers.set(symbol, new Set());
      }
      this.symbolSubscribers.get(symbol)?.add(socket.id);
    });
    
    // Send confirmation
    const confirmMessage: IWebSocketMessage = {
      type: 'subscribe',
      data: {
        subscribed: symbols,
        channels: clientData.subscription.channels,
      },
      timestamp: new Date(),
    };
    
    socket.emit('subscription_confirmed', confirmMessage);
    
    // Send current prices for subscribed symbols
    this.sendCurrentPrices(socket, symbols);
    
    logger.debug(`Client ${socket.id} subscribed to ${symbols.length} symbols`);
  }
  
  /**
   * Handle unsubscribe request
   */
  private handleUnsubscribe(socket: Socket, data: any): void {
    const clientData = this.clients.get(socket.id);
    if (!clientData) return;
    
    const { symbols } = data;
    
    if (!Array.isArray(symbols)) {
      socket.emit('error', { message: 'Invalid symbols format' });
      return;
    }
    
    // Update client subscription
    clientData.subscription.symbols = clientData.subscription.symbols.filter(
      s => !symbols.includes(s)
    );
    
    // Update symbol subscribers
    symbols.forEach(symbol => {
      this.symbolSubscribers.get(symbol)?.delete(socket.id);
    });
    
    // Send confirmation
    const confirmMessage: IWebSocketMessage = {
      type: 'unsubscribe',
      data: {
        unsubscribed: symbols,
      },
      timestamp: new Date(),
    };
    
    socket.emit('unsubscription_confirmed', confirmMessage);
    
    logger.debug(`Client ${socket.id} unsubscribed from ${symbols.length} symbols`);
  }
  
  /**
   * Handle ping
   */
  private handlePing(socket: Socket): void {
    const clientData = this.clients.get(socket.id);
    if (clientData) {
      clientData.lastActivity = new Date();
    }
    
    socket.emit('pong', { timestamp: new Date() });
  }
  
  /**
   * Handle disconnect
   */
  private handleDisconnect(socket: Socket): void {
    const clientId = socket.id;
    const clientData = this.clients.get(clientId);
    
    if (clientData) {
      // Remove from all symbol subscriptions
      clientData.subscription.symbols.forEach(symbol => {
        this.symbolSubscribers.get(symbol)?.delete(clientId);
      });
      
      // Remove client data
      this.clients.delete(clientId);
      this.connectionCount--;
      
      logger.info(`Client disconnected: ${clientId}`);
    }
  }
  
  /**
   * Handle error
   */
  private handleError(socket: Socket, error: Error): void {
    logger.error(`WebSocket error for client ${socket.id}`, error);
  }
  
  /**
   * Subscribe to feed events
   */
  private subscribeFeedEvents(): void {
    // Subscribe to price updates
    feedManagerService.on('price_update', (updates: IPriceUpdate[]) => {
      this.bufferPriceUpdates(updates);
    });
    
    // Subscribe to individual ticks for low-latency transmission
    feedManagerService.on('tick', (tick: IPriceTick) => {
      this.bufferTick(tick);
    });
    
    // Subscribe to feed status changes
    feedManagerService.on('feed_connected', (source: FeedSource) => {
      this.broadcastSystemMessage('feed_connected', { source });
    });
    
    feedManagerService.on('feed_disconnected', (source: FeedSource) => {
      this.broadcastSystemMessage('feed_disconnected', { source });
    });
    
    feedManagerService.on('failover', (data: any) => {
      this.broadcastSystemMessage('feed_failover', data);
    });
  }
  
  /**
   * Buffer price updates
   */
  private bufferPriceUpdates(updates: IPriceUpdate[]): void {
    updates.forEach(update => {
      this.priceBuffer.set(update.symbol, update);
    });
  }
  
  /**
   * Buffer individual tick
   */
  private bufferTick(tick: IPriceTick): void {
    const update: IPriceUpdate = {
      symbol: tick.symbol,
      price: tick.price,
      bid: tick.bid,
      ask: tick.ask,
      spread: tick.ask - tick.bid,
      spreadPercent: ((tick.ask - tick.bid) / tick.bid) * 100,
      markPrice: tick.price,
      volume24h: tick.volume24h || 0,
      high24h: 0,
      low24h: 0,
      change24h: 0,
      changePercent24h: 0,
      lastUpdate: tick.timestamp,
      source: tick.source,
    };
    
    this.priceBuffer.set(tick.symbol, update);
  }
  
  /**
   * Start broadcasting
   */
  private startBroadcasting(): void {
    this.broadcastInterval = setInterval(() => {
      this.broadcastPrices();
    }, this.broadcastThrottle);
  }
  
  /**
   * Broadcast prices to subscribers
   */
  private broadcastPrices(): void {
    if (this.priceBuffer.size === 0) return;
    
    // Get all updates
    const updates = Array.from(this.priceBuffer.values());
    this.priceBuffer.clear();
    
    // Group updates by symbol
    const updatesBySymbol = new Map<string, IPriceUpdate>();
    updates.forEach(update => {
      updatesBySymbol.set(update.symbol, update);
    });
    
    // Send to subscribers
    updatesBySymbol.forEach((update, symbol) => {
      const subscribers = this.symbolSubscribers.get(symbol);
      if (!subscribers || subscribers.size === 0) return;
      
      const message: IWebSocketMessage = {
        type: 'price',
        channel: 'ticker',
        symbols: [symbol],
        data: update,
        timestamp: new Date(),
      };
      
      const messageStr = JSON.stringify(message);
      const messageSize = Buffer.byteLength(messageStr);
      
      subscribers.forEach(clientId => {
        const clientData = this.clients.get(clientId);
        if (!clientData || !clientData.connected) return;
        
        // Check throttling
        const now = Date.now();
        const timeSinceLastSent = now - clientData.subscription.lastSent.getTime();
        if (timeSinceLastSent < clientData.subscription.throttleMs) return;
        
        // Send to client
        if (this.io) {
          this.io.to(clientId).emit('price_update', message);
          clientData.messagesSent++;
          clientData.subscription.lastSent = new Date();
          this.totalMessagesSent++;
          this.totalBytesTransmitted += messageSize;
        }
      });
    });
  }
  
  /**
   * Send current prices to client
   */
  private sendCurrentPrices(socket: Socket, symbols: string[]): void {
    const prices = symbols.map(symbol => feedManagerService.getCurrentPrice(symbol))
      .filter(price => price !== null);
    
    if (prices.length > 0) {
      const message: IWebSocketMessage = {
        type: 'price',
        data: prices,
        timestamp: new Date(),
      };
      
      socket.emit('price_snapshot', message);
    }
  }
  
  /**
   * Broadcast system message
   */
  private broadcastSystemMessage(event: string, data: any): void {
    if (!this.io) return;
    
    const message: IWebSocketMessage = {
      type: 'heartbeat',
      data: {
        event,
        ...data,
      },
      timestamp: new Date(),
    };
    
    this.io.emit('system', message);
  }
  
  /**
   * Start statistics collection
   */
  private startStatisticsCollection(): void {
    this.statsInterval = setInterval(() => {
      this.collectStatistics();
    }, 60000); // Every minute
  }
  
  /**
   * Collect statistics
   */
  private collectStatistics(): void {
    const stats = {
      connections: this.connectionCount,
      peakConnections: this.peakConnections,
      totalMessagesSent: this.totalMessagesSent,
      totalBytesTransmitted: this.totalBytesTransmitted,
      averageMessagesPerClient: this.connectionCount > 0 
        ? this.totalMessagesSent / this.connectionCount 
        : 0,
      symbolsTracked: this.symbolSubscribers.size,
      timestamp: new Date(),
    };
    
    logger.info('WebSocket statistics', stats);
  }
  
  /**
   * Get statistics
   */
  getStatistics(): any {
    const clientStats = Array.from(this.clients.values()).map(client => ({
      clientId: client.clientId,
      userId: client.userId,
      symbolCount: client.subscription.symbols.length,
      messagesSent: client.messagesSent,
      lastActivity: client.lastActivity,
    }));
    
    return {
      connections: this.connectionCount,
      peakConnections: this.peakConnections,
      totalMessagesSent: this.totalMessagesSent,
      totalBytesTransmitted: this.totalBytesTransmitted,
      symbolsTracked: this.symbolSubscribers.size,
      clients: clientStats,
    };
  }
  
  /**
   * Shutdown service
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down WebSocket broadcast service');
    
    // Stop broadcasting
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
    }
    
    // Stop statistics collection
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }
    
    // Disconnect all clients
    if (this.io) {
      this.io.emit('server_shutdown', { message: 'Server is shutting down' });
      this.io.disconnectSockets();
    }
    
    // Clear data
    this.clients.clear();
    this.symbolSubscribers.clear();
    this.priceBuffer.clear();
  }
}

export default WebSocketBroadcastService.getInstance();