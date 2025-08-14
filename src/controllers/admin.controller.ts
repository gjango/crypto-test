import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';
import marketManagementService from '../services/marketManagement.service';
import riskControlService from '../services/riskControl.service';
import engineControlService from '../services/engineControl.service';
import configurationManagementService from '../services/configurationManagement.service';
import scenarioTestingService from '../services/scenarioTesting.service';
import adminDashboardService from '../services/adminDashboard.service';
import { AdminAuditLog } from '../models/AdminAuditLog.model';

const logger = createLogger('AdminController');

// Helper to get admin info from request
const getAdminInfo = (req: Request) => ({
  adminId: req.user?.userId || 'ADMIN',
  adminEmail: req.user?.email || 'admin@system',
});

/**
 * Dashboard endpoints
 */
export const getDashboardMetrics = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const metrics = await adminDashboardService.getCurrentMetrics();
    res.json({ success: true, data: metrics });
  } catch (error) {
    next(error);
  }
};

export const getDashboardHistory = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const history = adminDashboardService.getMetricsHistory();
    res.json({ success: true, data: history });
  } catch (error) {
    next(error);
  }
};

export const getSystemStatistics = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const stats = await adminDashboardService.getSystemStatistics();
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
};

/**
 * Market management endpoints
 */
export const getMarkets = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const markets = marketManagementService.getAllMarkets();
    res.json({ success: true, data: markets });
  } catch (error) {
    next(error);
  }
};

export const getMarket = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { symbol } = req.params;
    const market = marketManagementService.getMarket(symbol);
    
    if (!market) {
      res.status(404).json({ success: false, message: 'Market not found' });
      return;
    }
    
    res.json({ success: true, data: market });
  } catch (error) {
    next(error);
  }
};

export const createMarket = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { adminId, adminEmail } = getAdminInfo(req);
    const { reason, ...config } = req.body;
    
    const market = await marketManagementService.createMarket(
      config,
      adminId,
      adminEmail,
      reason
    );
    
    res.json({ success: true, data: market });
  } catch (error) {
    next(error);
  }
};

export const updateMarket = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { symbol } = req.params;
    const { adminId, adminEmail } = getAdminInfo(req);
    const { reason, ...updates } = req.body;
    
    const market = await marketManagementService.updateMarket(
      symbol,
      updates,
      adminId,
      adminEmail,
      reason
    );
    
    res.json({ success: true, data: market });
  } catch (error) {
    next(error);
  }
};

export const toggleMarket = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { symbol } = req.params;
    const { adminId, adminEmail } = getAdminInfo(req);
    const { enabled, reason } = req.body;
    
    await marketManagementService.toggleMarket(
      symbol,
      enabled,
      adminId,
      adminEmail,
      reason
    );
    
    res.json({ success: true, message: `Market ${symbol} ${enabled ? 'enabled' : 'disabled'}` });
  } catch (error) {
    next(error);
  }
};

export const emergencyHalt = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { adminId, adminEmail } = getAdminInfo(req);
    const { symbol, duration, reason } = req.body;
    
    await marketManagementService.emergencyHalt(
      symbol || 'ALL',
      duration,
      reason,
      adminId,
      adminEmail
    );
    
    res.json({ 
      success: true, 
      message: `Emergency halt activated for ${symbol || 'all markets'}` 
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Risk control endpoints
 */
export const getRiskConfig = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const config = riskControlService.getRiskConfig();
    res.json({ success: true, data: config });
  } catch (error) {
    next(error);
  }
};

export const updateRiskParameters = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { adminId, adminEmail } = getAdminInfo(req);
    const { reason, ...updates } = req.body;
    
    const config = await riskControlService.updateRiskParameters(
      updates,
      adminId,
      adminEmail,
      reason
    );
    
    res.json({ success: true, data: config });
  } catch (error) {
    next(error);
  }
};

export const updateLeverageTiers = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { symbol } = req.params;
    const { adminId, adminEmail } = getAdminInfo(req);
    const { tiers, reason } = req.body;
    
    await riskControlService.updateLeverageTiers(
      symbol,
      tiers,
      adminId,
      adminEmail,
      reason
    );
    
    res.json({ success: true, message: `Leverage tiers updated for ${symbol}` });
  } catch (error) {
    next(error);
  }
};

