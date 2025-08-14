module.exports = {
  apps: [
    {
      name: 'crypto-backend',
      script: './dist/server.js',
      instances: process.env.PM2_INSTANCES || 'max',
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: process.env.PORT || 3000,
      },
      env_staging: {
        NODE_ENV: 'staging',
        PORT: process.env.PORT || 3000,
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      time: true,
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 5000,
      
      // Advanced features
      min_uptime: '10s',
      max_restarts: 10,
      
      // Monitoring
      instance_var: 'INSTANCE_ID',
      
      // Node.js flags
      node_args: '--max-old-space-size=2048',
      
      // Environment-specific settings
      env_production: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000,
        instances: process.env.PM2_INSTANCES || 'max',
      },
    },
  ],

  // Deployment configuration
  deploy: {
    production: {
      user: 'deploy',
      host: ['server1.example.com', 'server2.example.com'],
      ref: 'origin/main',
      repo: 'git@github.com:your-username/crypto-backend.git',
      path: '/var/www/crypto-backend',
      'pre-deploy': 'git pull',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env production',
      'pre-setup': 'mkdir -p /var/www/crypto-backend',
      env: {
        NODE_ENV: 'production',
      },
    },
    staging: {
      user: 'deploy',
      host: 'staging.example.com',
      ref: 'origin/develop',
      repo: 'git@github.com:your-username/crypto-backend.git',
      path: '/var/www/crypto-backend-staging',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env staging',
      env: {
        NODE_ENV: 'staging',
      },
    },
  },
};