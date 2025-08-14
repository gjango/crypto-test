import { EventEmitter } from 'events';
import { createLogger } from '../../utils/logger';
import { IPriceTick, FeedSource, FeedStatus, IFeedHealth } from '../../types/priceFeed';
import symbolDiscoveryService from '../symbolDiscovery.service';

const logger = createLogger('SimulatedFeed');

interface ISimulatedSymbol {
  symbol: string;
  basePrice: number;
  currentPrice: number;
  trend: number; // -1 to 1
  volatility: number;
  momentum: number;
  supportLevels: number[];
  resistanceLevels: number[];
  volume24h: number;
  lastUpdate: Date;
}

export class SimulatedFeedService extends EventEmitter {
  private static instance: SimulatedFeedService;
  private status: FeedStatus = FeedStatus.DISCONNECTED;
  private symbols: Map<string, ISimulatedSymbol> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;
  private updateFrequency: number = 500; // 500ms
  private messageCount: number = 0;
  private lastUpdate: Date = new Date();
  
  // Configuration
  private baseVolatility: number = 0.002; // 0.2% per update
  private trendStrength: number = 0.3;
  private meanReversionStrength: number = 0.1;
  private supportResistanceStrength: number = 0.5;
  
  private constructor() {
    super();
    this.setMaxListeners(100);
  }
  
  public static getInstance(): SimulatedFeedService {
    if (!SimulatedFeedService.instance) {
      SimulatedFeedService.instance = new SimulatedFeedService();
    }
    return SimulatedFeedService.instance;
  }
  
  /**
   * Initialize simulated feed
   */
  async initialize(): Promise<void> {
    logger.info('Initializing simulated price feed');
    
    // Initialize symbols with base prices
    await this.initializeSymbols();
    
    this.status = FeedStatus.CONNECTED;
    this.startPriceGeneration();
    
    this.emit('connected', { source: FeedSource.SIMULATED });
  }
  
  /**
   * Initialize symbols with base prices
   */
  private async initializeSymbols(): Promise<void> {
    const basePrices: { [key: string]: number } = {
      'BTCUSDT': 45000,
      'ETHUSDT': 2800,
      'BNBUSDT': 320,
      'SOLUSDT': 110,
      'ADAUSDT': 0.65,
      'XRPUSDT': 0.62,
      'DOTUSDT': 7.5,
      'DOGEUSDT': 0.085,
      'AVAXUSDT': 38,
      'SHIBUSDT': 0.000012,
      'MATICUSDT': 0.92,
      'LTCUSDT': 72,
      'UNIUSDT': 6.2,
      'LINKUSDT': 14.5,
      'ATOMUSDT': 9.8,
      'XLMUSDT': 0.12,
      'NEARUSDT': 3.8,
      'ALGOUSDT': 0.18,
      'FTMUSDT': 0.42,
      'VETUSDT': 0.023,
    };
    
    // Get active symbols from discovery service
    const activeSymbols = symbolDiscoveryService.getActiveSymbols();
    
    activeSymbols.forEach(symbolInfo => {
      const basePrice = basePrices[symbolInfo.symbol] || Math.random() * 100 + 1;
      
      this.symbols.set(symbolInfo.symbol, {
        symbol: symbolInfo.symbol,
        basePrice,
        currentPrice: basePrice,
        trend: 0,
        volatility: this.baseVolatility * (1 + Math.random()),
        momentum: 0,
        supportLevels: this.generateSupportResistanceLevels(basePrice, 'support'),
        resistanceLevels: this.generateSupportResistanceLevels(basePrice, 'resistance'),
        volume24h: Math.random() * 1000000000,
        lastUpdate: new Date(),
      });
    });
    
    logger.info(`Initialized ${this.symbols.size} simulated symbols`);
  }
  
