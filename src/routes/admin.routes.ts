import { Router } from 'express';
import * as adminController from '../controllers/admin.controller';
import { adminAuth } from '../middleware/adminAuth';

const router = Router();

// Apply admin authentication middleware to all routes
router.use(adminAuth);

/**
 * Dashboard routes
 */
router.get('/dashboard/metrics', adminController.getDashboardMetrics);
router.get('/dashboard/history', adminController.getDashboardHistory);
router.get('/dashboard/statistics', adminController.getSystemStatistics);

/**
 * Market management routes
 */
router.get('/markets', adminController.getMarkets);
router.get('/markets/:symbol', adminController.getMarket);
router.post('/markets', adminController.createMarket);
router.put('/markets/:symbol', adminController.updateMarket);
router.post('/markets/:symbol/toggle', adminController.toggleMarket);
router.post('/markets/emergency-halt', adminController.emergencyHalt);

/**
 * Risk control routes
 */
router.get('/risk/config', adminController.getRiskConfig);
router.put('/risk/parameters', adminController.updateRiskParameters);
router.put('/risk/leverage-tiers/:symbol', adminController.updateLeverageTiers);
router.post('/risk/force-liquidation/:positionId', adminController.forceLiquidation);
router.get('/risk/circuit-breakers', adminController.getCircuitBreakers);
router.put('/risk/circuit-breaker/:symbol', adminController.configureCircuitBreaker);
router.get('/risk/insurance-fund', adminController.getInsuranceFund);
router.post('/risk/insurance-fund/add', adminController.addToInsuranceFund);

/**
 * Engine control routes
 */
router.get('/engine/status', adminController.getEngineStatus);
router.post('/engine/pause', adminController.pauseTrading);
router.post('/engine/resume', adminController.resumeTrading);
router.post('/engine/maintenance', adminController.setMaintenanceMode);
router.post('/engine/cancel-orders', adminController.cancelAllOrders);

/**
 * Configuration management routes
 */
router.get('/config/current', adminController.getCurrentConfig);
router.get('/config/history', adminController.getConfigHistory);
router.post('/config/save', adminController.saveConfiguration);
router.post('/config/activate/:configId', adminController.activateConfiguration);
router.post('/config/rollback', adminController.rollbackConfiguration);
router.get('/config/export/:configId?', adminController.exportConfiguration);

/**
 * Scenario testing routes
 */
router.get('/scenarios', adminController.getScenarios);
router.post('/scenarios', adminController.createScenario);
router.post('/scenarios/:scenarioId/execute', adminController.executeScenario);
router.delete('/scenarios/:scenarioId', adminController.deleteScenario);

/**
 * Audit log routes
 */
router.get('/audit/logs', adminController.getAuditLogs);
router.get('/audit/summary', adminController.getAuditLogSummary);

export default router;