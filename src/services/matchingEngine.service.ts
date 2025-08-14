import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import orderBookService from './orderBook.service';
import feedManagerService from './feedManager.service';
import { 
  IOrder, 
  IOrderFill,
  IMatchResult,
  OrderType,
  OrderSide,
  OrderStatus,
  TimeInForce
} from '../types/order';
import { Order } from '../models/Order.model';
import { Trade } from '../models/Trade.model';
import { toDecimal128 } from '../utils/database';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('MatchingEngine');

export class MatchingEngineService extends EventEmitter {
  private static instance: MatchingEngineService;
  private processingQueue: Map<string, IOrder[]> = new Map(); // symbol -> orders queue
  private isProcessing: boolean = false;
  private makerFeeRate: number = 0.0002; // 0.02%
  private takerFeeRate: number = 0.0004; // 0.04%
  private minTickSize: Map<string, number> = new Map(); // symbol -> tick size
  private minStepSize: Map<string, number> = new Map(); // symbol -> step size
  private orderBooks: Map<string, any> = new Map();
  private pausedMarkets: Set<string> = new Set();
  private orderQueue: IOrder[] = [];
  private executionQueue: any[] = [];
  private tickRate: number = 100;
  private processingInterval: NodeJS.Timeout | null = null;
  private ordersProcessed: number = 0;
  private tradesExecuted: number = 0;
  private averageMatchingTime: number = 0;
  
  private constructor() {
    super();
    this.setMaxListeners(1000);
  }
  
  public static getInstance(): MatchingEngineService {
    if (!MatchingEngineService.instance) {
      MatchingEngineService.instance = new MatchingEngineService();
    }
    return MatchingEngineService.instance;
  }
  
  /**
   * Submit order for matching
   */
  async submitOrder(order: IOrder): Promise<IMatchResult | null> {
    logger.info(`Processing order ${order.orderId} - ${order.type} ${order.side} ${order.quantity} @ ${order.price || 'MARKET'}`);
    
    // Add to processing queue
    if (!this.processingQueue.has(order.symbol)) {
      this.processingQueue.set(order.symbol, []);
    }
    this.processingQueue.get(order.symbol)!.push(order);
    
    // Process queue
    return this.processQueue(order.symbol);
  }
  
  /**
   * Process order queue for symbol
   */
  private async processQueue(symbol: string): Promise<IMatchResult | null> {
    const queue = this.processingQueue.get(symbol);
    if (!queue || queue.length === 0) return null;
    
    const order = queue.shift()!;
    
    try {
      let result: IMatchResult | null = null;
      
      switch (order.type) {
        case OrderType.MARKET:
          result = await this.matchMarketOrder(order);
          break;
          
        case OrderType.LIMIT:
          result = await this.matchLimitOrder(order);
          break;
          
        case OrderType.STOP:
        case OrderType.STOP_LIMIT:
          // These are conditional orders, added to trigger monitoring
          await this.addToTriggerMonitoring(order);
          break;
          
        default:
          logger.warn(`Unsupported order type: ${order.type}`);
      }
      
      // Process next in queue
      if (queue.length > 0) {
        setImmediate(() => this.processQueue(symbol));
      }
      
      return result;
    } catch (error) {
      logger.error(`Error processing order ${order.orderId}`, error);
      order.status = OrderStatus.REJECTED;
      order.rejectReason = 'Processing error';
      await this.updateOrderStatus(order);
      return null;
    }
  }
  
