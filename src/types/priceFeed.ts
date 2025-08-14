import { Types } from 'mongoose';

export enum FeedSource {
  BINANCE = 'binance',
  COINBASE = 'coinbase',
  KRAKEN = 'kraken',
  COINGECKO = 'coingecko',
  SIMULATED = 'simulated',
}

export enum FeedStatus {
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  ERROR = 'error',
  DEGRADED = 'degraded',
}

export enum MarkPriceType {
  LAST = 'last',
  MID = 'mid',
  EMA = 'ema',
  VWAP = 'vwap',
}

export interface IPriceTick {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  bidSize?: number;
  askSize?: number;
  volume24h?: number;
  quoteVolume24h?: number;
  timestamp: Date;
  source: FeedSource;
  sequence?: number;
}

export interface ISymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: 'TRADING' | 'SUSPENDED' | 'DELISTED';
  enabled: boolean;
  rank?: number;
  marketCap?: number;
  tickSize: number;
  stepSize: number;
  minNotional: number;
  sources: FeedSource[];
  lastUpdate: Date;
}

export interface IFeedHealth {
  source: FeedSource;
  status: FeedStatus;
  connected: boolean;
  lastHeartbeat: Date;
  lastDataReceived: Date;
  messagesPerSecond: number;
  averageLatency: number;
  errorCount: number;
  reconnectCount: number;
  uptime: number;
  dataQuality: number; // 0-100
}

export interface ICandle {
  symbol: string;
  interval: string;
  openTime: Date;
  closeTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  trades: number;
  isFinal: boolean;
}

export interface IPriceUpdate {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  spread: number;
  spreadPercent: number;
  markPrice: number;
  indexPrice?: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  change24h: number;
  changePercent24h: number;
  lastUpdate: Date;
  source: FeedSource;
}

export interface IFeedConfig {
  binance: {
    enabled: boolean;
    wsUrl: string;
    restUrl: string;
    apiKey?: string;
    apiSecret?: string;
    streams: string[];
    reconnectInterval: number;
    maxReconnectAttempts: number;
  };
  coinbase: {
    enabled: boolean;
    wsUrl: string;
    restUrl: string;
    apiKey?: string;
    apiSecret?: string;
    channels: string[];
    reconnectInterval: number;
  };
  kraken: {
    enabled: boolean;
    wsUrl: string;
    restUrl: string;
    apiKey?: string;
    reconnectInterval: number;
  };
  coingecko: {
    enabled: boolean;
    apiUrl: string;
    apiKey?: string;
    rateLimit: number;
    cacheTTL: number;
  };
  simulated: {
    enabled: boolean;
    volatility: number;
    trendStrength: number;
    supportLevels: number[];
    resistanceLevels: number[];
    updateInterval: number;
  };
  general: {
    symbolLimit: number;
    tickBufferSize: number;
    candleIntervals: string[];
    outlierThreshold: number;
    aggregationWindow: number;
    broadcastThrottle: number;
    markPriceType: MarkPriceType;
  };
}

export interface IWebSocketMessage {
  type: 'subscribe' | 'unsubscribe' | 'price' | 'error' | 'heartbeat';
  channel?: string;
  symbols?: string[];
  data?: any;
  timestamp: Date;
}

export interface IPriceSubscription {
  clientId: string;
  symbols: string[];
  channels: string[];
  throttleMs: number;
  lastSent: Date;
}

export interface IAdminPriceControl {
  symbol: string;
  enabled: boolean;
  forcedPrice?: number;
  forcedSource?: FeedSource;
  spreadMultiplier: number;
  volatilityMultiplier: number;
  trendBias: number; // -1 to 1
  scenario?: 'pump' | 'dump' | 'flash_crash' | 'circuit_breaker';
  scenarioParams?: any;
}