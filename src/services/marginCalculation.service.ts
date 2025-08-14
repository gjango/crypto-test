import { createLogger } from '../utils/logger';
import {
  IPosition,
  IMarginCalculation,
  ILeverageTier,
  PositionSide,
  MarginMode,
  MarkPriceType
} from '../types/margin';
import { Wallet } from '../models/Wallet.model';
import { Market } from '../models/Market.model';
import feedManagerService from './feedManager.service';

const logger = createLogger('MarginCalculation');

export class MarginCalculationService {
  private static instance: MarginCalculationService;
  private leverageTiers: Map<string, ILeverageTier[]> = new Map();
  private defaultLiquidationFee: number = 0.005; // 0.5%
  private defaultMaintenanceMarginRate: number = 0.005; // 0.5%
  
  // Default leverage tiers (USDT notional)
  private defaultTiers: ILeverageTier[] = [
    { tier: 1, minNotional: 0, maxNotional: 10000, maxLeverage: 125, maintenanceMarginRate: 0.004, maintenanceAmount: 0 },
    { tier: 2, minNotional: 10000, maxNotional: 50000, maxLeverage: 100, maintenanceMarginRate: 0.005, maintenanceAmount: 10 },
    { tier: 3, minNotional: 50000, maxNotional: 250000, maxLeverage: 50, maintenanceMarginRate: 0.01, maintenanceAmount: 260 },
    { tier: 4, minNotional: 250000, maxNotional: 1000000, maxLeverage: 20, maintenanceMarginRate: 0.025, maintenanceAmount: 4010 },
    { tier: 5, minNotional: 1000000, maxNotional: 5000000, maxLeverage: 10, maintenanceMarginRate: 0.05, maintenanceAmount: 29010 },
    { tier: 6, minNotional: 5000000, maxNotional: 10000000, maxLeverage: 5, maintenanceMarginRate: 0.1, maintenanceAmount: 279010 },
    { tier: 7, minNotional: 10000000, maxNotional: 20000000, maxLeverage: 4, maintenanceMarginRate: 0.125, maintenanceAmount: 529010 },
    { tier: 8, minNotional: 20000000, maxNotional: 50000000, maxLeverage: 3, maintenanceMarginRate: 0.15, maintenanceAmount: 1029010 },
    { tier: 9, minNotional: 50000000, maxNotional: 100000000, maxLeverage: 2, maintenanceMarginRate: 0.25, maintenanceAmount: 6029010 },
    { tier: 10, minNotional: 100000000, maxNotional: Infinity, maxLeverage: 1, maintenanceMarginRate: 0.5, maintenanceAmount: 31029010 },
  ];
  
  private constructor() {
    this.initializeLeverageTiers();
  }
  
  public static getInstance(): MarginCalculationService {
    if (!MarginCalculationService.instance) {
      MarginCalculationService.instance = new MarginCalculationService();
    }
    return MarginCalculationService.instance;
  }
  
  /**
   * Initialize leverage tiers for all symbols
   */
  private async initializeLeverageTiers(): Promise<void> {
    try {
      const markets = await Market.find({ status: 'active' }).lean();
      
      for (const market of markets) {
        // Use custom tiers if defined, otherwise use defaults
        const tiers = market.leverageTiers || this.defaultTiers;
        this.leverageTiers.set(market.symbol, tiers);
      }
      
      logger.info(`Initialized leverage tiers for ${markets.length} markets`);
    } catch (error) {
      logger.error('Error initializing leverage tiers', error);
    }
  }
  
