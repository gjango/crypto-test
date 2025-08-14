import { Types } from 'mongoose';

export enum AdminAction {
  // Market Management
  CREATE_MARKET = 'CREATE_MARKET',
  UPDATE_MARKET = 'UPDATE_MARKET',
  DELETE_MARKET = 'DELETE_MARKET',
  TOGGLE_MARKET = 'TOGGLE_MARKET',
  
  // Risk Control
  UPDATE_RISK_PARAMS = 'UPDATE_RISK_PARAMS',
  UPDATE_LEVERAGE_TIERS = 'UPDATE_LEVERAGE_TIERS',
  SET_POSITION_LIMITS = 'SET_POSITION_LIMITS',
  CONFIGURE_CIRCUIT_BREAKER = 'CONFIGURE_CIRCUIT_BREAKER',
  
  // Engine Control
  PAUSE_TRADING = 'PAUSE_TRADING',
  RESUME_TRADING = 'RESUME_TRADING',
  CANCEL_ALL_ORDERS = 'CANCEL_ALL_ORDERS',
  FORCE_SETTLEMENT = 'FORCE_SETTLEMENT',
  SET_MAINTENANCE_MODE = 'SET_MAINTENANCE_MODE',
  
  // Price Management
  INJECT_PRICE = 'INJECT_PRICE',
  SELECT_FEED_SOURCE = 'SELECT_FEED_SOURCE',
  ADJUST_SPREAD = 'ADJUST_SPREAD',
  SET_VOLATILITY = 'SET_VOLATILITY',
  EXECUTE_SCENARIO = 'EXECUTE_SCENARIO',
  
  // User Management
  ADJUST_BALANCE = 'ADJUST_BALANCE',
  MODIFY_POSITION = 'MODIFY_POSITION',
  CANCEL_USER_ORDER = 'CANCEL_USER_ORDER',
  FORCE_LIQUIDATION = 'FORCE_LIQUIDATION',
  SUSPEND_ACCOUNT = 'SUSPEND_ACCOUNT',
  UPDATE_USER_ROLE = 'UPDATE_USER_ROLE',
  
  // Configuration
  SAVE_CONFIG = 'SAVE_CONFIG',
  ACTIVATE_CONFIG = 'ACTIVATE_CONFIG',
  ROLLBACK_CONFIG = 'ROLLBACK_CONFIG',
  IMPORT_CONFIG = 'IMPORT_CONFIG',
  EXPORT_CONFIG = 'EXPORT_CONFIG',
}

export enum AdminPermission {
  // Market permissions
  MANAGE_MARKETS = 'MANAGE_MARKETS',
  VIEW_MARKETS = 'VIEW_MARKETS',
  
  // Risk permissions
  MANAGE_RISK = 'MANAGE_RISK',
  VIEW_RISK = 'VIEW_RISK',
  
  // Engine permissions
  CONTROL_ENGINE = 'CONTROL_ENGINE',
  VIEW_ENGINE_STATUS = 'VIEW_ENGINE_STATUS',
  
  // Price permissions
  MANAGE_PRICES = 'MANAGE_PRICES',
  VIEW_PRICES = 'VIEW_PRICES',
  
  // User permissions
  MANAGE_USERS = 'MANAGE_USERS',
  VIEW_USERS = 'VIEW_USERS',
  ADJUST_BALANCES = 'ADJUST_BALANCES',
  FORCE_ACTIONS = 'FORCE_ACTIONS',
  
  // Config permissions
  MANAGE_CONFIGS = 'MANAGE_CONFIGS',
  VIEW_CONFIGS = 'VIEW_CONFIGS',
  
  // Scenario permissions
  RUN_SCENARIOS = 'RUN_SCENARIOS',
  VIEW_SCENARIOS = 'VIEW_SCENARIOS',
  
  // Audit permissions
  VIEW_AUDIT_LOGS = 'VIEW_AUDIT_LOGS',
  EXPORT_AUDIT_LOGS = 'EXPORT_AUDIT_LOGS',
}

