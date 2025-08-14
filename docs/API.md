# API Documentation

## Base URL

```
Development: http://localhost:3000/api
Production: https://api.yourdomain.com/api
```

## Authentication

The API uses JWT (JSON Web Tokens) for authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

## Response Format

All API responses follow this format:

### Success Response
```json
{
  "success": true,
  "data": {
    // Response data
  },
  "message": "Operation successful"
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Error description",
    "details": {} // Optional additional details
  }
}
```

## Endpoints

### Authentication

#### Register User
```http
POST /api/auth/register
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "username": "johndoe",
  "firstName": "John",
  "lastName": "Doe"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_id",
      "email": "user@example.com",
      "username": "johndoe"
    },
    "token": "jwt_token",
    "refreshToken": "refresh_token"
  }
}
```

#### Login
```http
POST /api/auth/login
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_id",
      "email": "user@example.com",
      "username": "johndoe",
      "role": "user"
    },
    "token": "jwt_token",
    "refreshToken": "refresh_token"
  }
}
```

#### Refresh Token
```http
POST /api/auth/refresh
```

**Request Body:**
```json
{
  "refreshToken": "refresh_token"
}
```

#### Logout
```http
POST /api/auth/logout
```

**Headers:**
- Authorization: Bearer <token>

#### Get Profile
```http
GET /api/auth/profile
```

**Headers:**
- Authorization: Bearer <token>

#### Update Profile
```http
PUT /api/auth/profile
```

**Headers:**
- Authorization: Bearer <token>

