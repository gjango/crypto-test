import { Schema, model, Document, Types } from 'mongoose';
import { WalletType } from '../types/enums';

export interface IWalletBalance {
  currency: string;
  available: Types.Decimal128;
  locked: Types.Decimal128;
  total: Types.Decimal128;
}

export interface IWalletHistory {
  type: 'deposit' | 'withdrawal' | 'trade' | 'fee' | 'transfer' | 'adjustment';
  currency: string;
  amount: Types.Decimal128;
  balanceBefore: Types.Decimal128;
  balanceAfter: Types.Decimal128;
  description: string;
  referenceId?: string;
  referenceType?: string;
  timestamp: Date;
}

export interface IWallet extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: WalletType;
  balances: Map<string, IWalletBalance>;
  lockedAmounts: Map<string, Types.Decimal128>;
  totalValueUSDT: Types.Decimal128;
  isActive: boolean;
  isFrozen: boolean;
  frozenReason?: string;
  history: IWalletHistory[];
  createdAt: Date;
  updatedAt: Date;
  
  // Methods
  getBalance(currency: string): IWalletBalance | null;
  lockAmount(currency: string, amount: Types.Decimal128): Promise<boolean>;
  unlockAmount(currency: string, amount: Types.Decimal128): Promise<boolean>;
  addBalance(currency: string, amount: Types.Decimal128, description: string): Promise<boolean>;
  deductBalance(currency: string, amount: Types.Decimal128, description: string): Promise<boolean>;
  transferTo(targetWallet: IWallet, currency: string, amount: Types.Decimal128): Promise<boolean>;
}

const walletBalanceSchema = new Schema<IWalletBalance>(
  {
    currency: {
      type: String,
      required: true,
      uppercase: true,
    },
    available: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0',
    },
    locked: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0',
    },
    total: {
      type: Schema.Types.Decimal128,
      required: true,
      default: '0',
    },
  },
  { _id: false }
);

