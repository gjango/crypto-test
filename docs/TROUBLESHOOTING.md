# Troubleshooting Guide

## Common Issues and Solutions

### 1. Server Won't Start

#### MongoDB Connection Failed

**Error:** `MongoServerError: connect ECONNREFUSED 127.0.0.1:27017`

**Solutions:**
1. Ensure MongoDB is running:
   ```bash
   # Check MongoDB status
   sudo systemctl status mongod
   
   # Start MongoDB
   sudo systemctl start mongod
   
   # Using Docker
   docker ps | grep mongo
   docker start crypto-mongodb
   ```

2. Verify connection string in `.env`:
   ```env
   MONGODB_URI=mongodb://localhost:27017/crypto-trading
   ```

3. Check MongoDB logs:
   ```bash
   tail -f /var/log/mongodb/mongod.log
   ```

#### Redis Connection Failed

**Error:** `Error: connect ECONNREFUSED 127.0.0.1:6379`

**Note:** Redis is optional for development. The server will run without it.

**Solutions:**
1. Start Redis (optional):
   ```bash
   # Start Redis
   redis-server
   
   # Using Docker
   docker run -d -p 6379:6379 redis:alpine
   ```

2. Or disable Redis in development:
   - The WebSocket server automatically falls back to single-instance mode

#### Port Already in Use

**Error:** `Error: listen EADDRINUSE: address already in use :::3000`

**Solutions:**
1. Find and kill the process:
   ```bash
   # Find process using port 3000
   lsof -i :3000
   
   # Kill the process
   kill -9 <PID>
   ```

2. Change the port in `.env`:
   ```env
   PORT=3001
   ```

### 2. TypeScript Compilation Errors

#### Type Errors During Build

**Solutions:**
1. Use fast mode to skip type checking:
   ```bash
   npm run dev:fast
   npm run build:fast
   ```

2. Fix type errors:
   ```bash
   npm run typecheck
   ```

3. Clean and rebuild:
   ```bash
   rm -rf dist
   npm run build
   ```

#### Module Not Found

**Error:** `Cannot find module 'xxx'`

**Solutions:**
1. Install missing dependencies:
   ```bash
   npm install
   ```

2. Clear npm cache:
   ```bash
   npm cache clean --force
   rm -rf node_modules package-lock.json
   npm install
   ```

### 3. WebSocket Issues

#### WebSocket Connection Failed

**Error:** `WebSocket connection to 'ws://localhost:3000/socket.io/' failed`

**Solutions:**
1. Check CORS settings in `.env`:
   ```env
   WS_CORS_ORIGIN=http://localhost:3001
   CORS_ORIGIN=http://localhost:3001
   ```

2. Verify WebSocket server is running:
   ```bash
   # Check logs
   grep "WebSocket server" logs/app.log
   ```

3. Test WebSocket connection:
   ```bash
   npm run ws:example
   ```

#### Authentication Failed on WebSocket

**Error:** `Authentication failed: Invalid token`

**Solutions:**
1. Ensure JWT token is valid:
   ```javascript
   // Get fresh token
   const response = await fetch('/api/auth/login', {
     method: 'POST',
     body: JSON.stringify({ email, password })
   });
   const { token } = await response.json();
   ```

2. Check token expiration:
   ```bash
   # Decode JWT token
   echo "YOUR_TOKEN" | cut -d. -f2 | base64 -d
   ```

### 4. Database Issues

#### Duplicate Index Warnings

**Warning:** `Duplicate schema index on {"field":1} found`

**Solutions:**
1. Remove duplicate index definitions from models
2. Use either `index: true` in schema OR manual index creation, not both

#### Database Performance Issues

**Solutions:**
1. Check indexes:
   ```javascript
   // In MongoDB shell
   db.collection.getIndexes()
   ```

2. Analyze slow queries:
   ```javascript
   db.setProfilingLevel(1, { slowms: 100 })
   db.system.profile.find().limit(5).sort({ ts: -1 }).pretty()
   ```

3. Optimize connection pool:
   ```env
   DB_MAX_POOL_SIZE=20
   DB_MIN_POOL_SIZE=5
   ```

### 5. Authentication Issues

#### JWT Token Invalid

**Error:** `JsonWebTokenError: invalid signature`

**Solutions:**
1. Verify JWT secret matches:
   ```bash
   # Check environment variable
   echo $JWT_SECRET
   ```

2. For RS256, ensure keys are properly formatted:
   ```bash
   # Test private key
   openssl rsa -in private_key.pem -check
   
   # Test public key
   openssl rsa -in private_key.pem -pubout
   ```

#### Session Expired

**Solutions:**
1. Implement token refresh:
   ```javascript
   // Refresh token before expiry
   const refreshToken = async () => {
     const response = await fetch('/api/auth/refresh', {
       method: 'POST',
       body: JSON.stringify({ refreshToken })
     });
     const { token } = await response.json();
     return token;
   };
   ```

### 6. Performance Issues

#### High Memory Usage

**Solutions:**
1. Check for memory leaks:
   ```bash
   # Monitor memory
   node --inspect dist/server.js
   ```

2. Adjust Node.js memory:
   ```bash
   node --max-old-space-size=2048 dist/server.js
   ```

3. Use PM2 memory limit:
   ```javascript
   // ecosystem.config.js
   max_memory_restart: '1G'
   ```

#### Slow API Responses

