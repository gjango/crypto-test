import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import {
  IEngineConfig,
  AdminAction,
  IAdminAuditLog,
  IMaintenanceWindow
} from '../types/admin';
import { AdminAuditLog } from '../models/AdminAuditLog.model';
import matchingEngineService from './matchingEngine.service';
import orderExecutionService from './orderExecution.service';
import positionManagementService from './positionManagement.service';
import liquidationEngineService from './liquidationEngine.service';
import feedManagerService from './feedManager.service';
import { Order } from '../models/Order.model';
import { Position } from '../models/Position.model';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';

const logger = createLogger('EngineControl');

export class EngineControlService extends EventEmitter {
  private static instance: EngineControlService;
  private engineConfig: IEngineConfig;
  private engineStatus: 'running' | 'paused' | 'maintenance' = 'running';
  private maintenanceMode: boolean = false;
  private maintenanceWindows: IMaintenanceWindow[] = [];
  private pausedMarkets: Set<string> = new Set();
  private engineMetrics = {
    ordersProcessed: 0,
    tradesExecuted: 0,
    averageLatency: 0,
    errorRate: 0,
    lastReset: new Date(),
  };
  
  private constructor() {
    super();
    this.setMaxListeners(1000);
    this.initializeEngineConfig();
    this.startMetricsCollection();
  }
  
  public static getInstance(): EngineControlService {
    if (!EngineControlService.instance) {
      EngineControlService.instance = new EngineControlService();
    }
    return EngineControlService.instance;
  }
  
  /**
   * Initialize engine configuration
   */
  private initializeEngineConfig(): void {
    this.engineConfig = {
      status: 'running',
      globalTradingEnabled: true,
      matchingEngineParams: {
        tickRate: 100, // 100ms
        batchSize: 100,
        maxOrdersPerTick: 1000,
        priorityQueue: true,
      },
      orderLimits: {
        maxOpenOrdersPerUser: 200,
        maxOrdersPerMinute: 60,
        maxOrderValue: 1000000,
      },
      performanceParams: {
        cacheEnabled: true,
        cacheTTL: 60000, // 1 minute
        asyncProcessing: true,
        workerThreads: 4,
      },
    };
  }
  
  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    // Collect metrics every 10 seconds
    setInterval(() => {
      this.collectEngineMetrics();
    }, 10000);
    
