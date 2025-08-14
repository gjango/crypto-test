import { createLogger } from '../utils/logger';
import { SUBSCRIPTION_LIMITS } from './config';

const logger = createLogger('SubscriptionManager');

export interface Subscription {
  socketId: string;
  channel: string;
  params?: any;
  createdAt: Date;
}

export class SubscriptionManager {
  private subscriptions: Map<string, Set<string>> = new Map(); // socketId -> channels
  private channelSubscribers: Map<string, Set<string>> = new Map(); // channel -> socketIds
  private subscriptionDetails: Map<string, Subscription> = new Map(); // subscriptionKey -> details

  /**
   * Add subscription
   */
  public addSubscription(
    socketId: string,
    channel: string,
    params?: any
  ): boolean {
    // Check subscription limits
    const currentSubs = this.subscriptions.get(socketId) || new Set();
    if (currentSubs.size >= SUBSCRIPTION_LIMITS.maxRoomsPerConnection) {
      logger.warn(`Socket ${socketId} reached subscription limit`);
      return false;
    }

    // Add to socket subscriptions
    if (!this.subscriptions.has(socketId)) {
      this.subscriptions.set(socketId, new Set());
    }
    this.subscriptions.get(socketId)!.add(channel);

    // Add to channel subscribers
    if (!this.channelSubscribers.has(channel)) {
      this.channelSubscribers.set(channel, new Set());
    }
    this.channelSubscribers.get(channel)!.add(socketId);

    // Store subscription details
    const key = `${socketId}:${channel}`;
    this.subscriptionDetails.set(key, {
      socketId,
      channel,
      params,
      createdAt: new Date(),
    });

    logger.debug(`Subscription added: ${socketId} -> ${channel}`);
    return true;
  }

  /**
   * Remove subscription
   */
  public removeSubscription(socketId: string, channel: string): boolean {
    // Remove from socket subscriptions
    const socketSubs = this.subscriptions.get(socketId);
    if (socketSubs) {
      socketSubs.delete(channel);
      if (socketSubs.size === 0) {
        this.subscriptions.delete(socketId);
      }
    }

    // Remove from channel subscribers
    const channelSubs = this.channelSubscribers.get(channel);
    if (channelSubs) {
      channelSubs.delete(socketId);
      if (channelSubs.size === 0) {
        this.channelSubscribers.delete(channel);
      }
    }

    // Remove subscription details
    const key = `${socketId}:${channel}`;
    this.subscriptionDetails.delete(key);

    logger.debug(`Subscription removed: ${socketId} -> ${channel}`);
    return true;
  }

  /**
   * Remove all subscriptions for a socket
   */
  public removeAllSubscriptions(socketId: string): void {
    const channels = this.subscriptions.get(socketId);
    if (!channels) return;

    for (const channel of channels) {
      this.removeSubscription(socketId, channel);
    }

    logger.debug(`All subscriptions removed for socket: ${socketId}`);
  }

  /**
   * Get socket subscriptions
   */
  public getSocketSubscriptions(socketId: string): string[] {
    const subs = this.subscriptions.get(socketId);
    return subs ? Array.from(subs) : [];
  }

  /**
   * Get channel subscribers
   */
  public getChannelSubscribers(channel: string): string[] {
    const subs = this.channelSubscribers.get(channel);
    return subs ? Array.from(subs) : [];
  }

  /**
   * Check if socket is subscribed to channel
   */
  public isSubscribed(socketId: string, channel: string): boolean {
    const subs = this.subscriptions.get(socketId);
    return subs ? subs.has(channel) : false;
  }

  /**
   * Get subscription details
   */
  public getSubscriptionDetails(socketId: string, channel: string): Subscription | undefined {
    const key = `${socketId}:${channel}`;
    return this.subscriptionDetails.get(key);
  }

  /**
   * Get subscription count for socket
   */
  public getSubscriptionCount(socketId: string): number {
    const subs = this.subscriptions.get(socketId);
    return subs ? subs.size : 0;
  }

  /**
   * Get subscriber count for channel
   */
  public getSubscriberCount(channel: string): number {
    const subs = this.channelSubscribers.get(channel);
    return subs ? subs.size : 0;
  }

  /**
   * Get statistics
   */
  public getStats(): any {
    const totalSubscriptions = Array.from(this.subscriptions.values())
      .reduce((sum, subs) => sum + subs.size, 0);

    const popularChannels = Array.from(this.channelSubscribers.entries())
      .map(([channel, subs]) => ({ channel, subscribers: subs.size }))
      .sort((a, b) => b.subscribers - a.subscribers)
      .slice(0, 10);

    return {
      totalConnections: this.subscriptions.size,
      totalSubscriptions,
      totalChannels: this.channelSubscribers.size,
      averageSubscriptionsPerConnection: 
        this.subscriptions.size > 0 ? totalSubscriptions / this.subscriptions.size : 0,
      popularChannels,
    };
  }

  /**
   * Clean up orphaned subscriptions
   */
  public cleanup(): number {
    let cleaned = 0;
    
    // Clean up subscription details that don't have corresponding entries
    for (const [key, sub] of this.subscriptionDetails.entries()) {
      const socketSubs = this.subscriptions.get(sub.socketId);
      if (!socketSubs || !socketSubs.has(sub.channel)) {
        this.subscriptionDetails.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} orphaned subscription details`);
    }

    return cleaned;
  }
}