  /**
   * Calculate margin requirements for a position
   */
  async calculateMargin(
    userId: string,
    symbol: string,
    quantity: number,
    leverage: number,
    side: PositionSide,
    entryPrice?: number
  ): Promise<IMarginCalculation> {
    // Get current mark price
    const markPrice = entryPrice || this.getMarkPrice(symbol);
    if (!markPrice) {
      throw new Error('Unable to get mark price');
    }
    
    // Calculate notional value
    const notional = quantity * markPrice;
    
    // Get leverage tier
    const leverageTier = this.getLeverageTier(symbol, notional);
    
    // Validate leverage
    if (leverage > leverageTier.maxLeverage) {
      throw new Error(`Leverage ${leverage}x exceeds maximum ${leverageTier.maxLeverage}x for this position size`);
    }
    
    // Calculate initial margin
    const initialMargin = notional / leverage;
    
    // Calculate maintenance margin
    const maintenanceMargin = this.calculateMaintenanceMargin(notional, leverageTier);
    
    // Get user wallet balance
    const wallet = await Wallet.findOne({ userId }).lean();
    const walletBalance = wallet?.balances.find(b => b.asset === 'USDT')?.total || 0;
    
    // Calculate unrealized PnL (0 for new positions)
    const unrealizedPnl = 0;
    
    // Calculate equity and available balance
    const equity = walletBalance + unrealizedPnl;
    const marginBalance = walletBalance;
    const availableBalance = Math.max(0, equity - initialMargin);
    const freeMargin = Math.max(0, equity - maintenanceMargin);
    
    // Calculate margin ratio
    const marginRatio = equity > 0 ? maintenanceMargin / equity : 999;
    
    // Calculate liquidation price
    const liquidationPrice = this.calculateLiquidationPrice(
      markPrice,
      leverage,
      side,
      leverageTier.maintenanceMarginRate
    );
    
    // Calculate bankruptcy price
    const bankruptcyPrice = this.calculateBankruptcyPrice(
      markPrice,
      leverage,
      side
    );
    
    return {
      initialMargin,
      maintenanceMargin,
      marginRatio,
      availableBalance,
      freeMargin,
      equity,
      unrealizedPnl,
      marginBalance,
      liquidationPrice,
      bankruptcyPrice,
      leverageTier,
    };
  }
  
  /**
   * Calculate margin for existing position
   */
  calculatePositionMargin(position: IPosition): IMarginCalculation {
    // Get current mark price
    const markPrice = this.getMarkPrice(position.symbol);
    if (!markPrice) {
      throw new Error('Unable to get mark price');
    }
    
    // Update position mark price
    position.markPrice = markPrice;
    
    // Calculate notional value
    const notional = position.quantity * markPrice;
    
    // Get leverage tier
    const leverageTier = this.getLeverageTier(position.symbol, notional);
    
    // Calculate maintenance margin
    const maintenanceMargin = this.calculateMaintenanceMargin(notional, leverageTier);
    
    // Calculate unrealized PnL
    const unrealizedPnl = this.calculateUnrealizedPnl(position, markPrice);
    
    // Calculate equity (position margin + unrealized PnL)
    const equity = position.margin + unrealizedPnl;
    
    // Calculate margin ratio
    const marginRatio = equity > 0 ? maintenanceMargin / equity : 999;
    
    // Recalculate liquidation price
    const liquidationPrice = this.calculateLiquidationPrice(
      position.entryPrice,
      position.leverage,
      position.side,
      leverageTier.maintenanceMarginRate
    );
    
    // Calculate bankruptcy price
    const bankruptcyPrice = this.calculateBankruptcyPrice(
      position.entryPrice,
      position.leverage,
      position.side
    );
    
    return {
      initialMargin: position.margin,
      maintenanceMargin,
      marginRatio,
      availableBalance: 0, // Calculated at account level
      freeMargin: Math.max(0, equity - maintenanceMargin),
      equity,
      unrealizedPnl,
      marginBalance: position.margin,
      liquidationPrice,
      bankruptcyPrice,
      leverageTier,
    };
  }
  
  /**
   * Calculate unrealized PnL
   */
  calculateUnrealizedPnl(position: IPosition, markPrice?: number): number {
    const currentPrice = markPrice || position.markPrice;
    
    if (position.side === PositionSide.LONG) {
      return (currentPrice - position.entryPrice) * position.quantity;
    } else {
      return (position.entryPrice - currentPrice) * position.quantity;
    }
  }
  
  /**
   * Calculate ROE (Return on Equity)
   */
  calculateROE(position: IPosition, unrealizedPnl?: number): number {
    const pnl = unrealizedPnl !== undefined ? unrealizedPnl : this.calculateUnrealizedPnl(position);
    return (pnl / position.margin) * 100;
  }
  
