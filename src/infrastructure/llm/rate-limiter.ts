/**
 * Rate Limiter for LLM Gateway
 *
 * Provides tenant-level rate limiting (requests per minute) backed by Redis.
 * Uses the RedisCacheService's LLM call counter with a 1-minute sliding window.
 */

import pino from 'pino';

import type { RedisCacheService } from '../database/redis-service.js';

/** Result of a rate limit check */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Current request count in the window */
  currentCount: number;
  /** Maximum allowed requests per minute */
  limit: number;
  /** Seconds until the rate limit window resets */
  resetInSeconds: number;
}

/** Structured error thrown when rate limit is exceeded */
export class RateLimitExceededError extends Error {
  readonly code = 'RATE_LIMIT_EXCEEDED' as const;
  readonly currentCount: number;
  readonly limit: number;
  readonly resetInSeconds: number;

  constructor(options: { tenantId: string; currentCount: number; limit: number; resetInSeconds: number }) {
    super(
      `Rate limit exceeded for tenant ${options.tenantId}: ${options.currentCount}/${options.limit} requests per minute`,
    );
    this.name = 'RateLimitExceededError';
    this.currentCount = options.currentCount;
    this.limit = options.limit;
    this.resetInSeconds = options.resetInSeconds;
  }
}

/**
 * RateLimiter checks and enforces per-tenant request rate limits
 * using Redis-backed counters with a 1-minute TTL window.
 */
export class RateLimiter {
  private readonly redis: RedisCacheService;
  private readonly logger: pino.Logger;

  constructor(redis: RedisCacheService, options?: { logger?: pino.Logger }) {
    this.redis = redis;
    this.logger = (options?.logger ?? pino({ name: 'rate-limiter' })).child({
      component: 'rate-limiter',
    });
  }

  /**
   * Check and enforce the rate limit for a tenant.
   *
   * Increments the call counter and checks against the limit.
   * The counter uses a 1-minute TTL window managed by RedisCacheService.
   *
   * @param tenantId - The tenant identifier
   * @param limit - Maximum allowed requests per minute
   * @returns RateLimitResult indicating whether the request is allowed
   */
  async checkRateLimit(tenantId: string, limit: number): Promise<RateLimitResult> {
    // Increment the counter (this also sets TTL on first call in window)
    const currentCount = await this.redis.incrementLLMCallCount(tenantId);

    // Get TTL to determine reset time
    const key = this.redis.buildTenantLLMCallsKey(tenantId);
    const client = this.redis.getClient();
    const ttl = await client.ttl(key);

    // TTL of -1 means no expiry (shouldn't happen after increment), -2 means key doesn't exist
    const resetInSeconds = ttl > 0 ? ttl : 60;

    const allowed = currentCount <= limit;

    if (!allowed) {
      this.logger.warn(
        { tenantId, currentCount, limit, resetInSeconds },
        'Rate limit exceeded',
      );
    } else {
      this.logger.debug(
        { tenantId, currentCount, limit, resetInSeconds },
        'Rate limit check passed',
      );
    }

    return {
      allowed,
      currentCount,
      limit,
      resetInSeconds,
    };
  }
}
