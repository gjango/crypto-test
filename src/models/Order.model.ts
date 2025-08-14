import { Schema, model, Document, Types } from 'mongoose';
import { OrderType, OrderSide, TimeInForce, OrderStatus } from '../types/enums';

export interface IOrderFill {
  price: Types.Decimal128;
  quantity: Types.Decimal128;
  quoteQuantity: Types.Decimal128;
  fee: Types.Decimal128;
  feeCurrency: string;
  tradeId: string;
  timestamp: Date;
}

export interface ITrailingStopConfig {
  activationPrice?: Types.Decimal128;
  callbackRate: Types.Decimal128;
  currentCallbackRate?: Types.Decimal128;
  trailingDelta?: Types.Decimal128;
  highestPrice?: Types.Decimal128;
  lowestPrice?: Types.Decimal128;
}

export interface IOrder extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  symbol: string;
  clientOrderId: string;
  exchangeOrderId?: string;
  
  // Order details
  type: OrderType;
  side: OrderSide;
  quantity: Types.Decimal128;
  price?: Types.Decimal128;
  stopPrice?: Types.Decimal128;
  
  // Execution
  timeInForce: TimeInForce;
  status: OrderStatus;
  executedQty: Types.Decimal128;
  cumulativeQuoteQty: Types.Decimal128;
  avgPrice?: Types.Decimal128;
  
  // Fills
  fills: IOrderFill[];
  
  // Flags
  isWorking: boolean;
  reduceOnly: boolean;
  postOnly: boolean;
  closePosition: boolean;
  
  // OCO (One-Cancels-Other) linkage
  isOco: boolean;
  ocoGroupId?: string;
  linkedOrderId?: Types.ObjectId;
  
  // Trailing stop configuration
  trailingStopConfig?: ITrailingStopConfig;
  
  // Margin trading
  marginMode?: 'cross' | 'isolated';
  leverage?: number;
  positionId?: Types.ObjectId;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  filledAt?: Date;
  canceledAt?: Date;
  expiredAt?: Date;
  
  // Metadata
  source: 'web' | 'mobile' | 'api' | 'system';
  ipAddress?: string;
  userAgent?: string;
  cancelReason?: string;
  rejectReason?: string;
  notes?: string;
  
  // Methods
  isFilled(): boolean;
  isPartiallyFilled(): boolean;
  isActive(): boolean;
  canCancel(): boolean;
  calculateRemainingQty(): Types.Decimal128;
  calculateFilledValue(): Types.Decimal128;
  calculateTotalFees(): Types.Decimal128;
}

