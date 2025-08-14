import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import { 
  IMarketConfig,
  IAdminAuditLog,
  AdminAction
} from '../types/admin';
import { MarketStatus } from '../types/enums';
import { Market } from '../models/Market.model';
import { AdminAuditLog } from '../models/AdminAuditLog.model';
import { toDecimal128 } from '../utils/database';
import feedManagerService from './feedManager.service';
import matchingEngineService from './matchingEngine.service';
import marginCalculationService from './marginCalculation.service';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';

const logger = createLogger('MarketManagement');

export class MarketManagementService extends EventEmitter {
  private static instance: MarketManagementService;
  private markets: Map<string, IMarketConfig> = new Map();
  private marketStatus: Map<string, 'active' | 'suspended' | 'maintenance' | 'delisted'> = new Map();
  private tradingHalts: Map<string, { reason: string; until?: Date }> = new Map();
  
  private constructor() {
    super();
    this.setMaxListeners(1000);
    this.loadMarkets();
  }
  
  public static getInstance(): MarketManagementService {
    if (!MarketManagementService.instance) {
      MarketManagementService.instance = new MarketManagementService();
    }
    return MarketManagementService.instance;
  }
  
  /**
   * Load markets from database
   */
  private async loadMarkets(): Promise<void> {
    try {
      const markets = await Market.find({}).lean();
      
      for (const market of markets) {
        const config: IMarketConfig = {
          symbol: market.symbol,
          baseAsset: market.baseAsset,
          quoteAsset: market.quoteAsset,
          status: market.status === MarketStatus.ACTIVE ? 'active' : 
                  market.status === MarketStatus.SUSPENDED ? 'suspended' : 
                  market.status === MarketStatus.DELISTED ? 'delisted' : 'suspended',
          tickSize: parseFloat(market.tickSize.toString()),
          stepSize: parseFloat(market.stepSize.toString()),
          minNotional: parseFloat(market.minNotional.toString()),
          maxNotional: 10000000, // Default as Market model doesn't have maxNotional
          fees: {
            maker: parseFloat(market.fees.maker.toString()),
            taker: parseFloat(market.fees.taker.toString()),
          },
          allowedOrderTypes: ['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT', 'TRAILING_STOP'],
          timeInForceOptions: ['GTC', 'IOC', 'FOK', 'POST_ONLY'],
          marginTradingEnabled: market.marginTradingEnabled || true,
          maxLeverage: market.maxLeverage || 125,
          spread: {
            min: 0.0001,
            max: 0.01,
            default: 0.001,
          },
          slippage: {
            min: 0.0001,
            max: 0.05,
            default: 0.001,
          },
        };
        
        this.markets.set(market.symbol, config);
        this.marketStatus.set(market.symbol, config.status);
      }
      
      logger.info(`Loaded ${markets.length} markets`);
    } catch (error) {
      logger.error('Error loading markets', error);
    }
  }
  
