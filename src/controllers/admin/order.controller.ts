import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../../utils/logger';
import { castDocument, castDocuments } from '../../utils/mongooseHelpers';
import orderExecutionService from '../../services/orderExecution.service';
import matchingEngineService from '../../services/matchingEngine.service';
import orderBookService from '../../services/orderBook.service';
import { Order } from '../../models/Order.model';
import { Trade } from '../../models/Trade.model';
import { Wallet } from '../../models/Wallet.model';
import { 
  IOrderRequest,
  IOrder,
  IOrderFill,
  OrderType,
  OrderSide,
  OrderStatus,
  TimeInForce
} from '../../types/order';
import { toDecimal128 } from '../../utils/database';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';

const logger = createLogger('AdminOrderController');

/**
 * Force fill order at any price
 */
export const forceFillOrder = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { orderId, price, quantity } = req.body;
    
    if (!orderId || !price || !quantity) {
      await session.abortTransaction();
      res.status(400).json({
        success: false,
        message: 'Missing required parameters',
      });
      return;
    }
    
    // Get order
    const order = await Order.findOne({ orderId }).session(session).lean() as unknown as IOrder | null;
    
    if (!order) {
      await session.abortTransaction();
      res.status(404).json({
        success: false,
        message: 'Order not found',
      });
      return;
    }
    
    // Create fill
    const fillQuantity = Math.min(quantity, order.remainingQuantity);
    const fill: IOrderFill = {
      fillId: uuidv4(),
      price,
      quantity: fillQuantity,
      fee: fillQuantity * price * 0.0004, // Taker fee
      feeAsset: 'USDT',
      isMaker: false,
      timestamp: new Date(),
    };
    
    // Update order
    await Order.updateOne(
      { orderId },
      {
        $push: { fills: fill },
        $inc: {
          filledQuantity: fillQuantity,
          remainingQuantity: -fillQuantity,
          totalFee: fill.fee,
        },
        $set: {
          status: order.remainingQuantity - fillQuantity <= 0 ? OrderStatus.FILLED : OrderStatus.PARTIALLY_FILLED,
          averagePrice: toDecimal128(
            ((order.filledQuantity * order.averagePrice) + (fillQuantity * price)) /
            (order.filledQuantity + fillQuantity)
          ),
          updatedAt: new Date(),
          completedAt: order.remainingQuantity - fillQuantity <= 0 ? new Date() : undefined,
        },
      }
    ).session(session);
    
    // Update balances
    await updateBalancesForForceFill(order, fill, session);
    
    // Create trade record
    await Trade.create([{
      tradeId: fill.fillId,
      symbol: order.symbol,
      price: toDecimal128(price),
      quantity: toDecimal128(fillQuantity),
      quoteQuantity: toDecimal128(price * fillQuantity),
      side: order.side,
      buyerId: order.side === OrderSide.BUY ? order.userId : 'ADMIN',
      sellerId: order.side === OrderSide.SELL ? order.userId : 'ADMIN',
      buyOrderId: order.side === OrderSide.BUY ? order.orderId : 'ADMIN_FILL',
      sellOrderId: order.side === OrderSide.SELL ? order.orderId : 'ADMIN_FILL',
      isBuyerMaker: false,
      buyerFee: toDecimal128(order.side === OrderSide.BUY ? fill.fee : 0),
      sellerFee: toDecimal128(order.side === OrderSide.SELL ? fill.fee : 0),
      timestamp: new Date(),
    }], { session });
    
    await session.commitTransaction();
    
    logger.warn(`Admin force filled order ${orderId} at price ${price} for quantity ${fillQuantity}`);
    
    res.json({
      success: true,
      message: `Force filled ${fillQuantity} at ${price}`,
      data: {
        orderId,
        fillQuantity,
        price,
        totalValue: fillQuantity * price,
      },
    });
    
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

/**
 * Modify any order parameter
 */
