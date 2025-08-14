export enum UserRole {
  USER = 'USER',
  TRADER = 'TRADER',
  VIP = 'VIP',
  MARKET_MAKER = 'MARKET_MAKER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

export enum KYCStatus {
  NOT_STARTED = 'NOT_STARTED',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum WalletType {
  SPOT = 'spot',
  MARGIN = 'margin',
  FUNDING = 'funding',
}

export enum MarketStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  DELISTED = 'delisted',
}

export enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  STOP = 'STOP',
  STOP_LIMIT = 'STOP_LIMIT',
  TAKE_PROFIT = 'TAKE_PROFIT',
  TRAILING_STOP = 'TRAILING_STOP',
  OCO = 'OCO',
}

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum TimeInForce {
  GTC = 'GTC', // Good Till Cancel
  IOC = 'IOC', // Immediate Or Cancel
  FOK = 'FOK', // Fill Or Kill
}

export enum OrderStatus {
  NEW = 'NEW',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  CANCELED = 'CANCELED',
  EXPIRED = 'EXPIRED',
  REJECTED = 'REJECTED',
}

export enum PositionSide {
  LONG = 'LONG',
  SHORT = 'SHORT',
}

export enum MarginMode {
  CROSS = 'cross',
  ISOLATED = 'isolated',
}

export enum PriceSource {
  BINANCE = 'binance',
  COINBASE = 'coinbase',
  KRAKEN = 'kraken',
  SIMULATED = 'simulated',
}

export enum CandleInterval {
  ONE_MINUTE = '1m',
  FIVE_MINUTES = '5m',
  FIFTEEN_MINUTES = '15m',
  ONE_HOUR = '1h',
  FOUR_HOURS = '4h',
  ONE_DAY = '1d',
  ONE_WEEK = '1w',
  ONE_MONTH = '1M',
}