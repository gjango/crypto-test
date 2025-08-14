import mongoose, { Schema, Document } from 'mongoose';
import { ILiquidationHistory } from '../types/margin';

export interface ILiquidationHistoryDocument extends Omit<ILiquidationHistory, '_id'>, Document {}

const LiquidationHistorySchema = new Schema<ILiquidationHistoryDocument>({
  liquidationId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  positionId: {
    type: String,
    required: true,
    index: true,
  },
  userId: {
    type: String,
    required: true,
    index: true,
  },
  symbol: {
    type: String,
    required: true,
    index: true,
  },
  side: {
    type: String,
    required: true,
    enum: ['LONG', 'SHORT'],
  },
  quantity: {
    type: Schema.Types.Decimal128 as any,
    required: true,
    get: (v: any) => parseFloat(v?.toString() || '0'),
    set: (v: number) => v?.toString(),
  },
  entryPrice: {
    type: Schema.Types.Decimal128 as any,
    required: true,
    get: (v: any) => parseFloat(v?.toString() || '0'),
    set: (v: number) => v?.toString(),
  },
  liquidationPrice: {
    type: Schema.Types.Decimal128 as any,
    required: true,
    get: (v: any) => parseFloat(v?.toString() || '0'),
    set: (v: number) => v?.toString(),
  },
  margin: {
    type: Schema.Types.Decimal128 as any,
    required: true,
    get: (v: any) => parseFloat(v?.toString() || '0'),
    set: (v: number) => v?.toString(),
  },
  loss: {
    type: Schema.Types.Decimal128 as any,
    required: true,
    get: (v: any) => parseFloat(v?.toString() || '0'),
    set: (v: number) => v?.toString(),
  },
  fee: {
    type: Schema.Types.Decimal128 as any,
    required: true,
    get: (v: any) => parseFloat(v?.toString() || '0'),
    set: (v: number) => v?.toString(),
  },
  insuranceFundContribution: {
    type: Schema.Types.Decimal128 as any,
    get: (v: any) => parseFloat(v?.toString() || '0'),
    set: (v: number) => v?.toString(),
  },
  liquidationType: {
    type: String,
    required: true,
    enum: ['FULL', 'PARTIAL', 'AUTO_DELEVERAGE'],
  },
  trigger: {
    type: String,
    required: true,
    enum: ['MARGIN_CALL', 'MAINTENANCE', 'FORCED', 'AUTO_DELEVERAGE'],
  },
  liquidatedBy: {
    type: String,
    required: true,
    enum: ['SYSTEM', 'ADMIN'],
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  metadata: {
    type: Schema.Types.Mixed,
  },
}, {
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true },
});

// Indexes for efficient querying
LiquidationHistorySchema.index({ timestamp: -1 });
LiquidationHistorySchema.index({ userId: 1, timestamp: -1 });
LiquidationHistorySchema.index({ symbol: 1, timestamp: -1 });

// TTL index to automatically delete old liquidation records after 90 days
LiquidationHistorySchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 });

export const LiquidationHistory = mongoose.model<ILiquidationHistoryDocument>('LiquidationHistory', LiquidationHistorySchema);