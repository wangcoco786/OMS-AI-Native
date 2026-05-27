/**
 * Dashboard SSE (Server-Sent Events) Service
 *
 * Reuses the M1 SSE Manager to provide real-time metric updates
 * to dashboard clients. Supports:
 * - Metric subscription: clients subscribe to specific metrics
 * - Change notification: pushes updates when KPI aggregation completes
 * - Tenant-scoped streams: each stream is isolated by tenant
 */

import type { Response } from 'express';
import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';

import type { MetricUpdate } from '../../shared/m2-types.js';

/** A dashboard SSE subscription */
export interface DashboardSubscription {
  id: string;
  tenantId: string;
  metrics: string[];
  res: Response;
  createdAt: Date;
  lastActivityAt: Date;
}

/** Configuration for Dashboard SSE */
export interface DashboardSSEConfig {
  /** Heartbeat interval in milliseconds (default: 15000) */
  heartbeatIntervalMs?: number;
  /** Idle timeout in milliseconds (default: 30 minutes) */
  idleTimeoutMs?: number;
}

/** Default configuration */
const DEFAULTS: Required<DashboardSSEConfig> = {
  heartbeatIntervalMs: 15_000,
  idleTimeoutMs: 30 * 60 * 1000,
};

/**
 * DashboardSSE manages Server-Sent Event streams for real-time
 * dashboard metric updates.
 */
export class DashboardSSE {
  /** Active subscriptions by subscription ID */
  private readonly subscriptions: Map<string, DashboardSubscription> = new Map();
  /** Heartbeat timers by subscription ID */
  private readonly heartbeatTimers: Map<string, NodeJS.Timeout> = new Map();
  /** Idle timers by subscription ID */
  private readonly idleTimers: Map<string, NodeJS.Timeout> = new Map();

  private readonly config: Required<DashboardSSEConfig>;
  private readonly logger: pino.Logger;

  constructor(config?: DashboardSSEConfig, logger?: pino.Logger) {
    this.config = { ...DEFAULTS, ...config };
    this.logger = (logger ?? pino({ name: 'dashboard' })).child({ component: 'dashboard-sse' });
  }

  /**
   * Create a new SSE subscription for a tenant.
   * Sets appropriate SSE headers and returns the subscription handle.
   */
  subscribe(res: Response, tenantId: string, metrics: string[]): DashboardSubscription {
    const id = uuidv4();
    const now = new Date();

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const subscription: DashboardSubscription = {
      id,
      tenantId,
      metrics,
      res,
      createdAt: now,
      lastActivityAt: now,
    };

    this.subscriptions.set(id, subscription);

    // Start heartbeat
    this.startHeartbeat(subscription);

    // Set idle timeout
    this.resetIdleTimer(subscription);

    // Handle client disconnect
    res.on('close', () => {
      this.unsubscribe(id);
      this.logger.debug({ subscriptionId: id, tenantId }, 'Dashboard SSE client disconnected');
    });

    // Send initial connection event
    this.sendEvent(subscription, 'connected', { subscriptionId: id, metrics });

    this.logger.info({ subscriptionId: id, tenantId, metrics }, 'Dashboard SSE subscription created');

    return subscription;
  }

  /**
   * Remove a subscription and clean up resources.
   */
  unsubscribe(subscriptionId: string): void {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return;

    // Clear timers
    const heartbeat = this.heartbeatTimers.get(subscriptionId);
    if (heartbeat) {
      clearInterval(heartbeat);
      this.heartbeatTimers.delete(subscriptionId);
    }

    const idle = this.idleTimers.get(subscriptionId);
    if (idle) {
      clearTimeout(idle);
      this.idleTimers.delete(subscriptionId);
    }

    // End the response
    try {
      sub.res.end();
    } catch {
      // Stream may already be closed
    }

    this.subscriptions.delete(subscriptionId);
  }

  /**
   * Notify all relevant subscribers of a metric update.
   * Only sends to subscriptions that match the tenant and subscribed metrics.
   */
  notifyMetricUpdate(update: MetricUpdate): void {
    for (const [, subscription] of this.subscriptions) {
      // Check tenant isolation
      if (subscription.tenantId !== update.tenantId) continue;

      // Check if the subscription includes this metric
      if (subscription.metrics.length > 0 && !subscription.metrics.includes(update.metric)) {
        continue;
      }

      this.sendEvent(subscription, 'metric_update', update);
      subscription.lastActivityAt = new Date();
      this.resetIdleTimer(subscription);
    }
  }

  /**
   * Broadcast an event to all subscriptions for a tenant.
   */
  broadcastToTenant(tenantId: string, eventType: string, data: unknown): void {
    for (const [, subscription] of this.subscriptions) {
      if (subscription.tenantId !== tenantId) continue;
      this.sendEvent(subscription, eventType, data);
      subscription.lastActivityAt = new Date();
    }
  }

  /**
   * Get the number of active subscriptions.
   */
  getActiveSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Get subscriptions for a specific tenant.
   */
  getSubscriptionsForTenant(tenantId: string): DashboardSubscription[] {
    const result: DashboardSubscription[] = [];
    for (const [, sub] of this.subscriptions) {
      if (sub.tenantId === tenantId) {
        result.push(sub);
      }
    }
    return result;
  }

  /**
   * Gracefully shut down all subscriptions.
   */
  shutdown(): void {
    for (const [id] of this.subscriptions) {
      this.unsubscribe(id);
    }
    this.logger.info('Dashboard SSE shut down');
  }

  // --- Private Methods ---

  /**
   * Send an SSE event to a subscription.
   */
  private sendEvent(subscription: DashboardSubscription, eventType: string, data: unknown): void {
    try {
      const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
      subscription.res.write(message);
    } catch (error) {
      this.logger.error({ error, subscriptionId: subscription.id }, 'Failed to send SSE event');
      this.unsubscribe(subscription.id);
    }
  }

  /**
   * Start sending heartbeat comments to keep the connection alive.
   */
  private startHeartbeat(subscription: DashboardSubscription): void {
    const timer = setInterval(() => {
      if (!this.subscriptions.has(subscription.id)) {
        clearInterval(timer);
        return;
      }

      try {
        subscription.res.write(`: heartbeat\n\n`);
      } catch {
        this.unsubscribe(subscription.id);
      }
    }, this.config.heartbeatIntervalMs);

    if (timer.unref) timer.unref();
    this.heartbeatTimers.set(subscription.id, timer);
  }

  /**
   * Reset the idle timer for a subscription.
   */
  private resetIdleTimer(subscription: DashboardSubscription): void {
    const existing = this.idleTimers.get(subscription.id);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.logger.info({ subscriptionId: subscription.id }, 'Dashboard SSE idle timeout, closing');
      this.unsubscribe(subscription.id);
    }, this.config.idleTimeoutMs);

    if (timer.unref) timer.unref();
    this.idleTimers.set(subscription.id, timer);
  }
}
