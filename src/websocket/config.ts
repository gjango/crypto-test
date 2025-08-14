import { RedisOptions } from 'ioredis';

export interface WebSocketConfig {
  cors: {
    origin: string | string[];
    credentials: boolean;
  };
  pingTimeout: number;
  pingInterval: number;
  maxHttpBufferSize: number;
  transports: string[];
  path: string;
  serveClient: boolean;
  connectionStateRecovery: {
    maxDisconnectionDuration: number;
    skipMiddlewares: boolean;
  };
}

export interface RateLimitConfig {
  points: number;
  duration: number;
  blockDuration: number;
}

export interface SubscriptionLimits {
  maxSymbolsPerConnection: number;
  maxRoomsPerConnection: number;
  maxEventsPerSecond: number;
}

export const WEBSOCKET_CONFIG: WebSocketConfig = {
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3001'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6, // 1MB
  transports: ['websocket', 'polling'],
  path: '/socket.io/',
  serveClient: false,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true,
  },
};

export const REDIS_CONFIG: RedisOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
};

export const RATE_LIMIT_CONFIG: RateLimitConfig = {
  points: 100, // Number of points
  duration: 1, // Per second
  blockDuration: 60, // Block for 60 seconds if exceeded
};

export const SUBSCRIPTION_LIMITS: SubscriptionLimits = {
  maxSymbolsPerConnection: 50,
  maxRoomsPerConnection: 100,
  maxEventsPerSecond: 100,
};

export const NAMESPACES = {
  PRICES: '/prices',
  USER: '/user',
  ADMIN: '/admin',
  MARKET: '/market',
} as const;

export const EVENTS = {
  // Price Events
  PRICE_UPDATE: 'price.update',
  PRICE_TRADE: 'price.trade',
  CANDLE_UPDATE: 'candle.update',
  
  // User Events
  ORDER_NEW: 'order.new',
  ORDER_UPDATE: 'order.update',
  ORDER_FILLED: 'order.filled',
  ORDER_CANCELLED: 'order.cancelled',
  POSITION_UPDATE: 'position.update',
  POSITION_LIQUIDATED: 'position.liquidated',
  WALLET_UPDATE: 'wallet.update',
  MARGIN_CALL: 'margin.call',
  
  // Market Events
  MARKET_STATS: 'market.stats',
  MARKET_DEPTH: 'market.depth',
  MARKET_TRADES: 'market.trades',
  
  // System Events
  SYSTEM_MAINTENANCE: 'system.maintenance',
  SYSTEM_MESSAGE: 'system.message',
  CONNECTION_AUTHENTICATED: 'connection.authenticated',
  SUBSCRIPTION_CONFIRMED: 'subscription.confirmed',
  SUBSCRIPTION_ERROR: 'subscription.error',
  
  // Client Events
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  PING: 'ping',
  PONG: 'pong',
} as const;

export const ROOMS = {
  // Price rooms
  priceRoom: (symbol: string) => `prices:${symbol}`,
  candleRoom: (symbol: string, interval: string) => `candles:${symbol}:${interval}`,
  
  // User rooms
  userRoom: (userId: string) => `user:${userId}`,
  ordersRoom: (userId: string) => `orders:${userId}`,
  positionsRoom: (userId: string) => `positions:${userId}`,
  walletRoom: (userId: string) => `wallet:${userId}`,
  
  // Market rooms
  marketStatsRoom: (symbol: string) => `market:stats:${symbol}`,
  marketDepthRoom: (symbol: string) => `market:depth:${symbol}`,
  marketTradesRoom: (symbol: string) => `market:trades:${symbol}`,
  
  // Admin rooms
  adminMonitoringRoom: () => 'admin:monitoring',
  adminAlertsRoom: () => 'admin:alerts',
  adminMetricsRoom: () => 'admin:metrics',
} as const;