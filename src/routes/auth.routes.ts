import { Router } from 'express';
import authController from '../controllers/auth.controller';
import { 
  authenticateToken, 
  optionalAuth,
  userRateLimit 
} from '../middleware/auth';
import { authRateLimiter } from '../middleware/security';
import {
  validateRegister,
  validateLogin,
  validateRefreshToken,
  validateLogout,
} from '../validators/auth.validator';

const router = Router();

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post(
  '/register',
  authRateLimiter,
  validateRegister,
  authController.register
);

/**
 * @route   POST /api/auth/login
 * @desc    Login user
 * @access  Public
 */
router.post(
  '/login',
  authRateLimiter,
  validateLogin,
  authController.login
);

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user
 * @access  Private (optional)
 */
router.post(
  '/logout',
  optionalAuth,
  validateLogout,
  authController.logout
);

/**
 * @route   POST /api/auth/refresh
 * @desc    Refresh access token
 * @access  Public
 */
router.post(
  '/refresh',
  validateRefreshToken,
  authController.refreshToken
);

/**
 * @route   GET /api/auth/profile
 * @desc    Get current user profile
 * @access  Private
 */
router.get(
  '/profile',
  authenticateToken,
  userRateLimit(),
  authController.getProfile
);

/**
 * @route   PUT /api/auth/profile
 * @desc    Update user profile
 * @access  Private
 */
router.put(
  '/profile',
  authenticateToken,
  userRateLimit(),
  authController.updateProfile
);

/**
 * @route   GET /api/auth/permissions
 * @desc    Get user permissions
 * @access  Private
 */
router.get(
  '/permissions',
  authenticateToken,
  authController.getPermissions
);

/**
 * @route   GET /api/auth/validate
 * @desc    Validate access token
 * @access  Private
 */
router.get(
  '/validate',
  authenticateToken,
  authController.validateToken
);

/**
 * @route   GET /api/auth/login-history
 * @desc    Get login history
 * @access  Private
 */
router.get(
  '/login-history',
  authenticateToken,
  userRateLimit(),
  authController.getLoginHistory
);

/**
 * @route   GET /api/auth/sessions
 * @desc    Get active sessions
 * @access  Private
 */
router.get(
  '/sessions',
  authenticateToken,
  userRateLimit(),
  authController.getActiveSessions
);

/**
 * @route   POST /api/auth/sessions/revoke
 * @desc    Revoke a session
 * @access  Private
 */
router.post(
  '/sessions/revoke',
  authenticateToken,
  userRateLimit(),
  authController.revokeSession
);

export default router;