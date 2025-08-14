import express, { Application } from 'express';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { config } from './config/environment';
import { 
  helmetMiddleware, 
  corsMiddleware, 
  globalRateLimiter,
  mongoSanitizeMiddleware,
  securityHeaders,
  preventParameterPollution,
  requestSizeLimit
} from './middleware/security';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { morganStream } from './utils/logger';
import routes from './routes';

const createApp = (): Application => {
  const app = express();

  app.set('trust proxy', 1);

  app.use(helmetMiddleware);
  app.use(corsMiddleware);
  app.use(securityHeaders);
  app.use(compression());
  
  if (config.env !== 'test') {
    app.use(morgan(
      config.env === 'development' ? 'dev' : 'combined',
      { stream: morganStream }
    ));
  }

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());
  app.use(requestSizeLimit('10mb'));
  
  app.use(mongoSanitizeMiddleware);
  app.use(preventParameterPollution);
  
  app.use(globalRateLimiter);

  app.use('/api', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export default createApp;