**Request Body:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "phone": "+1234567890"
}
```

### Markets

#### List Markets
```http
GET /api/markets
```

**Query Parameters:**
- `status` (optional): active, inactive, all
- `baseAsset` (optional): BTC, ETH, etc.
- `sort` (optional): volume24h, price, change24h
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20)

**Response:**
```json
{
  "success": true,
  "data": {
    "markets": [
      {
        "symbol": "BTC/USDT",
        "baseAsset": "BTC",
        "quoteAsset": "USDT",
        "status": "active",
        "price": 50000,
        "volume24h": 1000000,
        "change24h": 2.5,
        "high24h": 51000,
        "low24h": 49000
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 100,
      "pages": 5
    }
  }
}
```

#### Get Market Details
```http
GET /api/markets/:symbol
```

**Response:**
```json
{
  "success": true,
  "data": {
    "symbol": "BTC/USDT",
    "baseAsset": "BTC",
    "quoteAsset": "USDT",
    "status": "active",
    "fees": {
      "maker": 0.002,
      "taker": 0.004
    },
    "limits": {
      "minOrderSize": 0.0001,
      "maxOrderSize": 100,
      "minPrice": 0.01,
      "maxPrice": 1000000
    },
    "leverage": {
      "min": 1,
      "max": 125
    }
  }
}
```

#### Get Ticker
```http
GET /api/markets/:symbol/ticker
```

**Response:**
```json
{
  "success": true,
  "data": {
    "symbol": "BTC/USDT",
    "price": 50000,
    "bid": 49999,
    "ask": 50001,
    "volume24h": 1000000,
    "change24h": 2.5,
    "changePercent24h": 0.025,
    "high24h": 51000,
    "low24h": 49000,
    "timestamp": "2024-01-15T12:00:00Z"
  }
}
```

#### Get Order Book
```http
GET /api/markets/:symbol/orderbook
```

**Query Parameters:**
- `depth` (optional): Number of levels (default: 20, max: 100)

**Response:**
```json
{
  "success": true,
  "data": {
    "symbol": "BTC/USDT",
    "bids": [
      ["49999", "0.5"],
      ["49998", "1.0"]
    ],
    "asks": [
      ["50001", "0.5"],
      ["50002", "1.0"]
    ],
    "timestamp": "2024-01-15T12:00:00Z"
  }
}
```

#### Get Recent Trades
```http
GET /api/markets/:symbol/trades
```

**Query Parameters:**
- `limit` (optional): Number of trades (default: 50, max: 500)

**Response:**
```json
{
  "success": true,
  "data": {
    "symbol": "BTC/USDT",
    "trades": [
      {
        "id": "trade_id",
        "price": 50000,
        "quantity": 0.1,
        "side": "buy",
        "timestamp": "2024-01-15T12:00:00Z"
      }
    ]
  }
}
```

### Orders

#### Create Order
```http
POST /api/orders
```

**Headers:**
- Authorization: Bearer <token>

**Request Body:**
```json
{
  "symbol": "BTC/USDT",
  "side": "buy",
  "type": "limit",
  "quantity": 0.1,
  "price": 49000,
  "leverage": 10,
  "marginMode": "cross",
  "stopLoss": 48000,
  "takeProfit": 52000
}
```

**Order Types:**
- `market`: Market order
- `limit`: Limit order
- `stop`: Stop order
- `stop_limit`: Stop-limit order
- `trailing_stop`: Trailing stop order

**Response:**
```json
{
  "success": true,
  "data": {
    "orderId": "order_id",
    "symbol": "BTC/USDT",
    "side": "buy",
    "type": "limit",
    "status": "pending",
    "quantity": 0.1,
    "price": 49000,
    "leverage": 10,
    "marginMode": "cross",
    "createdAt": "2024-01-15T12:00:00Z"
  }
}
```

#### Get Orders
```http
GET /api/orders
```

**Headers:**
- Authorization: Bearer <token>

**Query Parameters:**
- `symbol` (optional): Filter by symbol
- `status` (optional): pending, filled, cancelled, all
- `side` (optional): buy, sell
- `type` (optional): market, limit, stop
- `startDate` (optional): ISO date string
- `endDate` (optional): ISO date string
- `page` (optional): Page number
- `limit` (optional): Items per page

#### Get Order Details
```http
GET /api/orders/:orderId
```

**Headers:**
- Authorization: Bearer <token>

#### Update Order
```http
PUT /api/orders/:orderId
```

**Headers:**
- Authorization: Bearer <token>

**Request Body:**
```json
{
  "price": 49500,
  "quantity": 0.15,
  "stopLoss": 48500,
  "takeProfit": 52500
}
```

#### Cancel Order
```http
DELETE /api/orders/:orderId
```

**Headers:**
- Authorization: Bearer <token>

#### Cancel All Orders
```http
DELETE /api/orders
```

**Headers:**
- Authorization: Bearer <token>

**Query Parameters:**
- `symbol` (optional): Cancel orders for specific symbol

### Positions

#### Get Open Positions
```http
GET /api/positions
```

**Headers:**
- Authorization: Bearer <token>

**Query Parameters:**
- `symbol` (optional): Filter by symbol
- `side` (optional): long, short

**Response:**
```json
{
  "success": true,
  "data": {
    "positions": [
      {
        "positionId": "position_id",
        "symbol": "BTC/USDT",
        "side": "long",
        "quantity": 0.1,
        "entryPrice": 49000,
        "markPrice": 50000,
        "liquidationPrice": 45000,
        "unrealizedPnl": 100,
        "realizedPnl": 0,
        "margin": 490,
        "marginRatio": 0.1,
        "leverage": 10,
        "status": "OPEN"
      }
    ]
  }
}
```

#### Get Position Details
```http
GET /api/positions/:positionId
```

**Headers:**
- Authorization: Bearer <token>

#### Close Position
```http
POST /api/positions/:positionId/close
```

**Headers:**
- Authorization: Bearer <token>

**Request Body:**
```json
{
  "quantity": 0.05,  // Optional, closes entire position if not specified
  "type": "market"   // market or limit
}
```

#### Add/Remove Margin
```http
PUT /api/positions/:positionId/margin
```

**Headers:**
- Authorization: Bearer <token>

**Request Body:**
```json
{
  "amount": 100,     // Positive to add, negative to remove
  "marginMode": "cross"  // Optional, to change margin mode
}
```

#### Update Take Profit / Stop Loss
```http
PUT /api/positions/:positionId/tp-sl
```

**Headers:**
- Authorization: Bearer <token>

**Request Body:**
```json
{
  "takeProfit": 52000,
  "stopLoss": 48000
}
```

### Wallet

#### Get Wallet Balances
```http
GET /api/wallet
```

**Headers:**
- Authorization: Bearer <token>

**Response:**
```json
{
  "success": true,
  "data": {
    "balances": {
      "USDT": {
        "free": 10000,
        "locked": 500,
        "total": 10500
      },
      "BTC": {
        "free": 0.5,
        "locked": 0.1,
        "total": 0.6
      }
    },
    "totalValueUSDT": 40500
  }
}
```

#### Get Currency Balance
```http
GET /api/wallet/:currency
```

**Headers:**
- Authorization: Bearer <token>

#### Internal Transfer
```http
POST /api/wallet/transfer
```

**Headers:**
- Authorization: Bearer <token>

**Request Body:**
```json
{
  "from": "spot",
  "to": "margin",
  "currency": "USDT",
  "amount": 1000
}
```

#### Transaction History
```http
GET /api/wallet/history
```

**Headers:**
- Authorization: Bearer <token>

**Query Parameters:**
- `type` (optional): deposit, withdrawal, transfer, fee
- `currency` (optional): Filter by currency
- `startDate` (optional): ISO date string
- `endDate` (optional): ISO date string
- `page` (optional): Page number
- `limit` (optional): Items per page

### Admin

#### Get Users (Admin Only)
```http
GET /api/admin/users
```

**Headers:**
- Authorization: Bearer <admin-token>

**Query Parameters:**
- `status` (optional): active, suspended, all
- `role` (optional): user, admin
- `search` (optional): Search by email or username
- `page` (optional): Page number
- `limit` (optional): Items per page

#### System Statistics (Admin Only)
```http
GET /api/admin/stats
```

**Headers:**
- Authorization: Bearer <admin-token>

**Response:**
```json
{
  "success": true,
  "data": {
    "users": {
      "total": 1000,
      "active": 950,
      "new24h": 10
    },
    "trading": {
      "volume24h": 10000000,
      "trades24h": 50000,
      "openPositions": 500,
      "totalMargin": 1000000
    },
    "system": {
      "uptime": "7d 12h 30m",
      "connections": 1250,
      "apiCalls24h": 1000000
    }
  }
}
```

#### Update Market Settings (Admin Only)
```http
PUT /api/admin/markets/:symbol
```

**Headers:**
- Authorization: Bearer <admin-token>

**Request Body:**
```json
{
  "status": "active",
  "fees": {
    "maker": 0.002,
    "taker": 0.004
  },
  "leverage": {
    "max": 100
  },
  "limits": {
    "minOrderSize": 0.0001,
    "maxOrderSize": 100
  }
}
```

#### Update Risk Parameters (Admin Only)
```http
PUT /api/admin/risk-params
```

**Headers:**
- Authorization: Bearer <admin-token>

**Request Body:**
```json
{
  "maintenanceMarginRatio": 0.03,
  "initialMarginRatio": 0.05,
  "liquidationFeeRatio": 0.005,
  "insuranceFundRatio": 0.01
}
```

#### Get Audit Logs (Admin Only)
```http
GET /api/admin/audit-logs
```

**Headers:**
- Authorization: Bearer <admin-token>

**Query Parameters:**
- `action` (optional): Filter by action type
- `userId` (optional): Filter by user
- `startDate` (optional): ISO date string
- `endDate` (optional): ISO date string
- `page` (optional): Page number
- `limit` (optional): Items per page

### Health & Monitoring

#### Health Check
```http
GET /api/health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T12:00:00Z",
  "uptime": "7d 12h 30m",
  "version": "1.0.0",
  "services": {
    "database": "connected",
    "redis": "connected",
    "websocket": "running"
  }
}
```

#### Liveness Probe
```http
GET /api/health/live
```

**Response:**
```json
{
  "status": "alive"
}
```

#### Readiness Probe
```http
GET /api/health/ready
```

**Response:**
```json
{
  "status": "ready",
  "checks": {
    "database": true,
    "redis": true,
    "websocket": true
  }
}
```

#### Metrics (Prometheus Format)
```http
GET /api/metrics
```

**Response:**
```
# HELP api_requests_total Total API requests
# TYPE api_requests_total counter
api_requests_total{method="GET",route="/api/markets",status="200"} 1000

