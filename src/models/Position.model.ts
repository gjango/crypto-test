import { Schema, model, Document, Types } from 'mongoose';
import { PositionSide, MarginMode } from '../types/enums';

export interface IPositionHistory {
  action: 'open' | 'increase' | 'decrease' | 'close' | 'liquidate' | 'adjust_margin';
  quantity: Types.Decimal128;
  price: Types.Decimal128;
  realizedPnl?: Types.Decimal128;
  fee?: Types.Decimal128;
  marginChange?: Types.Decimal128;
  timestamp: Date;
  orderId?: Types.ObjectId;
  notes?: string;
}

export interface IPosition extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  symbol: string;
  side: PositionSide;
  
  // Position details
  entryPrice: Types.Decimal128;
  markPrice: Types.Decimal128;
  liquidationPrice: Types.Decimal128;
  bankruptcyPrice?: Types.Decimal128;
  
  // Quantities
  quantity: Types.Decimal128;
  notional: Types.Decimal128;
  contractSize: Types.Decimal128;
  
  // Leverage and margin
  leverage: number;
  marginMode: MarginMode;
  initialMargin: Types.Decimal128;
  maintenanceMargin: Types.Decimal128;
  positionMargin: Types.Decimal128; // For isolated positions
  marginRatio: Types.Decimal128;
  
  // PnL
  unrealizedPnl: Types.Decimal128;
  realizedPnl: Types.Decimal128;
  totalPnl: Types.Decimal128;
  pnlPercent: Types.Decimal128;
  
  // Risk management
  autoAddMargin: boolean;
  stopLoss?: Types.Decimal128;
  takeProfit?: Types.Decimal128;
  trailingStop?: {
    activationPrice: Types.Decimal128;
    callbackRate: Types.Decimal128;
    currentStopPrice?: Types.Decimal128;
  };
  
  // Status
  isOpen: boolean;
  isLiquidated: boolean;
  liquidatedAt?: Date;
  liquidationFee?: Types.Decimal128;
  
  // History
  history: IPositionHistory[];
  openedAt: Date;
  closedAt?: Date;
  lastModified: Date;
  
  // Statistics
  maxQuantity: Types.Decimal128;
  totalVolume: Types.Decimal128;
  tradesCount: number;
  totalFees: Types.Decimal128;
  
  // Methods
  calculateUnrealizedPnl(currentPrice: number): Types.Decimal128;
  calculateMarginRatio(currentPrice: number): Types.Decimal128;
  calculateLiquidationPrice(): Types.Decimal128;
  isInDanger(currentPrice: number): boolean;
  shouldLiquidate(currentPrice: number): boolean;
  addMargin(amount: Types.Decimal128): Promise<boolean>;
  removeMargin(amount: Types.Decimal128): Promise<boolean>;
}

const positionHistorySchema = new Schema<IPositionHistory>(
  {
    action: {
      type: String,
      enum: ['open', 'increase', 'decrease', 'close', 'liquidate', 'adjust_margin'],
      required: true,
    },
    quantity: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    price: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    realizedPnl: Schema.Types.Decimal128,
    fee: Schema.Types.Decimal128,
    marginChange: Schema.Types.Decimal128,
    timestamp: {
      type: Date,
      default: Date.now,
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
    },
    notes: String,
  },
  { _id: false }
);

