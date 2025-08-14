import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import { 
  IPriceTick, 
  FeedSource, 
  FeedStatus,
  IFeedHealth,
  IPriceUpdate,
  MarkPriceType
} from '../types/priceFeed';
import { PriceTick } from '../models/PriceTick.model';
import { Candle } from '../models/Candle.model';
import { toDecimal128 } from '../utils/database';
import symbolDiscoveryService from './symbolDiscovery.service';
import binanceFeedService from './feeds/binanceFeed.service';
import simulatedFeedService from './feeds/simulatedFeed.service';

const logger = createLogger('FeedManager');

interface IFeedPriority {
  source: FeedSource;
  priority: number;
  feed: any;
}

interface ISymbolPrice {
  symbol: string;
  prices: Map<FeedSource, IPriceTick>;
  lastUpdate: Date;
  primarySource: FeedSource;
  markPrice: number;
}

export class FeedManagerService extends EventEmitter {
  private static instance: FeedManagerService;
  private feeds: Map<FeedSource, any> = new Map();
  private feedPriorities: IFeedPriority[] = [];
  private symbolPrices: Map<string, ISymbolPrice> = new Map();
  private isRunning: boolean = false;
  private processInterval: NodeJS.Timeout | null = null;
  private candleGenerators: Map<string, NodeJS.Timeout> = new Map();
  
  // Configuration
  private outlierThreshold: number = 0.5; // 50% price change
  private aggregationWindow: number = 1000; // 1 second
  private maxTicksPerSymbol: number = 100;
  private markPriceType: MarkPriceType = MarkPriceType.MID;
  
  // Statistics
  private ticksProcessed: number = 0;
  private ticksFiltered: number = 0;
  private lastHealthCheck: Date = new Date();
  
  private constructor() {
    super();
    this.setMaxListeners(1000);
  }
  
  public static getInstance(): FeedManagerService {
    if (!FeedManagerService.instance) {
      FeedManagerService.instance = new FeedManagerService();
    }
    return FeedManagerService.instance;
  }
  
  /**
   * Initialize feed manager
   */
  async initialize(): Promise<void> {
    logger.info('Initializing feed manager');
    
    // Initialize symbol discovery
    await symbolDiscoveryService.initialize();
    
    // Setup feeds with priorities
    this.setupFeeds();
    
    // Connect to feeds
    await this.connectFeeds();
    
    // Start processing pipeline
    this.startProcessing();
    
    // Start candle generation
    this.startCandleGeneration();
    
    this.isRunning = true;
    logger.info('Feed manager initialized successfully');
  }
  
  /**
   * Setup feeds with priorities
   */
  private setupFeeds(): void {
    // Setup Binance feed (highest priority)
    this.feedPriorities.push({
      source: FeedSource.BINANCE,
      priority: 1,
      feed: binanceFeedService,
    });
    this.feeds.set(FeedSource.BINANCE, binanceFeedService);
    
    // Setup simulated feed (lowest priority)
    this.feedPriorities.push({
      source: FeedSource.SIMULATED,
      priority: 10,
      feed: simulatedFeedService,
    });
    this.feeds.set(FeedSource.SIMULATED, simulatedFeedService);
    
    // Sort by priority
    this.feedPriorities.sort((a, b) => a.priority - b.priority);
    
    // Subscribe to feed events
    this.feedPriorities.forEach(({ feed, source }) => {
      feed.on('tick', (tick: IPriceTick) => this.handleTick(tick));
      feed.on('connected', () => this.handleFeedConnected(source));
      feed.on('disconnected', () => this.handleFeedDisconnected(source));
      feed.on('error', (error: Error) => this.handleFeedError(source, error));
    });
  }
  
  /**
   * Connect to all feeds
   */
  private async connectFeeds(): Promise<void> {
    const connections = this.feedPriorities.map(async ({ feed, source }) => {
      try {
        if (source === FeedSource.BINANCE) {
          await binanceFeedService.connect();
        } else if (source === FeedSource.SIMULATED) {
          await simulatedFeedService.initialize();
        }
      } catch (error) {
        logger.error(`Failed to connect to ${source}`, error);
      }
    });
    
    await Promise.allSettled(connections);
  }
  
