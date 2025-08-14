import mongoose, { Schema, Document } from 'mongoose';

export interface ISystemConfigDocument extends Document {
  configId: string;
  version: string;
  name: string;
  description?: string;
  markets: any[];
  engine: any;
  risk: any;
  active: boolean;
  createdBy: string;
  createdAt: Date;
  activatedAt?: Date;
  deactivatedAt?: Date;
  parent?: string;
  tags?: string[];
}

const SystemConfigSchema = new Schema<ISystemConfigDocument>({
  configId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  version: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
  },
  markets: [{
    type: Schema.Types.Mixed,
  }],
  engine: {
    type: Schema.Types.Mixed,
    required: true,
  },
  risk: {
    type: Schema.Types.Mixed,
    required: true,
  },
  active: {
    type: Boolean,
    default: false,
    index: true,
  },
  createdBy: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  activatedAt: {
    type: Date,
  },
  deactivatedAt: {
    type: Date,
  },
  parent: {
    type: String,
    sparse: true,
  },
  tags: [{
    type: String,
  }],
}, {
  timestamps: false,
});

// Indexes
SystemConfigSchema.index({ active: 1, createdAt: -1 });
SystemConfigSchema.index({ createdBy: 1, createdAt: -1 });
SystemConfigSchema.index({ parent: 1 });

// Ensure only one active config
SystemConfigSchema.pre('save', async function(next) {
  if (this.active) {
    await SystemConfig.updateMany(
      { _id: { $ne: this._id }, active: true },
      { $set: { active: false, deactivatedAt: new Date() } }
    );
  }
  next();
});

export const SystemConfig = mongoose.model<ISystemConfigDocument>('SystemConfig', SystemConfigSchema);