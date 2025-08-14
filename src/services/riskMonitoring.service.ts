import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import {
  IRiskMetrics,
  IPositionRisk,
  IRiskAlert,
  IStressTestScenario,
  IStressTestResult,
  ISystemRiskParameters,
  IPosition,
  PositionStatus,
  LiquidationLevel,
  MarginMode
} from '../types/margin';
import { Position } from '../models/Position.model';
import { RiskAlert } from '../models/RiskAlert.model';
import { Wallet } from '../models/Wallet.model';
import positionManagementService from './positionManagement.service';
import marginCalculationService from './marginCalculation.service';
import liquidationEngineService from './liquidationEngine.service';
import feedManagerService from './feedManager.service';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('RiskMonitoring');

export class RiskMonitoringService extends EventEmitter {
  private static instance: RiskMonitoringService;
  private activeAlerts: Map<string, IRiskAlert> = new Map();
  private systemRiskParameters: ISystemRiskParameters;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private alertCheckInterval: NodeJS.Timeout | null = null;
  private monitoringFrequency: number = 5000; // 5 seconds
  private alertCheckFrequency: number = 10000; // 10 seconds
  
  // Risk thresholds
  private readonly LARGE_POSITION_THRESHOLD = 100000; // $100k
  private readonly HIGH_LEVERAGE_THRESHOLD = 50; // 50x
  private readonly UNUSUAL_ACTIVITY_THRESHOLD = 10; // 10 trades per minute
  private readonly SYSTEM_EXPOSURE_WARNING = 0.7; // 70% of max exposure
  private readonly SYSTEM_EXPOSURE_CRITICAL = 0.9; // 90% of max exposure
  
  private constructor() {
    super();
    this.setMaxListeners(1000);
    this.initializeRiskParameters();
    this.startMonitoring();
    this.subscribeToEvents();
  }
  
  public static getInstance(): RiskMonitoringService {
    if (!RiskMonitoringService.instance) {
      RiskMonitoringService.instance = new RiskMonitoringService();
    }
    return RiskMonitoringService.instance;
  }
  
  /**
   * Initialize system risk parameters
   */
  private initializeRiskParameters(): void {
    this.systemRiskParameters = {
      maxLeverage: 125,
      maxPositionsPerUser: 50,
      maxPositionSizePerSymbol: 1000000, // $1M
      maxTotalExposure: 100000000, // $100M
      maintenanceMarginRates: marginCalculationService.getAllLeverageTiers().get('BTCUSDT') || [],
      liquidationFeeRate: 0.005,
      insuranceFundTarget: 1000000,
      adlThreshold: 0.98,
      priceBandPercentage: 0.1, // 10% price bands
      emergencyLiquidationThreshold: 0.99,
    };
  }
  
  /**
   * Start monitoring
   */
  private startMonitoring(): void {
    // Monitor system risk metrics
    this.monitoringInterval = setInterval(() => {
      this.monitorSystemRisk();
    }, this.monitoringFrequency);
    
    // Check for alerts
    this.alertCheckInterval = setInterval(() => {
      this.checkForAlerts();
    }, this.alertCheckFrequency);
    
    logger.info('Risk monitoring started');
  }
  
  /**
   * Subscribe to relevant events
   */
  private subscribeToEvents(): void {
    // Position events
    positionManagementService.on('position_opened', (position) => {
      this.checkPositionRisk(position);
    });
    
    positionManagementService.on('leverage_adjusted', ({ position }) => {
      this.checkPositionRisk(position);
    });
    
    // Liquidation events
    liquidationEngineService.on('margin_call', (data) => {
      this.createAlert('MARGIN_CALL', 'MEDIUM', data);
    });
    
    liquidationEngineService.on('liquidation_triggered', (data) => {
      this.createAlert('LIQUIDATION_RISK', 'HIGH', data);
    });
    
    liquidationEngineService.on('position_liquidated', (data) => {
      this.createAlert('LIQUIDATION_RISK', 'CRITICAL', data);
    });
  }
  
