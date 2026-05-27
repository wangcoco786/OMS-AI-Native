/**
 * KPI Aggregator Service
 *
 * Aggregates KPI data from the orders table by hour/day/week granularity:
 * - orderCount: Total number of orders in the period
 * - fulfillmentRate: Percentage of orders fulfilled
 * - returnRate: Percentage of orders returned
 * - avgProcessingTime: Average time from order creation to fulfillment (minutes)
 *
 * Writes aggregated results to the kpi_aggregations table and caches in Redis.
 */

import pino from 'pino';

import type { PostgresDatabaseService } from '../../infrastructure/database/database-service.js';
import type { RedisCacheService } from '../../infrastructure/database/redis-service.js';
import type { TimeGranularity, TimePeriod, DimensionFilter, MetricUpdate } from '../../shared/m2-types.js';

/** Cache TTL configuration by granularity (in seconds) */
export const CACHE_TTL: Record<string, number> = {
  realtime: 60,
  hourly: 300,
  daily: 3600,
  weekly: 21600,
};

/** Metric names stored in kpi_aggregations */
export const KPI_METRICS = ['order_count', 'fulfillment_rate', 'return_rate', 'avg_processing_time'] as const;
export type KPIMetricName = (typeof KPI_METRICS)[number];

/** Aggregation result for a single metric */
export interface AggregationResult {
  metricName: KPIMetricName;
  value: number;
  periodStart: Date;
  periodEnd: Date;
  granularity: TimeGranularity;
  dimensions: DimensionFilter;
}

/** Dependencies for KPIAggregator */
export interface KPIAggregatorDeps {
  db: PostgresDatabaseService;
  redis: RedisCacheService;
  logger?: pino.Logger;
}

/** Callback for metric update notifications */
export type MetricUpdateCallback = (update: MetricUpdate) => void;

/**
 * KPIAggregator computes KPI metrics from the orders table
 * and stores them in the kpi_aggregations table with Redis caching.
 */
export class KPIAggregator {
  private readonly db: PostgresDatabaseService;
  private readonly redis: RedisCacheService;
  private readonly logger: pino.Logger;
  private onUpdateCallback?: MetricUpdateCallback;

  constructor(deps: KPIAggregatorDeps) {
    this.db = deps.db;
    this.redis = deps.redis;
    this.logger = (deps.logger ?? pino({ name: 'dashboard' })).child({ component: 'kpi-aggregator' });
  }

  /**
   * Register a callback for metric update notifications (used by SSE).
   */
  onUpdate(callback: MetricUpdateCallback): void {
    this.onUpdateCallback = callback;
  }

  /**
   * Aggregate KPI data for a given period and granularity.
   * Computes metrics from the orders table and writes to kpi_aggregations.
   */
  async aggregate(
    tenantId: string,
    period: TimePeriod,
    dimensions?: DimensionFilter,
  ): Promise<AggregationResult[]> {
    this.logger.info({ tenantId, period, dimensions }, 'Starting KPI aggregation');

    const results: AggregationResult[] = [];

    // Generate time buckets based on granularity
    const buckets = this.generateTimeBuckets(period);

    for (const bucket of buckets) {
      const metrics = await this.computeMetricsForBucket(tenantId, bucket.start, bucket.end, dimensions);

      for (const metric of metrics) {
        const result: AggregationResult = {
          metricName: metric.name,
          value: metric.value,
          periodStart: bucket.start,
          periodEnd: bucket.end,
          granularity: period.granularity,
          dimensions: dimensions ?? {},
        };
        results.push(result);

        // Persist to kpi_aggregations table
        await this.persistAggregation(tenantId, result);

        // Cache the result
        await this.cacheAggregation(tenantId, result);
      }
    }

    // Notify subscribers of the update
    if (this.onUpdateCallback) {
      for (const result of results) {
        this.onUpdateCallback({
          metric: result.metricName,
          value: result.value,
          timestamp: new Date(),
          tenantId,
          dimensions: result.dimensions,
        });
      }
    }

    this.logger.info({ tenantId, resultCount: results.length }, 'KPI aggregation complete');
    return results;
  }

  /**
   * Get the cache TTL for a given granularity.
   */
  getCacheTTL(granularity: TimeGranularity): number {
    switch (granularity) {
      case 'hour':
        return CACHE_TTL.hourly;
      case 'day':
        return CACHE_TTL.daily;
      case 'week':
        return CACHE_TTL.weekly;
      default:
        return CACHE_TTL.realtime;
    }
  }

  /**
   * Build a cache key for a KPI aggregation.
   */
  buildCacheKey(tenantId: string, metricName: string, granularity: TimeGranularity, periodStart: Date): string {
    return `kpi:${tenantId}:${metricName}:${granularity}:${periodStart.toISOString()}`;
  }

  // --- Private Methods ---

  /**
   * Generate time buckets for the given period based on granularity.
   */
  private generateTimeBuckets(period: TimePeriod): Array<{ start: Date; end: Date }> {
    const buckets: Array<{ start: Date; end: Date }> = [];
    let current = new Date(period.start);
    const end = new Date(period.end);

    while (current < end) {
      const bucketEnd = this.getNextBucketEnd(current, period.granularity);
      const actualEnd = bucketEnd > end ? end : bucketEnd;
      buckets.push({ start: new Date(current), end: actualEnd });
      current = bucketEnd;
    }

    return buckets;
  }

  /**
   * Get the end of the next time bucket based on granularity.
   */
  private getNextBucketEnd(start: Date, granularity: TimeGranularity): Date {
    const result = new Date(start);
    switch (granularity) {
      case 'hour':
        result.setHours(result.getHours() + 1);
        break;
      case 'day':
        result.setDate(result.getDate() + 1);
        break;
      case 'week':
        result.setDate(result.getDate() + 7);
        break;
    }
    return result;
  }