    // Reset metrics every hour
    setInterval(() => {
      this.resetMetrics();
    }, 3600000);
  }
  
  /**
   * Pause trading globally
   */
  async pauseTrading(
    adminId: string,
    adminEmail: string,
    reason: string
  ): Promise<void> {
    if (this.engineStatus === 'paused') {
      logger.warn('Trading already paused');
      return;
    }
    
    const before = this.engineStatus;
    this.engineStatus = 'paused';
    this.engineConfig.status = 'paused';
    this.engineConfig.globalTradingEnabled = false;
    
    // Pause all services
    matchingEngineService.pauseAllMarkets();
    
    // Log audit
    await this.logAudit({
      action: AdminAction.PAUSE_TRADING,
      adminId,
      adminEmail,
      targetType: 'SYSTEM',
      before: { status: before },
      after: { status: 'paused' },
      reason,
    });
    
    logger.warn(`Global trading paused by ${adminEmail}. Reason: ${reason}`);
    
    // Emit event
    this.emit('trading_paused', {
      adminId,
      adminEmail,
      reason,
      timestamp: new Date(),
    });
  }
  
  /**
   * Resume trading globally
   */
  async resumeTrading(
    adminId: string,
    adminEmail: string,
    reason?: string
  ): Promise<void> {
    if (this.engineStatus === 'running') {
      logger.warn('Trading already running');
      return;
    }
    
    if (this.maintenanceMode) {
      throw new Error('Cannot resume trading while in maintenance mode');
    }
    
    const before = this.engineStatus;
    this.engineStatus = 'running';
    this.engineConfig.status = 'running';
    this.engineConfig.globalTradingEnabled = true;
    
    // Resume all services
    matchingEngineService.resumeAllMarkets();
    
    // Resume individual markets except those explicitly paused
    const marketManagementService = (await import('./marketManagement.service')).default;
    const markets = marketManagementService.getAllMarkets();
    
    for (const market of markets) {
      if (!this.pausedMarkets.has(market.symbol)) {
        matchingEngineService.resumeMarket(market.symbol);
      }
    }
    
    // Log audit
    await this.logAudit({
      action: AdminAction.RESUME_TRADING,
      adminId,
      adminEmail,
      targetType: 'SYSTEM',
      before: { status: before },
      after: { status: 'running' },
      reason,
    });
    
    logger.info(`Global trading resumed by ${adminEmail}`);
    
    // Emit event
    this.emit('trading_resumed', {
      adminId,
      adminEmail,
      reason,
      timestamp: new Date(),
    });
  }
  
  /**
   * Cancel all open orders
   */
  async cancelAllOrders(
    filter: { symbol?: string; userId?: string } | undefined,
    adminId: string,
    adminEmail: string,
    reason: string
  ): Promise<{ cancelled: number }> {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Build query
      const query: any = {
        status: { $in: ['OPEN', 'PARTIALLY_FILLED'] },
      };
      
      if (filter?.symbol) {
        query.symbol = filter.symbol;
      }
      if (filter?.userId) {
        query.userId = filter.userId;
      }
      
      // Get orders to cancel
      const orders = await Order.find(query).session(session).lean();
      
      // Cancel each order
      for (const order of orders) {
        await matchingEngineService.cancelOrder(
          order.clientOrderId || order._id.toString(),
          order.userId.toString(),
          `Admin cancellation: ${reason}`
        );
      }
      
      // Log audit
      await this.logAudit({
        action: AdminAction.CANCEL_ALL_ORDERS,
        adminId,
        adminEmail,
        targetType: 'SYSTEM',
        before: { orderCount: orders.length },
        after: { cancelled: orders.length },
        metadata: filter,
        reason,
      }, session);
      
      await session.commitTransaction();
      
      logger.warn(`Cancelled ${orders.length} orders by ${adminEmail}. Reason: ${reason}`);
      
      // Emit event
      this.emit('orders_cancelled', {
        count: orders.length,
        filter,
        adminId,
        adminEmail,
        reason,
      });
      
      return { cancelled: orders.length };
      
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error cancelling all orders', error);
      throw error;
    } finally {
      session.endSession();
    }
  }
  
  /**
   * Force settlement of positions
   */
  async forceSettlement(
    filter: { symbol?: string; userId?: string } | undefined,
    settlementPrice: number | undefined,
    adminId: string,
    adminEmail: string,
    reason: string
  ): Promise<{ settled: number }> {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Build query
      const query: any = {
        status: 'OPEN',
      };
      
      if (filter?.symbol) {
        query.symbol = filter.symbol;
      }
      if (filter?.userId) {
        query.userId = filter.userId;
      }
      
      // Get positions to settle
      const positions = await Position.find(query).session(session).lean();
      
      let settledCount = 0;
      
      for (const position of positions) {
        // Use provided price or current mark price
        const closePrice = settlementPrice || parseFloat(position.markPrice.toString());
        
        // Close position
        const result = await positionManagementService.closePosition(
          position._id.toString(),
          position.userId.toString(),
          parseFloat(position.quantity.toString()),
          closePrice
        );
        
        if (result) {
          settledCount++;
        }
      }
      
      // Log audit
      await this.logAudit({
        action: AdminAction.FORCE_SETTLEMENT,
        adminId,
        adminEmail,
        targetType: 'SYSTEM',
        before: { positionCount: positions.length },
        after: { settled: settledCount },
        metadata: { filter, settlementPrice },
        reason,
      }, session);
      
      await session.commitTransaction();
      
      logger.warn(`Force settled ${settledCount} positions by ${adminEmail}. Reason: ${reason}`);
      
      // Emit event
      this.emit('positions_settled', {
        count: settledCount,
        filter,
        settlementPrice,
        adminId,
        adminEmail,
        reason,
      });
      
      return { settled: settledCount };
      
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error forcing settlement', error);
      throw error;
    } finally {
      session.endSession();
    }
  }
  
  /**
   * Set maintenance mode
   */
  async setMaintenanceMode(
    enabled: boolean,
    duration: number | undefined, // minutes
    adminId: string,
    adminEmail: string,
    reason: string
  ): Promise<void> {
    const before = this.maintenanceMode;
    this.maintenanceMode = enabled;
    
    if (enabled) {
      this.engineStatus = 'maintenance';
      this.engineConfig.status = 'maintenance';
      this.engineConfig.globalTradingEnabled = false;
      
      // Pause all trading
      await this.pauseTrading(adminId, adminEmail, `Maintenance: ${reason}`);
      
      // Cancel all open orders
      await this.cancelAllOrders(undefined, adminId, adminEmail, `Maintenance: ${reason}`);
      
      // Create maintenance window
      const window: IMaintenanceWindow = {
        id: `MW-${Date.now()}-${uuidv4().substring(0, 8)}`,
        type: 'scheduled',
        scope: 'global',
        startTime: new Date(),
        endTime: duration ? new Date(Date.now() + duration * 60 * 1000) : new Date(Date.now() + 3600000),
        reason,
        affectedFeatures: ['trading', 'orders', 'positions'],
        notification: {
          sent: true,
          sentAt: new Date(),
          channels: ['websocket', 'api'],
        },
        createdBy: adminEmail,
        createdAt: new Date(),
        status: 'active',
      };
      
      this.maintenanceWindows.push(window);
      
      // Schedule automatic exit if duration provided
      if (duration) {
        setTimeout(async () => {
          await this.setMaintenanceMode(false, undefined, 'SYSTEM', 'system@admin', 'Scheduled maintenance end');
        }, duration * 60 * 1000);
      }
      
      logger.warn(`Maintenance mode enabled by ${adminEmail}. Reason: ${reason}`);
      
    } else {
      this.engineStatus = 'running';
      this.engineConfig.status = 'running';
      this.engineConfig.globalTradingEnabled = true;
      
      // Mark maintenance windows as completed
      for (const window of this.maintenanceWindows) {
        if (window.status === 'active') {
          window.status = 'completed';
        }
      }
      
      // Resume trading
      await this.resumeTrading(adminId, adminEmail, 'Maintenance completed');
      
      logger.info(`Maintenance mode disabled by ${adminEmail}`);
    }
    
    // Log audit
    await this.logAudit({
      action: AdminAction.SET_MAINTENANCE_MODE,
      adminId,
      adminEmail,
      targetType: 'SYSTEM',
      before: { maintenanceMode: before },
      after: { maintenanceMode: enabled },
      metadata: { duration },
      reason,
    });
    
    // Emit event
    this.emit('maintenance_mode_changed', {
      enabled,
      duration,
      adminId,
      adminEmail,
      reason,
    });
  }
  
  /**
   * Update engine configuration
   */
  async updateEngineConfig(
    updates: Partial<IEngineConfig>,
    adminId: string,
    adminEmail: string,
    reason?: string
  ): Promise<IEngineConfig> {
    const before = { ...this.engineConfig };
    
    // Apply updates
    if (updates.matchingEngineParams) {
      Object.assign(this.engineConfig.matchingEngineParams, updates.matchingEngineParams);
      
      // Apply to matching engine
      if (updates.matchingEngineParams.tickRate) {
        matchingEngineService.setTickRate(updates.matchingEngineParams.tickRate);
      }
    }
    
    if (updates.orderLimits) {
      Object.assign(this.engineConfig.orderLimits, updates.orderLimits);
    }
    
    if (updates.performanceParams) {
      Object.assign(this.engineConfig.performanceParams, updates.performanceParams);
    }
    
    // Log audit
    await this.logAudit({
      action: AdminAction.UPDATE_RISK_PARAMS,
      adminId,
      adminEmail,
      targetType: 'SYSTEM',
      before,
      after: this.engineConfig,
      changes: updates,
      reason,
    });
    
    logger.info(`Engine configuration updated by ${adminEmail}`);
    
    // Emit event
    this.emit('engine_config_updated', this.engineConfig);
    
    return this.engineConfig;
  }
  
  /**
   * Pause specific market
   */
  async pauseMarket(
    symbol: string,
    adminId: string,
    adminEmail: string,
    reason: string
  ): Promise<void> {
    matchingEngineService.pauseMarket(symbol);
    this.pausedMarkets.add(symbol);
    
    // Cancel open orders for this market
    await this.cancelAllOrders({ symbol }, adminId, adminEmail, reason);
    
    logger.warn(`Market ${symbol} paused by ${adminEmail}. Reason: ${reason}`);
    
    // Emit event
    this.emit('market_paused', {
      symbol,
      adminId,
      adminEmail,
      reason,
    });
  }
  
  /**
   * Resume specific market
   */
  async resumeMarket(
    symbol: string,
    adminId: string,
    adminEmail: string,
    reason?: string
  ): Promise<void> {
    matchingEngineService.resumeMarket(symbol);
    this.pausedMarkets.delete(symbol);
    
    logger.info(`Market ${symbol} resumed by ${adminEmail}`);
    
    // Emit event
    this.emit('market_resumed', {
      symbol,
      adminId,
      adminEmail,
      reason,
    });
  }
  
  /**
   * Reset matching engine
   */
  async resetMatchingEngine(
    adminId: string,
    adminEmail: string,
    reason: string
  ): Promise<void> {
    logger.warn(`Resetting matching engine requested by ${adminEmail}. Reason: ${reason}`);
    
    // Pause trading first
    await this.pauseTrading(adminId, adminEmail, 'Matching engine reset');
    
    // Clear order books
    matchingEngineService.clearAllOrderBooks();
    
    // Restart services
    matchingEngineService.restart();
    
    // Resume trading
    await this.resumeTrading(adminId, adminEmail, 'Matching engine reset complete');
    
    // Log audit
    await this.logAudit({
      action: AdminAction.UPDATE_RISK_PARAMS,
      adminId,
      adminEmail,
      targetType: 'SYSTEM',
      metadata: { action: 'reset_matching_engine' },
      reason,
    });
    
    logger.info('Matching engine reset complete');
    
    // Emit event
    this.emit('matching_engine_reset', {
      adminId,
      adminEmail,
      reason,
    });
  }
  
  /**
   * Collect engine metrics
   */
  private collectEngineMetrics(): void {
    // Get metrics from services
    const matchingMetrics = matchingEngineService.getMetrics();
    
    // Update metrics
    this.engineMetrics.ordersProcessed += matchingMetrics.ordersProcessed || 0;
    this.engineMetrics.tradesExecuted += matchingMetrics.tradesExecuted || 0;
    
    // Calculate average latency
    if (matchingMetrics.averageLatency) {
      const alpha = 0.1; // Exponential moving average factor
      this.engineMetrics.averageLatency = 
        alpha * matchingMetrics.averageLatency + 
        (1 - alpha) * this.engineMetrics.averageLatency;
    }
  }
  
  /**
   * Reset metrics
   */
  private resetMetrics(): void {
    this.engineMetrics = {
      ordersProcessed: 0,
      tradesExecuted: 0,
      averageLatency: this.engineMetrics.averageLatency, // Keep latency
      errorRate: 0,
      lastReset: new Date(),
    };
    
    logger.info('Engine metrics reset');
  }
  
  /**
   * Log audit
   */
  private async logAudit(
    data: Partial<IAdminAuditLog>,
    session?: any
  ): Promise<void> {
    try {
      const auditLog: IAdminAuditLog = {
        actionId: `AUDIT-${Date.now()}-${uuidv4().substring(0, 8)}`,
        action: data.action!,
        adminId: data.adminId!,
        adminEmail: data.adminEmail!,
        targetType: data.targetType!,
        targetId: data.targetId,
        before: data.before,
        after: data.after,
        changes: data.changes,
        reason: data.reason,
        reversible: false,
        ipAddress: '0.0.0.0',
        userAgent: 'Admin Console',
        sessionId: `SESSION-${data.adminId}`,
        timestamp: new Date(),
        metadata: data.metadata,
      };
      
      if (session) {
        await AdminAuditLog.create([auditLog], { session });
      } else {
        await AdminAuditLog.create(auditLog);
      }
    } catch (error) {
      logger.error('Error logging audit', error);
    }
  }
  
  /**
   * Get engine status
   */
  getEngineStatus() {
    return {
      status: this.engineStatus,
      config: this.engineConfig,
      maintenanceMode: this.maintenanceMode,
      pausedMarkets: Array.from(this.pausedMarkets),
      metrics: this.engineMetrics,
      maintenanceWindows: this.maintenanceWindows.filter(w => w.status === 'active'),
    };
  }
  
  /**
   * Get engine metrics
   */
  getEngineMetrics() {
    return { ...this.engineMetrics };
  }
}

export default EngineControlService.getInstance();