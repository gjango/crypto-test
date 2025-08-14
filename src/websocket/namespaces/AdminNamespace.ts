import { Server, Socket, Namespace } from 'socket.io';
import { createLogger } from '../../utils/logger';
import { EVENTS, ROOMS } from '../config';
import { AuthMiddleware } from '../middleware/AuthMiddleware';
import { RateLimitMiddleware } from '../middleware/RateLimitMiddleware';

const logger = createLogger('AdminNamespace');

export class AdminNamespace {
  private namespace: Namespace;
  private adminSockets: Map<string, Set<string>> = new Map();

  constructor(
    private io: Server,
    private namespacePath: string
  ) {
    this.namespace = this.io.of(namespacePath);
  }

  /**
   * Initialize namespace
   */
  public async initialize(): Promise<void> {
    // Apply admin-only authentication
    this.namespace.use(AuthMiddleware.adminOnly());

    // Apply rate limiting
    this.namespace.use(RateLimitMiddleware.createForNamespace('admin', {
      points: 200,
      duration: 1,
      blockDuration: 60,
    }));

    // Connection handler
    this.namespace.on('connection', (socket: Socket) => {
      logger.info(`Admin namespace connection: ${socket.id} (Admin: ${socket.data.userId})`);
      
      this.handleConnection(socket);
    });

    logger.info('Admin namespace initialized');
  }

  /**
   * Handle new connection
   */
  private handleConnection(socket: Socket): void {
    const adminId = socket.data.userId;

    // Join admin rooms
    this.joinAdminRooms(socket);

    // Track admin socket
    if (!this.adminSockets.has(adminId)) {
      this.adminSockets.set(adminId, new Set());
    }
    this.adminSockets.get(adminId)!.add(socket.id);

    // Send connection confirmation
    socket.emit(EVENTS.CONNECTION_AUTHENTICATED, {
      socketId: socket.id,
      adminId,
      namespace: this.namespacePath,
      permissions: socket.data.permissions,
      timestamp: new Date(),
    });

    // Handle subscription to monitoring streams
    socket.on(EVENTS.SUBSCRIBE, async (data: any, callback?: Function) => {
      try {
        await this.handleSubscribe(socket, data);
        if (callback) callback({ success: true });
      } catch (error: any) {
        logger.error('Subscription error:', error);
        if (callback) callback({ success: false, error: error.message });
      }
    });

    // Handle admin commands
    socket.on('admin.command', async (data: any, callback?: Function) => {
      try {
        await this.handleAdminCommand(socket, data);
        if (callback) callback({ success: true });
      } catch (error: any) {
        logger.error('Admin command error:', error);
        if (callback) callback({ success: false, error: error.message });
      }
    });

    // Handle ping
    socket.on(EVENTS.PING, () => {
      socket.emit(EVENTS.PONG, { timestamp: Date.now() });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      this.handleDisconnect(socket);
    });
  }

  /**
   * Join admin rooms
   */
  private async joinAdminRooms(socket: Socket): Promise<void> {
    const rooms = [
      ROOMS.adminMonitoringRoom(),
      ROOMS.adminAlertsRoom(),
      ROOMS.adminMetricsRoom(),
    ];

    for (const room of rooms) {
      await socket.join(room);
    }

    logger.debug(`Admin socket ${socket.id} joined admin rooms`);
  }

  /**
   * Handle subscription request
   */
  private async handleSubscribe(socket: Socket, data: any): Promise<void> {
    const { streams } = data;

    if (!streams || !Array.isArray(streams)) {
      throw new Error('Invalid subscription request');
    }

    for (const stream of streams) {
      switch (stream) {
        case 'monitoring':
          await socket.join(ROOMS.adminMonitoringRoom());
          break;
        case 'alerts':
          await socket.join(ROOMS.adminAlertsRoom());
          break;
        case 'metrics':
          await socket.join(ROOMS.adminMetricsRoom());
          break;
        case 'users':
          await socket.join('admin:users');
          break;
        case 'orders':
          await socket.join('admin:orders');
          break;
        case 'positions':
          await socket.join('admin:positions');
          break;
        default:
          logger.warn(`Unknown admin stream: ${stream}`);
      }
    }

    socket.emit(EVENTS.SUBSCRIPTION_CONFIRMED, {
      streams,
      timestamp: new Date(),
    });
  }