const walletHistorySchema = new Schema<IWalletHistory>(
  {
    type: {
      type: String,
      enum: ['deposit', 'withdrawal', 'trade', 'fee', 'transfer', 'adjustment'],
      required: true,
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
    },
    amount: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    balanceBefore: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    balanceAfter: {
      type: Schema.Types.Decimal128,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    referenceId: String,
    referenceType: String,
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const walletSchema = new Schema<IWallet>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(WalletType),
      required: true,
      index: true,
    },
    balances: {
      type: Map,
      of: walletBalanceSchema,
      default: new Map(),
    },
    lockedAmounts: {
      type: Map,
      of: Schema.Types.Decimal128,
      default: new Map(),
    },
    totalValueUSDT: {
      type: Schema.Types.Decimal128,
      default: '0',
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isFrozen: {
      type: Boolean,
      default: false,
      index: true,
    },
    frozenReason: String,
    history: {
      type: [walletHistorySchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'wallets',
  }
);

// Indexes
walletSchema.index({ userId: 1, type: 1 }, { unique: true });
walletSchema.index({ userId: 1, isActive: 1 });
walletSchema.index({ 'history.timestamp': -1 });
walletSchema.index({ totalValueUSDT: -1 });

// Limit history to last 1000 entries
walletSchema.pre('save', function(next) {
  if (this.history && this.history.length > 1000) {
    this.history = this.history.slice(-1000);
  }
  next();
});

// Calculate total for each balance
walletSchema.pre('save', function(next) {
  if (this.balances) {
    this.balances.forEach((balance) => {
      const available = parseFloat(balance.available.toString());
      const locked = parseFloat(balance.locked.toString());
      balance.total = Types.Decimal128.fromString((available + locked).toString());
    });
  }
  next();
});

// Methods
walletSchema.methods.getBalance = function(currency: string): IWalletBalance | null {
  return this.balances.get(currency.toUpperCase()) || null;
};

walletSchema.methods.lockAmount = async function(
  currency: string,
  amount: Types.Decimal128
): Promise<boolean> {
  const upperCurrency = currency.toUpperCase();
  const balance = this.balances.get(upperCurrency);
  
  if (!balance) {
    return false;
  }
  
  const availableAmount = parseFloat(balance.available.toString());
  const requestedAmount = parseFloat(amount.toString());
  
  if (availableAmount < requestedAmount) {
    return false;
  }
  
  balance.available = Types.Decimal128.fromString(
    (availableAmount - requestedAmount).toString()
  );
  balance.locked = Types.Decimal128.fromString(
    (parseFloat(balance.locked.toString()) + requestedAmount).toString()
  );
  
  const currentLocked = this.lockedAmounts.get(upperCurrency);
  const currentLockedAmount = currentLocked ? parseFloat(currentLocked.toString()) : 0;
  this.lockedAmounts.set(
    upperCurrency,
    Types.Decimal128.fromString((currentLockedAmount + requestedAmount).toString())
  );
  
  await this.save();
  return true;
};

walletSchema.methods.unlockAmount = async function(
  currency: string,
  amount: Types.Decimal128
): Promise<boolean> {
  const upperCurrency = currency.toUpperCase();
  const balance = this.balances.get(upperCurrency);
  
  if (!balance) {
    return false;
  }
  
  const lockedAmount = parseFloat(balance.locked.toString());
  const requestedAmount = parseFloat(amount.toString());
  
  if (lockedAmount < requestedAmount) {
    return false;
  }
  
  balance.locked = Types.Decimal128.fromString(
    (lockedAmount - requestedAmount).toString()
  );
  balance.available = Types.Decimal128.fromString(
    (parseFloat(balance.available.toString()) + requestedAmount).toString()
  );
  
  const currentLocked = this.lockedAmounts.get(upperCurrency);
  const currentLockedAmount = currentLocked ? parseFloat(currentLocked.toString()) : 0;
  this.lockedAmounts.set(
    upperCurrency,
    Types.Decimal128.fromString(Math.max(0, currentLockedAmount - requestedAmount).toString())
  );
  
  await this.save();
  return true;
};

walletSchema.methods.addBalance = async function(
  currency: string,
  amount: Types.Decimal128,
  description: string
): Promise<boolean> {
  const upperCurrency = currency.toUpperCase();
  let balance = this.balances.get(upperCurrency);
  
  if (!balance) {
    balance = {
      currency: upperCurrency,
      available: Types.Decimal128.fromString('0'),
      locked: Types.Decimal128.fromString('0'),
      total: Types.Decimal128.fromString('0'),
    } as IWalletBalance;
    this.balances.set(upperCurrency, balance);
  }
  
  const balanceBefore = balance.available;
  const addAmount = parseFloat(amount.toString());
  const currentAvailable = parseFloat(balance.available.toString());
  
  balance.available = Types.Decimal128.fromString(
    (currentAvailable + addAmount).toString()
  );
  
  this.history.push({
    type: 'deposit',
    currency: upperCurrency,
    amount,
    balanceBefore,
    balanceAfter: balance.available,
    description,
    timestamp: new Date(),
  } as IWalletHistory);
  
  await this.save();
  return true;
};

walletSchema.methods.deductBalance = async function(
  currency: string,
  amount: Types.Decimal128,
  description: string
): Promise<boolean> {
  const upperCurrency = currency.toUpperCase();
  const balance = this.balances.get(upperCurrency);
  
  if (!balance) {
    return false;
  }
  
  const availableAmount = parseFloat(balance.available.toString());
  const deductAmount = parseFloat(amount.toString());
  
  if (availableAmount < deductAmount) {
    return false;
  }
  
  const balanceBefore = balance.available;
  balance.available = Types.Decimal128.fromString(
    (availableAmount - deductAmount).toString()
  );
  
  this.history.push({
    type: 'withdrawal',
    currency: upperCurrency,
    amount: Types.Decimal128.fromString(`-${deductAmount}`),
    balanceBefore,
    balanceAfter: balance.available,
    description,
    timestamp: new Date(),
  } as IWalletHistory);
  
  await this.save();
  return true;
};

walletSchema.methods.transferTo = async function(
  targetWallet: IWallet,
  currency: string,
  amount: Types.Decimal128
): Promise<boolean> {
  const session = await this.db.startSession();
  session.startTransaction();
  
  try {
    const success = await this.deductBalance(currency, amount, `Transfer to wallet ${targetWallet._id}`);
    if (!success) {
      await session.abortTransaction();
      return false;
    }
    
    await targetWallet.addBalance(currency, amount, `Transfer from wallet ${this._id}`);
    
    await session.commitTransaction();
    return true;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// Virtual for total balance across all currencies
walletSchema.virtual('totalBalance').get(function() {
  let total = 0;
  this.balances.forEach((balance) => {
    total += parseFloat(balance.total.toString());
  });
  return total;
});

export const Wallet = model<IWallet>('Wallet', walletSchema);