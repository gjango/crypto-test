import dotenv from 'dotenv';
import joi from 'joi';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const envVarsSchema = joi
  .object({
    NODE_ENV: joi.string().valid('development', 'staging', 'production').default('development'),
    PORT: joi.number().default(3000),
    HOST: joi.string().default('localhost'),

    MONGODB_URI: joi.string().required().description('MongoDB connection string'),
    MONGODB_MAX_POOL_SIZE: joi.number().default(10),
    MONGODB_MIN_POOL_SIZE: joi.number().default(2),
    MONGODB_CONNECT_TIMEOUT_MS: joi.number().default(10000),
    MONGODB_SERVER_SELECTION_TIMEOUT_MS: joi.number().default(5000),

    JWT_PRIVATE_KEY: joi.string().required().description('JWT RS256 private key'),
    JWT_PUBLIC_KEY: joi.string().required().description('JWT RS256 public key'),
    JWT_ACCESS_TOKEN_EXPIRY: joi.string().default('15m'),
    JWT_REFRESH_TOKEN_EXPIRY: joi.string().default('7d'),

    REDIS_URL: joi.string().optional(),
    REDIS_PASSWORD: joi.string().optional().allow(''),
    REDIS_DB: joi.number().default(0),

    CORS_ORIGIN: joi.string().default('http://localhost:3001'),
    SESSION_SECRET: joi.string().min(32).required(),
    BCRYPT_SALT_ROUNDS: joi.number().default(10),

    RATE_LIMIT_WINDOW_MS: joi.number().default(900000),
    RATE_LIMIT_MAX: joi.number().default(100),
    RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS: joi.boolean().default(false),

    LOG_LEVEL: joi.string().valid('debug', 'info', 'warn', 'error').default('info'),
    LOG_DIR: joi.string().default('logs'),
    LOG_MAX_SIZE: joi.string().default('20m'),
    LOG_MAX_FILES: joi.string().default('14d'),

    STRICT_VALIDATION: joi.boolean().default(true),

    BINANCE_WS_URL: joi.string().default('wss://stream.binance.com:9443/ws'),
    BINANCE_REST_URL: joi.string().default('https://api.binance.com'),
    COINBASE_WS_URL: joi.string().default('wss://ws-feed.exchange.coinbase.com'),
    COINBASE_REST_URL: joi.string().default('https://api.exchange.coinbase.com'),
    KRAKEN_WS_URL: joi.string().default('wss://ws.kraken.com'),
    KRAKEN_REST_URL: joi.string().default('https://api.kraken.com'),
    COINGECKO_API_URL: joi.string().default('https://api.coingecko.com/api/v3'),

    BINANCE_API_KEY: joi.string().optional().allow(''),
    BINANCE_API_SECRET: joi.string().optional().allow(''),
    COINBASE_API_KEY: joi.string().optional().allow(''),
    COINBASE_API_SECRET: joi.string().optional().allow(''),
    COINBASE_PASSPHRASE: joi.string().optional().allow(''),
    KRAKEN_API_KEY: joi.string().optional().allow(''),
    KRAKEN_API_SECRET: joi.string().optional().allow(''),
    COINGECKO_API_KEY: joi.string().optional().allow(''),

    MAX_LEVERAGE: joi.number().default(20),
    INITIAL_MARGIN_RATE: joi.number().default(0.05),
    MAINTENANCE_MARGIN_RATE: joi.number().default(0.025),
    LIQUIDATION_FEE: joi.number().default(0.002),
    MAKER_FEE: joi.number().default(0.0002),
    TAKER_FEE: joi.number().default(0.0004),

    MAX_OPEN_ORDERS_PER_USER: joi.number().default(100),
    MAX_POSITIONS_PER_USER: joi.number().default(50),
    MIN_ORDER_SIZE_USDT: joi.number().default(10),
    MAX_ORDER_SIZE_USDT: joi.number().default(100000),

    WS_HEARTBEAT_INTERVAL_MS: joi.number().default(30000),
    WS_RECONNECT_INTERVAL_MS: joi.number().default(5000),
    WS_MAX_RECONNECT_ATTEMPTS: joi.number().default(5),

    ENABLE_CACHE: joi.boolean().default(true),
    CACHE_TTL_SECONDS: joi.number().default(60),
    BATCH_PROCESSING_SIZE: joi.number().default(100),
    PRICE_UPDATE_INTERVAL_MS: joi.number().default(1000),

    ENABLE_METRICS: joi.boolean().default(true),
    METRICS_PORT: joi.number().default(9090),
    HEALTH_CHECK_INTERVAL_MS: joi.number().default(30000),
  })
  .unknown();

const { value: envVars, error } = envVarsSchema
  .prefs({ errors: { label: 'key' } })
  .validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

