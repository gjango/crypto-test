import { Schema, model, Document, Types } from 'mongoose';

export interface IConfigurationItem {
  key: string;
  value: any;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    enum?: any[];
  };
}

export interface IConfiguration extends Document {
  _id: Types.ObjectId;
  name: string;
  version: string;
  description?: string;
  
  // Configuration categories
  config: {
    trading: {
      enableSpotTrading: boolean;
      enableMarginTrading: boolean;
      enableFuturesTrading: boolean;
      maxLeverage: number;
      defaultLeverage: number;
      liquidationThreshold: Types.Decimal128;
      maintenanceMarginRate: Types.Decimal128;
      initialMarginRate: Types.Decimal128;
      autoDeleveraging: boolean;
    };
    
    fees: {
      spotMakerFee: Types.Decimal128;
      spotTakerFee: Types.Decimal128;
      futuresMakerFee: Types.Decimal128;
      futuresTakerFee: Types.Decimal128;
      withdrawalFees: Map<string, Types.Decimal128>;
      vipTiers: Array<{
        level: number;
        volumeRequirement: Types.Decimal128;
        makerDiscount: Types.Decimal128;
        takerDiscount: Types.Decimal128;
      }>;
    };
    
    limits: {
      minOrderSize: Types.Decimal128;
      maxOrderSize: Types.Decimal128;
      maxOpenOrders: number;
      maxDailyOrders: number;
      minWithdrawal: Map<string, Types.Decimal128>;
      maxWithdrawal: Map<string, Types.Decimal128>;
      dailyWithdrawalLimit: Types.Decimal128;
      kycLimits: {
        unverified: {
          dailyWithdrawal: Types.Decimal128;
          maxOrderSize: Types.Decimal128;
        };
        verified: {
          dailyWithdrawal: Types.Decimal128;
          maxOrderSize: Types.Decimal128;
        };
      };
    };
    
    riskManagement: {
      maxPositionValue: Types.Decimal128;
      maxExposurePerSymbol: Types.Decimal128;
      maxTotalExposure: Types.Decimal128;
      priceDeviationThreshold: Types.Decimal128;
      circuitBreakerThreshold: Types.Decimal128;
      circuitBreakerDuration: number; // minutes
      forceLiquidationEnabled: boolean;
    };
    
    marketMaker: {
      enabled: boolean;
      spreads: Map<string, Types.Decimal128>;
      depths: Map<string, Types.Decimal128>;
      updateInterval: number; // milliseconds
      maxOrdersPerSide: number;
      inventoryLimit: Types.Decimal128;
    };
    
    system: {
      maintenanceMode: boolean;
      tradingHalted: boolean;
      withdrawalsEnabled: boolean;
      depositsEnabled: boolean;
      registrationEnabled: boolean;
      apiRateLimit: number;
      wsConnectionLimit: number;
      sessionTimeout: number; // minutes
      maxLoginAttempts: number;
      lockoutDuration: number; // minutes
    };
    
    notifications: {
      emailEnabled: boolean;
      smsEnabled: boolean;
      pushEnabled: boolean;
      webhooksEnabled: boolean;
      tradingAlerts: boolean;
      securityAlerts: boolean;
      maintenanceAlerts: boolean;
    };
  };
  
  // Metadata
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  activatedAt?: Date;
  deactivatedAt?: Date;
  
  // Status
  isActive: boolean;
  isDefault: boolean;
  isLocked: boolean;
  
  // Versioning
  parentVersion?: string;
  changelog?: string;
  
  // Validation
  isValid: boolean;
  validationErrors?: string[];
  
  // Methods
  activate(): Promise<boolean>;
  deactivate(): Promise<boolean>;
  validateConfig(): { valid: boolean; errors: string[] };
  clone(newName: string, newVersion: string): Promise<IConfiguration>;
  diff(other: IConfiguration): Map<string, any>;
}

