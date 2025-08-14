import { Server, Socket } from 'socket.io';
import { createLogger } from '../../utils/logger';

const logger = createLogger('WebSocketMetrics');

interface MetricSnapshot {
  timestamp: Date;
  connections: number;
  messages: number;
  bandwidth: number;
}

interface EventMetric {
  count: number;
  lastEmit: Date;
  totalBytes: number;
}

export class WebSocketMetrics {
  private connectionCount: number = 0;
  private messageCount: number = 0;
  private totalBandwidth: number = 0;
  private eventMetrics: Map<string, EventMetric> = new Map();
  private errorCount: number = 0;
  private snapshots: MetricSnapshot[] = [];
  private startTime: Date = new Date();
  private io: Server | null = null;

  // Performance metrics
  private messageLatencies: number[] = [];
  private processingTimes: Map<string, number[]> = new Map();

  /**
   * Start metrics collection
   */
  public startCollection(io: Server): void {
    this.io = io;
    this.startTime = new Date();

    // Collect snapshots every minute
    setInterval(() => {
      this.collectSnapshot();
    }, 60000);

    // Clean up old data every hour
    setInterval(() => {
      this.cleanup();
    }, 3600000);

    logger.info('WebSocket metrics collection started');
  }

  /**
   * Record new connection
   */
  public recordConnection(socket: Socket): void {
    this.connectionCount++;
    
    // Track connection time
    socket.data.connectedAt = Date.now();
  }

  /**
   * Record disconnection
   */
  public recordDisconnection(socket: Socket, reason: string): void {
    this.connectionCount--;
    
    // Calculate connection duration
    const duration = Date.now() - (socket.data.connectedAt || Date.now());
    logger.debug(`Connection ${socket.id} lasted ${duration}ms, reason: ${reason}`);
  }

  /**
   * Record broadcast
   */
  public recordBroadcast(event: string, room: string, dataSize?: number): void {
    this.messageCount++;
    
    const size = dataSize || 0;
    this.totalBandwidth += size;

    // Update event metrics
    if (!this.eventMetrics.has(event)) {
      this.eventMetrics.set(event, {
        count: 0,
        lastEmit: new Date(),
        totalBytes: 0,
      });
    }

    const metric = this.eventMetrics.get(event)!;
    metric.count++;
    metric.lastEmit = new Date();
    metric.totalBytes += size;
  }

  /**
   * Record error
   */
  public recordError(socket: Socket, error: any): void {
    this.errorCount++;
    logger.error(`Socket error for ${socket.id}:`, error);
  }

  /**
   * Record message latency
   */
  public recordLatency(latency: number): void {
    this.messageLatencies.push(latency);
    
    // Keep only last 1000 latencies
    if (this.messageLatencies.length > 1000) {
      this.messageLatencies.shift();
    }
  }

  /**
   * Record processing time
   */
  public recordProcessingTime(operation: string, time: number): void {
    if (!this.processingTimes.has(operation)) {
      this.processingTimes.set(operation, []);
    }

    const times = this.processingTimes.get(operation)!;
    times.push(time);

    // Keep only last 100 times
    if (times.length > 100) {
      times.shift();
    }
  }

  /**
   * Collect snapshot
   */
  private collectSnapshot(): void {
    const snapshot: MetricSnapshot = {
      timestamp: new Date(),
      connections: this.connectionCount,
      messages: this.messageCount,
      bandwidth: this.totalBandwidth,
    };

    this.snapshots.push(snapshot);

    // Keep only last 60 snapshots (1 hour)
    if (this.snapshots.length > 60) {
      this.snapshots.shift();
    }
  }

  /**
   * Clean up old data
   */
  private cleanup(): void {
    // Reset counters
    this.messageCount = 0;
    this.totalBandwidth = 0;
    
    // Clean up old event metrics
    const oneHourAgo = new Date(Date.now() - 3600000);
    for (const [event, metric] of this.eventMetrics.entries()) {
      if (metric.lastEmit < oneHourAgo) {
        this.eventMetrics.delete(event);
      }
    }
  }

  /**
   * Calculate average latency
   */
  private getAverageLatency(): number {
    if (this.messageLatencies.length === 0) return 0;
    
    const sum = this.messageLatencies.reduce((a, b) => a + b, 0);
    return sum / this.messageLatencies.length;
  }

