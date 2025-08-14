import { createLogger } from '../utils/logger';
import feedManagerService from './feedManager.service';
import { 
  IPriceTick, 
  IPriceUpdate, 
  IWebSocketMessage,
  FeedSource 
} from '../types/priceFeed';
import WebSocketServer from '../websocket/WebSocketServer';
import { IOrder } from '../types/order';
import { IPosition } from '../types/margin';

const logger = createLogger('WebSocketBroadcast');

/**
 * WebSocket Broadcast Service
 * Handles broadcasting of real-time updates to connected clients
 */
class WebSocketBroadcastService {
  private static instance: WebSocketBroadcastService;
  private wsServer: WebSocketServer;
  private isInitialized: boolean = false;

  private constructor() {
    this.wsServer = WebSocketServer.getInstance();
  }

  public static getInstance(): WebSocketBroadcastService {
    if (!WebSocketBroadcastService.instance) {
      WebSocketBroadcastService.instance = new WebSocketBroadcastService();
    }
    return WebSocketBroadcastService.instance;
  }

  /**
   * Initialize the broadcast service
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Subscribe to feed manager price updates
    feedManagerService.on('price_update', (update: IPriceUpdate) => {
      this.broadcastPriceUpdate(update.symbol, update);
    });

    feedManagerService.on('trade', (trade: any) => {
      this.broadcastTrade(trade.symbol, trade);
    });

    this.isInitialized = true;
    logger.info('WebSocket broadcast service initialized');
  }

  /**
   * Broadcast price update
   */
  public broadcastPriceUpdate(symbol: string, update: IPriceUpdate): void {
    try {
      this.wsServer.broadcastPriceUpdate(symbol, {
        symbol,
        price: update.price,
        bid: update.bid,
        ask: update.ask,
        volume: update.volume,
        change24h: update.change24h,
        changePercent24h: update.changePercent24h,
        high24h: update.high24h,
        low24h: update.low24h,
        timestamp: update.timestamp,
        source: update.source,
      });
    } catch (error) {
      logger.error('Error broadcasting price update:', error);
    }
  }

  /**
   * Broadcast trade
   */
  public broadcastTrade(symbol: string, trade: any): void {
    try {
      // Broadcast to price namespace
      const priceNamespace = this.wsServer.getIO().of('/prices');
      priceNamespace.to(`prices:${symbol}`).emit('price.trade', {
        symbol,
        price: trade.price,
        quantity: trade.quantity,
        side: trade.side,
        timestamp: trade.timestamp,
      });
    } catch (error) {
      logger.error('Error broadcasting trade:', error);
    }
  }

  /**
   * Broadcast order update to user
   */
  public broadcastOrderUpdate(userId: string, order: IOrder): void {
    try {
      this.wsServer.broadcastOrderUpdate(userId, {
        orderId: order.orderId,
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        status: order.status,
        price: order.price,
        quantity: order.quantity,
        filledQuantity: order.filledQuantity,
        remainingQuantity: order.remainingQuantity,
        averagePrice: order.averagePrice,
        totalFee: order.totalFee,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      });
    } catch (error) {
      logger.error('Error broadcasting order update:', error);
    }
  }

  /**
   * Broadcast new order to user
   */
  public broadcastNewOrder(userId: string, order: IOrder): void {
    try {
      const userNamespace = this.wsServer.getIO().of('/user');
      userNamespace.to(`orders:${userId}`).emit('order.new', order);
    } catch (error) {
      logger.error('Error broadcasting new order:', error);
    }
  }

  /**
   * Broadcast order fill
   */
  public broadcastOrderFill(userId: string, fill: any): void {
    try {
      const userNamespace = this.wsServer.getIO().of('/user');
      userNamespace.to(`orders:${userId}`).emit('order.filled', fill);
    } catch (error) {
      logger.error('Error broadcasting order fill:', error);
    }
  }

