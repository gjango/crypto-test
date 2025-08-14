# Crypto Trading Simulator Backend

Production-ready Node.js/TypeScript backend for a cryptocurrency trading simulator with real-time market data and comprehensive trading features.

## Features

- ✅ Real-time price feeds from multiple exchanges (Binance, Coinbase, Kraken)
- ✅ Support for 300+ USDT-quoted crypto pairs
- ✅ Complete margin trading with cross/isolated modes
- ✅ Liquidation engine with configurable parameters
- ✅ Admin controls for all system parameters
- ✅ WebSocket support for real-time updates
- ✅ Comprehensive security middleware
- ✅ Structured logging with Winston
- ✅ MongoDB with connection pooling and retry logic
- ✅ Health check endpoints with dependency monitoring
- ✅ Rate limiting and request validation
- ✅ TypeScript with strict configuration

## Tech Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript 5.3+
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Real-time**: Socket.IO
- **Security**: Helmet, CORS, Rate Limiting
- **Logging**: Winston with daily rotation
- **Testing**: Jest with coverage
- **Process Management**: PM2 (production)

## Directory Structure

```
/backend
  /src
    /config         # Environment and app configuration
    /models         # Mongoose schemas
    /controllers    # Request handlers
    /services       # Business logic
    /middleware     # Express middleware
    /utils          # Helper functions
    /types          # TypeScript definitions
    /routes         # API route definitions
    /websocket      # WebSocket handlers
    /jobs           # Cron job definitions
    /validators     # Zod schemas
  /tests           # Test files
  /scripts         # Build and deployment scripts
```

## Getting Started

### Prerequisites

- Node.js 18+ and npm 9+
- MongoDB 6.0+
- Redis (optional, for caching)

### Installation

1. Clone the repository
2. Navigate to the backend directory
3. Copy the environment file:
   ```bash
   cp .env.example .env
   ```
4. Update the `.env` file with your configuration
5. Install dependencies:
   ```bash
   npm install
   ```

### Development

Run the development server with hot-reload:
```bash
npm run dev
```

### Production Build

Build the TypeScript code:
```bash
npm run build
```

Start the production server:
```bash
npm run start:prod
```

## Available Scripts

- `npm run dev` - Start development server with nodemon
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server
- `npm test` - Run tests with coverage
- `npm run test:watch` - Run tests in watch mode
- `npm run lint` - Check code with ESLint
- `npm run lint:fix` - Fix ESLint issues
- `npm run format` - Format code with Prettier
- `npm run typecheck` - Check TypeScript types
- `npm run validate:env` - Validate environment configuration

## API Endpoints

### Health Checks

- `GET /api/health` - Comprehensive health check
- `GET /api/health/live` - Liveness probe
- `GET /api/health/ready` - Readiness probe

## Environment Variables

Key environment variables (see `.env.example` for full list):

- `NODE_ENV` - Environment (development/staging/production)
- `PORT` - Server port (default: 3000)
- `MONGODB_URI` - MongoDB connection string
- `JWT_PRIVATE_KEY` - RS256 private key for JWT
- `JWT_PUBLIC_KEY` - RS256 public key for JWT
- `RATE_LIMIT_MAX` - Max requests per window
- `LOG_LEVEL` - Logging level (debug/info/warn/error)

## Security Features

- Helmet.js for security headers
- CORS configuration with whitelisting
- Rate limiting (global and per-endpoint)
- MongoDB query sanitization
- Request size limits
- JWT authentication with RS256
- Session management
- XSS protection
- CSRF protection ready

## Performance Optimizations

- Connection pooling for MongoDB
- Request compression
- Caching layer support
- Batch processing capabilities
- Efficient error handling
- Graceful shutdown handling

## Monitoring

- Structured logging with context
- Health check endpoints
- Metrics endpoint (when enabled)
- Error tracking
- Performance monitoring hooks

## Testing

Run the test suite:
```bash
npm test
```

Run tests with coverage:
```bash
npm run test:coverage
```

## Deployment

The backend is ready for deployment to:
- AWS EC2/ECS/Lambda
- Google Cloud Run/GKE
- Azure App Service
- Heroku
- DigitalOcean App Platform
- Any VPS with Node.js support

## License

MIT