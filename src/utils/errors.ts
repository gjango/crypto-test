export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  INVALID_ORDER = 'INVALID_ORDER',
  POSITION_NOT_FOUND = 'POSITION_NOT_FOUND',
  MARKET_CLOSED = 'MARKET_CLOSED',
  LIQUIDATION_ERROR = 'LIQUIDATION_ERROR',
  MAX_LEVERAGE_EXCEEDED = 'MAX_LEVERAGE_EXCEEDED',
  ORDER_SIZE_ERROR = 'ORDER_SIZE_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: any;

  constructor(
    message: string,
    code: ErrorCode,
    statusCode: number,
    isOperational = true,
    details?: any
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;

    Object.setPrototypeOf(this, AppError.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, ErrorCode.VALIDATION_ERROR, 400, true, details);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed') {
    super(message, ErrorCode.AUTHENTICATION_ERROR, 401, true);
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, ErrorCode.AUTHORIZATION_ERROR, 403, true);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, ErrorCode.NOT_FOUND, 404, true);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, ErrorCode.CONFLICT, 409, true);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests') {
    super(message, ErrorCode.RATE_LIMIT_ERROR, 429, true);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, details?: any) {
    super(message, ErrorCode.DATABASE_ERROR, 500, false, details);
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string) {
    super(`External service error (${service}): ${message}`, ErrorCode.EXTERNAL_SERVICE_ERROR, 502, false);
  }
}

export class InsufficientBalanceError extends AppError {
  constructor(available: number, required: number) {
    super(
      `Insufficient balance. Available: ${available}, Required: ${required}`,
      ErrorCode.INSUFFICIENT_BALANCE,
      400,
      true,
      { available, required }
    );
  }
}

export class InvalidOrderError extends AppError {
  constructor(message: string, details?: any) {
    super(message, ErrorCode.INVALID_ORDER, 400, true, details);
  }
}

export class PositionNotFoundError extends AppError {
  constructor(positionId: string) {
    super(`Position ${positionId} not found`, ErrorCode.POSITION_NOT_FOUND, 404, true);
  }
}

export class MarketClosedError extends AppError {
  constructor(symbol: string) {
    super(`Market is closed for ${symbol}`, ErrorCode.MARKET_CLOSED, 400, true);
  }
}

export class LiquidationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, ErrorCode.LIQUIDATION_ERROR, 400, true, details);
  }
}

export class MaxLeverageExceededError extends AppError {
  constructor(requested: number, maximum: number) {
    super(
      `Requested leverage ${requested}x exceeds maximum ${maximum}x`,
      ErrorCode.MAX_LEVERAGE_EXCEEDED,
      400,
      true,
      { requested, maximum }
    );
  }
}

export class OrderSizeError extends AppError {
  constructor(message: string, details?: any) {
    super(message, ErrorCode.ORDER_SIZE_ERROR, 400, true, details);
  }
}

export const isAppError = (error: any): error is AppError => {
  return error instanceof AppError;
};

export const isTrustedError = (error: any): boolean => {
  if (isAppError(error)) {
    return error.isOperational;
  }
  return false;
};