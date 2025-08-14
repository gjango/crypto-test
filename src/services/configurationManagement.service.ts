import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import {
  ISystemConfig,
  IConfigSnapshot,
  IMarketConfig,
  IEngineConfig,
  IRiskConfig,
  AdminAction,
  IAdminAuditLog
} from '../types/admin';
import { AdminAuditLog } from '../models/AdminAuditLog.model';
import { SystemConfig } from '../models/SystemConfig.model';
import marketManagementService from './marketManagement.service';
import riskControlService from './riskControl.service';
import engineControlService from './engineControl.service';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';
import * as fs from 'fs/promises';
import * as path from 'path';

const logger = createLogger('ConfigurationManagement');

export class ConfigurationManagementService extends EventEmitter {
  private static instance: ConfigurationManagementService;
  private activeConfig: ISystemConfig | null = null;
  private configHistory: ISystemConfig[] = [];
  private snapshots: Map<string, IConfigSnapshot> = new Map();
  private configPath: string = path.join(process.cwd(), 'configs');
  private maxHistorySize: number = 50;
  
  private constructor() {
    super();
    this.setMaxListeners(1000);
    this.initializeConfigDirectory();
    this.loadActiveConfiguration();
  }
  
  public static getInstance(): ConfigurationManagementService {
    if (!ConfigurationManagementService.instance) {
      ConfigurationManagementService.instance = new ConfigurationManagementService();
    }
    return ConfigurationManagementService.instance;
  }
  
