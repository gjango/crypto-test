import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import mongoose from 'mongoose';
import {
  IPosition,
  ILiquidationEvent,
  ILiquidationQueue,
  IInsuranceFund,
  PositionStatus,
  LiquidationLevel,
  PositionSide
} from '../types/margin';
import { Position } from '../models/Position.model';
import { LiquidationHistory } from '../models/LiquidationHistory.model';
import { InsuranceFund } from '../models/InsuranceFund.model';
import { Order } from '../models/Order.model';
import { Wallet } from '../models/Wallet.model';
import positionManagementService from './positionManagement.service';
import marginCalculationService from './marginCalculation.service';
import orderExecutionService from './orderExecution.service';
import matchingEngineService from './matchingEngine.service';
import { toDecimal128 } from '../utils/database';
import { OrderType, OrderSide, TimeInForce } from '../types/order';

const logger = createLogger('LiquidationEngine');

export class LiquidationEngineService extends EventEmitter {
  private static instance: LiquidationEngineService;
  private liquidationQueue: Map<string, IPosition> = new Map(); // positionId -> position
  private processingLiquidations: Set<string> = new Set(); // positionIds being processed
  private insuranceFund: IInsuranceFund;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private processingInterval: NodeJS.Timeout | null = null;
  private monitoringFrequency: number = 1000; // 1 second
  private processingFrequency: number = 500; // 500ms
  
  // Liquidation parameters
  private readonly liquidationFeeRate = 0.005; // 0.5%
  private readonly partialLiquidationRatios = [0.25, 0.5, 0.75, 1.0]; // 25%, 50%, 75%, 100%
  private readonly marginCallThreshold = 0.7; // 70% margin ratio triggers warning
  private readonly liquidationThreshold = 0.95; // 95% margin ratio triggers liquidation
  private readonly adlThreshold = 0.98; // 98% triggers auto-deleveraging
  
  private constructor() {
    super();
    this.setMaxListeners(1000);
    this.initializeInsuranceFund();
    this.startMonitoring();
    this.startProcessing();
  }
  
  public static getInstance(): LiquidationEngineService {
    if (!LiquidationEngineService.instance) {
      LiquidationEngineService.instance = new LiquidationEngineService();
    }
    return LiquidationEngineService.instance;
  }
  
  /**
   * Initialize insurance fund
   */
  private async initializeInsuranceFund(): Promise<void> {
    try {
      let fund = await InsuranceFund.findOne().lean();
      
      if (!fund) {
        // Create initial insurance fund
        fund = await InsuranceFund.create({
          balance: toDecimal128(100000), // Start with 100k USDT
          targetBalance: toDecimal128(1000000), // Target 1M USDT
          contributions: toDecimal128(0),
          payouts: toDecimal128(0),
          lastUpdate: new Date(),
        });
      }
      
      this.insuranceFund = {
        balance: fund.balance,
        targetBalance: fund.targetBalance,
        utilizationRate: fund.balance / fund.targetBalance,
        contributions: fund.contributions,
        payouts: fund.payouts,
        lastUpdate: fund.lastUpdate,
      };
      
      logger.info(`Insurance fund initialized with balance: ${this.insuranceFund.balance} USDT`);
    } catch (error) {
      logger.error('Error initializing insurance fund', error);
      
      // Use default values if database fails
      this.insuranceFund = {
        balance: 100000,
        targetBalance: 1000000,
        utilizationRate: 0.1,
        contributions: 0,
        payouts: 0,
        lastUpdate: new Date(),
      };
    }
  }
  