  /**
   * Generate support/resistance levels
   */
  private generateSupportResistanceLevels(
    basePrice: number,
    type: 'support' | 'resistance'
  ): number[] {
    const levels: number[] = [];
    const multipliers = type === 'support' 
      ? [0.95, 0.90, 0.85, 0.80]
      : [1.05, 1.10, 1.15, 1.20];
    
    multipliers.forEach(mult => {
      levels.push(basePrice * mult);
    });
    
    return levels;
  }
  
  /**
   * Start price generation
   */
  private startPriceGeneration(): void {
    this.stopPriceGeneration();
    
    this.updateInterval = setInterval(() => {
      this.generatePrices();
    }, this.updateFrequency);
    
    logger.info('Started simulated price generation');
  }
  
  /**
   * Stop price generation
   */
  private stopPriceGeneration(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
  
  /**
   * Generate prices for all symbols
   */
  private generatePrices(): void {
    const now = new Date();
    
    this.symbols.forEach(symbol => {
      const tick = this.generatePriceTick(symbol);
      this.emit('tick', tick);
      this.messageCount++;
    });
    
    this.lastUpdate = now;
  }
  
  /**
   * Generate price tick for a symbol
   */
  private generatePriceTick(symbol: ISimulatedSymbol): IPriceTick {
    // Update price using random walk with trend and mean reversion
    const priceChange = this.calculatePriceChange(symbol);
    symbol.currentPrice = Math.max(0.00000001, symbol.currentPrice * (1 + priceChange));
    
    // Update momentum
    symbol.momentum = symbol.momentum * 0.9 + priceChange * 10;
    
    // Update trend
    this.updateTrend(symbol);
    
    // Generate volume
    symbol.volume24h = symbol.volume24h * (0.99 + Math.random() * 0.02);
    
    // Calculate spread
    const spread = symbol.currentPrice * (0.0001 + symbol.volatility * 0.5);
    const bid = symbol.currentPrice - spread / 2;
    const ask = symbol.currentPrice + spread / 2;
    
    symbol.lastUpdate = new Date();
    
    return {
      symbol: symbol.symbol,
      price: symbol.currentPrice,
      bid,
      ask,
      bidSize: Math.random() * 1000,
      askSize: Math.random() * 1000,
      volume24h: symbol.volume24h,
      quoteVolume24h: symbol.volume24h * symbol.currentPrice,
      timestamp: symbol.lastUpdate,
      source: FeedSource.SIMULATED,
    };
  }
  
  /**
   * Calculate price change
   */
  private calculatePriceChange(symbol: ISimulatedSymbol): number {
    let change = 0;
    
    // Random component
    const random = (Math.random() - 0.5) * 2 * symbol.volatility;
    change += random;
    
    // Trend component
    change += symbol.trend * this.trendStrength * symbol.volatility;
    
    // Mean reversion component
    const meanDeviation = (symbol.basePrice - symbol.currentPrice) / symbol.basePrice;
    change += meanDeviation * this.meanReversionStrength * symbol.volatility;
    
    // Support/Resistance component
    change += this.applySupportResistance(symbol);
    
    // Momentum component
    change += symbol.momentum * 0.001;
    
    return change;
  }
  
  /**
   * Apply support and resistance levels
   */
  private applySupportResistance(symbol: ISimulatedSymbol): number {
    let effect = 0;
    const price = symbol.currentPrice;
    
    // Check support levels
    for (const support of symbol.supportLevels) {
      const distance = (price - support) / price;
      if (distance > 0 && distance < 0.02) { // Within 2% of support
        effect += (0.02 - distance) * this.supportResistanceStrength * symbol.volatility;
      }
    }
    
    // Check resistance levels
    for (const resistance of symbol.resistanceLevels) {
      const distance = (resistance - price) / price;
      if (distance > 0 && distance < 0.02) { // Within 2% of resistance
        effect -= (0.02 - distance) * this.supportResistanceStrength * symbol.volatility;
      }
    }
    
    return effect;
  }
  
  /**
   * Update trend
   */
  private updateTrend(symbol: ISimulatedSymbol): void {
    // Random trend changes
    if (Math.random() < 0.01) { // 1% chance to change trend
      symbol.trend = (Math.random() - 0.5) * 2;
    } else {
      // Gradual trend decay
      symbol.trend *= 0.995;
    }
    
    // Clamp trend
    symbol.trend = Math.max(-1, Math.min(1, symbol.trend));
  }
  
  /**
   * Set volatility for all symbols
   */
  setVolatility(volatility: number): void {
    this.baseVolatility = Math.max(0, Math.min(0.1, volatility));
    this.symbols.forEach(symbol => {
      symbol.volatility = this.baseVolatility * (1 + Math.random());
    });
    logger.info(`Set base volatility to ${this.baseVolatility}`);
  }
  
  /**
   * Set trend for specific symbol
   */
  setSymbolTrend(symbolName: string, trend: number): void {
    const symbol = this.symbols.get(symbolName);
    if (symbol) {
      symbol.trend = Math.max(-1, Math.min(1, trend));
      logger.info(`Set trend for ${symbolName} to ${trend}`);
    }
  }
  
  /**
   * Trigger price scenario
   */
  triggerScenario(
    symbolName: string,
    scenario: 'pump' | 'dump' | 'flash_crash' | 'recovery'
  ): void {
    const symbol = this.symbols.get(symbolName);
    if (!symbol) return;
    
    switch (scenario) {
      case 'pump':
        symbol.trend = 1;
        symbol.momentum = 10;
        symbol.volatility *= 3;
        logger.info(`Triggered pump scenario for ${symbolName}`);
        break;
        
      case 'dump':
        symbol.trend = -1;
        symbol.momentum = -10;
        symbol.volatility *= 3;
        logger.info(`Triggered dump scenario for ${symbolName}`);
        break;
        
      case 'flash_crash':
        symbol.currentPrice *= 0.7;
        symbol.volatility *= 5;
        symbol.trend = -1;
        logger.info(`Triggered flash crash for ${symbolName}`);
        break;
        
      case 'recovery':
        symbol.trend = 0.5;
        symbol.momentum = 5;
        const targetPrice = symbol.basePrice;
        symbol.currentPrice = symbol.currentPrice * 0.9 + targetPrice * 0.1;
        logger.info(`Triggered recovery for ${symbolName}`);
        break;
    }
  }
  
  /**
   * Force price update
   */
  forcePrice(symbolName: string, price: number): void {
    const symbol = this.symbols.get(symbolName);
    if (symbol) {
      symbol.currentPrice = price;
      logger.info(`Forced price for ${symbolName} to ${price}`);
      
      // Emit immediate tick
      const tick = this.generatePriceTick(symbol);
      this.emit('tick', tick);
    }
  }
  
  /**
   * Get feed health
   */
  getHealth(): IFeedHealth {
    const now = Date.now();
    const uptime = this.status === FeedStatus.CONNECTED 
      ? now - this.lastUpdate.getTime() 
      : 0;
    
    return {
      source: FeedSource.SIMULATED,
      status: this.status,
      connected: this.status === FeedStatus.CONNECTED,
      lastHeartbeat: this.lastUpdate,
      lastDataReceived: this.lastUpdate,
      messagesPerSecond: this.messageCount / (uptime / 1000) || 0,
      averageLatency: 0,
      errorCount: 0,
      reconnectCount: 0,
      uptime,
      dataQuality: 100, // Always perfect for simulated
    };
  }
  
  /**
   * Get current price for symbol
   */
  getCurrentPrice(symbolName: string): number | null {
    const symbol = this.symbols.get(symbolName);
    return symbol ? symbol.currentPrice : null;
  }
  
  /**
   * Disconnect
   */
  disconnect(): void {
    logger.info('Disconnecting simulated feed');
    this.stopPriceGeneration();
    this.status = FeedStatus.DISCONNECTED;
    this.emit('disconnected', { source: FeedSource.SIMULATED });
  }
  
  /**
   * Get status
   */
  getStatus(): FeedStatus {
    return this.status;
  }
}

export default SimulatedFeedService.getInstance();