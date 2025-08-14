import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IInsuranceFundTransaction {
  transactionId: string;
  type: 'CONTRIBUTION' | 'WITHDRAWAL' | 'COVERAGE' | 'ADJUSTMENT';
  amount: Types.Decimal128;
  balance: Types.Decimal128;
  description: string;
  referenceId?: string;
  referenceType?: 'LIQUIDATION' | 'ADMIN' | 'SYSTEM';
  timestamp: Date;
}

export interface IInsuranceFund extends Document {
  _id: Types.ObjectId;
  fundId: string;
  balance: Types.Decimal128;
  targetBalance: Types.Decimal128;
  minBalance: Types.Decimal128;
  totalContributions: Types.Decimal128;
  totalWithdrawals: Types.Decimal128;
  totalCoverage: Types.Decimal128;
  transactions: IInsuranceFundTransaction[];
  lastUpdated: Date;
  isActive: boolean;
}

const InsuranceFundTransactionSchema = new Schema({
  transactionId: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    required: true,
    enum: ['CONTRIBUTION', 'WITHDRAWAL', 'COVERAGE', 'ADJUSTMENT'],
  },
  amount: {
    type: Schema.Types.Decimal128 as any,
    required: true,
    get: (v: any) => parseFloat(v?.toString() || '0'),
    set: (v: number) => v?.toString(),
  },
  balance: {
    type: Schema.Types.Decimal128 as any,
    required: true,
    get: (v: any) => parseFloat(v?.toString() || '0'),
    set: (v: number) => v?.toString(),
  },
  description: {
    type: String,
    required: true,
  },
  referenceId: String,
  referenceType: {
    type: String,
    enum: ['LIQUIDATION', 'ADMIN', 'SYSTEM'],
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

const InsuranceFundSchema = new Schema<IInsuranceFund>({
  fundId: {
    type: String,
    required: true,
    unique: true,
    default: 'MAIN',
  },
  balance: {
    type: Schema.Types.Decimal128 as any,
    required: true,
    default: '0',
    get: (v: any) => parseFloat(v?.toString() || '0'),
    set: (v: number) => v?.toString(),
  },
  targetBalance: {
    type: Schema.Types.Decimal128 as any,
    required: true,
    default: '1000000',
    get: (v: any) => parseFloat(v?.toString() || '0'),
    set: (v: number) => v?.toString(),
  },
  minBalance: {
    type: Schema.Types.Decimal128 as any,
    required: true,
    default: '100000',
    get: (v: any) => parseFloat(v?.toString() || '0'),
    set: (v: number) => v?.toString(),
  },
  totalContributions: {
    type: Schema.Types.Decimal128 as any,
    default: '0',
    get: (v: any) => parseFloat(v?.toString() || '0'),
    set: (v: number) => v?.toString(),
  },
  totalWithdrawals: {
    type: Schema.Types.Decimal128 as any,
    default: '0',
    get: (v: any) => parseFloat(v?.toString() || '0'),
    set: (v: number) => v?.toString(),
  },
  totalCoverage: {
    type: Schema.Types.Decimal128 as any,
    default: '0',
    get: (v: any) => parseFloat(v?.toString() || '0'),
    set: (v: number) => v?.toString(),
  },
  transactions: [InsuranceFundTransactionSchema],
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true },
});

// Indexes
// fundId already has unique index from unique: true
InsuranceFundSchema.index({ 'transactions.timestamp': -1 });

export const InsuranceFund = mongoose.model<IInsuranceFund>('InsuranceFund', InsuranceFundSchema);