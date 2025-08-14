import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import {
  IRiskConfig,
  ICircuitBreaker,
  AdminAction,
  IAdminAuditLog
} from '../types/admin';
import { AdminAuditLog } from '../models/AdminAuditLog.model';
import riskMonitoringService from './riskMonitoring.service';
import liquidationEngineService from './liquidationEngine.service';
import positionManagementService from './positionManagement.service';
import marginCalculationService from './marginCalculation.service';
import { Position } from '../models/Position.model';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';

const logger = createLogger('RiskControl');

export class RiskControlService extends EventEmitter {
  private static instance: RiskControlService;
  private riskConfig: IRiskConfig;
  private circuitBreakers: Map<string, ICircuitBreaker> = new Map();
  private positionLimits: Map<string, number> = new Map(); // userId -> limit
  private exposureLimits: Map<string, number> = new Map(); // symbol -> limit
  
  private constructor() {
    super();
    this.setMaxListeners(1000);
    this.initializeRiskConfig();
    this.startMonitoring();
  }
  
  public static getInstance(): RiskControlService {
    if (!RiskControlService.instance) {
      RiskControlService.instance = new RiskControlService();
    }
    return RiskControlService.instance;
  }
  
  /**
   * Initialize risk configuration
   */
  private initializeRiskConfig(): void {
    this.riskConfig = {
      global: {
        maxTotalExposure: 100000000, // $100M
        maxUserExposure: 10000000, // $10M per user
        maxSymbolExposure: 50000000, // $50M per symbol
        maintenanceMarginRate: 0.05,
        liquidationFeeRate: 0.005,
        insuranceFundTarget: 1000000,
      },
      perSymbol: new Map(),
      leverageTiers: new Map(),
      positionLimits: {
        maxPositionsPerUser: 50,
        maxPositionsPerSymbol: 1000,
        concentrationLimit: 0.3, // 30% of total exposure
      },
    };
    
    // Initialize default per-symbol configs
    const defaultSymbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
    for (const symbol of defaultSymbols) {
      this.riskConfig.perSymbol.set(symbol, {
        maxPositionSize: 1000000,
        maxLeverage: 125,
        minMarginRate: 0.01,
        priceBands: {
          enabled: true,
          percentage: 0.1, // 10%
        },
        circuitBreaker: {
          enabled: true,
          threshold: 0.15, // 15% price move
          cooldown: 300, // 5 minutes
        },
      });
      
      // Initialize circuit breaker
      this.circuitBreakers.set(symbol, {
        symbol,
        enabled: true,
        status: 'normal',
        thresholds: {
          priceChange: 0.15,
          volumeSpike: 10,
          liquidationRate: 100,
        },
        cooldownPeriod: 300,
        triggerCount: 0,
      });
    }
  }
  
  /**
   * Start monitoring
   */
  private startMonitoring(): void {
    // Monitor circuit breakers every 5 seconds
    setInterval(() => {
      this.checkCircuitBreakers();
    }, 5000);
    
    // Monitor exposure limits every 10 seconds
    setInterval(() => {
      this.checkExposureLimits();
    }, 10000);
  }
  
  /**
   * Update risk parameters
   */
  async updateRiskParameters(
    updates: Partial<IRiskConfig['global']>,
    adminId: string,
    adminEmail: string,
    reason?: string
  ): Promise<IRiskConfig> {
    const before = { ...this.riskConfig.global };
    
    // Apply updates
    Object.assign(this.riskConfig.global, updates);
    
    // Update risk monitoring service
    riskMonitoringService.updateSystemRiskParameters({
      maxTotalExposure: this.riskConfig.global.maxTotalExposure,
      maintenanceMarginRates: [],
      liquidationFeeRate: this.riskConfig.global.liquidationFeeRate,
      insuranceFundTarget: this.riskConfig.global.insuranceFundTarget,
    });
    
    // Log audit
    await this.logAudit({
      action: AdminAction.UPDATE_RISK_PARAMS,
      adminId,
      adminEmail,
      targetType: 'SYSTEM',
      before,
      after: this.riskConfig.global,
      changes: updates,
      reason,
    });
    
    logger.info(`Risk parameters updated by ${adminEmail}`);
    
    // Emit event
    this.emit('risk_parameters_updated', this.riskConfig);
    
    return this.riskConfig;
  }
  
