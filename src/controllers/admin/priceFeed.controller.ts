import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../../utils/logger';
import feedManagerService from '../../services/feedManager.service';
import binanceFeedService from '../../services/feeds/binanceFeed.service';
import coinbaseFeedService from '../../services/feeds/coinbaseFeed.service';
import krakenFeedService from '../../services/feeds/krakenFeed.service';
import coingeckoFeedService from '../../services/feeds/coingeckoFeed.service';
import simulatedFeedService from '../../services/feeds/simulatedFeed.service';
import symbolDiscoveryService from '../../services/symbolDiscovery.service';
import { FeedSource, IAdminPriceControl } from '../../types/priceFeed';
import { authenticateToken, authorize } from '../../middleware/auth';

const logger = createLogger('AdminPriceFeedController');

/**
 * Get feed status and health
 */
export const getFeedStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const statistics = feedManagerService.getStatistics();
    const health = {
      binance: binanceFeedService.getHealth(),
      coinbase: coinbaseFeedService.getHealth(),
      kraken: krakenFeedService.getHealth(),
      coingecko: coingeckoFeedService.getHealth(),
      simulated: simulatedFeedService.getHealth(),
    };
    
    res.json({
      success: true,
      data: {
        statistics,
        health,
        activeSymbols: symbolDiscoveryService.getActiveSymbols().length,
        currentPrices: feedManagerService.getAllPrices().length,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get current prices for all symbols
 */
export const getAllPrices = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const prices = feedManagerService.getAllPrices();
    
    res.json({
      success: true,
      data: prices,
      count: prices.length,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get price for specific symbol
 */
export const getSymbolPrice = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { symbol } = req.params;
    const price = feedManagerService.getCurrentPrice(symbol);
    
    if (!price) {
      res.status(404).json({
        success: false,
        message: `Price not found for symbol ${symbol}`,
      });
      return;
    }
    
    res.json({
      success: true,
      data: price,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Force switch to specific feed source
 */
export const switchFeedSource = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { source } = req.body;
    
    if (!Object.values(FeedSource).includes(source)) {
      res.status(400).json({
        success: false,
        message: 'Invalid feed source',
      });
      return;
    }
    
    feedManagerService.forceSwitchFeed(source);
    
    logger.info(`Admin forced switch to feed source: ${source}`);
    
    res.json({
      success: true,
      message: `Switched to ${source} feed`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Reconnect specific feed
 */
export const reconnectFeed = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { source } = req.params;
    
    switch (source) {
      case FeedSource.BINANCE:
        await binanceFeedService.reconnect();
        break;
      case FeedSource.COINBASE:
        await coinbaseFeedService.reconnect();
        break;
      case FeedSource.KRAKEN:
        await krakenFeedService.reconnect();
        break;
      case FeedSource.COINGECKO:
        await coingeckoFeedService.initialize();
        break;
      default:
        res.status(400).json({
          success: false,
          message: 'Invalid feed source',
        });
        return;
    }
    
    logger.info(`Admin reconnected feed: ${source}`);
    
    res.json({
      success: true,
      message: `Reconnected ${source} feed`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Set simulated feed volatility
 */
export const setSimulatedVolatility = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { volatility } = req.body;
    
    if (typeof volatility !== 'number' || volatility < 0 || volatility > 0.1) {
      res.status(400).json({
        success: false,
        message: 'Invalid volatility value (must be between 0 and 0.1)',
      });
      return;
    }
    
    simulatedFeedService.setVolatility(volatility);
    
    logger.info(`Admin set simulated volatility to ${volatility}`);
    
    res.json({
      success: true,
      message: `Set volatility to ${volatility}`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Trigger price scenario for testing
 */
export const triggerPriceScenario = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { symbol, scenario } = req.body;
    const validScenarios = ['pump', 'dump', 'flash_crash', 'recovery'];
    
    if (!validScenarios.includes(scenario)) {
      res.status(400).json({
        success: false,
        message: 'Invalid scenario',
        validScenarios,
      });
      return;
    }
    
    simulatedFeedService.triggerScenario(symbol, scenario);
    
    logger.warn(`Admin triggered ${scenario} scenario for ${symbol}`);
    
    res.json({
      success: true,
      message: `Triggered ${scenario} for ${symbol}`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Force price for specific symbol
 */
export const forceSymbolPrice = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { symbol } = req.params;
    const { price } = req.body;
    
    if (typeof price !== 'number' || price <= 0) {
      res.status(400).json({
        success: false,
        message: 'Invalid price value',
      });
      return;
    }
    
    simulatedFeedService.forcePrice(symbol, price);
    
    logger.warn(`Admin forced price for ${symbol} to ${price}`);
    
    res.json({
      success: true,
      message: `Forced ${symbol} price to ${price}`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Set symbol trend for simulated feed
 */
export const setSymbolTrend = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { symbol } = req.params;
    const { trend } = req.body;
    
    if (typeof trend !== 'number' || trend < -1 || trend > 1) {
      res.status(400).json({
        success: false,
        message: 'Invalid trend value (must be between -1 and 1)',
      });
      return;
    }
    
    simulatedFeedService.setSymbolTrend(symbol, trend);
    
    logger.info(`Admin set trend for ${symbol} to ${trend}`);
    
    res.json({
      success: true,
      message: `Set ${symbol} trend to ${trend}`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Refresh symbol discovery
 */
export const refreshSymbols = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    await symbolDiscoveryService.refreshSymbols();
    const activeSymbols = symbolDiscoveryService.getActiveSymbols();
    
    logger.info('Admin refreshed symbol discovery');
    
    res.json({
      success: true,
      message: 'Symbol discovery refreshed',
      activeSymbols: activeSymbols.length,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Enable/disable symbol
 */
export const toggleSymbol = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { symbol } = req.params;
    const { enabled } = req.body;
    
    await symbolDiscoveryService.toggleSymbol(symbol, enabled);
    
    logger.info(`Admin ${enabled ? 'enabled' : 'disabled'} symbol ${symbol}`);
    
    res.json({
      success: true,
      message: `Symbol ${symbol} ${enabled ? 'enabled' : 'disabled'}`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Subscribe to additional symbols
 */
export const subscribeToSymbols = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { symbols, source } = req.body;
    
    if (!Array.isArray(symbols)) {
      res.status(400).json({
        success: false,
        message: 'Symbols must be an array',
      });
      return;
    }
    
    switch (source) {
      case FeedSource.BINANCE:
        await binanceFeedService.subscribe(symbols);
        break;
      case FeedSource.COINBASE:
        await coinbaseFeedService.subscribe(symbols);
        break;
      case FeedSource.KRAKEN:
        await krakenFeedService.subscribe(symbols);
        break;
      default:
        res.status(400).json({
          success: false,
          message: 'Invalid feed source for subscription',
        });
        return;
    }
    
    logger.info(`Admin subscribed to ${symbols.length} symbols on ${source}`);
    
    res.json({
      success: true,
      message: `Subscribed to ${symbols.length} symbols on ${source}`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Unsubscribe from symbols
 */
export const unsubscribeFromSymbols = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { symbols, source } = req.body;
    
    if (!Array.isArray(symbols)) {
      res.status(400).json({
        success: false,
        message: 'Symbols must be an array',
      });
      return;
    }
    
    switch (source) {
      case FeedSource.BINANCE:
        binanceFeedService.unsubscribe(symbols);
        break;
      case FeedSource.COINBASE:
        coinbaseFeedService.unsubscribe(symbols);
        break;
      case FeedSource.KRAKEN:
        krakenFeedService.unsubscribe(symbols);
        break;
      default:
        res.status(400).json({
          success: false,
          message: 'Invalid feed source for unsubscription',
        });
        return;
    }
    
    logger.info(`Admin unsubscribed from ${symbols.length} symbols on ${source}`);
    
    res.json({
      success: true,
      message: `Unsubscribed from ${symbols.length} symbols on ${source}`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get recent ticks for a symbol
 */
export const getRecentTicks = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { symbol } = req.params;
    const { source, limit = 100 } = req.query;
    
    let ticks = [];
    
    switch (source) {
      case FeedSource.BINANCE:
        ticks = binanceFeedService.getRecentTicks(symbol, Number(limit));
        break;
      case FeedSource.COINBASE:
        ticks = coinbaseFeedService.getRecentTicks(symbol, Number(limit));
        break;
      case FeedSource.KRAKEN:
        ticks = krakenFeedService.getRecentTicks(symbol, Number(limit));
        break;
      default:
        // Get from all sources if not specified
        ticks = [
          ...binanceFeedService.getRecentTicks(symbol, Number(limit)),
          ...coinbaseFeedService.getRecentTicks(symbol, Number(limit)),
          ...krakenFeedService.getRecentTicks(symbol, Number(limit)),
        ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
         .slice(0, Number(limit));
    }
    
    res.json({
      success: true,
      data: ticks,
      count: ticks.length,
    });
  } catch (error) {
    next(error);
  }
};