  /**
   * Compute all KPI metrics for a single time bucket.
   */
  private async computeMetricsForBucket(
    tenantId: string,
    start: Date,
    end: Date,
    dimensions?: DimensionFilter,
  ): Promise<Array<{ name: KPIMetricName; value: number }>> {
    const dimensionClauses = this.buildDimensionClauses(dimensions);
    const params: unknown[] = [start.toISOString(), end.toISOString()];
    let paramIndex = 3; // tenant_id will be injected by db service

    let dimensionSql = '';
    if (dimensionClauses.length > 0) {
      for (const clause of dimensionClauses) {
        dimensionSql += ` AND ${clause.sql}`;
        if (clause.value !== undefined) {
          params.push(clause.value);
          // Replace placeholder in clause
          dimensionSql = dimensionSql.replace(`$PARAM`, `$${paramIndex}`);
          paramIndex++;
        }
      }
    }

    // Query order count
    const countSql = `SELECT COUNT(*) as count FROM orders WHERE created_at >= $1 AND created_at < $2${dimensionSql}`;
    const countResult = await this.db.query<{ count: string }>(countSql, params, tenantId);
    const orderCount = parseInt(countResult[0]?.count ?? '0', 10);

    // Query fulfillment rate
    const fulfillmentSql = `SELECT 
      COUNT(*) FILTER (WHERE status = 'fulfilled') as fulfilled,
      COUNT(*) as total
      FROM orders WHERE created_at >= $1 AND created_at < $2${dimensionSql}`;
    const fulfillmentResult = await this.db.query<{ fulfilled: string; total: string }>(fulfillmentSql, params, tenantId);
    const fulfilled = parseInt(fulfillmentResult[0]?.fulfilled ?? '0', 10);
    const total = parseInt(fulfillmentResult[0]?.total ?? '0', 10);
    const fulfillmentRate = total > 0 ? (fulfilled / total) * 100 : 0;

    // Query return rate
    const returnSql = `SELECT 
      COUNT(*) FILTER (WHERE status = 'returned') as returned,
      COUNT(*) as total
      FROM orders WHERE created_at >= $1 AND created_at < $2${dimensionSql}`;
    const returnResult = await this.db.query<{ returned: string; total: string }>(returnSql, params, tenantId);
    const returned = parseInt(returnResult[0]?.returned ?? '0', 10);
    const returnTotal = parseInt(returnResult[0]?.total ?? '0', 10);
    const returnRate = returnTotal > 0 ? (returned / returnTotal) * 100 : 0;

    // Query average processing time (minutes)
    const avgTimeSql = `SELECT 
      AVG(EXTRACT(EPOCH FROM (fulfilled_at - created_at)) / 60) as avg_time
      FROM orders WHERE created_at >= $1 AND created_at < $2 AND fulfilled_at IS NOT NULL${dimensionSql}`;
    const avgTimeResult = await this.db.query<{ avg_time: string | null }>(avgTimeSql, params, tenantId);
    const avgProcessingTime = parseFloat(avgTimeResult[0]?.avg_time ?? '0') || 0;

    return [
      { name: 'order_count', value: orderCount },
      { name: 'fulfillment_rate', value: Math.round(fulfillmentRate * 100) / 100 },
      { name: 'return_rate', value: Math.round(returnRate * 100) / 100 },
      { name: 'avg_processing_time', value: Math.round(avgProcessingTime * 100) / 100 },
    ];
  }

  /**
   * Build SQL dimension filter clauses.
   */
  private buildDimensionClauses(dimensions?: DimensionFilter): Array<{ sql: string; value?: string }> {
    const clauses: Array<{ sql: string; value?: string }> = [];
    if (!dimensions) return clauses;

    if (dimensions.shopId) {
      clauses.push({ sql: `shop_id = $PARAM`, value: dimensions.shopId });
    }
    if (dimensions.channelId) {
      clauses.push({ sql: `channel_id = $PARAM`, value: dimensions.channelId });
    }
    if (dimensions.warehouseId) {
      clauses.push({ sql: `warehouse_id = $PARAM`, value: dimensions.warehouseId });
    }

    return clauses;
  }

  /**
   * Persist an aggregation result to the kpi_aggregations table.
   */
  private async persistAggregation(tenantId: string, result: AggregationResult): Promise<void> {
    try {
      const sql = `
        INSERT INTO kpi_aggregations (tenant_id, metric_name, granularity, period_start, period_end, value, dimensions)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (tenant_id, metric_name, granularity, period_start, dimensions)
        DO UPDATE SET value = EXCLUDED.value
      `;
      const params = [
        tenantId,
        result.metricName,
        result.granularity,
        result.periodStart.toISOString(),
        result.periodEnd.toISOString(),
        result.value,
        JSON.stringify(result.dimensions),
      ];

      await this.db.transaction(async (tx) => {
        await tx.query(sql, params);
      }, tenantId);
    } catch (error) {
      this.logger.error({ error, tenantId, result }, 'Failed to persist KPI aggregation');
    }
  }

  /**
   * Cache an aggregation result in Redis.
   */
  private async cacheAggregation(tenantId: string, result: AggregationResult): Promise<void> {
    try {
      const key = this.buildCacheKey(tenantId, result.metricName, result.granularity, result.periodStart);
      const ttl = this.getCacheTTL(result.granularity);
      await this.redis.cacheSet(key, { value: result.value, dimensions: result.dimensions }, ttl);
    } catch (error) {
      this.logger.warn({ error, tenantId }, 'Failed to cache KPI aggregation (non-fatal)');
    }
  }
}