  /**
   * Start monitoring positions for liquidation
   */
  private startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      this.monitorPositions();
    }, this.monitoringFrequency);
    
    logger.info('Liquidation monitoring started');
  }
  
  /**
   * Start processing liquidation queue
   */
  private startProcessing(): void {
    this.processingInterval = setInterval(() => {
      this.processLiquidationQueue();
    }, this.processingFrequency);
    
    logger.info('Liquidation processing started');
  }
  
  /**
   * Monitor all positions for liquidation
   */
  private async monitorPositions(): Promise<void> {
    try {
      // Get all open positions
      const positions = await Position.find({ 
        status: PositionStatus.OPEN 
      }).lean() as unknown as IPosition[];
      
      for (const position of positions) {
        // Skip if already in queue or being processed
        if (this.liquidationQueue.has(position.positionId) || 
            this.processingLiquidations.has(position.positionId)) {
          continue;
        }
        
        // Calculate current margin status
        const marginCalc = marginCalculationService.calculatePositionMargin(position);
        
        // Update position risk level
        position.marginRatio = marginCalc.marginRatio;
        position.unrealizedPnl = marginCalc.unrealizedPnl;
        
        // Check liquidation conditions
        if (marginCalc.marginRatio >= this.liquidationThreshold) {
          // Add to liquidation queue
          this.liquidationQueue.set(position.positionId, position);
          
          logger.warn(`Position ${position.positionId} added to liquidation queue. Margin ratio: ${marginCalc.marginRatio}`);
          
          // Emit liquidation warning
          this.emit('liquidation_triggered', {
            positionId: position.positionId,
            userId: position.userId,
            symbol: position.symbol,
            marginRatio: marginCalc.marginRatio,
            unrealizedPnl: marginCalc.unrealizedPnl,
          });
          
        } else if (marginCalc.marginRatio >= this.marginCallThreshold) {
          // Emit margin call warning
          this.emit('margin_call', {
            positionId: position.positionId,
            userId: position.userId,
            symbol: position.symbol,
            marginRatio: marginCalc.marginRatio,
            requiredMargin: marginCalc.maintenanceMargin - position.margin,
          });
        }
        
        // Check for auto-deleveraging conditions
        if (marginCalc.marginRatio >= this.adlThreshold && this.insuranceFund.utilizationRate < 0.2) {
          this.emit('adl_triggered', {
            positionId: position.positionId,
            symbol: position.symbol,
            marginRatio: marginCalc.marginRatio,
          });
        }
      }
    } catch (error) {
      logger.error('Error monitoring positions', error);
    }
  }
  
  /**
   * Process liquidation queue
   */
  private async processLiquidationQueue(): Promise<void> {
    if (this.liquidationQueue.size === 0) return;
    
    // Process up to 10 liquidations at a time
    const toProcess = Array.from(this.liquidationQueue.entries()).slice(0, 10);
    
    for (const [positionId, position] of toProcess) {
      // Remove from queue and add to processing
      this.liquidationQueue.delete(positionId);
      this.processingLiquidations.add(positionId);
      
      // Process liquidation asynchronously
      this.liquidatePosition(position)
        .finally(() => {
          this.processingLiquidations.delete(positionId);
        });
    }
  }
  
  /**
   * Liquidate a position
   */
  async liquidatePosition(position: IPosition): Promise<ILiquidationEvent | null> {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      logger.info(`Starting liquidation for position ${position.positionId}`);
      
      // Get latest position data
      const currentPosition = await Position.findOne({ 
        positionId: position.positionId 
      }).session(session).lean() as unknown as IPosition | null;
      
      if (!currentPosition || currentPosition.status !== PositionStatus.OPEN) {
        await session.abortTransaction();
        return null;
      }
      
      // Update status to liquidating
      await Position.updateOne(
        { positionId: position.positionId },
        { 
          $set: { 
            status: PositionStatus.LIQUIDATING,
            updatedAt: new Date()
          } 
        }
      ).session(session);
      
      // Calculate current margin status
      const marginCalc = marginCalculationService.calculatePositionMargin(currentPosition);
      
      // Determine liquidation level
      const liquidationLevel = this.determineLiquidationLevel(marginCalc.marginRatio);
      
      // Execute liquidation based on level
      let liquidationResult: ILiquidationEvent | null = null;
      
      switch (liquidationLevel) {
        case 1: // Cancel all open orders
          await this.cancelUserOrders(currentPosition.userId, currentPosition.symbol, session);
          break;
          
        case 2: // Partial liquidation 25%
          liquidationResult = await this.executePartialLiquidation(currentPosition, 0.25, session);
          break;
          
        case 3: // Partial liquidation 50%
          liquidationResult = await this.executePartialLiquidation(currentPosition, 0.5, session);
          break;
          
        case 4: // Full liquidation
          liquidationResult = await this.executeFullLiquidation(currentPosition, session);
          break;
          
        default:
          logger.warn(`Unknown liquidation level: ${liquidationLevel}`);
      }
      
      await session.commitTransaction();
      
      if (liquidationResult) {
        // Record liquidation history
        await this.recordLiquidation(liquidationResult);
        
        // Emit liquidation event
        this.emit('position_liquidated', liquidationResult);
        
        logger.info(`Liquidation completed for position ${position.positionId}. Loss: ${liquidationResult.loss}`);
      }
      
      return liquidationResult;
      
    } catch (error) {
      await session.abortTransaction();
      logger.error(`Error liquidating position ${position.positionId}`, error);
      
      // Return position to queue for retry
      this.liquidationQueue.set(position.positionId, position);
      
      return null;
    } finally {
      session.endSession();
    }
  }
  
  /**
   * Execute partial liquidation
   */
  private async executePartialLiquidation(
    position: IPosition,
    ratio: number,
    session: any
  ): Promise<ILiquidationEvent> {
    const liquidationQuantity = position.quantity * ratio;
    const markPrice = marginCalculationService['getMarkPrice'](position.symbol);
    
    // Create liquidation order
    const liquidationOrder = {
      userId: 'LIQUIDATION_ENGINE',
      orderId: `LIQ-${position.positionId}-${Date.now()}`,
      symbol: position.symbol,
      type: OrderType.MARKET,
      side: position.side === PositionSide.LONG ? OrderSide.SELL : OrderSide.BUY,
      quantity: liquidationQuantity,
      status: 'PENDING',
      filledQuantity: 0,
      remainingQuantity: liquidationQuantity,
      averagePrice: 0,
      fills: [],
      totalFee: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    // Execute liquidation order
    const matchResult = await matchingEngineService.submitOrder(liquidationOrder);
    
    let executionPrice = markPrice;
    let executedQuantity = liquidationQuantity;
    
    if (matchResult && matchResult.totalExecutedQuantity > 0) {
      executionPrice = matchResult.averageExecutionPrice;
      executedQuantity = matchResult.totalExecutedQuantity;
    }
    
    // Calculate liquidation loss
    const loss = this.calculateLiquidationLoss(position, executionPrice, executedQuantity);
    const liquidationFee = executedQuantity * executionPrice * this.liquidationFeeRate;
    
    // Update position
    position.quantity -= executedQuantity;
    position.margin -= position.margin * ratio;
    position.realizedPnl -= loss;
    position.fee += liquidationFee;
    
    if (position.quantity <= 0) {
      position.status = PositionStatus.LIQUIDATED;
      position.liquidatedAt = new Date();
    } else {
      position.status = PositionStatus.OPEN;
    }
    
    position.updatedAt = new Date();
    
    await Position.updateOne(
      { positionId: position.positionId },
      {
        $set: {
          quantity: toDecimal128(position.quantity),
          margin: toDecimal128(position.margin),
          realizedPnl: toDecimal128(position.realizedPnl),
          fee: toDecimal128(position.fee),
          status: position.status,
          updatedAt: position.updatedAt,
          liquidatedAt: position.liquidatedAt,
        },
      }
    ).session(session);
    
    // Handle insurance fund contribution
    const insuranceContribution = await this.handleInsuranceFund(loss, liquidationFee, session);
    
    return {
      positionId: position.positionId,
      userId: position.userId,
      symbol: position.symbol,
      side: position.side,
      quantity: executedQuantity,
      liquidationPrice: executionPrice,
      markPrice,
      loss,
      fee: liquidationFee,
      insuranceFundContribution: insuranceContribution,
      timestamp: new Date(),
      level: LiquidationLevel.DANGER,
      isPartial: position.quantity > 0,
    };
  }
  
  /**
   * Execute full liquidation
   */
  private async executeFullLiquidation(
    position: IPosition,
    session: any
  ): Promise<ILiquidationEvent> {
    return this.executePartialLiquidation(position, 1.0, session);
  }
  
  /**
   * Determine liquidation level based on margin ratio
   */
  private determineLiquidationLevel(marginRatio: number): number {
    if (marginRatio < 0.8) return 1; // Cancel orders only
    if (marginRatio < 0.85) return 2; // 25% liquidation
    if (marginRatio < 0.9) return 3; // 50% liquidation
    return 4; // Full liquidation
  }
  
  /**
   * Calculate liquidation loss
   */
  private calculateLiquidationLoss(
    position: IPosition,
    executionPrice: number,
    quantity: number
  ): number {
    if (position.side === PositionSide.LONG) {
      return (position.entryPrice - executionPrice) * quantity;
    } else {
      return (executionPrice - position.entryPrice) * quantity;
    }
  }
  
  /**
   * Cancel user orders for symbol
   */
  private async cancelUserOrders(
    userId: string,
    symbol: string,
    session: any
  ): Promise<void> {
    try {
      const orders = await Order.find({
        userId,
        symbol,
        status: { $in: ['OPEN', 'PARTIALLY_FILLED'] },
      }).session(session).lean();
      
      for (const order of orders) {
        await matchingEngineService.cancelOrder(order.orderId, userId, 'Liquidation - cancel orders');
      }
      
      logger.info(`Cancelled ${orders.length} orders for user ${userId} on ${symbol}`);
    } catch (error) {
      logger.error('Error cancelling orders during liquidation', error);
    }
  }
  
  /**
   * Handle insurance fund contribution/payout
   */
  private async handleInsuranceFund(
    loss: number,
    liquidationFee: number,
    session: any
  ): Promise<number> {
    let contribution = 0;
    
    if (loss > 0) {
      // Position was profitable at liquidation, contribute to insurance fund
      contribution = liquidationFee;
      this.insuranceFund.balance += contribution;
      this.insuranceFund.contributions += contribution;
    } else {
      // Position had a loss, may need insurance fund payout
      const uncoveredLoss = Math.abs(loss) - liquidationFee;
      
      if (uncoveredLoss > 0 && this.insuranceFund.balance >= uncoveredLoss) {
        // Pay from insurance fund
        this.insuranceFund.balance -= uncoveredLoss;
        this.insuranceFund.payouts += uncoveredLoss;
        contribution = -uncoveredLoss;
      }
    }
    
    // Update insurance fund in database
    await InsuranceFund.updateOne(
      {},
      {
        $set: {
          balance: toDecimal128(this.insuranceFund.balance),
          contributions: toDecimal128(this.insuranceFund.contributions),
          payouts: toDecimal128(this.insuranceFund.payouts),
          lastUpdate: new Date(),
        },
      }
    ).session(session);
    
    this.insuranceFund.utilizationRate = this.insuranceFund.balance / this.insuranceFund.targetBalance;
    
    return contribution;
  }
  
  /**
   * Record liquidation in history
   */
  private async recordLiquidation(event: ILiquidationEvent): Promise<void> {
    try {
      await LiquidationHistory.create({
        ...event,
        quantity: toDecimal128(event.quantity),
        liquidationPrice: toDecimal128(event.liquidationPrice),
        markPrice: toDecimal128(event.markPrice),
        loss: toDecimal128(event.loss),
        fee: toDecimal128(event.fee),
        insuranceFundContribution: toDecimal128(event.insuranceFundContribution),
      });
    } catch (error) {
      logger.error('Error recording liquidation history', error);
    }
  }
  
  /**
   * Force liquidate position (admin)
   */
  async forceLiquidate(positionId: string): Promise<ILiquidationEvent | null> {
    try {
      const position = await Position.findOne({ positionId }).lean() as unknown as IPosition | null;
      
      if (!position || position.status !== PositionStatus.OPEN) {
        throw new Error('Position not found or not open');
      }
      
      // Add to high priority queue
      this.liquidationQueue.set(positionId, position);
      
      logger.warn(`Admin force liquidation triggered for position ${positionId}`);
      
      // Process immediately
      return await this.liquidatePosition(position);
      
    } catch (error) {
      logger.error(`Error force liquidating position ${positionId}`, error);
      throw error;
    }
  }
  
  /**
   * Get liquidation queue status
   */
  getLiquidationQueue(): ILiquidationQueue {
    const positions = Array.from(this.liquidationQueue.values());
    const totalValue = positions.reduce((sum, p) => sum + (p.quantity * p.markPrice), 0);
    
    return {
      positions,
      totalValue,
      estimatedTime: positions.length * 2, // Estimate 2 seconds per liquidation
      processing: this.processingLiquidations.size > 0,
    };
  }
  
  /**
   * Get insurance fund status
   */
  getInsuranceFund(): IInsuranceFund {
    return { ...this.insuranceFund };
  }
  
  /**
   * Add to insurance fund (admin)
   */
  async addToInsuranceFund(amount: number): Promise<void> {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      this.insuranceFund.balance += amount;
      this.insuranceFund.contributions += amount;
      this.insuranceFund.utilizationRate = this.insuranceFund.balance / this.insuranceFund.targetBalance;
      
      await InsuranceFund.updateOne(
        {},
        {
          $inc: {
            balance: toDecimal128(amount),
            contributions: toDecimal128(amount),
          },
          $set: {
            lastUpdate: new Date(),
          },
        }
      ).session(session);
      
      await session.commitTransaction();
      
      logger.info(`Added ${amount} USDT to insurance fund. New balance: ${this.insuranceFund.balance}`);
      
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error adding to insurance fund', error);
      throw error;
    } finally {
      session.endSession();
    }
  }
  
  /**
   * Stop liquidation engine
   */
  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    
    logger.info('Liquidation engine stopped');
  }
}

export default LiquidationEngineService.getInstance();