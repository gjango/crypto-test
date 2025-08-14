import { UserRole } from '../types/enums';
import { Permission, IRolePermissions } from '../types/auth';

export const rolePermissions: IRolePermissions = {
  [UserRole.SUPER_ADMIN]: [
    // All permissions
    ...Object.values(Permission),
  ],
  
  [UserRole.ADMIN]: [
    // Markets
    Permission.MARKETS_READ,
    Permission.MARKETS_WRITE,
    Permission.MARKETS_SUSPEND,
    
    // Orders
    Permission.ORDERS_CREATE,
    Permission.ORDERS_CANCEL,
    Permission.ORDERS_MODIFY,
    Permission.ORDERS_VIEW_ALL,
    Permission.ORDERS_CANCEL_ALL,
    
    // Positions
    Permission.POSITIONS_VIEW,
    Permission.POSITIONS_CLOSE,
    Permission.POSITIONS_LIQUIDATE,
    Permission.POSITIONS_VIEW_ALL,
    Permission.POSITIONS_MODIFY_MARGIN,
    
    // Wallets
    Permission.WALLETS_VIEW,
    Permission.WALLETS_TRANSFER,
    Permission.WALLETS_FREEZE,
    Permission.WALLETS_VIEW_ALL,
    
    // Trading
    Permission.TRADING_SPOT,
    Permission.TRADING_MARGIN,
    Permission.TRADING_FUTURES,
    Permission.TRADING_HALT,
    Permission.TRADING_RESUME,
    
    // Admin
    Permission.ADMIN_RISK,
    Permission.ADMIN_REPORTS,
    Permission.ADMIN_AUDIT,
    
    // Users
    Permission.USERS_MANAGE,
    Permission.USERS_KYC,
    Permission.USERS_SUSPEND,
    
    // System
    Permission.SYSTEM_MONITORING,
    Permission.SYSTEM_LOGS,
    
    // API
    Permission.API_UNLIMITED,
    Permission.API_WEBSOCKET,
    Permission.API_TRADING,
  ],
  
  [UserRole.MARKET_MAKER]: [
    // Markets
    Permission.MARKETS_READ,
    
    // Orders
    Permission.ORDERS_CREATE,
    Permission.ORDERS_CANCEL,
    Permission.ORDERS_MODIFY,
    Permission.ORDERS_VIEW_ALL,
    
    // Positions
    Permission.POSITIONS_VIEW,
    Permission.POSITIONS_CLOSE,
    Permission.POSITIONS_VIEW_ALL,
    Permission.POSITIONS_MODIFY_MARGIN,
    
    // Wallets
    Permission.WALLETS_VIEW,
    Permission.WALLETS_TRANSFER,
    
    // Trading
    Permission.TRADING_SPOT,
    Permission.TRADING_MARGIN,
    Permission.TRADING_FUTURES,
    
    // API
    Permission.API_UNLIMITED,
    Permission.API_WEBSOCKET,
    Permission.API_TRADING,
  ],
  
  [UserRole.VIP]: [
    // Markets
    Permission.MARKETS_READ,
    
    // Orders
    Permission.ORDERS_CREATE,
    Permission.ORDERS_CANCEL,
    Permission.ORDERS_MODIFY,
    
    // Positions
    Permission.POSITIONS_VIEW,
    Permission.POSITIONS_CLOSE,
    Permission.POSITIONS_MODIFY_MARGIN,
    
    // Wallets
    Permission.WALLETS_VIEW,
    Permission.WALLETS_TRANSFER,
    
    // Trading
    Permission.TRADING_SPOT,
    Permission.TRADING_MARGIN,
    Permission.TRADING_FUTURES,
    
    // API
    Permission.API_WEBSOCKET,
    Permission.API_TRADING,
  ],
  
  [UserRole.TRADER]: [
    // Markets
    Permission.MARKETS_READ,
    
    // Orders
    Permission.ORDERS_CREATE,
    Permission.ORDERS_CANCEL,
    Permission.ORDERS_MODIFY,
    
    // Positions
    Permission.POSITIONS_VIEW,
    Permission.POSITIONS_CLOSE,
    Permission.POSITIONS_MODIFY_MARGIN,
    
    // Wallets
    Permission.WALLETS_VIEW,
    Permission.WALLETS_TRANSFER,
    
    // Trading
    Permission.TRADING_SPOT,
    Permission.TRADING_MARGIN,
    
    // API
    Permission.API_WEBSOCKET,
    Permission.API_TRADING,
  ],
  
  [UserRole.USER]: [
    // Markets
    Permission.MARKETS_READ,
    
    // Orders
    Permission.ORDERS_CREATE,
    Permission.ORDERS_CANCEL,
    
    // Positions
    Permission.POSITIONS_VIEW,
    Permission.POSITIONS_CLOSE,
    
    // Wallets
    Permission.WALLETS_VIEW,
    Permission.WALLETS_TRANSFER,
    
    // Trading
    Permission.TRADING_SPOT,
    
    // API
    Permission.API_WEBSOCKET,
  ],
};

/**
 * Get permissions for a set of roles
 */
export const getPermissionsForRoles = (roles: UserRole[]): Permission[] => {
  const permissions = new Set<Permission>();
  
  for (const role of roles) {
    const rolePerms = rolePermissions[role];
    if (rolePerms) {
      rolePerms.forEach(perm => permissions.add(perm));
    }
  }
  
  return Array.from(permissions);
};

/**
 * Check if roles have a specific permission
 */
export const hasPermission = (
  roles: UserRole[],
  permission: Permission,
  userPermissions?: string[]
): boolean => {
  // Check user-specific permissions first
  if (userPermissions && userPermissions.includes(permission)) {
    return true;
  }
  
  // Check role-based permissions
  const permissions = getPermissionsForRoles(roles);
  return permissions.includes(permission);
};

/**
 * Role hierarchy for inheritance
 */
export const roleHierarchy: { [key in UserRole]: number } = {
  [UserRole.SUPER_ADMIN]: 100,
  [UserRole.ADMIN]: 90,
  [UserRole.MARKET_MAKER]: 70,
  [UserRole.VIP]: 50,
  [UserRole.TRADER]: 30,
  [UserRole.USER]: 10,
};

/**
 * Check if a role is higher than another
 */
export const isRoleHigher = (role1: UserRole, role2: UserRole): boolean => {
  return roleHierarchy[role1] > roleHierarchy[role2];
};

/**
 * Get the highest role from a list
 */
export const getHighestRole = (roles: UserRole[]): UserRole => {
  return roles.reduce((highest, current) => 
    roleHierarchy[current] > roleHierarchy[highest] ? current : highest
  );
};