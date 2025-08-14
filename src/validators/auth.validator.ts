import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../utils/errors';

// Schema for registration
const registerSchema = z.object({
  body: z.object({
    email: z
      .string()
      .email('Invalid email format')
      .toLowerCase()
      .trim(),
    username: z
      .string()
      .min(3, 'Username must be at least 3 characters')
      .max(30, 'Username must not exceed 30 characters')
      .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores, and hyphens')
      .trim(),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/\d/, 'Password must contain at least one number'),
    confirmPassword: z.string(),
  }).refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  }),
});

// Schema for login
const loginSchema = z.object({
  body: z.object({
    emailOrUsername: z
      .string()
      .min(1, 'Email or username is required')
      .trim(),
    password: z
      .string()
      .min(1, 'Password is required'),
    rememberMe: z.boolean().optional(),
  }),
});

// Schema for refresh token
const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z
      .string()
      .min(1, 'Refresh token is required'),
  }),
});

// Schema for logout
const logoutSchema = z.object({
  body: z.object({
    refreshToken: z.string().optional(),
    logoutAll: z.boolean().optional(),
  }),
});

// Schema for change password
const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z
      .string()
      .min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/\d/, 'Password must contain at least one number'),
    confirmPassword: z.string(),
  }).refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  }).refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from current password',
    path: ['newPassword'],
  }),
});

// Schema for forgot password
const forgotPasswordSchema = z.object({
  body: z.object({
    email: z
      .string()
      .email('Invalid email format')
      .toLowerCase()
      .trim(),
  }),
});

// Schema for reset password
const resetPasswordSchema = z.object({
  body: z.object({
    token: z
      .string()
      .min(1, 'Reset token is required'),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/\d/, 'Password must contain at least one number'),
    confirmPassword: z.string(),
  }).refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  }),
});

// Schema for verify email
const verifyEmailSchema = z.object({
  query: z.object({
    token: z
      .string()
      .min(1, 'Verification token is required'),
  }),
});

// Schema for resend verification
const resendVerificationSchema = z.object({
  body: z.object({
    email: z
      .string()
      .email('Invalid email format')
      .toLowerCase()
      .trim(),
  }),
});

// Schema for enable 2FA
const enable2FASchema = z.object({
  body: z.object({
    password: z
      .string()
      .min(1, 'Password is required'),
  }),
});

// Schema for verify 2FA
const verify2FASchema = z.object({
  body: z.object({
    token: z
      .string()
      .length(6, 'OTP must be 6 digits')
      .regex(/^\d+$/, 'OTP must contain only numbers'),
  }),
});

// Schema for disable 2FA
const disable2FASchema = z.object({
  body: z.object({
    password: z
      .string()
      .min(1, 'Password is required'),
    token: z
      .string()
      .length(6, 'OTP must be 6 digits')
      .regex(/^\d+$/, 'OTP must contain only numbers'),
  }),
});

/**
 * Validation middleware factory
 */
const validate = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
        }));
        
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: errors,
          },
        });
      } else {
        next(error);
      }
    }
  };
};

// Export validation middlewares
export const validateRegister = validate(registerSchema);
export const validateLogin = validate(loginSchema);
export const validateRefreshToken = validate(refreshTokenSchema);
export const validateLogout = validate(logoutSchema);
export const validateChangePassword = validate(changePasswordSchema);
export const validateForgotPassword = validate(forgotPasswordSchema);
export const validateResetPassword = validate(resetPasswordSchema);
export const validateVerifyEmail = validate(verifyEmailSchema);
export const validateResendVerification = validate(resendVerificationSchema);
export const validateEnable2FA = validate(enable2FASchema);
export const validateVerify2FA = validate(verify2FASchema);
export const validateDisable2FA = validate(disable2FASchema);

// Export schemas for reuse
export {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  logoutSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  enable2FASchema,
  verify2FASchema,
  disable2FASchema,
};