  /**
   * Handle incoming tick
   */
  private handleTick(tick: IPriceTick): void {
    this.ticksProcessed++;
    
    // Validate tick
    if (!this.validateTick(tick)) {
      this.ticksFiltered++;
      return;
    }
    
    // Update symbol price
    this.updateSymbolPrice(tick);
    
    // Emit processed tick
    this.emit('tick', tick);
    
    // Store in database (async)
    this.storeTick(tick).catch(err => 
      logger.error('Failed to store tick', err)
    );
  }
  
  /**
   * Validate tick
   */
  private validateTick(tick: IPriceTick): boolean {
    // Basic validation
    if (!tick.symbol || !tick.price || tick.price <= 0) {
      return false;
    }
    
    // Check for outliers
    const symbolPrice = this.symbolPrices.get(tick.symbol);
    if (symbolPrice && symbolPrice.markPrice > 0) {
      const priceChange = Math.abs((tick.price - symbolPrice.markPrice) / symbolPrice.markPrice);
      if (priceChange > this.outlierThreshold) {
        logger.warn(`Outlier detected for ${tick.symbol}: ${priceChange * 100}% change from ${tick.source}`);
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Update symbol price
   */
  private updateSymbolPrice(tick: IPriceTick): void {
    let symbolPrice = this.symbolPrices.get(tick.symbol);
    
    if (!symbolPrice) {
      symbolPrice = {
        symbol: tick.symbol,
        prices: new Map(),
        lastUpdate: tick.timestamp,
        primarySource: tick.source,
        markPrice: tick.price,
      };
      this.symbolPrices.set(tick.symbol, symbolPrice);
    }
    
    // Update price from source
    symbolPrice.prices.set(tick.source, tick);
    symbolPrice.lastUpdate = tick.timestamp;
    
    // Determine primary source (highest priority available)
    symbolPrice.primarySource = this.determinePrimarySource(symbolPrice);
    
    // Calculate mark price
    symbolPrice.markPrice = this.calculateMarkPrice(symbolPrice);
  }
  
  /**
   * Determine primary source for symbol
   */
  private determinePrimarySource(symbolPrice: ISymbolPrice): FeedSource {
    for (const { source } of this.feedPriorities) {
      const priceTick = symbolPrice.prices.get(source);
      if (priceTick && this.isTickFresh(priceTick)) {
        return source;
      }
    }
    return symbolPrice.primarySource;
  }
  
  /**
   * Check if tick is fresh
   */
  private isTickFresh(tick: IPriceTick, maxAge: number = 5000): boolean {
    return Date.now() - tick.timestamp.getTime() < maxAge;
  }
  
  /**
   * Calculate mark price
   */
  private calculateMarkPrice(symbolPrice: ISymbolPrice): number {
    const primaryTick = symbolPrice.prices.get(symbolPrice.primarySource);
    if (!primaryTick) return symbolPrice.markPrice;
    
    switch (this.markPriceType) {
      case MarkPriceType.LAST:
        return primaryTick.price;
        
      case MarkPriceType.MID:
        return (primaryTick.bid + primaryTick.ask) / 2;
        
      case MarkPriceType.VWAP:
        // Calculate volume-weighted average price
        let totalVolume = 0;
        let totalValue = 0;
        
        symbolPrice.prices.forEach(tick => {
          if (this.isTickFresh(tick) && tick.volume24h) {
            totalVolume += tick.volume24h;
            totalValue += tick.price * tick.volume24h;
          }
        });
        
        return totalVolume > 0 ? totalValue / totalVolume : primaryTick.price;
        
      default:
        return primaryTick.price;
    }
  }
  
  /**
   * Store tick in database
   */
  private async storeTick(tick: IPriceTick): Promise<void> {
    try {
      await PriceTick.create({
        symbol: tick.symbol,
        price: toDecimal128(tick.price),
        bid: toDecimal128(tick.bid),
        ask: toDecimal128(tick.ask),
        bidSize: toDecimal128(tick.bidSize || 0),
        askSize: toDecimal128(tick.askSize || 0),
        volume24h: toDecimal128(tick.volume24h || 0),
        quoteVolume24h: toDecimal128(tick.quoteVolume24h || 0),
        source: tick.source,
        timestamp: tick.timestamp,
      });
    } catch (error) {
      // Ignore duplicate key errors
      if ((error as any).code !== 11000) {
        throw error;
      }
    }
  }
  
  /**
   * Start processing pipeline
   */
  private startProcessing(): void {
    this.processInterval = setInterval(() => {
      this.processPriceUpdates();
      this.performHealthCheck();
    }, this.aggregationWindow);
  }
  
  /**
   * Process price updates
   */
  private processPriceUpdates(): void {
    const updates: IPriceUpdate[] = [];
    
    this.symbolPrices.forEach(symbolPrice => {
      const primaryTick = symbolPrice.prices.get(symbolPrice.primarySource);
      if (!primaryTick || !this.isTickFresh(primaryTick, 10000)) {
        return;
      }
      
      const update: IPriceUpdate = {
        symbol: symbolPrice.symbol,
        price: primaryTick.price,
        bid: primaryTick.bid,
        ask: primaryTick.ask,
        spread: primaryTick.ask - primaryTick.bid,
        spreadPercent: ((primaryTick.ask - primaryTick.bid) / primaryTick.bid) * 100,
        markPrice: symbolPrice.markPrice,
        volume24h: primaryTick.volume24h || 0,
        high24h: 0, // TODO: Calculate from stored ticks
        low24h: 0,  // TODO: Calculate from stored ticks
        change24h: 0, // TODO: Calculate from stored ticks
        changePercent24h: 0, // TODO: Calculate from stored ticks
        lastUpdate: symbolPrice.lastUpdate,
        source: symbolPrice.primarySource,
      };
      
      updates.push(update);
    });
    
    if (updates.length > 0) {
      this.emit('price_update', updates);
    }
  }
  
  /**
   * Perform health check
   */
  private performHealthCheck(): void {
    const now = new Date();
    const timeSinceLastCheck = now.getTime() - this.lastHealthCheck.getTime();
    
    if (timeSinceLastCheck < 30000) return; // Check every 30 seconds
    
    const health: IFeedHealth[] = [];
    
    this.feedPriorities.forEach(({ feed, source }) => {
      if (feed.getHealth) {
        health.push(feed.getHealth());
      }
    });
    
    // Check for failover conditions
    this.checkFailoverConditions(health);
    
    this.lastHealthCheck = now;
    this.emit('health', health);
  }
  
  /**
   * Check failover conditions
   */
  private checkFailoverConditions(health: IFeedHealth[]): void {
    for (const feedHealth of health) {
      if (feedHealth.dataQuality < 50 || !feedHealth.connected) {
        logger.warn(`Feed ${feedHealth.source} is degraded. Quality: ${feedHealth.dataQuality}`);
        
        // Trigger failover if primary feed is down
        if (feedHealth.source === this.getPrimaryFeed()) {
          this.triggerFailover(feedHealth.source);
        }
      }
    }
  }
  
  /**
   * Get primary feed
   */
  private getPrimaryFeed(): FeedSource {
    for (const { source, feed } of this.feedPriorities) {
      if (feed.getStatus && feed.getStatus() === FeedStatus.CONNECTED) {
        return source;
      }
    }
    return FeedSource.SIMULATED;
  }
  
  /**
   * Trigger failover
   */
  private triggerFailover(failedSource: FeedSource): void {
    logger.warn(`Triggering failover from ${failedSource}`);
    
    // Find next available feed
    for (const { source, feed } of this.feedPriorities) {
      if (source !== failedSource && feed.getStatus() === FeedStatus.CONNECTED) {
        logger.info(`Failing over to ${source}`);
        this.emit('failover', { from: failedSource, to: source });
        break;
      }
    }
  }
  
  /**
   * Start candle generation
   */
  private startCandleGeneration(): void {
    const intervals = ['1m', '5m', '15m', '1h', '4h', '1d'];
    
    intervals.forEach(interval => {
      const timer = setInterval(() => {
        this.generateCandles(interval);
      }, this.getIntervalMs(interval));
      
      this.candleGenerators.set(interval, timer);
    });
  }
  
  /**
   * Get interval in milliseconds
   */
  private getIntervalMs(interval: string): number {
    const map: { [key: string]: number } = {
      '1m': 60000,
      '5m': 300000,
      '15m': 900000,
      '1h': 3600000,
      '4h': 14400000,
      '1d': 86400000,
    };
    return map[interval] || 60000;
  }
  
  /**
   * Generate candles
   */
  private async generateCandles(interval: string): Promise<void> {
    // TODO: Implement candle generation from ticks
    logger.debug(`Generating ${interval} candles`);
  }
  
  /**
   * Handle feed connected
   */
  private handleFeedConnected(source: FeedSource): void {
    logger.info(`Feed ${source} connected`);
    this.emit('feed_connected', source);
  }
  
  /**
   * Handle feed disconnected
   */
  private handleFeedDisconnected(source: FeedSource): void {
    logger.warn(`Feed ${source} disconnected`);
    this.emit('feed_disconnected', source);
    
    if (source === this.getPrimaryFeed()) {
      this.triggerFailover(source);
    }
  }
  
  /**
   * Handle feed error
   */
  private handleFeedError(source: FeedSource, error: Error): void {
    logger.error(`Feed ${source} error`, error);
    this.emit('feed_error', { source, error });
  }
  
  /**
   * Get current price
   */
  getCurrentPrice(symbol: string): IPriceUpdate | null {
    const symbolPrice = this.symbolPrices.get(symbol);
    if (!symbolPrice) return null;
    
    const primaryTick = symbolPrice.prices.get(symbolPrice.primarySource);
    if (!primaryTick) return null;
    
    return {
      symbol: symbolPrice.symbol,
      price: primaryTick.price,
      bid: primaryTick.bid,
      ask: primaryTick.ask,
      spread: primaryTick.ask - primaryTick.bid,
      spreadPercent: ((primaryTick.ask - primaryTick.bid) / primaryTick.bid) * 100,
      markPrice: symbolPrice.markPrice,
      volume24h: primaryTick.volume24h || 0,
      high24h: 0,
      low24h: 0,
      change24h: 0,
      changePercent24h: 0,
      lastUpdate: symbolPrice.lastUpdate,
      source: symbolPrice.primarySource,
    };
  }
  
  /**
   * Get all current prices
   */
  getAllPrices(): IPriceUpdate[] {
    const prices: IPriceUpdate[] = [];
    
    this.symbolPrices.forEach((_, symbol) => {
      const price = this.getCurrentPrice(symbol);
      if (price) {
        prices.push(price);
      }
    });
    
    return prices;
  }
  
  /**
   * Force switch to specific feed
   */
  forceSwitchFeed(source: FeedSource): void {
    logger.info(`Force switching to ${source}`);
    
    // Reorder priorities
    const feedIndex = this.feedPriorities.findIndex(f => f.source === source);
    if (feedIndex > 0) {
      const feed = this.feedPriorities[feedIndex];
      this.feedPriorities.splice(feedIndex, 1);
      this.feedPriorities.unshift(feed);
    }
    
    this.emit('feed_switch', source);
  }
  
  /**
   * Get statistics
   */
  getStatistics(): any {
    return {
      ticksProcessed: this.ticksProcessed,
      ticksFiltered: this.ticksFiltered,
      filterRate: this.ticksProcessed > 0 
        ? (this.ticksFiltered / this.ticksProcessed) * 100 
        : 0,
      symbolsTracked: this.symbolPrices.size,
      primaryFeed: this.getPrimaryFeed(),
      feeds: this.feedPriorities.map(({ source, feed }) => ({
        source,
        status: feed.getStatus ? feed.getStatus() : 'unknown',
      })),
    };
  }
  
  /**
   * Shutdown feed manager
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down feed manager');
    
    this.isRunning = false;
    
    // Stop processing
    if (this.processInterval) {
      clearInterval(this.processInterval);
    }
    
    // Stop candle generators
    this.candleGenerators.forEach(timer => clearInterval(timer));
    
    // Disconnect feeds
    this.feeds.forEach(feed => {
      if (feed.disconnect) {
        feed.disconnect();
      }
    });
    
    this.removeAllListeners();
  }
}

export default FeedManagerService.getInstance();