  /**
   * Calculate maintenance margin with tiers
   */
  private calculateMaintenanceMargin(notional: number, tier: ILeverageTier): number {
    return notional * tier.maintenanceMarginRate + tier.maintenanceAmount;
  }
  
  /**
   * Calculate liquidation price
   */
  calculateLiquidationPrice(
    entryPrice: number,
    leverage: number,
    side: PositionSide,
    maintenanceMarginRate: number
  ): number {
    const liquidationFee = this.defaultLiquidationFee;
    
    if (side === PositionSide.LONG) {
      // Long: Entry * (1 - 1/Leverage + Maintenance + Fee)
      return entryPrice * (1 - 1/leverage + maintenanceMarginRate + liquidationFee);
    } else {
      // Short: Entry * (1 + 1/Leverage - Maintenance - Fee)
      return entryPrice * (1 + 1/leverage - maintenanceMarginRate - liquidationFee);
    }
  }
  
  /**
   * Calculate bankruptcy price (where equity becomes 0)
   */
  calculateBankruptcyPrice(
    entryPrice: number,
    leverage: number,
    side: PositionSide
  ): number {
    if (side === PositionSide.LONG) {
      // Long: Entry * (1 - 1/Leverage)
      return entryPrice * (1 - 1/leverage);
    } else {
      // Short: Entry * (1 + 1/Leverage)
      return entryPrice * (1 + 1/leverage);
    }
  }
  
  /**
   * Get leverage tier for notional value
   */
  getLeverageTier(symbol: string, notional: number): ILeverageTier {
    const tiers = this.leverageTiers.get(symbol) || this.defaultTiers;
    
    for (const tier of tiers) {
      if (notional >= tier.minNotional && notional < tier.maxNotional) {
        return tier;
      }
    }
    
    // Return highest tier if notional exceeds all tiers
    return tiers[tiers.length - 1];
  }
  
  /**
   * Get maximum leverage for position size
   */
  getMaxLeverage(symbol: string, notional: number): number {
    const tier = this.getLeverageTier(symbol, notional);
    return tier.maxLeverage;
  }
  
  /**
   * Calculate required margin for leverage adjustment
   */
  calculateLeverageAdjustment(
    position: IPosition,
    newLeverage: number
  ): { requiredMargin: number; marginDelta: number; feasible: boolean } {
    const notional = position.quantity * position.markPrice;
    const tier = this.getLeverageTier(position.symbol, notional);
    
    // Check if new leverage is valid
    if (newLeverage > tier.maxLeverage) {
      return {
        requiredMargin: 0,
        marginDelta: 0,
        feasible: false,
      };
    }
    
    // Calculate new required margin
    const requiredMargin = notional / newLeverage;
    const marginDelta = requiredMargin - position.margin;
    
    return {
      requiredMargin,
      marginDelta,
      feasible: true,
    };
  }
  
  /**
   * Calculate margin for position increase/decrease
   */
  calculatePositionChange(
    position: IPosition,
    deltaQuantity: number,
    price: number
  ): {
    newQuantity: number;
    newEntryPrice: number;
    requiredMargin: number;
    releasedMargin: number;
  } {
    const isIncrease = deltaQuantity > 0;
    const newQuantity = position.quantity + deltaQuantity;
    
    if (newQuantity <= 0) {
      // Position would be closed
      return {
        newQuantity: 0,
        newEntryPrice: 0,
        requiredMargin: 0,
        releasedMargin: position.margin,
      };
    }
    
    let newEntryPrice: number;
    let marginChange: number;
    
    if (isIncrease) {
      // Calculate new average entry price
      newEntryPrice = (position.quantity * position.entryPrice + Math.abs(deltaQuantity) * price) / newQuantity;
      
      // Calculate additional margin required
      const deltaNotional = Math.abs(deltaQuantity) * price;
      marginChange = deltaNotional / position.leverage;
      
      return {
        newQuantity,
        newEntryPrice,
        requiredMargin: marginChange,
        releasedMargin: 0,
      };
    } else {
      // Position decrease - entry price remains the same
      newEntryPrice = position.entryPrice;
      
      // Calculate margin to release
      const releasedRatio = Math.abs(deltaQuantity) / position.quantity;
      marginChange = position.margin * releasedRatio;
      
      return {
        newQuantity,
        newEntryPrice,
        requiredMargin: 0,
        releasedMargin: marginChange,
      };
    }
  }
  
