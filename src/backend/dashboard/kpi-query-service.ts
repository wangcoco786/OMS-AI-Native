/**
 * KPI Query Service
 *
 * Queries the kpi_aggregations table for pre-computed KPI data.
 * Supports:
 * - Dimension filtering (shopId, channelId, warehouseId)
 * - Time period and granularity selection
 * - Redis cache with fallback to database
 * - Trend data retrieval with anomaly markers
 */

import pino from 'pino';

import type { PostgresDatabaseService } from '../../infrastructure/database/database-service.js';
import type { RedisCacheService } from '../../infrastructure/database/redis-service.js';
import type {
  KPIMetrics,
  TimePeriod,
  DimensionFilter,
  TrendDataPoint,
} from '../../shared/m2-types.js';
import { CACHE_TTL, type KPIMetricName } from './kpi-aggregator.js';
import type { AnomalyDetector } from './anomaly-detector.js';

/** Dependencies for KPIQueryService */
export interface KPIQueryServiceDeps {
  db: PostgresDatabaseService;
  redis: RedisCacheService;
  anomalyDetector?: AnomalyDetector;
  logger?: pino.Logger;
}

/** Raw row from kpi_aggregations table */
interface KPIAggregationRow {
  metric_name: string;
  granularity: string;
  period_start: string;
  period_end: string;
  value: string;
  dimensions: string;
}

/**
 * KPIQueryService provides read access to pre-aggregated KPI data
 * with Redis caching and dimension filtering.
 */
export class KPIQueryService {
  private readonly db: PostgresDatabaseService;
  private readonly redis: RedisCacheService;
  private readonly anomalyDetector?: AnomalyDetector;
  private readonly logger: pino.Logger;

  constructor(deps: KPIQueryServiceDeps) {
    this.db = deps.db;
    this.redis = deps.redis;
    this.anomalyDetector = deps.anomalyDetector;
    this.logger = (deps.logger ?? pino({ name: 'dashboard' })).child({ component: 'kpi-query-service' });
  }

  /**
   * Get KPI metrics for a given period and optional dimension filter.
   * Returns aggregated values for all 4 core metrics.
   */
  async getKPIMetrics(
    tenantId: string,
    period: TimePeriod,
    filter?: DimensionFilter,
  ): Promise<KPIMetrics> {
    this.logger.debug({ tenantId, period, filter }, 'Querying KPI metrics');

    // Try cache first
    const cacheKey = this.buildMetricsCacheKey(tenantId, period, filter);
    const cached = await this.tryGetFromCache<KPIMetrics>(cacheKey);
    if (cached) {
      this.logger.debug({ tenantId }, 'KPI metrics served from cache');
      return cached;
    }

    // Query from database
    const rows = await this.queryAggregations(tenantId, period, filter);

    // Build KPIMetrics from rows
    const metrics = this.buildKPIMetrics(rows, period, filter);

    // Cache the result
    const ttl = this.getCacheTTLForGranularity(period.granularity);
    await this.cacheResult(cacheKey, metrics, ttl);

    return metrics;
  }

