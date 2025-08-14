import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import {
  IScenario,
  IScenarioResult,
  AdminAction,
  IAdminAuditLog
} from '../types/admin';
import { OrderType, OrderSide, OrderStatus, TimeInForce } from '../types/enums';
import { toDecimal128 } from '../utils/database';
import { AdminAuditLog } from '../models/AdminAuditLog.model';
import feedManagerService from './feedManager.service';
import matchingEngineService from './matchingEngine.service';
import riskMonitoringService from './riskMonitoring.service';
import liquidationEngineService from './liquidationEngine.service';
import positionManagementService from './positionManagement.service';
import configurationManagementService from './configurationManagement.service';
import { v4 as uuidv4 } from 'uuid';
import { Order } from '../models/Order.model';
import { Position } from '../models/Position.model';
import { Trade } from '../models/Trade.model';

const logger = createLogger('ScenarioTesting');

export class ScenarioTestingService extends EventEmitter {
  private static instance: ScenarioTestingService;
  private scenarios: Map<string, IScenario> = new Map();
  private runningScenarios: Set<string> = new Set();
  private scheduledScenarios: Map<string, NodeJS.Timeout> = new Map();
  
  private constructor() {
    super();
    this.setMaxListeners(1000);
    this.initializeDefaultScenarios();
  }
  
  public static getInstance(): ScenarioTestingService {
    if (!ScenarioTestingService.instance) {
      ScenarioTestingService.instance = new ScenarioTestingService();
    }
    return ScenarioTestingService.instance;
  }
  
  /**
   * Initialize default scenarios
   */
  private initializeDefaultScenarios(): void {
    // Market crash scenario
    this.scenarios.set('CRASH_SCENARIO', {
      scenarioId: 'CRASH_SCENARIO',
      name: 'Market Crash',
      description: 'Simulates a sudden market crash',
      type: 'CRASH',
      parameters: {
        duration: 10, // 10 minutes
        intensity: 8, // High intensity
        priceChanges: {
          BTCUSDT: -20,
          ETHUSDT: -25,
          BNBUSDT: -30,
        },
        volumeMultiplier: 5,
        volatilityMultiplier: 3,
      },
      createdBy: 'SYSTEM',
      createdAt: new Date(),
    });
    
    // Market spike scenario
    this.scenarios.set('SPIKE_SCENARIO', {
      scenarioId: 'SPIKE_SCENARIO',
      name: 'Market Spike',
      description: 'Simulates a sudden price spike',
      type: 'SPIKE',
      parameters: {
        duration: 5,
        intensity: 7,
        priceChanges: {
          BTCUSDT: 15,
          ETHUSDT: 20,
          BNBUSDT: 25,
        },
        volumeMultiplier: 3,
        volatilityMultiplier: 2,
      },
      createdBy: 'SYSTEM',
      createdAt: new Date(),
    });
    
    // Liquidity crisis scenario
    this.scenarios.set('LIQUIDITY_CRISIS', {
      scenarioId: 'LIQUIDITY_CRISIS',
      name: 'Liquidity Crisis',
      description: 'Simulates a liquidity crisis with wide spreads',
      type: 'LIQUIDITY_CRISIS',
      parameters: {
        duration: 15,
        intensity: 9,
        volumeMultiplier: 0.1, // Very low volume
        volatilityMultiplier: 5,
      },
      createdBy: 'SYSTEM',
      createdAt: new Date(),
    });
    
    // Mass liquidation scenario
    this.scenarios.set('MASS_LIQUIDATION', {
      scenarioId: 'MASS_LIQUIDATION',
      name: 'Mass Liquidation',
      description: 'Simulates cascading liquidations',
      type: 'MASS_LIQUIDATION',
      parameters: {
        duration: 8,
        intensity: 10,
        priceChanges: {
          BTCUSDT: -15,
          ETHUSDT: -18,
          BNBUSDT: -20,
        },
        liquidationRate: 50, // 50 liquidations per minute
      },
      createdBy: 'SYSTEM',
      createdAt: new Date(),
    });
    
    // Order flood scenario
    this.scenarios.set('ORDER_FLOOD', {
      scenarioId: 'ORDER_FLOOD',
      name: 'Order Flood',
      description: 'Simulates high order submission rate',
      type: 'ORDER_FLOOD',
      parameters: {
        duration: 5,
        intensity: 7,
        orderRate: 1000, // 1000 orders per minute
        volumeMultiplier: 10,
      },
      createdBy: 'SYSTEM',
      createdAt: new Date(),
    });
    
    // Feed failure scenario
    this.scenarios.set('FEED_FAILURE', {
      scenarioId: 'FEED_FAILURE',
      name: 'Feed Failure',
      description: 'Simulates price feed failures',
      type: 'FEED_FAILURE',
      parameters: {
        duration: 3,
        intensity: 5,
        feedFailureType: 'OUTAGE',
      },
      createdBy: 'SYSTEM',
      createdAt: new Date(),
    });
  }
  
