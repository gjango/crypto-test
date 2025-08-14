import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import { 
  IOrder, 
  IOrderBook, 
  IOrderBookLevel, 
  IOrderBookEntry,
  OrderSide,
  OrderStatus,
  OrderType
} from '../types/order';

const logger = createLogger('OrderBook');

export class OrderBookService extends EventEmitter {
  private orderBooks: Map<string, SymbolOrderBook> = new Map();
  
  constructor() {
    super();
    this.setMaxListeners(1000);
  }
  
  /**
   * Get or create order book for symbol
   */
  getOrderBook(symbol: string): SymbolOrderBook {
    if (!this.orderBooks.has(symbol)) {
      const book = new SymbolOrderBook(symbol);
      this.orderBooks.set(symbol, book);
      
      // Forward events
      book.on('update', (data) => this.emit('orderbook_update', { symbol, ...data }));
      book.on('trade', (data) => this.emit('trade', { symbol, ...data }));
    }
    
    return this.orderBooks.get(symbol)!;
  }
  
  /**
   * Add order to book
   */
  addOrder(order: IOrder): boolean {
    const book = this.getOrderBook(order.symbol);
    return book.addOrder(order);
  }
  
  /**
   * Remove order from book
   */
  removeOrder(symbol: string, orderId: string, side: OrderSide): boolean {
    const book = this.getOrderBook(symbol);
    return book.removeOrder(orderId, side);
  }
  
  /**
   * Update order in book
   */
  updateOrder(order: IOrder): boolean {
    const book = this.getOrderBook(order.symbol);
    return book.updateOrder(order);
  }
  
  /**
   * Get best bid/ask
   */
  getBestPrices(symbol: string): { bid: number | null; ask: number | null } {
    const book = this.getOrderBook(symbol);
    return book.getBestPrices();
  }
  
  /**
   * Get market depth
   */
  getMarketDepth(symbol: string, levels: number = 10): IOrderBook {
    const book = this.getOrderBook(symbol);
    return book.getDepth(levels);
  }
  
  /**
   * Clear all orders for a symbol
   */
  clearSymbol(symbol: string): void {
    if (this.orderBooks.has(symbol)) {
      this.orderBooks.get(symbol)!.clear();
    }
  }
  
  /**
   * Get order book statistics
   */
  getStatistics(symbol: string): any {
    const book = this.getOrderBook(symbol);
    return book.getStatistics();
  }
}

/**
 * Order book for a single symbol
 */
class SymbolOrderBook extends EventEmitter {
  private symbol: string;
  private bids: Map<number, IOrderBookLevel> = new Map(); // price -> level
  private asks: Map<number, IOrderBookLevel> = new Map(); // price -> level
  private orderIndex: Map<string, { price: number; side: OrderSide }> = new Map(); // orderId -> location
  private sequenceNumber: number = 0;
  private lastUpdate: Date = new Date();
  
  // Sorted price arrays for efficient access
  private bidPrices: number[] = [];
  private askPrices: number[] = [];
  
  constructor(symbol: string) {
    super();
    this.symbol = symbol;
  }
  
  /**
   * Add order to book
   */
  addOrder(order: IOrder): boolean {
    // Only add LIMIT orders to book
    if (order.type !== OrderType.LIMIT || !order.price) {
      return false;
    }
    
    // Skip if order is not open
    if (order.status !== OrderStatus.OPEN && order.status !== OrderStatus.PARTIALLY_FILLED) {
      return false;
    }
    
    const price = order.price;
    const side = order.side;
    const entry: IOrderBookEntry = {
      orderId: order.orderId,
      userId: order.userId,
      quantity: order.remainingQuantity,
      timestamp: order.createdAt,
      hidden: order.flags?.hidden,
    };
    
    if (side === OrderSide.BUY) {
      this.addBid(price, entry);
    } else {
      this.addAsk(price, entry);
    }
    
    // Update index
    this.orderIndex.set(order.orderId, { price, side });
    
    this.sequenceNumber++;
    this.lastUpdate = new Date();
    
    this.emitUpdate('add', order.orderId, price, side);
    
    return true;
  }
  