  /**
   * Update leverage tiers
   */
  async updateLeverageTiers(
    symbol: string,
    tiers: any[],
    adminId: string,
    adminEmail: string,
    reason?: string
  ): Promise<void> {
    const before = this.riskConfig.leverageTiers.get(symbol);
    
    // Update tiers
    this.riskConfig.leverageTiers.set(symbol, tiers);
    
    // Update margin calculation service
    marginCalculationService.setLeverageTiers(symbol, tiers);
    
    // Log audit
    await this.logAudit({
      action: AdminAction.UPDATE_LEVERAGE_TIERS,
      adminId,
      adminEmail,
      targetType: 'MARKET',
      targetId: symbol,
      before,
      after: tiers,
      reason,
    });
    
    logger.info(`Leverage tiers updated for ${symbol} by ${adminEmail}`);
    
    // Emit event
    this.emit('leverage_tiers_updated', { symbol, tiers });
  }
  
  /**
   * Set position limits
   */
  async setPositionLimits(
    limits: {
      maxPositionsPerUser?: number;
      maxPositionsPerSymbol?: number;
      concentrationLimit?: number;
    },
    adminId: string,
    adminEmail: string,
    reason?: string
  ): Promise<void> {
    const before = { ...this.riskConfig.positionLimits };
    
    // Apply updates
    Object.assign(this.riskConfig.positionLimits, limits);
    
    // Log audit
    await this.logAudit({
      action: AdminAction.SET_POSITION_LIMITS,
      adminId,
      adminEmail,
      targetType: 'SYSTEM',
      before,
      after: this.riskConfig.positionLimits,
      changes: limits,
      reason,
    });
    
    logger.info(`Position limits updated by ${adminEmail}`);
    
    // Emit event
    this.emit('position_limits_updated', this.riskConfig.positionLimits);
  }
  
  /**
   * Configure circuit breaker
   */
  async configureCircuitBreaker(
    symbol: string,
    config: Partial<ICircuitBreaker>,
    adminId: string,
    adminEmail: string,
    reason?: string
  ): Promise<ICircuitBreaker> {
    let circuitBreaker = this.circuitBreakers.get(symbol);
    
    if (!circuitBreaker) {
      circuitBreaker = {
        symbol,
        enabled: false,
        status: 'normal',
        thresholds: {
          priceChange: 0.15,
          volumeSpike: 10,
          liquidationRate: 100,
        },
        cooldownPeriod: 300,
        triggerCount: 0,
      };
      this.circuitBreakers.set(symbol, circuitBreaker);
    }
    
    const before = { ...circuitBreaker };
    
    // Apply updates
    Object.assign(circuitBreaker, config);
    
    // Update per-symbol config
    const symbolConfig = this.riskConfig.perSymbol.get(symbol);
    if (symbolConfig) {
      symbolConfig.circuitBreaker = {
        enabled: circuitBreaker.enabled,
        threshold: circuitBreaker.thresholds.priceChange,
        cooldown: circuitBreaker.cooldownPeriod,
      };
    }
    
    // Log audit
    await this.logAudit({
      action: AdminAction.CONFIGURE_CIRCUIT_BREAKER,
      adminId,
      adminEmail,
      targetType: 'MARKET',
      targetId: symbol,
      before,
      after: circuitBreaker,
      changes: config,
      reason,
    });
    
    logger.info(`Circuit breaker configured for ${symbol} by ${adminEmail}`);
    
    // Emit event
    this.emit('circuit_breaker_configured', { symbol, config: circuitBreaker });
    
    return circuitBreaker;
  }
  
