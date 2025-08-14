import mongoose, { ClientSession } from 'mongoose';
import { Types } from 'mongoose';

/**
 * Convert string to Decimal128
 */
export const toDecimal128 = (value: string | number): Types.Decimal128 => {
  return Types.Decimal128.fromString(value.toString());
};

/**
 * Convert Decimal128 to number
 */
export const fromDecimal128 = (value: Types.Decimal128): number => {
  return parseFloat(value.toString());
};

/**
 * Format Decimal128 for display
 */
export const formatDecimal = (value: Types.Decimal128, decimals: number = 8): string => {
  return parseFloat(value.toString()).toFixed(decimals);
};

/**
 * Compare two Decimal128 values
 */
export const compareDecimals = (a: Types.Decimal128, b: Types.Decimal128): number => {
  const numA = fromDecimal128(a);
  const numB = fromDecimal128(b);
  return numA - numB;
};

/**
 * Add two Decimal128 values
 */
export const addDecimals = (a: Types.Decimal128, b: Types.Decimal128): Types.Decimal128 => {
  const sum = fromDecimal128(a) + fromDecimal128(b);
  return toDecimal128(sum);
};

/**
 * Subtract two Decimal128 values
 */
export const subtractDecimals = (a: Types.Decimal128, b: Types.Decimal128): Types.Decimal128 => {
  const diff = fromDecimal128(a) - fromDecimal128(b);
  return toDecimal128(diff);
};

/**
 * Multiply two Decimal128 values
 */
export const multiplyDecimals = (a: Types.Decimal128, b: Types.Decimal128): Types.Decimal128 => {
  const product = fromDecimal128(a) * fromDecimal128(b);
  return toDecimal128(product);
};

/**
 * Divide two Decimal128 values
 */
export const divideDecimals = (a: Types.Decimal128, b: Types.Decimal128): Types.Decimal128 => {
  const divisor = fromDecimal128(b);
  if (divisor === 0) {
    throw new Error('Division by zero');
  }
  const quotient = fromDecimal128(a) / divisor;
  return toDecimal128(quotient);
};

/**
 * Execute a function within a MongoDB transaction
 */
export const withTransaction = async <T>(
  fn: (session: ClientSession) => Promise<T>
): Promise<T> => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const result = await fn(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * Retry a database operation with exponential backoff
 */
export const retryOperation = async <T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> => {
  let lastError: any;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      // Don't retry on validation errors
      if (error.name === 'ValidationError') {
        throw error;
      }
      
      // Calculate exponential backoff delay
      const delay = initialDelay * Math.pow(2, i);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
};

/**
 * Bulk write with error handling
 */
export const bulkWrite = async <T>(
  Model: any,
  operations: any[],
  options: { ordered?: boolean; session?: ClientSession } = {}
): Promise<any> => {
  if (operations.length === 0) {
    return { ok: 1, writeErrors: [], writeConcernErrors: [], nInserted: 0, nUpserted: 0, nMatched: 0, nModified: 0, nRemoved: 0 };
  }
  
  try {
    return await Model.bulkWrite(operations, options);
  } catch (error: any) {
    if (error.writeErrors) {
      console.error(`Bulk write errors: ${error.writeErrors.length} errors`);
      error.writeErrors.forEach((err: any) => {
        console.error(`  - ${err.errmsg}`);
      });
    }
    throw error;
  }
};

/**
 * Create indexes for all models
 */
export const createIndexes = async (): Promise<void> => {
  const models = mongoose.modelNames();
  
  for (const modelName of models) {
    const Model = mongoose.model(modelName);
    try {
      await Model.createIndexes();
      console.log(`✅ Indexes created for ${modelName}`);
    } catch (error) {
      console.error(`❌ Failed to create indexes for ${modelName}:`, error);
    }
  }
};

/**
 * Clean up old documents based on TTL
 */
export const cleanupOldDocuments = async (): Promise<void> => {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  
  // Clean up old price ticks (keep 1 day)
  const PriceTick = mongoose.model('PriceTick');
  const tickResult = await PriceTick.deleteMany({ timestamp: { $lt: oneDayAgo } });
  console.log(`Cleaned up ${tickResult.deletedCount} old price ticks`);
  
  // Clean up old 1m candles (keep 1 week)
  const Candle = mongoose.model('Candle');
  const candleResult = await Candle.deleteMany({
    interval: '1m',
    openTime: { $lt: oneWeekAgo }
  });
  console.log(`Cleaned up ${candleResult.deletedCount} old 1m candles`);
  
  // Clean up old admin actions (keep 1 month)
  const AdminAction = mongoose.model('AdminAction');
  const actionResult = await AdminAction.deleteMany({
    timestamp: { $lt: oneMonthAgo },
    isActive: false
  });
  console.log(`Cleaned up ${actionResult.deletedCount} old admin actions`);
};

/**
 * Get database statistics
 */
export const getDatabaseStats = async (): Promise<any> => {
  const stats: any = {
    collections: {},
    totalDocuments: 0,
    totalSize: 0,
  };
  
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database not connected');
  }
  
  const collections = await db.listCollections().toArray();
  
  for (const collection of collections) {
    const collStats = await db.collection(collection.name).stats();
    stats.collections[collection.name] = {
      count: collStats.count,
      size: collStats.size,
      avgObjSize: collStats.avgObjSize,
      indexes: collStats.nindexes,
    };
    stats.totalDocuments += collStats.count;
    stats.totalSize += collStats.size;
  }
  
  return stats;
};

/**
 * Validate MongoDB connection
 */
export const validateConnection = async (): Promise<boolean> => {
  try {
    const adminDb = mongoose.connection.db?.admin();
    if (!adminDb) {
      return false;
    }
    
    await adminDb.ping();
    return true;
  } catch (error) {
    return false;
  }
};