  /**
   * Match market order
   */
  private async matchMarketOrder(order: IOrder): Promise<IMatchResult | null> {
    const orderBook = orderBookService.getOrderBook(order.symbol);
    const oppositeSide = order.side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY;
    
    // Get current market price for reference
    const marketPrice = feedManagerService.getCurrentPrice(order.symbol);
    if (!marketPrice) {
      order.status = OrderStatus.REJECTED;
      order.rejectReason = 'No market price available';
      await this.updateOrderStatus(order);
      return null;
    }
    
    // Calculate market impact and get available liquidity
    const impact = orderBook['calculateMarketImpact'](oppositeSide, order.quantity);
    if (!impact || impact.totalQuantity < order.quantity * 0.1) {
      // Not enough liquidity (less than 10% can be filled)
      order.status = OrderStatus.REJECTED;
      order.rejectReason = 'Insufficient liquidity';
      await this.updateOrderStatus(order);
      return null;
    }
    
    // Apply slippage simulation
    const slippage = this.calculateSlippage(order.quantity, impact);
    const executionPrice = order.side === OrderSide.BUY 
      ? marketPrice.ask * (1 + slippage)
      : marketPrice.bid * (1 - slippage);
    
    // Create fills
    const fills: IOrderFill[] = [];
    const makerOrders: IOrder[] = [];
    let remainingQuantity = order.quantity;
    let totalExecutedQuantity = 0;
    let totalCost = 0;
    
    // Get order book depth
    const depth = orderBook.getDepth(50);
    const levels = order.side === OrderSide.BUY ? depth.asks : depth.bids;
    
    for (const level of levels) {
      if (remainingQuantity <= 0) break;
      
      for (const bookOrder of level.orders) {
        if (remainingQuantity <= 0) break;
        
        // Self-trade prevention
        if (bookOrder.userId === order.userId) {
          continue;
        }
        
        const fillQuantity = Math.min(remainingQuantity, bookOrder.quantity);
        const fillPrice = level.price;
        
        // Create fill for taker (market order)
        const takerFill: IOrderFill = {
          fillId: uuidv4(),
          price: fillPrice,
          quantity: fillQuantity,
          fee: fillQuantity * fillPrice * this.takerFeeRate,
          feeAsset: 'USDT',
          isMaker: false,
          timestamp: new Date(),
        };
        
        fills.push(takerFill);
        totalExecutedQuantity += fillQuantity;
        totalCost += fillQuantity * fillPrice;
        remainingQuantity -= fillQuantity;
        
        // Update maker order
        const makerOrder = await this.getMakerOrder(bookOrder.orderId);
        if (makerOrder) {
          const makerFill: IOrderFill = {
            fillId: uuidv4(),
            price: fillPrice,
            quantity: fillQuantity,
            fee: fillQuantity * fillPrice * this.makerFeeRate,
            feeAsset: 'USDT',
            isMaker: true,
            timestamp: new Date(),
          };
          
          makerOrder.fills.push(makerFill);
          makerOrder.filledQuantity += fillQuantity;
          makerOrder.remainingQuantity -= fillQuantity;
          makerOrder.status = makerOrder.remainingQuantity > 0 
            ? OrderStatus.PARTIALLY_FILLED 
            : OrderStatus.FILLED;
          
          if (makerOrder.status === OrderStatus.FILLED) {
            makerOrder.completedAt = new Date();
          }
          
          await this.updateOrderStatus(makerOrder);
          makerOrders.push(makerOrder);
          
          // Remove or update maker order in book
          if (makerOrder.status === OrderStatus.FILLED) {
            orderBookService.removeOrder(order.symbol, makerOrder.orderId, makerOrder.side);
          } else {
            orderBookService.updateOrder(makerOrder);
          }
        }
      }
    }
    
    // Update taker order
    order.fills = fills;
    order.filledQuantity = totalExecutedQuantity;
    order.remainingQuantity = order.quantity - totalExecutedQuantity;
    order.averagePrice = totalExecutedQuantity > 0 ? totalCost / totalExecutedQuantity : 0;
    order.totalFee = fills.reduce((sum, fill) => sum + fill.fee, 0);
    
    if (order.remainingQuantity === 0) {
      order.status = OrderStatus.FILLED;
      order.completedAt = new Date();
    } else if (totalExecutedQuantity > 0) {
      // Partial fill for IOC, cancel remaining
      if (order.timeInForce === TimeInForce.IOC) {
        order.status = OrderStatus.CANCELLED;
        order.cancelReason = 'IOC partial fill';
      } else {
        order.status = OrderStatus.PARTIALLY_FILLED;
      }
    } else {
      // No fill for FOK, cancel order
      if (order.timeInForce === TimeInForce.FOK) {
        order.status = OrderStatus.CANCELLED;
        order.cancelReason = 'FOK no fill';
      } else {
        order.status = OrderStatus.REJECTED;
        order.rejectReason = 'No matching orders';
      }
    }
    
    await this.updateOrderStatus(order);
    
    // Create trades
    await this.createTrades(order, makerOrders, fills);
    
    // Emit events
    this.emitMatchEvents(order, makerOrders, fills);
    
    return {
      takerOrder: order,
      makerOrders,
      fills,
      totalExecutedQuantity,
      averageExecutionPrice: order.averagePrice,
      totalFees: {
        taker: order.totalFee,
        makers: makerOrders.reduce((sum, o) => sum + o.totalFee, 0),
      },
    };
  }
  
