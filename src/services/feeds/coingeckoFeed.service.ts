import axios, { AxiosInstance } from 'axios';
import { EventEmitter } from 'events';
import { createLogger } from '../../utils/logger';
import { IPriceTick, FeedSource, FeedStatus, IFeedHealth } from '../../types/priceFeed';
import { config } from '../../config/environment';
import symbolDiscoveryService from '../symbolDiscovery.service';

const logger = createLogger('CoinGeckoFeed');

interface ICoinGeckoTicker {
  symbol: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  total_volume: number;
  high_24h: number;
  low_24h: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  last_updated: string;
}

interface ISymbolMapping {
  coingeckoId: string;
  symbol: string;
}

export class CoinGeckoFeedService extends EventEmitter {
  private static instance: CoinGeckoFeedService;
  private status: FeedStatus = FeedStatus.DISCONNECTED;
  private axios: AxiosInstance;
  private symbolMappings: Map<string, string> = new Map(); // symbol -> coingeckoId
  private priceCache: Map<string, IPriceTick> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;
  private updateFrequency: number = 30000; // 30 seconds (respecting rate limits)
  private messageCount: number = 0;
  private errorCount: number = 0;
  private lastUpdate: Date = new Date();
  private lastDataReceived: Date = new Date();
  
  // Common CoinGecko ID mappings
  private readonly commonMappings: ISymbolMapping[] = [
    { coingeckoId: 'bitcoin', symbol: 'BTCUSDT' },
    { coingeckoId: 'ethereum', symbol: 'ETHUSDT' },
    { coingeckoId: 'binancecoin', symbol: 'BNBUSDT' },
    { coingeckoId: 'solana', symbol: 'SOLUSDT' },
    { coingeckoId: 'cardano', symbol: 'ADAUSDT' },
    { coingeckoId: 'ripple', symbol: 'XRPUSDT' },
    { coingeckoId: 'polkadot', symbol: 'DOTUSDT' },
    { coingeckoId: 'dogecoin', symbol: 'DOGEUSDT' },
    { coingeckoId: 'avalanche-2', symbol: 'AVAXUSDT' },
    { coingeckoId: 'shiba-inu', symbol: 'SHIBUSDT' },
    { coingeckoId: 'matic-network', symbol: 'MATICUSDT' },
    { coingeckoId: 'litecoin', symbol: 'LTCUSDT' },
    { coingeckoId: 'uniswap', symbol: 'UNIUSDT' },
    { coingeckoId: 'chainlink', symbol: 'LINKUSDT' },
    { coingeckoId: 'cosmos', symbol: 'ATOMUSDT' },
    { coingeckoId: 'stellar', symbol: 'XLMUSDT' },
    { coingeckoId: 'near', symbol: 'NEARUSDT' },
    { coingeckoId: 'algorand', symbol: 'ALGOUSDT' },
    { coingeckoId: 'fantom', symbol: 'FTMUSDT' },
    { coingeckoId: 'vechain', symbol: 'VETUSDT' },
  ];
  
  private constructor() {
    super();
    this.setMaxListeners(100);
    
    // Setup axios instance with default config
    this.axios = axios.create({
      baseURL: config.exchanges.coingecko.apiUrl,
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
      },
    });
    
    // Add API key if configured
    if (config.exchanges.coingecko.apiKey) {
      this.axios.defaults.headers.common['x-cg-demo-api-key'] = config.exchanges.coingecko.apiKey;
    }
    
    // Setup response interceptor for rate limiting
    this.axios.interceptors.response.use(
      response => response,
      error => {
        if (error.response?.status === 429) {
          logger.warn('CoinGecko rate limit hit, backing off...');
          this.updateFrequency = Math.min(this.updateFrequency * 2, 300000); // Max 5 minutes
        }
        return Promise.reject(error);
      }
    );
    