const orderFillSchema = new Schema<IOrderFill>(
  {
    price: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    quantity: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    quoteQuantity: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    fee: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    feeCurrency: {
      type: String,
      required: true,
      uppercase: true,
    },
    tradeId: {
      type: String,
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const trailingStopConfigSchema = new Schema<ITrailingStopConfig>(
  {
    activationPrice: Schema.Types.Decimal128,
    callbackRate: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    currentCallbackRate: Schema.Types.Decimal128,
    trailingDelta: Schema.Types.Decimal128,
    highestPrice: Schema.Types.Decimal128,
    lowestPrice: Schema.Types.Decimal128,
  },
  { _id: false }
);

const orderSchema = new Schema<IOrder>(
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
    clientOrderId: {
      type: String,
      required: true,
      index: true,
    },
    exchangeOrderId: {
      type: String,
      index: true,
      sparse: true,
    },
    
    // Order details
    type: {
      type: String,
      enum: Object.values(OrderType),
      required: true,
      index: true,
    },
    side: {
      type: String,
      enum: Object.values(OrderSide),
      required: true,
    },
    quantity: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    price: {
      type: Schema.Types.Decimal128,
      required: function() {
        return this.type === OrderType.LIMIT || 
               this.type === OrderType.STOP_LIMIT ||
               this.type === OrderType.TAKE_PROFIT;
      },
    },
    stopPrice: {
      type: Schema.Types.Decimal128,
      required: function() {
        return this.type === OrderType.STOP || 
               this.type === OrderType.STOP_LIMIT ||
               this.type === OrderType.TAKE_PROFIT;
      },
    },
    
    // Execution
    timeInForce: {
      type: String,
      enum: Object.values(TimeInForce),
      default: TimeInForce.GTC,
    },
    status: {
      type: String,
      enum: Object.values(OrderStatus),
      default: OrderStatus.NEW,
      index: true,
    },
    executedQty: {
      type: Schema.Types.Decimal128,
      default: '0',
    },
    cumulativeQuoteQty: {
      type: Schema.Types.Decimal128,
      default: '0',
    },
    avgPrice: Schema.Types.Decimal128,
    
    // Fills
    fills: {
      type: [orderFillSchema],
      default: [],
    },
    
    // Flags
    isWorking: {
      type: Boolean,
      default: true,
      index: true,
    },
    reduceOnly: {
      type: Boolean,
      default: false,
    },
    postOnly: {
      type: Boolean,
      default: false,
    },
    closePosition: {
      type: Boolean,
      default: false,
    },
    
    // OCO linkage
    isOco: {
      type: Boolean,
      default: false,
      index: true,
    },
    ocoGroupId: {
      type: String,
      index: true,
      sparse: true,
    },
    linkedOrderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      index: true,
      sparse: true,
    },
    
    // Trailing stop configuration
    trailingStopConfig: trailingStopConfigSchema,
    
    // Margin trading
    marginMode: {
      type: String,
      enum: ['cross', 'isolated'],
    },
    leverage: {
      type: Number,
      min: 1,
      max: 125,
    },
    positionId: {
      type: Schema.Types.ObjectId,
      ref: 'Position',
      index: true,
      sparse: true,
    },
    
    // Timestamps
    filledAt: {
      type: Date,
      index: true,
    },
    canceledAt: {
      type: Date,
      index: true,
    },
    expiredAt: {
      type: Date,
      index: true,
    },
    
    // Metadata
    source: {
      type: String,
      enum: ['web', 'mobile', 'api', 'system'],
      default: 'web',
    },
    ipAddress: String,
    userAgent: String,
    cancelReason: String,
    rejectReason: String,
    notes: String,
  },
  {
    timestamps: true,
    collection: 'orders',
  }
);

// Indexes
orderSchema.index({ userId: 1, clientOrderId: 1 }, { unique: true });
orderSchema.index({ userId: 1, status: 1, createdAt: -1 });
orderSchema.index({ userId: 1, symbol: 1, status: 1 });
orderSchema.index({ symbol: 1, status: 1, type: 1 });
orderSchema.index({ status: 1, isWorking: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ ocoGroupId: 1, status: 1 });

// Update average price on save
orderSchema.pre('save', function(next) {
  if (this.fills && this.fills.length > 0) {
    let totalQty = 0;
    let totalValue = 0;
    
    this.fills.forEach(fill => {
      const qty = parseFloat(fill.quantity.toString());
      const price = parseFloat(fill.price.toString());
      totalQty += qty;
      totalValue += qty * price;
    });
    
    if (totalQty > 0) {
      this.avgPrice = Types.Decimal128.fromString((totalValue / totalQty).toFixed(8));
    }
  }
  
  // Update status timestamps
  if (this.isModified('status')) {
    switch (this.status) {
      case OrderStatus.FILLED:
        this.filledAt = new Date();
        this.isWorking = false;
        break;
      case OrderStatus.CANCELED:
        this.canceledAt = new Date();
        this.isWorking = false;
        break;
      case OrderStatus.EXPIRED:
        this.expiredAt = new Date();
        this.isWorking = false;
        break;
      case OrderStatus.REJECTED:
        this.isWorking = false;
        break;
    }
  }
  
  next();
});

// Methods
orderSchema.methods.isFilled = function(): boolean {
  return this.status === OrderStatus.FILLED;
};

orderSchema.methods.isPartiallyFilled = function(): boolean {
  return this.status === OrderStatus.PARTIALLY_FILLED;
};

orderSchema.methods.isActive = function(): boolean {
  return this.status === OrderStatus.NEW || 
         this.status === OrderStatus.PARTIALLY_FILLED;
};

orderSchema.methods.canCancel = function(): boolean {
  return this.isActive() && this.isWorking;
};

orderSchema.methods.calculateRemainingQty = function(): Types.Decimal128 {
  const total = parseFloat(this.quantity.toString());
  const executed = parseFloat(this.executedQty.toString());
  return Types.Decimal128.fromString((total - executed).toFixed(8));
};

orderSchema.methods.calculateFilledValue = function(): Types.Decimal128 {
  let totalValue = 0;
  
  this.fills.forEach(fill => {
    totalValue += parseFloat(fill.quoteQuantity.toString());
  });
  
  return Types.Decimal128.fromString(totalValue.toFixed(8));
};

orderSchema.methods.calculateTotalFees = function(): Types.Decimal128 {
  let totalFees = 0;
  
  this.fills.forEach(fill => {
    totalFees += parseFloat(fill.fee.toString());
  });
  
  return Types.Decimal128.fromString(totalFees.toFixed(8));
};

// Virtual for fill rate
orderSchema.virtual('fillRate').get(function() {
  const total = parseFloat(this.quantity.toString());
  const executed = parseFloat(this.executedQty.toString());
  
  if (total === 0) return 0;
  
  return (executed / total) * 100;
});

// Virtual for is complete
orderSchema.virtual('isComplete').get(function() {
  return [
    OrderStatus.FILLED,
    OrderStatus.CANCELED,
    OrderStatus.EXPIRED,
    OrderStatus.REJECTED
  ].includes(this.status);
});

export const Order = model<IOrder>('Order', orderSchema);