  /**
   * Monitor system-wide risk
   */
  private async monitorSystemRisk(): Promise<void> {
    try {
      const metrics = await this.calculateSystemRiskMetrics();
      
      // Check system exposure
      if (metrics.totalExposure > this.systemRiskParameters.maxTotalExposure * this.SYSTEM_EXPOSURE_CRITICAL) {
        this.createAlert('UNUSUAL_ACTIVITY', 'CRITICAL', {
          message: 'System exposure critical',
          totalExposure: metrics.totalExposure,
          maxExposure: this.systemRiskParameters.maxTotalExposure,
        });
      } else if (metrics.totalExposure > this.systemRiskParameters.maxTotalExposure * this.SYSTEM_EXPOSURE_WARNING) {
        this.createAlert('UNUSUAL_ACTIVITY', 'HIGH', {
          message: 'System exposure warning',
          totalExposure: metrics.totalExposure,
          maxExposure: this.systemRiskParameters.maxTotalExposure,
        });
      }
      
      // Check high-risk positions
      for (const positionRisk of metrics.positions) {
        if (positionRisk.riskLevel === LiquidationLevel.CRITICAL || 
            positionRisk.riskLevel === LiquidationLevel.LIQUIDATION) {
          this.createAlert('LIQUIDATION_RISK', 'HIGH', {
            positionId: positionRisk.positionId,
            symbol: positionRisk.symbol,
            marginRatio: positionRisk.marginRatio,
            distanceToLiquidation: positionRisk.distanceToLiquidation,
          });
        }
      }
      
      // Emit metrics
      this.emit('risk_metrics_updated', metrics);
      
    } catch (error) {
      logger.error('Error monitoring system risk', error);
    }
  }
  
  /**
   * Check for various alert conditions
   */
  private async checkForAlerts(): Promise<void> {
    try {
      // Check large positions
      await this.checkLargePositions();
      
      // Check high leverage positions
      await this.checkHighLeveragePositions();
      
      // Check concentrated risk
      await this.checkConcentratedRisk();
      
      // Clean up old alerts
      this.cleanupOldAlerts();
      
    } catch (error) {
      logger.error('Error checking alerts', error);
    }
  }
  
  /**
   * Calculate system risk metrics
   */
  async calculateSystemRiskMetrics(userId?: string): Promise<IRiskMetrics> {
    const filter: any = { status: PositionStatus.OPEN };
    if (userId) filter.userId = userId;
    
    const positions = await Position.find(filter).lean() as unknown as IPosition[];
    
    let totalExposure = 0;
    let totalMargin = 0;
    let totalUnrealizedPnl = 0;
    let totalRealizedPnl = 0;
    const positionRisks: IPositionRisk[] = [];
    const warnings: string[] = [];
    
    for (const position of positions) {
      const notional = position.quantity * position.markPrice;
      totalExposure += notional;
      totalMargin += position.margin;
      
      const unrealizedPnl = marginCalculationService.calculateUnrealizedPnl(position);
      totalUnrealizedPnl += unrealizedPnl;
      totalRealizedPnl += position.realizedPnl;
      
      // Calculate position risk
      const marginCalc = marginCalculationService.calculatePositionMargin(position);
      const distanceToLiquidation = Math.abs(
        (position.markPrice - position.liquidationPrice) / position.markPrice
      ) * 100;
      
      const positionRisk: IPositionRisk = {
        positionId: position.positionId,
        symbol: position.symbol,
        side: position.side,
        notional,
        leverage: position.leverage,
        marginRatio: marginCalc.marginRatio,
        riskLevel: position.riskLevel,
        liquidationPrice: position.liquidationPrice,
        distanceToLiquidation,
        estimatedLoss: unrealizedPnl < 0 ? Math.abs(unrealizedPnl) : 0,
      };
      
      positionRisks.push(positionRisk);
      
      // Generate warnings
      if (position.leverage > this.HIGH_LEVERAGE_THRESHOLD) {
        warnings.push(`High leverage position: ${position.positionId} (${position.leverage}x)`);
      }
      
      if (notional > this.LARGE_POSITION_THRESHOLD) {
        warnings.push(`Large position: ${position.positionId} ($${notional.toFixed(2)})`);
      }
      
      if (distanceToLiquidation < 5) {
        warnings.push(`Near liquidation: ${position.positionId} (${distanceToLiquidation.toFixed(2)}% away)`);
      }
    }
    
    // Get wallet balance for account equity
    let accountEquity = totalMargin + totalUnrealizedPnl;
    let availableBalance = 0;
    let walletBalance = 0;
    
    if (userId) {
      const wallet = await Wallet.findOne({ userId }).lean();
      const usdtBalance = wallet?.balances.get('USDT');
      walletBalance = usdtBalance ? parseFloat(usdtBalance.total.toString()) : 0;
      accountEquity = walletBalance + totalUnrealizedPnl;
      availableBalance = Math.max(0, walletBalance - totalMargin);
    }
    
    const accountMarginRatio = totalMargin > 0 ? 
      (totalMargin / (accountEquity || 1)) : 0;
    
    const freeMargin = Math.max(0, accountEquity - totalMargin);
    
    // Calculate risk score (0-100)
    const riskScore = this.calculateRiskScore({
      marginRatio: accountMarginRatio,
      leverage: totalExposure / (totalMargin || 1),
      concentration: positionRisks.length > 0 ? 
        Math.max(...positionRisks.map(p => p.notional)) / totalExposure : 0,
      warnings: warnings.length,
    });
    
    return {
      userId,
      totalPositions: positions.length,
      totalExposure,
      totalMargin,
      totalUnrealizedPnl,
      totalRealizedPnl,
      accountEquity,
      accountMarginRatio,
      availableBalance,
      freeMargin,
      positions: positionRisks.sort((a, b) => b.marginRatio - a.marginRatio),
      riskScore,
      warnings,
    };
  }
  