  /**
   * Match limit order
   */
  private async matchLimitOrder(order: IOrder): Promise<IMatchResult | null> {
    if (!order.price) {
      order.status = OrderStatus.REJECTED;
      order.rejectReason = 'Limit order requires price';
      await this.updateOrderStatus(order);
      return null;
    }
    
    const orderBook = orderBookService.getOrderBook(order.symbol);
    const oppositeSide = order.side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY;
    
    // Check if order can be immediately matched
    const bestPrice = order.side === OrderSide.BUY 
      ? orderBook.getBestAsk()?.price 
      : orderBook.getBestBid()?.price;
    
    const canMatch = bestPrice && (
      (order.side === OrderSide.BUY && order.price >= bestPrice) ||
      (order.side === OrderSide.SELL && order.price <= bestPrice)
    );
    
    // Post-only check
    if (order.flags?.postOnly && canMatch) {
      order.status = OrderStatus.REJECTED;
      order.rejectReason = 'Post-only order would match';
      await this.updateOrderStatus(order);
      return null;
    }
    
    const fills: IOrderFill[] = [];
    const makerOrders: IOrder[] = [];
    let remainingQuantity = order.quantity;
    let totalExecutedQuantity = 0;
    let totalCost = 0;
    
    if (canMatch && !order.flags?.postOnly) {
      // Match against opposite side of book
      const depth = orderBook.getDepth(50);
      const levels = order.side === OrderSide.BUY ? depth.asks : depth.bids;
      
      for (const level of levels) {
        if (remainingQuantity <= 0) break;
        
        // Check if price is acceptable
        if (order.side === OrderSide.BUY && level.price > order.price) break;
        if (order.side === OrderSide.SELL && level.price < order.price) break;
        
        for (const bookOrder of level.orders) {
          if (remainingQuantity <= 0) break;
          
          // Self-trade prevention
          if (bookOrder.userId === order.userId) {
            continue;
          }
          
          const fillQuantity = Math.min(remainingQuantity, bookOrder.quantity);
          const fillPrice = level.price;
          
          // Create fill for taker
          const takerFill: IOrderFill = {
            fillId: uuidv4(),
            price: fillPrice,
            quantity: fillQuantity,
            fee: fillQuantity * fillPrice * this.takerFeeRate,
            feeAsset: 'USDT',
            isMaker: false,
            timestamp: new Date(),
          };
          
          fills.push(takerFill);
          totalExecutedQuantity += fillQuantity;
          totalCost += fillQuantity * fillPrice;
          remainingQuantity -= fillQuantity;
          
          // Update maker order
          const makerOrder = await this.getMakerOrder(bookOrder.orderId);
          if (makerOrder) {
            const makerFill: IOrderFill = {
              fillId: uuidv4(),
              price: fillPrice,
              quantity: fillQuantity,
              fee: fillQuantity * fillPrice * this.makerFeeRate,
              feeAsset: 'USDT',
              isMaker: true,
              timestamp: new Date(),
            };
            
            makerOrder.fills.push(makerFill);
            makerOrder.filledQuantity += fillQuantity;
            makerOrder.remainingQuantity -= fillQuantity;
            makerOrder.status = makerOrder.remainingQuantity > 0 
              ? OrderStatus.PARTIALLY_FILLED 
              : OrderStatus.FILLED;
            
            if (makerOrder.status === OrderStatus.FILLED) {
              makerOrder.completedAt = new Date();
            }
            
            await this.updateOrderStatus(makerOrder);
            makerOrders.push(makerOrder);
            
            // Remove or update maker order in book
            if (makerOrder.status === OrderStatus.FILLED) {
              orderBookService.removeOrder(order.symbol, makerOrder.orderId, makerOrder.side);
            } else {
              orderBookService.updateOrder(makerOrder);
            }
          }
        }
      }
    }
    
    // Update order
    order.fills = fills;
    order.filledQuantity = totalExecutedQuantity;
    order.remainingQuantity = order.quantity - totalExecutedQuantity;
    order.averagePrice = totalExecutedQuantity > 0 ? totalCost / totalExecutedQuantity : 0;
    order.totalFee = fills.reduce((sum, fill) => sum + fill.fee, 0);
    
    // Determine final status
    if (remainingQuantity === 0) {
      order.status = OrderStatus.FILLED;
      order.completedAt = new Date();
    } else if (order.timeInForce === TimeInForce.IOC) {
      order.status = totalExecutedQuantity > 0 ? OrderStatus.CANCELLED : OrderStatus.REJECTED;
      order.cancelReason = 'IOC not fully filled';
    } else if (order.timeInForce === TimeInForce.FOK && totalExecutedQuantity < order.quantity) {
      order.status = OrderStatus.CANCELLED;
      order.cancelReason = 'FOK not fully filled';
      // Revert all fills
      // TODO: Implement fill reversal
    } else if (totalExecutedQuantity > 0) {
      order.status = OrderStatus.PARTIALLY_FILLED;
      // Add remaining to order book
      orderBookService.addOrder(order);
    } else {
      order.status = OrderStatus.OPEN;
      // Add to order book
      orderBookService.addOrder(order);
    }
    
    await this.updateOrderStatus(order);
    
    // Create trades
    if (fills.length > 0) {
      await this.createTrades(order, makerOrders, fills);
    }
    
    // Emit events
    this.emitMatchEvents(order, makerOrders, fills);
    
    return fills.length > 0 ? {
      takerOrder: order,
      makerOrders,
      fills,
      totalExecutedQuantity,
      averageExecutionPrice: order.averagePrice,
      totalFees: {
        taker: order.totalFee,
        makers: makerOrders.reduce((sum, o) => sum + o.totalFee, 0),
      },
    } : null;
  }
  