export const forceLiquidation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { positionId } = req.params;
    const { adminId, adminEmail } = getAdminInfo(req);
    const { reason } = req.body;
    
    if (!reason) {
      res.status(400).json({ success: false, message: 'Reason required for force liquidation' });
      return;
    }
    
    await riskControlService.forceLiquidation(
      positionId,
      adminId,
      adminEmail,
      reason
    );
    
    res.json({ success: true, message: `Position ${positionId} force liquidated` });
  } catch (error) {
    next(error);
  }
};

export const getCircuitBreakers = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const breakers = riskControlService.getCircuitBreakers();
    res.json({ success: true, data: Array.from(breakers.values()) });
  } catch (error) {
    next(error);
  }
};

export const configureCircuitBreaker = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { symbol } = req.params;
    const { adminId, adminEmail } = getAdminInfo(req);
    const { reason, ...config } = req.body;
    
    const breaker = await riskControlService.configureCircuitBreaker(
      symbol,
      config,
      adminId,
      adminEmail,
      reason
    );
    
    res.json({ success: true, data: breaker });
  } catch (error) {
    next(error);
  }
};

/**
 * Engine control endpoints
 */
export const getEngineStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const status = engineControlService.getEngineStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    next(error);
  }
};

export const pauseTrading = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { adminId, adminEmail } = getAdminInfo(req);
    const { reason } = req.body;
    
    if (!reason) {
      res.status(400).json({ success: false, message: 'Reason required to pause trading' });
      return;
    }
    
    await engineControlService.pauseTrading(adminId, adminEmail, reason);
    
    res.json({ success: true, message: 'Trading paused globally' });
  } catch (error) {
    next(error);
  }
};

export const resumeTrading = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { adminId, adminEmail } = getAdminInfo(req);
    const { reason } = req.body;
    
    await engineControlService.resumeTrading(adminId, adminEmail, reason);
    
    res.json({ success: true, message: 'Trading resumed globally' });
  } catch (error) {
    next(error);
  }
};

export const setMaintenanceMode = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { adminId, adminEmail } = getAdminInfo(req);
    const { enabled, duration, reason } = req.body;
    
    if (!reason) {
      res.status(400).json({ success: false, message: 'Reason required for maintenance mode' });
      return;
    }
    
    await engineControlService.setMaintenanceMode(
      enabled,
      duration,
      adminId,
      adminEmail,
      reason
    );
    
    res.json({ 
      success: true, 
      message: `Maintenance mode ${enabled ? 'enabled' : 'disabled'}` 
    });
  } catch (error) {
    next(error);
  }
};

export const cancelAllOrders = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { adminId, adminEmail } = getAdminInfo(req);
    const { symbol, userId, reason } = req.body;
    
    if (!reason) {
      res.status(400).json({ success: false, message: 'Reason required to cancel orders' });
      return;
    }
    
    const result = await engineControlService.cancelAllOrders(
      { symbol, userId },
      adminId,
      adminEmail,
      reason
    );
    
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

/**
 * Configuration management endpoints
 */
export const getCurrentConfig = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const config = configurationManagementService.getCurrentConfiguration();
    res.json({ success: true, data: config });
  } catch (error) {
    next(error);
  }
};

export const getConfigHistory = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const history = configurationManagementService.getConfigurationHistory();
    res.json({ success: true, data: history });
  } catch (error) {
    next(error);
  }
};

export const saveConfiguration = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { adminId, adminEmail } = getAdminInfo(req);
    const { reason } = req.body;
    
    const config = await configurationManagementService.saveConfiguration(
      undefined,
      adminId,
      adminEmail,
      reason
    );
    
    res.json({ success: true, data: config });
  } catch (error) {
    next(error);
  }
};