  /**
   * Calculate risk score
   */
  private calculateRiskScore(params: {
    marginRatio: number;
    leverage: number;
    concentration: number;
    warnings: number;
  }): number {
    let score = 0;
    
    // Margin ratio component (0-30)
    score += Math.min(30, params.marginRatio * 100);
    
    // Leverage component (0-30)
    score += Math.min(30, (params.leverage / this.systemRiskParameters.maxLeverage) * 30);
    
    // Concentration component (0-20)
    score += Math.min(20, params.concentration * 20);
    
    // Warnings component (0-20)
    score += Math.min(20, params.warnings * 2);
    
    return Math.min(100, score);
  }
  
  /**
   * Check position risk
   */
  private async checkPositionRisk(position: IPosition): Promise<void> {
    const notional = position.quantity * position.markPrice;
    
    // Check large position
    if (notional > this.LARGE_POSITION_THRESHOLD) {
      this.createAlert('LARGE_POSITION', 'MEDIUM', {
        positionId: position.positionId,
        userId: position.userId,
        symbol: position.symbol,
        notional,
      });
    }
    
    // Check high leverage
    if (position.leverage > this.HIGH_LEVERAGE_THRESHOLD) {
      this.createAlert('HIGH_LEVERAGE', 'MEDIUM', {
        positionId: position.positionId,
        userId: position.userId,
        symbol: position.symbol,
        leverage: position.leverage,
      });
    }
  }
  
  /**
   * Check for large positions
   */
  private async checkLargePositions(): Promise<void> {
    const positions = await Position.find({
      status: PositionStatus.OPEN,
    }).lean() as unknown as IPosition[];
    
    for (const position of positions) {
      const notional = position.quantity * position.markPrice;
      
      if (notional > this.LARGE_POSITION_THRESHOLD) {
        const alertKey = `large_position_${position.positionId}`;
        
        if (!this.activeAlerts.has(alertKey)) {
          this.createAlert('LARGE_POSITION', 'MEDIUM', {
            positionId: position.positionId,
            userId: position.userId,
            symbol: position.symbol,
            notional,
          });
        }
      }
    }
  }
  
  /**
   * Check for high leverage positions
   */
  private async checkHighLeveragePositions(): Promise<void> {
    const positions = await Position.find({
      status: PositionStatus.OPEN,
      leverage: { $gt: this.HIGH_LEVERAGE_THRESHOLD },
    }).lean() as unknown as IPosition[];
    
    for (const position of positions) {
      const alertKey = `high_leverage_${position.positionId}`;
      
      if (!this.activeAlerts.has(alertKey)) {
        this.createAlert('HIGH_LEVERAGE', 'MEDIUM', {
          positionId: position.positionId,
          userId: position.userId,
          symbol: position.symbol,
          leverage: position.leverage,
        });
      }
    }
  }
  
