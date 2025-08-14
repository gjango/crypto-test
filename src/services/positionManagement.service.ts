import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';
import {
  IPosition,
  IPositionUpdate,
  IMarginTransfer,
  ILeverageAdjustment,
  PositionSide,
  PositionStatus,
  MarginMode,
  LiquidationLevel,
  IPositionHistory
} from '../types/margin';
import { Position } from '../models/Position.model';
import { Wallet } from '../models/Wallet.model';
import { PositionHistory } from '../models/PositionHistory.model';
import marginCalculationService from './marginCalculation.service';
import { toDecimal128 } from '../utils/database';
import feedManagerService from './feedManager.service';

const logger = createLogger('PositionManagement');

export class PositionManagementService extends EventEmitter {
  private static instance: PositionManagementService;
  private positions: Map<string, IPosition> = new Map(); // positionId -> position
  private userPositions: Map<string, Set<string>> = new Map(); // userId -> Set<positionId>
  private updateInterval: NodeJS.Timeout | null = null;
  private updateFrequency: number = 1000; // 1 second
  
  private constructor() {
    super();
    this.setMaxListeners(1000);
    this.startPositionUpdates();
    this.loadActivePositions();
  }
  
  public static getInstance(): PositionManagementService {
    if (!PositionManagementService.instance) {
      PositionManagementService.instance = new PositionManagementService();
    }
    return PositionManagementService.instance;
  }
  
  /**
   * Load active positions from database
   */
  private async loadActivePositions(): Promise<void> {
    try {
      const positions = await Position.find({ 
        status: { $in: [PositionStatus.OPEN, PositionStatus.CLOSING] } 
      }).lean() as unknown as IPosition[];
      
      for (const position of positions) {
        this.positions.set(position.positionId, position);
        
        if (!this.userPositions.has(position.userId)) {
          this.userPositions.set(position.userId, new Set());
        }
        this.userPositions.get(position.userId)!.add(position.positionId);
      }
      
      logger.info(`Loaded ${positions.length} active positions`);
    } catch (error) {
      logger.error('Error loading positions', error);
    }
  }
  
  /**
   * Open new position
   */
  async openPosition(
    userId: string,
    symbol: string,
    side: PositionSide,
    quantity: number,
    leverage: number,
    marginMode: MarginMode = MarginMode.CROSS,
    entryPrice?: number
  ): Promise<IPosition | null> {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Calculate margin requirements
      const marginCalc = await marginCalculationService.calculateMargin(
        userId,
        symbol,
        quantity,
        leverage,
        side,
        entryPrice
      );
      
      if (marginCalc.availableBalance < marginCalc.initialMargin) {
        await session.abortTransaction();
        throw new Error('Insufficient balance for initial margin');
      }
      
      // Get actual entry price
      const markPrice = entryPrice || this.getMarkPrice(symbol);
      if (!markPrice) {
        await session.abortTransaction();
        throw new Error('Unable to get mark price');
      }
      
      // Create position
      const position: IPosition = {
        positionId: this.generatePositionId(),
        userId,
        symbol,
        side,
        status: PositionStatus.OPEN,
        marginMode,
        quantity,
        entryPrice: markPrice,
        markPrice,
        liquidationPrice: marginCalc.liquidationPrice,
        bankruptcyPrice: marginCalc.bankruptcyPrice,
        leverage,
        margin: marginCalc.initialMargin,
        maintenanceMargin: marginCalc.maintenanceMargin,
        marginRatio: marginCalc.marginRatio,
        isolatedMargin: marginMode === MarginMode.ISOLATED ? marginCalc.initialMargin : undefined,
        autoAddMargin: false,
        unrealizedPnl: 0,
        realizedPnl: 0,
        fee: 0,
        fundingFee: 0,
        riskLevel: this.calculateRiskLevel(marginCalc.marginRatio),
        maxNotional: marginCalc.leverageTier.maxNotional,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      // Deduct margin from wallet
      await this.deductMargin(userId, marginCalc.initialMargin, session);
      
      // Save position to database
      await this.savePosition(position, session);
      
      // Record position history
      await this.recordPositionHistory(position.positionId, 'OPEN', quantity, markPrice, marginCalc.initialMargin, session);
      
      // Update in-memory cache
      this.positions.set(position.positionId, position);
      if (!this.userPositions.has(userId)) {
        this.userPositions.set(userId, new Set());
      }
      this.userPositions.get(userId)!.add(position.positionId);
      
      await session.commitTransaction();
      
      // Emit events
      this.emit('position_opened', position);
      
      logger.info(`Opened position ${position.positionId} for user ${userId}`);
      
      return position;
      
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error opening position', error);
      throw error;
    } finally {
      session.endSession();
    }
  }
  
