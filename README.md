# Crypto Trading Platform - Backend

A production-ready backend for a cryptocurrency trading platform with real-time market data, margin trading, and comprehensive risk management.

## 🚀 Features

### Core Trading Features
- **Spot & Margin Trading** - Support for both spot and leveraged trading up to 125x
- **Real-time Market Data** - WebSocket-based price feeds and order book updates
- **Advanced Order Types** - Market, Limit, Stop-Loss, Take-Profit, and Trailing Stop orders
- **Position Management** - Automatic position tracking with P&L calculations
- **Risk Management** - Real-time margin monitoring and automatic liquidations
- **Wallet System** - Multi-currency wallet with automatic balance updates
- **Price Feeds** - Integration with multiple exchanges (Binance, Coinbase, Kraken)
- **Insurance Fund** - Liquidation protection mechanism

### Technical Features
- **WebSocket Support** - Real-time data streaming with Socket.IO
- **JWT Authentication** - Secure token-based authentication with RS256
- **Role-Based Access Control** - Granular permissions system
- **Rate Limiting** - API and WebSocket rate limiting
- **Database Optimization** - Indexed MongoDB collections with connection pooling
- **Horizontal Scaling** - Redis-based session and WebSocket adapter
- **Comprehensive Logging** - Structured logging with Winston
- **API Documentation** - Auto-generated Swagger documentation
- **Health Monitoring** - Liveness and readiness probes

## 📋 Prerequisites

- Node.js >= 18.0.0
- MongoDB >= 6.0
- Redis >= 6.0 (optional for development, required for production)
- npm >= 9.0.0

## 🛠️ Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd backend
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. **Start MongoDB**
```bash
# Using Docker
docker run -d -p 27017:27017 --name mongodb mongo:latest

# Or using local MongoDB
mongod --dbpath /path/to/data
```

5. **Start Redis (optional for development)**
```bash
# Using Docker
docker run -d -p 6379:6379 --name redis redis:latest

# Or using local Redis
redis-server
```

## 🚦 Running the Application

### Development Mode
```bash
# Standard development mode
npm run dev

# Fast development mode (skips type checking)
npm run dev:fast
```

### Production Mode
```bash
# Build the application
npm run build

# Start production server
npm run start:prod
```

### Testing
```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run WebSocket tests
npm run test:ws

# Run integration tests
npm run test:integration

# Run WebSocket performance tests
npm run test:ws:performance
```

## 📁 Project Structure

```
backend/
├── src/
│   ├── config/           # Configuration files
│   │   ├── database.ts   # Database connection
│   │   ├── environment.ts # Environment variables
│   │   ├── redis.ts      # Redis configuration
│   │   └── rbac.ts       # Role-based access control
│   ├── controllers/      # Route controllers
│   │   ├── auth.controller.ts
│   │   ├── market.controller.ts
│   │   ├── order.controller.ts
│   │   ├── position.controller.ts
│   │   ├── wallet.controller.ts
│   │   └── admin/        # Admin controllers
│   ├── middleware/       # Express middleware
│   │   ├── auth.ts       # Authentication middleware
│   │   ├── rateLimiter.ts # Rate limiting
│   │   ├── validation.ts # Request validation
│   │   └── errorHandler.ts # Error handling
│   ├── models/          # Mongoose models
│   │   ├── User.model.ts
│   │   ├── Order.model.ts
│   │   ├── Position.model.ts
│   │   ├── Market.model.ts
│   │   ├── Wallet.model.ts
│   │   └── Trade.model.ts
│   ├── routes/          # API routes
│   │   ├── auth.routes.ts
│   │   ├── market.routes.ts
│   │   ├── order.routes.ts
│   │   ├── position.routes.ts
│   │   ├── wallet.routes.ts
│   │   └── admin.routes.ts
│   ├── services/        # Business logic
│   │   ├── auth.service.ts
│   │   ├── order.service.ts
│   │   ├── position.service.ts
│   │   ├── liquidation.service.ts
│   │   ├── margin.service.ts
│   │   ├── priceFeed.service.ts
│   │   └── websocketBroadcast.service.ts
│   ├── types/           # TypeScript types
│   │   ├── order.ts
│   │   ├── position.ts
│   │   ├── market.ts
│   │   ├── margin.ts
│   │   └── priceFeed.ts
│   ├── utils/           # Utility functions
│   │   ├── logger.ts     # Winston logger
│   │   ├── cache.ts      # Caching utilities
│   │   ├── calculations.ts # Trading calculations
│   │   └── database.ts   # Database utilities
│   ├── websocket/       # WebSocket implementation
│   │   ├── WebSocketServer.ts
│   │   ├── config.ts     # WebSocket configuration
│   │   ├── namespaces/   # Socket.IO namespaces
│   │   │   ├── PriceNamespace.ts
│   │   │   ├── UserNamespace.ts
│   │   │   ├── AdminNamespace.ts
│   │   │   └── MarketNamespace.ts
│   │   ├── middleware/   # WebSocket middleware
│   │   │   ├── AuthMiddleware.ts
│   │   │   └── RateLimitMiddleware.ts
│   │   ├── client/       # Client SDK
│   │   │   └── TradingClient.ts
│   │   └── examples/     # Usage examples
│   ├── validators/      # Zod validation schemas
│   ├── jobs/            # Cron jobs
│   ├── app.ts           # Express app setup
│   └── server.ts        # Server entry point
├── tests/               # Test files
├── scripts/             # Utility scripts
├── docs/                # Documentation
├── logs/                # Application logs
└── package.json
```

