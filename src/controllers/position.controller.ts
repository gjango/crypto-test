import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';
import positionManagementService from '../services/positionManagement.service';
import marginCalculationService from '../services/marginCalculation.service';
import riskMonitoringService from '../services/riskMonitoring.service';
import { 
  PositionSide, 
  MarginMode,
  PositionStatus 
} from '../types/margin';

const logger = createLogger('PositionController');

/**
 * Get user positions
 */
export const getPositions = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
      return;
    }
    
    const status = req.query.status as PositionStatus | undefined;
    const positions = await positionManagementService.getUserPositions(userId, status);
    
    // Add current mark prices and PnL
    const enrichedPositions = positions.map(position => {
      const unrealizedPnl = marginCalculationService.calculateUnrealizedPnl(position);
      const roe = marginCalculationService.calculateROE(position, unrealizedPnl);
      
      return {
        ...position,
        unrealizedPnl,
        roe,
        totalPnl: position.realizedPnl + unrealizedPnl,
      };
    });
    
    res.json({
      success: true,
      data: enrichedPositions,
      count: enrichedPositions.length,
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Open new position
 */
export const openPosition = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
      return;
    }
    
    const {
      symbol,
      side,
      quantity,
      leverage,
      marginMode = MarginMode.CROSS,
    } = req.body;
    
    // Validate required fields
    if (!symbol || !side || !quantity || !leverage) {
      res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
      return;
    }
    
    // Validate leverage
    if (leverage < 1 || leverage > 125) {
      res.status(400).json({
        success: false,
        message: 'Invalid leverage (must be between 1 and 125)',
      });
      return;
    }
    
    const position = await positionManagementService.openPosition(
      userId,
      symbol,
      side as PositionSide,
      parseFloat(quantity),
      parseFloat(leverage),
      marginMode as MarginMode
    );
    
    if (!position) {
      res.status(400).json({
        success: false,
        message: 'Failed to open position',
      });
      return;
    }
    
    res.json({
      success: true,
      data: position,
    });
    
  } catch (error) {
    if (error.message?.includes('Insufficient balance')) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
      return;
    }
    next(error);
  }
};

/**
 * Close position
 */
export const closePosition = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
      return;
    }
    
    const { positionId } = req.params;
    const { quantity } = req.body;
    
    const result = await positionManagementService.closePosition(
      positionId,
      userId,
      quantity ? parseFloat(quantity) : undefined
    );
    
    if (!result) {
      res.status(400).json({
        success: false,
        message: 'Failed to close position',
      });
      return;
    }
    
    res.json({
      success: true,
      data: {
        position: result.position,
        realizedPnl: result.realizedPnl,
      },
    });
    
  } catch (error) {
    if (error.message?.includes('not found') || error.message?.includes('not open')) {
      res.status(404).json({
        success: false,
        message: error.message,
      });
      return;
    }
    next(error);
  }
};

/**
 * Add margin to isolated position
 */
export const addMargin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
      return;
    }
    
    const { positionId } = req.params;
    const { amount } = req.body;
    
    if (!amount || amount <= 0) {
      res.status(400).json({
        success: false,
        message: 'Invalid amount',
      });
      return;
    }
    
    const result = await positionManagementService.addMargin(
      positionId,
      userId,
      parseFloat(amount)
    );
    
    if (!result.success) {
      res.status(400).json({
        success: false,
        message: result.reason,
      });
      return;
    }
    
    res.json({
      success: true,
      data: result,
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Remove margin from isolated position
 */
export const removeMargin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
      return;
    }
    
    const { positionId } = req.params;
    const { amount } = req.body;
    
    if (!amount || amount <= 0) {
      res.status(400).json({
        success: false,
        message: 'Invalid amount',
      });
      return;
    }
    
    const result = await positionManagementService.removeMargin(
      positionId,
      userId,
      parseFloat(amount)
    );
    
    if (!result.success) {
      res.status(400).json({
        success: false,
        message: result.reason,
      });
      return;
    }
    
    res.json({
      success: true,
      data: result,
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Adjust position leverage
 */
export const adjustLeverage = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
      return;
    }
    
    const { positionId } = req.params;
    const { leverage } = req.body;
    
    if (!leverage || leverage < 1 || leverage > 125) {
      res.status(400).json({
        success: false,
        message: 'Invalid leverage',
      });
      return;
    }
    
    const result = await positionManagementService.adjustLeverage(
      positionId,
      userId,
      parseFloat(leverage)
    );
    
    if (!result.feasible) {
      res.status(400).json({
        success: false,
        message: result.reason,
      });
      return;
    }
    
    res.json({
      success: true,
      data: result,
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Switch margin mode
 */
export const switchMarginMode = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
      return;
    }
    
    const { positionId } = req.params;
    const { marginMode } = req.body;
    
    if (!marginMode || !Object.values(MarginMode).includes(marginMode)) {
      res.status(400).json({
        success: false,
        message: 'Invalid margin mode',
      });
      return;
    }
    
    const success = await positionManagementService.switchMarginMode(
      positionId,
      userId,
      marginMode as MarginMode
    );
    
    if (!success) {
      res.status(400).json({
        success: false,
        message: 'Failed to switch margin mode',
      });
      return;
    }
    
    res.json({
      success: true,
      message: `Margin mode switched to ${marginMode}`,
    });
    
  } catch (error) {
    if (error.message) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
      return;
    }
    next(error);
  }
};

