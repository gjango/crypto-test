import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import orderValidationService from './orderValidation.service';
import matchingEngineService from './matchingEngine.service';
import orderBookService from './orderBook.service';
import feedManagerService from './feedManager.service';
import { 
  IOrderRequest, 
  IOrder,
  OrderStatus,
  OrderType,
  OrderSide,
  TimeInForce,
  ITriggerMonitor
} from '../types/order';
import { Order } from '../models/Order.model';
import { Wallet } from '../models/Wallet.model';
import { Position } from '../models/Position.model';
import { toDecimal128 } from '../utils/database';
import mongoose from 'mongoose';

const logger = createLogger('OrderExecution');

export class OrderExecutionService extends EventEmitter {
  private static instance: OrderExecutionService;
  private triggerOrders: Map<string, ITriggerMonitor> = new Map();
  private ocoLinks: Map<string, string> = new Map(); // orderId -> linkedOrderId
  private trailingStops: Map<string, IOrder> = new Map();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private monitoringFrequency: number = 500; // 500ms
  
  private constructor() {
    super();
    this.setMaxListeners(1000);
    this.startTriggerMonitoring();
  }
  
  public static getInstance(): OrderExecutionService {
    if (!OrderExecutionService.instance) {
      OrderExecutionService.instance = new OrderExecutionService();
    }
    return OrderExecutionService.instance;
  }
  
  /**
   * Place new order
   */
  async placeOrder(orderRequest: IOrderRequest): Promise<IOrder | null> {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // 1. Validate order
      const validation = await orderValidationService.validateOrder(orderRequest);
      
      if (!validation.isValid) {
        logger.warn(`Order validation failed: ${validation.errors.join(', ')}`);
        await session.abortTransaction();
        
        this.emit('order_rejected', {
          request: orderRequest,
          errors: validation.errors,
        });
        
        return null;
      }
      
      // 2. Create order object
      const order: IOrder = {
        ...orderRequest,
        orderId: this.generateOrderId(),
        status: OrderStatus.PENDING,
        filledQuantity: 0,
        remainingQuantity: orderRequest.quantity,
        averagePrice: 0,
        fills: [],
        totalFee: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      // 3. Reserve balance
      await this.reserveBalance(order, session);
      
      // 4. Handle OCO orders
      if (order.ocoConfig) {
        const ocoResult = await this.handleOCOOrder(order, session);
        if (!ocoResult) {
          await session.abortTransaction();
          return null;
        }
      }
      
      // 5. Save order to database
      await this.saveOrder(order, session);
      
      // 6. Process based on order type
      let result = null;
      
      switch (order.type) {
        case OrderType.MARKET:
        case OrderType.LIMIT:
          // Submit to matching engine
          result = await matchingEngineService.submitOrder(order);
          break;
          
        case OrderType.STOP:
        case OrderType.STOP_LIMIT:
        case OrderType.TAKE_PROFIT:
          // Add to trigger monitoring
          await this.addTriggerOrder(order);
          order.status = OrderStatus.PENDING;
          break;
          
        case OrderType.TRAILING_STOP:
          // Add to trailing stop monitoring
          await this.addTrailingStop(order);
          order.status = OrderStatus.PENDING;
          break;
      }
      
      // 7. Update balances based on execution
      if (result && result.fills.length > 0) {
        await this.updateBalancesAfterExecution(order, result, session);
        await this.updatePositions(order, result, session);
      }
      
      // 8. Commit transaction
      await session.commitTransaction();
      
      // 9. Emit events
      this.emit('order_placed', order);
      
      if (result) {
        this.emit('order_executed', {
          order,
          result,
        });
      }
      
      logger.info(`Order ${order.orderId} placed successfully`);
      
      return order;
      
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error placing order', error);
      
      this.emit('order_error', {
        request: orderRequest,
        error: error.message,
      });
      
      return null;
    } finally {
      session.endSession();
    }
  }
  