  /**
   * Close position
   */
  async closePosition(
    positionId: string,
    userId: string,
    closeQuantity?: number,
    closePrice?: number
  ): Promise<{ position: IPosition; realizedPnl: number } | null> {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const position = this.positions.get(positionId);
      if (!position || position.userId !== userId) {
        await session.abortTransaction();
        throw new Error('Position not found');
      }
      
      if (position.status !== PositionStatus.OPEN) {
        await session.abortTransaction();
        throw new Error('Position is not open');
      }
      
      // Get close price
      const markPrice = closePrice || this.getMarkPrice(position.symbol);
      if (!markPrice) {
        await session.abortTransaction();
        throw new Error('Unable to get mark price');
      }
      
      // Determine quantity to close
      const quantityToClose = Math.min(closeQuantity || position.quantity, position.quantity);
      const isPartialClose = quantityToClose < position.quantity;
      
      // Calculate PnL
      const realizedPnl = this.calculateRealizedPnl(position, markPrice, quantityToClose);
      
      // Calculate margin to release
      const marginToRelease = position.margin * (quantityToClose / position.quantity);
      
      if (isPartialClose) {
        // Update position for partial close
        position.quantity -= quantityToClose;
        position.margin -= marginToRelease;
        position.realizedPnl += realizedPnl;
        position.updatedAt = new Date();
        
        // Recalculate margin requirements
        const marginCalc = marginCalculationService.calculatePositionMargin(position);
        position.maintenanceMargin = marginCalc.maintenanceMargin;
        position.marginRatio = marginCalc.marginRatio;
        position.liquidationPrice = marginCalc.liquidationPrice;
        position.riskLevel = this.calculateRiskLevel(marginCalc.marginRatio);
        
      } else {
        // Full close
        position.status = PositionStatus.CLOSED;
        position.quantity = 0;
        position.margin = 0;
        position.realizedPnl += realizedPnl;
        position.closedAt = new Date();
        position.updatedAt = new Date();
        
        // Remove from cache
        this.positions.delete(positionId);
        this.userPositions.get(userId)?.delete(positionId);
      }
      
      // Return margin to wallet
      await this.returnMargin(userId, marginToRelease + realizedPnl, session);
      
      // Update position in database
      await this.updatePosition(position, session);
      
      // Record position history
      await this.recordPositionHistory(
        position.positionId,
        isPartialClose ? 'DECREASE' : 'CLOSE',
        quantityToClose,
        markPrice,
        undefined,
        session,
        realizedPnl
      );
      
      await session.commitTransaction();
      
      // Emit events
      this.emit(isPartialClose ? 'position_reduced' : 'position_closed', {
        position,
        realizedPnl,
        quantityClosed: quantityToClose,
      });
      
      logger.info(`${isPartialClose ? 'Partially closed' : 'Closed'} position ${positionId} with PnL: ${realizedPnl}`);
      
      return { position, realizedPnl };
      
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error closing position', error);
      throw error;
    } finally {
      session.endSession();
    }
  }
  
  /**
   * Add margin to isolated position
   */
  async addMargin(
    positionId: string,
    userId: string,
    amount: number
  ): Promise<IMarginTransfer> {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const position = this.positions.get(positionId);
      if (!position || position.userId !== userId) {
        await session.abortTransaction();
        throw new Error('Position not found');
      }
      
      if (position.marginMode !== MarginMode.ISOLATED) {
        await session.abortTransaction();
        return {
          positionId,
          amount,
          type: 'ADD',
          currentMargin: position.margin,
          newMargin: position.margin,
          currentMarginRatio: position.marginRatio,
          newMarginRatio: position.marginRatio,
          success: false,
          reason: 'Can only add margin to isolated positions',
        };
      }
      
      // Check available balance
      const wallet = await Wallet.findOne({ userId }).session(session).lean();
      const usdtBalance = wallet?.balances.get('USDT');
      const availableBalance = usdtBalance ? parseFloat(usdtBalance.available.toString()) : 0;
      
      if (availableBalance < amount) {
        await session.abortTransaction();
        return {
          positionId,
          amount,
          type: 'ADD',
          currentMargin: position.margin,
          newMargin: position.margin,
          currentMarginRatio: position.marginRatio,
          newMarginRatio: position.marginRatio,
          success: false,
          reason: 'Insufficient balance',
        };
      }
      
      // Update position margin
      const oldMargin = position.margin;
      const oldMarginRatio = position.marginRatio;
      
      position.margin += amount;
      position.isolatedMargin = position.margin;
      
      // Recalculate margin ratio and liquidation price
      const marginCalc = marginCalculationService.calculatePositionMargin(position);
      position.marginRatio = marginCalc.marginRatio;
      position.liquidationPrice = marginCalc.liquidationPrice;
      position.leverage = (position.quantity * position.markPrice) / position.margin;
      position.riskLevel = this.calculateRiskLevel(marginCalc.marginRatio);
      position.updatedAt = new Date();
      
      // Deduct from wallet
      await this.deductMargin(userId, amount, session);
      
      // Update position in database
      await this.updatePosition(position, session);
      
      // Record position history
      await this.recordPositionHistory(position.positionId, 'MARGIN_ADD', 0, 0, amount, session);
      
      await session.commitTransaction();
      
      // Emit event
      this.emit('margin_added', { positionId, amount, position });
      
      logger.info(`Added ${amount} margin to position ${positionId}`);
      
      return {
        positionId,
        amount,
        type: 'ADD',
        currentMargin: oldMargin,
        newMargin: position.margin,
        currentMarginRatio: oldMarginRatio,
        newMarginRatio: position.marginRatio,
        success: true,
      };
      
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error adding margin', error);
      throw error;
    } finally {
      session.endSession();
    }
  }
  
  /**
   * Remove margin from isolated position
   */
  async removeMargin(
    positionId: string,
    userId: string,
    amount: number
  ): Promise<IMarginTransfer> {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const position = this.positions.get(positionId);
      if (!position || position.userId !== userId) {
        await session.abortTransaction();
        throw new Error('Position not found');
      }
      
      if (position.marginMode !== MarginMode.ISOLATED) {
        await session.abortTransaction();
        return {
          positionId,
          amount,
          type: 'REMOVE',
          currentMargin: position.margin,
          newMargin: position.margin,
          currentMarginRatio: position.marginRatio,
          newMarginRatio: position.marginRatio,
          success: false,
          reason: 'Can only remove margin from isolated positions',
        };
      }
      
      // Calculate new margin after removal
      const newMargin = position.margin - amount;
      const minMargin = (position.quantity * position.markPrice) / marginCalculationService.getLeverageTier(position.symbol, position.quantity * position.markPrice).maxLeverage;
      
      if (newMargin < minMargin) {
        await session.abortTransaction();
        return {
          positionId,
          amount,
          type: 'REMOVE',
          currentMargin: position.margin,
          newMargin: position.margin,
          currentMarginRatio: position.marginRatio,
          newMarginRatio: position.marginRatio,
          success: false,
          reason: 'Margin after removal would be below minimum required',
        };
      }
      
      // Update position
      const oldMargin = position.margin;
      const oldMarginRatio = position.marginRatio;
      
      position.margin = newMargin;
      position.isolatedMargin = newMargin;
      position.leverage = (position.quantity * position.markPrice) / newMargin;
      
      // Recalculate margin ratio and liquidation price
      const marginCalc = marginCalculationService.calculatePositionMargin(position);
      position.marginRatio = marginCalc.marginRatio;
      position.liquidationPrice = marginCalc.liquidationPrice;
      position.riskLevel = this.calculateRiskLevel(marginCalc.marginRatio);
      position.updatedAt = new Date();
      
      // Return to wallet
      await this.returnMargin(userId, amount, session);
      
      // Update position in database
      await this.updatePosition(position, session);
      
      // Record position history
      await this.recordPositionHistory(position.positionId, 'MARGIN_REMOVE', 0, 0, -amount, session);
      
      await session.commitTransaction();
      
      // Emit event
      this.emit('margin_removed', { positionId, amount, position });
      
      logger.info(`Removed ${amount} margin from position ${positionId}`);
      
      return {
        positionId,
        amount,
        type: 'REMOVE',
        currentMargin: oldMargin,
        newMargin: position.margin,
        currentMarginRatio: oldMarginRatio,
        newMarginRatio: position.marginRatio,
        success: true,
      };
      
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error removing margin', error);
      throw error;
    } finally {
      session.endSession();
    }
  }
  
  /**
   * Adjust position leverage
   */
  async adjustLeverage(
    positionId: string,
    userId: string,
    newLeverage: number
  ): Promise<ILeverageAdjustment> {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const position = this.positions.get(positionId);
      if (!position || position.userId !== userId) {
        await session.abortTransaction();
        throw new Error('Position not found');
      }
      
      const adjustment = marginCalculationService.calculateLeverageAdjustment(position, newLeverage);
      
      if (!adjustment.feasible) {
        await session.abortTransaction();
        return {
          positionId,
          currentLeverage: position.leverage,
          newLeverage,
          currentMargin: position.margin,
          newMargin: position.margin,
          marginDelta: 0,
          feasible: false,
          reason: 'Leverage exceeds maximum for position size',
        };
      }
      
      // Check if user has sufficient balance for margin increase
      if (adjustment.marginDelta > 0) {
        const wallet = await Wallet.findOne({ userId }).session(session).lean();
        const usdtBalance = wallet?.balances.get('USDT');
      const availableBalance = usdtBalance ? parseFloat(usdtBalance.available.toString()) : 0;
        
        if (availableBalance < adjustment.marginDelta) {
          await session.abortTransaction();
          return {
            positionId,
            currentLeverage: position.leverage,
            newLeverage,
            currentMargin: position.margin,
            newMargin: position.margin,
            marginDelta: 0,
            feasible: false,
            reason: 'Insufficient balance for margin increase',
          };
        }
        
        // Deduct additional margin
        await this.deductMargin(userId, adjustment.marginDelta, session);
      } else if (adjustment.marginDelta < 0) {
        // Return excess margin
        await this.returnMargin(userId, Math.abs(adjustment.marginDelta), session);
      }
      
      // Update position
      const oldLeverage = position.leverage;
      const oldMargin = position.margin;
      
      position.leverage = newLeverage;
      position.margin = adjustment.requiredMargin;
      if (position.marginMode === MarginMode.ISOLATED) {
        position.isolatedMargin = adjustment.requiredMargin;
      }
      
      // Recalculate liquidation price
      const marginCalc = marginCalculationService.calculatePositionMargin(position);
      position.liquidationPrice = marginCalc.liquidationPrice;
      position.marginRatio = marginCalc.marginRatio;
      position.riskLevel = this.calculateRiskLevel(marginCalc.marginRatio);
      position.updatedAt = new Date();
      
      // Update position in database
      await this.updatePosition(position, session);
      
      await session.commitTransaction();
      
      // Emit event
      this.emit('leverage_adjusted', { positionId, oldLeverage, newLeverage, position });
      
      logger.info(`Adjusted leverage for position ${positionId} from ${oldLeverage}x to ${newLeverage}x`);
      
      return {
        positionId,
        currentLeverage: oldLeverage,
        newLeverage,
        currentMargin: oldMargin,
        newMargin: position.margin,
        marginDelta: adjustment.marginDelta,
        feasible: true,
      };
      
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error adjusting leverage', error);
      throw error;
    } finally {
      session.endSession();
    }
  }
  
  /**
   * Switch margin mode
   */
  async switchMarginMode(
    positionId: string,
    userId: string,
    newMode: MarginMode
  ): Promise<boolean> {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const position = this.positions.get(positionId);
      if (!position || position.userId !== userId) {
        await session.abortTransaction();
        throw new Error('Position not found');
      }
      
      // Get account equity
      const wallet = await Wallet.findOne({ userId }).session(session).lean();
      const usdtBalance = wallet?.balances.get('USDT');
      const accountEquity = usdtBalance ? parseFloat(usdtBalance.total.toString()) : 0;
      
      const canSwitch = marginCalculationService.canSwitchMarginMode(position, newMode, accountEquity);
      
      if (!canSwitch.canSwitch) {
        await session.abortTransaction();
        throw new Error(canSwitch.reason);
      }
      
      // Update position
      position.marginMode = newMode;
      
      if (newMode === MarginMode.ISOLATED) {
        position.isolatedMargin = position.margin;
      } else {
        position.isolatedMargin = undefined;
      }
      
      position.updatedAt = new Date();
      
      // Update position in database
      await this.updatePosition(position, session);
      
      await session.commitTransaction();
      
      // Emit event
      this.emit('margin_mode_switched', { positionId, newMode, position });
      
      logger.info(`Switched margin mode for position ${positionId} to ${newMode}`);
      
      return true;
      
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error switching margin mode', error);
      throw error;
    } finally {
      session.endSession();
    }
  }
  
  /**
   * Get user positions
   */
  async getUserPositions(userId: string, status?: PositionStatus): Promise<IPosition[]> {
    const positionIds = this.userPositions.get(userId);
    if (!positionIds) return [];
    
    const positions: IPosition[] = [];
    
    for (const positionId of positionIds) {
      const position = this.positions.get(positionId);
      if (position && (!status || position.status === status)) {
        positions.push(position);
      }
    }
    
    return positions;
  }
  
  /**
   * Get position by ID
   */
  getPosition(positionId: string): IPosition | null {
    return this.positions.get(positionId) || null;
  }
  
  /**
   * Start position updates
   */
  private startPositionUpdates(): void {
    this.updateInterval = setInterval(() => {
      this.updateAllPositions();
    }, this.updateFrequency);
  }
  
  /**
   * Update all positions with latest prices
   */
  private async updateAllPositions(): Promise<void> {
    const updates: IPosition[] = [];
    
    for (const position of this.positions.values()) {
      if (position.status === PositionStatus.OPEN) {
        const markPrice = this.getMarkPrice(position.symbol);
        if (markPrice && markPrice !== position.markPrice) {
          position.markPrice = markPrice;
          
          // Recalculate unrealized PnL and margin ratio
          position.unrealizedPnl = marginCalculationService.calculateUnrealizedPnl(position, markPrice);
          
          const marginCalc = marginCalculationService.calculatePositionMargin(position);
          position.marginRatio = marginCalc.marginRatio;
          position.maintenanceMargin = marginCalc.maintenanceMargin;
          position.riskLevel = this.calculateRiskLevel(marginCalc.marginRatio);
          
          updates.push(position);
        }
      }
    }
    
    if (updates.length > 0) {
      this.emit('positions_updated', updates);
    }
  }
  
  /**
   * Calculate risk level based on margin ratio
   */
  private calculateRiskLevel(marginRatio: number): LiquidationLevel {
    if (marginRatio < 0.5) return LiquidationLevel.SAFE;
    if (marginRatio < 0.7) return LiquidationLevel.WARNING;
    if (marginRatio < 0.85) return LiquidationLevel.DANGER;
    if (marginRatio < 0.95) return LiquidationLevel.CRITICAL;
    return LiquidationLevel.LIQUIDATION;
  }
  
  /**
   * Calculate realized PnL
   */
  private calculateRealizedPnl(position: IPosition, closePrice: number, quantity: number): number {
    if (position.side === PositionSide.LONG) {
      return (closePrice - position.entryPrice) * quantity;
    } else {
      return (position.entryPrice - closePrice) * quantity;
    }
  }
  
  /**
   * Generate position ID
   */
  private generatePositionId(): string {
    return `POS-${Date.now()}-${uuidv4().substring(0, 8).toUpperCase()}`;
  }
  
  /**
   * Get mark price
   */
  private getMarkPrice(symbol: string): number {
    const priceData = feedManagerService.getCurrentPrice(symbol);
    return priceData ? (priceData.bid + priceData.ask) / 2 : 0;
  }
  
  /**
   * Save position to database
   */
  private async savePosition(position: IPosition, session: any): Promise<void> {
    await Position.create([{
      ...position,
      quantity: toDecimal128(position.quantity),
      entryPrice: toDecimal128(position.entryPrice),
      markPrice: toDecimal128(position.markPrice),
      liquidationPrice: toDecimal128(position.liquidationPrice),
      bankruptcyPrice: toDecimal128(position.bankruptcyPrice),
      margin: toDecimal128(position.margin),
      maintenanceMargin: toDecimal128(position.maintenanceMargin),
      marginRatio: toDecimal128(position.marginRatio),
      isolatedMargin: position.isolatedMargin ? toDecimal128(position.isolatedMargin) : undefined,
      unrealizedPnl: toDecimal128(position.unrealizedPnl),
      realizedPnl: toDecimal128(position.realizedPnl),
      fee: toDecimal128(position.fee),
      fundingFee: toDecimal128(position.fundingFee),
      maxNotional: toDecimal128(position.maxNotional),
    }], { session });
  }
  
  /**
   * Update position in database
   */
  private async updatePosition(position: IPosition, session: any): Promise<void> {
    await Position.updateOne(
      { positionId: position.positionId },
      {
        $set: {
          status: position.status,
          quantity: toDecimal128(position.quantity),
          markPrice: toDecimal128(position.markPrice),
          liquidationPrice: toDecimal128(position.liquidationPrice),
          leverage: position.leverage,
          margin: toDecimal128(position.margin),
          maintenanceMargin: toDecimal128(position.maintenanceMargin),
          marginRatio: toDecimal128(position.marginRatio),
          isolatedMargin: position.isolatedMargin ? toDecimal128(position.isolatedMargin) : undefined,
          unrealizedPnl: toDecimal128(position.unrealizedPnl),
          realizedPnl: toDecimal128(position.realizedPnl),
          riskLevel: position.riskLevel,
          updatedAt: position.updatedAt,
          closedAt: position.closedAt,
        },
      }
    ).session(session);
  }
  
  /**
   * Record position history
   */
  private async recordPositionHistory(
    positionId: string,
    action: string,
    quantity: number,
    price: number,
    margin?: number,
    session?: any,
    pnl?: number
  ): Promise<void> {
    await PositionHistory.create([{
      positionId,
      action,
      quantity: toDecimal128(quantity),
      price: toDecimal128(price),
      margin: margin ? toDecimal128(margin) : undefined,
      pnl: pnl ? toDecimal128(pnl) : undefined,
      timestamp: new Date(),
    }], { session });
  }
  
  /**
   * Deduct margin from wallet
   */
  private async deductMargin(userId: string, amount: number, session: any): Promise<void> {
    await Wallet.updateOne(
      { userId, 'balances.asset': 'USDT' },
      {
        $inc: {
          'balances.$.available': -amount,
          'balances.$.locked': amount,
        },
      }
    ).session(session);
  }
  
  /**
   * Return margin to wallet
   */
  private async returnMargin(userId: string, amount: number, session: any): Promise<void> {
    await Wallet.updateOne(
      { userId, 'balances.asset': 'USDT' },
      {
        $inc: {
          'balances.$.available': amount,
          'balances.$.locked': -Math.min(amount, 0), // Only reduce locked if it was locked
        },
      }
    ).session(session);
  }
}

export default PositionManagementService.getInstance();