  /**
   * Create scenario
   */
  async createScenario(
    scenario: Omit<IScenario, 'scenarioId' | 'createdAt' | 'results'>,
    adminId: string,
    adminEmail: string
  ): Promise<IScenario> {
    const newScenario: IScenario = {
      ...scenario,
      scenarioId: `SCENARIO-${Date.now()}-${uuidv4().substring(0, 8)}`,
      createdBy: adminEmail,
      createdAt: new Date(),
      results: [],
    };
    
    this.scenarios.set(newScenario.scenarioId, newScenario);
    
    // Schedule if enabled
    if (newScenario.schedule?.enabled && newScenario.schedule.cronExpression) {
      this.scheduleScenario(newScenario);
    }
    
    // Log audit
    await this.logAudit({
      action: AdminAction.EXECUTE_SCENARIO,
      adminId,
      adminEmail,
      targetType: 'SYSTEM',
      targetId: newScenario.scenarioId,
      after: newScenario,
      metadata: { action: 'create_scenario' },
    });
    
    logger.info(`Scenario created: ${newScenario.name} by ${adminEmail}`);
    
    // Emit event
    this.emit('scenario_created', newScenario);
    
    return newScenario;
  }
  
  /**
   * Execute scenario
   */
  async executeScenario(
    scenarioId: string,
    adminId: string,
    adminEmail: string
  ): Promise<IScenarioResult> {
    const scenario = this.scenarios.get(scenarioId);
    
    if (!scenario) {
      throw new Error(`Scenario ${scenarioId} not found`);
    }
    
    if (this.runningScenarios.has(scenarioId)) {
      throw new Error(`Scenario ${scenarioId} is already running`);
    }
    
    this.runningScenarios.add(scenarioId);
    
    const executionId = `EXEC-${Date.now()}-${uuidv4().substring(0, 8)}`;
    const startTime = new Date();
    
    logger.info(`Starting scenario execution: ${scenario.name} (${executionId})`);
    
    // Create configuration snapshot before scenario
    const beforeSnapshot = await configurationManagementService.createSnapshot(
      `Pre-scenario snapshot: ${scenario.name}`,
      adminId,
      adminEmail
    );
    
    // Collect initial metrics
    const beforeMetrics = await this.collectSystemMetrics();
    
    try {
      // Execute scenario based on type
      const result = await this.executeScenarioByType(scenario, executionId);
      
      // Collect final metrics
      const afterMetrics = await this.collectSystemMetrics();
      
      // Create result
      const scenarioResult: IScenarioResult = {
        executionId,
        scenarioId,
        startTime,
        endTime: new Date(),
        success: true,
        metrics: {
          ordersProcessed: result.ordersProcessed || 0,
          tradesExecuted: result.tradesExecuted || 0,
          positionsLiquidated: result.positionsLiquidated || 0,
          totalVolume: result.totalVolume || 0,
          priceImpact: result.priceImpact || {},
          systemLoad: result.systemLoad || 0,
          errorCount: result.errorCount || 0,
        },
        logs: result.logs || [],
        snapshots: {
          before: beforeMetrics,
          after: afterMetrics,
        },
      };
      
      // Store result
      if (!scenario.results) {
        scenario.results = [];
      }
      scenario.results.push(scenarioResult);
      scenario.lastRun = new Date();
      
      // Log audit
      await this.logAudit({
        action: AdminAction.EXECUTE_SCENARIO,
        adminId,
        adminEmail,
        targetType: 'SYSTEM',
        targetId: scenarioId,
        metadata: {
          executionId,
          result: scenarioResult.metrics,
        },
      });
      
      logger.info(`Scenario execution completed: ${scenario.name} (${executionId})`);
      
      // Emit event
      this.emit('scenario_executed', {
        scenario,
        result: scenarioResult,
      });
      
      return scenarioResult;
      
    } catch (error) {
      logger.error(`Scenario execution failed: ${scenario.name}`, error);
      
      // Create failed result
      const scenarioResult: IScenarioResult = {
        executionId,
        scenarioId,
        startTime,
        endTime: new Date(),
        success: false,
        metrics: {
          ordersProcessed: 0,
          tradesExecuted: 0,
          positionsLiquidated: 0,
          totalVolume: 0,
          priceImpact: {},
          systemLoad: 0,
          errorCount: 1,
        },
        logs: [`Error: ${error.message}`],
        snapshots: {
          before: beforeMetrics,
          after: await this.collectSystemMetrics(),
        },
      };
      
      if (!scenario.results) {
        scenario.results = [];
      }
      scenario.results.push(scenarioResult);
      
      throw error;
      
    } finally {
      this.runningScenarios.delete(scenarioId);
    }
  }
  