export interface IAdminAuditLog {
  _id?: Types.ObjectId;
  actionId: string;
  action: AdminAction;
  adminId: string;
  adminEmail: string;
  targetType: 'USER' | 'MARKET' | 'SYSTEM' | 'CONFIG' | 'ORDER' | 'POSITION';
  targetId?: string;
  before?: any;
  after?: any;
  changes?: any;
  reason?: string;
  reversible: boolean;
  reversed?: boolean;
  reversedBy?: string;
  reversedAt?: Date;
  ipAddress: string;
  userAgent: string;
  sessionId: string;
  timestamp: Date;
  metadata?: any;
}

export interface IMarketConfig {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: 'active' | 'suspended' | 'maintenance' | 'delisted';
  tickSize: number;
  stepSize: number;
  minNotional: number;
  maxNotional: number;
  fees: {
    maker: number;
    taker: number;
  };
  allowedOrderTypes: string[];
  timeInForceOptions: string[];
  marginTradingEnabled: boolean;
  maxLeverage: number;
  leverageTiers?: any[];
  spread?: {
    min: number;
    max: number;
    default: number;
  };
  slippage?: {
    min: number;
    max: number;
    default: number;
  };
  tradingHours?: {
    enabled: boolean;
    schedule: Array<{
      day: number;
      open: string;
      close: string;
    }>;
  };
  maintenanceWindows?: Array<{
    start: Date;
    end: Date;
    reason: string;
  }>;
}

export interface IEngineConfig {
  status: 'running' | 'paused' | 'maintenance';
  globalTradingEnabled: boolean;
  matchingEngineParams: {
    tickRate: number;
    batchSize: number;
    maxOrdersPerTick: number;
    priorityQueue: boolean;
  };
  orderLimits: {
    maxOpenOrdersPerUser: number;
    maxOrdersPerMinute: number;
    maxOrderValue: number;
  };
  performanceParams: {
    cacheEnabled: boolean;
    cacheTTL: number;
    asyncProcessing: boolean;
    workerThreads: number;
  };
}

export interface IRiskConfig {
  global: {
    maxTotalExposure: number;
    maxUserExposure: number;
    maxSymbolExposure: number;
    maintenanceMarginRate: number;
    liquidationFeeRate: number;
    insuranceFundTarget: number;
  };
  perSymbol: Map<string, {
    maxPositionSize: number;
    maxLeverage: number;
    minMarginRate: number;
    priceBands: {
      enabled: boolean;
      percentage: number;
    };
    circuitBreaker: {
      enabled: boolean;
      threshold: number;
      cooldown: number;
    };
  }>;
  leverageTiers: Map<string, any[]>;
  positionLimits: {
    maxPositionsPerUser: number;
    maxPositionsPerSymbol: number;
    concentrationLimit: number;
  };
}

export interface ISystemConfig {
  configId: string;
  version: string;
  name: string;
  description?: string;
  markets: IMarketConfig[];
  engine: IEngineConfig;
  risk: IRiskConfig;
  active: boolean;
  createdBy: string;
  createdAt: Date;
  activatedAt?: Date;
  deactivatedAt?: Date;
  parent?: string; // Previous version
  tags?: string[];
}

export interface IConfigSnapshot {
  snapshotId: string;
  config: ISystemConfig;
  timestamp: Date;
  reason: string;
  createdBy: string;
}

export interface IScenario {
  scenarioId: string;
  name: string;
  description: string;
  type: 'CRASH' | 'SPIKE' | 'LIQUIDITY_CRISIS' | 'MASS_LIQUIDATION' | 'ORDER_FLOOD' | 'FEED_FAILURE';
  parameters: {
    duration: number; // minutes
    intensity: number; // 1-10
    priceChanges?: { [symbol: string]: number };
    volumeMultiplier?: number;
    volatilityMultiplier?: number;
    orderRate?: number;
    liquidationRate?: number;
    feedFailureType?: 'DELAY' | 'OUTAGE' | 'CORRUPT';
  };
  schedule?: {
    enabled: boolean;
    cronExpression?: string;
    nextRun?: Date;
  };
  results?: IScenarioResult[];
  createdBy: string;
  createdAt: Date;
  lastRun?: Date;
}