  /**
   * Calculate slippage for market order
   */
  private calculateSlippage(quantity: number, impact: any): number {
    // Base slippage increases with order size
    const baseSlippage = 0.0001; // 0.01%
    const sizeMultiplier = Math.log10(1 + quantity / 1000);
    const levelMultiplier = Math.sqrt(impact.levels);
    
    return baseSlippage * sizeMultiplier * levelMultiplier;
  }
  
  /**
   * Get maker order from database
   */
  private async getMakerOrder(orderId: string): Promise<IOrder | null> {
    try {
      const order = await Order.findOne({ orderId }).lean();
      return order as IOrder | null;
    } catch (error) {
      logger.error(`Error fetching maker order ${orderId}`, error);
      return null;
    }
  }
  
  /**
   * Update order status in database
   */
  private async updateOrderStatus(order: IOrder): Promise<void> {
    try {
      await Order.updateOne(
        { orderId: order.orderId },
        {
          $set: {
            status: order.status,
            filledQuantity: toDecimal128(order.filledQuantity),
            remainingQuantity: toDecimal128(order.remainingQuantity),
            averagePrice: toDecimal128(order.averagePrice),
            totalFee: toDecimal128(order.totalFee),
            fills: order.fills,
            updatedAt: new Date(),
            completedAt: order.completedAt,
            cancelReason: order.cancelReason,
            rejectReason: order.rejectReason,
          },
        },
        { upsert: true }
      );
    } catch (error) {
      logger.error(`Error updating order ${order.orderId}`, error);
    }
  }
  
