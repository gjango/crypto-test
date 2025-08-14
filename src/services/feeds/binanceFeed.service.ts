import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { createLogger } from '../../utils/logger';
import { IPriceTick, FeedSource, FeedStatus, IFeedHealth } from '../../types/priceFeed';
import { config } from '../../config/environment';
import symbolDiscoveryService from '../symbolDiscovery.service';

const logger = createLogger('BinanceFeed');

export class BinanceFeedService extends EventEmitter {
  private static instance: BinanceFeedService;
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
  private subscribedSymbols: Set<string> = new Set();
  private messageBuffer: IPriceTick[] = [];
  private maxBufferSize: number = 10000;
  
  private constructor() {
    super();
    this.setMaxListeners(100);
  }
  
  public static getInstance(): BinanceFeedService {
    if (!BinanceFeedService.instance) {
      BinanceFeedService.instance = new BinanceFeedService();
    }
    return BinanceFeedService.instance;
  }
  
  /**
   * Connect to Binance WebSocket
   */
  async connect(): Promise<void> {
    if (this.status === FeedStatus.CONNECTED || this.status === FeedStatus.CONNECTING) {
      logger.warn('Already connected or connecting to Binance');
      return;
    }
    
    this.status = FeedStatus.CONNECTING;
    
    try {
      const symbols = symbolDiscoveryService.getSymbolsForSource(FeedSource.BINANCE);
      if (symbols.length === 0) {
        logger.warn('No symbols available for Binance feed');
        return;
      }
      
      // Build stream URL with multiple symbols
      const streams = this.buildStreamUrl(symbols.slice(0, 100)); // Limit to 100 symbols
      const wsUrl = `${config.exchanges.binance.wsUrl}/${streams}`;
      
      logger.info(`Connecting to Binance WebSocket: ${wsUrl.substring(0, 100)}...`);
      
      this.ws = new WebSocket(wsUrl);
      
      this.ws.on('open', () => this.handleOpen());
      this.ws.on('message', (data) => this.handleMessage(data));
      this.ws.on('error', (error) => this.handleError(error));
      this.ws.on('close', (code, reason) => this.handleClose(code, reason));
      this.ws.on('ping', () => this.handlePing());
      this.ws.on('pong', () => this.handlePong());
      
    } catch (error) {
      logger.error('Failed to connect to Binance', error);
      this.status = FeedStatus.ERROR;
      this.scheduleReconnect();
    }
  }
  
  /**
   * Build stream URL for multiple symbols
   */
  private buildStreamUrl(symbols: string[]): string {
    const streams = symbols.map(symbol => 
      `${symbol.toLowerCase()}@ticker`
    ).join('/');
    return `stream?streams=${streams}`;
  }
  
  /**
   * Handle WebSocket open
   */
  private handleOpen(): void {
    logger.info('Connected to Binance WebSocket');
    this.status = FeedStatus.CONNECTED;
    this.reconnectAttempts = 0;
    this.errorCount = 0;
    this.startHeartbeat();
    this.emit('connected', { source: FeedSource.BINANCE });
  }
  
  /**
   * Handle incoming message
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());
      this.messageCount++;
      this.lastDataReceived = new Date();
      
      // Handle different message types
      if (message.stream && message.data) {
        this.processTicker(message.data);
      } else if (message.e === '24hrTicker') {
        this.processTicker(message);
      }
      
    } catch (error) {
      logger.error('Error processing Binance message', error);
      this.errorCount++;
    }
  }
  
  /**
   * Process ticker data
   */
  private processTicker(data: any): void {
    try {
      const tick: IPriceTick = {
        symbol: data.s,
        price: parseFloat(data.c || data.lastPrice),
        bid: parseFloat(data.b || data.bestBid),
        ask: parseFloat(data.a || data.bestAsk),
        bidSize: parseFloat(data.B || data.bestBidQty || 0),
        askSize: parseFloat(data.A || data.bestAskQty || 0),
        volume24h: parseFloat(data.v || data.volume || 0),
        quoteVolume24h: parseFloat(data.q || data.quoteVolume || 0),
        timestamp: new Date(data.E || Date.now()),
        source: FeedSource.BINANCE,
      };
      
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
    logger.error('Binance WebSocket error', error);
    this.status = FeedStatus.ERROR;
    this.errorCount++;
    this.emit('error', { source: FeedSource.BINANCE, error });
  }
  
  /**
   * Handle WebSocket close
   */
  private handleClose(code: number, reason: Buffer): void {
    logger.warn(`Binance WebSocket closed. Code: ${code}, Reason: ${reason.toString()}`);
    this.status = FeedStatus.DISCONNECTED;
    this.stopHeartbeat();
    this.emit('disconnected', { source: FeedSource.BINANCE, code, reason: reason.toString() });
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
        this.ws.ping();
        
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
      logger.error('Max reconnection attempts reached for Binance feed');
      this.emit('max_reconnect', { source: FeedSource.BINANCE });
      return;
    }
    
    const delay = Math.min(
      this.reconnectInterval * Math.pow(2, this.reconnectAttempts),
      60000 // Max 1 minute
    );
    
    this.reconnectAttempts++;
    logger.info(`Scheduling Binance reconnection in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
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
    logger.info('Disconnecting from Binance WebSocket');
    
    this.stopHeartbeat();
    
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      this.ws = null;
    }
    
    this.status = FeedStatus.DISCONNECTED;
  }
  
  /**
   * Subscribe to symbols
   */
  async subscribe(symbols: string[]): Promise<void> {
    symbols.forEach(symbol => this.subscribedSymbols.add(symbol));
    
    if (this.status !== FeedStatus.CONNECTED) {
      await this.connect();
    }
  }
  
  /**
   * Unsubscribe from symbols
   */
  unsubscribe(symbols: string[]): void {
    symbols.forEach(symbol => this.subscribedSymbols.delete(symbol));
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
      source: FeedSource.BINANCE,
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

export default BinanceFeedService.getInstance();