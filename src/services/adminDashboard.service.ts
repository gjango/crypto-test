import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import {
  IDashboardMetrics,
  ISystemHealth,
  IUserActivity
} from '../types/admin';
import marketManagementService from './marketManagement.service';
import riskControlService from './riskControl.service';
import engineControlService from './engineControl.service';
import liquidationEngineService from './liquidationEngine.service';
import riskMonitoringService from './riskMonitoring.service';
import feedManagerService from './feedManager.service';
import matchingEngineService from './matchingEngine.service';
import { Position } from '../models/Position.model';
import { Order } from '../models/Order.model';
import { Trade } from '../models/Trade.model';
import { User } from '../models/User.model';
import { Wallet } from '../models/Wallet.model';
import { AdminAuditLog } from '../models/AdminAuditLog.model';

const logger = createLogger('AdminDashboard');

export class AdminDashboardService extends EventEmitter {
  private static instance: AdminDashboardService;
  private metricsInterval: NodeJS.Timeout | null = null;
  private metricsHistory: IDashboardMetrics[] = [];
  private maxHistorySize: number = 100;
  private updateFrequency: number = 10000; // 10 seconds
  private alerts: any[] = [];
  
  private constructor() {
    super();
    this.setMaxListeners(1000);
    this.startMetricsCollection();
  }
  
  public static getInstance(): AdminDashboardService {
    if (!AdminDashboardService.instance) {
      AdminDashboardService.instance = new AdminDashboardService();
    }
    return AdminDashboardService.instance;
  }
  
  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(async () => {
      const metrics = await this.collectMetrics();
      this.metricsHistory.push(metrics);
      
      if (this.metricsHistory.length > this.maxHistorySize) {
        this.metricsHistory.shift();
      }
      
      // Check for alerts
      this.checkAlerts(metrics);
      
      // Emit metrics update
      this.emit('metrics_updated', metrics);
    }, this.updateFrequency);
    
