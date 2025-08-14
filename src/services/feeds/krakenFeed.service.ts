import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { createLogger } from '../../utils/logger';
import { IPriceTick, FeedSource, FeedStatus, IFeedHealth, ISymbolInfo } from '../../types/priceFeed';
import { config } from '../../config/environment';
import symbolDiscoveryService from '../symbolDiscovery.service';

const logger = createLogger('KrakenFeed');

interface IKrakenMessage {
  event?: string;
  pair?: string;
  subscription?: any;
  channelID?: number;
  channelName?: string;
  errorMessage?: string;
}

interface IKrakenTickerData {
  a: [string, string, string]; // ask [price, wholeLotVolume, lotVolume]
  b: [string, string, string]; // bid [price, wholeLotVolume, lotVolume]
  c: [string, string]; // close [price, lotVolume]
  v: [string, string]; // volume [today, last 24 hours]
  p: [string, string]; // volume weighted average price [today, last 24 hours]
  t: [number, number]; // number of trades [today, last 24 hours]
  l: [string, string]; // low [today, last 24 hours]
  h: [string, string]; // high [today, last 24 hours]
  o: [string, string]; // open [today, last 24 hours]
}

export class KrakenFeedService extends EventEmitter {
  private static instance: KrakenFeedService;
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
  private subscribedPairs: Map<string, number> = new Map(); // pair -> channelID
  private pairMapping: Map<string, string> = new Map(); // Kraken pair -> symbol
  private messageBuffer: IPriceTick[] = [];
  private maxBufferSize: number = 10000;
  
  private constructor() {
    super();
    this.setMaxListeners(100);
  }
  
  public static getInstance(): KrakenFeedService {
    if (!KrakenFeedService.instance) {
      KrakenFeedService.instance = new KrakenFeedService();
    }
    return KrakenFeedService.instance;
  }
  
  /**
   * Connect to Kraken WebSocket
   */
  async connect(): Promise<void> {
    if (this.status === FeedStatus.CONNECTED || this.status === FeedStatus.CONNECTING) {
      logger.warn('Already connected or connecting to Kraken');
      return;
    }
    
    this.status = FeedStatus.CONNECTING;
    
    try {
      // Get symbols that might be available on Kraken
      const symbols = symbolDiscoveryService.getActiveSymbols();
      if (symbols.length === 0) {
        logger.warn('No symbols available for Kraken feed');
        return;
      }
      
      // Build pairs for Kraken
      const pairs = this.buildKrakenPairs(symbols.slice(0, 50)); // Limit to 50 symbols
      
      logger.info(`Connecting to Kraken WebSocket`);
      
      this.ws = new WebSocket(config.exchanges.kraken.wsUrl);
      
      this.ws.on('open', () => this.handleOpen(pairs));
      this.ws.on('message', (data) => this.handleMessage(data));
      this.ws.on('error', (error) => this.handleError(error));
      this.ws.on('close', (code, reason) => this.handleClose(code, reason));
      this.ws.on('ping', () => this.handlePing());
      this.ws.on('pong', () => this.handlePong());
      
    } catch (error) {
      logger.error('Failed to connect to Kraken', error);
      this.status = FeedStatus.ERROR;
      this.scheduleReconnect();
    }
  }
  
  /**
   * Build Kraken pairs from symbols
   */
  private buildKrakenPairs(symbols: ISymbolInfo[]): string[] {
    const pairs: string[] = [];
    
    symbols.forEach(symbolInfo => {
      // Convert BTCUSDT to XBT/USDT format (Kraken uses XBT for Bitcoin)
      let baseAsset = symbolInfo.baseAsset;
      if (baseAsset === 'BTC') baseAsset = 'XBT';
      
      const pair = `${baseAsset}/${symbolInfo.quoteAsset}`;
      pairs.push(pair);
      
      // Store reverse mapping
      this.pairMapping.set(pair, symbolInfo.symbol);
    });
    
    return pairs;
  }
  
