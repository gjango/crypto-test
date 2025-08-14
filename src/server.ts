import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import createApp from './app';
import { config } from './config/environment';
import { connectDatabase } from './config/database';
import { createLogger } from './utils/logger';
import { 
  handleUncaughtExceptions, 
  handleUnhandledRejections, 
  gracefulShutdown 
} from './middleware/errorHandler';

const logger = createLogger('Server');

const startServer = async (): Promise<void> => {
  try {
    handleUncaughtExceptions();
    handleUnhandledRejections();

    await connectDatabase();
    logger.info('Database connected successfully');

    const app = createApp();
    const server = createServer(app);

    const io = new SocketIOServer(server, {
      cors: {
        origin: config.security.corsOrigin.split(',').map(o => o.trim()),
        credentials: true,
      },
      transports: ['websocket', 'polling'],
      pingTimeout: config.websocket.heartbeatInterval,
      pingInterval: config.websocket.heartbeatInterval / 2,
    });

    io.on('connection', (socket) => {
      logger.info(`WebSocket client connected: ${socket.id}`);
      
      socket.on('disconnect', (reason) => {
        logger.info(`WebSocket client disconnected: ${socket.id}, reason: ${reason}`);
      });
    });

    (global as any).io = io;

    server.listen(config.port, () => {
      logger.info(`
        ============================================
        🚀 Server is running in ${config.env} mode
        🔗 API: http://${config.host}:${config.port}/api
        🔗 Health: http://${config.host}:${config.port}/api/health
        🔗 WebSocket: ws://${config.host}:${config.port}
        ============================================
      `);
    });

    gracefulShutdown(server);
  } catch (error) {
    logger.error('Failed to start server', error as Error);
    process.exit(1);
  }
};

startServer();