    logger.info('Dashboard metrics collection started');
  }
  
  /**
   * Collect current metrics
   */
  private async collectMetrics(): Promise<IDashboardMetrics> {
    const [
      systemHealth,
      userActivity,
      riskMetrics,
      marketMetrics,
      recentAlerts
    ] = await Promise.all([
      this.collectSystemHealth(),
      this.collectUserActivity(),
      this.collectRiskMetrics(),
      this.collectMarketMetrics(),
      this.collectRecentAlerts()
    ]);
    
    return {
      timestamp: new Date(),
      health: systemHealth,
      activity: userActivity,
      risk: riskMetrics,
      markets: marketMetrics,
      alerts: recentAlerts,
    };
  }
  
  /**
   * Collect system health metrics
   */
  private async collectSystemHealth(): Promise<ISystemHealth> {
    const engineStatus = engineControlService.getEngineStatus();
    const engineMetrics = engineStatus.metrics;
    const feedStats = feedManagerService.getStatistics();
    
    // Calculate subsystem statuses
    const matchingEngineStatus = engineStatus.status === 'running' ? 'operational' :
                                 engineStatus.status === 'paused' ? 'degraded' : 'down';
    
    const priceFeedsStatus = feedStats.primaryFeed ? 'operational' : 'degraded';
    
    // Simple database check
    let databaseStatus: 'operational' | 'degraded' | 'down' = 'operational';
    try {
      await Position.findOne().limit(1).lean();
    } catch {
      databaseStatus = 'down';
    }
    
    // Calculate overall status
    const criticalDown = [matchingEngineStatus, priceFeedsStatus, databaseStatus]
      .filter(s => s === 'down').length;
    const degraded = [matchingEngineStatus, priceFeedsStatus, databaseStatus]
      .filter(s => s === 'degraded').length;
    
    const overallStatus = criticalDown > 0 ? 'critical' :
                          degraded > 1 ? 'degraded' : 'healthy';
    
    // Get error metrics
    const recentErrors = await this.getRecentErrors();
    
    return {
      status: overallStatus,
      uptime: process.uptime(),
      performance: {
        orderLatency: engineMetrics.averageLatency || 0,
        matchingRate: engineMetrics.ordersProcessed || 0,
        apiResponseTime: 50, // Would measure actual API response time
        wsMessageRate: 100, // Would measure actual WebSocket message rate
        dbQueryTime: 10, // Would measure actual database query time
      },
      resources: {
        cpuUsage: process.cpuUsage().user / 1000000, // Convert to seconds
        memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024, // MB
        diskUsage: 0, // Would measure actual disk usage
        connections: {
          database: 1, // Would count actual connections
          websocket: 0, // Would count actual WebSocket connections
          api: 0, // Would count actual API connections
        },
      },
      errors: {
        rate: recentErrors.length / 100, // errors per second
        recent: recentErrors,
      },
      subsystems: {
        matchingEngine: matchingEngineStatus,
        priceFeeds: priceFeedsStatus,
        database: databaseStatus,
        cache: 'operational', // Would check actual cache status
        websocket: 'operational', // Would check actual WebSocket status
      },
    };
  }
  
  /**
   * Collect user activity metrics
   */
  private async collectUserActivity(): Promise<IUserActivity> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    const oneDayAgo = new Date(now.getTime() - 86400000);
    const oneWeekAgo = new Date(now.getTime() - 604800000);
    const startOfToday = new Date(now.setHours(0, 0, 0, 0));
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const [
      totalUsers,
      activeUsersLast1h,
      activeUsersLast24h,
      activeUsersLast7d,
      newUsersToday,
      newUsersThisWeek,
      newUsersThisMonth,
      activeTraders,
      ordersLastHour,
      tradesLastHour,
      openPositions,
      positionStats
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ lastActive: { $gte: oneHourAgo } }),
      User.countDocuments({ lastActive: { $gte: oneDayAgo } }),
      User.countDocuments({ lastActive: { $gte: oneWeekAgo } }),
      User.countDocuments({ createdAt: { $gte: startOfToday } }),
      User.countDocuments({ createdAt: { $gte: startOfWeek } }),
      User.countDocuments({ createdAt: { $gte: startOfMonth } }),
      Order.distinct('userId', { createdAt: { $gte: oneDayAgo } }),
      Order.countDocuments({ createdAt: { $gte: oneHourAgo } }),
      Trade.countDocuments({ timestamp: { $gte: oneHourAgo } }),
      Position.countDocuments({ status: 'OPEN' }),
      this.getPositionStats()
    ]);
    
    // Calculate volume
    const volumeLastHour = await Trade.aggregate([
      { $match: { timestamp: { $gte: oneHourAgo } } },
      { $group: { _id: null, volume: { $sum: '$total' } } }
    ]);
    
    return {
      totalUsers,
      activeUsers: {
        last1h: activeUsersLast1h,
        last24h: activeUsersLast24h,
        last7d: activeUsersLast7d,
      },
      newUsers: {
        today: newUsersToday,
        thisWeek: newUsersThisWeek,
        thisMonth: newUsersThisMonth,
      },
      trading: {
        activeTraders: activeTraders.length,
        ordersPerHour: ordersLastHour,
        tradesPerHour: tradesLastHour,
        volumePerHour: volumeLastHour[0]?.volume || 0,
      },
      positions: {
        open: openPositions,
        totalValue: positionStats.totalValue,
        averageSize: positionStats.averageSize,
        distribution: positionStats.distribution,
      },
    };
  }
  
  /**
   * Collect risk metrics
   */
  private async collectRiskMetrics(): Promise<any> {
    const systemRisk = await riskMonitoringService.calculateSystemRiskMetrics();
    const insuranceFund = liquidationEngineService.getInsuranceFund();
    const liquidationQueue = liquidationEngineService.getLiquidationQueue();
    
    return {
      totalExposure: systemRisk.totalExposure,
      marginUtilization: systemRisk.accountMarginRatio,
      liquidationQueue: liquidationQueue.positions.length,
      highRiskPositions: systemRisk.positions.filter(p => p.marginRatio > 0.8).length,
      insuranceFundBalance: insuranceFund.balance,
    };
  }
  
  /**
   * Collect market metrics
   */
  private async collectMarketMetrics(): Promise<any[]> {
    const markets = marketManagementService.getAllMarkets();
    const metrics = [];
    
    for (const market of markets) {
      const volume24h = await this.getMarketVolume24h(market.symbol);
      const trades24h = await this.getMarketTrades24h(market.symbol);
      const currentPrice = feedManagerService.getCurrentPrice(market.symbol);
      
      metrics.push({
        symbol: market.symbol,
        status: market.status,
        volume24h,
        trades24h,
        spread: currentPrice ? (currentPrice.ask - currentPrice.bid) / currentPrice.price : 0,
        volatility: 0, // Would calculate actual volatility
      });
    }
    
    return metrics;
  }
  
  /**
   * Collect recent alerts
   */
  private async collectRecentAlerts(): Promise<any[]> {
    const activeAlerts = riskMonitoringService.getActiveAlerts();
    
    return activeAlerts.map(alert => ({
      id: alert.alertId,
      type: alert.type,
      severity: alert.severity,
      message: alert.message,
      timestamp: alert.timestamp,
      acknowledged: alert.acknowledged,
    }));
  }
  
  /**
   * Check for new alerts
   */
  private checkAlerts(metrics: IDashboardMetrics): void {
    // Check system health
    if (metrics.health.status === 'critical') {
      this.createAlert('SYSTEM_CRITICAL', 'critical', 'System health critical');
    }
    
    // Check risk metrics
    if (metrics.risk.marginUtilization > 0.9) {
      this.createAlert('HIGH_MARGIN_UTILIZATION', 'high', 'System margin utilization above 90%');
    }
    
    if (metrics.risk.liquidationQueue > 10) {
      this.createAlert('LIQUIDATION_QUEUE_HIGH', 'high', `${metrics.risk.liquidationQueue} positions in liquidation queue`);
    }
    
    // Check market metrics
    for (const market of metrics.markets) {
      if (market.status !== 'active') {
        this.createAlert('MARKET_INACTIVE', 'medium', `Market ${market.symbol} is ${market.status}`);
      }
    }
  }
  
  /**
   * Create alert
   */
  private createAlert(type: string, severity: string, message: string): void {
    const alert = {
      id: `ALERT-${Date.now()}`,
      type,
      severity,
      message,
      timestamp: new Date(),
      acknowledged: false,
    };
    
    this.alerts.push(alert);
    
    // Keep only recent alerts
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100);
    }
    
    // Emit alert
    this.emit('alert_created', alert);
    
    logger.warn(`Dashboard alert: ${message}`);
  }
  
  /**
   * Get recent errors
   */
  private async getRecentErrors(): Promise<any[]> {
    // Would aggregate actual errors from various sources
    return [];
  }
  
  /**
   * Get position statistics
   */
  private async getPositionStats(): Promise<any> {
    const positions = await Position.find({ status: 'OPEN' }).lean();
    
    const totalValue = positions.reduce((sum, p) => sum + (parseFloat(p.quantity.toString()) * parseFloat(p.markPrice.toString())), 0);
    const averageSize = positions.length > 0 ? totalValue / positions.length : 0;
    
    // Calculate distribution by symbol
    const distribution: { [symbol: string]: number } = {};
    for (const position of positions) {
      distribution[position.symbol] = (distribution[position.symbol] || 0) + 1;
    }
    
    return {
      totalValue,
      averageSize,
      distribution,
    };
  }
  
  /**
   * Get market volume 24h
   */
  private async getMarketVolume24h(symbol: string): Promise<number> {
    const oneDayAgo = new Date(Date.now() - 86400000);
    
    const result = await Trade.aggregate([
      {
        $match: {
          symbol,
          timestamp: { $gte: oneDayAgo }
        }
      },
      {
        $group: {
          _id: null,
          volume: { $sum: '$total' }
        }
      }
    ]);
    
    return result[0]?.volume || 0;
  }
  
  /**
   * Get market trades 24h
   */
  private async getMarketTrades24h(symbol: string): Promise<number> {
    const oneDayAgo = new Date(Date.now() - 86400000);
    
    return await Trade.countDocuments({
      symbol,
      timestamp: { $gte: oneDayAgo }
    });
  }
  
  /**
   * Get current dashboard metrics
   */
  async getCurrentMetrics(): Promise<IDashboardMetrics> {
    return await this.collectMetrics();
  }
  
  /**
   * Get metrics history
   */
  getMetricsHistory(): IDashboardMetrics[] {
    return [...this.metricsHistory];
  }
  
  /**
   * Get audit log summary
   */
  async getAuditLogSummary(hours: number = 24): Promise<any> {
    const since = new Date(Date.now() - hours * 3600000);
    
    const logs = await AdminAuditLog.aggregate([
      {
        $match: {
          timestamp: { $gte: since }
        }
      },
      {
        $group: {
          _id: '$action',
          count: { $sum: 1 },
          admins: { $addToSet: '$adminEmail' }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    const totalActions = logs.reduce((sum, log) => sum + log.count, 0);
    const uniqueAdmins = new Set();
    logs.forEach(log => log.admins.forEach(admin => uniqueAdmins.add(admin)));
    
    return {
      period: `Last ${hours} hours`,
      totalActions,
      uniqueAdmins: uniqueAdmins.size,
      actionBreakdown: logs.map(log => ({
        action: log._id,
        count: log.count,
        percentage: (log.count / totalActions) * 100
      })),
      recentLogs: await AdminAuditLog.find({})
        .sort({ timestamp: -1 })
        .limit(10)
        .lean()
    };
  }
  
  /**
   * Get system statistics
   */
  async getSystemStatistics(): Promise<any> {
    const [
      totalUsers,
      totalOrders,
      totalTrades,
      totalPositions,
      totalWallets,
      totalMarkets
    ] = await Promise.all([
      User.countDocuments({}),
      Order.countDocuments({}),
      Trade.countDocuments({}),
      Position.countDocuments({}),
      Wallet.countDocuments({}),
      marketManagementService.getAllMarkets().length
    ]);
    
    return {
      database: {
        totalUsers,
        totalOrders,
        totalTrades,
        totalPositions,
        totalWallets,
      },
      markets: {
        total: totalMarkets,
        active: marketManagementService.getAllMarkets().filter(m => m.status === 'active').length,
        suspended: marketManagementService.getAllMarkets().filter(m => m.status === 'suspended').length,
      },
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        nodeVersion: process.version,
        platform: process.platform,
      },
    };
  }
  
  /**
   * Acknowledge alert
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      return true;
    }
    return false;
  }
  
  /**
   * Clear alerts
   */
  clearAlerts(): void {
    this.alerts = [];
    logger.info('Dashboard alerts cleared');
  }
  
  /**
   * Stop metrics collection
   */
  stop(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
    
    logger.info('Dashboard metrics collection stopped');
  }
}

export default AdminDashboardService.getInstance();