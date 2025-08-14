import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { createLogger } from '../../utils/logger';
import { IPriceTick, FeedSource, FeedStatus, IFeedHealth } from '../../types/priceFeed';
import { config } from '../../config/environment';
import symbolDiscoveryService from '../symbolDiscovery.service';
import crypto from 'crypto';

const logger = createLogger('CoinbaseFeed');

interface ICoinbaseMessage {
  type: string;
  product_id?: string;
  time?: string;
  price?: string;
  best_bid?: string;
  best_ask?: string;
  best_bid_size?: string;
  best_ask_size?: string;
  volume_24h?: string;
  channels?: any[];
  subscriptions?: any;
}

export class CoinbaseFeedService extends EventEmitter {
  private static instance: CoinbaseFeedService;
  private ws: WebSocket | null = null;
  private status: FeedStatus = FeedStatus.DISCONNECTED;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectInterval: number = 5000;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastHeartbeat: Date = new Date();
  private lastDataReceived: Date = new Date();
  private messageCount: number = 0;
  private errorCount: number = 0;
  private subscribedProducts: Set<string> = new Set();
  private messageBuffer: IPriceTick[] = [];
  private maxBufferSize: number = 10000;
  private productMapping: Map<string, string> = new Map(); // Coinbase product -> symbol
  
  private constructor() {
    super();
    this.setMaxListeners(100);
  }
  
  public static getInstance(): CoinbaseFeedService {
    if (!CoinbaseFeedService.instance) {
      CoinbaseFeedService.instance = new CoinbaseFeedService();
    }
    return CoinbaseFeedService.instance;
  }
  
  /**
   * Connect to Coinbase WebSocket
   */
  async connect(): Promise<void> {
    if (this.status === FeedStatus.CONNECTED || this.status === FeedStatus.CONNECTING) {
      logger.warn('Already connected or connecting to Coinbase');
      return;
    }
    
    this.status = FeedStatus.CONNECTING;
    
    try {
      // Get symbols that are available on Coinbase
      const symbols = symbolDiscoveryService.getSymbolsForSource(FeedSource.COINBASE);
      if (symbols.length === 0) {
        logger.warn('No symbols available for Coinbase feed');
        return;
      }
      
      // Convert symbols to Coinbase product IDs
      const productIds = this.buildProductIds(symbols.slice(0, 100)); // Limit to 100 symbols
      
      logger.info(`Connecting to Coinbase WebSocket`);
      
      this.ws = new WebSocket(config.exchanges.coinbase.wsUrl);
      
      this.ws.on('open', () => this.handleOpen(productIds));
      this.ws.on('message', (data) => this.handleMessage(data));
      this.ws.on('error', (error) => this.handleError(error));
      this.ws.on('close', (code, reason) => this.handleClose(code, reason));
      this.ws.on('ping', () => this.handlePing());
      this.ws.on('pong', () => this.handlePong());
      
    } catch (error) {
      logger.error('Failed to connect to Coinbase', error);
      this.status = FeedStatus.ERROR;
      this.scheduleReconnect();
    }
  }
  
  /**
   * Build product IDs for Coinbase
   */
  private buildProductIds(symbols: string[]): string[] {
    const productIds: string[] = [];
    
    symbols.forEach(symbol => {
      // Convert BTCUSDT to BTC-USD format
      const productId = symbolDiscoveryService.getSymbolMapping(symbol, FeedSource.COINBASE);
      if (productId) {
        productIds.push(productId);
        // Store reverse mapping
        this.productMapping.set(productId, symbol);
      }
    });
    
    return productIds;
  }
  
