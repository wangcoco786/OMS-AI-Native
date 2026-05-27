/**
 * Sync Pipeline Integration
 *
 * Connects the Data Sync service to the Dashboard and MCP Tools layer:
 * 1. After sync completes, triggers KPI Aggregator to re-compute metrics
 * 2. KPI Aggregator publishes updates via the Dashboard SSE
 * 3. Invalidates MCP query cache so agents get fresh data
 *
 * This module creates the end-to-end data pipeline:
 *   Data Sync → DB write → KPI Aggregation → SSE Push → Dashboard
 *                        → Cache Invalidation → MCP Tools (fresh queries)
 *
 * Requirements: 5.1, 9.1, 10.1
 */

import pino from 'pino';

import type { KPIAggregator } from '../dashboard/kpi-aggregator.js';
import type { DashboardSSE } from '../dashboard/dashboard-sse.js';
import type { QueryCache } from '../mcp-tools/query-cache.js';
import type { SyncWorkerResult } from './sync-worker.js';
import type { TimePeriod, MetricUpdate } from '../../shared/m2-types.js';

/** Dependencies required by the SyncPipeline */
export interface SyncPipelineDeps {
  kpiAggregator: KPIAggregator;
  dashboardSSE: DashboardSSE;
  mcpQueryCache: QueryCache;
  logger?: pino.Logger;
}

/** Configuration for the sync pipeline */
export interface SyncPipelineConfig {
  /** Whether to trigger KPI aggregation after sync (default: true) */
  enableKPIAggregation?: boolean;
  /** Whether to invalidate MCP cache after sync (default: true) */
  enableCacheInvalidation?: boolean;
  /** How far back to re-aggregate after a sync (default: 1 hour in ms) */
  aggregationWindowMs?: number;
}

const DEFAULT_CONFIG: Required<SyncPipelineConfig> = {
  enableKPIAggregation: true,
  enableCacheInvalidation: true,
  aggregationWindowMs: 60 * 60 * 1000, // 1 hour
};

/**
 * SyncPipeline orchestrates the data flow from sync completion
 * through KPI aggregation and real-time notification.
 */
export class SyncPipeline {
  private readonly kpiAggregator: KPIAggregator;
  private readonly dashboardSSE: DashboardSSE;
  private readonly mcpQueryCache: QueryCache;
  private readonly logger: pino.Logger;
  private readonly config: Required<SyncPipelineConfig>;

  constructor(deps: SyncPipelineDeps, config?: SyncPipelineConfig) {
    this.kpiAggregator = deps.kpiAggregator;
    this.dashboardSSE = deps.dashboardSSE;
    this.mcpQueryCache = deps.mcpQueryCache;
    this.logger = (deps.logger ?? pino({ name: 'sync-pipeline' })).child({ component: 'sync-pipeline' });
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Wire the KPI aggregator's update callback to push through SSE
    this.kpiAggregator.onUpdate((update: MetricUpdate) => {
      this.dashboardSSE.notifyMetricUpdate(update);
    });
  }

  /**
   * Called after a sync job completes successfully.
   * Triggers the downstream pipeline: aggregation → SSE → cache invalidation.
   *
   * @param tenantId - The tenant whose data was synced
   * @param result - The sync worker result
   * @param dataType - The type of data that was synced (orders, inventory, products)
   */
  async onSyncComplete(tenantId: string, result: SyncWorkerResult, dataType: string): Promise<void> {
    if (result.status === 'failed') {
      this.logger.debug({ tenantId, runId: result.runId }, 'Skipping pipeline for failed sync');
      return;
    }

    if (result.recordsProcessed === 0) {
      this.logger.debug({ tenantId, runId: result.runId }, 'Skipping pipeline for empty sync');
      return;
    }

    this.logger.info(
      { tenantId, runId: result.runId, dataType, recordsProcessed: result.recordsProcessed },
      'Sync complete, triggering downstream pipeline',
    );

    // Run aggregation and cache invalidation in parallel
    const tasks: Promise<void>[] = [];

    if (this.config.enableKPIAggregation && this.shouldAggregate(dataType)) {
      tasks.push(this.triggerAggregation(tenantId));
    }

    if (this.config.enableCacheInvalidation) {
      tasks.push(this.invalidateMCPCache(tenantId, dataType));
    }

    // Notify dashboard of sync completion event
    tasks.push(this.notifySyncComplete(tenantId, result, dataType));

    await Promise.allSettled(tasks);

    this.logger.info({ tenantId, runId: result.runId }, 'Downstream pipeline processing complete');
  }

  /**
   * Trigger KPI aggregation for the recent time window.
   * Aggregates the last hour of data to capture the impact of newly synced records.
   */
  private async triggerAggregation(tenantId: string): Promise<void> {
    try {
      const now = new Date();
      const windowStart = new Date(now.getTime() - this.config.aggregationWindowMs);

      const period: TimePeriod = {
        start: windowStart,
        end: now,
        granularity: 'hour',
      };

      await this.kpiAggregator.aggregate(tenantId, period);

      this.logger.info({ tenantId, period }, 'KPI aggregation triggered after sync');
    } catch (error) {
      this.logger.error({ error, tenantId }, 'Failed to trigger KPI aggregation after sync');
      // Non-fatal: sync was still successful, aggregation will catch up on next cycle
    }
  }

  /**
   * Invalidate MCP query cache entries for the affected data type.
   * This ensures agents get fresh data on their next query.
   */
  private async invalidateMCPCache(tenantId: string, dataType: string): Promise<void> {
    try {
      const toolNames = this.getAffectedToolNames(dataType);

      for (const toolName of toolNames) {
        // Invalidate with empty input to clear the base cache entry
        // The QueryCache uses SHA-256 hashing, so we invalidate known patterns
        await this.mcpQueryCache.invalidate(toolName, {}, tenantId);
      }

      this.logger.debug({ tenantId, dataType, toolNames }, 'MCP cache invalidated after sync');
    } catch (error) {
      this.logger.warn({ error, tenantId, dataType }, 'Failed to invalidate MCP cache (non-fatal)');
    }
  }

  /**
   * Notify dashboard subscribers about the sync completion event.
   * This allows the dashboard to show real-time sync status.
   */
  private async notifySyncComplete(tenantId: string, result: SyncWorkerResult, dataType: string): Promise<void> {
    try {
      this.dashboardSSE.broadcastToTenant(tenantId, 'sync_complete', {
        dataType,
        recordsProcessed: result.recordsProcessed,
        recordsCreated: result.recordsCreated,
        recordsUpdated: result.recordsUpdated,
        status: result.status,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.warn({ error, tenantId }, 'Failed to notify dashboard of sync completion (non-fatal)');
    }
  }

  /**
   * Determine if KPI aggregation should be triggered for this data type.
   * Only order-related syncs affect KPI metrics.
   */
  private shouldAggregate(dataType: string): boolean {
    // Orders directly affect KPI metrics (order_count, fulfillment_rate, return_rate, avg_processing_time)
    // Inventory affects inventory dashboard but not KPI aggregation table
    return dataType === 'orders';
  }

  /**
   * Map sync data types to affected MCP tool names for cache invalidation.
   */
  private getAffectedToolNames(dataType: string): string[] {
    switch (dataType) {
      case 'orders':
        return ['query_orders'];
      case 'inventory':
        return ['query_inventory'];
      case 'products':
        return ['query_products'];
      default:
        return ['query_orders', 'query_inventory', 'query_products'];
    }
  }
}
