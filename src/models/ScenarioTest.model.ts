import mongoose, { Schema, Document } from 'mongoose';
import { IScenario, IScenarioResult } from '../types/admin';

export interface IScenarioDocument extends IScenario, Document {}

const ScenarioResultSchema = new Schema<IScenarioResult>({
  executionId: {
    type: String,
    required: true,
  },
  scenarioId: {
    type: String,
    required: true,
  },
  startTime: {
    type: Date,
    required: true,
  },
  endTime: {
    type: Date,
    required: true,
  },
  success: {
    type: Boolean,
    required: true,
  },
  metrics: {
    ordersProcessed: Number,
    tradesExecuted: Number,
    positionsLiquidated: Number,
    totalVolume: Number,
    priceImpact: Schema.Types.Mixed,
    systemLoad: Number,
    errorCount: Number,
  },
  logs: [String],
  snapshots: {
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
  },
}, { _id: false });

const ScenarioSchema = new Schema<IScenarioDocument>({
  scenarioId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    required: true,
    enum: ['CRASH', 'SPIKE', 'LIQUIDITY_CRISIS', 'MASS_LIQUIDATION', 'ORDER_FLOOD', 'FEED_FAILURE'],
  },
  parameters: {
    duration: Number, // minutes
    intensity: Number, // 1-10
    priceChanges: Schema.Types.Mixed,
    volumeMultiplier: Number,
    volatilityMultiplier: Number,
    orderRate: Number,
    liquidationRate: Number,
    feedFailureType: {
      type: String,
      enum: ['DELAY', 'OUTAGE', 'CORRUPT'],
    },
  },
  schedule: {
    enabled: Boolean,
    cronExpression: String,
    nextRun: Date,
  },
  results: [ScenarioResultSchema],
  createdBy: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  lastRun: Date,
}, {
  timestamps: false,
});

// Indexes
ScenarioSchema.index({ type: 1, createdAt: -1 });
ScenarioSchema.index({ createdBy: 1, createdAt: -1 });
ScenarioSchema.index({ 'schedule.enabled': 1, 'schedule.nextRun': 1 });

export const ScenarioTest = mongoose.model<IScenarioDocument>('ScenarioTest', ScenarioSchema);