## 🔌 WebSocket System

The platform uses Socket.IO for real-time communication with four namespaces:

### Namespaces

1. **`/prices`** - Public price feeds (no auth required)
   - Real-time price updates
   - Trade streams
   - Market tickers

2. **`/user`** - User-specific updates (auth required)
   - Order updates
   - Position changes
   - Wallet balance updates
   - Margin calls

3. **`/admin`** - Admin monitoring (admin auth required)
   - System metrics
   - User activity
   - Performance stats

4. **`/market`** - Market data (no auth required)
   - Order book depth
   - Market statistics
   - Recent trades

### Client Connection Example

```javascript
import { TradingClient } from './websocket/client/TradingClient';

const client = new TradingClient({
  url: 'http://localhost:3000',
  token: 'your-jwt-token' // Required for authenticated namespaces
});

// Subscribe to price updates
await client.subscribePrices(['BTC/USDT', 'ETH/USDT']);

// Listen for updates
client.on('price:BTC/USDT', (data) => {
  console.log('BTC Price:', data.price);
});

// Subscribe to user streams
await client.subscribeUserStreams(['orders', 'positions', 'wallet']);

// Listen for order updates
client.on('order:update', (order) => {
  console.log('Order updated:', order);
});
```

### WebSocket Tools

```bash
# Run example client
npm run ws:example

# Run stress test (100 clients, 60 seconds)
NUM_CLIENTS=100 TEST_DURATION=60 npm run ws:stress

# Run admin dashboard
ADMIN_TOKEN=your-admin-jwt npm run ws:admin
```

## 🔑 API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Refresh JWT token
- `POST /api/auth/logout` - Logout user
- `GET /api/auth/profile` - Get user profile
- `PUT /api/auth/profile` - Update profile

### Trading
- `GET /api/orders` - Get user orders
- `POST /api/orders` - Create new order
- `GET /api/orders/:id` - Get order details
- `PUT /api/orders/:id` - Update order
- `DELETE /api/orders/:id` - Cancel order
- `GET /api/orders/history` - Order history

### Positions
- `GET /api/positions` - Get open positions
- `GET /api/positions/:id` - Get position details
- `POST /api/positions/:id/close` - Close position
- `PUT /api/positions/:id/margin` - Add/remove margin
- `PUT /api/positions/:id/tp-sl` - Update TP/SL

