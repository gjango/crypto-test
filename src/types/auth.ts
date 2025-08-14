import { Types } from 'mongoose';
import { UserRole } from './enums';

export interface ITokenPayload {
  userId: string;
  email: string;
  username: string;
  roles: UserRole[];
  permissions: string[];
  sessionId?: string;
  type: 'access' | 'refresh';
}

export interface IAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

export interface ILoginResult {
  user: {
    id: string;
    email: string;
    username: string;
    roles: UserRole[];
    permissions: string[];
    kycStatus: string;
    lastActivity: Date;
  };
  tokens: IAuthTokens;
}

export interface IRefreshTokenData {
  token: string;
  userId: Types.ObjectId;
  sessionId: string;
  createdAt: Date;
  expiresAt: Date;
  deviceInfo?: string;
  ipAddress?: string;
}

export enum Permission {
  // Markets
  MARKETS_READ = 'markets:read',
  MARKETS_WRITE = 'markets:write',
  MARKETS_DELETE = 'markets:delete',
  MARKETS_SUSPEND = 'markets:suspend',
  
  // Orders
  ORDERS_CREATE = 'orders:create',
  ORDERS_CANCEL = 'orders:cancel',
  ORDERS_MODIFY = 'orders:modify',
  ORDERS_VIEW_ALL = 'orders:view_all',
  ORDERS_CANCEL_ALL = 'orders:cancel_all',
  
  // Positions
  POSITIONS_VIEW = 'positions:view',
  POSITIONS_CLOSE = 'positions:close',
  POSITIONS_LIQUIDATE = 'positions:liquidate',
  POSITIONS_VIEW_ALL = 'positions:view_all',
  POSITIONS_MODIFY_MARGIN = 'positions:modify_margin',
  
  // Wallets
  WALLETS_VIEW = 'wallets:view',
  WALLETS_TRANSFER = 'wallets:transfer',
  WALLETS_ADJUST = 'wallets:adjust',
  WALLETS_FREEZE = 'wallets:freeze',
  WALLETS_VIEW_ALL = 'wallets:view_all',
  
  // Trading
  TRADING_SPOT = 'trading:spot',
  TRADING_MARGIN = 'trading:margin',
  TRADING_FUTURES = 'trading:futures',
  TRADING_HALT = 'trading:halt',
  TRADING_RESUME = 'trading:resume',
  
  // Admin
  ADMIN_ENGINE = 'admin:engine',
  ADMIN_RISK = 'admin:risk',
  ADMIN_CONFIG = 'admin:config',
  ADMIN_REPORTS = 'admin:reports',
  ADMIN_AUDIT = 'admin:audit',
  
  // Users
  USERS_MANAGE = 'users:manage',
  USERS_IMPERSONATE = 'users:impersonate',
  USERS_KYC = 'users:kyc',
  USERS_SUSPEND = 'users:suspend',
  USERS_DELETE = 'users:delete',
  
  // System
  SYSTEM_MAINTENANCE = 'system:maintenance',
  SYSTEM_MONITORING = 'system:monitoring',
  SYSTEM_LOGS = 'system:logs',
  SYSTEM_BACKUP = 'system:backup',
  
  // API
  API_UNLIMITED = 'api:unlimited',
  API_WEBSOCKET = 'api:websocket',
  API_TRADING = 'api:trading',
}

export interface IRolePermissions {
  [UserRole.SUPER_ADMIN]: Permission[];
  [UserRole.ADMIN]: Permission[];
  [UserRole.MARKET_MAKER]: Permission[];
  [UserRole.VIP]: Permission[];
  [UserRole.TRADER]: Permission[];
  [UserRole.USER]: Permission[];
}

export interface IAuthRequest extends Request {
  user?: ITokenPayload;
  sessionId?: string;
}