  /**
   * Create new market
   */
  async createMarket(
    config: IMarketConfig,
    adminId: string,
    adminEmail: string,
    reason?: string
  ): Promise<IMarketConfig> {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Check if market already exists
      if (this.markets.has(config.symbol)) {
        throw new Error(`Market ${config.symbol} already exists`);
      }
      
      // Create market in database
      await Market.create([{
        symbol: config.symbol,
        baseAsset: config.baseAsset,
        quoteAsset: config.quoteAsset,
        status: config.status === 'active' ? MarketStatus.ACTIVE : MarketStatus.SUSPENDED,
        tickSize: toDecimal128(config.tickSize),
        stepSize: toDecimal128(config.stepSize),
        minNotional: toDecimal128(config.minNotional),
        fees: {
          maker: toDecimal128(config.fees.maker),
          taker: toDecimal128(config.fees.taker),
        },
        marginTradingEnabled: config.marginTradingEnabled,
        maxLeverage: config.maxLeverage,
      }], { session });
      
      // Add to cache
      this.markets.set(config.symbol, config);
      this.marketStatus.set(config.symbol, config.status);
      
      // Initialize market in other services
      await this.initializeMarketInServices(config);
      
      // Log audit
      await this.logAudit({
        action: AdminAction.CREATE_MARKET,
        adminId,
        adminEmail,
        targetType: 'MARKET',
        targetId: config.symbol,
        after: config,
        reason,
      }, session);
      
      await session.commitTransaction();
      
      // Emit event
      this.emit('market_created', config);
      
      logger.info(`Market ${config.symbol} created by ${adminEmail}`);
      
      return config;
      
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error creating market', error);
      throw error;
    } finally {
      session.endSession();
    }
  }
  
  /**
   * Update market configuration
   */
  async updateMarket(
    symbol: string,
    updates: Partial<IMarketConfig>,
    adminId: string,
    adminEmail: string,
    reason?: string
  ): Promise<IMarketConfig> {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const currentConfig = this.markets.get(symbol);
      if (!currentConfig) {
        throw new Error(`Market ${symbol} not found`);
      }
      
      const before = { ...currentConfig };
      const updatedConfig = { ...currentConfig, ...updates };
      
      // Update database
      const updateData: any = {};
      if (updates.status !== undefined) {
        updateData.status = updates.status === 'active' ? MarketStatus.ACTIVE : 
                           updates.status === 'delisted' ? MarketStatus.DELISTED : 
                           MarketStatus.SUSPENDED;
      }
      if (updates.tickSize !== undefined) {
        updateData.tickSize = toDecimal128(updates.tickSize);
      }
      if (updates.stepSize !== undefined) {
        updateData.stepSize = toDecimal128(updates.stepSize);
      }
      if (updates.minNotional !== undefined) {
        updateData.minNotional = toDecimal128(updates.minNotional);
      }
      // Note: maxNotional doesn't exist in Market model
      if (updates.fees) {
        updateData.fees = {};
        if (updates.fees.maker !== undefined) {
          updateData['fees.maker'] = toDecimal128(updates.fees.maker);
        }
        if (updates.fees.taker !== undefined) {
          updateData['fees.taker'] = toDecimal128(updates.fees.taker);
        }
      }
      if (updates.maxLeverage !== undefined) {
        updateData.maxLeverage = updates.maxLeverage;
      }
      
      await Market.updateOne(
        { symbol },
        { $set: updateData }
      ).session(session);
      
      // Update cache
      this.markets.set(symbol, updatedConfig);
      if (updates.status) {
        this.marketStatus.set(symbol, updates.status);
      }
      
      // Update services if critical params changed
      if (updates.status || updates.maxLeverage || updates.fees) {
        await this.updateMarketInServices(updatedConfig);
      }
      
      // Log audit
      await this.logAudit({
        action: AdminAction.UPDATE_MARKET,
        adminId,
        adminEmail,
        targetType: 'MARKET',
        targetId: symbol,
        before,
        after: updatedConfig,
        changes: updates,
        reason,
      }, session);
      
      await session.commitTransaction();
      
      // Emit event
      this.emit('market_updated', { symbol, updates, config: updatedConfig });
      
      logger.info(`Market ${symbol} updated by ${adminEmail}`);
      
      return updatedConfig;
      
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error updating market', error);
      throw error;
    } finally {
      session.endSession();
    }
  }
  
  /**
   * Toggle market trading
   */
  async toggleMarket(
    symbol: string,
    enabled: boolean,
    adminId: string,
    adminEmail: string,
    reason?: string
  ): Promise<void> {
    const status = enabled ? 'active' : 'suspended';
    
    await this.updateMarket(
      symbol,
      { status },
      adminId,
      adminEmail,
      reason || `Market ${enabled ? 'enabled' : 'disabled'}`
    );
    
    // Cancel all pending orders if disabling
    if (!enabled) {
      await this.cancelAllMarketOrders(symbol);
    }
    
    logger.info(`Market ${symbol} ${enabled ? 'enabled' : 'disabled'} by ${adminEmail}`);
  }
  
  /**
   * Delete market
   */
  async deleteMarket(
    symbol: string,
    adminId: string,
    adminEmail: string,
    reason?: string
  ): Promise<void> {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const config = this.markets.get(symbol);
      if (!config) {
        throw new Error(`Market ${symbol} not found`);
      }
      
      // Check for open positions
      const { Position } = await import('../models/Position.model');
      const openPositions = await Position.countDocuments({
        symbol,
        status: 'OPEN',
      }).session(session);
      
      if (openPositions > 0) {
        throw new Error(`Cannot delete market with ${openPositions} open positions`);
      }
      
      // Cancel all orders
      await this.cancelAllMarketOrders(symbol);
      
      // Mark as delisted first
      config.status = 'delisted';
      this.marketStatus.set(symbol, 'delisted');
      
      // Update database
      await Market.updateOne(
        { symbol },
        { $set: { status: MarketStatus.DELISTED, isDelisted: true, delistedAt: new Date() } }
      ).session(session);
      
      // Log audit
      await this.logAudit({
        action: AdminAction.DELETE_MARKET,
        adminId,
        adminEmail,
        targetType: 'MARKET',
        targetId: symbol,
        before: config,
        reason,
      }, session);
      
      await session.commitTransaction();
      
      // Remove from cache after transaction
      this.markets.delete(symbol);
      this.marketStatus.delete(symbol);
      
      // Emit event
      this.emit('market_deleted', { symbol });
      
      logger.info(`Market ${symbol} deleted by ${adminEmail}`);
      
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error deleting market', error);
      throw error;
    } finally {
      session.endSession();
    }
  }
  
  /**
   * Set maintenance window
   */
  async setMaintenanceWindow(
    symbol: string,
    start: Date,
    end: Date,
    reason: string,
    adminId: string,
    adminEmail: string
  ): Promise<void> {
    const config = this.markets.get(symbol);
    if (!config) {
      throw new Error(`Market ${symbol} not found`);
    }
    
    // Add maintenance window
    if (!config.maintenanceWindows) {
      config.maintenanceWindows = [];
    }
    
    config.maintenanceWindows.push({ start, end, reason });
    
    // Schedule maintenance mode
    const now = new Date();
    if (now >= start && now <= end) {
      config.status = 'maintenance';
      this.marketStatus.set(symbol, 'maintenance');
    }
    
    // Schedule automatic status changes
    if (now < start) {
      setTimeout(() => {
        this.enterMaintenanceMode(symbol);
      }, start.getTime() - now.getTime());
    }
    
    if (now < end) {
      setTimeout(() => {
        this.exitMaintenanceMode(symbol);
      }, end.getTime() - now.getTime());
    }
    
    logger.info(`Maintenance window scheduled for ${symbol}: ${start} - ${end}`);
    
    // Emit event
    this.emit('maintenance_scheduled', { symbol, start, end, reason });
  }
  
  /**
   * Emergency halt trading
   */
  async emergencyHalt(
    symbol: string | 'ALL',
    duration: number, // minutes
    reason: string,
    adminId: string,
    adminEmail: string
  ): Promise<void> {
    const until = new Date(Date.now() + duration * 60 * 1000);
    
    if (symbol === 'ALL') {
      // Halt all markets
      for (const [sym, config] of this.markets) {
        config.status = 'suspended';
        this.marketStatus.set(sym, 'suspended');
        this.tradingHalts.set(sym, { reason, until });
        await this.cancelAllMarketOrders(sym);
      }
      
      logger.warn(`EMERGENCY: All trading halted until ${until} by ${adminEmail}. Reason: ${reason}`);
      
      // Emit global halt event
      this.emit('global_trading_halt', { until, reason });
      
    } else {
      // Halt specific market
      const config = this.markets.get(symbol);
      if (!config) {
        throw new Error(`Market ${symbol} not found`);
      }
      
      config.status = 'suspended';
      this.marketStatus.set(symbol, 'suspended');
      this.tradingHalts.set(symbol, { reason, until });
      
      await this.cancelAllMarketOrders(symbol);
      
      logger.warn(`EMERGENCY: ${symbol} trading halted until ${until} by ${adminEmail}. Reason: ${reason}`);
      
      // Emit market halt event
      this.emit('market_trading_halt', { symbol, until, reason });
    }
    
    // Schedule automatic resumption
    setTimeout(() => {
      this.resumeTrading(symbol);
    }, duration * 60 * 1000);
  }
  
  /**
   * Resume trading
   */
  private resumeTrading(symbol: string | 'ALL'): void {
    if (symbol === 'ALL') {
      for (const [sym, config] of this.markets) {
        if (this.tradingHalts.has(sym)) {
          config.status = 'active';
          this.marketStatus.set(sym, 'active');
          this.tradingHalts.delete(sym);
        }
      }
      
      logger.info('Trading resumed for all markets');
      this.emit('global_trading_resumed');
      
    } else {
      const config = this.markets.get(symbol);
      if (config && this.tradingHalts.has(symbol)) {
        config.status = 'active';
        this.marketStatus.set(symbol, 'active');
        this.tradingHalts.delete(symbol);
        
        logger.info(`Trading resumed for ${symbol}`);
        this.emit('market_trading_resumed', { symbol });
      }
    }
  }
  
  /**
   * Update spread settings
   */
  async updateSpread(
    symbol: string,
    spread: { min?: number; max?: number; default?: number },
    adminId: string,
    adminEmail: string
  ): Promise<void> {
    const config = this.markets.get(symbol);
    if (!config) {
      throw new Error(`Market ${symbol} not found`);
    }
    
    if (!config.spread) {
      config.spread = { min: 0.0001, max: 0.01, default: 0.001 };
    }
    
    Object.assign(config.spread, spread);
    
    // Apply to price feed
    feedManagerService.setSpread(symbol, config.spread.default);
    
    logger.info(`Spread updated for ${symbol} by ${adminEmail}`);
    
    this.emit('spread_updated', { symbol, spread: config.spread });
  }
  
  /**
   * Update slippage settings
   */
  async updateSlippage(
    symbol: string,
    slippage: { min?: number; max?: number; default?: number },
    adminId: string,
    adminEmail: string
  ): Promise<void> {
    const config = this.markets.get(symbol);
    if (!config) {
      throw new Error(`Market ${symbol} not found`);
    }
    
    if (!config.slippage) {
      config.slippage = { min: 0.0001, max: 0.05, default: 0.001 };
    }
    
    Object.assign(config.slippage, slippage);
    
    logger.info(`Slippage updated for ${symbol} by ${adminEmail}`);
    
    this.emit('slippage_updated', { symbol, slippage: config.slippage });
  }
  
  /**
   * Initialize market in services
   */
  private async initializeMarketInServices(config: IMarketConfig): Promise<void> {
    // Initialize in matching engine
    matchingEngineService.addMarket(config.symbol);
    
    // Initialize in margin calculation service
    if (config.leverageTiers) {
      marginCalculationService.setLeverageTiers(config.symbol, config.leverageTiers);
    }
    
    // Initialize in feed manager
    feedManagerService.addSymbol(config.symbol);
  }
  
  /**
   * Update market in services
   */
  private async updateMarketInServices(config: IMarketConfig): Promise<void> {
    // Update leverage tiers if changed
    if (config.leverageTiers) {
      marginCalculationService.setLeverageTiers(config.symbol, config.leverageTiers);
    }
    
    // Update trading status
    if (config.status !== 'active') {
      matchingEngineService.pauseMarket(config.symbol);
    } else {
      matchingEngineService.resumeMarket(config.symbol);
    }
  }
  
  /**
   * Cancel all orders for market
   */
  private async cancelAllMarketOrders(symbol: string): Promise<void> {
    try {
      const { Order } = await import('../models/Order.model');
      const orders = await Order.find({
        symbol,
        status: { $in: ['OPEN', 'PARTIALLY_FILLED'] },
      }).lean();
      
      for (const order of orders) {
        await matchingEngineService.cancelOrder(
          order.clientOrderId || order._id.toString(),
          order.userId.toString(),
          'Market suspended - admin action'
        );
      }
      
      logger.info(`Cancelled ${orders.length} orders for ${symbol}`);
    } catch (error) {
      logger.error(`Error cancelling orders for ${symbol}`, error);
    }
  }
  
  /**
   * Enter maintenance mode
   */
  private enterMaintenanceMode(symbol: string): void {
    const config = this.markets.get(symbol);
    if (config) {
      config.status = 'maintenance';
      this.marketStatus.set(symbol, 'maintenance');
      this.emit('market_maintenance_started', { symbol });
      logger.info(`Market ${symbol} entered maintenance mode`);
    }
  }
  
  /**
   * Exit maintenance mode
   */
  private exitMaintenanceMode(symbol: string): void {
    const config = this.markets.get(symbol);
    if (config) {
      config.status = 'active';
      this.marketStatus.set(symbol, 'active');
      this.emit('market_maintenance_ended', { symbol });
      logger.info(`Market ${symbol} exited maintenance mode`);
    }
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
        reversible: true,
        ipAddress: '0.0.0.0', // Would come from request
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
   * Get market configuration
   */
  getMarket(symbol: string): IMarketConfig | null {
    return this.markets.get(symbol) || null;
  }
  
  /**
   * Get all markets
   */
  getAllMarkets(): IMarketConfig[] {
    return Array.from(this.markets.values());
  }
  
  /**
   * Get market status
   */
  getMarketStatus(symbol: string): string | null {
    return this.marketStatus.get(symbol) || null;
  }
  
  /**
   * Get trading halts
   */
  getTradingHalts(): Map<string, { reason: string; until?: Date }> {
    return new Map(this.tradingHalts);
  }
  
  /**
   * Check if market is tradable
   */
  isMarketTradable(symbol: string): boolean {
    const status = this.marketStatus.get(symbol);
    return status === 'active' && !this.tradingHalts.has(symbol);
  }
}

export default MarketManagementService.getInstance();