  /**
   * Execute scenario by type
   */
  private async executeScenarioByType(
    scenario: IScenario,
    executionId: string
  ): Promise<any> {
    const result: any = {
      ordersProcessed: 0,
      tradesExecuted: 0,
      positionsLiquidated: 0,
      totalVolume: 0,
      priceImpact: {},
      systemLoad: 0,
      errorCount: 0,
      logs: [],
    };
    
    switch (scenario.type) {
      case 'CRASH':
        return await this.executeMarketCrash(scenario, result);
        
      case 'SPIKE':
        return await this.executeMarketSpike(scenario, result);
        
      case 'LIQUIDITY_CRISIS':
        return await this.executeLiquidityCrisis(scenario, result);
        
      case 'MASS_LIQUIDATION':
        return await this.executeMassLiquidation(scenario, result);
        
      case 'ORDER_FLOOD':
        return await this.executeOrderFlood(scenario, result);
        
      case 'FEED_FAILURE':
        return await this.executeFeedFailure(scenario, result);
        
      default:
        throw new Error(`Unknown scenario type: ${scenario.type}`);
    }
  }
  
  /**
   * Execute market crash scenario
   */
  private async executeMarketCrash(scenario: IScenario, result: any): Promise<any> {
    const { duration, priceChanges, volumeMultiplier, volatilityMultiplier } = scenario.parameters;
    
    result.logs.push(`Starting market crash: duration=${duration}min`);
    
    // Apply price changes gradually
    for (const [symbol, change] of Object.entries(priceChanges || {})) {
      const steps = 10; // Apply change in 10 steps
      const stepChange = change / steps;
      const stepDuration = (duration * 60 * 1000) / steps;
      
      for (let i = 0; i < steps; i++) {
        // Inject price change
        feedManagerService.injectPrice(symbol, stepChange, 'relative');
        result.priceImpact[symbol] = (result.priceImpact[symbol] || 0) + stepChange;
        
        // Wait for step duration
        await new Promise(resolve => setTimeout(resolve, stepDuration));
        
        // Check liquidations
        const liquidationQueue = liquidationEngineService.getLiquidationQueue();
        result.positionsLiquidated += liquidationQueue.positions.length;
      }
    }
    
    // Simulate increased volume
    if (volumeMultiplier) {
      result.logs.push(`Volume multiplier: ${volumeMultiplier}x`);
      // Would simulate increased trading volume
    }
    
    // Simulate increased volatility
    if (volatilityMultiplier) {
      result.logs.push(`Volatility multiplier: ${volatilityMultiplier}x`);
      feedManagerService.setVolatility(volatilityMultiplier);
    }
    
    result.logs.push('Market crash scenario completed');
    
    return result;
  }
  
