import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { Types } from 'mongoose';
import { User, IUser } from '../models/User.model';
import { config } from '../config/environment';
import { createLogger } from '../utils/logger';
import { 
  ITokenPayload, 
  IAuthTokens, 
  ILoginResult,
  IRefreshTokenData 
} from '../types/auth';
import { getPermissionsForRoles } from '../config/rbac';
import { 
  AuthenticationError, 
  ValidationError, 
  ConflictError 
} from '../utils/errors';
import { UserRole } from '../types/enums';

const logger = createLogger('AuthService');

export class AuthService {
  private static instance: AuthService;
  
  private constructor() {}
  
  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }
  
  /**
   * Register a new user
   */
  async register(data: {
    email: string;
    username: string;
    password: string;
    deviceInfo?: string;
    ipAddress?: string;
  }): Promise<ILoginResult> {
    const { email, username, password, deviceInfo, ipAddress } = data;
    
    // Validate password strength
    this.validatePasswordStrength(password);
    
    // Check if user exists
    const existingUser = await User.findOne({
      $or: [
        { email: email.toLowerCase() },
        { username: username.toLowerCase() }
      ]
    });
    
    if (existingUser) {
      throw new ConflictError('User with this email or username already exists');
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, config.security.bcryptSaltRounds);
    
    // Create user
    const user = new User({
      email: email.toLowerCase(),
      username,
      passwordHash,
      roles: [UserRole.USER],
      permissions: [],
      lastActivity: new Date(),
    });
    
    // Generate tokens
    const sessionId = uuidv4();
    const tokens = await this.generateTokens(user, sessionId);
    
    // Save refresh token
    user.refreshTokens.push({
      token: tokens.refreshToken,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      deviceInfo,
    });
    
    // Log successful registration
    user.loginHistory.push({
      timestamp: new Date(),
      ipAddress: ipAddress || '',
      userAgent: deviceInfo || '',
      success: true,
    });
    
    await user.save();
    
    logger.info(`User registered successfully: ${user.email}`);
    
    return this.formatLoginResult(user, tokens);
  }
  
  /**
   * Login user
   */
  async login(data: {
    emailOrUsername: string;
    password: string;
    deviceInfo?: string;
    ipAddress?: string;
  }): Promise<ILoginResult> {
    const { emailOrUsername, password, deviceInfo, ipAddress } = data;
    
    // Find user
    const user = await User.findOne({
      $or: [
        { email: emailOrUsername.toLowerCase() },
        { username: emailOrUsername }
      ],
      isActive: true,
      isDeleted: false,
    }).select('+passwordHash +twoFactorSecret');
    
    if (!user) {
      throw new AuthenticationError('Invalid credentials');
    }
    
    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    
    // Log login attempt
    user.loginHistory.push({
      timestamp: new Date(),
      ipAddress: ipAddress || '',
      userAgent: deviceInfo || '',
      success: isPasswordValid,
    });
    
    // Limit login history to last 100 entries
    if (user.loginHistory.length > 100) {
      user.loginHistory = user.loginHistory.slice(-100);
    }
    
    if (!isPasswordValid) {
      await user.save();
      throw new AuthenticationError('Invalid credentials');
    }
    
    // Generate tokens
    const sessionId = uuidv4();
    const tokens = await this.generateTokens(user, sessionId);
    
    // Save refresh token
    user.refreshTokens.push({
      token: tokens.refreshToken,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      deviceInfo,
    });
    
    // Clean up old refresh tokens (keep max 5)
    if (user.refreshTokens.length > 5) {
      user.refreshTokens = user.refreshTokens.slice(-5);
    }
    
    // Update last activity
    user.lastActivity = new Date();
    
    await user.save();
    
    logger.info(`User logged in successfully: ${user.email}`);
    
    return this.formatLoginResult(user, tokens);
  }
  
  /**
   * Logout user
   */
  async logout(userId: string, refreshToken?: string): Promise<void> {
    const user = await User.findById(userId);
    
    if (!user) {
      throw new AuthenticationError('User not found');
    }
    
    if (refreshToken) {
      // Remove specific refresh token
      user.refreshTokens = user.refreshTokens.filter(
        rt => rt.token !== refreshToken
      );
    } else {
      // Remove all refresh tokens (logout from all devices)
      user.refreshTokens = [];
    }
    
    await user.save();
    
    logger.info(`User logged out: ${user.email}`);
  }
  
  /**
   * Refresh access token
   */
  async refreshToken(refreshToken: string): Promise<IAuthTokens> {
    try {
      // Verify refresh token
      const payload = jwt.verify(
        refreshToken,
        config.jwt.publicKey,
        { algorithms: ['RS256'] }
      ) as ITokenPayload;
      
      if (payload.type !== 'refresh') {
        throw new AuthenticationError('Invalid token type');
      }
      
      // Find user and validate refresh token
      const user = await User.findById(payload.userId);
      
      if (!user || !user.isActive) {
        throw new AuthenticationError('User not found or inactive');
      }
      
      // Check if refresh token exists and is not expired
      const tokenIndex = user.refreshTokens.findIndex(
        rt => rt.token === refreshToken && rt.expiresAt > new Date()
      );
      
      if (tokenIndex === -1) {
        throw new AuthenticationError('Invalid or expired refresh token');
      }
      
      // Generate new tokens (token rotation)
      const sessionId = payload.sessionId || uuidv4();
      const newTokens = await this.generateTokens(user, sessionId);
      
      // Replace old refresh token with new one
      user.refreshTokens[tokenIndex] = {
        token: newTokens.refreshToken,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        deviceInfo: user.refreshTokens[tokenIndex]?.deviceInfo,
      };
      
      // Update last activity
      user.lastActivity = new Date();
      
      await user.save();
      
      logger.info(`Tokens refreshed for user: ${user.email}`);
      
      return newTokens;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AuthenticationError('Refresh token expired');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AuthenticationError('Invalid refresh token');
      }
      throw error;
    }
  }
  
  /**
   * Verify access token
   */
  async verifyToken(token: string): Promise<ITokenPayload> {
    try {
      const payload = jwt.verify(
        token,
        config.jwt.publicKey,
        { algorithms: ['RS256'] }
      ) as ITokenPayload;
      
      if (payload.type !== 'access') {
        throw new AuthenticationError('Invalid token type');
      }
      
      return payload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AuthenticationError('Access token expired');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AuthenticationError('Invalid access token');
      }
      throw error;
    }
  }
  
  /**
   * Generate access and refresh tokens
   */
  private async generateTokens(user: IUser, sessionId: string): Promise<IAuthTokens> {
    const permissions = getPermissionsForRoles(user.roles);
    
    // Merge role permissions with user-specific permissions
    const allPermissions = [...new Set([...permissions, ...user.permissions])];
    
    const basePayload = {
      userId: user._id.toString(),
      email: user.email,
      username: user.username,
      roles: user.roles,
      permissions: allPermissions,
      sessionId,
    };
    
    // Generate access token (1 day)
    const accessToken = jwt.sign(
      { ...basePayload, type: 'access' } as ITokenPayload,
      config.jwt.privateKey,
      {
        algorithm: 'RS256',
        expiresIn: '1d', // Use hardcoded value or ensure config returns proper format
      }
    );
    
    // Generate refresh token (7 days)
    const refreshToken = jwt.sign(
      { ...basePayload, type: 'refresh' } as ITokenPayload,
      config.jwt.privateKey,
      {
        algorithm: 'RS256',
        expiresIn: '7d', // Use hardcoded value or ensure config returns proper format
      }
    );
    
    return {
      accessToken,
      refreshToken,
      expiresIn: 24 * 60 * 60, // 1 day in seconds
      refreshExpiresIn: 7 * 24 * 60 * 60, // 7 days in seconds
    };
  }
  
  /**
   * Format login result
   */
  private formatLoginResult(user: IUser, tokens: IAuthTokens): ILoginResult {
    return {
      user: {
        id: user._id.toString(),
        email: user.email,
        username: user.username,
        roles: user.roles,
        permissions: getPermissionsForRoles(user.roles),
        kycStatus: user.kycStatus,
        lastActivity: user.lastActivity,
      },
      tokens,
    };
  }
  
  /**
   * Validate password strength
   */
  private validatePasswordStrength(password: string): void {
    if (password.length < 8) {
      throw new ValidationError('Password must be at least 8 characters long');
    }
    
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
    
    if (!hasUpperCase || !hasLowerCase || !hasNumber) {
      throw new ValidationError(
        'Password must contain at least one uppercase letter, one lowercase letter, and one number'
      );
    }
    
    // Optional: Require special character for stronger security
    // if (!hasSpecialChar) {
    //   throw new ValidationError('Password must contain at least one special character');
    // }
  }
  
  /**
   * Validate email format
   */
  validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
  
  /**
   * Validate username format
   */
  validateUsername(username: string): boolean {
    const usernameRegex = /^[a-zA-Z0-9_-]{3,30}$/;
    return usernameRegex.test(username);
  }
  
  /**
   * Get user by ID with permissions
   */
  async getUserWithPermissions(userId: string): Promise<IUser | null> {
    const user = await User.findById(userId);
    
    if (!user) {
      return null;
    }
    
    // Attach computed permissions
    const rolePermissions = getPermissionsForRoles(user.roles);
    user.permissions = [...new Set([...rolePermissions, ...user.permissions])];
    
    return user;
  }
  
  /**
   * Update user roles
   */
  async updateUserRoles(userId: string, roles: UserRole[]): Promise<IUser> {
    const user = await User.findById(userId);
    
    if (!user) {
      throw new ValidationError('User not found');
    }
    
    user.roles = roles;
    await user.save();
    
    logger.info(`Updated roles for user ${user.email}: ${roles.join(', ')}`);
    
    return user;
  }
  
  /**
   * Add custom permission to user
   */
  async addUserPermission(userId: string, permission: string): Promise<IUser> {
    const user = await User.findById(userId);
    
    if (!user) {
      throw new ValidationError('User not found');
    }
    
    if (!user.permissions.includes(permission)) {
      user.permissions.push(permission);
      await user.save();
    }
    
    logger.info(`Added permission ${permission} to user ${user.email}`);
    
    return user;
  }
  
  /**
   * Remove custom permission from user
   */
  async removeUserPermission(userId: string, permission: string): Promise<IUser> {
    const user = await User.findById(userId);
    
    if (!user) {
      throw new ValidationError('User not found');
    }
    
    user.permissions = user.permissions.filter(p => p !== permission);
    await user.save();
    
    logger.info(`Removed permission ${permission} from user ${user.email}`);
    
    return user;
  }
}

export default AuthService.getInstance();