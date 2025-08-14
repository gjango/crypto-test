# Deployment Guide

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Docker Deployment](#docker-deployment)
4. [Manual Deployment](#manual-deployment)
5. [Cloud Deployments](#cloud-deployments)
6. [Production Configuration](#production-configuration)
7. [Monitoring Setup](#monitoring-setup)
8. [Security Checklist](#security-checklist)

## Prerequisites

### System Requirements
- Node.js 18+ (LTS recommended)
- MongoDB 6.0+
- Redis 6.0+
- 2GB+ RAM minimum (4GB+ recommended)
- 10GB+ disk space
- SSL certificate for HTTPS

### Required Tools
- Git
- Docker & Docker Compose (for containerized deployment)
- PM2 (for process management)
- Nginx (for reverse proxy)

## Environment Setup

### 1. Create Production Environment File

Create `.env.production`:

```env
# Server Configuration
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Database
MONGODB_URI=mongodb://username:password@mongodb-host:27017/crypto-trading?authSource=admin
DB_NAME=crypto-trading
DB_MAX_POOL_SIZE=20
DB_MIN_POOL_SIZE=5

# Redis
REDIS_URL=redis://:password@redis-host:6379
REDIS_PREFIX=crypto:

# JWT Configuration (RS256 for production)
JWT_PRIVATE_KEY=$(cat private_key.pem)
JWT_PUBLIC_KEY=$(cat public_key.pem)
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

# API Keys
BINANCE_API_KEY=your-production-key
BINANCE_API_SECRET=your-production-secret

# Security
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
SESSION_SECRET=generate-strong-secret-here

# Logging
LOG_LEVEL=info
LOG_DIR=/var/log/crypto-backend

# CORS
CORS_ORIGIN=https://yourdomain.com
CORS_CREDENTIALS=true

# Admin
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=change-this-immediately
```

### 2. Generate RSA Keys for JWT

```bash
# Generate private key
openssl genrsa -out private_key.pem 2048

# Generate public key
openssl rsa -in private_key.pem -pubout -out public_key.pem

# Set proper permissions
chmod 600 private_key.pem
chmod 644 public_key.pem
```

## Docker Deployment

### 1. Create Dockerfile

```dockerfile
# Multi-stage build for optimized image
FROM node:18-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM node:18-alpine

RUN apk add --no-cache tini

WORKDIR /app

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Create log directory
RUN mkdir -p /var/log/crypto-backend && \
    chown -R nodejs:nodejs /var/log/crypto-backend

USER nodejs

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
```

### 2. Create docker-compose.yml

```yaml
version: '3.8'

services:
  backend:
    build: .
    container_name: crypto-backend
    restart: always
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env.production
    volumes:
      - ./logs:/var/log/crypto-backend
      - ./uploads:/app/uploads
    depends_on:
      - mongodb
      - redis
    networks:
      - crypto-network
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  mongodb:
    image: mongo:6.0
    container_name: crypto-mongodb
    restart: always
    ports:
      - "27017:27017"
    environment:
      - MONGO_INITDB_ROOT_USERNAME=admin
      - MONGO_INITDB_ROOT_PASSWORD=secure-password
      - MONGO_INITDB_DATABASE=crypto-trading
    volumes:
      - mongodb-data:/data/db
      - mongodb-config:/data/configdb
      - ./scripts/mongo-init.js:/docker-entrypoint-initdb.d/init.js:ro
    networks:
      - crypto-network

  redis:
    image: redis:7-alpine
    container_name: crypto-redis
    restart: always
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes --requirepass secure-password
    volumes:
      - redis-data:/data
    networks:
      - crypto-network

  nginx:
    image: nginx:alpine
    container_name: crypto-nginx
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - backend
    networks:
      - crypto-network

volumes:
  mongodb-data:
  mongodb-config:
  redis-data:

networks:
  crypto-network:
    driver: bridge
```

### 3. Deploy with Docker Compose

```bash
# Build and start services
docker-compose up -d --build

# View logs
docker-compose logs -f backend

# Stop services
docker-compose down

# Stop and remove volumes
docker-compose down -v
```

## Manual Deployment

### 1. Install Dependencies

```bash
# Clone repository
git clone <repository-url>
cd backend

# Install production dependencies
npm ci --only=production

# Build TypeScript
npm run build
```

### 2. Setup PM2

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'crypto-backend',
    script: './dist/server.js',
    instances: 'max',
    exec_mode: 'cluster',
    autorestart: true,
    watch: false,
    max_memory_restart: '2G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: '/var/log/pm2/crypto-error.log',
    out_file: '/var/log/pm2/crypto-out.log',
    log_file: '/var/log/pm2/crypto-combined.log',
    time: true,
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
```

Start with PM2:

```bash
# Start application
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup startup script
pm2 startup

# Monitor
pm2 monit

# View logs
pm2 logs crypto-backend
```

### 3. Setup Nginx Reverse Proxy

Create `/etc/nginx/sites-available/crypto-backend`:

```nginx
upstream crypto_backend {
    least_conn;
    server 127.0.0.1:3000 max_fails=3 fail_timeout=30s;
    server 127.0.0.1:3001 max_fails=3 fail_timeout=30s;
    server 127.0.0.1:3002 max_fails=3 fail_timeout=30s;
    keepalive 32;
}

server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    # SSL Configuration
    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Logging
    access_log /var/log/nginx/crypto-access.log;
    error_log /var/log/nginx/crypto-error.log;

    # API Routes
    location /api {
        proxy_pass http://crypto_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # WebSocket Support
    location /socket.io/ {
        proxy_pass http://crypto_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health Check
    location /health {
        access_log off;
        proxy_pass http://crypto_backend/api/health;
    }
}
```

Enable site:

```bash
ln -s /etc/nginx/sites-available/crypto-backend /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

## Cloud Deployments

### AWS EC2/ECS

1. **EC2 Deployment**
```bash
# Install Node.js
curl -sL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs

# Install MongoDB
sudo yum install -y mongodb-org

# Install Redis
sudo amazon-linux-extras install redis6

# Clone and deploy application
git clone <repository>
cd backend
npm ci --only=production
npm run build
pm2 start ecosystem.config.js
```

2. **ECS Deployment**
- Build Docker image
- Push to ECR
- Create ECS task definition
- Create ECS service
- Configure Application Load Balancer

### Google Cloud Run

```bash
# Build and push image
gcloud builds submit --tag gcr.io/PROJECT-ID/crypto-backend

# Deploy to Cloud Run
gcloud run deploy crypto-backend \
  --image gcr.io/PROJECT-ID/crypto-backend \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production
```

### Azure App Service

```bash
# Create App Service
az webapp create \
  --resource-group crypto-rg \
  --plan crypto-plan \
  --name crypto-backend \
  --runtime "NODE|18-lts"

# Deploy code
az webapp deployment source config-zip \
  --resource-group crypto-rg \
  --name crypto-backend \
  --src crypto-backend.zip
```

### Heroku

```bash
# Create app
heroku create crypto-backend

# Add MongoDB
heroku addons:create mongolab

# Add Redis
heroku addons:create heroku-redis

# Set environment variables
heroku config:set NODE_ENV=production

# Deploy
git push heroku main
```

## Production Configuration

### 1. Database Optimization

```javascript
// MongoDB connection options
const mongoOptions = {
  maxPoolSize: 20,
  minPoolSize: 5,
  socketTimeoutMS: 45000,
  serverSelectionTimeoutMS: 5000,
  maxIdleTimeMS: 10000,
  compressors: ['zlib'],
  retryWrites: true,
  w: 'majority'
};
```

### 2. Redis Configuration

```conf
# /etc/redis/redis.conf
maxmemory 2gb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
appendonly yes
appendfsync everysec
```

### 3. Security Hardening

```bash
# Firewall rules
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# Fail2ban for brute force protection
sudo apt-get install fail2ban
sudo systemctl enable fail2ban
```

## Monitoring Setup

### 1. Prometheus Configuration

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'crypto-backend'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/api/metrics'
```

### 2. Grafana Dashboard

Import dashboard JSON from `monitoring/grafana-dashboard.json`

### 3. Application Monitoring

```bash
# Install monitoring stack
docker-compose -f docker-compose.monitoring.yml up -d

# Components:
# - Prometheus: http://localhost:9090
# - Grafana: http://localhost:3001
# - AlertManager: http://localhost:9093
```

### 4. Log Aggregation

```bash
# ELK Stack setup
docker run -d \
  --name elasticsearch \
  -p 9200:9200 \
  -e "discovery.type=single-node" \
  elasticsearch:7.17.0

docker run -d \
  --name kibana \
  -p 5601:5601 \
  --link elasticsearch \
  kibana:7.17.0
```

## Security Checklist

### Pre-Deployment

- [ ] Environment variables secured
- [ ] SSL certificates installed
- [ ] Database credentials encrypted
- [ ] API keys rotated
- [ ] Admin password changed
- [ ] JWT keys generated
- [ ] CORS origins configured
- [ ] Rate limiting enabled

### Post-Deployment

- [ ] Health checks passing
- [ ] Monitoring active
- [ ] Logs collecting
- [ ] Backups configured
- [ ] Firewall rules applied
- [ ] Security headers verified
- [ ] Performance baseline established
- [ ] Disaster recovery tested

## Maintenance

### Backup Strategy

```bash
# MongoDB backup
mongodump --uri="mongodb://..." --out=/backup/$(date +%Y%m%d)

# Redis backup
redis-cli BGSAVE

# Application backup
tar -czf backup-$(date +%Y%m%d).tar.gz /app
```

### Update Process

```bash
# 1. Backup current version
pm2 save

# 2. Pull latest code
git pull origin main

# 3. Install dependencies
npm ci --only=production

# 4. Build
npm run build

# 5. Reload with zero downtime
pm2 reload ecosystem.config.js
```

### Rollback Process

```bash
# 1. Stop current version
pm2 stop crypto-backend

# 2. Restore previous version
git checkout <previous-tag>

# 3. Rebuild
npm ci --only=production
npm run build

# 4. Restart
pm2 start crypto-backend
```

## Troubleshooting

### Common Issues

1. **Connection Timeouts**
   - Check firewall rules
   - Verify network connectivity
   - Review connection pool settings

2. **High Memory Usage**
   - Analyze heap dumps
   - Check for memory leaks
   - Adjust PM2 max_memory_restart

3. **Slow Performance**
   - Review database indexes
   - Check cache hit rates
   - Analyze query performance

### Debug Mode

```bash
# Enable debug logging
DEBUG=* NODE_ENV=development pm2 start app.js

# View real-time logs
pm2 logs --lines 100
```

## Support

For deployment support:
- Documentation: [Read the docs](./README.md)
- Issues: [GitHub Issues](https://github.com/your-repo/issues)
- Email: devops@yourdomain.com