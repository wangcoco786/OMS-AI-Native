/**
 * Message Broker Metrics Collector
 *
 * Periodically polls queue statistics from the message broker and exposes
 * aggregated metrics for external monitoring systems to collect.
 *
 * Features:
 * - Configurable polling interval (default 30s)
 * - Tracks message rates (published/consumed per interval)
 * - Queue depth threshold warnings via pino logger
 * - Start/stop lifecycle for the polling timer
 * - getAllQueueStats for fetching stats across all configured queues
 */

import pino from 'pino';

import type { MessageBrokerConfig, QueueStats } from './types.js';
import type { MessageBrokerService } from './message-broker.js';

/** Configuration for the metrics collector */
export interface MetricsConfig {
  /** Polling interval in milliseconds (default: 30000) */
  pollingIntervalMs?: number;
  /** Queue depth threshold that triggers a warning log (default: 1000) */
  queueDepthWarningThreshold?: number;
}

/** Snapshot of metrics for a single queue */
export interface QueueMetrics {
  /** Queue name */
  name: string;
  /** Current message count (depth) */
  messageCount: number;
  /** Current consumer count */
  consumerCount: number;
  /** Messages published since last poll (tracked externally via publish hooks) */
  publishedRate: number;
  /** Messages consumed since last poll (delta of messageCount) */
  consumedRate: number;
  /** Estimated consumer lag: messageCount when consumers are present */
  consumerLag: number;
  /** Timestamp of last poll */
  lastPolledAt: string;
}

/** Aggregated metrics across all queues */
export interface BrokerMetrics {
  /** Per-queue metrics */
  queues: QueueMetrics[];
  /** Total messages across all queues */
  totalMessages: number;
  /** Total consumers across all queues */
  totalConsumers: number;
  /** Whether the collector is actively polling */
  isPolling: boolean;
  /** Timestamp of the metrics snapshot */
  collectedAt: string;
}

const DEFAULTS = {
  pollingIntervalMs: 30000,
  queueDepthWarningThreshold: 1000,
} as const;

/**
 * MessageBrokerMetrics collects and exposes queue monitoring metrics.
 *
 * Usage:
 *   const metrics = new MessageBrokerMetrics(broker, brokerConfig);
 *   metrics.start();
 *   // ... later
 *   const snapshot = metrics.getMetrics();
 *   metrics.stop();
 */
export class MessageBrokerMetrics {
  private readonly broker: MessageBrokerService;
  private readonly config: MessageBrokerConfig;
  private readonly metricsConfig: Required<MetricsConfig>;
  private readonly logger: pino.Logger;

  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private previousStats: Map<string, QueueStats> = new Map();
  private currentMetrics: Map<string, QueueMetrics> = new Map();
  private publishCounts: Map<string, number> = new Map();
  private isRunning = false;

  constructor(
    broker: MessageBrokerService,
    config: MessageBrokerConfig,
    options?: { logger?: pino.Logger; metricsConfig?: MetricsConfig },
  ) {
    this.broker = broker;
    this.config = config;
    this.logger = (options?.logger ?? pino({ name: 'message-broker-metrics' })).child({
      component: 'metrics',
    });
    this.metricsConfig = {
      pollingIntervalMs: options?.metricsConfig?.pollingIntervalMs ?? DEFAULTS.pollingIntervalMs,
      queueDepthWarningThreshold:
        options?.metricsConfig?.queueDepthWarningThreshold ?? DEFAULTS.queueDepthWarningThreshold,
    };
  }

  /**
   * Start the periodic metrics collection.
   */
  start(): void {
    if (this.isRunning) {
      this.logger.warn('Metrics collector is already running');
      return;
    }

    this.isRunning = true;
    this.logger.info(
      { intervalMs: this.metricsConfig.pollingIntervalMs },
      'Starting metrics collector',
    );

    // Perform an initial poll immediately
    void this.poll();

    this.pollingTimer = setInterval(() => {
      void this.poll();
    }, this.metricsConfig.pollingIntervalMs);
  }

  /**
   * Stop the periodic metrics collection.
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }

    this.logger.info('Metrics collector stopped');
  }

  /**
   * Record a publish event for rate tracking.
   * Call this when a message is published to track publish rates.
   */
  recordPublish(queueOrRoutingKey: string): void {
    const current = this.publishCounts.get(queueOrRoutingKey) ?? 0;
    this.publishCounts.set(queueOrRoutingKey, current + 1);
  }

  /**
   * Get stats for all configured queues.
   */
  async getAllQueueStats(): Promise<QueueStats[]> {
    const stats: QueueStats[] = [];

    for (const queue of this.config.queues) {
      try {
        const queueStats = await this.broker.getQueueStats(queue.name);
        stats.push(queueStats);
      } catch (error) {
        this.logger.warn(
          { queue: queue.name, error },
          'Failed to get stats for queue',
        );
      }
    }

    return stats;
  }

  /**
   * Get the current aggregated metrics snapshot.
   */
  getMetrics(): BrokerMetrics {
    const queues = Array.from(this.currentMetrics.values());
    const totalMessages = queues.reduce((sum, q) => sum + q.messageCount, 0);
    const totalConsumers = queues.reduce((sum, q) => sum + q.consumerCount, 0);

    return {
      queues,
      totalMessages,
      totalConsumers,
      isPolling: this.isRunning,
      collectedAt: new Date().toISOString(),
    };
  }

  /**
   * Check if the metrics collector is currently running.
   */
  get running(): boolean {
    return this.isRunning;
  }

  // --- Private Methods ---

  /**
   * Perform a single poll of all queue stats and update metrics.
   */
  private async poll(): Promise<void> {
    try {
      const allStats = await this.getAllQueueStats();
      const now = new Date().toISOString();

      for (const stats of allStats) {
        const previous = this.previousStats.get(stats.name);
        const publishCount = this.publishCounts.get(stats.name) ?? 0;

        // Calculate consumed rate as the difference in message count
        // If previous messageCount was higher and messages were consumed, the delta is positive
        let consumedRate = 0;
        if (previous) {
          // consumed = previous messages + new publishes - current messages
          const expectedWithoutConsumption = previous.messageCount + publishCount;
          consumedRate = Math.max(0, expectedWithoutConsumption - stats.messageCount);
        }

        // Consumer lag: messages waiting when consumers exist
        const consumerLag = stats.consumerCount > 0 ? stats.messageCount : 0;

        const queueMetrics: QueueMetrics = {
          name: stats.name,
          messageCount: stats.messageCount,
          consumerCount: stats.consumerCount,
          publishedRate: publishCount,
          consumedRate,
          consumerLag,
          lastPolledAt: now,
        };

        this.currentMetrics.set(stats.name, queueMetrics);

        // Check threshold and warn
        if (stats.messageCount >= this.metricsConfig.queueDepthWarningThreshold) {
          this.logger.warn(
            {
              queue: stats.name,
              messageCount: stats.messageCount,
              threshold: this.metricsConfig.queueDepthWarningThreshold,
            },
            'Queue depth exceeds warning threshold',
          );
        }

        // Update previous stats for next poll
        this.previousStats.set(stats.name, stats);
      }

      // Reset publish counts after each poll
      this.publishCounts.clear();
    } catch (error) {
      this.logger.error({ error }, 'Error during metrics poll');
    }
  }
}