  /**
   * Create trade records
   */
  private async createTrades(
    takerOrder: IOrder, 
    makerOrders: IOrder[], 
    fills: IOrderFill[]
  ): Promise<void> {
    try {
      const trades = [];
      
      for (let i = 0; i < fills.length; i++) {
        const fill = fills[i];
        const makerOrder = makerOrders[i];
        
        if (!makerOrder) continue;
        
        trades.push({
          tradeId: fill.fillId,
          symbol: takerOrder.symbol,
          price: toDecimal128(fill.price),
          quantity: toDecimal128(fill.quantity),
          quoteQuantity: toDecimal128(fill.price * fill.quantity),
          side: takerOrder.side,
          buyerId: takerOrder.side === OrderSide.BUY ? takerOrder.userId : makerOrder.userId,
          sellerId: takerOrder.side === OrderSide.SELL ? takerOrder.userId : makerOrder.userId,
          buyOrderId: takerOrder.side === OrderSide.BUY ? takerOrder.orderId : makerOrder.orderId,
          sellOrderId: takerOrder.side === OrderSide.SELL ? takerOrder.orderId : makerOrder.orderId,
          isBuyerMaker: takerOrder.side === OrderSide.SELL,
          buyerFee: toDecimal128(takerOrder.side === OrderSide.BUY ? fill.fee : makerOrder.fills[makerOrder.fills.length - 1].fee),
          sellerFee: toDecimal128(takerOrder.side === OrderSide.SELL ? fill.fee : makerOrder.fills[makerOrder.fills.length - 1].fee),
          timestamp: fill.timestamp,
        });
      }
      
      if (trades.length > 0) {
        await Trade.insertMany(trades);
      }
    } catch (error) {
      logger.error('Error creating trades', error);
    }
  }
  
  /**
   * Add order to trigger monitoring
   */
  private async addToTriggerMonitoring(order: IOrder): Promise<void> {
    // This will be handled by a separate trigger monitoring service
    order.status = OrderStatus.PENDING;
    await this.updateOrderStatus(order);
    
    this.emit('trigger_order', order);
  }
  
  /**
   * Emit match events
   */
  private emitMatchEvents(
    takerOrder: IOrder, 
    makerOrders: IOrder[], 
    fills: IOrderFill[]
  ): void {
    // Emit order update events
    this.emit('order_update', takerOrder);
    makerOrders.forEach(order => this.emit('order_update', order));
    
    // Emit trade events
    fills.forEach((fill, index) => {
      this.emit('trade', {
        symbol: takerOrder.symbol,
        price: fill.price,
        quantity: fill.quantity,
        side: takerOrder.side,
        timestamp: fill.timestamp,
        takerOrderId: takerOrder.orderId,
        makerOrderId: makerOrders[index]?.orderId,
      });
    });
    
    // Emit fill events
    this.emit('fills', {
      takerOrder,
      makerOrders,
      fills,
    });
  }
  
  /**
   * Cancel order
   */
  async cancelOrder(orderId: string, userId: string, reason?: string): Promise<boolean> {
    try {
      const order = await Order.findOne({ orderId, userId }).lean() as unknown as IOrder | null;
      
      if (!order) {
        logger.warn(`Order ${orderId} not found for user ${userId}`);
        return false;
      }
      
      if (order.status === OrderStatus.FILLED || order.status === OrderStatus.CANCELLED) {
        logger.warn(`Cannot cancel order ${orderId} with status ${order.status}`);
        return false;
      }
      
      // Remove from order book
      if (order.status === OrderStatus.OPEN || order.status === OrderStatus.PARTIALLY_FILLED) {
        orderBookService.removeOrder(order.symbol, order.orderId, order.side);
      }
      
      // Update order status
      order.status = OrderStatus.CANCELLED;
      order.cancelReason = reason || 'User requested';
      order.completedAt = new Date();
      
      await this.updateOrderStatus(order);
      
      this.emit('order_cancelled', order);
      
      return true;
    } catch (error) {
      logger.error(`Error cancelling order ${orderId}`, error);
      return false;
    }
  }
  
