import { TradingClient } from '../client/TradingClient';
import { createLogger } from '../../utils/logger';
import * as readline from 'readline';

const logger = createLogger('AdminDashboard');

/**
 * Admin dashboard for monitoring and controlling WebSocket server
 */
class AdminDashboard {
  private client: TradingClient;
  private rl: readline.Interface;
  private connected: boolean = false;
  private refreshInterval?: NodeJS.Timeout;

  constructor(serverUrl: string, adminToken: string) {
    this.client = new TradingClient({
      url: serverUrl,
      token: adminToken,
      autoConnect: false,
    });

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  /**
   * Start dashboard
   */
  public async start(): Promise<void> {
    logger.info('Starting Admin Dashboard...');

    try {
      // Connect to server
      await this.client.connect();
      this.client.connectAdmin();
      this.connected = true;

      logger.info('✅ Connected to WebSocket server as admin');

      // Setup event listeners
      this.setupEventListeners();

      // Start auto-refresh
      this.startAutoRefresh();

      // Show menu
      this.showMenu();

      // Handle commands
      this.handleCommands();

    } catch (error) {
      logger.error('Failed to connect:', error);
      process.exit(1);
    }
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    this.client.on('admin:connected', (socketId) => {
      logger.info(`Admin namespace connected: ${socketId}`);
    });

    this.client.on('admin:system-alert', (alert) => {
      logger.warn('⚠️ System Alert:', alert);
    });

    this.client.on('admin:metrics-update', (metrics) => {
      this.displayMetrics(metrics);
    });
  }

  /**
   * Start auto refresh
   */
  private startAutoRefresh(): void {
    this.refreshInterval = setInterval(async () => {
      if (this.connected) {
        await this.getServerStats();
      }
    }, 5000);
  }

  /**
   * Show menu
   */
  private showMenu(): void {
    console.log('\n' + '='.repeat(60));
    console.log('WEBSOCKET ADMIN DASHBOARD');
    console.log('='.repeat(60));
    console.log('Commands:');
    console.log('  1. stats      - Get server statistics');
    console.log('  2. metrics    - Get detailed metrics');
    console.log('  3. connections- List active connections');
    console.log('  4. broadcast  - Send system broadcast');
    console.log('  5. kick       - Kick user by ID');
    console.log('  6. maintenance- Toggle maintenance mode');
    console.log('  7. limits     - Update rate limits');
    console.log('  8. clear      - Clear screen');
    console.log('  9. help       - Show this menu');
    console.log('  0. exit       - Exit dashboard');
    console.log('='.repeat(60));
  }

  /**
   * Handle commands
   */
  private handleCommands(): void {
    this.rl.on('line', async (input) => {
      const command = input.trim().toLowerCase();

      switch (command) {
        case '1':
        case 'stats':
          await this.getServerStats();
          break;

        case '2':
        case 'metrics':
          await this.getDetailedMetrics();
          break;

        case '3':
        case 'connections':
          await this.getConnections();
          break;

        case '4':
        case 'broadcast':
          await this.sendBroadcast();
          break;

        case '5':
        case 'kick':
          await this.kickUser();
          break;

        case '6':
        case 'maintenance':
          await this.toggleMaintenance();
          break;

        case '7':
        case 'limits':
          await this.updateRateLimits();
          break;

        case '8':
        case 'clear':
          console.clear();
          this.showMenu();
          break;

        case '9':
        case 'help':
          this.showMenu();
          break;

        case '0':
        case 'exit':
          this.exit();
          break;

        default:
          console.log('Unknown command. Type "help" for menu.');
      }
    });
  }

  /**
   * Get server statistics
   */
  private async getServerStats(): Promise<void> {
    try {
      const stats = await this.client.sendAdminCommand('getStats', {});
      
      console.log('\n📊 Server Statistics:');
      console.log('-'.repeat(40));
      console.log(`Total Connections: ${stats.totalConnections}`);
      console.log(`Active Namespaces:`);
      console.log(`  - Prices: ${stats.namespaces.prices.connections}`);
      console.log(`  - User: ${stats.namespaces.user.connections}`);
      console.log(`  - Market: ${stats.namespaces.market.connections}`);
      console.log(`  - Admin: ${stats.namespaces.admin.connections}`);
      console.log(`Messages/sec: ${stats.messagesPerSecond}`);
      console.log(`Avg Latency: ${stats.avgLatency}ms`);
      console.log('-'.repeat(40));
    } catch (error) {
      logger.error('Failed to get stats:', error);
    }
  }

  /**
   * Get detailed metrics
   */
  private async getDetailedMetrics(): Promise<void> {
    try {
      const metrics = await this.client.sendAdminCommand('getMetrics', {});
      
      console.log('\n📈 Detailed Metrics:');
      console.log('-'.repeat(40));
      console.log(JSON.stringify(metrics, null, 2));
      console.log('-'.repeat(40));
    } catch (error) {
      logger.error('Failed to get metrics:', error);
    }
  }

  /**
   * Get active connections
   */
  private async getConnections(): Promise<void> {
    try {
      const connections = await this.client.sendAdminCommand('getConnections', {});
      
      console.log('\n👥 Active Connections:');
      console.log('-'.repeat(40));
      
      connections.forEach((conn: any) => {
        console.log(`ID: ${conn.id}`);
        console.log(`  User: ${conn.userId || 'Anonymous'}`);
        console.log(`  Namespace: ${conn.namespace}`);
        console.log(`  Connected: ${conn.connectedAt}`);
        console.log(`  Subscriptions: ${conn.subscriptions.join(', ')}`);
        console.log('');
      });
      
      console.log(`Total: ${connections.length} connections`);
      console.log('-'.repeat(40));
    } catch (error) {
      logger.error('Failed to get connections:', error);
    }
  }

  /**
   * Send system broadcast
   */
  private async sendBroadcast(): Promise<void> {
    this.rl.question('Enter broadcast message: ', async (message) => {
      if (!message) return;

      try {
        await this.client.sendAdminCommand('broadcast', {
          message,
          type: 'info',
        });
        
        logger.info('✅ Broadcast sent successfully');
      } catch (error) {
        logger.error('Failed to send broadcast:', error);
      }
    });
  }

  /**
   * Kick user
   */
  private async kickUser(): Promise<void> {
    this.rl.question('Enter user ID to kick: ', async (userId) => {
      if (!userId) return;

      this.rl.question('Enter reason (optional): ', async (reason) => {
        try {
          await this.client.sendAdminCommand('kickUser', {
            userId,
            reason: reason || 'Admin action',
          });
          
          logger.info(`✅ User ${userId} kicked`);
        } catch (error) {
          logger.error('Failed to kick user:', error);
        }
      });
    });
  }

  /**
   * Toggle maintenance mode
   */
  private async toggleMaintenance(): Promise<void> {
    this.rl.question('Enable maintenance mode? (y/n): ', async (answer) => {
      const enabled = answer.toLowerCase() === 'y';
      
      const message = enabled 
        ? 'System maintenance in progress. Please try again later.'
        : 'Maintenance completed. System is back online.';

      try {
        await this.client.sendAdminCommand('setMaintenance', {
          enabled,
          message,
        });
        
        logger.info(`✅ Maintenance mode ${enabled ? 'enabled' : 'disabled'}`);
      } catch (error) {
        logger.error('Failed to toggle maintenance:', error);
      }
    });
  }

  /**
   * Update rate limits
   */
  private async updateRateLimits(): Promise<void> {
    this.rl.question('Enter namespace (prices/user/market/admin): ', async (namespace) => {
      this.rl.question('Enter points per second: ', async (points) => {
        this.rl.question('Enter block duration (seconds): ', async (blockDuration) => {
          try {
            await this.client.sendAdminCommand('updateRateLimits', {
              namespace,
              limits: {
                points: parseInt(points),
                duration: 1,
                blockDuration: parseInt(blockDuration),
              },
            });
            
            logger.info(`✅ Rate limits updated for ${namespace}`);
          } catch (error) {
            logger.error('Failed to update rate limits:', error);
          }
        });
      });
    });
  }

  /**
   * Display metrics
   */
  private displayMetrics(metrics: any): void {
    console.clear();
    console.log('\n' + '='.repeat(60));
    console.log('REAL-TIME METRICS');
    console.log('='.repeat(60));
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log('-'.repeat(60));
    
    // Connection metrics
    console.log('📊 Connections:');
    console.log(`  Total: ${metrics.connections.total}`);
    console.log(`  Active: ${metrics.connections.active}`);
    console.log(`  Peak: ${metrics.connections.peak}`);
    
    // Message metrics
    console.log('\n📨 Messages:');
    console.log(`  Total: ${metrics.messages.total}`);
    console.log(`  Rate: ${metrics.messages.perSecond}/s`);
    
    // Latency metrics
    console.log('\n⏱️ Latency:');
    console.log(`  Avg: ${metrics.latency.avg}ms`);
    console.log(`  P50: ${metrics.latency.p50}ms`);
    console.log(`  P95: ${metrics.latency.p95}ms`);
    console.log(`  P99: ${metrics.latency.p99}ms`);
    
    // Error metrics
    console.log('\n❌ Errors:');
    console.log(`  Total: ${metrics.errors.total}`);
    console.log(`  Rate: ${metrics.errors.rate}%`);
    
    console.log('='.repeat(60));
    console.log('Press Enter to show menu...');
  }

  /**
   * Exit dashboard
   */
  private exit(): void {
    logger.info('Shutting down dashboard...');
    
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    
    this.client.disconnect();
    this.rl.close();
    process.exit(0);
  }
}

/**
 * Main function
 */
async function main() {
  const serverUrl = process.env.WS_SERVER_URL || 'http://localhost:3000';
  const adminToken = process.env.ADMIN_TOKEN || '';

  if (!adminToken) {
    logger.error('ADMIN_TOKEN environment variable is required');
    process.exit(1);
  }

  const dashboard = new AdminDashboard(serverUrl, adminToken);
  await dashboard.start();
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Dashboard interrupted');
  process.exit(0);
});

// Run if executed directly
if (require.main === module) {
  main();
}

export { AdminDashboard };