import { createLogger } from '../utils/logger';
import { 
  IOrderRequest, 
  IOrderValidation,
  OrderType,
  OrderSide,
  TimeInForce
} from '../types/order';
import { User } from '../models/User.model';
import { Wallet } from '../models/Wallet.model';
import { Market } from '../models/Market.model';
import { Position } from '../models/Position.model';
import { Order } from '../models/Order.model';
import feedManagerService from './feedManager.service';

const logger = createLogger('OrderValidation');

export class OrderValidationService {
  private static instance: OrderValidationService;
  
  // Validation limits
  private readonly MIN_ORDER_VALUE = 10; // $10 minimum
  private readonly MAX_ORDER_VALUE = 100000; // $100k maximum
  private readonly MAX_OPEN_ORDERS_PER_USER = 100;
  private readonly MAX_POSITIONS_PER_USER = 50;
  private readonly MAX_LEVERAGE = 20;
  private readonly MAKER_FEE_RATE = 0.0002;
  private readonly TAKER_FEE_RATE = 0.0004;
  
  private constructor() {}
  
  public static getInstance(): OrderValidationService {
    if (!OrderValidationService.instance) {
      OrderValidationService.instance = new OrderValidationService();
    }
    return OrderValidationService.instance;
  }
  
  /**
   * Validate order request
   */
  async validateOrder(orderRequest: IOrderRequest): Promise<IOrderValidation> {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    try {
      // 1. Validate user exists and is active
      const user = await this.validateUser(orderRequest.userId);
      if (!user) {
        errors.push('User not found or inactive');
        return this.createValidationResult(false, errors, warnings);
      }
      
      // 2. Validate market/symbol
      const market = await this.validateMarket(orderRequest.symbol);
      if (!market) {
        errors.push('Invalid or inactive market');
        return this.createValidationResult(false, errors, warnings);
      }
      
      // 3. Validate order type and parameters
      this.validateOrderType(orderRequest, errors);
      
      // 4. Validate price tick size
      if (orderRequest.price) {
        this.validatePriceTickSize(orderRequest.price, market.tickSize, errors);
      }
      
      // 5. Validate quantity step size
      this.validateQuantityStepSize(orderRequest.quantity, market.stepSize, errors);
      
      // 6. Validate minimum notional value
      const notionalValue = await this.calculateNotionalValue(orderRequest);
      if (notionalValue < market.minNotional) {
        errors.push(`Order value ${notionalValue.toFixed(2)} below minimum ${market.minNotional}`);
      }
      
      // 7. Validate maximum order value
      if (notionalValue > this.MAX_ORDER_VALUE) {
        errors.push(`Order value ${notionalValue.toFixed(2)} exceeds maximum ${this.MAX_ORDER_VALUE}`);
      }
      
      // 8. Check user order limits
      await this.validateOrderLimits(orderRequest.userId, errors, warnings);
      
      // 9. Validate sufficient balance
      const balanceCheck = await this.validateBalance(orderRequest, market, user);
      if (!balanceCheck.sufficient) {
        errors.push(`Insufficient balance. Required: ${balanceCheck.required?.toFixed(2)}, Available: ${balanceCheck.available?.toFixed(2)}`);
      }
      
      // 10. Validate leverage if margin trading
      if (orderRequest.leverage) {
        this.validateLeverage(orderRequest.leverage, market.maxLeverage, errors);
      }
      
      // 11. Check position limits for margin orders
      if (orderRequest.leverage && orderRequest.leverage > 1) {
        await this.validatePositionLimits(orderRequest.userId, orderRequest.symbol, errors, warnings);
      }
      
      // 12. Validate reduce-only orders
      if (orderRequest.flags?.reduceOnly) {
        await this.validateReduceOnly(orderRequest, errors);
      }
      
      // 13. Validate post-only orders
      if (orderRequest.flags?.postOnly && orderRequest.type === OrderType.MARKET) {
        errors.push('Post-only flag not allowed for market orders');
      }
      
      // 14. Validate close position orders
      if (orderRequest.flags?.closePosition) {
        await this.validateClosePosition(orderRequest, errors);
      }
      
      // 15. Validate OCO orders
      if (orderRequest.ocoConfig) {
        this.validateOCOOrder(orderRequest, errors);
      }
      
      // 16. Validate trailing stop
      if (orderRequest.type === OrderType.TRAILING_STOP) {
        this.validateTrailingStop(orderRequest, errors);
      }
      
      // 17. Calculate estimated fees
      const estimatedFees = this.calculateEstimatedFees(notionalValue);
      
      // 18. Calculate estimated slippage for market orders
      let estimatedSlippage = 0;
      if (orderRequest.type === OrderType.MARKET) {
        estimatedSlippage = await this.estimateSlippage(orderRequest);
        if (estimatedSlippage > 0.01) { // > 1% slippage
          warnings.push(`High slippage warning: ${(estimatedSlippage * 100).toFixed(2)}%`);
        }
      }
      
      const isValid = errors.length === 0;
      
      return {
        isValid,
        errors,
        warnings,
        estimatedFees,
        estimatedSlippage,
        requiredMargin: balanceCheck.required,
        availableBalance: balanceCheck.available,
      };
      
    } catch (error) {
      logger.error('Order validation error', error);
      errors.push('Validation error occurred');
      return this.createValidationResult(false, errors, warnings);
    }
  }
  