  /**
   * Calculate cross margin requirements
   */
  async calculateCrossMargin(userId: string, positions: IPosition[]): Promise<{
    totalMargin: number;
    totalMaintenanceMargin: number;
    totalUnrealizedPnl: number;
    accountEquity: number;
    marginRatio: number;
    availableBalance: number;
  }> {
    // Get wallet balance
    const wallet = await Wallet.findOne({ userId }).lean();
    const walletBalance = wallet?.balances.find(b => b.asset === 'USDT')?.total || 0;
    
    let totalMargin = 0;
    let totalMaintenanceMargin = 0;
    let totalUnrealizedPnl = 0;
    
    for (const position of positions) {
      if (position.marginMode === MarginMode.CROSS) {
        const markPrice = this.getMarkPrice(position.symbol);
        const notional = position.quantity * markPrice;
        const tier = this.getLeverageTier(position.symbol, notional);
        
        totalMargin += position.margin;
        totalMaintenanceMargin += this.calculateMaintenanceMargin(notional, tier);
        totalUnrealizedPnl += this.calculateUnrealizedPnl(position, markPrice);
      }
    }
    
    const accountEquity = walletBalance + totalUnrealizedPnl;
    const marginRatio = accountEquity > 0 ? totalMaintenanceMargin / accountEquity : 999;
    const availableBalance = Math.max(0, accountEquity - totalMargin);
    
    return {
      totalMargin,
      totalMaintenanceMargin,
      totalUnrealizedPnl,
      accountEquity,
      marginRatio,
      availableBalance,
    };
  }
  
  /**
   * Check if position can switch margin mode
   */
  canSwitchMarginMode(
    position: IPosition,
    newMode: MarginMode,
    accountEquity: number
  ): { canSwitch: boolean; reason?: string } {
    if (position.marginMode === newMode) {
      return { canSwitch: false, reason: 'Already in this margin mode' };
    }
    
    if (newMode === MarginMode.ISOLATED) {
      // Switching to isolated - need to allocate specific margin
      const notional = position.quantity * position.markPrice;
      const requiredMargin = notional / position.leverage;
      
      if (accountEquity < requiredMargin) {
        return { canSwitch: false, reason: 'Insufficient balance for isolated margin' };
      }
    }
    
    // Check if there are pending orders
    // In production, would check for pending orders on this position
    
    return { canSwitch: true };
  }
  
  /**
   * Get mark price for symbol
   */
  private getMarkPrice(symbol: string, type: MarkPriceType = MarkPriceType.MID): number {
    const priceData = feedManagerService.getCurrentPrice(symbol);
    if (!priceData) return 0;
    
    switch (type) {
      case MarkPriceType.LAST:
        return priceData.price;
      case MarkPriceType.MID:
        return (priceData.bid + priceData.ask) / 2;
      case MarkPriceType.INDEX:
        // In production, would use index price from multiple exchanges
        return priceData.price;
      default:
        return priceData.price;
    }
  }
  
  /**
   * Update leverage tiers for a symbol
   */
  updateLeverageTiers(symbol: string, tiers: ILeverageTier[]): void {
    this.leverageTiers.set(symbol, tiers);
    logger.info(`Updated leverage tiers for ${symbol}`);
  }
  
  /**
   * Get all leverage tiers
   */
  getAllLeverageTiers(): Map<string, ILeverageTier[]> {
    return this.leverageTiers;
  }
  
  /**
   * Set leverage tiers for symbol (alias for updateLeverageTiers)
   */
  setLeverageTiers(symbol: string, tiers: ILeverageTier[]): void {
    this.updateLeverageTiers(symbol, tiers);
  }
}

export default MarginCalculationService.getInstance();