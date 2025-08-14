import { Schema, model, Document, Types } from 'mongoose';
import { PriceSource } from '../types/enums';

export interface IPriceTick extends Document {
  _id: Types.ObjectId;
  symbol: string;
  price: Types.Decimal128;
  bid: Types.Decimal128;
  ask: Types.Decimal128;
  bidSize: Types.Decimal128;
  askSize: Types.Decimal128;
  
  // Volume
  volume24h: Types.Decimal128;
  quoteVolume24h: Types.Decimal128;
  count24h: number;
  
  // Price changes
  open24h: Types.Decimal128;
  high24h: Types.Decimal128;
  low24h: Types.Decimal128;
  prevClose: Types.Decimal128;
  priceChange: Types.Decimal128;
  priceChangePercent: Types.Decimal128;
  
  // Source
  source: PriceSource;
  exchangeTimestamp?: Date;
  
  // Metadata
  timestamp: Date;
  sequence?: number;
  isStale: boolean;
  
  // Methods
  getSpread(): Types.Decimal128;
  getSpreadPercent(): number;
  getMidPrice(): Types.Decimal128;
}

const priceTickSchema = new Schema<IPriceTick>(
  {
    symbol: {
      type: String,
      required: true,
      uppercase: true,
      index: true,
    },
    price: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    bid: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    ask: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    bidSize: {
      type: Schema.Types.Decimal128,
      default: '0',
    },
    askSize: {
      type: Schema.Types.Decimal128,
      default: '0',
    },
    
    // Volume
    volume24h: {
      type: Schema.Types.Decimal128,
      default: '0',
    },
    quoteVolume24h: {
      type: Schema.Types.Decimal128,
      default: '0',
    },
    count24h: {
      type: Number,
      default: 0,
    },
    
    // Price changes
    open24h: {
      type: Schema.Types.Decimal128,
      default: '0',
    },
    high24h: {
      type: Schema.Types.Decimal128,
      default: '0',
    },
    low24h: {
      type: Schema.Types.Decimal128,
      default: '0',
    },
    prevClose: {
      type: Schema.Types.Decimal128,
      default: '0',
    },
    priceChange: {
      type: Schema.Types.Decimal128,
      default: '0',
    },
    priceChangePercent: {
      type: Schema.Types.Decimal128,
      default: '0',
    },
    
    // Source
    source: {
      type: String,
      enum: Object.values(PriceSource),
      required: true,
      index: true,
    },
    exchangeTimestamp: Date,
    
    // Metadata
    timestamp: {
      type: Date,
      default: Date.now,
    },
    sequence: Number,
    isStale: {
      type: Boolean,
      default: false,
    },
  },
  {
    collection: 'priceticks',
    timeseries: {
      timeField: 'timestamp',
      metaField: 'symbol',
      granularity: 'seconds',
    },
  }
);

// Indexes
priceTickSchema.index({ symbol: 1, timestamp: -1 });
priceTickSchema.index({ symbol: 1, source: 1, timestamp: -1 });
priceTickSchema.index({ timestamp: -1 });
priceTickSchema.index({ source: 1, timestamp: -1 });

// TTL index to remove old ticks after 24 hours
priceTickSchema.index({ timestamp: 1 }, { expireAfterSeconds: 86400 });

// Calculate price changes on save
priceTickSchema.pre('save', function(next) {
  const currentPrice = parseFloat(this.price.toString());
  const prevPrice = parseFloat(this.prevClose.toString());
  
  if (prevPrice > 0) {
    const change = currentPrice - prevPrice;
    const changePercent = (change / prevPrice) * 100;
    
    this.priceChange = Types.Decimal128.fromString(change.toFixed(8));
    this.priceChangePercent = Types.Decimal128.fromString(changePercent.toFixed(2));
  }
  
  // Mark as stale if timestamp is older than 5 seconds
  const now = Date.now();
  const tickTime = this.timestamp.getTime();
  this.isStale = (now - tickTime) > 5000;
  
  next();
});

// Methods
priceTickSchema.methods.getSpread = function(): Types.Decimal128 {
  const ask = parseFloat(this.ask.toString());
  const bid = parseFloat(this.bid.toString());
  return Types.Decimal128.fromString((ask - bid).toFixed(8));
};

priceTickSchema.methods.getSpreadPercent = function(): number {
  const ask = parseFloat(this.ask.toString());
  const bid = parseFloat(this.bid.toString());
  
  if (bid === 0) return 0;
  
  return ((ask - bid) / bid) * 100;
};

priceTickSchema.methods.getMidPrice = function(): Types.Decimal128 {
  const ask = parseFloat(this.ask.toString());
  const bid = parseFloat(this.bid.toString());
  return Types.Decimal128.fromString(((ask + bid) / 2).toFixed(8));
};

export const PriceTick = model<IPriceTick>('PriceTick', priceTickSchema);