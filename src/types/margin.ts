import { Types } from 'mongoose';

export enum MarginMode {
  CROSS = 'CROSS',
  ISOLATED = 'ISOLATED',
}

export enum PositionSide {
  LONG = 'LONG',
  SHORT = 'SHORT',
}

export enum PositionStatus {
  OPEN = 'OPEN',
  CLOSING = 'CLOSING',
  CLOSED = 'CLOSED',
  LIQUIDATING = 'LIQUIDATING',
  LIQUIDATED = 'LIQUIDATED',
}

export enum LiquidationLevel {
  SAFE = 'SAFE',
  WARNING = 'WARNING',
  DANGER = 'DANGER',
  CRITICAL = 'CRITICAL',
  LIQUIDATION = 'LIQUIDATION',
}

export enum MarkPriceType {
  LAST = 'LAST',
  MID = 'MID',
  EMA = 'EMA',
  INDEX = 'INDEX',
}

export interface ILeverageTier {
  tier: number;
  minNotional: number;
  maxNotional: number;
  maxLeverage: number;
  maintenanceMarginRate: number;
  maintenanceAmount: number;
}

export interface IPosition {
  _id?: Types.ObjectId;
  positionId: string;
  userId: string;
  symbol: string;
  side: PositionSide;
  status: PositionStatus;
  marginMode: MarginMode;
  
  // Quantities
  quantity: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  bankruptcyPrice: number;
  
  // Margin
  leverage: number;
  margin: number;
  maintenanceMargin: number;
  marginRatio: number;
  isolatedMargin?: number;
  autoAddMargin?: boolean;
  
  // PnL
  unrealizedPnl: number;
  realizedPnl: number;
  fee: number;
  fundingFee: number;
  
  // Risk
  riskLevel: LiquidationLevel;
  adlRanking?: number; // Auto-deleveraging ranking
  maxNotional: number;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  closedAt?: Date;
  liquidatedAt?: Date;
}

export interface IMarginCalculation {
  initialMargin: number;
  maintenanceMargin: number;
  marginRatio: number;
  availableBalance: number;
  freeMargin: number;
  equity: number;
  unrealizedPnl: number;
  marginBalance: number;
  liquidationPrice: number;
  bankruptcyPrice: number;
  leverageTier: ILeverageTier;
}

export interface IPositionUpdate {
  quantity?: number;
  margin?: number;
  leverage?: number;
  autoAddMargin?: boolean;
  stopLoss?: number;
  takeProfit?: number;
}

export interface ILiquidationEvent {
  positionId: string;
  userId: string;
  symbol: string;
  side: PositionSide;
  quantity: number;
  liquidationPrice: number;
  markPrice: number;
  loss: number;
  fee: number;
  insuranceFundContribution: number;
  timestamp: Date;
  level: LiquidationLevel;
  isPartial: boolean;
}

export interface IRiskMetrics {
  userId?: string;
  totalPositions: number;
  totalExposure: number;
  totalMargin: number;
  totalUnrealizedPnl: number;
  totalRealizedPnl: number;
  accountEquity: number;
  accountMarginRatio: number;
  availableBalance: number;
  freeMargin: number;
  positions: IPositionRisk[];
  riskScore: number;
  warnings: string[];
}

export interface IPositionRisk {
  positionId: string;
  symbol: string;
  side: PositionSide;
  notional: number;
  leverage: number;
  marginRatio: number;
  riskLevel: LiquidationLevel;
  liquidationPrice: number;
  distanceToLiquidation: number; // percentage
  estimatedLoss: number;
}

export interface ILeverageAdjustment {
  positionId: string;
  currentLeverage: number;
  newLeverage: number;
  currentMargin: number;
  newMargin: number;
  marginDelta: number;
  feasible: boolean;
  reason?: string;
}

export interface IMarginTransfer {
  positionId: string;
  amount: number;
  type: 'ADD' | 'REMOVE';
  currentMargin: number;
  newMargin: number;
  currentMarginRatio: number;
  newMarginRatio: number;
  success: boolean;
  reason?: string;
}

export interface ISystemRiskParameters {
  maxLeverage: number;
  maxPositionsPerUser: number;
  maxPositionSizePerSymbol: number;
  maxTotalExposure: number;
  maintenanceMarginRates: ILeverageTier[];
  liquidationFeeRate: number;
  insuranceFundTarget: number;
  adlThreshold: number;
  priceBandPercentage: number;
  emergencyLiquidationThreshold: number;
}

export interface IInsuranceFund {
  balance: number;
  targetBalance: number;
  utilizationRate: number;
  contributions: number;
  payouts: number;
  lastUpdate: Date;
}

export interface ILiquidationQueue {
  positions: IPosition[];
  totalValue: number;
  estimatedTime: number;
  processing: boolean;
}

export interface ILiquidationHistory {
  liquidationId: string;
  positionId: string;
  userId: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number;
  liquidationPrice: number;
  margin: number;
  loss: number;
  fee: number;
  insuranceFundContribution?: number;
  liquidationType: 'FULL' | 'PARTIAL' | 'AUTO_DELEVERAGE';
  trigger: 'MARGIN_CALL' | 'MAINTENANCE' | 'FORCED' | 'AUTO_DELEVERAGE';
  liquidatedBy: 'SYSTEM' | 'ADMIN';
  timestamp: Date;
  metadata?: any;
}

export interface IRiskAlert {
  alertId: string;
  type: 'LARGE_POSITION' | 'HIGH_LEVERAGE' | 'MARGIN_CALL' | 'LIQUIDATION_RISK' | 'UNUSUAL_ACTIVITY';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  userId?: string;
  positionId?: string;
  symbol?: string;
  message: string;
  metrics: any;
  timestamp: Date;
  acknowledged: boolean;
}

export interface IStressTestScenario {
  name: string;
  priceChanges: { [symbol: string]: number }; // percentage changes
  volumeMultiplier: number;
  volatilityMultiplier: number;
  duration: number; // minutes
}

export interface IStressTestResult {
  scenario: IStressTestScenario;
  liquidations: number;
  totalLoss: number;
  insuranceFundImpact: number;
  survivingPositions: number;
  averageMarginRatio: number;
  worstPositions: IPositionRisk[];
  systemHealth: 'HEALTHY' | 'STRESSED' | 'CRITICAL';
  timestamp: Date;
}

export interface IFundingRate {
  symbol: string;
  rate: number;
  nextFundingTime: Date;
  intervalHours: number;
}

export interface IPositionHistory {
  positionId: string;
  action: 'OPEN' | 'INCREASE' | 'DECREASE' | 'CLOSE' | 'LIQUIDATE' | 'MARGIN_ADD' | 'MARGIN_REMOVE';
  quantity: number;
  price: number;
  margin?: number;
  pnl?: number;
  fee?: number;
  timestamp: Date;
}