  /**
   * Validate user
   */
  private async validateUser(userId: string): Promise<any> {
    const user = await User.findById(userId).lean();
    return user && user.status === 'active' ? user : null;
  }
  
  /**
   * Validate market
   */
  private async validateMarket(symbol: string): Promise<any> {
    const market = await Market.findOne({ symbol, status: 'active' }).lean();
    return market;
  }
  
  /**
   * Validate order type and required parameters
   */
  private validateOrderType(orderRequest: IOrderRequest, errors: string[]): void {
    switch (orderRequest.type) {
      case OrderType.LIMIT:
        if (!orderRequest.price) {
          errors.push('Limit order requires price');
        }
        break;
        
      case OrderType.STOP:
        if (!orderRequest.stopPrice) {
          errors.push('Stop order requires stop price');
        }
        break;
        
      case OrderType.STOP_LIMIT:
        if (!orderRequest.price || !orderRequest.stopPrice) {
          errors.push('Stop-limit order requires both price and stop price');
        }
        break;
        
      case OrderType.TAKE_PROFIT:
        if (!orderRequest.stopPrice) {
          errors.push('Take-profit order requires stop price');
        }
        break;
        
      case OrderType.TRAILING_STOP:
        if (!orderRequest.trailingConfig) {
          errors.push('Trailing stop order requires trailing configuration');
        }
        break;
        
      case OrderType.OCO:
        if (!orderRequest.ocoConfig) {
          errors.push('OCO order requires OCO configuration');
        }
        break;
    }
    
    // Validate time in force
    if (orderRequest.timeInForce === TimeInForce.FOK && orderRequest.type === OrderType.LIMIT) {
      if (orderRequest.flags?.postOnly) {
        errors.push('FOK orders cannot be post-only');
      }
    }
  }
  
  /**
   * Validate price tick size
   */
  private validatePriceTickSize(price: number, tickSize: number, errors: string[]): void {
    const remainder = price % tickSize;
    if (remainder > 0.00000001) { // Small epsilon for floating point
      errors.push(`Price ${price} not aligned with tick size ${tickSize}`);
    }
  }
  
  /**
   * Validate quantity step size
   */
  private validateQuantityStepSize(quantity: number, stepSize: number, errors: string[]): void {
    const remainder = quantity % stepSize;
    if (remainder > 0.00000001) { // Small epsilon for floating point
      errors.push(`Quantity ${quantity} not aligned with step size ${stepSize}`);
    }
  }
  
  /**
   * Calculate notional value
   */
  private async calculateNotionalValue(orderRequest: IOrderRequest): Promise<number> {
    let price = orderRequest.price;
    
    if (!price) {
      // Get current market price for market orders
      const marketPrice = feedManagerService.getCurrentPrice(orderRequest.symbol);
      price = marketPrice ? marketPrice.price : 0;
    }
    
    return price * orderRequest.quantity;
  }
  