  /**
   * Cancel all orders for user
   */
  async cancelAllOrders(userId: string, symbol?: string): Promise<number> {
    try {
      const filter: any = {
        userId,
        status: { $in: [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED, OrderStatus.PENDING] },
      };
      
      if (symbol) {
        filter.symbol = symbol;
      }
      
      const orders = await Order.find(filter).lean() as unknown as IOrder[];
      
      let cancelledCount = 0;
      for (const order of orders) {
        if (await this.cancelOrder(order.orderId, userId, 'Bulk cancel')) {
          cancelledCount++;
        }
      }
      
      return cancelledCount;
    } catch (error) {
      logger.error(`Error cancelling all orders for user ${userId}`, error);
      return 0;
    }
  }
  
  /**
   * Add market to tracking
   */
  addMarket(symbol: string): void {
    if (!this.orderBooks.has(symbol)) {
      this.orderBooks.set(symbol, {
        symbol,
        bids: [],
        asks: [],
        lastUpdate: new Date(),
      });
      logger.info(`Added market to matching engine: ${symbol}`);
    }
  }
  
  /**
   * Pause market
   */
  pauseMarket(symbol: string): void {
    this.pausedMarkets.add(symbol);
    logger.warn(`Market paused: ${symbol}`);
  }
  
  /**
   * Resume market
   */
  resumeMarket(symbol: string): void {
    this.pausedMarkets.delete(symbol);
    logger.info(`Market resumed: ${symbol}`);
  }
  
  /**
   * Pause all markets
   */
  pauseAllMarkets(): void {
    this.orderBooks.forEach((_, symbol) => {
      this.pausedMarkets.add(symbol);
    });
    logger.warn('All markets paused');
  }
  
  /**
   * Resume all markets
   */
  resumeAllMarkets(): void {
    this.pausedMarkets.clear();
    logger.info('All markets resumed');
  }
  
  /**
   * Clear all order books
   */
  clearAllOrderBooks(): void {
    this.orderBooks.forEach(orderBook => {
      orderBook.bids = [];
      orderBook.asks = [];
      orderBook.lastUpdate = new Date();
    });
    logger.warn('All order books cleared');
  }
  
  /**
   * Set tick rate
   */
  setTickRate(rate: number): void {
    this.tickRate = rate;
    
    // Restart processing with new rate
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = setInterval(() => {
        this.processBatch();
      }, this.tickRate);
    }
    
    logger.info(`Tick rate set to ${rate}ms`);
  }
  
  /**
   * Restart matching engine
   */
  restart(): void {
    logger.info('Restarting matching engine');
    
    // Stop processing
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    
    // Clear queues
    this.orderQueue.clear();
    this.executionQueue = [];
    
    // Restart processing
    this.startProcessing();
    
    logger.info('Matching engine restarted');
  }
  
  /**
   * Get metrics
   */
  getMetrics(): any {
    const totalOrders = Array.from(this.orderBooks.values()).reduce((sum, book) => {
      return sum + book.bids.length + book.asks.length;
    }, 0);
    
    return {
      ordersProcessed: this.ordersProcessed,
      tradesExecuted: this.tradesExecuted,
      averageLatency: this.averageMatchingTime,
      systemLoad: (totalOrders / 10000) * 100, // Assume 10k orders is 100% load
      orderBookDepth: totalOrders,
      pausedMarkets: Array.from(this.pausedMarkets),
    };
  }

  /**
   * Start order processing
   */
  private startProcessing(): void {
    if (!this.processingInterval) {
      this.processingInterval = setInterval(() => {
        this.processBatch();
      }, this.tickRate);
    }
  }

  /**
   * Process a batch of orders
   */
  private async processBatch(): Promise<void> {
    // Process orders from queue
    while (this.orderQueue.length > 0) {
      const order = this.orderQueue.shift();
      if (order) {
        // Process order logic here
        this.ordersProcessed++;
      }
    }
  }
}

export default MatchingEngineService.getInstance();