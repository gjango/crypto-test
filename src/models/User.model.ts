import { Schema, model, Document, Types } from 'mongoose';
import bcrypt from 'bcryptjs';
import { UserRole, KYCStatus } from '../types/enums';

export interface IUser extends Document {
  _id: Types.ObjectId;
  email: string;
  username: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
  lastActivity: Date;
  isActive: boolean;
  isDeleted: boolean;
  deletedAt?: Date;
  
  // Authentication
  refreshTokens: Array<{
    token: string;
    createdAt: Date;
    expiresAt: Date;
    deviceInfo?: string;
  }>;
  twoFactorSecret?: string;
  twoFactorEnabled: boolean;
  
  // Roles and permissions
  roles: UserRole[];
  permissions: string[];
  
  // KYC and limits
  kycStatus: KYCStatus;
  kycVerifiedAt?: Date;
  kycRejectionReason?: string;
  tradingLimits: {
    dailyWithdrawal: Types.Decimal128;
    dailyDeposit: Types.Decimal128;
    maxOrderSize: Types.Decimal128;
    maxPositions: number;
    maxLeverage: number;
  };
  
  // Preferences and settings
  preferences: {
    defaultMarginMode: 'cross' | 'isolated';
    defaultLeverage: number;
    emailNotifications: boolean;
    tradingView: 'basic' | 'advanced' | 'pro';
    theme: 'light' | 'dark' | 'auto';
    timezone: string;
    language: string;
  };
  
  // Security
  loginHistory: Array<{
    timestamp: Date;
    ipAddress: string;
    userAgent: string;
    success: boolean;
  }>;
  ipWhitelist: string[];
  
  // Methods
  comparePassword(password: string): Promise<boolean>;
  hasRole(role: UserRole): boolean;
  hasPermission(permission: string): boolean;
}

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      validate: {
        validator: (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
        message: 'Invalid email format',
      },
    },
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
      index: true,
      validate: {
        validator: (username: string) => /^[a-zA-Z0-9_-]+$/.test(username),
        message: 'Username can only contain letters, numbers, underscores, and hyphens',
      },
    },
    passwordHash: {
      type: String,
      required: true,
    },
    lastActivity: {
      type: Date,
      default: Date.now,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      index: true,
    },
    
    // Authentication
    refreshTokens: [{
      token: {
        type: String,
        required: true,
      },
      createdAt: {
        type: Date,
        default: Date.now,
      },
      expiresAt: {
        type: Date,
        required: true,
      },
      deviceInfo: String,
    }],
    twoFactorSecret: {
      type: String,
      select: false,
    },
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    
    // Roles and permissions
    roles: [{
      type: String,
      enum: Object.values(UserRole),
      default: UserRole.USER,
    }],
    permissions: [String],
    
    // KYC and limits
    kycStatus: {
      type: String,
      enum: Object.values(KYCStatus),
      default: KYCStatus.NOT_STARTED,
      index: true,
    },
    kycVerifiedAt: Date,
    kycRejectionReason: String,
    tradingLimits: {
      dailyWithdrawal: {
        type: Schema.Types.Decimal128,
        default: '10000',
      },
      dailyDeposit: {
        type: Schema.Types.Decimal128,
        default: '50000',
      },
      maxOrderSize: {
        type: Schema.Types.Decimal128,
        default: '100000',
      },
      maxPositions: {
        type: Number,
        default: 50,
      },
      maxLeverage: {
        type: Number,
        default: 20,
      },
    },
    
    // Preferences and settings
    preferences: {
      defaultMarginMode: {
        type: String,
        enum: ['cross', 'isolated'],
        default: 'cross',
      },
      defaultLeverage: {
        type: Number,
        default: 1,
        min: 1,
        max: 125,
      },
      emailNotifications: {
        type: Boolean,
        default: true,
      },
      tradingView: {
        type: String,
        enum: ['basic', 'advanced', 'pro'],
        default: 'basic',
      },
      theme: {
        type: String,
        enum: ['light', 'dark', 'auto'],
        default: 'auto',
      },
      timezone: {
        type: String,
        default: 'UTC',
      },
      language: {
        type: String,
        default: 'en',
      },
    },
    
    // Security
    loginHistory: [{
      timestamp: {
        type: Date,
        default: Date.now,
      },
      ipAddress: String,
      userAgent: String,
      success: Boolean,
    }],
    ipWhitelist: [String],
  },
  {
    timestamps: true,
    collection: 'users',
  }
);

// Indexes
userSchema.index({ email: 1, isDeleted: 1 });
userSchema.index({ username: 1, isDeleted: 1 });
userSchema.index({ roles: 1 });
userSchema.index({ kycStatus: 1, isActive: 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ 'refreshTokens.token': 1 });
userSchema.index({ 'refreshTokens.expiresAt': 1 });

// Clean up expired refresh tokens
userSchema.pre('save', function(next) {
  if (this.refreshTokens && this.refreshTokens.length > 0) {
    this.refreshTokens = this.refreshTokens.filter(rt => rt.expiresAt > new Date());
  }
  next();
});

// Update lastActivity on save
userSchema.pre('save', function(next) {
  this.lastActivity = new Date();
  next();
});

// Methods
userSchema.methods.comparePassword = async function(password: string): Promise<boolean> {
  return bcrypt.compare(password, this.passwordHash);
};

userSchema.methods.hasRole = function(role: UserRole): boolean {
  return this.roles.includes(role);
};

userSchema.methods.hasPermission = function(permission: string): boolean {
  return this.permissions.includes(permission);
};

// Soft delete
userSchema.methods.softDelete = function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  return this.save();
};

// Virtual for display name
userSchema.virtual('displayName').get(function() {
  return this.username || this.email.split('@')[0];
});

// Remove sensitive data from JSON output
userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.passwordHash;
    delete ret.twoFactorSecret;
    delete ret.refreshTokens;
    delete ret.__v;
    return ret;
  },
});

export const User = model<IUser>('User', userSchema);