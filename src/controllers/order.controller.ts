import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';
import orderExecutionService from '../services/orderExecution.service';
import orderBookService from '../services/orderBook.service';
import { Order } from '../models/Order.model';
import { Trade } from '../models/Trade.model';
import { 
  IOrderRequest,
  OrderType,
  OrderSide,
  TimeInForce,
  OrderStatus
} from '../types/order';

const logger = createLogger('OrderController');

/**
 * Place new order
 */
export const placeOrder = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
      return;
    }
    
    const orderRequest: IOrderRequest = {
      userId,
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
    
    // Validate required fields
    if (!orderRequest.symbol || !orderRequest.type || !orderRequest.side || !orderRequest.quantity) {
      res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
      return;
    }
    
    // Place order
    const order = await orderExecutionService.placeOrder(orderRequest);
    
    if (!order) {
      res.status(400).json({
        success: false,
        message: 'Order placement failed',
      });
      return;
    }
    
    res.json({
      success: true,
      data: order,
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Get open orders
 */
export const getOpenOrders = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
      return;
    }
    
    const symbol = req.query.symbol as string | undefined;
    
    const orders = await orderExecutionService.getOpenOrders(userId, symbol);
    
    res.json({
      success: true,
      data: orders,
      count: orders.length,
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Get order history
 */
export const getOrderHistory = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
      return;
    }
    
    const options = {
      symbol: req.query.symbol as string | undefined,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
    };
    
    const orders = await orderExecutionService.getOrderHistory(userId, options);
    
    res.json({
      success: true,
      data: orders,
      count: orders.length,
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Get specific order
 */
export const getOrder = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
      return;
    }
    
    const { orderId } = req.params;
    
    const order = await Order.findOne({ orderId, userId }).lean();
    
    if (!order) {
      res.status(404).json({
        success: false,
        message: 'Order not found',
      });
      return;
    }
    
    res.json({
      success: true,
      data: order,
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Cancel order
 */
export const cancelOrder = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
      return;
    }
    
    const { orderId } = req.params;
    const reason = req.body.reason;
    
    const cancelled = await orderExecutionService.cancelOrder(orderId, userId, reason);
    
    if (!cancelled) {
      res.status(400).json({
        success: false,
        message: 'Failed to cancel order',
      });
      return;
    }
    
    res.json({
      success: true,
      message: 'Order cancelled successfully',
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Cancel all orders
 */
export const cancelAllOrders = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
      return;
    }
    
    const symbol = req.query.symbol as string | undefined;
    
    const matchingEngineService = (await import('../services/matchingEngine.service')).default;
    const cancelledCount = await matchingEngineService.cancelAllOrders(userId, symbol);
    
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
 * Modify order
 */
export const modifyOrder = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
      return;
    }
    
    const { orderId } = req.params;
    const modifications = {
      price: req.body.price ? parseFloat(req.body.price) : undefined,
      quantity: req.body.quantity ? parseFloat(req.body.quantity) : undefined,
      stopPrice: req.body.stopPrice ? parseFloat(req.body.stopPrice) : undefined,
    };
    
    const modified = await orderExecutionService.modifyOrder(orderId, userId, modifications);
    
    if (!modified) {
      res.status(400).json({
        success: false,
        message: 'Failed to modify order',
      });
      return;
    }
    
    res.json({
      success: true,
      message: 'Order modified successfully',
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Get order book
 */
export const getOrderBook = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { symbol } = req.params;
    const depth = req.query.depth ? parseInt(req.query.depth as string) : 20;
    
    const orderBook = orderBookService.getMarketDepth(symbol, depth);
    
    res.json({
      success: true,
      data: orderBook,
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Get best bid/ask
 */
export const getBestPrices = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { symbol } = req.params;
    
    const prices = orderBookService.getBestPrices(symbol);
    
    res.json({
      success: true,
      data: prices,
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Get recent trades
 */
export const getRecentTrades = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { symbol } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    
    const trades = await Trade.find({ symbol })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    
    res.json({
      success: true,
      data: trades,
      count: trades.length,
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Get user trades
 */
export const getUserTrades = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
      return;
    }
    
    const options = {
      symbol: req.query.symbol as string | undefined,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
    };
    
    const filter: any = {
      $or: [{ buyerId: userId }, { sellerId: userId }],
    };
    
    if (options.symbol) {
      filter.symbol = options.symbol;
    }
    
    if (options.startDate || options.endDate) {
      filter.timestamp = {};
      if (options.startDate) filter.timestamp.$gte = options.startDate;
      if (options.endDate) filter.timestamp.$lte = options.endDate;
    }
    
    const trades = await Trade.find(filter)
      .sort({ timestamp: -1 })
      .limit(options.limit)
      .lean();
    
    res.json({
      success: true,
      data: trades,
      count: trades.length,
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Get order statistics
 */
export const getOrderStatistics = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
      return;
    }
    
    const symbol = req.query.symbol as string | undefined;
    const period = req.query.period as string || '24h';
    
    // Calculate date range
    const now = new Date();
    let startDate = new Date();
    
    switch (period) {
      case '1h':
        startDate.setHours(now.getHours() - 1);
        break;
      case '24h':
        startDate.setDate(now.getDate() - 1);
        break;
      case '7d':
        startDate.setDate(now.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(now.getDate() - 30);
        break;
    }
    
    const filter: any = {
      userId,
      createdAt: { $gte: startDate },
    };
    
    if (symbol) {
      filter.symbol = symbol;
    }
    
    // Get order statistics
    const stats = await Order.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          filledOrders: {
            $sum: { $cond: [{ $eq: ['$status', OrderStatus.FILLED] }, 1, 0] },
          },
          cancelledOrders: {
            $sum: { $cond: [{ $eq: ['$status', OrderStatus.CANCELLED] }, 1, 0] },
          },
          totalVolume: { $sum: { $multiply: ['$filledQuantity', '$averagePrice'] } },
          totalFees: { $sum: '$totalFee' },
        },
      },
      {
        $project: {
          _id: 0,
          totalOrders: 1,
          filledOrders: 1,
          cancelledOrders: 1,
          totalVolume: 1,
          totalFees: 1,
          fillRate: {
            $cond: [
              { $gt: ['$totalOrders', 0] },
              { $divide: ['$filledOrders', '$totalOrders'] },
              0,
            ],
          },
        },
      },
    ]);
    
    res.json({
      success: true,
      data: stats[0] || {
        totalOrders: 0,
        filledOrders: 0,
        cancelledOrders: 0,
        totalVolume: 0,
        totalFees: 0,
        fillRate: 0,
      },
    });
    
  } catch (error) {
    next(error);
  }
};