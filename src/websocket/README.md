# WebSocket System Documentation

## Overview

The WebSocket system provides real-time bidirectional communication for the crypto trading platform. Built on Socket.IO with Redis adapter for horizontal scaling, it supports multiple namespaces for different data streams and includes authentication, rate limiting, and comprehensive metrics.

## Architecture

### Namespaces

1. **`/prices`** - Public price feeds
   - Real-time price updates
   - Trade streams
   - No authentication required

2. **`/user`** - Authenticated user streams
   - Order updates
   - Position updates
   - Wallet balance changes
   - Margin calls
   - Requires JWT authentication

3. **`/admin`** - Admin monitoring and control
   - System metrics
   - Connection management
   - Broadcast controls
   - Requires admin JWT

4. **`/market`** - Public market data
   - Market statistics
   - Order book depth
   - Recent trades
   - Market tickers

### Key Components

- **WebSocketServer** - Main server class managing Socket.IO instance
- **ConnectionManager** - Tracks and manages client connections
- **SubscriptionManager** - Handles channel subscriptions with limits
- **AuthMiddleware** - JWT authentication for protected namespaces
- **RateLimitMiddleware** - Rate limiting per namespace
- **WebSocketMetrics** - Performance metrics and monitoring

## Quick Start

### Server Setup

```typescript
import WebSocketServer from './websocket/WebSocketServer';
import { createServer } from 'http';

const httpServer = createServer(app);
const wsServer = WebSocketServer.getInstance();
await wsServer.initialize(httpServer);
```

### Client Usage

```typescript
import { TradingClient } from './websocket/client/TradingClient';

const client = new TradingClient({
  url: 'http://localhost:3000',
  token: 'your-jwt-token', // Optional for authenticated endpoints
});

// Subscribe to price updates
await client.subscribePrices(['BTC/USDT', 'ETH/USDT']);

// Listen for updates
client.on('price:BTC/USDT', (data) => {
  console.log('BTC Price:', data.price);
});
```

## Authentication

Protected namespaces (`/user`, `/admin`) require JWT authentication:

```typescript
const client = new TradingClient({
  url: 'http://localhost:3000',
  token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
});
```

The token is validated on connection and must contain:
- `userId` - User identifier
- `role` - User role (admin required for `/admin` namespace)

## Event Types

### Price Namespace Events

**Client → Server:**
- `subscribe` - Subscribe to price feeds
- `unsubscribe` - Unsubscribe from feeds
- `ping` - Connection health check

**Server → Client:**
- `price.update` - Price tick update
- `price.trade` - New trade executed
- `connection.authenticated` - Connection confirmed
- `subscription.confirmed` - Subscription success

### User Namespace Events

**Server → Client:**
- `order.new` - New order created
- `order.update` - Order status changed
- `order.filled` - Order execution
- `order.cancelled` - Order cancelled
- `position.update` - Position changed
- `position.liquidated` - Position liquidated
- `wallet.update` - Balance changed
- `margin.call` - Margin call alert

### Market Namespace Events

**Client → Server:**
- `subscribe` - Subscribe to market channels
- `unsubscribe` - Unsubscribe from channels

**Server → Client:**
- `market.stats` - Market statistics update
- `market.depth` - Order book update
- `market.trades` - Recent trades
- `market.ticker` - Ticker updates

### Admin Namespace Events

**Client → Server:**
- `admin.command` - Execute admin command
- `admin.metrics` - Request metrics
- `admin.broadcast` - Send system broadcast

**Server → Client:**
- `admin.stats` - Server statistics
- `admin.alert` - System alerts
- `admin.metrics` - Detailed metrics

## Room Structure

Rooms are used to efficiently broadcast to specific groups:

- `prices:{symbol}` - Price updates for specific symbol
- `user:{userId}` - User-specific updates
- `orders:{userId}` - Order updates
- `positions:{userId}` - Position updates
- `wallet:{userId}` - Wallet updates
- `market:stats:{symbol}` - Market statistics
- `market:depth:{symbol}` - Order book depth
- `market:trades:{symbol}` - Trade stream

## Rate Limiting

Each namespace has configurable rate limits:

```typescript
// Default limits
const RATE_LIMITS = {
  prices: { points: 100, duration: 1, blockDuration: 60 },
  user: { points: 50, duration: 1, blockDuration: 60 },
  admin: { points: 200, duration: 1, blockDuration: 60 },
  market: { points: 100, duration: 1, blockDuration: 60 }
};
```

## Subscription Limits

To prevent abuse:
- Max symbols per connection: 100
- Max channels per user: 50
- Max rooms per namespace: 20

## Broadcasting

### From Services