export const activateConfiguration = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { configId } = req.params;
    const { adminId, adminEmail } = getAdminInfo(req);
    const { reason } = req.body;
    
    const config = await configurationManagementService.activateConfiguration(
      configId,
      adminId,
      adminEmail,
      reason
    );
    
    res.json({ success: true, data: config });
  } catch (error) {
    next(error);
  }
};

export const rollbackConfiguration = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { adminId, adminEmail } = getAdminInfo(req);
    const { steps, reason } = req.body;
    
    if (!reason) {
      res.status(400).json({ success: false, message: 'Reason required for rollback' });
      return;
    }
    
    const config = await configurationManagementService.rollbackConfiguration(
      steps || 1,
      adminId,
      adminEmail,
      reason
    );
    
    res.json({ success: true, data: config });
  } catch (error) {
    next(error);
  }
};

export const exportConfiguration = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { configId } = req.params;
    const { adminId, adminEmail } = getAdminInfo(req);
    
    const filePath = await configurationManagementService.exportConfiguration(
      configId,
      adminId,
      adminEmail
    );
    
    res.json({ success: true, data: { filePath } });
  } catch (error) {
    next(error);
  }
};

/**
 * Scenario testing endpoints
 */
export const getScenarios = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const scenarios = scenarioTestingService.getScenarios();
    res.json({ success: true, data: scenarios });
  } catch (error) {
    next(error);
  }
};

export const createScenario = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { adminId, adminEmail } = getAdminInfo(req);
    const scenarioData = req.body;
    
    const scenario = await scenarioTestingService.createScenario(
      scenarioData,
      adminId,
      adminEmail
    );
    
    res.json({ success: true, data: scenario });
  } catch (error) {
    next(error);
  }
};

export const executeScenario = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { scenarioId } = req.params;
    const { adminId, adminEmail } = getAdminInfo(req);
    
    const result = await scenarioTestingService.executeScenario(
      scenarioId,
      adminId,
      adminEmail
    );
    
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const deleteScenario = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { scenarioId } = req.params;
    const { adminId, adminEmail } = getAdminInfo(req);
    
    await scenarioTestingService.deleteScenario(
      scenarioId,
      adminId,
      adminEmail
    );
    
    res.json({ success: true, message: `Scenario ${scenarioId} deleted` });
  } catch (error) {
    next(error);
  }
};

/**
 * Audit log endpoints
 */
export const getAuditLogs = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { 
      action, 
      adminId, 
      targetType, 
      targetId,
      startDate,
      endDate,
      limit = 100,
      offset = 0
    } = req.query;
    
    const filter: any = {};
    
    if (action) filter.action = action;
    if (adminId) filter.adminId = adminId;
    if (targetType) filter.targetType = targetType;
    if (targetId) filter.targetId = targetId;
    
    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) filter.timestamp.$gte = new Date(startDate as string);
      if (endDate) filter.timestamp.$lte = new Date(endDate as string);
    }
    
    const logs = await AdminAuditLog.find(filter)
      .sort({ timestamp: -1 })
      .limit(Number(limit))
      .skip(Number(offset))
      .lean();
    
    const total = await AdminAuditLog.countDocuments(filter);
    
    res.json({ 
      success: true, 
      data: logs,
      pagination: {
        total,
        limit: Number(limit),
        offset: Number(offset)
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getAuditLogSummary = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { hours = 24 } = req.query;
    const summary = await adminDashboardService.getAuditLogSummary(Number(hours));
    res.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
};

/**
 * Insurance fund endpoints
 */
export const getInsuranceFund = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const fund = riskControlService.getInsuranceFundStatus();
    res.json({ success: true, data: fund });
  } catch (error) {
    next(error);
  }
};

export const addToInsuranceFund = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { adminId, adminEmail } = getAdminInfo(req);
    const { amount, reason } = req.body;
    
    if (!amount || amount <= 0) {
      res.status(400).json({ success: false, message: 'Invalid amount' });
      return;
    }
    
    await riskControlService.addToInsuranceFund(
      amount,
      adminId,
      adminEmail,
      reason
    );
    
    res.json({ success: true, message: `Added ${amount} to insurance fund` });
  } catch (error) {
    next(error);
  }
};