  /**
   * Force liquidation
   */
  async forceLiquidation(
    positionId: string,
    adminId: string,
    adminEmail: string,
    reason: string
  ): Promise<void> {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Get position
      const position = await Position.findOne({ positionId }).session(session).lean();
      
      if (!position) {
        throw new Error('Position not found');
      }
      
      // Log audit first
      await this.logAudit({
        action: AdminAction.FORCE_LIQUIDATION,
        adminId,
        adminEmail,
        targetType: 'POSITION',
        targetId: positionId,
        before: position,
        reason,
      }, session);
      
      await session.commitTransaction();
      
      // Execute liquidation
      const result = await liquidationEngineService.forceLiquidate(positionId);
      
      if (result) {
        logger.warn(`Position ${positionId} force liquidated by ${adminEmail}. Reason: ${reason}`);
        
        // Emit event
        this.emit('position_force_liquidated', {
          positionId,
          adminId,
          adminEmail,
          reason,
          result,
        });
      }
      
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error forcing liquidation', error);
      throw error;
    } finally {
      session.endSession();
    }
  }
  
  /**
   * Set user exposure limit
   */
  async setUserExposureLimit(
    userId: string,
    limit: number,
    adminId: string,
    adminEmail: string,
    reason?: string
  ): Promise<void> {
    const before = this.positionLimits.get(userId);
    
    // Set limit
    this.positionLimits.set(userId, limit);
    
    // Check current exposure
    const positions = await positionManagementService.getUserPositions(userId);
    let totalExposure = 0;
    
    for (const position of positions) {
      totalExposure += position.quantity * position.markPrice;
    }
    
    if (totalExposure > limit) {
      logger.warn(`User ${userId} current exposure (${totalExposure}) exceeds new limit (${limit})`);
      
      // Emit warning
      this.emit('exposure_limit_exceeded', {
        userId,
        currentExposure: totalExposure,
        limit,
      });
    }
    
    // Log audit
    await this.logAudit({
      action: AdminAction.UPDATE_RISK_PARAMS,
      adminId,
      adminEmail,
      targetType: 'USER',
      targetId: userId,
      before: { limit: before },
      after: { limit },
      reason,
    });
    
    logger.info(`User ${userId} exposure limit set to ${limit} by ${adminEmail}`);
  }
  
  /**
   * Set symbol exposure limit
   */
  async setSymbolExposureLimit(
    symbol: string,
    limit: number,
    adminId: string,
    adminEmail: string,
    reason?: string
  ): Promise<void> {
    const before = this.exposureLimits.get(symbol);
    
    // Set limit
    this.exposureLimits.set(symbol, limit);
    
    // Update per-symbol config
    let symbolConfig = this.riskConfig.perSymbol.get(symbol);
    if (!symbolConfig) {
      symbolConfig = {
        maxPositionSize: limit,
        maxLeverage: 125,
        minMarginRate: 0.01,
        priceBands: { enabled: true, percentage: 0.1 },
        circuitBreaker: { enabled: true, threshold: 0.15, cooldown: 300 },
      };
      this.riskConfig.perSymbol.set(symbol, symbolConfig);
    } else {
      symbolConfig.maxPositionSize = limit;
    }
    
    // Log audit
    await this.logAudit({
      action: AdminAction.UPDATE_RISK_PARAMS,
      adminId,
      adminEmail,
      targetType: 'MARKET',
      targetId: symbol,
      before: { limit: before },
      after: { limit },
      reason,
    });
    
    logger.info(`Symbol ${symbol} exposure limit set to ${limit} by ${adminEmail}`);
  }
  
  /**
   * Trigger circuit breaker manually
   */
  async triggerCircuitBreaker(
    symbol: string,
    duration: number, // seconds
    adminId: string,
    adminEmail: string,
    reason: string
  ): Promise<void> {
    const circuitBreaker = this.circuitBreakers.get(symbol);
    
    if (!circuitBreaker) {
      throw new Error(`Circuit breaker not configured for ${symbol}`);
    }
    
    // Trigger circuit breaker
    circuitBreaker.status = 'triggered';
    circuitBreaker.triggeredAt = new Date();
    circuitBreaker.resumeAt = new Date(Date.now() + duration * 1000);
    circuitBreaker.triggerCount++;
    
    // Pause trading
    const marketManagementService = (await import('./marketManagement.service')).default;
    await marketManagementService.emergencyHalt(symbol, duration / 60, reason, adminId, adminEmail);
    
    logger.warn(`Circuit breaker triggered for ${symbol} by ${adminEmail}. Duration: ${duration}s. Reason: ${reason}`);
    
    // Schedule reset
    setTimeout(() => {
      this.resetCircuitBreaker(symbol);
    }, duration * 1000);
    
    // Emit event
    this.emit('circuit_breaker_triggered', {
      symbol,
      duration,
      reason,
      adminId,
      adminEmail,
    });
  }
  
  /**
   * Reset circuit breaker
   */
  private resetCircuitBreaker(symbol: string): void {
    const circuitBreaker = this.circuitBreakers.get(symbol);
    
    if (circuitBreaker && circuitBreaker.status === 'triggered') {
      circuitBreaker.status = 'cooldown';
      
      // Set cooldown period
      setTimeout(() => {
        circuitBreaker.status = 'normal';
        logger.info(`Circuit breaker for ${symbol} returned to normal`);
      }, circuitBreaker.cooldownPeriod * 1000);
      
      logger.info(`Circuit breaker for ${symbol} entering cooldown`);
    }
  }
  
  /**
   * Check circuit breakers
   */
  private async checkCircuitBreakers(): Promise<void> {
    for (const [symbol, circuitBreaker] of this.circuitBreakers) {
      if (!circuitBreaker.enabled || circuitBreaker.status !== 'normal') {
        continue;
      }
      
      // Check conditions (simplified - would need actual price/volume data)
      // This is a placeholder for demonstration
      const shouldTrigger = false; // Would check actual conditions
      
      if (shouldTrigger) {
        await this.triggerCircuitBreaker(
          symbol,
          circuitBreaker.cooldownPeriod,
          'SYSTEM',
          'system@admin',
          'Automatic trigger based on thresholds'
        );
      }
    }
  }
  
  /**
   * Check exposure limits
   */
  private async checkExposureLimits(): Promise<void> {
    try {
      // Check global exposure
      const metrics = await riskMonitoringService.calculateSystemRiskMetrics();
      
      if (metrics.totalExposure > this.riskConfig.global.maxTotalExposure) {
        logger.warn(`Global exposure (${metrics.totalExposure}) exceeds limit (${this.riskConfig.global.maxTotalExposure})`);
        
        this.emit('global_exposure_exceeded', {
          currentExposure: metrics.totalExposure,
          limit: this.riskConfig.global.maxTotalExposure,
        });
      }
      
      // Check per-symbol exposure
      const symbolExposure = new Map<string, number>();
      
      for (const position of metrics.positions) {
        const current = symbolExposure.get(position.symbol) || 0;
        symbolExposure.set(position.symbol, current + position.notional);
      }
      
      for (const [symbol, exposure] of symbolExposure) {
        const limit = this.exposureLimits.get(symbol) || this.riskConfig.global.maxSymbolExposure;
        
        if (exposure > limit) {
          logger.warn(`Symbol ${symbol} exposure (${exposure}) exceeds limit (${limit})`);
          
          this.emit('symbol_exposure_exceeded', {
            symbol,
            currentExposure: exposure,
            limit,
          });
        }
      }
      
    } catch (error) {
      logger.error('Error checking exposure limits', error);
    }
  }
  
  /**
   * Add to insurance fund
   */
  async addToInsuranceFund(
    amount: number,
    adminId: string,
    adminEmail: string,
    reason?: string
  ): Promise<void> {
    await liquidationEngineService.addToInsuranceFund(amount);
    
    // Log audit
    await this.logAudit({
      action: AdminAction.UPDATE_RISK_PARAMS,
      adminId,
      adminEmail,
      targetType: 'SYSTEM',
      targetId: 'INSURANCE_FUND',
      after: { amount },
      reason,
    });
    
    logger.info(`Added ${amount} to insurance fund by ${adminEmail}`);
    
    // Emit event
    this.emit('insurance_fund_updated', {
      amount,
      adminId,
      adminEmail,
    });
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
   * Get risk configuration
   */
  getRiskConfig(): IRiskConfig {
    return this.riskConfig;
  }
  
  /**
   * Get circuit breakers
   */
  getCircuitBreakers(): Map<string, ICircuitBreaker> {
    return new Map(this.circuitBreakers);
  }
  
  /**
   * Get insurance fund status
   */
  getInsuranceFundStatus() {
    return liquidationEngineService.getInsuranceFund();
  }
}

export default RiskControlService.getInstance();