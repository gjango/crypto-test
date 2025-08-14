import { Schema, model, Document, Types } from 'mongoose';
import { MarketStatus, OrderType } from '../types/enums';

export interface ILeverageTier {
  bracket: number;
  initialLeverageRate: number;
  maintenanceMarginRate: Types.Decimal128;
  maxLeverage: number;
  maxNotional: Types.Decimal128;
  minNotional: Types.Decimal128;
}

export interface IMarketStats {
  lastPrice: Types.Decimal128;
  bid: Types.Decimal128;
  ask: Types.Decimal128;
  volume24h: Types.Decimal128;
  quoteVolume24h: Types.Decimal128;
  high24h: Types.Decimal128;
  low24h: Types.Decimal128;
  priceChange24h: Types.Decimal128;
  priceChangePercent24h: Types.Decimal128;
  weightedAvgPrice24h: Types.Decimal128;
  prevClosePrice: Types.Decimal128;
  openPrice24h: Types.Decimal128;
  count24h: number;
  lastUpdateTime: Date;
}

export interface IMarket extends Document {
  _id: Types.ObjectId;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: MarketStatus;
  isDelisted: boolean;
  delistedAt?: Date;
  
  // Trading rules
  tickSize: Types.Decimal128;
  stepSize: Types.Decimal128;
  minNotional: Types.Decimal128;
  minQuantity: Types.Decimal128;
  maxQuantity: Types.Decimal128;
  maxPrice: Types.Decimal128;
  minPrice: Types.Decimal128;
  
  // Fees
  fees: {
    maker: Types.Decimal128;
    taker: Types.Decimal128;
  };
  
  // Order types
  allowedOrderTypes: OrderType[];
  
  // Margin trading
  marginTradingEnabled: boolean;
  maxLeverage: number;
  leverageTiers: ILeverageTier[];
  
  // Spread configuration
  spread: {
    enabled: boolean;
    minSpread: Types.Decimal128;
    maxSpread: Types.Decimal128;
    targetSpread: Types.Decimal128;
  };
  
  // Market statistics
  stats: IMarketStats;
  
  // Metadata
  rank: number;
  tags: string[];
  description?: string;
  logoUrl?: string;
  websiteUrl?: string;
  explorerUrl?: string;
  
  createdAt: Date;
  updatedAt: Date;
  
  // Methods
  isOrderTypeAllowed(orderType: OrderType): boolean;
  validateOrderSize(quantity: number, price: number): { valid: boolean; error?: string };
  calculateFee(quantity: number, price: number, isMaker: boolean): Types.Decimal128;
  getLeverageTier(notional: number): ILeverageTier | null;
}

const leverageTierSchema = new Schema<ILeverageTier>(
  {
    bracket: {
      type: Number,
      required: true,
    },
    initialLeverageRate: {
      type: Number,
      required: true,
    },
    maintenanceMarginRate: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    maxLeverage: {
      type: Number,
      required: true,
    },
    maxNotional: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    minNotional: {
      type: Schema.Types.Decimal128,
      required: true,
    },
  },
  { _id: false }
);

const marketStatsSchema = new Schema<IMarketStats>(
  {
    lastPrice: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0',
    },
    bid: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0',
    },
    ask: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0',
    },
    volume24h: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0',
    },
    quoteVolume24h: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0',
    },
    high24h: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0',
    },
    low24h: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0',
    },
    priceChange24h: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0',
    },
    priceChangePercent24h: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0',
    },
    weightedAvgPrice24h: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0',
    },
    prevClosePrice: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0',
    },
    openPrice24h: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0',
    },
    count24h: {
      type: Number,
      required: true,
      default: 0,
    },
    lastUpdateTime: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const marketSchema = new Schema<IMarket>(
  {
    symbol: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      index: true,
      validate: {
        validator: (symbol: string) => /^[A-Z0-9]+$/.test(symbol),
        message: 'Symbol must contain only uppercase letters and numbers',
      },
    },
    baseAsset: {
      type: String,
      required: true,
      uppercase: true,
      index: true,
    },
    quoteAsset: {
      type: String,
      required: true,
      uppercase: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(MarketStatus),
      default: MarketStatus.ACTIVE,
      index: true,
    },
    isDelisted: {
      type: Boolean,
      default: false,
      index: true,
    },
    delistedAt: Date,
    
    // Trading rules
    tickSize: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0.01',
    },
    stepSize: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0.001',
    },
    minNotional: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '10',
    },
    minQuantity: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0.001',
    },
    maxQuantity: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '1000000',
    },
    maxPrice: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '1000000',
    },
    minPrice: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0.01',
    },
    
    // Fees
    fees: {
      maker: {
        type: Schema.Types.Decimal128,
        required: true,
        default: '0.0002',
      },
      taker: {
        type: Schema.Types.Decimal128,
        required: true,
        default: '0.0004',
      },
    },
    
    // Order types
    allowedOrderTypes: {
      type: [String],
      enum: Object.values(OrderType),
      default: [OrderType.LIMIT, OrderType.MARKET],
    },
    
    // Margin trading
    marginTradingEnabled: {
      type: Boolean,
      default: true,
    },
    maxLeverage: {
      type: Number,
      default: 20,
      min: 1,
      max: 125,
    },
    leverageTiers: {
      type: [leverageTierSchema],
      default: [],
    },
    
    // Spread configuration
    spread: {
      enabled: {
        type: Boolean,
        default: true,
      },
      minSpread: {
        type: Schema.Types.Decimal128,
        default: '0.0001',
      },
      maxSpread: {
        type: Schema.Types.Decimal128,
        default: '0.01',
      },
      targetSpread: {
        type: Schema.Types.Decimal128,
        default: '0.001',
      },
    },
    
    // Market statistics
    stats: {
      type: marketStatsSchema,
      default: () => ({}),
    },
    
    // Metadata
    rank: {
      type: Number,
      default: 999,
    },
    tags: {
      type: [String],
      default: [],
    },
    description: String,
    logoUrl: String,
    websiteUrl: String,
    explorerUrl: String,
  },
  {
    timestamps: true,
    collection: 'markets',
  }
);

