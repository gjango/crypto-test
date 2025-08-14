import { io, Socket } from 'socket.io-client';
import { EventEmitter } from 'events';

export interface TradingClientOptions {
  url?: string;
  token?: string;
  autoConnect?: boolean;
  reconnection?: boolean;
  reconnectionAttempts?: number;
  reconnectionDelay?: number;
  timeout?: number;
}

export interface Subscription {
  type: string;
  symbol?: string;
  params?: any;
}

export class TradingClient extends EventEmitter {
  private url: string;
  private token?: string;
  private options: TradingClientOptions;
  
  // Socket connections for each namespace
  private priceSocket?: Socket;
  private userSocket?: Socket;
  private marketSocket?: Socket;
  private adminSocket?: Socket;
  
  private subscriptions: Set<string> = new Set();
  private connected: boolean = false;
  private reconnectTimer?: NodeJS.Timeout;

  constructor(options: TradingClientOptions = {}) {
    super();
    
    this.url = options.url || 'http://localhost:3000';
    this.token = options.token;
    this.options = {
      autoConnect: options.autoConnect !== false,
      reconnection: options.reconnection !== false,
      reconnectionAttempts: options.reconnectionAttempts || 5,
      reconnectionDelay: options.reconnectionDelay || 1000,
      timeout: options.timeout || 20000,
    };

    if (this.options.autoConnect) {
      this.connect();
    }
  }

  /**
   * Connect to WebSocket server
   */
  public connect(token?: string): Promise<void> {
    if (token) {
      this.token = token;
    }

    return new Promise((resolve, reject) => {
      try {
        // Connect to price namespace (public)
        this.connectPriceSocket();
        
        // Connect to market namespace (public)
        this.connectMarketSocket();
        
        // Connect to user namespace if authenticated
        if (this.token) {
          this.connectUserSocket();
        }

        this.connected = true;
        this.emit('connected');
        resolve();
      } catch (error) {
        this.emit('error', error);
        reject(error);
      }
    });
  }

  /**
   * Connect to price namespace
   */
  private connectPriceSocket(): void {
    this.priceSocket = io(`${this.url}/prices`, {
      auth: this.token ? { token: this.token } : undefined,
      reconnection: this.options.reconnection,
      reconnectionAttempts: this.options.reconnectionAttempts,
      reconnectionDelay: this.options.reconnectionDelay,
      timeout: this.options.timeout,
    });

    this.setupSocketHandlers(this.priceSocket, 'prices');
  }

  /**
   * Connect to market namespace
   */
  private connectMarketSocket(): void {
    this.marketSocket = io(`${this.url}/market`, {
      auth: this.token ? { token: this.token } : undefined,
      reconnection: this.options.reconnection,
      reconnectionAttempts: this.options.reconnectionAttempts,
      reconnectionDelay: this.options.reconnectionDelay,
      timeout: this.options.timeout,
    });

    this.setupSocketHandlers(this.marketSocket, 'market');
  }

  /**
   * Connect to user namespace
   */
  private connectUserSocket(): void {
    if (!this.token) {
      throw new Error('Authentication token required for user namespace');
    }

    this.userSocket = io(`${this.url}/user`, {
      auth: { token: this.token },
      reconnection: this.options.reconnection,
      reconnectionAttempts: this.options.reconnectionAttempts,
      reconnectionDelay: this.options.reconnectionDelay,
      timeout: this.options.timeout,
    });

    this.setupSocketHandlers(this.userSocket, 'user');
    this.setupUserEventHandlers();
  }

  /**
   * Connect to admin namespace
   */
  public connectAdmin(): void {
    if (!this.token) {
      throw new Error('Authentication token required for admin namespace');
    }

    this.adminSocket = io(`${this.url}/admin`, {
      auth: { token: this.token },
      reconnection: this.options.reconnection,
      reconnectionAttempts: this.options.reconnectionAttempts,
      reconnectionDelay: this.options.reconnectionDelay,
      timeout: this.options.timeout,
    });

    this.setupSocketHandlers(this.adminSocket, 'admin');
  }

  /**
   * Setup common socket handlers
   */
  private setupSocketHandlers(socket: Socket, namespace: string): void {
    socket.on('connect', () => {
      this.emit(`${namespace}:connected`, socket.id);
    });

    socket.on('disconnect', (reason) => {
      this.emit(`${namespace}:disconnected`, reason);
    });

    socket.on('error', (error) => {
      this.emit(`${namespace}:error`, error);
    });

    socket.on('connection.authenticated', (data) => {
      this.emit(`${namespace}:authenticated`, data);
    });

    socket.on('subscription.confirmed', (data) => {
      this.emit(`${namespace}:subscribed`, data);
    });

    socket.on('subscription.error', (error) => {
      this.emit(`${namespace}:subscription-error`, error);
    });
  }

