import { TradingClient } from '../client/TradingClient';
import { createLogger } from '../../utils/logger';

const logger = createLogger('StressTest');

interface TestConfig {
  serverUrl: string;
  numClients: number;
  numSymbols: number;
  messageDuration: number; // seconds
  messageRate: number; // messages per second per client
}

interface TestMetrics {
  startTime: Date;
  endTime?: Date;
  totalConnections: number;
  successfulConnections: number;
  failedConnections: number;
  totalMessages: number;
  totalErrors: number;
  avgLatency: number;
  maxLatency: number;
  minLatency: number;
  latencies: number[];
}

/**
 * WebSocket stress testing tool
 */
class WebSocketStressTest {
  private config: TestConfig;
  private clients: TradingClient[] = [];
  private metrics: TestMetrics;
  private symbols: string[] = [];

  constructor(config: TestConfig) {
    this.config = config;
    this.metrics = {
      startTime: new Date(),
      totalConnections: 0,
      successfulConnections: 0,
      failedConnections: 0,
      totalMessages: 0,
      totalErrors: 0,
      avgLatency: 0,
      maxLatency: 0,
      minLatency: Infinity,
      latencies: [],
    };

    // Generate test symbols
    for (let i = 0; i < config.numSymbols; i++) {
      this.symbols.push(`TEST${i}/USDT`);
    }
  }

  /**
   * Run stress test
   */
  public async run(): Promise<void> {
    logger.info('Starting WebSocket stress test', this.config);

    try {
      // Phase 1: Connect all clients
      await this.connectClients();

      // Phase 2: Subscribe to channels
      await this.subscribeClients();

      // Phase 3: Run message test
      await this.runMessageTest();

      // Phase 4: Measure latencies
      await this.measureLatencies();

      // Phase 5: Disconnect clients
      await this.disconnectClients();

      // Report results
      this.reportMetrics();

    } catch (error) {
      logger.error('Stress test failed:', error);
      throw error;
    }
  }