# HELP api_request_duration_seconds API request duration
# TYPE api_request_duration_seconds histogram
api_request_duration_seconds_bucket{le="0.1"} 950
api_request_duration_seconds_bucket{le="0.5"} 990
api_request_duration_seconds_bucket{le="1"} 1000
```

## Rate Limiting

The API implements rate limiting to prevent abuse:

- **Default limit**: 100 requests per minute
- **Authenticated users**: 200 requests per minute
- **Admin users**: 1000 requests per minute

Rate limit headers are included in responses:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining
- `X-RateLimit-Reset`: Time when limit resets (Unix timestamp)

## Error Codes

| Code | Description |
|------|-------------|
| `AUTH_REQUIRED` | Authentication required |
| `INVALID_TOKEN` | Invalid or expired token |
| `INSUFFICIENT_PERMISSIONS` | User lacks required permissions |
| `VALIDATION_ERROR` | Request validation failed |
| `RESOURCE_NOT_FOUND` | Requested resource not found |
| `DUPLICATE_RESOURCE` | Resource already exists |
| `INSUFFICIENT_BALANCE` | Insufficient wallet balance |
| `INSUFFICIENT_MARGIN` | Insufficient margin for position |
| `ORDER_NOT_FOUND` | Order not found |
| `POSITION_NOT_FOUND` | Position not found |
| `MARKET_CLOSED` | Market is closed |
| `INVALID_LEVERAGE` | Invalid leverage value |
| `RISK_LIMIT_EXCEEDED` | Risk limit exceeded |
| `RATE_LIMIT_EXCEEDED` | Rate limit exceeded |
| `INTERNAL_ERROR` | Internal server error |

## Pagination

List endpoints support pagination with these parameters:

- `page`: Page number (starts at 1)
- `limit`: Items per page (default: 20, max: 100)

Response includes pagination metadata:
```json
{
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "pages": 5,
    "hasNext": true,
    "hasPrev": false
  }
}
```

## Webhooks (Coming Soon)

Configure webhooks to receive real-time notifications:

- Order fills
- Position liquidations
- Margin calls
- Large trades
- System alerts

## SDK Libraries

Official SDKs available for:
- JavaScript/TypeScript
- Python
- Go
- Java
- C#

## Support

For API support and questions:
- Email: api-support@yourdomain.com
- Discord: [Join our Discord](https://discord.gg/your-invite)
- GitHub: [Open an issue](https://github.com/your-repo/issues)