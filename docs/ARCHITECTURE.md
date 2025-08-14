# Architecture Documentation

## System Overview

The Crypto Trading Platform backend is built with a microservices-oriented architecture using Node.js, Express, MongoDB, and Socket.IO. The system is designed for high availability, scalability, and real-time performance.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                          Load Balancer                          │
└─────────────────────────────────────────────────────────────────┘
                                  │
                ┌─────────────────┴─────────────────┐
                │                                   │
        ┌───────▼───────┐                   ┌──────▼──────┐
        │   API Server  │                   │  WebSocket  │
        │   (Express)   │                   │   Server    │
        │               │                   │ (Socket.IO) │
        └───────┬───────┘                   └──────┬──────┘
                │                                   │
        ┌───────┴──────────────────────────────────┴───────┐
        │                                                   │
        │              Service Layer                       │
        │  ┌─────────────────────────────────────────┐    │
        │  │ • Auth Service    • Order Service      │    │
        │  │ • Market Service  • Position Service   │    │
        │  │ • Wallet Service  • Liquidation Engine │    │
        │  │ • Price Feed      • Risk Management    │    │
        │  └─────────────────────────────────────────┘    │
        │                                                   │
        └───────┬──────────────────────────────────┬───────┘
                │                                  │
        ┌───────▼───────┐                  ┌──────▼──────┐
        │    MongoDB    │                  │    Redis    │
        │   (Primary)   │                  │   (Cache)   │
        └───────────────┘                  └─────────────┘
```

## Core Components

### 1. API Server (Express)

The main HTTP server handling REST API requests.

**Key Features:**
- Request routing and middleware pipeline
- Authentication and authorization
- Input validation and sanitization
- Rate limiting
- Error handling
- Response formatting

**Middleware Stack:**
```javascript
app.use(helmet())           // Security headers
app.use(cors())            // CORS handling
app.use(compression())     // Response compression
app.use(express.json())    // JSON parsing
app.use(mongoSanitize())   // MongoDB injection prevention
app.use(rateLimiter())     // Rate limiting
app.use(authentication())  // JWT verification
app.use(authorization())   // Role-based access
app.use(validation())      // Request validation
```

### 2. WebSocket Server (Socket.IO)

Real-time bidirectional communication server.

**Namespaces:**
- `/prices` - Public price feeds
- `/user` - Authenticated user streams
- `/admin` - Administrative monitoring
- `/market` - Market data streams

**Event Flow:**
```
Client → Connect → Authenticate → Subscribe → Receive Updates
                                      ↓
                                 Unsubscribe → Disconnect
```

### 3. Service Layer

Business logic implementation following Domain-Driven Design.

#### Auth Service
- User registration and login
- JWT token generation and validation
- Password hashing and verification
- Session management
- Role-based permissions

#### Order Service
- Order creation and validation
- Order matching simulation
- Order status management
- Order history tracking
- Batch order processing

#### Position Service
- Position opening and closing
- P&L calculations
- Margin requirements
- Position updates
- Risk assessment

#### Market Service
- Market data aggregation
- Order book management
- Trade history
- Market statistics
- Price ticker updates

#### Wallet Service
- Balance management
- Transaction processing
- Currency conversions
- Transaction history
- Balance locking/unlocking

#### Liquidation Engine
- Continuous position monitoring
- Margin level calculations
- Liquidation triggers
- Insurance fund management
- Liquidation execution

#### Price Feed Service
- Multi-exchange data aggregation
- Price normalization
- Feed reliability monitoring
- Fallback mechanisms
- Data caching

### 4. Data Layer

#### MongoDB (Primary Database)

**Collections:**
- `users` - User accounts and profiles
- `orders` - Trading orders
- `positions` - Open positions
- `trades` - Executed trades
- `markets` - Market configurations
- `wallets` - User wallets
- `priceticks` - Price history
- `liquidations` - Liquidation history
- `auditlogs` - System audit trail

**Indexing Strategy:**
```javascript
// Compound indexes for common queries
orders.createIndex({ userId: 1, status: 1, createdAt: -1 })
positions.createIndex({ userId: 1, status: 1 })
trades.createIndex({ symbol: 1, timestamp: -1 })
priceticks.createIndex({ symbol: 1, timestamp: -1 })

// TTL indexes for data expiration
priceticks.createIndex({ timestamp: 1 }, { expireAfterSeconds: 86400 })
sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
```

#### Redis (Cache Layer)

**Use Cases:**
- Session storage
- Rate limiting counters
- WebSocket adapter for scaling
- Market data caching
- Hot data caching
- Pub/Sub messaging

**Key Patterns:**
```
user:session:{userId} - User sessions
rate:limit:{ip} - Rate limit counters
cache:market:{symbol} - Market data cache
cache:orderbook:{symbol} - Order book cache
ws:room:{roomId} - WebSocket room data
```

## Data Flow Patterns

### 1. Order Execution Flow

```
Client Request
     ↓
Validation Layer
     ↓
Auth Check
     ↓
Balance Check
     ↓
Risk Check
     ↓
Order Creation
     ↓
Position Update
     ↓
Balance Update
     ↓
Event Broadcasting
     ↓
Response
```

### 2. Price Update Flow

```
Exchange APIs
     ↓
Price Aggregator
     ↓
Validation & Normalization
     ↓
Database Storage
     ↓
Cache Update
     ↓
WebSocket Broadcast
     ↓
Position Mark-to-Market
     ↓
