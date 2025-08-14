import { Schema, model, Document, Types } from 'mongoose';
import { CandleInterval } from '../types/enums';

export interface ICandle extends Document {
  _id: Types.ObjectId;
  symbol: string;
  interval: CandleInterval;
  openTime: Date;
  closeTime: Date;
  
  // OHLCV data
  open: Types.Decimal128;
  high: Types.Decimal128;
  low: Types.Decimal128;
  close: Types.Decimal128;
  volume: Types.Decimal128;
  quoteVolume: Types.Decimal128;
  
  // Additional statistics
  trades: number;
  takerBuyVolume: Types.Decimal128;
  takerBuyQuoteVolume: Types.Decimal128;
  
  // Technical indicators (optional, calculated)
  sma?: Types.Decimal128;
  ema?: Types.Decimal128;
  rsi?: Types.Decimal128;
  macd?: {
    value: Types.Decimal128;
    signal: Types.Decimal128;
    histogram: Types.Decimal128;
  };
  
  // Status
  isFinal: boolean;
  lastUpdateTime: Date;
  
  // Methods
  calculateChange(): { amount: Types.Decimal128; percent: number };
  isGreen(): boolean;
  isRed(): boolean;
  getBodySize(): Types.Decimal128;
  getUpperWick(): Types.Decimal128;
  getLowerWick(): Types.Decimal128;
}

const candleSchema = new Schema<ICandle>(
  {
    symbol: {
      type: String,
      required: true,
      uppercase: true,
      index: true,
    },
    interval: {
      type: String,
      enum: Object.values(CandleInterval),
      required: true,
      index: true,
    },
    openTime: {
      type: Date,
      required: true,
      index: true,
    },
    closeTime: {
      type: Date,
      required: true,
    },
    
    // OHLCV data
    open: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    high: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    low: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    close: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    volume: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0',
    },
    quoteVolume: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0',
    },
    
    // Additional statistics
    trades: {
      type: Number,
      default: 0,
    },
    takerBuyVolume: {
      type: Schema.Types.Decimal128,
      default: '0',
    },
    takerBuyQuoteVolume: {
      type: Schema.Types.Decimal128,
      default: '0',
    },
    
    // Technical indicators
    sma: Schema.Types.Decimal128,
    ema: Schema.Types.Decimal128,
    rsi: Schema.Types.Decimal128,
    macd: {
      value: Schema.Types.Decimal128,
      signal: Schema.Types.Decimal128,
      histogram: Schema.Types.Decimal128,
    },
    
    // Status
    isFinal: {
      type: Boolean,
      default: false,
      index: true,
    },
    lastUpdateTime: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: 'candles',
    timestamps: true,
  }
);

// Compound indexes for efficient queries
candleSchema.index({ symbol: 1, interval: 1, openTime: -1 }, { unique: true });
candleSchema.index({ symbol: 1, interval: 1, closeTime: -1 });
candleSchema.index({ interval: 1, openTime: -1 });
candleSchema.index({ lastUpdateTime: -1 });

// TTL index to remove old candles based on interval
// 1m candles: 7 days, 5m: 30 days, 15m: 60 days, 1h: 180 days, 4h: 1 year, 1d: permanent
candleSchema.index({ openTime: 1 }, { 
  expireAfterSeconds: 604800, // 7 days default
  partialFilterExpression: { interval: CandleInterval.ONE_MINUTE }
});

// Validate OHLC relationships
candleSchema.pre('save', function(next) {
  const open = parseFloat(this.open.toString());
  const high = parseFloat(this.high.toString());
  const low = parseFloat(this.low.toString());
  const close = parseFloat(this.close.toString());
  
  // Ensure high is the highest value
  const actualHigh = Math.max(open, high, low, close);
  if (actualHigh !== high) {
    this.high = Types.Decimal128.fromString(actualHigh.toString());
  }
  
  // Ensure low is the lowest value
  const actualLow = Math.min(open, high, low, close);
  if (actualLow !== low) {
    this.low = Types.Decimal128.fromString(actualLow.toString());
  }
  
  // Update lastUpdateTime
  this.lastUpdateTime = new Date();
  
  next();
});

// Methods
candleSchema.methods.calculateChange = function(): { 
  amount: Types.Decimal128; 
  percent: number 
} {
  const open = parseFloat(this.open.toString());
  const close = parseFloat(this.close.toString());
  const change = close - open;
  const changePercent = open !== 0 ? (change / open) * 100 : 0;
  
  return {
    amount: Types.Decimal128.fromString(change.toFixed(8)),
    percent: changePercent,
  };
};

candleSchema.methods.isGreen = function(): boolean {
  const close = parseFloat(this.close.toString());
  const open = parseFloat(this.open.toString());
  return close >= open;
};

candleSchema.methods.isRed = function(): boolean {
  return !this.isGreen();
};

candleSchema.methods.getBodySize = function(): Types.Decimal128 {
  const open = parseFloat(this.open.toString());
  const close = parseFloat(this.close.toString());
  return Types.Decimal128.fromString(Math.abs(close - open).toFixed(8));
};

candleSchema.methods.getUpperWick = function(): Types.Decimal128 {
  const high = parseFloat(this.high.toString());
  const open = parseFloat(this.open.toString());
  const close = parseFloat(this.close.toString());
  const bodyTop = Math.max(open, close);
  return Types.Decimal128.fromString((high - bodyTop).toFixed(8));
};

candleSchema.methods.getLowerWick = function(): Types.Decimal128 {
  const low = parseFloat(this.low.toString());
  const open = parseFloat(this.open.toString());
  const close = parseFloat(this.close.toString());
  const bodyBottom = Math.min(open, close);
  return Types.Decimal128.fromString((bodyBottom - low).toFixed(8));
};

// Virtual for average price
candleSchema.virtual('averagePrice').get(function() {
  const volume = parseFloat(this.volume.toString());
  const quoteVolume = parseFloat(this.quoteVolume.toString());
  
  if (volume === 0) return 0;
  
  return quoteVolume / volume;
});

// Virtual for price range
candleSchema.virtual('priceRange').get(function() {
  const high = parseFloat(this.high.toString());
  const low = parseFloat(this.low.toString());
  return high - low;
});

// Virtual for body to range ratio (indicates volatility)
candleSchema.virtual('bodyRatio').get(function() {
  const bodySize = parseFloat(this.getBodySize().toString());
  const range = this.priceRange;
  
  if (range === 0) return 0;
  
  return bodySize / range;
});

export const Candle = model<ICandle>('Candle', candleSchema);