/**
 * MCP Query Cache
 *
 * Provides Redis-based caching for high-frequency MCP data tool queries.
 * TTL is capped at 60 seconds to ensure data freshness while reducing
 * database load for repeated identical queries.
 *
 * Requirements: 10.7
 */

import pino from 'pino';
import { createHash } from 'crypto';

import type { RedisCacheService } from '../../infrastructure/database/redis-service.js';

/** Maximum TTL for cached query results (60 seconds) */
const MAX_CACHE_TTL_SECONDS = 60;

/** Key prefix for MCP query cache entries */
const CACHE_KEY_PREFIX = 'mcp:query';

/** Options for cache behavior */
export interface QueryCacheOptions {
  /** TTL in seconds (capped at 60) */
  ttlSeconds?: number;
  /** Whether to bypass cache and always query fresh data */
  bypassCache?: boolean;
}

/**
 * QueryCache wraps Redis caching for MCP data tool queries.
 * It generates deterministic cache keys from tool name + input parameters
 * and stores serialized results with a configurable TTL (max 60s).
 */
export class QueryCache {
  private readonly logger: pino.Logger;
  private readonly defaultTtl: number;

  constructor(
    private readonly redis: RedisCacheService,
    options?: { logger?: pino.Logger; defaultTtlSeconds?: number },
  ) {
    this.logger = (options?.logger ?? pino({ name: 'mcp-query-cache' })).child({
      component: 'query-cache',
    });
    this.defaultTtl = Math.min(options?.defaultTtlSeconds ?? MAX_CACHE_TTL_SECONDS, MAX_CACHE_TTL_SECONDS);
  }

  /**
   * Get a cached query result.
   * Returns null if not found or expired.
   */
  async get<T>(toolName: string, input: unknown, tenantId: string): Promise<T | null> {
    const key = this.buildCacheKey(toolName, input, tenantId);

    try {
      const cached = await this.redis.cacheGet<T>(key);
      if (cached !== null) {
        this.logger.debug({ toolName, tenantId, key }, 'Cache hit');
      }
      return cached;
    } catch (error) {
      // Cache failures should not break queries - log and return null
      this.logger.warn({ error, toolName, tenantId }, 'Cache get failed, proceeding without cache');
      return null;
    }
  }

  /**
   * Store a query result in cache.
   * TTL is capped at MAX_CACHE_TTL_SECONDS (60s).
   */
  async set(toolName: string, input: unknown, tenantId: string, result: unknown, options?: QueryCacheOptions): Promise<void> {
    if (options?.bypassCache) {
      return;
    }

    const key = this.buildCacheKey(toolName, input, tenantId);
    const ttl = Math.min(options?.ttlSeconds ?? this.defaultTtl, MAX_CACHE_TTL_SECONDS);

    try {
      await this.redis.cacheSet(key, result, ttl);
      this.logger.debug({ toolName, tenantId, key, ttl }, 'Cache set');
    } catch (error) {
      // Cache failures should not break queries - log and continue
      this.logger.warn({ error, toolName, tenantId }, 'Cache set failed');
    }
  }

  /**
   * Invalidate a specific cached query result.
   */
  async invalidate(toolName: string, input: unknown, tenantId: string): Promise<void> {
    const key = this.buildCacheKey(toolName, input, tenantId);

    try {
      await this.redis.cacheDel(key);
      this.logger.debug({ toolName, tenantId, key }, 'Cache invalidated');
    } catch (error) {
      this.logger.warn({ error, toolName, tenantId }, 'Cache invalidation failed');
    }
  }

  /**
   * Build a deterministic cache key from tool name, input, and tenant.
   * Uses SHA-256 hash of the serialized input to keep keys short.
   */
  buildCacheKey(toolName: string, input: unknown, tenantId: string): string {
    const inputHash = createHash('sha256')
      .update(JSON.stringify(input ?? {}))
      .digest('hex')
      .slice(0, 16);

    return `${CACHE_KEY_PREFIX}:${tenantId}:${toolName}:${inputHash}`;
  }
}