  /**
   * Handle admin command
   */
  private async handleAdminCommand(socket: Socket, data: any): Promise<void> {
    const { command, params } = data;
    const adminId = socket.data.userId;
    const permissions = socket.data.permissions || [];

    logger.info(`Admin command: ${command} from ${adminId}`);

    // Check permissions for specific commands
    switch (command) {
      case 'broadcast':
        if (!permissions.includes('SYSTEM_BROADCAST')) {
          throw new Error('Insufficient permissions');
        }
        this.handleBroadcastCommand(params);
        break;

      case 'disconnect_user':
        if (!permissions.includes('MANAGE_USERS')) {
          throw new Error('Insufficient permissions');
        }
        this.handleDisconnectUserCommand(params);
        break;

      case 'maintenance_mode':
        if (!permissions.includes('SYSTEM_CONTROL')) {
          throw new Error('Insufficient permissions');
        }
        this.handleMaintenanceModeCommand(params);
        break;

      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }

  /**
   * Handle broadcast command
   */
  private handleBroadcastCommand(params: any): void {
    const { message, target } = params;
    
    if (target === 'all') {
      this.io.emit(EVENTS.SYSTEM_MESSAGE, {
        message,
        type: 'broadcast',
        timestamp: new Date(),
      });
    } else if (target === 'users') {
      this.io.of('/user').emit(EVENTS.SYSTEM_MESSAGE, {
        message,
        type: 'broadcast',
        timestamp: new Date(),
      });
    }
  }

  /**
   * Handle disconnect user command
   */
  private handleDisconnectUserCommand(params: any): void {
    const { userId, reason } = params;
    
    // Disconnect user from all namespaces
    const userRoom = ROOMS.userRoom(userId);
    this.io.of('/user').to(userRoom).emit(EVENTS.SYSTEM_MESSAGE, {
      type: 'disconnect',
      reason,
      timestamp: new Date(),
    });
    
    // Force disconnect
    this.io.of('/user').in(userRoom).disconnectSockets(true);
  }

  /**
   * Handle maintenance mode command
   */
  private handleMaintenanceModeCommand(params: any): void {
    const { enabled, message, duration } = params;
    
    this.io.emit(EVENTS.SYSTEM_MAINTENANCE, {
      enabled,
      message,
      duration,
      timestamp: new Date(),
    });
  }

  /**
   * Handle disconnect
   */
  private handleDisconnect(socket: Socket): void {
    const adminId = socket.data.userId;

    // Remove from admin sockets
    const adminSocketSet = this.adminSockets.get(adminId);
    if (adminSocketSet) {
      adminSocketSet.delete(socket.id);
      if (adminSocketSet.size === 0) {
        this.adminSockets.delete(adminId);
      }
    }

    logger.info(`Admin namespace disconnection: ${socket.id} (Admin: ${adminId})`);
  }

  /**
   * Broadcast system metrics
   */
  public broadcastMetrics(metrics: any): void {
    this.namespace.to(ROOMS.adminMetricsRoom()).emit('admin.metrics', metrics);
  }

  /**
   * Broadcast system alert
   */
  public broadcastAlert(alert: any): void {
    this.namespace.to(ROOMS.adminAlertsRoom()).emit('admin.alert', alert);
  }

  /**
   * Broadcast monitoring data
   */
  public broadcastMonitoring(data: any): void {
    this.namespace.to(ROOMS.adminMonitoringRoom()).emit('admin.monitoring', data);
  }

  /**
   * Get namespace
   */
  public getNamespace(): Namespace {
    return this.namespace;
  }

  /**
   * Get statistics
   */
  public getStats(): any {
    return {
      connections: this.namespace.sockets.size,
      uniqueAdmins: this.adminSockets.size,
      adminConnections: Array.from(this.adminSockets.entries()).map(([adminId, sockets]) => ({
        adminId,
        connections: sockets.size,
      })),
    };
  }
}