  /**
   * Cancel order
   */
  async cancelOrder(orderId: string, userId: string, reason?: string): Promise<boolean> {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Get order
      const order = await Order.findOne({ orderId, userId }).session(session).lean() as unknown as IOrder | null;
      
      if (!order) {
        await session.abortTransaction();
        return false;
      }
      
      // Check if order can be cancelled
      if (order.status === OrderStatus.FILLED || order.status === OrderStatus.CANCELLED) {
        await session.abortTransaction();
        return false;
      }
      
      // Cancel via matching engine
      const cancelled = await matchingEngineService.cancelOrder(orderId, userId, reason);
      
      if (!cancelled) {
        await session.abortTransaction();
        return false;
      }
      
      // Release reserved balance
      await this.releaseBalance(order, session);
      
      // Handle OCO cancellation
      if (order.ocoConfig) {
        await this.cancelLinkedOCOOrder(order, session);
      }
      
      // Remove from trigger monitoring
      this.removeTriggerOrder(orderId);
      this.removeTrailingStop(orderId);
      
      await session.commitTransaction();
      
      this.emit('order_cancelled', { orderId, userId, reason });
      
      return true;
      
    } catch (error) {
      await session.abortTransaction();
      logger.error(`Error cancelling order ${orderId}`, error);
      return false;
    } finally {
      session.endSession();
    }
  }
  
  /**
   * Modify order
   */
  async modifyOrder(
    orderId: string, 
    userId: string, 
    modifications: { price?: number; quantity?: number; stopPrice?: number }
  ): Promise<boolean> {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Get order
      const order = await Order.findOne({ 
        orderId, 
        userId,
        status: { $in: [OrderStatus.OPEN, OrderStatus.PENDING] }
      }).session(session) as IOrder | null;
      
      if (!order) {
        await session.abortTransaction();
        return false;
      }
      
      // Validate modifications
      if (modifications.quantity && modifications.quantity <= order.filledQuantity) {
        await session.abortTransaction();
        logger.warn(`Cannot reduce quantity below filled amount`);
        return false;
      }
      
      // Apply modifications
      if (modifications.price !== undefined) {
        order.price = modifications.price;
      }
      
      if (modifications.quantity !== undefined) {
        const quantityDiff = modifications.quantity - order.quantity;
        order.quantity = modifications.quantity;
        order.remainingQuantity = modifications.quantity - order.filledQuantity;
        
        // Adjust reserved balance if quantity increased
        if (quantityDiff > 0) {
          await this.adjustReservedBalance(order, quantityDiff, session);
        }
      }
      
      if (modifications.stopPrice !== undefined) {
        order.stopPrice = modifications.stopPrice;
      }
      
      // Update in database
      await Order.updateOne(
        { orderId },
        {
          $set: {
            price: order.price ? toDecimal128(order.price) : undefined,
            quantity: toDecimal128(order.quantity),
            remainingQuantity: toDecimal128(order.remainingQuantity),
            stopPrice: order.stopPrice ? toDecimal128(order.stopPrice) : undefined,
            updatedAt: new Date(),
          }
        }
      ).session(session);
      
      // Update in order book if applicable
      if (order.status === OrderStatus.OPEN && order.type === OrderType.LIMIT) {
        orderBookService.updateOrder(order);
      }
      
      // Update trigger monitoring if applicable
      if (order.stopPrice && this.triggerOrders.has(orderId)) {
        const trigger = this.triggerOrders.get(orderId)!;
        trigger.triggerPrice = order.stopPrice;
      }
      
      await session.commitTransaction();
      
      this.emit('order_modified', { orderId, modifications });
      
      return true;
      
    } catch (error) {
      await session.abortTransaction();
      logger.error(`Error modifying order ${orderId}`, error);
      return false;
    } finally {
      session.endSession();
    }
  }
  
  /**
   * Get open orders
   */
  async getOpenOrders(userId: string, symbol?: string): Promise<IOrder[]> {
    const filter: any = {
      userId,
      status: { $in: [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED, OrderStatus.PENDING] },
    };
    
    if (symbol) {
      filter.symbol = symbol;
    }
    
    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    
    return orders as IOrder[];
  }
  
  /**
   * Get order history
   */
  async getOrderHistory(
    userId: string, 
    options: {
      symbol?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
    } = {}
  ): Promise<IOrder[]> {
    const filter: any = {
      userId,
      status: { $in: [OrderStatus.FILLED, OrderStatus.CANCELLED, OrderStatus.REJECTED] },
    };
    
    if (options.symbol) {
      filter.symbol = options.symbol;
    }
    
    if (options.startDate || options.endDate) {
      filter.createdAt = {};
      if (options.startDate) filter.createdAt.$gte = options.startDate;
      if (options.endDate) filter.createdAt.$lte = options.endDate;
    }
    
    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .limit(options.limit || 100)
      .lean();
    
    return orders as IOrder[];
  }
  
  /**
   * Generate order ID
   */
  private generateOrderId(): string {
    return `ORD-${Date.now()}-${uuidv4().substring(0, 8).toUpperCase()}`;
  }
  
  /**
   * Save order to database
   */
  private async saveOrder(order: IOrder, session: any): Promise<void> {
    await Order.create([{
      ...order,
      _id: new mongoose.Types.ObjectId(),
      quantity: toDecimal128(order.quantity),
      price: order.price ? toDecimal128(order.price) : undefined,
      stopPrice: order.stopPrice ? toDecimal128(order.stopPrice) : undefined,
      filledQuantity: toDecimal128(order.filledQuantity),
      remainingQuantity: toDecimal128(order.remainingQuantity),
      averagePrice: toDecimal128(order.averagePrice),
      totalFee: toDecimal128(order.totalFee),
    }], { session });
  }
  
  /**
   * Reserve balance for order
   */
  private async reserveBalance(order: IOrder, session: any): Promise<void> {
    const amount = await this.calculateRequiredBalance(order);
    
    if (order.side === OrderSide.BUY) {
      // Reserve USDT for buy orders
      await Wallet.updateOne(
        { userId: order.userId, 'balances.asset': 'USDT' },
        {
          $inc: {
            'balances.$.available': -amount,
            'balances.$.locked': amount,
          }
        }
      ).session(session);
    } else {
      // Reserve base asset for sell orders
      const market = await this.getMarket(order.symbol);
      await Wallet.updateOne(
        { userId: order.userId, 'balances.asset': market.baseAsset },
        {
          $inc: {
            'balances.$.available': -order.quantity,
            'balances.$.locked': order.quantity,
          }
        }
      ).session(session);
    }
  }
  
  /**
   * Release reserved balance
   */
  private async releaseBalance(order: IOrder, session: any): Promise<void> {
    if (order.side === OrderSide.BUY) {
      const remainingReserved = await this.calculateRequiredBalance(order) * 
        (order.remainingQuantity / order.quantity);
      
      await Wallet.updateOne(
        { userId: order.userId, 'balances.asset': 'USDT' },
        {
          $inc: {
            'balances.$.available': remainingReserved,
            'balances.$.locked': -remainingReserved,
          }
        }
      ).session(session);
    } else {
      await Wallet.updateOne(
        { userId: order.userId, 'balances.asset': (await this.getMarket(order.symbol)).baseAsset },
        {
          $inc: {
            'balances.$.available': order.remainingQuantity,
            'balances.$.locked': -order.remainingQuantity,
          }
        }
      ).session(session);
    }
  }
  
  /**
   * Calculate required balance
   */
  private async calculateRequiredBalance(order: IOrder): Promise<number> {
    let price = order.price;
    
    if (!price) {
      const marketPrice = feedManagerService.getCurrentPrice(order.symbol);
      price = marketPrice ? marketPrice.price : 0;
    }
    
    let required = price * order.quantity;
    
    // Add fees
    required *= 1.0004; // Add 0.04% for taker fee
    
    // If leverage, only need margin
    if (order.leverage && order.leverage > 1) {
      required = required / order.leverage;
    }
    
    return required;
  }
  
  /**
   * Update balances after execution
   */
  private async updateBalancesAfterExecution(order: IOrder, result: any, session: any): Promise<void> {
    const totalCost = result.totalExecutedQuantity * result.averageExecutionPrice;
    
    if (order.side === OrderSide.BUY) {
      // Deduct USDT and add base asset
      const market = await this.getMarket(order.symbol);
      
      // Update USDT balance
      await Wallet.updateOne(
        { userId: order.userId, 'balances.asset': 'USDT' },
        {
          $inc: {
            'balances.$.locked': -(totalCost + result.totalFees.taker),
            'balances.$.total': -(totalCost + result.totalFees.taker),
          }
        }
      ).session(session);
      
      // Update base asset balance
      await Wallet.updateOne(
        { userId: order.userId, 'balances.asset': market.baseAsset },
        {
          $inc: {
            'balances.$.available': result.totalExecutedQuantity,
            'balances.$.total': result.totalExecutedQuantity,
          }
        }
      ).session(session);
      
    } else {
      // Deduct base asset and add USDT
      const market = await this.getMarket(order.symbol);
      
      // Update base asset balance
      await Wallet.updateOne(
        { userId: order.userId, 'balances.asset': market.baseAsset },
        {
          $inc: {
            'balances.$.locked': -result.totalExecutedQuantity,
            'balances.$.total': -result.totalExecutedQuantity,
          }
        }
      ).session(session);
      
      // Update USDT balance
      await Wallet.updateOne(
        { userId: order.userId, 'balances.asset': 'USDT' },
        {
          $inc: {
            'balances.$.available': totalCost - result.totalFees.taker,
            'balances.$.total': totalCost - result.totalFees.taker,
          }
        }
      ).session(session);
    }
  }
  
  /**
   * Update positions after execution
   */
  private async updatePositions(order: IOrder, result: any, session: any): Promise<void> {
    if (!order.leverage || order.leverage <= 1) return;
    
    // Find existing position
    let position = await Position.findOne({
      userId: order.userId,
      symbol: order.symbol,
      status: 'open',
    }).session(session);
    
    if (!position) {
      // Create new position
      position = new Position({
        userId: order.userId,
        symbol: order.symbol,
        side: order.side === OrderSide.BUY ? 'LONG' : 'SHORT',
        quantity: toDecimal128(result.totalExecutedQuantity),
        entryPrice: toDecimal128(result.averageExecutionPrice),
        leverage: order.leverage,
        margin: toDecimal128((result.totalExecutedQuantity * result.averageExecutionPrice) / order.leverage),
        status: 'open',
        createdAt: new Date(),
      });
      
      await position.save({ session });
    } else {
      // Update existing position
      const newQuantity = position.quantity + result.totalExecutedQuantity;
      const newEntryPrice = (
        (position.quantity * position.entryPrice) + 
        (result.totalExecutedQuantity * result.averageExecutionPrice)
      ) / newQuantity;
      
      position.quantity = toDecimal128(newQuantity);
      position.entryPrice = toDecimal128(newEntryPrice);
      position.margin = toDecimal128((newQuantity * newEntryPrice) / order.leverage);
      position.updatedAt = new Date();
      
      await position.save({ session });
    }
    
    this.emit('position_updated', position);
  }
  
  /**
   * Add trigger order for monitoring
   */
  private async addTriggerOrder(order: IOrder): Promise<void> {
    if (!order.stopPrice) return;
    
    const trigger: ITriggerMonitor = {
      orderId: order.orderId,
      symbol: order.symbol,
      type: order.type === OrderType.TAKE_PROFIT ? 'TAKE_PROFIT' : 'STOP',
      triggerPrice: order.stopPrice,
      comparison: order.side === OrderSide.BUY ? 'LTE' : 'GTE',
      activated: false,
    };
    
    this.triggerOrders.set(order.orderId, trigger);
    
    logger.info(`Added trigger order ${order.orderId} at ${order.stopPrice}`);
  }
  
  /**
   * Remove trigger order
   */
  private removeTriggerOrder(orderId: string): void {
    this.triggerOrders.delete(orderId);
  }
  
  /**
   * Add trailing stop
   */
  private async addTrailingStop(order: IOrder): Promise<void> {
    this.trailingStops.set(order.orderId, order);
    logger.info(`Added trailing stop ${order.orderId}`);
  }
  
  /**
   * Remove trailing stop
   */
  private removeTrailingStop(orderId: string): void {
    this.trailingStops.delete(orderId);
  }
  
  /**
   * Start trigger monitoring
   */
  private startTriggerMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      this.checkTriggers();
      this.checkTrailingStops();
    }, this.monitoringFrequency);
  }
  
  /**
   * Check trigger orders
   */
  private async checkTriggers(): Promise<void> {
    for (const [orderId, trigger] of this.triggerOrders) {
      try {
        const currentPrice = feedManagerService.getCurrentPrice(trigger.symbol);
        if (!currentPrice) continue;
        
        const price = currentPrice.price;
        let shouldTrigger = false;
        
        if (trigger.comparison === 'GTE' && price >= trigger.triggerPrice) {
          shouldTrigger = true;
        } else if (trigger.comparison === 'LTE' && price <= trigger.triggerPrice) {
          shouldTrigger = true;
        }
        
        if (shouldTrigger && !trigger.activated) {
          trigger.activated = true;
          await this.executeTriggerOrder(orderId);
        }
        
        trigger.lastCheckedPrice = price;
      } catch (error) {
        logger.error(`Error checking trigger ${orderId}`, error);
      }
    }
  }
  
  /**
   * Execute trigger order
   */
  private async executeTriggerOrder(orderId: string): Promise<void> {
    const order = await Order.findOne({ orderId }).lean() as unknown as IOrder | null;
    if (!order) return;
    
    logger.info(`Executing triggered order ${orderId}`);
    
    // Convert to market or limit order
    if (order.type === OrderType.STOP) {
      order.type = OrderType.MARKET;
    } else if (order.type === OrderType.STOP_LIMIT) {
      order.type = OrderType.LIMIT;
    }
    
    order.status = OrderStatus.OPEN;
    order.triggeredAt = new Date();
    
    // Submit to matching engine
    await matchingEngineService.submitOrder(order);
    
    // Remove from triggers
    this.removeTriggerOrder(orderId);
    
    this.emit('order_triggered', order);
  }
  
  /**
   * Check trailing stops
   */
  private async checkTrailingStops(): Promise<void> {
    for (const [orderId, order] of this.trailingStops) {
      try {
        const currentPrice = feedManagerService.getCurrentPrice(order.symbol);
        if (!currentPrice) continue;
        
        const price = currentPrice.price;
        const config = order.trailingConfig!;
        
        // Check if activated
        if (config.activationPrice && !config.isActivated) {
          if (order.side === OrderSide.SELL && price >= config.activationPrice) {
            config.isActivated = true;
            config.highWaterMark = price;
          } else if (order.side === OrderSide.BUY && price <= config.activationPrice) {
            config.isActivated = true;
            config.highWaterMark = price;
          }
        }
        
        if (!config.isActivated && config.activationPrice) continue;
        
        // Update high water mark
        if (order.side === OrderSide.SELL) {
          config.highWaterMark = Math.max(config.highWaterMark || price, price);
          
          // Check trigger
          const triggerPrice = config.callbackRate 
            ? config.highWaterMark * (1 - config.callbackRate / 100)
            : config.highWaterMark - (config.trailingAmount || 0);
          
          if (price <= triggerPrice) {
            await this.executeTrailingStop(order);
          }
        } else {
          config.highWaterMark = Math.min(config.highWaterMark || price, price);
          
          // Check trigger
          const triggerPrice = config.callbackRate
            ? config.highWaterMark * (1 + config.callbackRate / 100)
            : config.highWaterMark + (config.trailingAmount || 0);
          
          if (price >= triggerPrice) {
            await this.executeTrailingStop(order);
          }
        }
      } catch (error) {
        logger.error(`Error checking trailing stop ${orderId}`, error);
      }
    }
  }
  
  /**
   * Execute trailing stop
   */
  private async executeTrailingStop(order: IOrder): Promise<void> {
    logger.info(`Executing trailing stop ${order.orderId}`);
    
    order.type = OrderType.MARKET;
    order.status = OrderStatus.OPEN;
    order.triggeredAt = new Date();
    
    await matchingEngineService.submitOrder(order);
    
    this.removeTrailingStop(order.orderId);
    
    this.emit('trailing_stop_triggered', order);
  }
  
  /**
   * Handle OCO order
   */
  private async handleOCOOrder(order: IOrder, session: any): Promise<boolean> {
    if (!order.ocoConfig?.otherSide) return false;
    
    const otherOrder: IOrder = {
      userId: order.userId,
      symbol: order.symbol,
      orderId: this.generateOrderId(),
      type: order.ocoConfig.otherSide.type,
      side: order.ocoConfig.otherSide.side,
      quantity: order.ocoConfig.otherSide.quantity,
      price: order.ocoConfig.otherSide.price,
      stopPrice: order.ocoConfig.otherSide.stopPrice,
      status: OrderStatus.PENDING,
      filledQuantity: 0,
      remainingQuantity: order.ocoConfig.otherSide.quantity,
      averagePrice: 0,
      fills: [],
      totalFee: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ocoConfig: {
        linkedOrderId: order.orderId,
        isPrimary: false,
      },
    };
    
    // Link orders
    order.ocoConfig.linkedOrderId = otherOrder.orderId;
    order.ocoConfig.isPrimary = true;
    
    this.ocoLinks.set(order.orderId, otherOrder.orderId);
    this.ocoLinks.set(otherOrder.orderId, order.orderId);
    
    // Save other order
    await this.saveOrder(otherOrder, session);
    
    // Add to appropriate monitoring
    if (otherOrder.type === OrderType.STOP || otherOrder.type === OrderType.STOP_LIMIT) {
      await this.addTriggerOrder(otherOrder);
    }
    
    return true;
  }
  
  /**
   * Cancel linked OCO order
   */
  private async cancelLinkedOCOOrder(order: IOrder, session: any): Promise<void> {
    const linkedOrderId = this.ocoLinks.get(order.orderId);
    if (!linkedOrderId) return;
    
    await matchingEngineService.cancelOrder(linkedOrderId, order.userId, 'OCO linked order cancelled');
    
    this.ocoLinks.delete(order.orderId);
    this.ocoLinks.delete(linkedOrderId);
    
    this.emit('oco_cancelled', { primary: order.orderId, linked: linkedOrderId });
  }
  
  /**
   * Adjust reserved balance
   */
  private async adjustReservedBalance(order: IOrder, quantityDiff: number, session: any): Promise<void> {
    const price = order.price || feedManagerService.getCurrentPrice(order.symbol)?.price || 0;
    const additionalRequired = price * quantityDiff * 1.0004;
    
    if (order.side === OrderSide.BUY) {
      await Wallet.updateOne(
        { userId: order.userId, 'balances.asset': 'USDT' },
        {
          $inc: {
            'balances.$.available': -additionalRequired,
            'balances.$.locked': additionalRequired,
          }
        }
      ).session(session);
    }
  }
  
  /**
   * Get market info
   */
  private async getMarket(symbol: string): Promise<any> {
    const { Market } = await import('../models/Market.model');
    return Market.findOne({ symbol }).lean();
  }
}

export default OrderExecutionService.getInstance();