  /**
   * Connect all clients
   */
  private async connectClients(): Promise<void> {
    logger.info(`Connecting ${this.config.numClients} clients...`);

    const connectionPromises = [];

    for (let i = 0; i < this.config.numClients; i++) {
      const client = new TradingClient({
        url: this.config.serverUrl,
        autoConnect: false,
        reconnection: false,
      });

      this.clients.push(client);
      this.metrics.totalConnections++;

      // Setup error handling
      client.on('error', () => {
        this.metrics.totalErrors++;
      });

      // Connect with delay to avoid overwhelming server
      connectionPromises.push(
        this.connectWithDelay(client, i * 10)
      );
    }

    const results = await Promise.allSettled(connectionPromises);

    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        this.metrics.successfulConnections++;
      } else {
        this.metrics.failedConnections++;
      }
    });

    logger.info(`Connected ${this.metrics.successfulConnections}/${this.config.numClients} clients`);
  }

  /**
   * Connect client with delay
   */
  private connectWithDelay(client: TradingClient, delay: number): Promise<void> {
    return new Promise((resolve, reject) => {
      setTimeout(async () => {
        try {
          await client.connect();
          resolve();
        } catch (error) {
          reject(error);
        }
      }, delay);
    });
  }

  /**
   * Subscribe clients to channels
   */
  private async subscribeClients(): Promise<void> {
    logger.info('Subscribing clients to channels...');

    const subscriptionPromises = [];

    for (const client of this.clients) {
      if (client.isConnected()) {
        // Each client subscribes to random symbols
        const randomSymbols = this.getRandomSymbols(5);
        
        subscriptionPromises.push(
          client.subscribePrices(randomSymbols).catch(() => {
            this.metrics.totalErrors++;
          })
        );

        subscriptionPromises.push(
          client.subscribeMarket(randomSymbols, ['depth', 'trades']).catch(() => {
            this.metrics.totalErrors++;
          })
        );
      }
    }

    await Promise.allSettled(subscriptionPromises);
    logger.info('Subscriptions completed');
  }

  /**
   * Run message test
   */
  private async runMessageTest(): Promise<void> {
    logger.info(`Running message test for ${this.config.messageDuration} seconds...`);

    const startTime = Date.now();
    const endTime = startTime + (this.config.messageDuration * 1000);

    // Track messages
    for (const client of this.clients) {
      client.on('price:update', () => {
        this.metrics.totalMessages++;
      });

      client.on('market:depth', () => {
        this.metrics.totalMessages++;
      });

      client.on('market:trades', () => {
        this.metrics.totalMessages++;
      });
    }

    // Wait for test duration
    await new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (Date.now() >= endTime) {
          clearInterval(checkInterval);
          resolve(undefined);
        }

        // Log progress
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const messagesPerSecond = this.metrics.totalMessages / elapsed;
        logger.debug(`Progress: ${elapsed}s, Messages: ${this.metrics.totalMessages}, Rate: ${messagesPerSecond.toFixed(2)}/s`);
      }, 1000);
    });

    logger.info(`Message test completed. Total messages: ${this.metrics.totalMessages}`);
  }

  /**
   * Measure latencies
   */
  private async measureLatencies(): Promise<void> {
    logger.info('Measuring latencies...');

    const latencyPromises = [];

    for (const client of this.clients) {
      if (client.isConnected()) {
        latencyPromises.push(
          client.ping().then(latency => {
            this.metrics.latencies.push(latency);
            this.metrics.maxLatency = Math.max(this.metrics.maxLatency, latency);
            this.metrics.minLatency = Math.min(this.metrics.minLatency, latency);
          }).catch(() => {
            this.metrics.totalErrors++;
          })
        );
      }
    }

    await Promise.allSettled(latencyPromises);

    // Calculate average latency
    if (this.metrics.latencies.length > 0) {
      const sum = this.metrics.latencies.reduce((a, b) => a + b, 0);
      this.metrics.avgLatency = sum / this.metrics.latencies.length;
    }

    logger.info('Latency measurements completed');
  }

  /**
   * Disconnect all clients
   */
  private async disconnectClients(): Promise<void> {
    logger.info('Disconnecting clients...');

    for (const client of this.clients) {
      client.disconnect();
    }

    this.metrics.endTime = new Date();
    logger.info('All clients disconnected');
  }

  /**
   * Get random symbols
   */
  private getRandomSymbols(count: number): string[] {
    const shuffled = [...this.symbols].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
  }

  /**
   * Report test metrics
   */
  private reportMetrics(): void {
    const duration = this.metrics.endTime 
      ? (this.metrics.endTime.getTime() - this.metrics.startTime.getTime()) / 1000
      : 0;

    const messagesPerSecond = this.metrics.totalMessages / duration;
    const connectionsPerSecond = this.metrics.successfulConnections / duration;

    const report = {
      summary: {
        duration: `${duration.toFixed(2)}s`,
        totalConnections: this.metrics.totalConnections,
        successfulConnections: this.metrics.successfulConnections,
        failedConnections: this.metrics.failedConnections,
        connectionSuccessRate: `${((this.metrics.successfulConnections / this.metrics.totalConnections) * 100).toFixed(2)}%`,
      },
      messages: {
        total: this.metrics.totalMessages,
        perSecond: messagesPerSecond.toFixed(2),
        perClient: (this.metrics.totalMessages / this.metrics.successfulConnections).toFixed(2),
      },
      latency: {
        average: `${this.metrics.avgLatency.toFixed(2)}ms`,
        min: `${this.metrics.minLatency}ms`,
        max: `${this.metrics.maxLatency}ms`,
        p50: `${this.getPercentile(50).toFixed(2)}ms`,
        p95: `${this.getPercentile(95).toFixed(2)}ms`,
        p99: `${this.getPercentile(99).toFixed(2)}ms`,
      },
      errors: {
        total: this.metrics.totalErrors,
        errorRate: `${((this.metrics.totalErrors / this.metrics.totalMessages) * 100).toFixed(4)}%`,
      },
      performance: {
        connectionsPerSecond: connectionsPerSecond.toFixed(2),
        messagesPerSecond: messagesPerSecond.toFixed(2),
        totalBandwidth: 'N/A', // Would need to track actual data sizes
      },
    };

    logger.info('='.repeat(60));
    logger.info('STRESS TEST RESULTS');
    logger.info('='.repeat(60));
    logger.info(JSON.stringify(report, null, 2));
    logger.info('='.repeat(60));
  }

  /**
   * Calculate percentile
   */
  private getPercentile(percentile: number): number {
    if (this.metrics.latencies.length === 0) return 0;

    const sorted = [...this.metrics.latencies].sort((a, b) => a - b);
    const index = Math.floor((percentile / 100) * sorted.length);
    return sorted[index] || 0;
  }
}

/**
 * Run stress test with command line arguments
 */
async function main() {
  const config: TestConfig = {
    serverUrl: process.env.WS_SERVER_URL || 'http://localhost:3000',
    numClients: parseInt(process.env.NUM_CLIENTS || '100'),
    numSymbols: parseInt(process.env.NUM_SYMBOLS || '50'),
    messageDuration: parseInt(process.env.TEST_DURATION || '60'),
    messageRate: parseInt(process.env.MESSAGE_RATE || '10'),
  };

  logger.info('WebSocket Stress Test Configuration:', config);

  const test = new WebSocketStressTest(config);

  try {
    await test.run();
    process.exit(0);
  } catch (error) {
    logger.error('Test failed:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Stress test interrupted');
  process.exit(0);
});

// Run if executed directly
if (require.main === module) {
  main();
}

export { WebSocketStressTest, TestConfig, TestMetrics };