  /**
   * Calculate percentile latency
   */
  private getPercentileLatency(percentile: number): number {
    if (this.messageLatencies.length === 0) return 0;
    
    const sorted = [...this.messageLatencies].sort((a, b) => a - b);
    const index = Math.floor((percentile / 100) * sorted.length);
    return sorted[index];
  }

  /**
   * Get namespace metrics
   */
  private getNamespaceMetrics(): any {
    if (!this.io) return {};

    return {
      prices: {
        connections: this.io.of('/prices').sockets.size,
        rooms: this.io.of('/prices').adapter.rooms.size,
      },
      user: {
        connections: this.io.of('/user').sockets.size,
        rooms: this.io.of('/user').adapter.rooms.size,
      },
      admin: {
        connections: this.io.of('/admin').sockets.size,
        rooms: this.io.of('/admin').adapter.rooms.size,
      },
      market: {
        connections: this.io.of('/market').sockets.size,
        rooms: this.io.of('/market').adapter.rooms.size,
      },
    };
  }

  /**
   * Get metrics
   */
  public getMetrics(): any {
    const uptime = Date.now() - this.startTime.getTime();
    const messagesPerSecond = this.messageCount / (uptime / 1000);
    const bandwidthPerSecond = this.totalBandwidth / (uptime / 1000);

    return {
      uptime,
      connections: {
        current: this.connectionCount,
        total: this.connectionCount,
      },
      messages: {
        total: this.messageCount,
        perSecond: messagesPerSecond,
      },
      bandwidth: {
        total: this.totalBandwidth,
        perSecond: bandwidthPerSecond,
      },
      latency: {
        average: this.getAverageLatency(),
        p50: this.getPercentileLatency(50),
        p95: this.getPercentileLatency(95),
        p99: this.getPercentileLatency(99),
      },
      events: {
        total: this.eventMetrics.size,
        top: this.getTopEvents(),
      },
      errors: {
        total: this.errorCount,
      },
      namespaces: this.getNamespaceMetrics(),
      snapshots: this.snapshots,
    };
  }

  /**
   * Get top events by count
   */
  private getTopEvents(): any[] {
    return Array.from(this.eventMetrics.entries())
      .map(([event, metric]) => ({
        event,
        count: metric.count,
        bytes: metric.totalBytes,
        lastEmit: metric.lastEmit,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  /**
   * Export metrics for monitoring
   */
  public exportPrometheus(): string {
    const metrics = this.getMetrics();
    
    const lines: string[] = [
      '# HELP websocket_connections_current Current WebSocket connections',
      '# TYPE websocket_connections_current gauge',
      `websocket_connections_current ${metrics.connections.current}`,
      '',
      '# HELP websocket_messages_total Total WebSocket messages',
      '# TYPE websocket_messages_total counter',
      `websocket_messages_total ${metrics.messages.total}`,
      '',
      '# HELP websocket_bandwidth_bytes_total Total bandwidth in bytes',
      '# TYPE websocket_bandwidth_bytes_total counter',
      `websocket_bandwidth_bytes_total ${metrics.bandwidth.total}`,
      '',
      '# HELP websocket_latency_ms WebSocket message latency in milliseconds',
      '# TYPE websocket_latency_ms histogram',
      `websocket_latency_ms{quantile="0.5"} ${metrics.latency.p50}`,
      `websocket_latency_ms{quantile="0.95"} ${metrics.latency.p95}`,
      `websocket_latency_ms{quantile="0.99"} ${metrics.latency.p99}`,
      '',
      '# HELP websocket_errors_total Total WebSocket errors',
      '# TYPE websocket_errors_total counter',
      `websocket_errors_total ${metrics.errors.total}`,
    ];

    // Add namespace metrics
    for (const [namespace, data] of Object.entries(metrics.namespaces)) {
      lines.push(
        `# HELP websocket_namespace_connections WebSocket connections per namespace`,
        `# TYPE websocket_namespace_connections gauge`,
        `websocket_namespace_connections{namespace="${namespace}"} ${(data as any).connections}`
      );
    }

    return lines.join('\n');
  }
}