    // Initialize symbol mappings
    this.initializeSymbolMappings();
  }
  
  public static getInstance(): CoinGeckoFeedService {
    if (!CoinGeckoFeedService.instance) {
      CoinGeckoFeedService.instance = new CoinGeckoFeedService();
    }
    return CoinGeckoFeedService.instance;
  }
  
  /**
   * Initialize symbol mappings
   */
  private initializeSymbolMappings(): void {
    this.commonMappings.forEach(mapping => {
      this.symbolMappings.set(mapping.symbol, mapping.coingeckoId);
    });
  }
  
  /**
   * Initialize and start fetching prices
   */
  async initialize(): Promise<void> {
    logger.info('Initializing CoinGecko price feed');
    
    try {
      // Test connectivity
      await this.testConnection();
      
      this.status = FeedStatus.CONNECTED;
      
      // Start periodic updates
      this.startPriceUpdates();
      
      // Fetch initial prices
      await this.fetchPrices();
      
      this.emit('connected', { source: FeedSource.COINGECKO });
      logger.info('CoinGecko feed initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize CoinGecko feed', error);
      this.status = FeedStatus.ERROR;
      this.errorCount++;
    }
  }
  
  /**
   * Test connection to CoinGecko API
   */
  private async testConnection(): Promise<void> {
    const response = await this.axios.get('/ping');
    if (response.data.gecko_says !== '(V3) To the Moon!') {
      throw new Error('Invalid CoinGecko API response');
    }
  }
  
  /**
   * Start periodic price updates
   */
  private startPriceUpdates(): void {
    this.stopPriceUpdates();
    
    this.updateInterval = setInterval(async () => {
      try {
        await this.fetchPrices();
      } catch (error) {
        logger.error('Error fetching prices', error);
        this.errorCount++;
      }
    }, this.updateFrequency);
  }
  
  /**
   * Stop price updates
   */
  private stopPriceUpdates(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
  
  /**
   * Fetch prices from CoinGecko
   */
  async fetchPrices(): Promise<void> {
    try {
      const ids = Array.from(this.symbolMappings.values()).join(',');
      
      if (!ids) {
        logger.warn('No symbols to fetch from CoinGecko');
        return;
      }
      
      const response = await this.axios.get('/coins/markets', {
        params: {
          vs_currency: 'usd',
          ids,
          order: 'market_cap_desc',
          per_page: 250,
          page: 1,
          sparkline: false,
          price_change_percentage: '24h',
        },
      });
      
      const tickers: ICoinGeckoTicker[] = response.data;
      
      // Process tickers
      tickers.forEach(ticker => {
        const symbol = this.findSymbolByCoinGeckoId(ticker.symbol.toUpperCase() + 'USDT');
        if (symbol) {
          const tick = this.convertToTick(symbol, ticker);
          this.priceCache.set(symbol, tick);
          this.emit('tick', tick);
          this.messageCount++;
        }
      });
      
      this.lastDataReceived = new Date();
      this.lastUpdate = new Date();
      
      logger.debug(`Fetched ${tickers.length} prices from CoinGecko`);
    } catch (error) {
      logger.error('Error fetching CoinGecko prices', error);
      this.errorCount++;
      throw error;
    }
  }
  
  /**
   * Fetch single symbol price
   */
  async fetchSymbolPrice(symbol: string): Promise<IPriceTick | null> {
    try {
      const coingeckoId = this.symbolMappings.get(symbol);
      if (!coingeckoId) {
        logger.warn(`No CoinGecko mapping for symbol ${symbol}`);
        return null;
      }
      
      const response = await this.axios.get(`/simple/price`, {
        params: {
          ids: coingeckoId,
          vs_currencies: 'usd',
          include_24hr_vol: true,
          include_24hr_change: true,
          include_last_updated_at: true,
        },
      });
      
      const data = response.data[coingeckoId];
      if (!data) {
        return null;
      }
      
      const tick: IPriceTick = {
        symbol,
        price: data.usd,
        bid: data.usd * 0.9995, // Simulate bid with 0.05% spread
        ask: data.usd * 1.0005, // Simulate ask with 0.05% spread
        bidSize: 0,
        askSize: 0,
        volume24h: data.usd_24h_vol || 0,
        quoteVolume24h: data.usd_24h_vol || 0,
        timestamp: new Date(data.last_updated_at * 1000),
        source: FeedSource.COINGECKO,
      };
      
      this.priceCache.set(symbol, tick);
      this.emit('tick', tick);
      this.messageCount++;
      
      return tick;
    } catch (error) {
      logger.error(`Error fetching price for ${symbol}`, error);
      this.errorCount++;
      return null;
    }
  }
  
  /**
   * Convert CoinGecko ticker to price tick
   */
  private convertToTick(symbol: string, ticker: ICoinGeckoTicker): IPriceTick {
    const price = ticker.current_price;
    const spread = price * 0.001; // 0.1% spread
    
    return {
      symbol,
      price,
      bid: price - spread / 2,
      ask: price + spread / 2,
      bidSize: 0, // CoinGecko doesn't provide order book data
      askSize: 0,
      volume24h: ticker.total_volume / price, // Convert USD volume to base asset volume
      quoteVolume24h: ticker.total_volume,
      timestamp: new Date(ticker.last_updated),
      source: FeedSource.COINGECKO,
    };
  }
  
  /**
   * Find symbol by CoinGecko ID
   */
  private findSymbolByCoinGeckoId(symbol: string): string | null {
    // Try direct match first
    if (this.symbolMappings.has(symbol)) {
      return symbol;
    }
    
    // Try to find by checking if symbol exists in our active symbols
    const activeSymbols = symbolDiscoveryService.getActiveSymbols();
    const found = activeSymbols.find(s => s.symbol === symbol);
    
    return found ? found.symbol : null;
  }
  
  /**
   * Get cached price
   */
  getCachedPrice(symbol: string): IPriceTick | null {
    const tick = this.priceCache.get(symbol);
    if (!tick) {
      return null;
    }
    
    // Check if cache is stale (older than 5 minutes)
    const age = Date.now() - tick.timestamp.getTime();
    if (age > 300000) {
      return null;
    }
    
    return tick;
  }
  
  /**
   * Get all cached prices
   */
  getAllCachedPrices(): IPriceTick[] {
    const prices: IPriceTick[] = [];
    const now = Date.now();
    
    this.priceCache.forEach(tick => {
      // Only return non-stale prices
      if (now - tick.timestamp.getTime() < 300000) {
        prices.push(tick);
      }
    });
    
    return prices;
  }
  
  /**
   * Add symbol mapping
   */
  addSymbolMapping(symbol: string, coingeckoId: string): void {
    this.symbolMappings.set(symbol, coingeckoId);
    logger.info(`Added CoinGecko mapping: ${symbol} -> ${coingeckoId}`);
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
      source: FeedSource.COINGECKO,
      status: this.status,
      connected: this.status === FeedStatus.CONNECTED,
      lastHeartbeat: this.lastUpdate,
      lastDataReceived: this.lastDataReceived,
      messagesPerSecond: 0, // REST API doesn't have continuous messages
      averageLatency: 0,
      errorCount: this.errorCount,
      reconnectCount: 0, // REST API doesn't reconnect
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
    if (timeSinceLastData > 60000) quality -= 20;  // 1 minute
    if (timeSinceLastData > 180000) quality -= 30; // 3 minutes
    if (timeSinceLastData > 300000) quality -= 50; // 5 minutes
    
    // Reduce quality based on error rate
    quality -= errorRate * 100;
    
    // REST API is generally lower quality than WebSocket
    quality *= 0.7; // 70% of max quality for REST
    
    return Math.max(0, Math.min(100, quality));
  }
  
  /**
   * Disconnect (cleanup)
   */
  disconnect(): void {
    logger.info('Disconnecting CoinGecko feed');
    this.stopPriceUpdates();
    this.status = FeedStatus.DISCONNECTED;
    this.emit('disconnected', { source: FeedSource.COINGECKO });
  }
  
  /**
   * Get status
   */
  getStatus(): FeedStatus {
    return this.status;
  }
}

export default CoinGeckoFeedService.getInstance();