  /**
   * Get trend data for a specific metric over a time period.
   * Returns data points with optional anomaly markers.
   */
  async getKPITrend(
    tenantId: string,
    metric: string,
    period: TimePeriod,
    filter?: DimensionFilter,
  ): Promise<TrendDataPoint[]> {
    this.logger.debug({ tenantId, metric, period, filter }, 'Querying KPI trend');

    // Try cache first
    const cacheKey = `kpi_trend:${tenantId}:${metric}:${period.granularity}:${period.start.toISOString()}:${period.end.toISOString()}:${JSON.stringify(filter ?? {})}`;
    const cached = await this.tryGetFromCache<TrendDataPoint[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // Query trend data from kpi_aggregations
    const metricName = this.normalizeMetricName(metric);
    const rows = await this.queryTrendData(tenantId, metricName, period, filter);

    // Convert to TrendDataPoint array
    const dataPoints: TrendDataPoint[] = rows.map((row) => ({
      timestamp: new Date(row.period_start),
      value: parseFloat(row.value),
    }));

    // Apply anomaly detection if available
    if (this.anomalyDetector && dataPoints.length > 0) {
      const values = dataPoints.map((dp) => dp.value);
      const anomalies = this.anomalyDetector.detect(values);
      for (let i = 0; i < dataPoints.length; i++) {
        dataPoints[i].anomaly = anomalies[i];
      }
    }

    // Cache the result
    const ttl = this.getCacheTTLForGranularity(period.granularity);
    await this.cacheResult(cacheKey, dataPoints, ttl);

    return dataPoints;
  }

  // --- Private Methods ---

  /**
   * Query kpi_aggregations table with filters.
   */
  private async queryAggregations(
    tenantId: string,
    period: TimePeriod,
    filter?: DimensionFilter,
  ): Promise<KPIAggregationRow[]> {
    let sql = `
      SELECT metric_name, granularity, period_start, period_end, value, dimensions
      FROM kpi_aggregations
      WHERE period_start >= $1 AND period_end <= $2 AND granularity = $3
    `;
    const params: unknown[] = [period.start.toISOString(), period.end.toISOString(), period.granularity];

    // Add dimension filters
    if (filter) {
      const dimensionJson = this.buildDimensionJsonFilter(filter);
      if (dimensionJson) {
        sql += ` AND dimensions @> $${params.length + 1}::jsonb`;
        params.push(dimensionJson);
      }
    }

    sql += ' ORDER BY period_start ASC';

    return this.db.query<KPIAggregationRow>(sql, params, tenantId);
  }

  /**
   * Query trend data for a specific metric.
   */
  private async queryTrendData(
    tenantId: string,
    metricName: string,
    period: TimePeriod,
    filter?: DimensionFilter,
  ): Promise<KPIAggregationRow[]> {
    let sql = `
      SELECT metric_name, granularity, period_start, period_end, value, dimensions
      FROM kpi_aggregations
      WHERE metric_name = $1 AND period_start >= $2 AND period_end <= $3 AND granularity = $4
    `;
    const params: unknown[] = [metricName, period.start.toISOString(), period.end.toISOString(), period.granularity];

    if (filter) {
      const dimensionJson = this.buildDimensionJsonFilter(filter);
      if (dimensionJson) {
        sql += ` AND dimensions @> $${params.length + 1}::jsonb`;
        params.push(dimensionJson);
      }
    }

    sql += ' ORDER BY period_start ASC';

    return this.db.query<KPIAggregationRow>(sql, params, tenantId);
  }

  /**
   * Build KPIMetrics from aggregation rows.
   */
  private buildKPIMetrics(
    rows: KPIAggregationRow[],
    period: TimePeriod,
    filter?: DimensionFilter,
  ): KPIMetrics {
    // Sum/average metrics across all time buckets
    let orderCount = 0;
    let fulfillmentRateSum = 0;
    let fulfillmentRateCount = 0;
    let returnRateSum = 0;
    let returnRateCount = 0;
    let avgProcessingTimeSum = 0;
    let avgProcessingTimeCount = 0;

    for (const row of rows) {
      const value = parseFloat(row.value);
      switch (row.metric_name) {
        case 'order_count':
          orderCount += value;
          break;
        case 'fulfillment_rate':
          fulfillmentRateSum += value;
          fulfillmentRateCount++;
          break;
        case 'return_rate':
          returnRateSum += value;
          returnRateCount++;
          break;
        case 'avg_processing_time':
          avgProcessingTimeSum += value;
          avgProcessingTimeCount++;
          break;
      }
    }

    return {
      orderCount,
      fulfillmentRate: fulfillmentRateCount > 0
        ? Math.round((fulfillmentRateSum / fulfillmentRateCount) * 100) / 100
        : 0,
      returnRate: returnRateCount > 0
        ? Math.round((returnRateSum / returnRateCount) * 100) / 100
        : 0,
      avgProcessingTime: avgProcessingTimeCount > 0
        ? Math.round((avgProcessingTimeSum / avgProcessingTimeCount) * 100) / 100
        : 0,
      period,
      dimensions: filter,
    };
  }

  /**
   * Build a JSONB filter for dimension matching.
   */
  private buildDimensionJsonFilter(filter: DimensionFilter): string | null {
    const obj: Record<string, string> = {};
    if (filter.shopId) obj.shopId = filter.shopId;
    if (filter.channelId) obj.channelId = filter.channelId;
    if (filter.warehouseId) obj.warehouseId = filter.warehouseId;

    if (Object.keys(obj).length === 0) return null;
    return JSON.stringify(obj);
  }

  /**
   * Normalize a metric name to the database format.
   */
  private normalizeMetricName(metric: string): KPIMetricName {
    const mapping: Record<string, KPIMetricName> = {
      orderCount: 'order_count',
      order_count: 'order_count',
      fulfillmentRate: 'fulfillment_rate',
      fulfillment_rate: 'fulfillment_rate',
      returnRate: 'return_rate',
      return_rate: 'return_rate',
      avgProcessingTime: 'avg_processing_time',
      avg_processing_time: 'avg_processing_time',
    };
    return mapping[metric] ?? (metric as KPIMetricName);
  }

  /**
   * Build a cache key for KPI metrics.
   */
  private buildMetricsCacheKey(tenantId: string, period: TimePeriod, filter?: DimensionFilter): string {
    return `kpi_metrics:${tenantId}:${period.granularity}:${period.start.toISOString()}:${period.end.toISOString()}:${JSON.stringify(filter ?? {})}`;
  }

  /**
   * Get cache TTL based on granularity.
   */
  private getCacheTTLForGranularity(granularity: string): number {
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
   * Try to get a value from Redis cache.
   */
  private async tryGetFromCache<T>(key: string): Promise<T | null> {
    try {
      return await this.redis.cacheGet<T>(key);
    } catch {
      this.logger.warn({ key }, 'Cache read failed (non-fatal)');
      return null;
    }
  }

  /**
   * Cache a result in Redis.
   */
  private async cacheResult(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.cacheSet(key, value, ttlSeconds);
    } catch {
      this.logger.warn({ key }, 'Cache write failed (non-fatal)');
    }
  }
}