  /**
   * Add bid to book
   */
  private addBid(price: number, entry: IOrderBookEntry): void {
    if (!this.bids.has(price)) {
      this.bids.set(price, {
        price,
        quantity: 0,
        orders: [],
      });
      
      // Insert price in sorted order
      const insertIndex = this.findInsertIndex(this.bidPrices, price, false);
      this.bidPrices.splice(insertIndex, 0, price);
    }
    
    const level = this.bids.get(price)!;
    level.orders.push(entry);
    level.quantity += entry.quantity;
  }
  
  /**
   * Add ask to book
   */
  private addAsk(price: number, entry: IOrderBookEntry): void {
    if (!this.asks.has(price)) {
      this.asks.set(price, {
        price,
        quantity: 0,
        orders: [],
      });
      
      // Insert price in sorted order
      const insertIndex = this.findInsertIndex(this.askPrices, price, true);
      this.askPrices.splice(insertIndex, 0, price);
    }
    
    const level = this.asks.get(price)!;
    level.orders.push(entry);
    level.quantity += entry.quantity;
  }
  
  /**
   * Find insertion index for sorted array
   */
  private findInsertIndex(arr: number[], value: number, ascending: boolean): number {
    let left = 0;
    let right = arr.length;
    
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (ascending ? arr[mid] < value : arr[mid] > value) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    
    return left;
  }
  
  /**
   * Remove order from book
   */
  removeOrder(orderId: string, side?: OrderSide): boolean {
    const location = this.orderIndex.get(orderId);
    if (!location) {
      return false;
    }
    
    const { price, side: orderSide } = location;
    const actualSide = side || orderSide;
    
    const levels = actualSide === OrderSide.BUY ? this.bids : this.asks;
    const level = levels.get(price);
    
    if (!level) {
      return false;
    }
    
    const orderIndex = level.orders.findIndex(o => o.orderId === orderId);
    if (orderIndex === -1) {
      return false;
    }
    
    const order = level.orders[orderIndex];
    level.quantity -= order.quantity;
    level.orders.splice(orderIndex, 1);
    
    // Remove level if empty
    if (level.orders.length === 0) {
      levels.delete(price);
      
      if (actualSide === OrderSide.BUY) {
        const priceIndex = this.bidPrices.indexOf(price);
        if (priceIndex !== -1) {
          this.bidPrices.splice(priceIndex, 1);
        }
      } else {
        const priceIndex = this.askPrices.indexOf(price);
        if (priceIndex !== -1) {
          this.askPrices.splice(priceIndex, 1);
        }
      }
    }
    
    this.orderIndex.delete(orderId);
    this.sequenceNumber++;
    this.lastUpdate = new Date();
    
    this.emitUpdate('remove', orderId, price, actualSide);
    
    return true;
  }
  
  /**
   * Update order in book
   */
  updateOrder(order: IOrder): boolean {
    // Remove old entry
    this.removeOrder(order.orderId, order.side);
    
    // Add new entry if still valid
    if (order.status === OrderStatus.OPEN || order.status === OrderStatus.PARTIALLY_FILLED) {
      return this.addOrder(order);
    }
    
    return true;
  }
  
  /**
   * Get best bid and ask prices
   */
  getBestPrices(): { bid: number | null; ask: number | null } {
    const bid = this.bidPrices.length > 0 ? this.bidPrices[0] : null;
    const ask = this.askPrices.length > 0 ? this.askPrices[0] : null;
    
    return { bid, ask };
  }
  
  /**
   * Get best bid level
   */
  getBestBid(): IOrderBookLevel | null {
    if (this.bidPrices.length === 0) return null;
    return this.bids.get(this.bidPrices[0]) || null;
  }
  
  /**
   * Get best ask level
   */
  getBestAsk(): IOrderBookLevel | null {
    if (this.askPrices.length === 0) return null;
    return this.asks.get(this.askPrices[0]) || null;
  }
  