const configurationSchema = new Schema<IConfiguration>(
  {
    name: {
      type: String,
      required: true,
      index: true,
    },
    version: {
      type: String,
      required: true,
      index: true,
      validate: {
        validator: (v: string) => /^\d+\.\d+\.\d+$/.test(v),
        message: 'Version must be in format X.Y.Z',
      },
    },
    description: String,
    
    config: {
      trading: {
        enableSpotTrading: {
          type: Boolean,
          default: true,
        },
        enableMarginTrading: {
          type: Boolean,
          default: true,
        },
        enableFuturesTrading: {
          type: Boolean,
          default: false,
        },
        maxLeverage: {
          type: Number,
          default: 20,
          min: 1,
          max: 125,
        },
        defaultLeverage: {
          type: Number,
          default: 1,
        },
        liquidationThreshold: {
          type: Schema.Types.Decimal128,
          default: '0.85',
        },
        maintenanceMarginRate: {
          type: Schema.Types.Decimal128,
          default: '0.025',
        },
        initialMarginRate: {
          type: Schema.Types.Decimal128,
          default: '0.05',
        },
        autoDeleveraging: {
          type: Boolean,
          default: true,
        },
      },
      
      fees: {
        spotMakerFee: {
          type: Schema.Types.Decimal128,
          default: '0.001',
        },
        spotTakerFee: {
          type: Schema.Types.Decimal128,
          default: '0.001',
        },
        futuresMakerFee: {
          type: Schema.Types.Decimal128,
          default: '0.0002',
        },
        futuresTakerFee: {
          type: Schema.Types.Decimal128,
          default: '0.0004',
        },
        withdrawalFees: {
          type: Map,
          of: Schema.Types.Decimal128,
          default: new Map(),
        },
        vipTiers: [{
          level: Number,
          volumeRequirement: Schema.Types.Decimal128,
          makerDiscount: Schema.Types.Decimal128,
          takerDiscount: Schema.Types.Decimal128,
        }],
      },
      
      limits: {
        minOrderSize: {
          type: Schema.Types.Decimal128,
          default: '10',
        },
        maxOrderSize: {
          type: Schema.Types.Decimal128,
          default: '1000000',
        },
        maxOpenOrders: {
          type: Number,
          default: 200,
        },
        maxDailyOrders: {
          type: Number,
          default: 10000,
        },
        minWithdrawal: {
          type: Map,
          of: Schema.Types.Decimal128,
          default: new Map(),
        },
        maxWithdrawal: {
          type: Map,
          of: Schema.Types.Decimal128,
          default: new Map(),
        },
        dailyWithdrawalLimit: {
          type: Schema.Types.Decimal128,
          default: '100000',
        },
        kycLimits: {
          unverified: {
            dailyWithdrawal: {
              type: Schema.Types.Decimal128,
              default: '1000',
            },
            maxOrderSize: {
              type: Schema.Types.Decimal128,
              default: '10000',
            },
          },
          verified: {
            dailyWithdrawal: {
              type: Schema.Types.Decimal128,
              default: '100000',
            },
            maxOrderSize: {
              type: Schema.Types.Decimal128,
              default: '1000000',
            },
          },
        },
      },
      
      riskManagement: {
        maxPositionValue: {
          type: Schema.Types.Decimal128,
          default: '1000000',
        },
        maxExposurePerSymbol: {
          type: Schema.Types.Decimal128,
          default: '500000',
        },
        maxTotalExposure: {
          type: Schema.Types.Decimal128,
          default: '5000000',
        },
        priceDeviationThreshold: {
          type: Schema.Types.Decimal128,
          default: '0.05', // 5%
        },
        circuitBreakerThreshold: {
          type: Schema.Types.Decimal128,
          default: '0.1', // 10%
        },
        circuitBreakerDuration: {
          type: Number,
          default: 5, // minutes
        },
        forceLiquidationEnabled: {
          type: Boolean,
          default: true,
        },
      },
      
      marketMaker: {
        enabled: {
          type: Boolean,
          default: false,
        },
        spreads: {
          type: Map,
          of: Schema.Types.Decimal128,
          default: new Map(),
        },
        depths: {
          type: Map,
          of: Schema.Types.Decimal128,
          default: new Map(),
        },
        updateInterval: {
          type: Number,
          default: 1000, // milliseconds
        },
        maxOrdersPerSide: {
          type: Number,
          default: 10,
        },
        inventoryLimit: {
          type: Schema.Types.Decimal128,
          default: '100000',
        },
      },
      
      system: {
        maintenanceMode: {
          type: Boolean,
          default: false,
        },
        tradingHalted: {
          type: Boolean,
          default: false,
        },
        withdrawalsEnabled: {
          type: Boolean,
          default: true,
        },
        depositsEnabled: {
          type: Boolean,
          default: true,
        },
        registrationEnabled: {
          type: Boolean,
          default: true,
        },
        apiRateLimit: {
          type: Number,
          default: 1000,
        },
        wsConnectionLimit: {
          type: Number,
          default: 5,
        },
        sessionTimeout: {
          type: Number,
          default: 60, // minutes
        },
        maxLoginAttempts: {
          type: Number,
          default: 5,
        },
        lockoutDuration: {
          type: Number,
          default: 30, // minutes
        },
      },
      
      notifications: {
        emailEnabled: {
          type: Boolean,
          default: true,
        },
        smsEnabled: {
          type: Boolean,
          default: false,
        },
        pushEnabled: {
          type: Boolean,
          default: false,
        },
        webhooksEnabled: {
          type: Boolean,
          default: false,
        },
        tradingAlerts: {
          type: Boolean,
          default: true,
        },
        securityAlerts: {
          type: Boolean,
          default: true,
        },
        maintenanceAlerts: {
          type: Boolean,
          default: true,
        },
      },
    },
    
    // Metadata
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    activatedAt: Date,
    deactivatedAt: Date,
    
    // Status
    isActive: {
      type: Boolean,
      default: false,
      index: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
      index: true,
    },
    isLocked: {
      type: Boolean,
      default: false,
    },
    
    // Versioning
    parentVersion: String,
    changelog: String,
    
    // Validation
    isValid: {
      type: Boolean,
      default: true,
    },
    validationErrors: [String],
  },
  {
    timestamps: true,
    collection: 'configurations',
  }
);

