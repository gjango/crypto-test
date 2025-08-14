import { Schema, model, Document, Types } from 'mongoose';

export enum AdminActionType {
  // User management
  USER_CREATE = 'USER_CREATE',
  USER_UPDATE = 'USER_UPDATE',
  USER_DELETE = 'USER_DELETE',
  USER_SUSPEND = 'USER_SUSPEND',
  USER_ACTIVATE = 'USER_ACTIVATE',
  USER_KYC_APPROVE = 'USER_KYC_APPROVE',
  USER_KYC_REJECT = 'USER_KYC_REJECT',
  USER_ROLE_CHANGE = 'USER_ROLE_CHANGE',
  USER_LIMIT_CHANGE = 'USER_LIMIT_CHANGE',
  
  // Wallet management
  WALLET_FREEZE = 'WALLET_FREEZE',
  WALLET_UNFREEZE = 'WALLET_UNFREEZE',
  WALLET_ADJUST_BALANCE = 'WALLET_ADJUST_BALANCE',
  
  // Market management
  MARKET_CREATE = 'MARKET_CREATE',
  MARKET_UPDATE = 'MARKET_UPDATE',
  MARKET_SUSPEND = 'MARKET_SUSPEND',
  MARKET_RESUME = 'MARKET_RESUME',
  MARKET_DELIST = 'MARKET_DELIST',
  
  // Order management
  ORDER_CANCEL = 'ORDER_CANCEL',
  ORDER_CANCEL_ALL = 'ORDER_CANCEL_ALL',
  
  // Position management
  POSITION_LIQUIDATE = 'POSITION_LIQUIDATE',
  POSITION_CLOSE = 'POSITION_CLOSE',
  POSITION_ADJUST = 'POSITION_ADJUST',
  
  // System configuration
  CONFIG_UPDATE = 'CONFIG_UPDATE',
  CONFIG_ACTIVATE = 'CONFIG_ACTIVATE',
  CONFIG_ROLLBACK = 'CONFIG_ROLLBACK',
  
  // Trading controls
  TRADING_HALT = 'TRADING_HALT',
  TRADING_RESUME = 'TRADING_RESUME',
  MAINTENANCE_START = 'MAINTENANCE_START',
  MAINTENANCE_END = 'MAINTENANCE_END',
  
  // Security
  SECURITY_ALERT = 'SECURITY_ALERT',
  SECURITY_BLOCK_IP = 'SECURITY_BLOCK_IP',
  SECURITY_UNBLOCK_IP = 'SECURITY_UNBLOCK_IP',
}

export interface IAdminAction extends Document {
  _id: Types.ObjectId;
  adminId: Types.ObjectId;
  adminUsername: string;
  action: AdminActionType;
  
  // Target information
  targetEntity: 'user' | 'wallet' | 'market' | 'order' | 'position' | 'config' | 'system';
  targetId?: Types.ObjectId | string;
  targetDescription?: string;
  
  // State tracking
  previousState?: any;
  newState?: any;
  changes?: Map<string, any>;
  
  // Context
  reason: string;
  notes?: string;
  approvedBy?: Types.ObjectId;
  approvalRequired: boolean;
  isApproved: boolean;
  
  // Tracking
  ipAddress: string;
  userAgent?: string;
  sessionId?: string;
  
  // Results
  success: boolean;
  errorMessage?: string;
  affectedRecords?: number;
  
  // Timestamps
  timestamp: Date;
  executedAt?: Date;
  reversedAt?: Date;
  reversedBy?: Types.ObjectId;
  
  // Methods
  requiresApproval(): boolean;
  canReverse(): boolean;
  getSummary(): string;
}

const adminActionSchema = new Schema<IAdminAction>(
  {
    adminId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    adminUsername: {
      type: String,
      required: true,
    },
    action: {
      type: String,
      enum: Object.values(AdminActionType),
      required: true,
      index: true,
    },
    
    // Target information
    targetEntity: {
      type: String,
      enum: ['user', 'wallet', 'market', 'order', 'position', 'config', 'system'],
      required: true,
      index: true,
    },
    targetId: {
      type: Schema.Types.Mixed,
      index: true,
    },
    targetDescription: String,
    
    // State tracking
    previousState: {
      type: Schema.Types.Mixed,
    },
    newState: {
      type: Schema.Types.Mixed,
    },
    changes: {
      type: Map,
      of: Schema.Types.Mixed,
    },
    
    // Context
    reason: {
      type: String,
      required: true,
    },
    notes: String,
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    approvalRequired: {
      type: Boolean,
      default: false,
    },
    isApproved: {
      type: Boolean,
      default: false,
    },
    
    // Tracking
    ipAddress: {
      type: String,
      required: true,
    },
    userAgent: String,
    sessionId: String,
    
    // Results
    success: {
      type: Boolean,
      default: false,
      index: true,
    },
    errorMessage: String,
    affectedRecords: Number,
    
    // Timestamps
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    executedAt: Date,
    reversedAt: Date,
    reversedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    collection: 'adminactions',
    timestamps: true,
  }
);

// Indexes
adminActionSchema.index({ adminId: 1, timestamp: -1 });
adminActionSchema.index({ targetEntity: 1, targetId: 1, timestamp: -1 });
adminActionSchema.index({ action: 1, timestamp: -1 });
adminActionSchema.index({ success: 1, timestamp: -1 });
adminActionSchema.index({ approvalRequired: 1, isApproved: 1 });
adminActionSchema.index({ timestamp: -1 });

// Pre-save hook to determine if approval is required
adminActionSchema.pre('save', function(next) {
  if (this.isNew) {
    // Critical actions that require approval
    const criticalActions = [
      AdminActionType.USER_DELETE,
      AdminActionType.WALLET_ADJUST_BALANCE,
      AdminActionType.MARKET_DELIST,
      AdminActionType.POSITION_LIQUIDATE,
      AdminActionType.CONFIG_ROLLBACK,
      AdminActionType.TRADING_HALT,
      AdminActionType.MAINTENANCE_START,
    ];
    
    this.approvalRequired = criticalActions.includes(this.action as AdminActionType);
    
    if (!this.approvalRequired) {
      this.isApproved = true;
      this.executedAt = new Date();
    }
  }
  
  next();
});

// Methods
adminActionSchema.methods.requiresApproval = function(): boolean {
  return this.approvalRequired && !this.isApproved;
};

adminActionSchema.methods.canReverse = function(): boolean {
  const reversibleActions = [
    AdminActionType.USER_SUSPEND,
    AdminActionType.USER_ROLE_CHANGE,
    AdminActionType.WALLET_FREEZE,
    AdminActionType.MARKET_SUSPEND,
    AdminActionType.CONFIG_UPDATE,
    AdminActionType.SECURITY_BLOCK_IP,
  ];
  
  return reversibleActions.includes(this.action as AdminActionType) && 
         this.success && 
         !this.reversedAt;
};

adminActionSchema.methods.getSummary = function(): string {
  return `${this.adminUsername} performed ${this.action} on ${this.targetEntity} ${this.targetId || ''}`;
};

// Virtual for duration (if action was reversed)
adminActionSchema.virtual('duration').get(function() {
  if (!this.reversedAt || !this.executedAt) return null;
  
  const duration = this.reversedAt.getTime() - this.executedAt.getTime();
  return duration;
});

// Virtual for is active (not reversed)
adminActionSchema.virtual('isActive').get(function() {
  return this.success && !this.reversedAt;
});

export const AdminAction = model<IAdminAction>('AdminAction', adminActionSchema);