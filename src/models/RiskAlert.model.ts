import mongoose, { Schema, Document } from 'mongoose';
import { IRiskAlert } from '../types/margin';

export interface IRiskAlertDocument extends Omit<IRiskAlert, '_id'>, Document {}

const RiskAlertSchema = new Schema<IRiskAlertDocument>({
  alertId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  type: {
    type: String,
    required: true,
    enum: ['LARGE_POSITION', 'HIGH_LEVERAGE', 'MARGIN_CALL', 'LIQUIDATION_RISK', 'UNUSUAL_ACTIVITY'],
    index: true,
  },
  severity: {
    type: String,
    required: true,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    index: true,
  },
  userId: {
    type: String,
    index: true,
  },
  symbol: {
    type: String,
    index: true,
  },
  message: {
    type: String,
    required: true,
  },
  metrics: {
    type: Schema.Types.Mixed,
    required: true,
  },
  acknowledged: {
    type: Boolean,
    default: false,
    index: true,
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
});

// Indexes for efficient querying
RiskAlertSchema.index({ timestamp: -1 });
RiskAlertSchema.index({ type: 1, severity: 1, status: 1 });
RiskAlertSchema.index({ userId: 1, timestamp: -1 });
RiskAlertSchema.index({ symbol: 1, timestamp: -1 });

// TTL index to automatically delete old alerts after 30 days
RiskAlertSchema.index({ timestamp: 1 }, { expireAfterSeconds: 2592000 });

export const RiskAlert = mongoose.model<IRiskAlertDocument>('RiskAlert', RiskAlertSchema);