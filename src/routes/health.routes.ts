import { Router, Request, Response } from 'express';
import { getDatabaseHealth } from '../config/database';
import { config } from '../config/environment';
import os from 'os';

const router = Router();

interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  environment: string;
  version: string;
  services: {
    database: {
      status: 'connected' | 'disconnected' | 'error';
      details?: any;
    };
    redis?: {
      status: 'connected' | 'disconnected' | 'error';
      details?: any;
    };
  };
  system?: {
    memory: {
      total: number;
      free: number;
      used: number;
      percentage: number;
    };
    cpu: {
      loadAverage: number[];
      cores: number;
    };
  };
}

router.get('/health', async (req: Request, res: Response) => {
  try {
    const dbHealth = getDatabaseHealth();
    const isHealthy = dbHealth.isConnected;
    
    const healthCheck: HealthCheckResponse = {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: config.env,
      version: process.env['npm_package_version'] ?? '1.0.0',
      services: {
        database: {
          status: dbHealth.isConnected ? 'connected' : 'disconnected',
          details: config.env === 'development' ? dbHealth : undefined,
        },
      },
    };

    if (config.env === 'development') {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      
      healthCheck.system = {
        memory: {
          total: totalMem,
          free: freeMem,
          used: usedMem,
          percentage: (usedMem / totalMem) * 100,
        },
        cpu: {
          loadAverage: os.loadavg(),
          cores: os.cpus().length,
        },
      };
    }

    const statusCode = isHealthy ? 200 : 503;
    res.status(statusCode).json(healthCheck);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: config.env === 'development' ? (error as Error).message : 'Health check failed',
    });
  }
});

router.get('/health/live', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
  });
});

router.get('/health/ready', async (req: Request, res: Response): Promise<void> => {
  try {
    const dbHealth = getDatabaseHealth();
    
    if (!dbHealth.isConnected) {
      res.status(503).json({
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        reason: 'Database not connected',
      });
      return;
    }

    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      error: config.env === 'development' ? (error as Error).message : 'Readiness check failed',
    });
  }
});

export default router;