import { createServer } from 'http';
import createApp from './app';
import { config } from './config/environment';
import { connectDatabase } from './config/database';
import { createLogger } from './utils/logger';
import { 
  handleUncaughtExceptions, 
  handleUnhandledRejections, 
  gracefulShutdown 
} from './middleware/errorHandler';
import WebSocketServer from './websocket/WebSocketServer';

const logger = createLogger('Server');

const startServer = async (): Promise<void> => {
  try {
    handleUncaughtExceptions();
    handleUnhandledRejections();

    await connectDatabase();
    logger.info('Database connected successfully');

    const app = createApp();
    const server = createServer(app);

    // Initialize WebSocket server
    const wsServer = WebSocketServer.getInstance();
    await wsServer.initialize(server);
    
    // Make WebSocket server globally accessible
    (global as any).wsServer = wsServer;

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