  /**
   * Handle WebSocket open
   */
  private handleOpen(productIds: string[]): void {
    logger.info('Connected to Coinbase WebSocket');
    
    // Subscribe to ticker channel
    const subscribeMessage = {
      type: 'subscribe',
      product_ids: productIds,
      channels: [
        'ticker',
        'heartbeat'
      ]
    };
    
    // Add authentication if configured
    if (config.exchanges.coinbase.apiKey && config.exchanges.coinbase.apiSecret) {
      const timestamp = Date.now() / 1000;
      const message = timestamp + 'GET' + '/users/self/verify';
      const signature = crypto
        .createHmac('sha256', Buffer.from(config.exchanges.coinbase.apiSecret, 'base64'))
        .update(message)
        .digest('base64');
      
      Object.assign(subscribeMessage, {
        signature,
        key: config.exchanges.coinbase.apiKey,
        passphrase: config.exchanges.coinbase.passphrase || '',
        timestamp
      });
    }
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(subscribeMessage));
    }
    
    this.status = FeedStatus.CONNECTED;
    this.reconnectAttempts = 0;
    this.errorCount = 0;
    this.startHeartbeat();
    this.emit('connected', { source: FeedSource.COINBASE });
  }
  
  /**
   * Handle incoming message
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const message: ICoinbaseMessage = JSON.parse(data.toString());
      this.messageCount++;
      this.lastDataReceived = new Date();
      
      // Handle different message types
      switch (message.type) {
        case 'ticker':
          this.processTicker(message);
          break;
        case 'heartbeat':
          this.lastHeartbeat = new Date();
          break;
        case 'subscriptions':
          logger.info('Coinbase subscriptions confirmed', message.channels);
          break;
        case 'error':
          logger.error('Coinbase error message', message);
          this.errorCount++;
          break;
      }
      
    } catch (error) {
      logger.error('Error processing Coinbase message', error);
      this.errorCount++;
    }
  }
  
  /**
   * Process ticker data
   */
  private processTicker(data: ICoinbaseMessage): void {
    try {
      if (!data.product_id || !data.price) return;
      
      // Get original symbol from product ID
      const symbol = this.productMapping.get(data.product_id);
      if (!symbol) return;
      
      const tick: IPriceTick = {
        symbol,
        price: parseFloat(data.price),
        bid: parseFloat(data.best_bid || data.price),
        ask: parseFloat(data.best_ask || data.price),
        bidSize: parseFloat(data.best_bid_size || '0'),
        askSize: parseFloat(data.best_ask_size || '0'),
        volume24h: parseFloat(data.volume_24h || '0'),
        quoteVolume24h: 0, // Coinbase doesn't provide quote volume directly
        timestamp: data.time ? new Date(data.time) : new Date(),
        source: FeedSource.COINBASE,
      };
      
      // Calculate quote volume if we have volume and price
      if (tick.volume24h && tick.price) {
        tick.quoteVolume24h = tick.volume24h * tick.price;
      }
      
      // Validate tick data
      if (this.validateTick(tick)) {
        this.bufferTick(tick);
        this.emit('tick', tick);
      }
      
    } catch (error) {
      logger.error('Error processing ticker', error);
    }
  }
  
  /**
   * Validate tick data
   */
  private validateTick(tick: IPriceTick): boolean {
    if (!tick.symbol || !tick.price || tick.price <= 0) {
      return false;
    }
    
    if (tick.bid <= 0 || tick.ask <= 0 || tick.bid >= tick.ask) {
      return false;
    }
    
    // Check for outliers (price change > 50% from last known)
    const lastTick = this.getLastTick(tick.symbol);
    if (lastTick) {
      const priceChange = Math.abs((tick.price - lastTick.price) / lastTick.price);
      if (priceChange > 0.5) {
        logger.warn(`Outlier detected for ${tick.symbol}: ${priceChange * 100}% change`);
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Buffer tick for later retrieval
   */
  private bufferTick(tick: IPriceTick): void {
    this.messageBuffer.push(tick);
    
    // Maintain buffer size
    if (this.messageBuffer.length > this.maxBufferSize) {
      this.messageBuffer = this.messageBuffer.slice(-this.maxBufferSize);
    }
  }
  
  /**
   * Get last tick for symbol
   */
  private getLastTick(symbol: string): IPriceTick | undefined {
    for (let i = this.messageBuffer.length - 1; i >= 0; i--) {
      if (this.messageBuffer[i]?.symbol === symbol) {
        return this.messageBuffer[i];
      }
    }
    return undefined;
  }
  
  /**
   * Handle WebSocket error
   */
  private handleError(error: Error): void {
    logger.error('Coinbase WebSocket error', error);
    this.status = FeedStatus.ERROR;
    this.errorCount++;
    this.emit('error', { source: FeedSource.COINBASE, error });
  }
  
  /**
   * Handle WebSocket close
   */
  private handleClose(code: number, reason: Buffer): void {
    logger.warn(`Coinbase WebSocket closed. Code: ${code}, Reason: ${reason.toString()}`);
    this.status = FeedStatus.DISCONNECTED;
    this.stopHeartbeat();
    this.emit('disconnected', { source: FeedSource.COINBASE, code, reason: reason.toString() });
    this.scheduleReconnect();
  }
  
  /**
   * Handle ping
   */
  private handlePing(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.pong();
    }
  }
  
  /**
   * Handle pong
   */
  private handlePong(): void {
    this.lastHeartbeat = new Date();
  }
  
  /**
   * Start heartbeat monitoring
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Coinbase sends heartbeat messages automatically
        
        // Check if we're receiving data
        const timeSinceLastData = Date.now() - this.lastDataReceived.getTime();
        if (timeSinceLastData > 60000) { // 1 minute without data
          logger.warn('No data received for 1 minute, reconnecting...');
          this.reconnect();
        }
      }
    }, 30000); // 30 seconds
  }
  
  /**
   * Stop heartbeat monitoring
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
  
  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached for Coinbase feed');
      this.emit('max_reconnect', { source: FeedSource.COINBASE });
      return;
    }
    
    const delay = Math.min(
      this.reconnectInterval * Math.pow(2, this.reconnectAttempts),
      60000 // Max 1 minute
    );
    
    this.reconnectAttempts++;
    logger.info(`Scheduling Coinbase reconnection in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect();
    }, delay);
  }
  
  /**
   * Reconnect to WebSocket
   */
  reconnect(): void {
    this.disconnect();
    this.connect();
  }
  
  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    logger.info('Disconnecting from Coinbase WebSocket');
    
    this.stopHeartbeat();
    
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN) {
        // Unsubscribe before closing
        const unsubscribeMessage = {
          type: 'unsubscribe',
          channels: ['ticker', 'heartbeat']
        };
        this.ws.send(JSON.stringify(unsubscribeMessage));
        this.ws.close();
      }
      this.ws = null;
    }
    
    this.status = FeedStatus.DISCONNECTED;
  }
  
  /**
   * Subscribe to products
   */
  async subscribe(symbols: string[]): Promise<void> {
    const productIds = this.buildProductIds(symbols);
    productIds.forEach(id => this.subscribedProducts.add(id));
    
    if (this.status !== FeedStatus.CONNECTED) {
      await this.connect();
    } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Subscribe to additional products
      const subscribeMessage = {
        type: 'subscribe',
        product_ids: productIds,
        channels: ['ticker']
      };
      this.ws.send(JSON.stringify(subscribeMessage));
    }
  }
  
  /**
   * Unsubscribe from products
   */
  unsubscribe(symbols: string[]): void {
    const productIds = this.buildProductIds(symbols);
    productIds.forEach(id => this.subscribedProducts.delete(id));
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const unsubscribeMessage = {
        type: 'unsubscribe',
        product_ids: productIds,
        channels: ['ticker']
      };
      this.ws.send(JSON.stringify(unsubscribeMessage));
    }
  }
  
  /**
   * Get feed health
   */
  getHealth(): IFeedHealth {
    const now = Date.now();
    const uptime = this.status === FeedStatus.CONNECTED 
      ? now - this.lastHeartbeat.getTime() 
      : 0;
    
    return {
      source: FeedSource.COINBASE,
      status: this.status,
      connected: this.status === FeedStatus.CONNECTED,
      lastHeartbeat: this.lastHeartbeat,
      lastDataReceived: this.lastDataReceived,
      messagesPerSecond: this.messageCount / (uptime / 1000) || 0,
      averageLatency: 0, // TODO: Implement latency calculation
      errorCount: this.errorCount,
      reconnectCount: this.reconnectAttempts,
      uptime,
      dataQuality: this.calculateDataQuality(),
    };
  }
  
  /**
   * Calculate data quality score
   */
  private calculateDataQuality(): number {
    if (this.status !== FeedStatus.CONNECTED) return 0;
    
    const timeSinceLastData = Date.now() - this.lastDataReceived.getTime();
    const errorRate = this.errorCount / Math.max(this.messageCount, 1);
    
    let quality = 100;
    
    // Reduce quality based on data staleness
    if (timeSinceLastData > 5000) quality -= 20;
    if (timeSinceLastData > 10000) quality -= 30;
    if (timeSinceLastData > 30000) quality -= 50;
    
    // Reduce quality based on error rate
    quality -= errorRate * 100;
    
    return Math.max(0, Math.min(100, quality));
  }
  
  /**
   * Get recent ticks
   */
  getRecentTicks(symbol?: string, limit: number = 100): IPriceTick[] {
    if (symbol) {
      return this.messageBuffer
        .filter(tick => tick.symbol === symbol)
        .slice(-limit);
    }
    return this.messageBuffer.slice(-limit);
  }
  
  /**
   * Get status
   */
  getStatus(): FeedStatus {
    return this.status;
  }
}

export default CoinbaseFeedService.getInstance();