### Market Data
- `GET /api/markets` - List all markets
- `GET /api/markets/:symbol` - Get market details
- `GET /api/markets/:symbol/ticker` - Get ticker data
- `GET /api/markets/:symbol/orderbook` - Get order book
- `GET /api/markets/:symbol/trades` - Get recent trades
- `GET /api/markets/:symbol/klines` - Get candlestick data

### Wallet
- `GET /api/wallet` - Get wallet balances
- `GET /api/wallet/:currency` - Get specific currency balance
- `POST /api/wallet/transfer` - Internal transfer
- `GET /api/wallet/history` - Transaction history

### Admin Endpoints
- `GET /api/admin/users` - List users
- `GET /api/admin/stats` - System statistics
- `POST /api/admin/market/:symbol` - Update market settings
- `PUT /api/admin/risk-params` - Update risk parameters
- `GET /api/admin/audit-logs` - View audit logs

### Health & Monitoring
- `GET /api/health` - Basic health check
- `GET /api/health/live` - Liveness probe
- `GET /api/health/ready` - Readiness probe
- `GET /api/metrics` - Prometheus metrics

## 🔒 Security Features

- **JWT Authentication** with RS256 signing
- **Refresh Tokens** for session management
- **Password Hashing** using bcrypt
- **Rate Limiting** on all endpoints
- **Input Validation** with express-validator and Zod
- **MongoDB Injection Prevention** with express-mongo-sanitize
- **XSS Protection** with helmet
- **CORS Configuration** for cross-origin requests
- **Request Size Limits** to prevent DoS
- **Session Management** with secure cookies
- **API Key Authentication** for external services

## 📊 Performance Optimizations

- **Database Indexing** on frequently queried fields
- **Connection Pooling** for MongoDB
- **Redis Caching** for market data
- **Query Optimization** with lean() and select()
- **Pagination** on list endpoints
- **WebSocket Rate Limiting** per namespace
- **Subscription Limits** to prevent abuse
- **Request Compression** with gzip
- **Batch Processing** for bulk operations

## 🧪 Testing

The project includes comprehensive testing:

```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# WebSocket tests
npm run test:ws

# WebSocket integration tests
npm run test:ws:integration

# Performance tests
npm run test:ws:performance

# Generate coverage report
npm run test:coverage
```

## 📝 Environment Variables

Create a `.env` file in the root directory:

```env
# Server Configuration
NODE_ENV=development
PORT=3000
HOST=localhost

# Database
MONGODB_URI=mongodb://localhost:27017/crypto-trading
DB_NAME=crypto-trading
DB_MAX_POOL_SIZE=10
DB_MIN_POOL_SIZE=2

# Redis (optional for development)
REDIS_URL=redis://localhost:6379
REDIS_PREFIX=crypto:

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=your-refresh-token-secret
JWT_REFRESH_EXPIRES_IN=30d

# For RS256 (production)
JWT_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----...
JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----...

# API Keys (for price feeds)
BINANCE_API_KEY=your-binance-api-key
BINANCE_API_SECRET=your-binance-api-secret
COINBASE_API_KEY=your-coinbase-api-key
KRAKEN_API_KEY=your-kraken-api-key

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# WebSocket Configuration
WS_PING_INTERVAL=25000
WS_PING_TIMEOUT=5000
WS_MAX_CONNECTIONS=10000
WS_RATE_LIMIT_POINTS=100
WS_RATE_LIMIT_DURATION=1

# Logging
LOG_LEVEL=debug
LOG_DIR=logs
LOG_MAX_SIZE=20m
LOG_MAX_FILES=14d

# CORS
CORS_ORIGIN=http://localhost:3001
CORS_CREDENTIALS=true

# Session
SESSION_SECRET=your-session-secret
SESSION_MAX_AGE=86400000

# Admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=changeme123

# Trading Parameters
DEFAULT_LEVERAGE=10
MAX_LEVERAGE=125
LIQUIDATION_FEE=0.005
TAKER_FEE=0.0004
MAKER_FEE=0.0002
```

## 🚀 Deployment

### Using Docker

```bash
# Build Docker image
docker build -t crypto-backend .

# Run with Docker Compose
docker-compose up -d
```

