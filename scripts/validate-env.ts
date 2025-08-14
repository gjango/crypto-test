#!/usr/bin/env ts-node

import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';

const envPath = resolve(__dirname, '../.env');
dotenvConfig({ path: envPath });

console.log('🔍 Validating environment configuration...\n');

try {
  require('../src/config/environment');
  console.log('✅ Environment configuration is valid!\n');
  console.log('Environment:', process.env.NODE_ENV);
  console.log('Port:', process.env.PORT);
  console.log('MongoDB URI:', process.env.MONGODB_URI ? '✓ Set' : '✗ Not set');
  console.log('JWT Keys:', process.env.JWT_PRIVATE_KEY && process.env.JWT_PUBLIC_KEY ? '✓ Set' : '✗ Not set');
  console.log('Session Secret:', process.env.SESSION_SECRET ? '✓ Set' : '✗ Not set');
  process.exit(0);
} catch (error) {
  console.error('❌ Environment configuration validation failed:\n');
  console.error((error as Error).message);
  process.exit(1);
}