const positionSchema = new Schema<IPosition>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    symbol: {
      type: String,
      required: true,
      uppercase: true,
      index: true,
    },
    side: {
      type: String,
      enum: Object.values(PositionSide),
      required: true,
    },
    
    // Position details
    entryPrice: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    markPrice: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    liquidationPrice: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    bankruptcyPrice: Schema.Types.Decimal128,
    
    // Quantities
    quantity: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    notional: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    contractSize: {
      type: Schema.Types.Decimal128,
      default: '1',
    },
    
    // Leverage and margin
    leverage: {
      type: Number,
      required: true,
      min: 1,
      max: 125,
    },
    marginMode: {
      type: String,
      enum: Object.values(MarginMode),
      required: true,
      index: true,
    },
    initialMargin: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    maintenanceMargin: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    positionMargin: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    marginRatio: {
      type: Schema.Types.Decimal128,
      default: '0',
    },
    
    // PnL
    unrealizedPnl: {
      type: Schema.Types.Decimal128,
      default: '0',
    },
    realizedPnl: {
      type: Schema.Types.Decimal128,
      default: '0',
    },
    totalPnl: {
      type: Schema.Types.Decimal128,
      default: '0',
    },
    pnlPercent: {
      type: Schema.Types.Decimal128,
      default: '0',
    },
    
    // Risk management
    autoAddMargin: {
      type: Boolean,
      default: false,
    },
    stopLoss: Schema.Types.Decimal128,
    takeProfit: Schema.Types.Decimal128,
    trailingStop: {
      activationPrice: Schema.Types.Decimal128,
      callbackRate: Schema.Types.Decimal128,
      currentStopPrice: Schema.Types.Decimal128,
    },
    
    // Status
    isOpen: {
      type: Boolean,
      default: true,
      index: true,
    },
    isLiquidated: {
      type: Boolean,
      default: false,
      index: true,
    },
    liquidatedAt: Date,
    liquidationFee: Schema.Types.Decimal128,
    
    // History
    history: {
      type: [positionHistorySchema],
      default: [],
    },
    openedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    closedAt: {
      type: Date,
      index: true,
    },
    lastModified: {
      type: Date,
      default: Date.now,
    },
    
    // Statistics
    maxQuantity: {
      type: Schema.Types.Decimal128,
      default: '0',
    },
    totalVolume: {
      type: Schema.Types.Decimal128,
      default: '0',
    },
    tradesCount: {
      type: Number,
      default: 0,
    },
    totalFees: {
      type: Schema.Types.Decimal128,
      default: '0',
    },
  },
  {
    timestamps: true,
    collection: 'positions',
  }
);

// Indexes
positionSchema.index({ userId: 1, symbol: 1, isOpen: 1 });
positionSchema.index({ userId: 1, isOpen: 1, side: 1 });
positionSchema.index({ symbol: 1, isOpen: 1 });
positionSchema.index({ liquidationPrice: 1, isOpen: 1 });
positionSchema.index({ marginRatio: 1, isOpen: 1 });
positionSchema.index({ openedAt: -1 });
positionSchema.index({ closedAt: -1 });
positionSchema.index({ 'history.timestamp': -1 });

// Update calculations on save
positionSchema.pre('save', function(next) {
  // Calculate notional
  const qty = parseFloat(this.quantity.toString());
  const markPrice = parseFloat(this.markPrice.toString());
  this.notional = Types.Decimal128.fromString((qty * markPrice).toFixed(8));
  
  // Calculate total PnL
  const unrealized = parseFloat(this.unrealizedPnl.toString());
  const realized = parseFloat(this.realizedPnl.toString());
  this.totalPnl = Types.Decimal128.fromString((unrealized + realized).toFixed(8));
  
  // Calculate PnL percentage
  const initialMargin = parseFloat(this.initialMargin.toString());
  if (initialMargin > 0) {
    this.pnlPercent = Types.Decimal128.fromString(
      ((unrealized / initialMargin) * 100).toFixed(2)
    );
  }
  
  // Update lastModified
  this.lastModified = new Date();
  
  // Update max quantity
  if (qty > parseFloat(this.maxQuantity.toString())) {
    this.maxQuantity = this.quantity;
  }
  
  // Limit history to last 500 entries
  if (this.history && this.history.length > 500) {
    this.history = this.history.slice(-500);
  }
  
  next();
});

// Methods
positionSchema.methods.calculateUnrealizedPnl = function(currentPrice: number): Types.Decimal128 {
  const qty = parseFloat(this.quantity.toString());
  const entryPrice = parseFloat(this.entryPrice.toString());
  
  let pnl: number;
  if (this.side === PositionSide.LONG) {
    pnl = (currentPrice - entryPrice) * qty;
  } else {
    pnl = (entryPrice - currentPrice) * qty;
  }
  
  return Types.Decimal128.fromString(pnl.toFixed(8));
};