```typescript
import websocketBroadcast from './services/websocketBroadcast.service';

// Broadcast price update
websocketBroadcast.broadcastPriceUpdate('BTC/USDT', {
  price: 50000,
  bid: 49999,
  ask: 50001,
  volume: 1234567,
  timestamp: Date.now()
});

// Broadcast to specific user
websocketBroadcast.broadcastOrderUpdate(userId, order);
```

### Direct Broadcasting

```typescript
const wsServer = WebSocketServer.getInstance();

// Broadcast to all
wsServer.broadcastSystemMessage({
  type: 'info',
  message: 'System maintenance in 5 minutes'
});

// Broadcast to namespace
wsServer.broadcastPriceUpdate('BTC/USDT', priceData);
```

## Metrics

Access real-time metrics:

```typescript
const metrics = wsServer.getMetrics();
console.log(metrics);
// {
//   connections: { current: 1250, total: 5000 },
//   messages: { total: 1000000, perSecond: 500 },
//   latency: { avg: 12, p50: 10, p95: 25, p99: 50 },
//   namespaces: { ... },
//   errors: { total: 5, rate: 0.0005 }
// }
```

Export Prometheus metrics:

```typescript
app.get('/metrics', (req, res) => {
  const prometheusMetrics = wsServer.exportPrometheusMetrics();
  res.type('text/plain').send(prometheusMetrics);
});
```

## Examples

### 1. Basic Client Example

```bash
npm run ws:example
```

Demonstrates:
- Connection setup
- Subscribing to channels
- Handling events
- Error handling

### 2. Stress Testing

```bash
# Test with 100 clients for 60 seconds
NUM_CLIENTS=100 TEST_DURATION=60 npm run ws:stress
```

Measures:
- Connection performance
- Message throughput
- Latency distribution
- Error rates

### 3. Admin Dashboard

```bash
ADMIN_TOKEN=your-admin-jwt npm run ws:admin
```

Features:
- Real-time metrics monitoring
- Connection management
- System broadcasts
- Maintenance mode control

## Performance Targets

- **Latency**: < 300ms message propagation
- **Connections**: 10,000+ concurrent
- **Throughput**: 100,000+ messages/second
- **Availability**: 99.9% uptime

## Scaling

### Horizontal Scaling with Redis

The system uses Redis adapter for multi-server deployment:

```typescript
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

const pubClient = createClient({ url: 'redis://localhost:6379' });
const subClient = pubClient.duplicate();

await pubClient.connect();
await subClient.connect();

io.adapter(createAdapter(pubClient, subClient));
```

### Load Balancing

Use sticky sessions for Socket.IO:

```nginx
upstream websocket {
    ip_hash;
    server ws1.example.com:3000;
    server ws2.example.com:3000;
}
```

## Security

1. **JWT Authentication** - Required for protected namespaces
2. **Rate Limiting** - Per-namespace and per-connection limits
3. **Input Validation** - All inputs sanitized and validated
4. **CORS** - Configurable origin restrictions
5. **SSL/TLS** - Use wss:// in production

## Troubleshooting

### Connection Issues

1. Check JWT token validity
2. Verify CORS settings
3. Check rate limit blocks
4. Review server logs

### Performance Issues

1. Monitor metrics endpoint
2. Check Redis connection
3. Review subscription counts
4. Analyze message patterns

### Debug Mode

Enable debug logging:

```bash
DEBUG=socket.io* npm run dev
```

## Configuration

Environment variables:

```env
# WebSocket Configuration
WS_PORT=3000
WS_CORS_ORIGIN=http://localhost:3001
WS_PING_INTERVAL=25000
WS_PING_TIMEOUT=5000

# Redis Configuration
REDIS_URL=redis://localhost:6379
REDIS_PREFIX=ws:

# Rate Limiting
WS_RATE_LIMIT_POINTS=100
WS_RATE_LIMIT_DURATION=1
WS_RATE_LIMIT_BLOCK=60

# Subscription Limits
WS_MAX_SYMBOLS_PER_CONNECTION=100
WS_MAX_CHANNELS_PER_USER=50
```

## Testing

Run WebSocket tests:

```bash
# Unit tests
npm run test:ws

# Integration tests
npm run test:ws:integration

# Performance tests
npm run test:ws:performance
```

## Deployment Checklist

- [ ] Configure Redis for production
- [ ] Set up SSL certificates
- [ ] Configure CORS origins
- [ ] Set appropriate rate limits
- [ ] Enable monitoring/alerting
- [ ] Configure load balancer
- [ ] Set up auto-scaling
- [ ] Test failover scenarios
- [ ] Document API changes
- [ ] Update client SDKs