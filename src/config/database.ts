import mongoose from 'mongoose';
import { config } from './environment';
import { createLogger } from '../utils/logger';

const logger = createLogger('Database');

let connectionAttempts = 0;
const MAX_RETRY_ATTEMPTS = 5;
const RETRY_DELAY_MS = 5000;

export const connectDatabase = async (): Promise<void> => {
  const options: mongoose.ConnectOptions = {
    maxPoolSize: config.mongodb.options.maxPoolSize,
    minPoolSize: config.mongodb.options.minPoolSize,
    connectTimeoutMS: config.mongodb.options.connectTimeoutMS,
    serverSelectionTimeoutMS: config.mongodb.options.serverSelectionTimeoutMS,
    retryWrites: true,
    w: 'majority',
  };

  mongoose.connection.on('connected', () => {
    logger.info('MongoDB connected successfully');
    connectionAttempts = 0;
  });

  mongoose.connection.on('error', (error) => {
    logger.error('MongoDB connection error', error);
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
    if (config.env === 'production') {
      attemptReconnection();
    }
  });

  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected successfully');
    connectionAttempts = 0;
  });

  try {
    await attemptConnection(options);
  } catch (error) {
    logger.error('Failed to connect to MongoDB after maximum retries', error as Error);
    process.exit(1);
  }
};

const attemptConnection = async (options: mongoose.ConnectOptions): Promise<void> => {
  while (connectionAttempts < MAX_RETRY_ATTEMPTS) {
    try {
      connectionAttempts++;
      logger.info(`Attempting MongoDB connection (attempt ${connectionAttempts}/${MAX_RETRY_ATTEMPTS})...`);
      
      await mongoose.connect(config.mongodb.uri, options);
      
      if (config.env === 'development') {
        mongoose.set('debug', true);
      }
      
      return;
    } catch (error) {
      logger.error(`MongoDB connection attempt ${connectionAttempts} failed`, error as Error);
      
      if (connectionAttempts === MAX_RETRY_ATTEMPTS) {
        throw error;
      }
      
      logger.info(`Retrying in ${RETRY_DELAY_MS / 1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
};

const attemptReconnection = async (): Promise<void> => {
  if (connectionAttempts >= MAX_RETRY_ATTEMPTS) {
    logger.error('Maximum reconnection attempts reached. Manual intervention required.');
    return;
  }

  connectionAttempts++;
  logger.info(`Attempting to reconnect to MongoDB (attempt ${connectionAttempts}/${MAX_RETRY_ATTEMPTS})...`);
  
  setTimeout(async () => {
    try {
      await mongoose.connect(config.mongodb.uri);
    } catch (error) {
      logger.error(`Reconnection attempt ${connectionAttempts} failed`, error as Error);
      attemptReconnection();
    }
  }, RETRY_DELAY_MS);
};

export const disconnectDatabase = async (): Promise<void> => {
  try {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
  } catch (error) {
    logger.error('Error closing MongoDB connection', error as Error);
  }
};

export const getDatabaseHealth = (): {
  isConnected: boolean;
  readyState: string;
  ping: boolean;
} => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const readyState = mongoose.connection.readyState;
  
  return {
    isConnected: readyState === 1,
    readyState: states[readyState] ?? 'unknown',
    ping: mongoose.connection.db?.admin !== undefined,
  };
};