positionSchema.methods.calculateMarginRatio = function(currentPrice: number): Types.Decimal128 {
  const maintenanceMargin = parseFloat(this.maintenanceMargin.toString());
  const positionMargin = parseFloat(this.positionMargin.toString());
  const unrealizedPnl = parseFloat(this.calculateUnrealizedPnl(currentPrice).toString());
  
  const equity = positionMargin + unrealizedPnl;
  
  if (maintenanceMargin === 0) {
    return Types.Decimal128.fromString('0');
  }
  
  const marginRatio = (equity / maintenanceMargin) * 100;
  return Types.Decimal128.fromString(marginRatio.toFixed(2));
};

positionSchema.methods.calculateLiquidationPrice = function(): Types.Decimal128 {
  const qty = parseFloat(this.quantity.toString());
  const entryPrice = parseFloat(this.entryPrice.toString());
  const positionMargin = parseFloat(this.positionMargin.toString());
  const maintenanceMarginRate = 0.005; // 0.5% maintenance margin rate
  
  let liquidationPrice: number;
  
  if (this.side === PositionSide.LONG) {
    liquidationPrice = entryPrice * (1 - positionMargin / qty + maintenanceMarginRate);
  } else {
    liquidationPrice = entryPrice * (1 + positionMargin / qty - maintenanceMarginRate);
  }
  
  return Types.Decimal128.fromString(Math.max(0, liquidationPrice).toFixed(8));
};

positionSchema.methods.isInDanger = function(currentPrice: number): boolean {
  const marginRatio = parseFloat(this.calculateMarginRatio(currentPrice).toString());
  return marginRatio < 50; // Below 50% margin ratio is dangerous
};

positionSchema.methods.shouldLiquidate = function(currentPrice: number): boolean {
  const marginRatio = parseFloat(this.calculateMarginRatio(currentPrice).toString());
  return marginRatio <= 100; // Liquidate at or below 100% margin ratio
};

positionSchema.methods.addMargin = async function(amount: Types.Decimal128): Promise<boolean> {
  const addAmount = parseFloat(amount.toString());
  const currentMargin = parseFloat(this.positionMargin.toString());
  
  this.positionMargin = Types.Decimal128.fromString(
    (currentMargin + addAmount).toFixed(8)
  );
  
  this.history.push({
    action: 'adjust_margin',
    quantity: Types.Decimal128.fromString('0'),
    price: this.markPrice,
    marginChange: amount,
    timestamp: new Date(),
    notes: 'Added margin',
  } as IPositionHistory);
  
  await this.save();
  return true;
};

positionSchema.methods.removeMargin = async function(amount: Types.Decimal128): Promise<boolean> {
  const removeAmount = parseFloat(amount.toString());
  const currentMargin = parseFloat(this.positionMargin.toString());
  const minRequired = parseFloat(this.initialMargin.toString());
  
  if (currentMargin - removeAmount < minRequired) {
    return false; // Cannot remove margin below initial requirement
  }
  
  this.positionMargin = Types.Decimal128.fromString(
    (currentMargin - removeAmount).toFixed(8)
  );
  
  this.history.push({
    action: 'adjust_margin',
    quantity: Types.Decimal128.fromString('0'),
    price: this.markPrice,
    marginChange: Types.Decimal128.fromString(`-${removeAmount}`),
    timestamp: new Date(),
    notes: 'Removed margin',
  } as IPositionHistory);
  
  await this.save();
  return true;
};

// Virtual for position value
positionSchema.virtual('positionValue').get(function() {
  const qty = parseFloat(this.quantity.toString());
  const markPrice = parseFloat(this.markPrice.toString());
  return qty * markPrice;
});

// Virtual for ROE (Return on Equity)
positionSchema.virtual('roe').get(function() {
  const unrealizedPnl = parseFloat(this.unrealizedPnl.toString());
  const positionMargin = parseFloat(this.positionMargin.toString());
  
  if (positionMargin === 0) return 0;
  
  return (unrealizedPnl / positionMargin) * 100;
});

export const Position = model<IPosition>('Position', positionSchema);