// Indexes
marketSchema.index({ status: 1, isDelisted: 1 });
marketSchema.index({ baseAsset: 1, quoteAsset: 1 });
marketSchema.index({ 'stats.volume24h': -1 });
marketSchema.index({ 'stats.lastUpdateTime': -1 });
marketSchema.index({ rank: 1 });
marketSchema.index({ tags: 1 });

// Pre-save hook to update delisted status
marketSchema.pre('save', function(next) {
  if (this.status === MarketStatus.DELISTED && !this.isDelisted) {
    this.isDelisted = true;
    this.delistedAt = new Date();
  }
  next();
});

// Methods
marketSchema.methods.isOrderTypeAllowed = function(orderType: OrderType): boolean {
  return this.allowedOrderTypes.includes(orderType);
};

marketSchema.methods.validateOrderSize = function(
  quantity: number,
  price: number
): { valid: boolean; error?: string } {
  const notional = quantity * price;
  const minQty = parseFloat(this.minQuantity.toString());
  const maxQty = parseFloat(this.maxQuantity.toString());
  const minNotional = parseFloat(this.minNotional.toString());
  const minPrice = parseFloat(this.minPrice.toString());
  const maxPrice = parseFloat(this.maxPrice.toString());
  
  if (quantity < minQty) {
    return { valid: false, error: `Quantity below minimum: ${minQty}` };
  }
  
  if (quantity > maxQty) {
    return { valid: false, error: `Quantity above maximum: ${maxQty}` };
  }
  
  if (notional < minNotional) {
    return { valid: false, error: `Notional value below minimum: ${minNotional}` };
  }
  
  if (price < minPrice) {
    return { valid: false, error: `Price below minimum: ${minPrice}` };
  }
  
  if (price > maxPrice) {
    return { valid: false, error: `Price above maximum: ${maxPrice}` };
  }
  
  // Check tick size
  const tickSize = parseFloat(this.tickSize.toString());
  if (price % tickSize !== 0) {
    return { valid: false, error: `Price must be multiple of tick size: ${tickSize}` };
  }
  
  // Check step size
  const stepSize = parseFloat(this.stepSize.toString());
  if (quantity % stepSize !== 0) {
    return { valid: false, error: `Quantity must be multiple of step size: ${stepSize}` };
  }
  
  return { valid: true };
};

marketSchema.methods.calculateFee = function(
  quantity: number,
  price: number,
  isMaker: boolean
): Types.Decimal128 {
  const notional = quantity * price;
  const feeRate = parseFloat(isMaker ? this.fees.maker.toString() : this.fees.taker.toString());
  return Types.Decimal128.fromString((notional * feeRate).toFixed(8));
};

marketSchema.methods.getLeverageTier = function(notional: number): ILeverageTier | null {
  if (!this.leverageTiers || this.leverageTiers.length === 0) {
    return null;
  }
  
  for (const tier of this.leverageTiers) {
    const maxNotional = parseFloat(tier.maxNotional.toString());
    const minNotional = parseFloat(tier.minNotional.toString());
    
    if (notional >= minNotional && notional <= maxNotional) {
      return tier;
    }
  }
  
  return null;
};

// Virtual for spread percentage
marketSchema.virtual('spreadPercent').get(function() {
  const bid = parseFloat(this.stats.bid.toString());
  const ask = parseFloat(this.stats.ask.toString());
  
  if (bid === 0 || ask === 0) return 0;
  
  return ((ask - bid) / bid) * 100;
});

export const Market = model<IMarket>('Market', marketSchema);