  /**
   * Check for concentrated risk
   */
  private async checkConcentratedRisk(): Promise<void> {
    // Check symbol concentration
    const symbolExposure = new Map<string, number>();
    const userExposure = new Map<string, number>();
    
    const positions = await Position.find({
      status: PositionStatus.OPEN,
    }).lean() as unknown as IPosition[];
    
    for (const position of positions) {
      const notional = position.quantity * position.markPrice;
      
      // Symbol concentration
      const currentSymbolExposure = symbolExposure.get(position.symbol) || 0;
      symbolExposure.set(position.symbol, currentSymbolExposure + notional);
      
      // User concentration
      const currentUserExposure = userExposure.get(position.userId) || 0;
      userExposure.set(position.userId, currentUserExposure + notional);
    }
    
    // Check symbol limits
    for (const [symbol, exposure] of symbolExposure) {
      if (exposure > this.systemRiskParameters.maxPositionSizePerSymbol * 0.8) {
        this.createAlert('UNUSUAL_ACTIVITY', 'HIGH', {
          message: `High concentration in ${symbol}`,
          symbol,
          exposure,
          limit: this.systemRiskParameters.maxPositionSizePerSymbol,
        });
      }
    }
  }
  
  /**
   * Create alert
   */
  private createAlert(
    type: string,
    severity: string,
    data: any
  ): void {
    const alertId = `${type}_${Date.now()}_${uuidv4().substring(0, 8)}`;
    
    const alert: IRiskAlert = {
      alertId,
      type: type as any,
      severity: severity as any,
      userId: data.userId,
      positionId: data.positionId,
      symbol: data.symbol,
      message: data.message || this.generateAlertMessage(type, data),
      metrics: data,
      timestamp: new Date(),
      acknowledged: false,
    };
    
    this.activeAlerts.set(alertId, alert);
    
    // Save to database
    this.saveAlert(alert);
    
    // Emit alert
    this.emit('risk_alert', alert);
    
    logger.warn(`Risk alert created: ${alert.message}`);
  }
  
  /**
   * Generate alert message
   */
  private generateAlertMessage(type: string, data: any): string {
    switch (type) {
      case 'LARGE_POSITION':
        return `Large position detected: $${data.notional?.toFixed(2)} in ${data.symbol}`;
      case 'HIGH_LEVERAGE':
        return `High leverage position: ${data.leverage}x on ${data.symbol}`;
      case 'MARGIN_CALL':
        return `Margin call for position ${data.positionId}`;
      case 'LIQUIDATION_RISK':
        return `Liquidation risk for position ${data.positionId}`;
      case 'UNUSUAL_ACTIVITY':
        return data.message || 'Unusual activity detected';
      default:
        return 'Risk alert triggered';
    }
  }
  
  /**
   * Save alert to database
   */
  private async saveAlert(alert: IRiskAlert): Promise<void> {
    try {
      await RiskAlert.create(alert);
    } catch (error) {
      logger.error('Error saving alert', error);
    }
  }
  
  /**
   * Acknowledge alert
   */
  async acknowledgeAlert(alertId: string): Promise<boolean> {
    const alert = this.activeAlerts.get(alertId);
    if (alert) {
      alert.acknowledged = true;
      
      await RiskAlert.updateOne(
        { alertId },
        { $set: { acknowledged: true } }
      );
      
      return true;
    }
    return false;
  }
  
  /**
   * Clean up old alerts
   */
  private cleanupOldAlerts(): void {
    const cutoffTime = Date.now() - 3600000; // 1 hour
    
    for (const [alertId, alert] of this.activeAlerts) {
      if (alert.timestamp.getTime() < cutoffTime && alert.acknowledged) {
        this.activeAlerts.delete(alertId);
      }
    }
  }
  