### Docker Compose Configuration

```yaml
version: '3.8'
services:
  backend:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - MONGODB_URI=mongodb://mongo:27017/crypto
      - REDIS_URL=redis://redis:6379
    depends_on:
      - mongo
      - redis
  
  mongo:
    image: mongo:6.0
    volumes:
      - mongo-data:/data/db
    ports:
      - "27017:27017"
  
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  mongo-data:
```

### Manual Deployment

1. Build the application:
```bash
npm run build
```

2. Set production environment variables

3. Start the server:
```bash
NODE_ENV=production npm start
```

### Process Management with PM2

```bash
# Install PM2
npm install -g pm2

# Start application
pm2 start ecosystem.config.js

# View logs
pm2 logs crypto-backend

# Monitor
pm2 monit

# Setup startup script
pm2 startup
pm2 save
```

### PM2 Configuration (ecosystem.config.js)

```javascript
module.exports = {
  apps: [{
    name: 'crypto-backend',
    script: './dist/server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    max_memory_restart: '1G'
  }]
};
```

## 📈 Monitoring

### Health Checks
- `GET /api/health` - Basic health check
- `GET /api/health/live` - Kubernetes liveness probe
- `GET /api/health/ready` - Kubernetes readiness probe

### Metrics
- `GET /api/metrics` - Prometheus-compatible metrics
- WebSocket metrics available via admin namespace
- Custom metrics for trading operations

### Logging
- Application logs in `logs/` directory
- Structured JSON logging with Winston
- Daily log rotation enabled
- Log levels: error, warn, info, debug

### Monitoring Stack

```bash
# Prometheus configuration
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'crypto-backend'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/api/metrics'
```

## 🛠️ Development Tools

### Scripts

```bash
# Seed database with sample data
npm run seed

# Run database migrations
npm run migrate

# Validate environment variables
npm run validate:env

# Format code
npm run format

# Lint code
npm run lint
npm run lint:fix

# Type checking
npm run typecheck
```

### Debugging

1. **VS Code Debug Configuration**

Create `.vscode/launch.json`:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Backend",
      "runtimeArgs": ["-r", "ts-node/register"],
      "args": ["${workspaceFolder}/src/server.ts"],
      "env": {
        "NODE_ENV": "development",
        "DEBUG": "*"
      },
      "console": "integratedTerminal"
    }
  ]
}
```

2. **Enable Debug Logs**
```bash
DEBUG=* npm run dev
```

## 🔧 Troubleshooting

### Common Issues

1. **MongoDB Connection Failed**
   - Ensure MongoDB is running
   - Check connection string in `.env`
   - Verify network connectivity

2. **Redis Connection Failed**
   - Redis is optional for development
   - WebSocket will run in single-instance mode
   - For production, ensure Redis is running

3. **Port Already in Use**
   - Change PORT in `.env`
   - Kill existing process: `lsof -i :3000`

4. **TypeScript Compilation Errors**
   - Run `npm run dev:fast` to skip type checking
   - Fix types with `npm run typecheck`

5. **WebSocket Connection Issues**
   - Check CORS settings
   - Verify JWT token for authenticated namespaces
   - Check rate limiting settings

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Style

- Follow TypeScript best practices
- Use ESLint and Prettier configurations
- Write unit tests for new features
- Update documentation as needed
- Follow conventional commits

### Development Workflow

1. **Before committing:**
```bash
npm run lint:fix
npm run format
npm run typecheck
npm test
```

2. **Commit message format:**
```
type(scope): description

[optional body]

[optional footer]
```

Types: feat, fix, docs, style, refactor, test, chore

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For issues and questions:
- Check this README first
- Review [API Documentation](docs/API.md)
- Check [Architecture Guide](docs/ARCHITECTURE.md)
- Open an issue on GitHub

## 🙏 Acknowledgments

- Built with Express.js and TypeScript
- Real-time features powered by Socket.IO
- Database management with MongoDB and Mongoose
- Caching with Redis
- Authentication using JWT
- Price feeds from major exchanges