  /**
   * Execute market spike scenario
   */
  private async executeMarketSpike(scenario: IScenario, result: any): Promise<any> {
    const { duration, priceChanges, volumeMultiplier, volatilityMultiplier } = scenario.parameters;
    
    result.logs.push(`Starting market spike: duration=${duration}min`);
    
    // Apply price spikes
    for (const [symbol, change] of Object.entries(priceChanges || {})) {
      // Inject sudden price spike
      feedManagerService.injectPrice(symbol, change, 'relative');
      result.priceImpact[symbol] = change;
      
      result.logs.push(`Price spike for ${symbol}: +${change}%`);
    }
    
    // Simulate FOMO volume
    if (volumeMultiplier) {
      result.logs.push(`FOMO volume: ${volumeMultiplier}x`);
      // Would simulate increased buy orders
    }
    
    // Wait for duration
    await new Promise(resolve => setTimeout(resolve, duration * 60 * 1000));
    
    // Gradual return to normal
    for (const [symbol, change] of Object.entries(priceChanges || {})) {
      feedManagerService.injectPrice(symbol, -change / 2, 'relative');
      result.logs.push(`Price correction for ${symbol}`);
    }
    
    result.logs.push('Market spike scenario completed');
    
    return result;
  }
  
  /**
   * Execute liquidity crisis scenario
   */
  private async executeLiquidityCrisis(scenario: IScenario, result: any): Promise<any> {
    const { duration, volumeMultiplier, volatilityMultiplier } = scenario.parameters;
    
    result.logs.push(`Starting liquidity crisis: duration=${duration}min`);
    
    // Widen spreads for all markets
    const markets = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
    
    for (const symbol of markets) {
      // Increase spread significantly
      feedManagerService.setSpread(symbol, 0.05); // 5% spread
      result.logs.push(`Widened spread for ${symbol} to 5%`);
    }
    
    // Reduce order book depth (simulate by cancelling orders)
    const orders = await Order.find({
      status: { $in: ['OPEN', 'PARTIALLY_FILLED'] },
      type: 'LIMIT',
    }).limit(100).lean();
    
    let cancelledCount = 0;
    for (const order of orders) {
      if (Math.random() > 0.5) { // Cancel 50% of orders
        await matchingEngineService.cancelOrder(
          (order as any).clientOrderId || order._id.toString(),
          order.userId.toString(),
          'Liquidity crisis simulation'
        );
        cancelledCount++;
      }
    }
    
    result.ordersProcessed = cancelledCount;
    result.logs.push(`Cancelled ${cancelledCount} orders to simulate low liquidity`);
    
    // High volatility
    if (volatilityMultiplier) {
      feedManagerService.setVolatility(volatilityMultiplier);
      result.logs.push(`Volatility increased to ${volatilityMultiplier}x`);
    }
    
    // Wait for duration
    await new Promise(resolve => setTimeout(resolve, duration * 60 * 1000));
    
    // Restore normal spreads
    for (const symbol of markets) {
      feedManagerService.setSpread(symbol, 0.001); // Normal 0.1% spread
    }
    
    result.logs.push('Liquidity crisis scenario completed');
    
    return result;
  }
  
