import { Schema, model, Document, Types } from 'mongoose';
import { OrderSide } from '../types/enums';

export interface ITrade extends Document {
  _id: Types.ObjectId;
  tradeId: string;
  orderId: Types.ObjectId;
  symbol: string;
  price: Types.Decimal128;
  quantity: Types.Decimal128;
  quoteQuantity: Types.Decimal128;
  
  // Participants
  buyer: Types.ObjectId;
  seller: Types.ObjectId;
  buyOrderId: Types.ObjectId;
  sellOrderId: Types.ObjectId;
  
  // Maker/Taker
  makerSide: OrderSide;
  isBuyerMaker: boolean;
  
  // Fees
  buyerFee: Types.Decimal128;
  sellerFee: Types.Decimal128;
  buyerFeeCurrency: string;
  sellerFeeCurrency: string;
  
  // Timestamps
  timestamp: Date;
  blockNumber?: number;
  
  // Metadata
  source: 'matching_engine' | 'market_maker' | 'liquidation' | 'otc';
  isLiquidation: boolean;
  liquidatedUserId?: Types.ObjectId;
  
  // Methods
  calculateValue(): Types.Decimal128;
  getTotalFees(): Types.Decimal128;
}

const tradeSchema = new Schema<ITrade>(
  {
    tradeId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
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
    quantity: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    quoteQuantity: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    
    // Participants
    buyer: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    seller: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    buyOrderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    sellOrderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    
    // Maker/Taker
    makerSide: {
      type: String,
      enum: Object.values(OrderSide),
      required: true,
    },
    isBuyerMaker: {
      type: Boolean,
      required: true,
    },
    
    // Fees
    buyerFee: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0',
    },
    sellerFee: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0',
    },
    buyerFeeCurrency: {
      type: String,
      required: true,
      uppercase: true,
      default: 'USDT',
    },
    sellerFeeCurrency: {
      type: String,
      required: true,
      uppercase: true,
      default: 'USDT',
    },
    
    // Timestamps
    timestamp: {
      type: Date,
      default: Date.now,
    },
    blockNumber: Number,
    
    // Metadata
    source: {
      type: String,
      enum: ['matching_engine', 'market_maker', 'liquidation', 'otc'],
      default: 'matching_engine',
    },
    isLiquidation: {
      type: Boolean,
      default: false,
      index: true,
    },
    liquidatedUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      sparse: true,
    },
  },
  {
    timestamps: true,
    collection: 'trades',
  }
);

// Indexes
tradeSchema.index({ symbol: 1, timestamp: -1 });
tradeSchema.index({ buyer: 1, timestamp: -1 });
tradeSchema.index({ seller: 1, timestamp: -1 });
tradeSchema.index({ timestamp: -1 });
tradeSchema.index({ price: 1, timestamp: -1 });

// Calculate quote quantity on save
tradeSchema.pre('save', function(next) {
  if (!this.quoteQuantity) {
    const price = parseFloat(this.price.toString());
    const quantity = parseFloat(this.quantity.toString());
    this.quoteQuantity = Types.Decimal128.fromString((price * quantity).toFixed(8));
  }
  next();
});

// Methods
tradeSchema.methods.calculateValue = function(): Types.Decimal128 {
  const price = parseFloat(this.price.toString());
  const quantity = parseFloat(this.quantity.toString());
  return Types.Decimal128.fromString((price * quantity).toFixed(8));
};

tradeSchema.methods.getTotalFees = function(): Types.Decimal128 {
  const buyerFee = parseFloat(this.buyerFee.toString());
  const sellerFee = parseFloat(this.sellerFee.toString());
  return Types.Decimal128.fromString((buyerFee + sellerFee).toFixed(8));
};

export const Trade = model<ITrade>('Trade', tradeSchema);