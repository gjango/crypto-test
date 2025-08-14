import { Types } from 'mongoose';

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

export enum OrderStatus {
  PENDING = 'PENDING',
  OPEN = 'OPEN',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  TRIGGERED = 'TRIGGERED',
}

export enum TimeInForce {
  GTC = 'GTC', // Good Till Canceled
  IOC = 'IOC', // Immediate or Cancel
  FOK = 'FOK', // Fill or Kill
}

export enum OrderExecutionType {
  NEW = 'NEW',
  TRADE = 'TRADE',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  REJECTED = 'REJECTED',
}

export interface IOrderFlags {
  reduceOnly?: boolean;
  postOnly?: boolean;
  closePosition?: boolean;
  hidden?: boolean;
}

export interface ITrailingStopConfig {
  activationPrice?: number;
  callbackRate?: number; // Percentage for trailing
  trailingAmount?: number; // Absolute amount for trailing
  highWaterMark?: number; // Highest/lowest price since activation
  isActivated?: boolean;
}

export interface IOCOConfig {
  linkedOrderId?: string;
  isPrimary?: boolean;
  otherSide?: {
    type: OrderType;
    side: OrderSide;
    price?: number;
    stopPrice?: number;
    quantity: number;
  };
}

export interface IOrderFill {
  fillId: string;
  price: number;
  quantity: number;
  fee: number;
  feeAsset: string;
  isMaker: boolean;
  timestamp: Date;
  pnl?: number;
}

export interface IOrderRequest {
  userId: string;
  symbol: string;
  type: OrderType;
  side: OrderSide;
  quantity: number;
  price?: number;
  stopPrice?: number;
  timeInForce?: TimeInForce;
  flags?: IOrderFlags;
  trailingConfig?: ITrailingStopConfig;
  ocoConfig?: IOCOConfig;
  leverage?: number;
  marginType?: 'ISOLATED' | 'CROSS';
}

export interface IOrder extends IOrderRequest {
  _id?: Types.ObjectId;
  orderId: string;
  status: OrderStatus;
  filledQuantity: number;
  remainingQuantity: number;
  averagePrice: number;
  fills: IOrderFill[];
  totalFee: number;
  createdAt: Date;
  updatedAt: Date;
  triggeredAt?: Date;
  completedAt?: Date;
  cancelReason?: string;
  rejectReason?: string;
}

export interface IOrderBook {
  symbol: string;
  bids: IOrderBookLevel[];
  asks: IOrderBookLevel[];
  lastUpdate: Date;
  sequenceNumber: number;
}

export interface IOrderBookLevel {
  price: number;
  quantity: number;
  orders: IOrderBookEntry[];
}

export interface IOrderBookEntry {
  orderId: string;
  userId: string;
  quantity: number;
  timestamp: Date;
  hidden?: boolean;
}

export interface IMatchResult {
  takerOrder: IOrder;
  makerOrders: IOrder[];
  fills: IOrderFill[];
  totalExecutedQuantity: number;
  averageExecutionPrice: number;
  totalFees: {
    taker: number;
    makers: number;
  };
}

export interface IOrderValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  estimatedFees?: {
    maker: number;
    taker: number;
  };
  estimatedSlippage?: number;
  requiredMargin?: number;
  availableBalance?: number;
}

export interface IOrderModification {
  orderId: string;
  price?: number;
  quantity?: number;
  stopPrice?: number;
  trailingConfig?: ITrailingStopConfig;
}

export interface IOrderFilter {
  userId?: string;
  symbol?: string;
  type?: OrderType;
  side?: OrderSide;
  status?: OrderStatus | OrderStatus[];
  startDate?: Date;
  endDate?: Date;
  minQuantity?: number;
  maxQuantity?: number;
}

export interface IOrderMetrics {
  totalOrders: number;
  openOrders: number;
  filledOrders: number;
  cancelledOrders: number;
  totalVolume: number;
  totalFees: number;
  averageFillRate: number;
  averageExecutionTime: number;
}

export interface ITriggerMonitor {
  orderId: string;
  symbol: string;
  type: 'STOP' | 'TAKE_PROFIT' | 'TRAILING_STOP';
  triggerPrice: number;
  comparison: 'GTE' | 'LTE'; // Greater than or equal, Less than or equal
  lastCheckedPrice?: number;
  activated?: boolean;
}