// Indexes
configurationSchema.index({ name: 1, version: 1 }, { unique: true });
configurationSchema.index({ isActive: 1, isDefault: 1 });
configurationSchema.index({ createdAt: -1 });

// Ensure only one active configuration
configurationSchema.pre('save', async function(next) {
  if (this.isActive && this.isModified('isActive')) {
    await (this.constructor as any).updateMany(
      { _id: { $ne: this._id }, isActive: true },
      { isActive: false, deactivatedAt: new Date() }
    );
    this.activatedAt = new Date();
  }
  
  // Ensure only one default configuration
  if (this.isDefault && this.isModified('isDefault')) {
    await (this.constructor as any).updateMany(
      { _id: { $ne: this._id }, isDefault: true },
      { isDefault: false }
    );
  }
  
  // Validate configuration
  const validation = this.validateConfig();
  this.isValid = validation.valid;
  this.validationErrors = validation.errors;
  
  next();
});

// Methods
configurationSchema.methods.activate = async function(): Promise<boolean> {
  if (this.isLocked) {
    return false;
  }
  
  this.isActive = true;
  await this.save();
  return true;
};

configurationSchema.methods.deactivate = async function(): Promise<boolean> {
  this.isActive = false;
  this.deactivatedAt = new Date();
  await this.save();
  return true;
};

configurationSchema.methods.validateConfig = function(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Validate leverage settings
  if (this.config.trading.defaultLeverage > this.config.trading.maxLeverage) {
    errors.push('Default leverage cannot exceed maximum leverage');
  }
  
  // Validate fee settings
  const spotMaker = parseFloat(this.config.fees.spotMakerFee.toString());
  const spotTaker = parseFloat(this.config.fees.spotTakerFee.toString());
  if (spotMaker > spotTaker) {
    errors.push('Maker fee should not exceed taker fee');
  }
  
  // Validate limits
  const minOrder = parseFloat(this.config.limits.minOrderSize.toString());
  const maxOrder = parseFloat(this.config.limits.maxOrderSize.toString());
  if (minOrder >= maxOrder) {
    errors.push('Minimum order size must be less than maximum order size');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
};

configurationSchema.methods.clone = async function(
  newName: string,
  newVersion: string
): Promise<IConfiguration> {
  const Model = this.constructor as any;
  const cloned = new Model({
    ...this.toObject(),
    _id: undefined,
    name: newName,
    version: newVersion,
    parentVersion: this.version,
    isActive: false,
    isDefault: false,
    isLocked: false,
    createdAt: undefined,
    updatedAt: undefined,
  });
  
  await cloned.save();
  return cloned;
};

configurationSchema.methods.diff = function(other: IConfiguration): Map<string, any> {
  const differences = new Map<string, any>();
  
  const compareObjects = (obj1: any, obj2: any, path: string = '') => {
    for (const key in obj1) {
      const currentPath = path ? `${path}.${key}` : key;
      
      if (typeof obj1[key] === 'object' && typeof obj2[key] === 'object') {
        compareObjects(obj1[key], obj2[key], currentPath);
      } else if (obj1[key] !== obj2[key]) {
        differences.set(currentPath, {
          old: obj1[key],
          new: obj2[key],
        });
      }
    }
  };
  
  compareObjects(this.config, other.config);
  return differences;
};

export const Configuration = model<IConfiguration>('Configuration', configurationSchema);