  /**
   * Validate order limits
   */
  private async validateOrderLimits(userId: string, errors: string[], warnings: string[]): Promise<void> {
    const openOrderCount = await Order.countDocuments({
      userId,
      status: { $in: ['OPEN', 'PARTIALLY_FILLED', 'PENDING'] },
    });
    
    if (openOrderCount >= this.MAX_OPEN_ORDERS_PER_USER) {
      errors.push(`Maximum open orders limit reached (${this.MAX_OPEN_ORDERS_PER_USER})`);
    } else if (openOrderCount > this.MAX_OPEN_ORDERS_PER_USER * 0.8) {
      warnings.push(`Approaching maximum open orders limit (${openOrderCount}/${this.MAX_OPEN_ORDERS_PER_USER})`);
    }
  }
  
  /**
   * Validate balance
   */
  private async validateBalance(
    orderRequest: IOrderRequest, 
    market: any, 
    user: any
  ): Promise<{ sufficient: boolean; required?: number; available?: number }> {
    const wallet = await Wallet.findOne({ userId: orderRequest.userId }).lean();
    
    if (!wallet) {
      return { sufficient: false, required: 0, available: 0 };
    }
    
    const notionalValue = await this.calculateNotionalValue(orderRequest);
    let requiredBalance = 0;
    
    if (orderRequest.side === OrderSide.BUY) {
      // For buy orders, need USDT
      requiredBalance = notionalValue;
      
      // Add estimated fees
      requiredBalance += notionalValue * this.TAKER_FEE_RATE;
      
      // If margin trading, only need initial margin
      if (orderRequest.leverage && orderRequest.leverage > 1) {
        requiredBalance = requiredBalance / orderRequest.leverage;
      }
      
      const availableBalance = wallet.balances.find(b => b.asset === 'USDT')?.available || 0;
      
      return {
        sufficient: availableBalance >= requiredBalance,
        required: requiredBalance,
        available: availableBalance,
      };
    } else {
      // For sell orders, need the asset
      const baseAsset = market.baseAsset;
      requiredBalance = orderRequest.quantity;
      
      const availableBalance = wallet.balances.find(b => b.asset === baseAsset)?.available || 0;
      
      return {
        sufficient: availableBalance >= requiredBalance,
        required: requiredBalance,
        available: availableBalance,
      };
    }
  }
  
  /**
   * Validate leverage
   */
  private validateLeverage(leverage: number, maxLeverage: number, errors: string[]): void {
    if (leverage < 1) {
      errors.push('Leverage must be at least 1');
    }
    
    if (leverage > maxLeverage) {
      errors.push(`Leverage ${leverage}x exceeds maximum ${maxLeverage}x`);
    }
  }
  
  /**
   * Validate position limits
   */
  private async validatePositionLimits(userId: string, symbol: string, errors: string[], warnings: string[]): Promise<void> {
    const positionCount = await Position.countDocuments({
      userId,
      status: 'open',
    });
    
    if (positionCount >= this.MAX_POSITIONS_PER_USER) {
      errors.push(`Maximum positions limit reached (${this.MAX_POSITIONS_PER_USER})`);
    } else if (positionCount > this.MAX_POSITIONS_PER_USER * 0.8) {
      warnings.push(`Approaching maximum positions limit (${positionCount}/${this.MAX_POSITIONS_PER_USER})`);
    }
    
    // Check existing position in same symbol
    const existingPosition = await Position.findOne({
      userId,
      symbol,
      status: 'open',
    }).lean();
    
    if (existingPosition) {
      warnings.push(`Existing position found in ${symbol}. Order will modify position.`);
    }
  }
  