  /**
   * Handle WebSocket open
   */
  private handleOpen(pairs: string[]): void {
    logger.info('Connected to Kraken WebSocket');
    
    // Subscribe to ticker channel for each pair
    pairs.forEach(pair => {
      const subscribeMessage = {
        event: 'subscribe',
        pair: [pair],
        subscription: {
          name: 'ticker'
        }
      };
      
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(subscribeMessage));
      }
    });
    
    // Send ping to establish heartbeat
    const pingMessage = {
      event: 'ping',
      reqid: Date.now()
    };
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(pingMessage));
    }
    
    this.status = FeedStatus.CONNECTED;
    this.reconnectAttempts = 0;
    this.errorCount = 0;
    this.startHeartbeat();
    this.emit('connected', { source: FeedSource.KRAKEN });
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
      if (Array.isArray(message)) {
        // Ticker data: [channelID, tickerData, channelName, pair]
        if (message.length >= 4 && message[2] === 'ticker') {
          this.processTicker(message[3], message[1]);
        }
      } else if (message.event) {
        switch (message.event) {
          case 'systemStatus':
            logger.info('Kraken system status', message);
            break;
          case 'subscriptionStatus':
            this.handleSubscriptionStatus(message);
            break;
          case 'pong':
            this.lastHeartbeat = new Date();
            break;
          case 'heartbeat':
            this.lastHeartbeat = new Date();
            break;
          case 'error':
            logger.error('Kraken error message', message.errorMessage);
            this.errorCount++;
            break;
        }
      }
      
    } catch (error) {
      logger.error('Error processing Kraken message', error);
      this.errorCount++;
    }
  }
  
  /**
   * Handle subscription status
   */
  private handleSubscriptionStatus(message: IKrakenMessage): void {
    if (message.pair && message.channelID !== undefined) {
      this.subscribedPairs.set(message.pair, message.channelID);
      logger.info(`Subscribed to Kraken pair ${message.pair} on channel ${message.channelID}`);
    }
  }
  
  /**
   * Process ticker data
   */
  private processTicker(pair: string, data: IKrakenTickerData): void {
    try {
      // Get original symbol from pair
      const symbol = this.pairMapping.get(pair);
      if (!symbol) return;
      
      const tick: IPriceTick = {
        symbol,
        price: parseFloat(data.c[0]), // Close price
        bid: parseFloat(data.b[0]), // Best bid
        ask: parseFloat(data.a[0]), // Best ask
        bidSize: parseFloat(data.b[1]), // Bid volume
        askSize: parseFloat(data.a[1]), // Ask volume
        volume24h: parseFloat(data.v[1]), // 24h volume
        quoteVolume24h: parseFloat(data.v[1]) * parseFloat(data.p[1]), // Volume * VWAP
        timestamp: new Date(),
        source: FeedSource.KRAKEN,
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
    logger.error('Kraken WebSocket error', error);
    this.status = FeedStatus.ERROR;
    this.errorCount++;
    this.emit('error', { source: FeedSource.KRAKEN, error });
  }
  
  /**
   * Handle WebSocket close
   */
  private handleClose(code: number, reason: Buffer): void {
    logger.warn(`Kraken WebSocket closed. Code: ${code}, Reason: ${reason.toString()}`);
    this.status = FeedStatus.DISCONNECTED;
    this.stopHeartbeat();
    this.emit('disconnected', { source: FeedSource.KRAKEN, code, reason: reason.toString() });
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
        // Send ping
        const pingMessage = {
          event: 'ping',
          reqid: Date.now()
        };
        this.ws.send(JSON.stringify(pingMessage));
        
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
      logger.error('Max reconnection attempts reached for Kraken feed');
      this.emit('max_reconnect', { source: FeedSource.KRAKEN });
      return;
    }
    
    const delay = Math.min(
      this.reconnectInterval * Math.pow(2, this.reconnectAttempts),
      60000 // Max 1 minute
    );
    
    this.reconnectAttempts++;
    logger.info(`Scheduling Kraken reconnection in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
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
    logger.info('Disconnecting from Kraken WebSocket');
    
    this.stopHeartbeat();
    
    if (this.ws) {
      // Unsubscribe from all pairs
      this.subscribedPairs.forEach((channelID, pair) => {
        const unsubscribeMessage = {
          event: 'unsubscribe',
          channelID
        };
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(unsubscribeMessage));
        }
      });
      
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      this.ws = null;
    }
    
    this.subscribedPairs.clear();
    this.status = FeedStatus.DISCONNECTED;
  }
  
  /**
   * Subscribe to pairs
   */
  async subscribe(symbols: string[]): Promise<void> {
    const pairs = this.buildKrakenPairs(
      symbols.map(s => symbolDiscoveryService.getSymbol(s)).filter(s => s)
    );
    
    if (this.status !== FeedStatus.CONNECTED) {
      await this.connect();
    } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Subscribe to additional pairs
      pairs.forEach(pair => {
        const subscribeMessage = {
          event: 'subscribe',
          pair: [pair],
          subscription: {
            name: 'ticker'
          }
        };
        this.ws.send(JSON.stringify(subscribeMessage));
      });
    }
  }
  
  /**
   * Unsubscribe from pairs
   */
  unsubscribe(symbols: string[]): void {
    const pairs = this.buildKrakenPairs(
      symbols.map(s => symbolDiscoveryService.getSymbol(s)).filter(s => s)
    );
    
    pairs.forEach(pair => {
      const channelID = this.subscribedPairs.get(pair);
      if (channelID !== undefined && this.ws && this.ws.readyState === WebSocket.OPEN) {
        const unsubscribeMessage = {
          event: 'unsubscribe',
          channelID
        };
        this.ws.send(JSON.stringify(unsubscribeMessage));
        this.subscribedPairs.delete(pair);
      }
    });
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
      source: FeedSource.KRAKEN,
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

export default KrakenFeedService.getInstance();