  /**
   * Initialize config directory
   */
  private async initializeConfigDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.configPath, { recursive: true });
      await fs.mkdir(path.join(this.configPath, 'snapshots'), { recursive: true });
      await fs.mkdir(path.join(this.configPath, 'exports'), { recursive: true });
      logger.info('Configuration directories initialized');
    } catch (error) {
      logger.error('Error initializing config directories', error);
    }
  }
  
  /**
   * Load active configuration
   */
  private async loadActiveConfiguration(): Promise<void> {
    try {
      // Load from database
      const config = await SystemConfig.findOne({ active: true }).lean();
      
      if (config) {
        this.activeConfig = this.convertFromDB(config);
        logger.info(`Loaded active configuration: ${this.activeConfig.configId}`);
      } else {
        // Create default configuration
        this.activeConfig = await this.createDefaultConfiguration();
      }
      
      // Load history
      const history = await SystemConfig.find({})
        .sort({ createdAt: -1 })
        .limit(this.maxHistorySize)
        .lean();
      
      this.configHistory = history.map(c => this.convertFromDB(c));
      
    } catch (error) {
      logger.error('Error loading active configuration', error);
      this.activeConfig = await this.createDefaultConfiguration();
    }
  }
  
  /**
   * Create default configuration
   */
  private async createDefaultConfiguration(): Promise<ISystemConfig> {
    const config: ISystemConfig = {
      configId: `CONFIG-${Date.now()}-${uuidv4().substring(0, 8)}`,
      version: '1.0.0',
      name: 'Default Configuration',
      description: 'System default configuration',
      markets: marketManagementService.getAllMarkets(),
      engine: engineControlService.getEngineStatus().config,
      risk: riskControlService.getRiskConfig(),
      active: true,
      createdBy: 'SYSTEM',
      createdAt: new Date(),
      activatedAt: new Date(),
    };
    
    // Save to database
    await this.saveConfiguration(config);
    
    return config;
  }
  
  /**
   * Get current configuration
   */
  getCurrentConfiguration(): ISystemConfig {
    if (!this.activeConfig) {
      throw new Error('No active configuration');
    }
    
    // Build current config from live services
    return {
      ...this.activeConfig,
      markets: marketManagementService.getAllMarkets(),
      engine: engineControlService.getEngineStatus().config,
      risk: riskControlService.getRiskConfig(),
    };
  }
  
  /**
   * Save configuration
   */
  async saveConfiguration(
    config?: ISystemConfig,
    adminId?: string,
    adminEmail?: string,
    reason?: string
  ): Promise<ISystemConfig> {
    const configToSave = config || this.getCurrentConfiguration();
    
    // Generate new ID and version
    configToSave.configId = `CONFIG-${Date.now()}-${uuidv4().substring(0, 8)}`;
    configToSave.version = this.incrementVersion(configToSave.version);
    configToSave.createdBy = adminEmail || configToSave.createdBy;
    configToSave.createdAt = new Date();
    configToSave.parent = this.activeConfig?.configId;
    
    // Save to database
    await SystemConfig.create(this.convertToDB(configToSave));
    
    // Add to history
    this.configHistory.unshift(configToSave);
    if (this.configHistory.length > this.maxHistorySize) {
      this.configHistory.pop();
    }
    
    // Save to file
    await this.saveConfigToFile(configToSave);
    
    // Log audit
    if (adminId) {
      await this.logAudit({
        action: AdminAction.SAVE_CONFIG,
        adminId,
        adminEmail: adminEmail!,
        targetType: 'CONFIG',
        targetId: configToSave.configId,
        after: configToSave,
        reason,
      });
    }
    
    logger.info(`Configuration saved: ${configToSave.configId}`);
    
    // Emit event
    this.emit('config_saved', configToSave);
    
    return configToSave;
  }
  
  /**
   * Activate configuration
   */
  async activateConfiguration(
    configId: string,
    adminId: string,
    adminEmail: string,
    reason?: string
  ): Promise<ISystemConfig> {
    // Find configuration
    const config = this.configHistory.find(c => c.configId === configId);
    
    if (!config) {
      throw new Error(`Configuration ${configId} not found`);
    }
    
    const previousConfig = this.activeConfig;
    
    // Deactivate current config
    if (this.activeConfig) {
      await SystemConfig.updateOne(
        { configId: this.activeConfig.configId },
        { 
          $set: { 
            active: false,
            deactivatedAt: new Date()
          } 
        }
      );
    }
    
    // Activate new config
    config.active = true;
    config.activatedAt = new Date();
    
    await SystemConfig.updateOne(
      { configId },
      { 
        $set: { 
          active: true,
          activatedAt: new Date()
        } 
      }
    );
    
    this.activeConfig = config;
    
    // Apply configuration to services
    await this.applyConfiguration(config);
    
    // Log audit
    await this.logAudit({
      action: AdminAction.ACTIVATE_CONFIG,
      adminId,
      adminEmail,
      targetType: 'CONFIG',
      targetId: configId,
      before: previousConfig,
      after: config,
      reason,
    });
    
    logger.info(`Configuration activated: ${configId} by ${adminEmail}`);
    
    // Emit event
    this.emit('config_activated', config);
    
    return config;
  }
  
  /**
   * Rollback to previous configuration
   */
  async rollbackConfiguration(
    steps: number = 1,
    adminId: string,
    adminEmail: string,
    reason: string
  ): Promise<ISystemConfig> {
    if (this.configHistory.length < steps + 1) {
      throw new Error('Not enough configuration history for rollback');
    }
    
    const targetConfig = this.configHistory[steps];
    
    // Create snapshot before rollback
    await this.createSnapshot(`Pre-rollback snapshot`, adminId, adminEmail);
    
    // Activate target configuration
    return await this.activateConfiguration(
      targetConfig.configId,
      adminId,
      adminEmail,
      `Rollback ${steps} steps: ${reason}`
    );
  }
  
  /**
   * Create configuration snapshot
   */
  async createSnapshot(
    reason: string,
    adminId: string,
    adminEmail: string
  ): Promise<IConfigSnapshot> {
    const config = this.getCurrentConfiguration();
    
    const snapshot: IConfigSnapshot = {
      snapshotId: `SNAP-${Date.now()}-${uuidv4().substring(0, 8)}`,
      config,
      timestamp: new Date(),
      reason,
      createdBy: adminEmail,
    };
    
    // Store snapshot
    this.snapshots.set(snapshot.snapshotId, snapshot);
    
    // Save to file
    await this.saveSnapshotToFile(snapshot);
    
    // Log audit
    await this.logAudit({
      action: AdminAction.SAVE_CONFIG,
      adminId,
      adminEmail,
      targetType: 'CONFIG',
      targetId: snapshot.snapshotId,
      metadata: { type: 'snapshot' },
      reason,
    });
    
    logger.info(`Configuration snapshot created: ${snapshot.snapshotId}`);
    
    // Emit event
    this.emit('snapshot_created', snapshot);
    
    return snapshot;
  }
  
  /**
   * Restore from snapshot
   */
  async restoreSnapshot(
    snapshotId: string,
    adminId: string,
    adminEmail: string,
    reason: string
  ): Promise<ISystemConfig> {
    const snapshot = this.snapshots.get(snapshotId);
    
    if (!snapshot) {
      // Try loading from file
      const loadedSnapshot = await this.loadSnapshotFromFile(snapshotId);
      if (!loadedSnapshot) {
        throw new Error(`Snapshot ${snapshotId} not found`);
      }
      this.snapshots.set(snapshotId, loadedSnapshot);
    }
    
    const config = snapshot!.config;
    
    // Save as new configuration
    const newConfig = await this.saveConfiguration(
      config,
      adminId,
      adminEmail,
      `Restored from snapshot ${snapshotId}: ${reason}`
    );
    
    // Activate it
    await this.activateConfiguration(newConfig.configId, adminId, adminEmail, reason);
    
    logger.info(`Configuration restored from snapshot: ${snapshotId}`);
    
    return newConfig;
  }
  
  /**
   * Import configuration from file
   */
  async importConfiguration(
    filePath: string,
    adminId: string,
    adminEmail: string,
    reason?: string
  ): Promise<ISystemConfig> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const config = JSON.parse(content) as ISystemConfig;
      
      // Validate configuration
      this.validateConfiguration(config);
      
      // Save as new configuration
      const newConfig = await this.saveConfiguration(
        config,
        adminId,
        adminEmail,
        reason || 'Imported from file'
      );
      
      // Log audit
      await this.logAudit({
        action: AdminAction.IMPORT_CONFIG,
        adminId,
        adminEmail,
        targetType: 'CONFIG',
        targetId: newConfig.configId,
        metadata: { sourceFile: filePath },
        reason,
      });
      
      logger.info(`Configuration imported from ${filePath}`);
      
      return newConfig;
      
    } catch (error) {
      logger.error('Error importing configuration', error);
      throw new Error(`Failed to import configuration: ${error.message}`);
    }
  }
  
  /**
   * Export configuration to file
   */
  async exportConfiguration(
    configId?: string,
    adminId?: string,
    adminEmail?: string
  ): Promise<string> {
    const config = configId ? 
      this.configHistory.find(c => c.configId === configId) :
      this.getCurrentConfiguration();
    
    if (!config) {
      throw new Error('Configuration not found');
    }
    
    const fileName = `config-${config.configId}-${Date.now()}.json`;
    const filePath = path.join(this.configPath, 'exports', fileName);
    
    await fs.writeFile(filePath, JSON.stringify(config, null, 2));
    
    // Log audit
    if (adminId) {
      await this.logAudit({
        action: AdminAction.EXPORT_CONFIG,
        adminId,
        adminEmail: adminEmail!,
        targetType: 'CONFIG',
        targetId: config.configId,
        metadata: { exportPath: filePath },
      });
    }
    
    logger.info(`Configuration exported to ${filePath}`);
    
    return filePath;
  }
  
  /**
   * Apply configuration to services
   */
  private async applyConfiguration(config: ISystemConfig): Promise<void> {
    logger.info('Applying configuration to services...');
    
    try {
      // Apply market configurations
      for (const marketConfig of config.markets) {
        await marketManagementService.updateMarket(
          marketConfig.symbol,
          marketConfig,
          'SYSTEM',
          'system@admin',
          'Configuration activation'
        );
      }
      
      // Apply engine configuration
      await engineControlService.updateEngineConfig(
        config.engine,
        'SYSTEM',
        'system@admin',
        'Configuration activation'
      );
      
      // Apply risk configuration
      await riskControlService.updateRiskParameters(
        config.risk.global,
        'SYSTEM',
        'system@admin',
        'Configuration activation'
      );
      
      // Apply per-symbol risk configs
      for (const [symbol, symbolRisk] of config.risk.perSymbol) {
        await riskControlService.setSymbolExposureLimit(
          symbol,
          symbolRisk.maxPositionSize,
          'SYSTEM',
          'system@admin',
          'Configuration activation'
        );
      }
      
      // Apply leverage tiers
      for (const [symbol, tiers] of config.risk.leverageTiers) {
        await riskControlService.updateLeverageTiers(
          symbol,
          tiers,
          'SYSTEM',
          'system@admin',
          'Configuration activation'
        );
      }
      
      logger.info('Configuration applied successfully');
      
    } catch (error) {
      logger.error('Error applying configuration', error);
      throw new Error(`Failed to apply configuration: ${error.message}`);
    }
  }
  
  /**
   * Validate configuration
   */
  private validateConfiguration(config: ISystemConfig): void {
    if (!config.configId || !config.version || !config.name) {
      throw new Error('Invalid configuration: missing required fields');
    }
    
    if (!config.markets || config.markets.length === 0) {
      throw new Error('Invalid configuration: no markets defined');
    }
    
    if (!config.engine || !config.risk) {
      throw new Error('Invalid configuration: missing engine or risk config');
    }
    
    // Validate market configs
    for (const market of config.markets) {
      if (!market.symbol || !market.baseAsset || !market.quoteAsset) {
        throw new Error(`Invalid market configuration: ${market.symbol}`);
      }
    }
  }
  
  /**
   * Save configuration to file
   */
  private async saveConfigToFile(config: ISystemConfig): Promise<void> {
    try {
      const fileName = `${config.configId}.json`;
      const filePath = path.join(this.configPath, fileName);
      await fs.writeFile(filePath, JSON.stringify(config, null, 2));
    } catch (error) {
      logger.error('Error saving config to file', error);
    }
  }
  
  /**
   * Save snapshot to file
   */
  private async saveSnapshotToFile(snapshot: IConfigSnapshot): Promise<void> {
    try {
      const fileName = `${snapshot.snapshotId}.json`;
      const filePath = path.join(this.configPath, 'snapshots', fileName);
      await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2));
    } catch (error) {
      logger.error('Error saving snapshot to file', error);
    }
  }
  
  /**
   * Load snapshot from file
   */
  private async loadSnapshotFromFile(snapshotId: string): Promise<IConfigSnapshot | null> {
    try {
      const fileName = `${snapshotId}.json`;
      const filePath = path.join(this.configPath, 'snapshots', fileName);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as IConfigSnapshot;
    } catch (error) {
      logger.error('Error loading snapshot from file', error);
      return null;
    }
  }
  
  /**
   * Increment version
   */
  private incrementVersion(version: string): string {
    const parts = version.split('.');
    const patch = parseInt(parts[2] || '0') + 1;
    return `${parts[0]}.${parts[1]}.${patch}`;
  }
  
  /**
   * Convert from database format
   */
  private convertFromDB(dbConfig: any): ISystemConfig {
    return {
      ...dbConfig,
      risk: {
        global: dbConfig.risk?.global || {},
        perSymbol: new Map(Object.entries(dbConfig.risk?.perSymbol || {})),
        leverageTiers: new Map(Object.entries(dbConfig.risk?.leverageTiers || {})),
        positionLimits: dbConfig.risk?.positionLimits || {},
      },
    };
  }
  
  /**
   * Convert to database format
   */
  private convertToDB(config: ISystemConfig): any {
    return {
      ...config,
      risk: {
        global: config.risk.global,
        perSymbol: Object.fromEntries(config.risk.perSymbol),
        leverageTiers: Object.fromEntries(config.risk.leverageTiers),
        positionLimits: config.risk.positionLimits,
      },
    };
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
        reversible: true,
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
   * Get configuration history
   */
  getConfigurationHistory(): ISystemConfig[] {
    return [...this.configHistory];
  }
  
  /**
   * Get snapshots
   */
  getSnapshots(): IConfigSnapshot[] {
    return Array.from(this.snapshots.values());
  }
  
  /**
   * Compare configurations
   */
  compareConfigurations(configId1: string, configId2: string): any {
    const config1 = this.configHistory.find(c => c.configId === configId1);
    const config2 = this.configHistory.find(c => c.configId === configId2);
    
    if (!config1 || !config2) {
      throw new Error('Configuration not found');
    }
    
    return {
      config1: {
        id: config1.configId,
        version: config1.version,
        name: config1.name,
        createdAt: config1.createdAt,
      },
      config2: {
        id: config2.configId,
        version: config2.version,
        name: config2.name,
        createdAt: config2.createdAt,
      },
      differences: this.findDifferences(config1, config2),
    };
  }
  
  /**
   * Find differences between configurations
   */
  private findDifferences(config1: ISystemConfig, config2: ISystemConfig): any[] {
    const differences: any[] = [];
    
    // Compare markets
    if (JSON.stringify(config1.markets) !== JSON.stringify(config2.markets)) {
      differences.push({
        field: 'markets',
        type: 'changed',
        before: config1.markets.length,
        after: config2.markets.length,
      });
    }
    
    // Compare engine
    if (JSON.stringify(config1.engine) !== JSON.stringify(config2.engine)) {
      differences.push({
        field: 'engine',
        type: 'changed',
      });
    }
    
    // Compare risk
    if (JSON.stringify(config1.risk) !== JSON.stringify(config2.risk)) {
      differences.push({
        field: 'risk',
        type: 'changed',
      });
    }
    
    return differences;
  }
}

export default ConfigurationManagementService.getInstance();