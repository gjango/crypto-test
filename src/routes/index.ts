import { Router } from 'express';
import healthRoutes from './health.routes';

const router = Router();

router.use('/', healthRoutes);

router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Crypto Trading Simulator API',
    version: '1.0.0',
    documentation: '/api/docs',
    health: '/health',
  });
});

export default router;