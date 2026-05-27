/**
 * Performance Metrics Collector
 *
 * Tracks key system metrics:
 * - Response time histogram (p50, p95, p99)
 * - Error count by type
 * - Active session count
 * - Request count
 *
 * Provides:
 * - recordResponseTime(durationMs) with alert when > 3000ms
 * - recordError(errorType) for error counting
 * - incrementSessions() / decrementSessions() for active session tracking
 * - getMetrics() for current snapshot
 * - metricsHandler for GET /metrics endpoint (Prometheus text format)
 */

import pino from 'pino';
import type { Request, Response } from 'express';

/** Snapshot of current metrics */
export interface MetricsSnapshot {
  responseTime: {
    count: number;
    p50: number;
    p95: number;
    p99: number;
  };
  errors: Record<string, number>;
  activeSessions: number;
  requestCount: number;
}

/**
 * MetricsCollector tracks system performance metrics in-memory.
 * Designed for lightweight collection with Prometheus-compatible export.
 */
export class MetricsCollector {
  private responseTimes: number[] = [];
  private errors: Map<string, number> = new Map();
  private activeSessions = 0;
  private requestCount = 0;
  private readonly logger: pino.Logger;
  private readonly alertThresholdMs: number;

  constructor(options?: { logger?: pino.Logger; alertThresholdMs?: number }) {
    this.logger = (options?.logger ?? pino({ name: 'metrics' })).child({
      component: 'metrics-collector',
    });
    this.alertThresholdMs = options?.alertThresholdMs ?? 3000;
  }

  /**
   * Record a response time measurement.
   * Triggers a performance warning if duration exceeds the alert threshold (default 3000ms).
   */
  recordResponseTime(durationMs: number): void {
    this.responseTimes.push(durationMs);
    this.requestCount++;

    if (durationMs > this.alertThresholdMs) {
      this.logger.warn(
        { durationMs, threshold: this.alertThresholdMs },
        'Performance alert: response time exceeded threshold',
      );
    }
  }

  /**
   * Record an error occurrence by type.
   */
  recordError(errorType: string): void {
    const current = this.errors.get(errorType) ?? 0;
    this.errors.set(errorType, current + 1);
  }

  /**
   * Increment the active session count.
   */
  incrementSessions(): void {
    this.activeSessions++;
  }

  /**
   * Decrement the active session count.
   */
  decrementSessions(): void {
    if (this.activeSessions > 0) {
      this.activeSessions--;
    }
  }

  /**
   * Get a snapshot of current metrics.
   */
  getMetrics(): MetricsSnapshot {
    const sorted = [...this.responseTimes].sort((a, b) => a - b);

    return {
      responseTime: {
        count: sorted.length,
        p50: this.percentile(sorted, 50),
        p95: this.percentile(sorted, 95),
        p99: this.percentile(sorted, 99),
      },
      errors: Object.fromEntries(this.errors),
      activeSessions: this.activeSessions,
      requestCount: this.requestCount,
    };
  }

  /**
   * Reset all metrics. Useful for testing or periodic resets.
   */
  reset(): void {
    this.responseTimes = [];
    this.errors.clear();
    this.activeSessions = 0;
    this.requestCount = 0;
  }

  /**
   * Express handler for GET /metrics endpoint.
   * Returns metrics in Prometheus text exposition format.
   */
  metricsHandler(_req: Request, res: Response): void {
    const metrics = this.getMetrics();
    const lines: string[] = [];

    // Response time histogram
    lines.push('# HELP oms_response_time_ms Response time in milliseconds');
    lines.push('# TYPE oms_response_time_ms summary');
    lines.push(`oms_response_time_ms{quantile="0.5"} ${metrics.responseTime.p50}`);
    lines.push(`oms_response_time_ms{quantile="0.95"} ${metrics.responseTime.p95}`);
    lines.push(`oms_response_time_ms{quantile="0.99"} ${metrics.responseTime.p99}`);
    lines.push(`oms_response_time_ms_count ${metrics.responseTime.count}`);

    // Error counts
    lines.push('# HELP oms_errors_total Total error count by type');
    lines.push('# TYPE oms_errors_total counter');
    for (const [errorType, count] of Object.entries(metrics.errors)) {
      lines.push(`oms_errors_total{type="${errorType}"} ${count}`);
    }

    // Active sessions
    lines.push('# HELP oms_active_sessions Current number of active sessions');
    lines.push('# TYPE oms_active_sessions gauge');
    lines.push(`oms_active_sessions ${metrics.activeSessions}`);

    // Request count
    lines.push('# HELP oms_requests_total Total number of requests');
    lines.push('# TYPE oms_requests_total counter');
    lines.push(`oms_requests_total ${metrics.requestCount}`);

    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(200).send(lines.join('\n') + '\n');
  }

  /**
   * Calculate a percentile value from a sorted array.
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
}