  /**
   * Get order book depth
   */
  getDepth(levels: number = 10): IOrderBook {
    const bidLevels: IOrderBookLevel[] = [];
    const askLevels: IOrderBookLevel[] = [];
    
    // Get bid levels
    for (let i = 0; i < Math.min(levels, this.bidPrices.length); i++) {
      const price = this.bidPrices[i];
      const level = this.bids.get(price);
      if (level) {
        bidLevels.push({
          price: level.price,
          quantity: level.quantity,
          orders: level.orders.filter(o => !o.hidden), // Don't show hidden orders
        });
      }
    }
    
    // Get ask levels
    for (let i = 0; i < Math.min(levels, this.askPrices.length); i++) {
      const price = this.askPrices[i];
      const level = this.asks.get(price);
      if (level) {
        askLevels.push({
          price: level.price,
          quantity: level.quantity,
          orders: level.orders.filter(o => !o.hidden), // Don't show hidden orders
        });
      }
    }
    
    return {
      symbol: this.symbol,
      bids: bidLevels,
      asks: askLevels,
      lastUpdate: this.lastUpdate,
      sequenceNumber: this.sequenceNumber,
    };
  }
  
  /**
   * Get orders at price level
   */
  getOrdersAtPrice(price: number, side: OrderSide): IOrderBookEntry[] {
    const levels = side === OrderSide.BUY ? this.bids : this.asks;
    const level = levels.get(price);
    
    return level ? [...level.orders] : [];
  }
  
  /**
   * Calculate market impact for order size
   */
  calculateMarketImpact(side: OrderSide, quantity: number): {
    averagePrice: number;
    worstPrice: number;
    totalQuantity: number;
    levels: number;
  } | null {
    const prices = side === OrderSide.BUY ? this.askPrices : this.bidPrices;
    const levels = side === OrderSide.BUY ? this.asks : this.bids;
    
    if (prices.length === 0) return null;
    
    let remainingQuantity = quantity;
    let totalCost = 0;
    let totalQuantityFilled = 0;
    let worstPrice = 0;
    let levelsConsumed = 0;
    
    for (const price of prices) {
      const level = levels.get(price);
      if (!level) continue;
      
      const availableQuantity = level.quantity;
      const fillQuantity = Math.min(remainingQuantity, availableQuantity);
      
      totalCost += fillQuantity * price;
      totalQuantityFilled += fillQuantity;
      remainingQuantity -= fillQuantity;
      worstPrice = price;
      levelsConsumed++;
      
      if (remainingQuantity <= 0) break;
    }
    
    if (totalQuantityFilled === 0) return null;
    
    return {
      averagePrice: totalCost / totalQuantityFilled,
      worstPrice,
      totalQuantity: totalQuantityFilled,
      levels: levelsConsumed,
    };
  }
  
  /**
   * Get order book statistics
   */
  getStatistics(): any {
    const bidVolume = Array.from(this.bids.values()).reduce((sum, level) => sum + level.quantity, 0);
    const askVolume = Array.from(this.asks.values()).reduce((sum, level) => sum + level.quantity, 0);
    
    const bidOrders = Array.from(this.bids.values()).reduce((sum, level) => sum + level.orders.length, 0);
    const askOrders = Array.from(this.asks.values()).reduce((sum, level) => sum + level.orders.length, 0);
    
    const spread = this.askPrices.length > 0 && this.bidPrices.length > 0
      ? this.askPrices[0] - this.bidPrices[0]
      : null;
    
    const midPrice = this.askPrices.length > 0 && this.bidPrices.length > 0
      ? (this.askPrices[0] + this.bidPrices[0]) / 2
      : null;
    
    return {
      symbol: this.symbol,
      bidLevels: this.bidPrices.length,
      askLevels: this.askPrices.length,
      bidVolume,
      askVolume,
      bidOrders,
      askOrders,
      spread,
      spreadPercent: spread && midPrice ? (spread / midPrice) * 100 : null,
      midPrice,
      imbalance: (bidVolume - askVolume) / (bidVolume + askVolume) || 0,
      lastUpdate: this.lastUpdate,
      sequenceNumber: this.sequenceNumber,
    };
  }
  
  /**
   * Clear all orders
   */
  clear(): void {
    this.bids.clear();
    this.asks.clear();
    this.orderIndex.clear();
    this.bidPrices = [];
    this.askPrices = [];
    this.sequenceNumber++;
    this.lastUpdate = new Date();
    
    this.emit('clear');
  }
  
  /**
   * Emit update event
   */
  private emitUpdate(action: string, orderId: string, price: number, side: OrderSide): void {
    this.emit('update', {
      action,
      orderId,
      price,
      side,
      sequenceNumber: this.sequenceNumber,
      timestamp: this.lastUpdate,
    });
  }
}

// Export singleton instance
export default new OrderBookService();