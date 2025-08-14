import axios from 'axios';
import { Market } from '../models/Market.model';
import { createLogger } from '../utils/logger';
import { ISymbolInfo, FeedSource } from '../types/priceFeed';
import { config } from '../config/environment';
import { toDecimal128 } from '../utils/database';

const logger = createLogger('SymbolDiscovery');

export class SymbolDiscoveryService {
  private static instance: SymbolDiscoveryService;
  private symbols: Map<string, ISymbolInfo> = new Map();
  private lastUpdate: Date = new Date(0);
  private updateInterval: number = 24 * 60 * 60 * 1000; // 24 hours
  private maxSymbols: number = 300;
  
  private constructor() {}
  
  public static getInstance(): SymbolDiscoveryService {
    if (!SymbolDiscoveryService.instance) {
      SymbolDiscoveryService.instance = new SymbolDiscoveryService();
    }
    return SymbolDiscoveryService.instance;
  }
  
  /**
   * Initialize and fetch symbols
   */
  async initialize(): Promise<void> {
    logger.info('Initializing symbol discovery service');
    await this.refreshSymbols();
    
    // Schedule periodic updates
    setInterval(() => {
      this.refreshSymbols().catch(err => 
        logger.error('Failed to refresh symbols', err)
      );
    }, this.updateInterval);
  }
  
  /**
   * Refresh symbol list from all sources
   */
  async refreshSymbols(): Promise<void> {
    try {
      logger.info('Refreshing symbol list');
      
      // Fetch from multiple sources in parallel
      const [binanceSymbols, coinbaseSymbols, coingeckoData] = await Promise.allSettled([
        this.fetchBinanceSymbols(),
        this.fetchCoinbaseSymbols(),
        this.fetchCoinGeckoTopCoins(),
      ]);
      
      // Merge and rank symbols
      const mergedSymbols = this.mergeSymbolData(
        binanceSymbols.status === 'fulfilled' ? binanceSymbols.value : [],
        coinbaseSymbols.status === 'fulfilled' ? coinbaseSymbols.value : [],
        coingeckoData.status === 'fulfilled' ? coingeckoData.value : []
      );
      
      // Update database
      await this.updateMarketsInDatabase(mergedSymbols);
      
      // Update in-memory cache
      this.symbols.clear();
      mergedSymbols.forEach(symbol => {
        this.symbols.set(symbol.symbol, symbol);
      });
      
      this.lastUpdate = new Date();
      logger.info(`Symbol discovery complete. Found ${this.symbols.size} tradable pairs`);
    } catch (error) {
      logger.error('Error refreshing symbols', error);
    }
  }
  
  /**
   * Fetch Binance exchange info
   */
  private async fetchBinanceSymbols(): Promise<ISymbolInfo[]> {
    try {
      const response = await axios.get('https://api.binance.com/api/v3/exchangeInfo');
      const symbols: ISymbolInfo[] = [];
      
      for (const symbol of response.data.symbols) {
        if (
          symbol.status === 'TRADING' &&
          symbol.quoteAsset === 'USDT' &&
          symbol.isSpotTradingAllowed
        ) {
          const filters = symbol.filters.reduce((acc: any, filter: any) => {
            acc[filter.filterType] = filter;
            return acc;
          }, {});
          
          symbols.push({
            symbol: symbol.symbol,
            baseAsset: symbol.baseAsset,
            quoteAsset: symbol.quoteAsset,
            status: 'TRADING',
            enabled: true,
            tickSize: parseFloat(filters.PRICE_FILTER?.tickSize || '0.01'),
            stepSize: parseFloat(filters.LOT_SIZE?.stepSize || '0.001'),
            minNotional: parseFloat(filters.MIN_NOTIONAL?.minNotional || '10'),
            sources: [FeedSource.BINANCE],
            lastUpdate: new Date(),
          });
        }
      }
      
      logger.info(`Fetched ${symbols.length} symbols from Binance`);
      return symbols;
    } catch (error) {
      logger.error('Error fetching Binance symbols', error);
      return [];
    }
  }
  
  /**
   * Fetch Coinbase trading pairs
   */
  private async fetchCoinbaseSymbols(): Promise<ISymbolInfo[]> {
    try {
      const response = await axios.get('https://api.exchange.coinbase.com/products');
      const symbols: ISymbolInfo[] = [];
      
      for (const product of response.data) {
        if (
          product.status === 'online' &&
          (product.quote_currency === 'USD' || product.quote_currency === 'USDT')
        ) {
          const symbol = product.quote_currency === 'USD' 
            ? `${product.base_currency}USDT` 
            : product.id.replace('-', '');
          
          symbols.push({
            symbol,
            baseAsset: product.base_currency,
            quoteAsset: 'USDT',
            status: 'TRADING',
            enabled: true,
            tickSize: parseFloat(product.quote_increment || '0.01'),
            stepSize: parseFloat(product.base_increment || '0.001'),
            minNotional: parseFloat(product.min_market_funds || '10'),
            sources: [FeedSource.COINBASE],
            lastUpdate: new Date(),
          });
        }
      }
      
      logger.info(`Fetched ${symbols.length} symbols from Coinbase`);
      return symbols;
    } catch (error) {
      logger.error('Error fetching Coinbase symbols', error);
      return [];
    }
  }
  