**Solutions:**
1. Enable query profiling:
   ```javascript
   mongoose.set('debug', true);
   ```

2. Add database indexes:
   ```javascript
   // Check missing indexes
   await Model.collection.getIndexes();
   ```

3. Implement caching:
   ```env
   ENABLE_CACHE=true
   CACHE_TTL=300
   ```

### 7. Production Issues

#### SSL Certificate Problems

**Solutions:**
1. Verify certificate:
   ```bash
   openssl x509 -in cert.pem -text -noout
   ```

2. Check certificate chain:
   ```bash
   openssl s_client -connect api.yourdomain.com:443
   ```

#### Rate Limiting Too Restrictive

**Solutions:**
1. Adjust rate limits:
   ```env
   RATE_LIMIT_WINDOW_MS=60000
   RATE_LIMIT_MAX_REQUESTS=200
   ```

2. Whitelist IPs:
   ```javascript
   // In rateLimiter middleware
   skip: (req) => trustedIPs.includes(req.ip)
   ```

### 8. Docker Issues

#### Container Won't Start

**Solutions:**
1. Check logs:
   ```bash
   docker logs crypto-backend
   docker-compose logs backend
   ```

2. Verify environment variables:
   ```bash
   docker exec crypto-backend env
   ```

3. Check health status:
   ```bash
   docker inspect crypto-backend --format='{{.State.Health.Status}}'
   ```

#### Container Networking Issues

**Solutions:**
1. Verify network:
   ```bash
   docker network ls
   docker network inspect crypto-network
   ```

2. Test connectivity:
   ```bash
   docker exec crypto-backend ping mongodb
   ```

### 9. Logging Issues

#### Logs Not Appearing

**Solutions:**
1. Check log directory permissions:
   ```bash
   ls -la logs/
   chmod 755 logs
   ```

2. Verify log level:
   ```env
   LOG_LEVEL=debug
   ```

3. Check Winston configuration:
   ```javascript
   // src/utils/logger.ts
   level: process.env.LOG_LEVEL || 'info'
   ```

### 10. Testing Issues

#### Tests Failing

**Solutions:**
1. Run specific test:
   ```bash
   npm test -- --testPathPattern=auth
   ```

2. Clear Jest cache:
   ```bash
   jest --clearCache
   ```

3. Check test database:
   ```env
   # .env.test
   MONGODB_URI=mongodb://localhost:27017/crypto-test
   ```

## Debug Mode

### Enable Detailed Logging

1. **Environment Variables:**
   ```env
   DEBUG=*
   LOG_LEVEL=debug
   VERBOSE_LOGGING=true
   ```

2. **Database Queries:**
   ```javascript
   mongoose.set('debug', true);
   ```

3. **Express Debug:**
   ```bash
   DEBUG=express:* npm run dev
   ```

4. **Socket.IO Debug:**
   ```bash
   DEBUG=socket.io:* npm run dev
   ```

### Using Node Inspector

1. **Start with Inspector:**
   ```bash
   node --inspect dist/server.js
   ```

2. **Chrome DevTools:**
   - Open: chrome://inspect
   - Click "inspect" under Remote Target

3. **VS Code Debugging:**
   ```json
   {
     "type": "node",
     "request": "attach",
     "name": "Attach to Process",
     "port": 9229
   }
   ```

## Health Checks

### Manual Health Check

```bash
# Basic health
curl http://localhost:3000/api/health

# Detailed health
curl http://localhost:3000/api/health/ready

# WebSocket health
curl http://localhost:3000/socket.io/socket.io.js
```

### Monitoring Endpoints

```bash
# Prometheus metrics
curl http://localhost:3000/api/metrics

# WebSocket stats
npm run ws:admin
```

## Getting Help

### Resources

1. **Documentation:**
   - [README](../README.md)
   - [API Docs](./API.md)
   - [Architecture](./ARCHITECTURE.md)

2. **Logs Location:**
   - Application: `logs/app-*.log`
   - Error: `logs/error-*.log`
   - PM2: `logs/pm2-*.log`
   - MongoDB: `/var/log/mongodb/mongod.log`
   - Nginx: `/var/log/nginx/*.log`

3. **Support Channels:**
   - GitHub Issues: [Report Issue](https://github.com/your-repo/issues)
   - Email: support@yourdomain.com
   - Discord: [Join Server](https://discord.gg/your-invite)

### Reporting Issues

When reporting issues, include:

1. **Error Message:** Complete error output
2. **Environment:** Development/Production
3. **Node Version:** `node --version`
4. **NPM Version:** `npm --version`
5. **OS:** Operating system and version
6. **Logs:** Relevant log entries
7. **Steps to Reproduce:** How to recreate the issue
8. **Expected Behavior:** What should happen
9. **Actual Behavior:** What actually happens

### Emergency Recovery

#### Rollback Deployment

```bash
# Using PM2
pm2 stop all
git checkout <previous-version>
npm install
npm run build
pm2 restart all

# Using Docker
docker-compose down
git checkout <previous-version>
docker-compose up -d --build
```

#### Database Recovery

```bash
# Restore from backup
mongorestore --uri="mongodb://..." --dir=/backup/20240115

# Rebuild indexes
npm run migrate
```

#### Clear All Caches

```bash
# Redis
redis-cli FLUSHALL

# Application cache
rm -rf .cache/

# NPM cache
npm cache clean --force
```