  /**
   * Setup user-specific event handlers
   */
  private setupUserEventHandlers(): void {
    if (!this.userSocket) return;

    // Order events
    this.userSocket.on('order.new', (data) => {
      this.emit('order:new', data);
    });

    this.userSocket.on('order.update', (data) => {
      this.emit('order:update', data);
    });

    this.userSocket.on('order.filled', (data) => {
      this.emit('order:filled', data);
    });

    this.userSocket.on('order.cancelled', (data) => {
      this.emit('order:cancelled', data);
    });

    // Position events
    this.userSocket.on('position.update', (data) => {
      this.emit('position:update', data);
    });

    this.userSocket.on('position.liquidated', (data) => {
      this.emit('position:liquidated', data);
    });

    // Wallet events
    this.userSocket.on('wallet.update', (data) => {
      this.emit('wallet:update', data);
    });

    // Margin events
    this.userSocket.on('margin.call', (data) => {
      this.emit('margin:call', data);
    });
  }

  /**
   * Subscribe to price updates
   */
  public subscribePrices(symbols: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.priceSocket) {
        return reject(new Error('Price socket not connected'));
      }

      this.priceSocket.emit('subscribe', { symbols }, (response: any) => {
        if (response.success) {
          symbols.forEach(s => this.subscriptions.add(`price:${s}`));
          
          // Setup price event handlers
          symbols.forEach(symbol => {
            this.priceSocket!.on(`price.update`, (data) => {
              if (data.symbol === symbol) {
                this.emit(`price:${symbol}`, data);
              }
            });
          });
          
          resolve();
        } else {
          reject(new Error(response.error));
        }
      });
    });
  }

  /**
   * Unsubscribe from price updates
   */
  public unsubscribePrices(symbols: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.priceSocket) {
        return reject(new Error('Price socket not connected'));
      }

      this.priceSocket.emit('unsubscribe', { symbols }, (response: any) => {
        if (response.success) {
          symbols.forEach(s => this.subscriptions.delete(`price:${s}`));
          resolve();
        } else {
          reject(new Error(response.error));
        }
      });
    });
  }

  /**
   * Subscribe to market data
   */
  public subscribeMarket(markets: string[], channels?: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.marketSocket) {
        return reject(new Error('Market socket not connected'));
      }

      this.marketSocket.emit('subscribe', { markets, channels }, (response: any) => {
        if (response.success) {
          markets.forEach(m => this.subscriptions.add(`market:${m}`));
          
          // Setup market event handlers
          this.marketSocket!.on('market.stats', (data) => {
            this.emit(`market:stats:${data.symbol}`, data.stats);
          });
          
          this.marketSocket!.on('market.depth', (data) => {
            this.emit(`market:depth:${data.symbol}`, data);
          });
          
          this.marketSocket!.on('market.trades', (data) => {
            this.emit(`market:trades:${data.symbol}`, data.trades);
          });
          
          resolve();
        } else {
          reject(new Error(response.error));
        }
      });
    });
  }

  /**
   * Subscribe to user streams
   */
  public subscribeUserStreams(streams: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.userSocket) {
        return reject(new Error('User socket not connected'));
      }

      this.userSocket.emit('subscribe', { streams }, (response: any) => {
        if (response.success) {
          streams.forEach(s => this.subscriptions.add(`user:${s}`));
          resolve();
        } else {
          reject(new Error(response.error));
        }
      });
    });
  }

  /**
   * Send admin command
   */
  public sendAdminCommand(command: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.adminSocket) {
        return reject(new Error('Admin socket not connected'));
      }

      this.adminSocket.emit('admin.command', { command, params }, (response: any) => {
        if (response.success) {
          resolve(response.data);
        } else {
          reject(new Error(response.error));
        }
      });
    });
  }

  /**
   * Ping server
   */
  public ping(): Promise<number> {
    const startTime = Date.now();
    const socket = this.priceSocket || this.marketSocket;

    return new Promise((resolve, reject) => {
      if (!socket) {
        return reject(new Error('No socket connected'));
      }

      socket.emit('ping');
      socket.once('pong', () => {
        resolve(Date.now() - startTime);
      });

      setTimeout(() => {
        reject(new Error('Ping timeout'));
      }, 5000);
    });
  }

  /**
   * Disconnect from server
   */
  public disconnect(): void {
    this.connected = false;

    if (this.priceSocket) {
      this.priceSocket.disconnect();
      this.priceSocket = undefined;
    }

    if (this.userSocket) {
      this.userSocket.disconnect();
      this.userSocket = undefined;
    }

    if (this.marketSocket) {
      this.marketSocket.disconnect();
      this.marketSocket = undefined;
    }

    if (this.adminSocket) {
      this.adminSocket.disconnect();
      this.adminSocket = undefined;
    }

    this.subscriptions.clear();
    this.emit('disconnected');
  }

  /**
   * Check if connected
   */
  public isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get active subscriptions
   */
  public getSubscriptions(): string[] {
    return Array.from(this.subscriptions);
  }

  /**
   * Update authentication token
   */
  public updateToken(token: string): void {
    this.token = token;
    
    // Reconnect user socket with new token
    if (this.userSocket) {
      this.userSocket.disconnect();
      this.connectUserSocket();
    }
  }
}

export default TradingClient;