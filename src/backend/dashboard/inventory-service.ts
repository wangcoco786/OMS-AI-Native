/**
 * Inventory Service
 *
 * Queries warehouse inventory levels and computes:
 * - utilizationRate: currentStock / maxCapacity × 100
 * - belowSafetyThreshold: currentStock < safetyThreshold
 * - Inventory trend data over time
 *
 * Enforces tenant isolation on all queries.
 */

import pino from 'pino';

import type { PostgresDatabaseService } from '../../infrastructure/database/database-service.js';
import type { RedisCacheService } from '../../infrastructure/database/redis-service.js';
import type { InventoryLevel, TrendDataPoint, TimePeriod } from '../../shared/m2-types.js';
import { CACHE_TTL } from './kpi-aggregator.js';

/** Dependencies for InventoryService */
export interface InventoryServiceDeps {
  db: PostgresDatabaseService;
  redis: RedisCacheService;
  logger?: pino.Logger;
}

/** Raw inventory row from database */
interface InventoryRow {
  warehouse_id: string;
  warehouse_name: string;
  current_stock: string;
  max_capacity: string;
  safety_threshold: string;
  turnover_rate: string;
}

/** Raw inventory trend row */
interface InventoryTrendRow {
  recorded_at: string;
  quantity: string;
}

/**
 * InventoryService provides warehouse inventory level queries
 * with utilization rate and safety threshold calculations.
 */
export class InventoryService {
  private readonly db: PostgresDatabaseService;
  private readonly redis: RedisCacheService;
  private readonly logger: pino.Logger;

  constructor(deps: InventoryServiceDeps) {
    this.db = deps.db;
    this.redis = deps.redis;
    this.logger = (deps.logger ?? pino({ name: 'dashboard' })).child({ component: 'inventory-service' });
  }

  /**
   * Get inventory levels for all warehouses (or a specific warehouse).
   * Computes utilizationRate and belowSafetyThreshold for each warehouse.
   */
  async getInventoryLevels(tenantId: string, warehouseId?: string): Promise<InventoryLevel[]> {
    this.logger.debug({ tenantId, warehouseId }, 'Querying inventory levels');

    // Try cache first
    const cacheKey = `inventory_levels:${tenantId}:${warehouseId ?? 'all'}`;
    const cached = await this.tryGetFromCache<InventoryLevel[]>(cacheKey);
    if (cached) {
      return cached;
    }

    let sql = `
      SELECT 
        w.id as warehouse_id,
        w.name as warehouse_name,
        COALESCE(SUM(i.quantity), 0) as current_stock,
        COALESCE(w.max_capacity, 0) as max_capacity,
        COALESCE(MIN(i.safety_threshold), 0) as safety_threshold,
        COALESCE(
          CASE WHEN COALESCE(SUM(i.quantity), 0) > 0 
            THEN ROUND(CAST(COUNT(DISTINCT i.system_sku_id) AS DECIMAL) / NULLIF(SUM(i.quantity), 0) * 100, 2)
            ELSE 0 
          END, 0
        ) as turnover_rate
      FROM warehouses w
      LEFT JOIN inventory i ON w.id::text = i.warehouse_id AND i.tenant_id = w.tenant_id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (warehouseId) {
      params.push(warehouseId);
      sql += ` AND w.id = $${params.length}`;
    }

    sql += ' GROUP BY w.id, w.name, w.max_capacity';

    const rows = await this.db.query<InventoryRow>(sql, params, tenantId);

    const levels: InventoryLevel[] = rows.map((row) => {
      const currentStock = parseInt(row.current_stock, 10);
      const maxCapacity = parseInt(row.max_capacity, 10);
      const safetyThreshold = parseInt(row.safety_threshold, 10);
      const turnoverRate = parseFloat(row.turnover_rate);

      return {
        warehouseId: row.warehouse_id,
        warehouseName: row.warehouse_name,
        currentStock,
        maxCapacity,
        utilizationRate: maxCapacity > 0
          ? Math.round((currentStock / maxCapacity) * 100 * 100) / 100
          : 0,
        turnoverRate,
        belowSafetyThreshold: currentStock < safetyThreshold,
      };
    });

    // Cache for 60 seconds (realtime)
    await this.cacheResult(cacheKey, levels, CACHE_TTL.realtime);

    return levels;
  }

  /**
   * Get inventory trend data for a specific SKU over a time period.
   */
  async getInventoryTrend(
    tenantId: string,
    skuId: string,
    period: TimePeriod,
  ): Promise<TrendDataPoint[]> {
    this.logger.debug({ tenantId, skuId, period }, 'Querying inventory trend');

    const cacheKey = `inventory_trend:${tenantId}:${skuId}:${period.start.toISOString()}:${period.end.toISOString()}`;
    const cached = await this.tryGetFromCache<TrendDataPoint[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // Query inventory history/snapshots
    const sql = `
      SELECT updated_at as recorded_at, quantity
      FROM inventory
      WHERE system_sku_id = $1 AND updated_at >= $2 AND updated_at <= $3
      ORDER BY updated_at ASC
    `;
    const params = [skuId, period.start.toISOString(), period.end.toISOString()];

    const rows = await this.db.query<InventoryTrendRow>(sql, params, tenantId);

    const dataPoints: TrendDataPoint[] = rows.map((row) => ({
      timestamp: new Date(row.recorded_at),
      value: parseInt(row.quantity, 10),
    }));

    // Cache for 5 minutes
    await this.cacheResult(cacheKey, dataPoints, CACHE_TTL.hourly);

    return dataPoints;
  }

  // --- Private Methods ---

  /**
   * Try to get a value from Redis cache.
   */
  private async tryGetFromCache<T>(key: string): Promise<T | null> {
    try {
      return await this.redis.cacheGet<T>(key);
    } catch {
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