  /**
   * Run stress test
   */
  async runStressTest(scenario: IStressTestScenario): Promise<IStressTestResult> {
    logger.info(`Running stress test: ${scenario.name}`);
    
    try {
      const positions = await Position.find({
        status: PositionStatus.OPEN,
      }).lean() as unknown as IPosition[];
      
      let liquidations = 0;
      let totalLoss = 0;
      let survivingPositions = 0;
      const worstPositions: IPositionRisk[] = [];
      
      for (const position of positions) {
        // Apply price changes
        const priceChange = scenario.priceChanges[position.symbol] || 0;
        const stressedPrice = position.markPrice * (1 + priceChange / 100);
        
        // Calculate stressed PnL
        const stressedPnl = marginCalculationService.calculateUnrealizedPnl({
          ...position,
          markPrice: stressedPrice,
        });
        
        // Calculate stressed margin ratio
        const equity = position.margin + stressedPnl;
        const maintenanceMargin = marginCalculationService.calculatePositionMargin(position).maintenanceMargin;
        const stressedMarginRatio = equity > 0 ? maintenanceMargin / equity : 999;
        
        // Check if would be liquidated
        if (stressedMarginRatio >= 0.95) {
          liquidations++;
          totalLoss += Math.abs(stressedPnl);
        } else {
          survivingPositions++;
        }
        
        // Track worst positions
        if (stressedMarginRatio > 0.7) {
          worstPositions.push({
            positionId: position.positionId,
            symbol: position.symbol,
            side: position.side,
            notional: position.quantity * stressedPrice,
            leverage: position.leverage,
            marginRatio: stressedMarginRatio,
            riskLevel: this.getRiskLevel(stressedMarginRatio),
            liquidationPrice: position.liquidationPrice,
            distanceToLiquidation: Math.abs((stressedPrice - position.liquidationPrice) / stressedPrice) * 100,
            estimatedLoss: stressedPnl < 0 ? Math.abs(stressedPnl) : 0,
          });
        }
      }
      
      // Calculate insurance fund impact
      const insuranceFund = liquidationEngineService.getInsuranceFund();
      const insuranceFundImpact = Math.min(totalLoss * 0.1, insuranceFund.balance * 0.5);
      
      // Determine system health
      let systemHealth: 'HEALTHY' | 'STRESSED' | 'CRITICAL';
      const liquidationRate = positions.length > 0 ? liquidations / positions.length : 0;
      
      if (liquidationRate < 0.1) {
        systemHealth = 'HEALTHY';
      } else if (liquidationRate < 0.3) {
        systemHealth = 'STRESSED';
      } else {
        systemHealth = 'CRITICAL';
      }
      
      const averageMarginRatio = worstPositions.length > 0 ?
        worstPositions.reduce((sum, p) => sum + p.marginRatio, 0) / worstPositions.length : 0;
      
      const result: IStressTestResult = {
        scenario,
        liquidations,
        totalLoss,
        insuranceFundImpact,
        survivingPositions,
        averageMarginRatio,
        worstPositions: worstPositions.sort((a, b) => b.marginRatio - a.marginRatio).slice(0, 10),
        systemHealth,
        timestamp: new Date(),
      };
      
      logger.info(`Stress test complete: ${liquidations} liquidations, ${systemHealth} health`);
      
      return result;
      
    } catch (error) {
      logger.error('Error running stress test', error);
      throw error;
    }
  }
  
  /**
   * Get risk level from margin ratio
   */
  private getRiskLevel(marginRatio: number): LiquidationLevel {
    if (marginRatio < 0.5) return LiquidationLevel.SAFE;
    if (marginRatio < 0.7) return LiquidationLevel.WARNING;
    if (marginRatio < 0.85) return LiquidationLevel.DANGER;
    if (marginRatio < 0.95) return LiquidationLevel.CRITICAL;
    return LiquidationLevel.LIQUIDATION;
  }
  
  /**
   * Get active alerts
   */
  getActiveAlerts(): IRiskAlert[] {
    return Array.from(this.activeAlerts.values())
      .filter(alert => !alert.acknowledged)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }
  
  /**
   * Get system risk parameters
   */
  getSystemRiskParameters(): ISystemRiskParameters {
    return { ...this.systemRiskParameters };
  }
  
  /**
   * Update system risk parameters
   */
  updateSystemRiskParameters(params: Partial<ISystemRiskParameters>): void {
    this.systemRiskParameters = {
      ...this.systemRiskParameters,
      ...params,
    };
    
    logger.info('System risk parameters updated');
    this.emit('risk_parameters_updated', this.systemRiskParameters);
  }
  
  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    if (this.alertCheckInterval) {
      clearInterval(this.alertCheckInterval);
      this.alertCheckInterval = null;
    }
    
    logger.info('Risk monitoring stopped');
  }
}

export default RiskMonitoringService.getInstance();