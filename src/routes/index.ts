import { Router } from 'express';
import healthRoutes from './health.routes';
import authRoutes from './auth.routes';
import adminRoutes from './admin.routes';

const router = Router();

// Health check routes
router.use('/', healthRoutes);

// Authentication routes
router.use('/auth', authRoutes);

// Admin routes
router.use('/admin', adminRoutes);

// API root endpoint
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Crypto Trading Simulator API',
    version: '1.0.0',
    documentation: '/api/docs',
    health: '/health',
    endpoints: {
      auth: '/api/auth',
      markets: '/api/markets',
      orders: '/api/orders',
      positions: '/api/positions',
      wallets: '/api/wallets',
      trades: '/api/trades',
      admin: '/api/admin',
    },
  });
});

export default router;