export const modifyAnyOrder = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { orderId } = req.params;
    const modifications = req.body;
    
    const order = await Order.findOne({ orderId }).lean() as unknown as IOrder | null;
    
    if (!order) {
      res.status(404).json({
        success: false,
        message: 'Order not found',
      });
      return;
    }
    
    // Build update object
    const updateObj: any = { updatedAt: new Date() };
    
    if (modifications.price !== undefined) {
      updateObj.price = toDecimal128(modifications.price);
    }
    
    if (modifications.quantity !== undefined) {
      updateObj.quantity = toDecimal128(modifications.quantity);
      updateObj.remainingQuantity = toDecimal128(modifications.quantity - order.filledQuantity);
    }
    
    if (modifications.stopPrice !== undefined) {
      updateObj.stopPrice = toDecimal128(modifications.stopPrice);
    }
    
    if (modifications.status !== undefined) {
      updateObj.status = modifications.status;
    }
    
    if (modifications.type !== undefined) {
      updateObj.type = modifications.type;
    }
    
    if (modifications.side !== undefined) {
      updateObj.side = modifications.side;
    }
    
    if (modifications.timeInForce !== undefined) {
      updateObj.timeInForce = modifications.timeInForce;
    }
    
    // Update order
    await Order.updateOne({ orderId }, { $set: updateObj });
    
    // Update in order book if necessary
    if (order.status === OrderStatus.OPEN && order.type === OrderType.LIMIT) {
      const updatedOrder = { ...order, ...modifications };
      orderBookService.updateOrder(updatedOrder);
    }
    
    logger.warn(`Admin modified order ${orderId}`, modifications);
    
    res.json({
      success: true,
      message: 'Order modified successfully',
      modifications,
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Cancel any user's orders
 */
export const cancelAnyOrder = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;
    
    const order = await Order.findOne({ orderId }).lean() as unknown as IOrder | null;
    
    if (!order) {
      res.status(404).json({
        success: false,
        message: 'Order not found',
      });
      return;
    }
    
    // Cancel order
    const cancelled = await matchingEngineService.cancelOrder(
      orderId, 
      order.userId, 
      reason || 'Admin cancelled'
    );
    
    if (!cancelled) {
      res.status(400).json({
        success: false,
        message: 'Failed to cancel order',
      });
      return;
    }
    
    logger.warn(`Admin cancelled order ${orderId} for user ${order.userId}`);
    
    res.json({
      success: true,
      message: 'Order cancelled successfully',
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Cancel all orders for a user
 */
export const cancelUserOrders = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId } = req.params;
    const { symbol, reason } = req.body;
    
    const cancelledCount = await matchingEngineService.cancelAllOrders(
      userId, 
      symbol
    );
    
    logger.warn(`Admin cancelled ${cancelledCount} orders for user ${userId}`);
    
    res.json({
      success: true,
      message: `Cancelled ${cancelledCount} orders`,
      count: cancelledCount,
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Inject order for testing
 */
export const injectTestOrder = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const orderRequest: IOrderRequest = {
      userId: req.body.userId || 'TEST_USER',
      symbol: req.body.symbol,
      type: req.body.type as OrderType,
      side: req.body.side as OrderSide,
      quantity: parseFloat(req.body.quantity),
      price: req.body.price ? parseFloat(req.body.price) : undefined,
      stopPrice: req.body.stopPrice ? parseFloat(req.body.stopPrice) : undefined,
      timeInForce: req.body.timeInForce as TimeInForce || TimeInForce.GTC,
      flags: req.body.flags,
      trailingConfig: req.body.trailingConfig,
      ocoConfig: req.body.ocoConfig,
      leverage: req.body.leverage ? parseFloat(req.body.leverage) : undefined,
      marginType: req.body.marginType,
    };
    
    // Skip validation for test orders
    const order: IOrder = {
      ...orderRequest,
      orderId: `TEST-${Date.now()}-${uuidv4().substring(0, 8).toUpperCase()}`,
      status: OrderStatus.PENDING,
      filledQuantity: 0,
      remainingQuantity: orderRequest.quantity,
      averagePrice: 0,
      fills: [],
      totalFee: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    // Submit directly to matching engine
    const result = await matchingEngineService.submitOrder(order);
    
    logger.warn(`Admin injected test order ${order.orderId}`);
    
    res.json({
      success: true,
      message: 'Test order injected',
      data: {
        order,
        result,
      },
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Replay historical orders
 */
export const replayHistoricalOrders = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { startDate, endDate, symbol, speedMultiplier = 1 } = req.body;
    
    if (!startDate || !endDate) {
      res.status(400).json({
        success: false,
        message: 'Start and end dates required',
      });
      return;
    }
    
    // Get historical orders
    const filter: any = {
      createdAt: {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
    };
    
    if (symbol) {
      filter.symbol = symbol;
    }
    
    const orders = await Order.find(filter)
      .sort({ createdAt: 1 })
      .limit(1000)
      .lean() as unknown as IOrder[];
    
    logger.warn(`Admin starting replay of ${orders.length} historical orders`);
    
    // Start replay in background
    replayOrdersInBackground(orders, speedMultiplier);
    
    res.json({
      success: true,
      message: `Started replaying ${orders.length} orders`,
      count: orders.length,
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Bulk cancel orders
 */
export const bulkCancelOrders = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { orderIds, symbol, status, side, type } = req.body;
    
    const filter: any = {};
    
    if (orderIds && Array.isArray(orderIds)) {
      filter.orderId = { $in: orderIds };
    }
    
    if (symbol) {
      filter.symbol = symbol;
    }
    
    if (status) {
      filter.status = status;
    }
    
    if (side) {
      filter.side = side;
    }
    
    if (type) {
      filter.type = type;
    }
    
    // Get orders to cancel
    const orders = await Order.find({
      ...filter,
      status: { $in: [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED, OrderStatus.PENDING] },
    }).lean() as unknown as IOrder[];
    
    let cancelledCount = 0;
    
    for (const order of orders) {
      const cancelled = await matchingEngineService.cancelOrder(
        order.orderId,
        order.userId,
        'Admin bulk cancel'
      );
      
      if (cancelled) {
        cancelledCount++;
      }
    }
    
    logger.warn(`Admin bulk cancelled ${cancelledCount} orders`);
    
    res.json({
      success: true,
      message: `Cancelled ${cancelledCount} orders`,
      count: cancelledCount,
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Get order book statistics
 */
export const getOrderBookStats = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { symbol } = req.params;
    
    const stats = orderBookService.getStatistics(symbol);
    
    res.json({
      success: true,
      data: stats,
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Clear order book
 */
export const clearOrderBook = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { symbol } = req.params;
    
    // Cancel all open orders for symbol
    const orders = await Order.find({
      symbol,
      status: { $in: [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED] },
    }).lean() as unknown as IOrder[];
    
    for (const order of orders) {
      await matchingEngineService.cancelOrder(
        order.orderId,
        order.userId,
        'Admin cleared order book'
      );
    }
    
    // Clear order book
    orderBookService.clearSymbol(symbol);
    
    logger.warn(`Admin cleared order book for ${symbol}`);
    
    res.json({
      success: true,
      message: `Cleared order book for ${symbol}`,
      cancelledOrders: orders.length,
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Get matching engine statistics
 */
export const getMatchingEngineStats = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const period = req.query.period as string || '1h';
    
    // Calculate date range
    const now = new Date();
    let startDate = new Date();
    
    switch (period) {
      case '5m':
        startDate.setMinutes(now.getMinutes() - 5);
        break;
      case '1h':
        startDate.setHours(now.getHours() - 1);
        break;
      case '24h':
        startDate.setDate(now.getDate() - 1);
        break;
    }
    
    // Get statistics
    const [orderStats, tradeStats] = await Promise.all([
      Order.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            marketOrders: {
              $sum: { $cond: [{ $eq: ['$type', OrderType.MARKET] }, 1, 0] },
            },
            limitOrders: {
              $sum: { $cond: [{ $eq: ['$type', OrderType.LIMIT] }, 1, 0] },
            },
            filledOrders: {
              $sum: { $cond: [{ $eq: ['$status', OrderStatus.FILLED] }, 1, 0] },
            },
            cancelledOrders: {
              $sum: { $cond: [{ $eq: ['$status', OrderStatus.CANCELLED] }, 1, 0] },
            },
            avgExecutionTime: {
              $avg: {
                $cond: [
                  { $eq: ['$status', OrderStatus.FILLED] },
                  { $subtract: ['$completedAt', '$createdAt'] },
                  null,
                ],
              },
            },
          },
        },
      ]),
      Trade.aggregate([
        { $match: { timestamp: { $gte: startDate } } },
        {
          $group: {
            _id: null,
            totalTrades: { $sum: 1 },
            totalVolume: { $sum: '$quoteQuantity' },
            avgTradeSize: { $avg: '$quoteQuantity' },
            totalFees: { $sum: { $add: ['$buyerFee', '$sellerFee'] } },
          },
        },
      ]),
    ]);
    
    res.json({
      success: true,
      data: {
        orders: orderStats[0] || {},
        trades: tradeStats[0] || {},
        period,
      },
    });
    
  } catch (error) {
    next(error);
  }
};

// Helper functions

/**
 * Update balances for force fill
 */
async function updateBalancesForForceFill(
  order: IOrder,
  fill: IOrderFill,
  session: any
): Promise<void> {
  const totalCost = fill.quantity * fill.price;
  
  if (order.side === OrderSide.BUY) {
    // Deduct USDT and add base asset
    await Wallet.updateOne(
      { userId: order.userId, 'balances.asset': 'USDT' },
      {
        $inc: {
          'balances.$.locked': -(totalCost + fill.fee),
          'balances.$.total': -(totalCost + fill.fee),
        },
      }
    ).session(session);
    
    // Add base asset (extract from symbol)
    const baseAsset = order.symbol.replace('USDT', '');
    await Wallet.updateOne(
      { userId: order.userId, 'balances.asset': baseAsset },
      {
        $inc: {
          'balances.$.available': fill.quantity,
          'balances.$.total': fill.quantity,
        },
      }
    ).session(session);
    
  } else {
    // Deduct base asset and add USDT
    const baseAsset = order.symbol.replace('USDT', '');
    await Wallet.updateOne(
      { userId: order.userId, 'balances.asset': baseAsset },
      {
        $inc: {
          'balances.$.locked': -fill.quantity,
          'balances.$.total': -fill.quantity,
        },
      }
    ).session(session);
    
    await Wallet.updateOne(
      { userId: order.userId, 'balances.asset': 'USDT' },
      {
        $inc: {
          'balances.$.available': totalCost - fill.fee,
          'balances.$.total': totalCost - fill.fee,
        },
      }
    ).session(session);
  }
}

/**
 * Replay orders in background
 */
async function replayOrdersInBackground(
  orders: IOrder[],
  speedMultiplier: number
): Promise<void> {
  if (orders.length === 0) return;
  
  const firstOrderTime = orders[0].createdAt.getTime();
  const startTime = Date.now();
  
  for (const order of orders) {
    const originalDelay = order.createdAt.getTime() - firstOrderTime;
    const adjustedDelay = originalDelay / speedMultiplier;
    const actualDelay = startTime + adjustedDelay - Date.now();
    
    if (actualDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, actualDelay));
    }
    
    // Submit order to matching engine
    try {
      order.orderId = `REPLAY-${order.orderId}`;
      order.userId = `REPLAY-${order.userId}`;
      await matchingEngineService.submitOrder(order);
    } catch (error) {
      logger.error(`Error replaying order ${order.orderId}`, error);
    }
  }
  
  logger.info('Completed replaying historical orders');
}