/**
 * Get position risk metrics
 */
export const getPositionRisk = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
      return;
    }
    
    const metrics = await riskMonitoringService.calculateSystemRiskMetrics(userId);
    
    res.json({
      success: true,
      data: metrics,
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Get leverage tiers for symbol
 */
export const getLeverageTiers = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { symbol } = req.params;
    
    const allTiers = marginCalculationService.getAllLeverageTiers();
    const tiers = allTiers.get(symbol);
    
    if (!tiers) {
      res.status(404).json({
        success: false,
        message: 'Symbol not found',
      });
      return;
    }
    
    res.json({
      success: true,
      data: tiers,
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Calculate margin requirements
 */
export const calculateMargin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
      return;
    }
    
    const { symbol, quantity, leverage, side } = req.body;
    
    if (!symbol || !quantity || !leverage || !side) {
      res.status(400).json({
        success: false,
        message: 'Missing required parameters',
      });
      return;
    }
    
    const marginCalc = await marginCalculationService.calculateMargin(
      userId,
      symbol,
      parseFloat(quantity),
      parseFloat(leverage),
      side as PositionSide
    );
    
    res.json({
      success: true,
      data: marginCalc,
    });
    
  } catch (error) {
    if (error.message?.includes('exceeds maximum')) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
      return;
    }
    next(error);
  }
};

/**
 * Get position history
 */
export const getPositionHistory = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
      return;
    }
    
    const { positionId } = req.params;
    
    const { PositionHistory } = await import('../models/PositionHistory.model');
    const { Position } = await import('../models/Position.model');
    
    // Verify position belongs to user
    const position = await Position.findOne({ positionId, userId }).lean();
    if (!position) {
      res.status(404).json({
        success: false,
        message: 'Position not found',
      });
      return;
    }
    
    const history = await PositionHistory.find({ positionId })
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();
    
    res.json({
      success: true,
      data: history,
      count: history.length,
    });
    
  } catch (error) {
    next(error);
  }
};

/**
 * Get liquidation price
 */
export const getLiquidationPrice = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
      return;
    }
    
    const { positionId } = req.params;
    
    const position = positionManagementService.getPosition(positionId);
    
    if (!position || position.userId !== userId) {
      res.status(404).json({
        success: false,
        message: 'Position not found',
      });
      return;
    }
    
    const marginCalc = marginCalculationService.calculatePositionMargin(position);
    
    res.json({
      success: true,
      data: {
        positionId: position.positionId,
        symbol: position.symbol,
        side: position.side,
        entryPrice: position.entryPrice,
        markPrice: position.markPrice,
        liquidationPrice: marginCalc.liquidationPrice,
        bankruptcyPrice: marginCalc.bankruptcyPrice,
        marginRatio: marginCalc.marginRatio,
        maintenanceMargin: marginCalc.maintenanceMargin,
        distanceToLiquidation: Math.abs(
          (position.markPrice - marginCalc.liquidationPrice) / position.markPrice * 100
        ),
      },
    });
    
  } catch (error) {
    next(error);
  }
};