  /**
   * Fetch top coins from CoinGecko
   */
  private async fetchCoinGeckoTopCoins(): Promise<any[]> {
    try {
      const headers: any = {};
      if (config.exchanges.coingecko.apiKey) {
        headers['x-cg-demo-api-key'] = config.exchanges.coingecko.apiKey;
      }
      
      const response = await axios.get(
        'https://api.coingecko.com/api/v3/coins/markets',
        {
          params: {
            vs_currency: 'usd',
            order: 'market_cap_desc',
            per_page: 500,
            page: 1,
            sparkline: false,
          },
          headers,
        }
      );
      
      const marketData = response.data.map((coin: any) => ({
        symbol: coin.symbol.toUpperCase(),
        marketCap: coin.market_cap,
        rank: coin.market_cap_rank,
        volume24h: coin.total_volume,
        priceChangePercent24h: coin.price_change_percentage_24h,
      }));
      
      logger.info(`Fetched ${marketData.length} coins from CoinGecko`);
      return marketData;
    } catch (error) {
      logger.error('Error fetching CoinGecko data', error);
      return [];
    }
  }
  
  /**
   * Merge symbol data from multiple sources
   */
  private mergeSymbolData(
    binanceSymbols: ISymbolInfo[],
    coinbaseSymbols: ISymbolInfo[],
    coingeckoData: any[]
  ): ISymbolInfo[] {
    const symbolMap = new Map<string, ISymbolInfo>();
    
    // Start with Binance as primary source
    binanceSymbols.forEach(symbol => {
      symbolMap.set(symbol.symbol, symbol);
    });
    
    // Add Coinbase symbols
    coinbaseSymbols.forEach(symbol => {
      const existing = symbolMap.get(symbol.symbol);
      if (existing) {
        existing.sources.push(FeedSource.COINBASE);
      } else {
        symbolMap.set(symbol.symbol, symbol);
      }
    });
    
    // Enrich with CoinGecko data
    coingeckoData.forEach(coin => {
      const symbolWithUSDT = `${coin.symbol}USDT`;
      const existing = symbolMap.get(symbolWithUSDT);
      if (existing) {
        existing.rank = coin.rank;
        existing.marketCap = coin.marketCap;
      }
    });
    
    // Sort by market cap rank and limit
    const sortedSymbols = Array.from(symbolMap.values())
      .sort((a, b) => {
        if (a.rank && b.rank) return a.rank - b.rank;
        if (a.rank) return -1;
        if (b.rank) return 1;
        return 0;
      })
      .slice(0, this.maxSymbols);
    
    return sortedSymbols;
  }
  
  /**
   * Update markets in database
   */
  private async updateMarketsInDatabase(symbols: ISymbolInfo[]): Promise<void> {
    try {
      const bulkOps = symbols.map(symbol => ({
        updateOne: {
          filter: { symbol: symbol.symbol },
          update: {
            $set: {
              symbol: symbol.symbol,
              baseAsset: symbol.baseAsset,
              quoteAsset: symbol.quoteAsset,
              status: 'active',
              tickSize: toDecimal128(symbol.tickSize),
              stepSize: toDecimal128(symbol.stepSize),
              minNotional: toDecimal128(symbol.minNotional),
              rank: symbol.rank || 999,
              fees: {
                maker: toDecimal128(0.001),
                taker: toDecimal128(0.001),
              },
              allowedOrderTypes: ['LIMIT', 'MARKET', 'STOP', 'STOP_LIMIT'],
              marginTradingEnabled: true,
              maxLeverage: 20,
            },
            $setOnInsert: {
              createdAt: new Date(),
            },
          },
          upsert: true,
        },
      }));
      
      if (bulkOps.length > 0) {
        await Market.bulkWrite(bulkOps);
        logger.info(`Updated ${bulkOps.length} markets in database`);
      }
    } catch (error) {
      logger.error('Error updating markets in database', error);
    }
  }
  
  /**
   * Get all active symbols
   */
  getActiveSymbols(): ISymbolInfo[] {
    return Array.from(this.symbols.values()).filter(s => s.enabled);
  }
  
  /**
   * Get symbol info
   */
  getSymbol(symbol: string): ISymbolInfo | undefined {
    return this.symbols.get(symbol);
  }
  
  /**
   * Enable/disable symbol
   */
  async toggleSymbol(symbol: string, enabled: boolean): Promise<void> {
    const symbolInfo = this.symbols.get(symbol);
    if (symbolInfo) {
      symbolInfo.enabled = enabled;
      
      // Update in database
      await Market.updateOne(
        { symbol },
        { status: enabled ? 'active' : 'suspended' }
      );
      
      logger.info(`Symbol ${symbol} ${enabled ? 'enabled' : 'disabled'}`);
    }
  }
  
  /**
   * Get symbols for a specific source
   */
  getSymbolsForSource(source: FeedSource): string[] {
    return Array.from(this.symbols.values())
      .filter(s => s.enabled && s.sources.includes(source))
      .map(s => s.symbol);
  }
  
  /**
   * Get symbol mapping for different exchanges
   */
  getSymbolMapping(symbol: string, targetExchange: FeedSource): string | null {
    const symbolInfo = this.symbols.get(symbol);
    if (!symbolInfo) return null;
    
    switch (targetExchange) {
      case FeedSource.COINBASE:
        // Coinbase uses - separator
        return `${symbolInfo.baseAsset}-${symbolInfo.quoteAsset === 'USDT' ? 'USD' : symbolInfo.quoteAsset}`;
      
      case FeedSource.KRAKEN:
        // Kraken uses different format
        return `${symbolInfo.baseAsset}/${symbolInfo.quoteAsset}`;
      
      default:
        return symbol;
    }
  }
}

export default SymbolDiscoveryService.getInstance();