  /**
   * Broadcast order cancellation
   */
  public broadcastOrderCancellation(userId: string, order: IOrder): void {
    try {
      const userNamespace = this.wsServer.getIO().of('/user');
      userNamespace.to(`orders:${userId}`).emit('order.cancelled', {
        orderId: order.orderId,
        symbol: order.symbol,
        cancelledAt: new Date(),
      });
    } catch (error) {
      logger.error('Error broadcasting order cancellation:', error);
    }
  }

  /**
   * Broadcast position update
   */
  public broadcastPositionUpdate(userId: string, position: IPosition): void {
    try {
      this.wsServer.broadcastPositionUpdate(userId, {
        positionId: position.positionId,
        symbol: position.symbol,
        side: position.side,
        quantity: position.quantity,
        entryPrice: position.entryPrice,
        markPrice: position.markPrice,
        liquidationPrice: position.liquidationPrice,
        unrealizedPnl: position.unrealizedPnl,
        realizedPnl: position.realizedPnl,
        margin: position.margin,
        marginRatio: position.marginRatio,
        leverage: position.leverage,
        status: position.status,
        updatedAt: position.updatedAt,
      });
    } catch (error) {
      logger.error('Error broadcasting position update:', error);
    }
  }

  /**
   * Broadcast position liquidation
   */
  public broadcastPositionLiquidation(userId: string, liquidation: any): void {
    try {
      const userNamespace = this.wsServer.getIO().of('/user');
      userNamespace.to(`positions:${userId}`).emit('position.liquidated', liquidation);
    } catch (error) {
      logger.error('Error broadcasting position liquidation:', error);
    }
  }

  /**
   * Broadcast wallet update
   */
  public broadcastWalletUpdate(userId: string, wallet: any): void {
    try {
      const userNamespace = this.wsServer.getIO().of('/user');
      userNamespace.to(`wallet:${userId}`).emit('wallet.update', {
        balances: wallet.balances,
        totalValueUSDT: wallet.totalValueUSDT,
        updatedAt: new Date(),
      });
    } catch (error) {
      logger.error('Error broadcasting wallet update:', error);
    }
  }

  /**
   * Broadcast margin call
   */
  public broadcastMarginCall(userId: string, marginCall: any): void {
    try {
      const userNamespace = this.wsServer.getIO().of('/user');
      userNamespace.to(`user:${userId}`).emit('margin.call', marginCall);
    } catch (error) {
      logger.error('Error broadcasting margin call:', error);
    }
  }

  /**
   * Broadcast market stats
   */
  public broadcastMarketStats(symbol: string, stats: any): void {
    try {
      this.wsServer.broadcastMarketStats(symbol, stats);
    } catch (error) {
      logger.error('Error broadcasting market stats:', error);
    }
  }

  /**
   * Broadcast market depth
   */
  public broadcastMarketDepth(symbol: string, depth: any): void {
    try {
      const marketNamespace = this.wsServer.getIO().of('/market');
      marketNamespace.to(`market:depth:${symbol}`).emit('market.depth', {
        symbol,
        bids: depth.bids,
        asks: depth.asks,
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error('Error broadcasting market depth:', error);
    }
  }

  /**
   * Broadcast system message
   */
  public broadcastSystemMessage(message: string, type: string = 'info'): void {
    try {
      this.wsServer.broadcastSystemMessage({
        type,
        message,
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error('Error broadcasting system message:', error);
    }
  }

  /**
   * Broadcast maintenance mode
   */
  public broadcastMaintenanceMode(enabled: boolean, message?: string): void {
    try {
      this.wsServer.getIO().emit('system.maintenance', {
        enabled,
        message: message || 'System maintenance in progress',
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error('Error broadcasting maintenance mode:', error);
    }
  }

  /**
   * Get connection statistics
   */
  public getStats(): any {
    return this.wsServer.getStats();
  }

  /**
   * Check if user is connected
   */
  public isUserConnected(userId: string): boolean {
    const userNamespace = this.wsServer.getIO().of('/user');
    const room = `user:${userId}`;
    const sockets = userNamespace.adapter.rooms.get(room);
    return sockets ? sockets.size > 0 : false;
  }
}

export default WebSocketBroadcastService.getInstance();