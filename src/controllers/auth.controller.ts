import { Request, Response, NextFunction } from 'express';
import authService from '../services/auth.service';
import { createLogger } from '../utils/logger';
import { asyncHandler } from '../middleware/errorHandler';

const logger = createLogger('AuthController');

export class AuthController {
  /**
   * Register a new user
   */
  register = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { email, username, password } = req.body;
    
    const result = await authService.register({
      email,
      username,
      password,
      deviceInfo: req.get('user-agent'),
      ipAddress: req.ip,
    });
    
    // Set refresh token as httpOnly cookie
    res.cookie('refreshToken', result.tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    
    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        user: result.user,
        accessToken: result.tokens.accessToken,
        expiresIn: result.tokens.expiresIn,
      },
    });
  });
  
  /**
   * Login user
   */
  login = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { emailOrUsername, password, rememberMe } = req.body;
    
    const result = await authService.login({
      emailOrUsername,
      password,
      deviceInfo: req.get('user-agent'),
      ipAddress: req.ip,
    });
    
    // Set refresh token as httpOnly cookie
    const maxAge = rememberMe 
      ? 30 * 24 * 60 * 60 * 1000 // 30 days
      : 7 * 24 * 60 * 60 * 1000;  // 7 days
    
    res.cookie('refreshToken', result.tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge,
    });
    
    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: result.user,
        accessToken: result.tokens.accessToken,
        expiresIn: result.tokens.expiresIn,
      },
    });
  });
  
  /**
   * Logout user
   */
  logout = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { refreshToken, logoutAll } = req.body;
    const cookieRefreshToken = req.cookies?.refreshToken;
    const token = refreshToken || cookieRefreshToken;
    
    if (req.user) {
      await authService.logout(
        req.user.userId,
        logoutAll ? undefined : token
      );
    }
    
    // Clear refresh token cookie
    res.clearCookie('refreshToken');
    
    res.json({
      success: true,
      message: logoutAll ? 'Logged out from all devices' : 'Logout successful',
    });
  });
  
  /**
   * Refresh access token
   */
  refreshToken = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { refreshToken } = req.body;
    const cookieRefreshToken = req.cookies?.refreshToken;
    const token = refreshToken || cookieRefreshToken;
    
    if (!token) {
      res.status(401).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_ERROR',
          message: 'Refresh token not provided',
        },
      });
      return;
    }
    
    const tokens = await authService.refreshToken(token);
    
    // Update refresh token cookie
    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    
    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
      },
    });
  });
  
  /**
   * Get current user profile
   */
  getProfile = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_ERROR',
          message: 'Not authenticated',
        },
      });
      return;
    }
    
    const user = await authService.getUserWithPermissions(req.user.userId);
    
    if (!user) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'User not found',
        },
      });
      return;
    }
    
    res.json({
      success: true,
      data: {
        id: user._id,
        email: user.email,
        username: user.username,
        roles: user.roles,
        permissions: user.permissions,
        kycStatus: user.kycStatus,
        tradingLimits: user.tradingLimits,
        preferences: user.preferences,
        createdAt: user.createdAt,
        lastActivity: user.lastActivity,
      },
    });
  });
  
  /**
   * Update user profile
   */
  updateProfile = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_ERROR',
          message: 'Not authenticated',
        },
      });
      return;
    }
    
    const { preferences } = req.body;
    
    const user = await authService.getUserWithPermissions(req.user.userId);
    
    if (!user) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'User not found',
        },
      });
      return;
    }
    
    // Update preferences
    if (preferences) {
      user.preferences = { ...user.preferences, ...preferences };
      await user.save();
    }
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        preferences: user.preferences,
      },
    });
  });
  
  /**
   * Get user permissions
   */
  getPermissions = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_ERROR',
          message: 'Not authenticated',
        },
      });
      return;
    }
    
    res.json({
      success: true,
      data: {
        roles: req.user.roles,
        permissions: req.user.permissions,
      },
    });
  });
  
  /**
   * Validate token
   */
  validateToken = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    // If we reach here, the token is valid (authenticated by middleware)
    res.json({
      success: true,
      message: 'Token is valid',
      data: {
        user: req.user,
      },
    });
  });
  
  /**
   * Get login history
   */
  getLoginHistory = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_ERROR',
          message: 'Not authenticated',
        },
      });
      return;
    }
    
    const user = await authService.getUserWithPermissions(req.user.userId);
    
    if (!user) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'User not found',
        },
      });
      return;
    }
    
    res.json({
      success: true,
      data: {
        loginHistory: user.loginHistory.slice(-20), // Last 20 login attempts
      },
    });
  });
  
  /**
   * Get active sessions
   */
  getActiveSessions = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_ERROR',
          message: 'Not authenticated',
        },
      });
      return;
    }
    
    const user = await authService.getUserWithPermissions(req.user.userId);
    
    if (!user) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'User not found',
        },
      });
      return;
    }
    
    const activeSessions = user.refreshTokens
      .filter(rt => rt.expiresAt > new Date())
      .map(rt => ({
        deviceInfo: rt.deviceInfo,
        createdAt: rt.createdAt,
        expiresAt: rt.expiresAt,
        isCurrent: rt.token === req.cookies?.refreshToken,
      }));
    
    res.json({
      success: true,
      data: {
        sessions: activeSessions,
      },
    });
  });
  
  /**
   * Revoke session
   */
  revokeSession = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_ERROR',
          message: 'Not authenticated',
        },
      });
      return;
    }
    
    const { sessionToken } = req.body;
    
    const user = await authService.getUserWithPermissions(req.user.userId);
    
    if (!user) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'User not found',
        },
      });
      return;
    }
    
    user.refreshTokens = user.refreshTokens.filter(rt => rt.token !== sessionToken);
    await user.save();
    
    res.json({
      success: true,
      message: 'Session revoked successfully',
    });
  });
}

export default new AuthController();