  /**
   * Validate reduce-only order
   */
  private async validateReduceOnly(orderRequest: IOrderRequest, errors: string[]): Promise<void> {
    const position = await Position.findOne({
      userId: orderRequest.userId,
      symbol: orderRequest.symbol,
      status: 'open',
    }).lean();
    
    if (!position) {
      errors.push('No open position found for reduce-only order');
      return;
    }
    
    // Check if order side reduces position
    const isReducing = (position.side === 'LONG' && orderRequest.side === OrderSide.SELL) ||
                      (position.side === 'SHORT' && orderRequest.side === OrderSide.BUY);
    
    if (!isReducing) {
      errors.push('Reduce-only order must be opposite side of position');
    }
    
    // Check quantity doesn't exceed position size
    if (orderRequest.quantity > position.quantity) {
      errors.push(`Reduce-only quantity ${orderRequest.quantity} exceeds position size ${position.quantity}`);
    }
  }
  
  /**
   * Validate close position order
   */
  private async validateClosePosition(orderRequest: IOrderRequest, errors: string[]): Promise<void> {
    const position = await Position.findOne({
      userId: orderRequest.userId,
      symbol: orderRequest.symbol,
      status: 'open',
    }).lean();
    
    if (!position) {
      errors.push('No open position found to close');
      return;
    }
    
    // For close position, order type must be MARKET
    if (orderRequest.type !== OrderType.MARKET) {
      errors.push('Close position flag only allowed for market orders');
    }
  }
  
  /**
   * Validate OCO order
   */
  private validateOCOOrder(orderRequest: IOrderRequest, errors: string[]): void {
    const config = orderRequest.ocoConfig!;
    
    if (!config.otherSide) {
      errors.push('OCO order requires other side configuration');
      return;
    }
    
    // Validate other side has required parameters
    if (config.otherSide.type === OrderType.LIMIT && !config.otherSide.price) {
      errors.push('OCO limit order requires price');
    }
    
    if ((config.otherSide.type === OrderType.STOP || config.otherSide.type === OrderType.STOP_LIMIT) && 
        !config.otherSide.stopPrice) {
      errors.push('OCO stop order requires stop price');
    }
    
    // Validate sides are opposite
    if (config.otherSide.side === orderRequest.side) {
      errors.push('OCO orders must have opposite sides');
    }
  }
  
  /**
   * Validate trailing stop
   */
  private validateTrailingStop(orderRequest: IOrderRequest, errors: string[]): void {
    const config = orderRequest.trailingConfig!;
    
    if (!config.callbackRate && !config.trailingAmount) {
      errors.push('Trailing stop requires callback rate or trailing amount');
    }
    
    if (config.callbackRate) {
      if (config.callbackRate < 0.1 || config.callbackRate > 50) {
        errors.push('Callback rate must be between 0.1% and 50%');
      }
    }
    
    if (config.activationPrice && orderRequest.price) {
      // Validate activation price makes sense
      if (orderRequest.side === OrderSide.SELL && config.activationPrice < orderRequest.price) {
        errors.push('Sell trailing stop activation price must be above current price');
      }
      if (orderRequest.side === OrderSide.BUY && config.activationPrice > orderRequest.price) {
        errors.push('Buy trailing stop activation price must be below current price');
      }
    }
  }
  
  /**
   * Calculate estimated fees
   */
  private calculateEstimatedFees(notionalValue: number): { maker: number; taker: number } {
    return {
      maker: notionalValue * this.MAKER_FEE_RATE,
      taker: notionalValue * this.TAKER_FEE_RATE,
    };
  }
  
  /**
   * Estimate slippage for market order
   */
  private async estimateSlippage(orderRequest: IOrderRequest): Promise<number> {
    // Simple slippage estimation based on order size
    // In production, this would analyze order book depth
    const notionalValue = await this.calculateNotionalValue(orderRequest);
    
    if (notionalValue < 1000) return 0.0001; // 0.01%
    if (notionalValue < 10000) return 0.0005; // 0.05%
    if (notionalValue < 50000) return 0.001; // 0.1%
    return 0.002; // 0.2%
  }
  
  /**
   * Create validation result
   */
  private createValidationResult(
    isValid: boolean, 
    errors: string[], 
    warnings: string[]
  ): IOrderValidation {
    return {
      isValid,
      errors,
      warnings,
    };
  }
}

export default OrderValidationService.getInstance();