export interface IScenarioResult {
  executionId: string;
  scenarioId: string;
  startTime: Date;
  endTime: Date;
  success: boolean;
  metrics: {
    ordersProcessed: number;
    tradesExecuted: number;
    positionsLiquidated: number;
    totalVolume: number;
    priceImpact: { [symbol: string]: number };
    systemLoad: number;
    errorCount: number;
  };
  logs: string[];
  snapshots: {
    before: any;
    after: any;
  };
}

export interface ISystemHealth {
  status: 'healthy' | 'degraded' | 'critical';
  uptime: number;
  performance: {
    orderLatency: number;
    matchingRate: number;
    apiResponseTime: number;
    wsMessageRate: number;
    dbQueryTime: number;
  };
  resources: {
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
    connections: {
      database: number;
      websocket: number;
      api: number;
    };
  };
  errors: {
    rate: number;
    recent: Array<{
      timestamp: Date;
      type: string;
      message: string;
      count: number;
    }>;
  };
  subsystems: {
    matchingEngine: 'operational' | 'degraded' | 'down';
    priceFeeds: 'operational' | 'degraded' | 'down';
    database: 'operational' | 'degraded' | 'down';
    cache: 'operational' | 'degraded' | 'down';
    websocket: 'operational' | 'degraded' | 'down';
  };
}

export interface IUserActivity {
  totalUsers: number;
  activeUsers: {
    last1h: number;
    last24h: number;
    last7d: number;
  };
  newUsers: {
    today: number;
    thisWeek: number;
    thisMonth: number;
  };
  trading: {
    activeTraders: number;
    ordersPerHour: number;
    tradesPerHour: number;
    volumePerHour: number;
  };
  positions: {
    open: number;
    totalValue: number;
    averageSize: number;
    distribution: { [symbol: string]: number };
  };
}

export interface IDashboardMetrics {
  timestamp: Date;
  health: ISystemHealth;
  activity: IUserActivity;
  risk: {
    totalExposure: number;
    marginUtilization: number;
    liquidationQueue: number;
    highRiskPositions: number;
    insuranceFundBalance: number;
  };
  markets: Array<{
    symbol: string;
    status: string;
    volume24h: number;
    trades24h: number;
    spread: number;
    volatility: number;
  }>;
  alerts: Array<{
    id: string;
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    timestamp: Date;
    acknowledged: boolean;
  }>;
}

export interface IAdminSession {
  sessionId: string;
  adminId: string;
  ipAddress: string;
  userAgent: string;
  twoFactorVerified: boolean;
  permissions: AdminPermission[];
  loginTime: Date;
  lastActivity: Date;
  expiresAt: Date;
}

export interface IActionConfirmation {
  confirmationId: string;
  action: AdminAction;
  adminId: string;
  targetId?: string;
  parameters: any;
  requiredConfirmations: number;
  confirmations: Array<{
    adminId: string;
    timestamp: Date;
    signature: string;
  }>;
  status: 'pending' | 'confirmed' | 'expired' | 'cancelled';
  expiresAt: Date;
  createdAt: Date;
  executedAt?: Date;
}

export interface ICircuitBreaker {
  symbol: string;
  enabled: boolean;
  status: 'normal' | 'triggered' | 'cooldown';
  thresholds: {
    priceChange: number; // percentage
    volumeSpike: number; // multiplier
    liquidationRate: number; // per minute
  };
  cooldownPeriod: number; // seconds
  triggeredAt?: Date;
  resumeAt?: Date;
  triggerCount: number;
}

export interface IMaintenanceWindow {
  id: string;
  type: 'scheduled' | 'emergency';
  scope: 'global' | 'symbol' | 'feature';
  targets?: string[];
  startTime: Date;
  endTime: Date;
  reason: string;
  description?: string;
  affectedFeatures: string[];
  notification: {
    sent: boolean;
    sentAt?: Date;
    channels: string[];
  };
  createdBy: string;
  createdAt: Date;
  status: 'scheduled' | 'active' | 'completed' | 'cancelled';
}