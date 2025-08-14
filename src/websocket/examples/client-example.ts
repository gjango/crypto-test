import { TradingClient } from '../client/TradingClient';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ClientExample');

/**
 * Example WebSocket client implementation
 * Demonstrates how to use the TradingClient SDK
 */
async function runExample() {
  // Initialize client with options
  const client = new TradingClient({
    url: 'http://localhost:3000',
    token: 'your-jwt-token-here', // Replace with actual JWT token
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  // Setup event listeners
  setupEventListeners(client);

  try {
    // Connect to server
    logger.info('Connecting to WebSocket server...');
    await client.connect();

    // Test 1: Subscribe to price updates
    logger.info('Subscribing to price updates...');
    await client.subscribePrices(['BTC/USDT', 'ETH/USDT', 'BNB/USDT']);

    // Test 2: Subscribe to market data
    logger.info('Subscribing to market data...');
    await client.subscribeMarket(
      ['BTC/USDT', 'ETH/USDT'],
      ['depth', 'trades', 'ticker']
    );

    // Test 3: Subscribe to user streams (if authenticated)
    if (client.isConnected()) {
      logger.info('Subscribing to user streams...');
      await client.subscribeUserStreams(['orders', 'positions', 'wallet']);
    }

    // Test 4: Ping server to check latency
    const latency = await client.ping();
    logger.info(`Server latency: ${latency}ms`);

    // Keep connection alive for testing
    logger.info('Client connected and subscribed. Press Ctrl+C to exit.');

    // Send periodic pings
    setInterval(async () => {
      try {
        const ping = await client.ping();
        logger.debug(`Ping: ${ping}ms`);
      } catch (error) {
        logger.error('Ping failed:', error);
      }
    }, 30000);

  } catch (error) {
    logger.error('Connection failed:', error);
    process.exit(1);
  }
}

/**
 * Setup event listeners for the client
 */
function setupEventListeners(client: TradingClient): void {
  // Connection events
  client.on('connected', () => {
    logger.info('✅ Connected to WebSocket server');
  });

  client.on('disconnected', () => {
    logger.warn('❌ Disconnected from WebSocket server');
  });

  client.on('error', (error) => {
    logger.error('WebSocket error:', error);
  });

  // Price events
  client.on('price:BTC/USDT', (data) => {
    logger.info('BTC/USDT Price Update:', {
      price: data.price,
      change24h: data.changePercent24h,
      volume: data.volume,
    });
  });

  client.on('price:ETH/USDT', (data) => {
    logger.info('ETH/USDT Price Update:', {
      price: data.price,
      change24h: data.changePercent24h,
      volume: data.volume,
    });
  });

  // Market events
  client.on('market:depth:BTC/USDT', (data) => {
    logger.debug('BTC/USDT Depth Update:', {
      bestBid: data.bids[0],
      bestAsk: data.asks[0],
    });
  });

  client.on('market:trades:BTC/USDT', (trades) => {
    logger.debug('BTC/USDT Recent Trades:', trades.slice(0, 3));
  });

  client.on('market:stats:BTC/USDT', (stats) => {
    logger.info('BTC/USDT Market Stats:', stats);
  });

  // User events (if authenticated)
  client.on('order:new', (order) => {
    logger.info('New Order:', order);
  });

  client.on('order:update', (order) => {
    logger.info('Order Update:', order);
  });

  client.on('order:filled', (order) => {
    logger.info('Order Filled:', order);
  });

  client.on('order:cancelled', (order) => {
    logger.info('Order Cancelled:', order);
  });

  client.on('position:update', (position) => {
    logger.info('Position Update:', position);
  });

  client.on('position:liquidated', (liquidation) => {
    logger.warn('Position Liquidated:', liquidation);
  });

  client.on('wallet:update', (wallet) => {
    logger.info('Wallet Update:', wallet);
  });

  client.on('margin:call', (marginCall) => {
    logger.warn('⚠️ Margin Call:', marginCall);
  });

  // Namespace-specific events
  client.on('prices:connected', (socketId) => {
    logger.debug(`Prices namespace connected: ${socketId}`);
  });

  client.on('user:connected', (socketId) => {
    logger.debug(`User namespace connected: ${socketId}`);
  });

  client.on('market:connected', (socketId) => {
    logger.debug(`Market namespace connected: ${socketId}`);
  });

  client.on('admin:connected', (socketId) => {
    logger.debug(`Admin namespace connected: ${socketId}`);
  });
}

/**
 * Handle graceful shutdown
 */
process.on('SIGINT', () => {
  logger.info('Shutting down client...');
  process.exit(0);
});

// Run the example
runExample().catch((error) => {
  logger.error('Example failed:', error);
  process.exit(1);
});