Liquidation Check
```

### 3. Liquidation Flow

```
Price Update
     ↓
Position Scan
     ↓
Margin Calculation
     ↓
Liquidation Trigger
     ↓
Order Creation
     ↓
Position Closure
     ↓
Fee Collection
     ↓
Insurance Fund Update
     ↓
Event Notification
```

## Security Architecture

### Authentication & Authorization

```
Request → JWT Validation → User Context → Role Check → Resource Access
                ↓                              ↓
            Invalid Token                 Insufficient Permissions
                ↓                              ↓
            401 Response                  403 Response
```

### Defense Layers

1. **Network Level**
   - Rate limiting
   - DDoS protection
   - IP whitelisting (admin)

2. **Application Level**
   - Input validation
   - SQL/NoSQL injection prevention
   - XSS protection
   - CSRF tokens

3. **Data Level**
   - Encryption at rest
   - Encryption in transit
   - Field-level encryption for sensitive data

## Scalability Design

### Horizontal Scaling

```
                Load Balancer
                     ↓
    ┌────────┬────────┬────────┐
    │ Node 1 │ Node 2 │ Node N │
    └────────┴────────┴────────┘
              ↓
         Redis Cluster
              ↓
       MongoDB Replica Set
```

### Caching Strategy

**Multi-Level Cache:**
1. **Application Cache** - In-memory cache for hot data
2. **Redis Cache** - Distributed cache for shared data
3. **CDN Cache** - Static assets and public data

**Cache Invalidation:**
- TTL-based expiration
- Event-based invalidation
- Cache warming on startup

### Database Scaling

**Read Scaling:**
- MongoDB replica sets
- Read preference routing
- Query optimization

**Write Scaling:**
- Sharding by userId
- Bulk write operations
- Async write queues

## Performance Optimizations

### Database Optimizations

1. **Query Optimization**
   - Proper indexing
   - Query projection
   - Aggregation pipelines
   - Lean queries

2. **Connection Pooling**
   ```javascript
   mongoose.connect(uri, {
     maxPoolSize: 10,
     minPoolSize: 2,
     serverSelectionTimeoutMS: 5000
   })
   ```

3. **Batch Operations**
   - Bulk writes
   - Aggregated updates
   - Transaction batching

### API Optimizations

1. **Response Compression**
   - Gzip compression
   - Minimal JSON responses
   - Field filtering

2. **Pagination**
   - Cursor-based pagination
   - Limit/offset optimization
   - Result caching

3. **Async Processing**
   - Job queues for heavy operations
   - Event-driven architecture
   - Non-blocking I/O

### WebSocket Optimizations

1. **Connection Management**
   - Connection pooling
   - Heartbeat mechanism
   - Automatic reconnection

2. **Message Optimization**
   - Binary protocols
   - Message compression
   - Batch updates

3. **Subscription Management**
   - Room-based broadcasting
   - Selective updates
   - Rate limiting per connection

## Monitoring & Observability

### Metrics Collection

```
Application Metrics
     ↓
Prometheus Exporter
     ↓
Prometheus Server
     ↓
Grafana Dashboard
```

**Key Metrics:**
- API response times
- WebSocket connections
- Database query performance
- Cache hit rates
- Error rates
- Business metrics

### Logging Architecture

```
Application Logs → Winston → Log Files → Log Aggregator → Analysis
                      ↓
                 Console Output (Dev)
```

**Log Levels:**
- `error` - System errors
- `warn` - Warning conditions
- `info` - Informational messages
- `debug` - Debug information

### Health Monitoring

**Health Checks:**
- Liveness probe - Is the service alive?
- Readiness probe - Can it handle requests?
- Dependency checks - Are dependencies healthy?

## Disaster Recovery

### Backup Strategy

1. **Database Backups**
   - Daily automated backups
   - Point-in-time recovery
   - Cross-region replication

2. **Configuration Backups**
   - Version controlled configs
   - Environment snapshots
   - Secret management

### Failover Mechanisms

1. **Service Failover**
   - Health check monitoring
   - Automatic restart
   - Circuit breakers

2. **Database Failover**
   - Replica set automatic failover
   - Read replica promotion
   - Connection retry logic

## Development Practices

### Code Organization

```
src/
├── controllers/    # Request handlers
├── services/      # Business logic
├── models/        # Data models
├── middleware/    # Express middleware
├── utils/         # Utility functions
├── types/         # TypeScript types
├── validators/    # Input validation
└── config/        # Configuration
```

### Design Patterns

1. **Repository Pattern** - Data access abstraction
2. **Service Layer** - Business logic encapsulation
3. **Factory Pattern** - Object creation
4. **Observer Pattern** - Event-driven updates
5. **Singleton Pattern** - Service instances

### Testing Strategy

```
Unit Tests → Integration Tests → E2E Tests → Performance Tests
    ↓              ↓                ↓              ↓
  80% Coverage   API Tests     User Flows    Load Testing
```

## Future Enhancements

### Planned Improvements

1. **Microservices Migration**
   - Service decomposition
   - Independent deployments
   - Service mesh implementation

2. **Event Sourcing**
   - Event store implementation
   - CQRS pattern
   - Event replay capability

3. **GraphQL API**
   - GraphQL gateway
   - Schema federation
   - Real-time subscriptions

4. **Machine Learning**
   - Price prediction
   - Risk scoring
   - Fraud detection

5. **Blockchain Integration**
   - On-chain settlement
   - Smart contracts
   - Decentralized order book