  /**
   * Execute mass liquidation scenario
   */
  private async executeMassLiquidation(scenario: IScenario, result: any): Promise<any> {
    const { duration, priceChanges, liquidationRate } = scenario.parameters;
    
    result.logs.push(`Starting mass liquidation: duration=${duration}min`);
    
    // Apply sharp price drops
    for (const [symbol, change] of Object.entries(priceChanges || {})) {
      feedManagerService.injectPrice(symbol, change, 'relative');
      result.priceImpact[symbol] = change;
      result.logs.push(`Price drop for ${symbol}: ${change}%`);
    }
    
    // Monitor liquidations
    const startTime = Date.now();
    const endTime = startTime + (duration * 60 * 1000);
    
    while (Date.now() < endTime) {
      const liquidationQueue = liquidationEngineService.getLiquidationQueue();
      result.positionsLiquidated = liquidationQueue.positions.length;
      
      // Check if we're hitting the expected liquidation rate
      const elapsed = (Date.now() - startTime) / 60000; // minutes
      const expectedLiquidations = liquidationRate * elapsed;
      
      result.logs.push(`Liquidations: ${result.positionsLiquidated} (expected: ${Math.floor(expectedLiquidations)})`);
      
      // Wait 5 seconds before next check
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    // Calculate total liquidation volume
    const liquidationHistory = await Position.find({
      status: 'LIQUIDATED',
      liquidatedAt: { $gte: new Date(startTime) },
    }).lean();
    
    result.totalVolume = liquidationHistory.reduce((sum, pos: any) => {
      return sum + (parseFloat(pos.quantity?.toString() || '0') * parseFloat(pos.liquidationPrice?.toString() || '0'));
    }, 0);
    
    result.logs.push(`Total liquidation volume: $${result.totalVolume.toFixed(2)}`);
    result.logs.push('Mass liquidation scenario completed');
    
    return result;
  }
  
  /**
   * Execute order flood scenario
   */
  private async executeOrderFlood(scenario: IScenario, result: any): Promise<any> {
    const { duration, orderRate, volumeMultiplier } = scenario.parameters;
    
    result.logs.push(`Starting order flood: ${orderRate} orders/min for ${duration}min`);
    
    const totalOrders = orderRate * duration;
    const orderInterval = 60000 / orderRate; // milliseconds between orders
    
    // Generate test orders
    for (let i = 0; i < totalOrders; i++) {
      const testOrder: any = {
        userId: `TEST_USER_${i % 10}`,
        clientOrderId: `TEST-${Date.now()}-${i}`,
        symbol: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'][i % 3],
        type: Math.random() > 0.5 ? OrderType.MARKET : OrderType.LIMIT,
        side: Math.random() > 0.5 ? OrderSide.BUY : OrderSide.SELL,
        quantity: toDecimal128(Math.random() * 10),
        price: Math.random() > 0.5 ? toDecimal128(50000 + Math.random() * 1000) : undefined,
        status: OrderStatus.NEW,
        timeInForce: TimeInForce.GTC,
        executedQty: toDecimal128(0),
        cumulativeQuoteQty: toDecimal128(0),
        fills: [],
        isWorking: true,
        reduceOnly: false,
        postOnly: false,
        closePosition: false,
        isOco: false,
        source: 'system' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      // Submit order to matching engine
      try {
        await matchingEngineService.submitOrder(testOrder);
        result.ordersProcessed++;
      } catch (error) {
        result.errorCount++;
      }
      
      // Check system load
      if (i % 100 === 0) {
        const metrics = matchingEngineService.getMetrics();
        result.systemLoad = Math.max(result.systemLoad, metrics.systemLoad || 0);
      }
      
      // Wait for next order
      await new Promise(resolve => setTimeout(resolve, orderInterval));
    }
    
    result.logs.push(`Processed ${result.ordersProcessed} orders`);
    result.logs.push(`Errors: ${result.errorCount}`);
    result.logs.push(`Peak system load: ${result.systemLoad}%`);
    result.logs.push('Order flood scenario completed');
    
    return result;
  }
  
  /**
   * Execute feed failure scenario
   */
  private async executeFeedFailure(scenario: IScenario, result: any): Promise<any> {
    const { duration, feedFailureType } = scenario.parameters;
    
    result.logs.push(`Starting feed failure: type=${feedFailureType} for ${duration}min`);
    
    switch (feedFailureType) {
      case 'OUTAGE':
        // Simulate complete feed outage
        feedManagerService.simulateOutage(true);
        result.logs.push('Simulating complete feed outage');
        
        // Wait for duration
        await new Promise(resolve => setTimeout(resolve, duration * 60 * 1000));
        
        // Restore feeds
        feedManagerService.simulateOutage(false);
        result.logs.push('Feed restored');
        break;
        
      case 'DELAY':
        // Simulate feed delays
        feedManagerService.setLatency(5000); // 5 second delay
        result.logs.push('Simulating 5 second feed delay');
        
        // Wait for duration
        await new Promise(resolve => setTimeout(resolve, duration * 60 * 1000));
        
        // Restore normal latency
        feedManagerService.setLatency(0);
        result.logs.push('Feed latency normalized');
        break;
        
      case 'CORRUPT':
        // Simulate corrupted data
        feedManagerService.simulateCorruption(true);
        result.logs.push('Simulating corrupted feed data');
        
        // Wait for duration
        await new Promise(resolve => setTimeout(resolve, duration * 60 * 1000));
        
        // Stop corruption
        feedManagerService.simulateCorruption(false);
        result.logs.push('Feed corruption stopped');
        break;
    }
    
    // Check how system handled the failure
    const errorCount = feedManagerService.getErrorCount();
    result.errorCount = errorCount;
    result.logs.push(`Feed errors during failure: ${errorCount}`);
    
    result.logs.push('Feed failure scenario completed');
    
    return result;
  }
  
  /**
   * Schedule scenario
   */
  private scheduleScenario(scenario: IScenario): void {
    if (!scenario.schedule?.cronExpression) return;
    
    // Simple cron implementation (would use node-cron in production)
    // For now, just schedule next run based on the expression
    const nextRun = this.calculateNextRun(scenario.schedule.cronExpression);
    
    if (nextRun) {
      const timeout = setTimeout(() => {
        this.executeScenario(scenario.scenarioId, 'SYSTEM', 'system@admin')
          .then(() => {
            // Reschedule
            this.scheduleScenario(scenario);
          })
          .catch(error => {
            logger.error(`Scheduled scenario execution failed: ${scenario.name}`, error);
          });
      }, nextRun.getTime() - Date.now());
      
      this.scheduledScenarios.set(scenario.scenarioId, timeout);
      scenario.schedule.nextRun = nextRun;
      
      logger.info(`Scenario ${scenario.name} scheduled for ${nextRun}`);
    }
  }
  
  /**
   * Calculate next run time (simplified)
   */
  private calculateNextRun(cronExpression: string): Date | null {
    // Simplified implementation - would use cron parser in production
    // For now, assume daily execution
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow;
  }
  
  /**
   * Collect system metrics
   */
  private async collectSystemMetrics(): Promise<any> {
    const metrics = {
      timestamp: new Date(),
      positions: {
        open: await Position.countDocuments({ status: 'OPEN' }),
        liquidated: await Position.countDocuments({ status: 'LIQUIDATED' }),
      },
      orders: {
        open: await Order.countDocuments({ status: 'OPEN' }),
        filled: await Order.countDocuments({ status: 'FILLED' }),
      },
      trades: {
        count: await Trade.countDocuments({}),
      },
      risk: await riskMonitoringService.calculateSystemRiskMetrics(),
      engine: matchingEngineService.getMetrics(),
      liquidation: liquidationEngineService.getLiquidationQueue(),
      insuranceFund: liquidationEngineService.getInsuranceFund(),
    };
    
    return metrics;
  }
  
  /**
   * Log audit
   */
  private async logAudit(data: Partial<IAdminAuditLog>): Promise<void> {
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
      
      await AdminAuditLog.create(auditLog);
    } catch (error) {
      logger.error('Error logging audit', error);
    }
  }
  
  /**
   * Get scenarios
   */
  getScenarios(): IScenario[] {
    return Array.from(this.scenarios.values());
  }
  
  /**
   * Get scenario by ID
   */
  getScenario(scenarioId: string): IScenario | null {
    return this.scenarios.get(scenarioId) || null;
  }
  
  /**
   * Delete scenario
   */
  async deleteScenario(
    scenarioId: string,
    adminId: string,
    adminEmail: string
  ): Promise<void> {
    const scenario = this.scenarios.get(scenarioId);
    
    if (!scenario) {
      throw new Error(`Scenario ${scenarioId} not found`);
    }
    
    // Cancel if scheduled
    const timeout = this.scheduledScenarios.get(scenarioId);
    if (timeout) {
      clearTimeout(timeout);
      this.scheduledScenarios.delete(scenarioId);
    }
    
    // Delete scenario
    this.scenarios.delete(scenarioId);
    
    // Log audit
    await this.logAudit({
      action: AdminAction.EXECUTE_SCENARIO,
      adminId,
      adminEmail,
      targetType: 'SYSTEM',
      targetId: scenarioId,
      before: scenario,
      metadata: { action: 'delete_scenario' },
    });
    
    logger.info(`Scenario deleted: ${scenario.name} by ${adminEmail}`);
    
    // Emit event
    this.emit('scenario_deleted', { scenarioId });
  }
  
  /**
   * Stop all scenarios
   */
  stopAllScenarios(): void {
    // Cancel all scheduled scenarios
    for (const [scenarioId, timeout] of this.scheduledScenarios) {
      clearTimeout(timeout);
    }
    this.scheduledScenarios.clear();
    
    logger.info('All scheduled scenarios stopped');
  }
}

export default ScenarioTestingService.getInstance();