export const config = {
  env: envVars.NODE_ENV as 'development' | 'staging' | 'production' | 'test',
  port: envVars.PORT as number,
  host: envVars.HOST as string,

  mongodb: {
    uri: envVars.MONGODB_URI as string,
    options: {
      maxPoolSize: envVars.MONGODB_MAX_POOL_SIZE as number,
      minPoolSize: envVars.MONGODB_MIN_POOL_SIZE as number,
      connectTimeoutMS: envVars.MONGODB_CONNECT_TIMEOUT_MS as number,
      serverSelectionTimeoutMS: envVars.MONGODB_SERVER_SELECTION_TIMEOUT_MS as number,
    },
  },

  jwt: {
    privateKey: envVars.JWT_PRIVATE_KEY as string,
    publicKey: envVars.JWT_PUBLIC_KEY as string,
    accessTokenExpiry: envVars.JWT_ACCESS_TOKEN_EXPIRY as string,
    refreshTokenExpiry: envVars.JWT_REFRESH_TOKEN_EXPIRY as string,
  },

  redis: {
    url: envVars.REDIS_URL as string | undefined,
    password: envVars.REDIS_PASSWORD as string | undefined,
    db: envVars.REDIS_DB as number,
  },

  security: {
    corsOrigin: envVars.CORS_ORIGIN as string,
    sessionSecret: envVars.SESSION_SECRET as string,
    bcryptSaltRounds: envVars.BCRYPT_SALT_ROUNDS as number,
  },

  rateLimit: {
    windowMs: envVars.RATE_LIMIT_WINDOW_MS as number,
    max: envVars.RATE_LIMIT_MAX as number,
    skipSuccessfulRequests: envVars.RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS as boolean,
  },

  logging: {
    level: envVars.LOG_LEVEL as string,
    dir: envVars.LOG_DIR as string,
    maxSize: envVars.LOG_MAX_SIZE as string,
    maxFiles: envVars.LOG_MAX_FILES as string,
  },

  validation: {
    strict: envVars.STRICT_VALIDATION as boolean,
  },

  exchanges: {
    binance: {
      wsUrl: envVars.BINANCE_WS_URL as string,
      restUrl: envVars.BINANCE_REST_URL as string,
      apiKey: envVars.BINANCE_API_KEY as string | undefined,
      apiSecret: envVars.BINANCE_API_SECRET as string | undefined,
    },
    coinbase: {
      wsUrl: envVars.COINBASE_WS_URL as string,
      restUrl: envVars.COINBASE_REST_URL as string,
      apiKey: envVars.COINBASE_API_KEY as string | undefined,
      apiSecret: envVars.COINBASE_API_SECRET as string | undefined,
      passphrase: envVars.COINBASE_PASSPHRASE as string | undefined,
    },
    kraken: {
      wsUrl: envVars.KRAKEN_WS_URL as string,
      restUrl: envVars.KRAKEN_REST_URL as string,
      apiKey: envVars.KRAKEN_API_KEY as string | undefined,
      apiSecret: envVars.KRAKEN_API_SECRET as string | undefined,
    },
    coingecko: {
      apiUrl: envVars.COINGECKO_API_URL as string,
      apiKey: envVars.COINGECKO_API_KEY as string | undefined,
    },
  },

  trading: {
    maxLeverage: envVars.MAX_LEVERAGE as number,
    initialMarginRate: envVars.INITIAL_MARGIN_RATE as number,
    maintenanceMarginRate: envVars.MAINTENANCE_MARGIN_RATE as number,
    liquidationFee: envVars.LIQUIDATION_FEE as number,
    fees: {
      maker: envVars.MAKER_FEE as number,
      taker: envVars.TAKER_FEE as number,
    },
    limits: {
      maxOpenOrdersPerUser: envVars.MAX_OPEN_ORDERS_PER_USER as number,
      maxPositionsPerUser: envVars.MAX_POSITIONS_PER_USER as number,
      minOrderSizeUsdt: envVars.MIN_ORDER_SIZE_USDT as number,
      maxOrderSizeUsdt: envVars.MAX_ORDER_SIZE_USDT as number,
    },
  },

  websocket: {
    heartbeatInterval: envVars.WS_HEARTBEAT_INTERVAL_MS as number,
    reconnectInterval: envVars.WS_RECONNECT_INTERVAL_MS as number,
    maxReconnectAttempts: envVars.WS_MAX_RECONNECT_ATTEMPTS as number,
  },

  performance: {
    enableCache: envVars.ENABLE_CACHE as boolean,
    cacheTTL: envVars.CACHE_TTL_SECONDS as number,
    batchProcessingSize: envVars.BATCH_PROCESSING_SIZE as number,
    priceUpdateInterval: envVars.PRICE_UPDATE_INTERVAL_MS as number,
  },

  monitoring: {
    enableMetrics: envVars.ENABLE_METRICS as boolean,
    metricsPort: envVars.METRICS_PORT as number,
    healthCheckInterval: envVars.HEALTH_CHECK_INTERVAL_MS as number,
  },
};
