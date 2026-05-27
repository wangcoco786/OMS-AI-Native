import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimiter, RateLimitExceededError } from './rate-limiter.js';
import type { RateLimitResult } from './rate-limiter.js';

// Mock pino
vi.mock('pino', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  return { default: vi.fn(() => mockLogger) };
});

// Create a mock RedisCacheService
function createMockRedis() {
  const mockClient = {
    ttl: vi.fn().mockResolvedValue(55),
  };

  return {
    incrementLLMCallCount: vi.fn().mockResolvedValue(1),
    getLLMCallCount: vi.fn().mockResolvedValue(0),
    buildTenantLLMCallsKey: vi.fn((tenantId: string) => `tenant:${tenantId}:llm_calls`),
    getClient: vi.fn(() => mockClient),
    _mockClient: mockClient,
  };
}

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis = createMockRedis();
    rateLimiter = new RateLimiter(mockRedis as any);
  });

  describe('checkRateLimit', () => {
    it('should allow request when count is below limit', async () => {
      mockRedis.incrementLLMCallCount.mockResolvedValueOnce(5);
      mockRedis._mockClient.ttl.mockResolvedValueOnce(45);

      const result = await rateLimiter.checkRateLimit('tenant-a', 60);

      expect(result.allowed).toBe(true);
      expect(result.currentCount).toBe(5);
      expect(result.limit).toBe(60);
      expect(result.resetInSeconds).toBe(45);
    });

    it('should allow request when count equals limit', async () => {
      mockRedis.incrementLLMCallCount.mockResolvedValueOnce(60);
      mockRedis._mockClient.ttl.mockResolvedValueOnce(30);

      const result = await rateLimiter.checkRateLimit('tenant-a', 60);

      expect(result.allowed).toBe(true);
      expect(result.currentCount).toBe(60);
      expect(result.limit).toBe(60);
    });

    it('should deny request when count exceeds limit', async () => {
      mockRedis.incrementLLMCallCount.mockResolvedValueOnce(61);
      mockRedis._mockClient.ttl.mockResolvedValueOnce(20);

      const result = await rateLimiter.checkRateLimit('tenant-a', 60);

      expect(result.allowed).toBe(false);
      expect(result.currentCount).toBe(61);
      expect(result.limit).toBe(60);
      expect(result.resetInSeconds).toBe(20);
    });

    it('should use 60 seconds as default reset time when TTL is -1', async () => {
      mockRedis.incrementLLMCallCount.mockResolvedValueOnce(1);
      mockRedis._mockClient.ttl.mockResolvedValueOnce(-1);

      const result = await rateLimiter.checkRateLimit('tenant-a', 60);

      expect(result.resetInSeconds).toBe(60);
    });

    it('should use 60 seconds as default reset time when TTL is -2 (key missing)', async () => {
      mockRedis.incrementLLMCallCount.mockResolvedValueOnce(1);
      mockRedis._mockClient.ttl.mockResolvedValueOnce(-2);

      const result = await rateLimiter.checkRateLimit('tenant-a', 60);

      expect(result.resetInSeconds).toBe(60);
    });

    it('should call incrementLLMCallCount with the correct tenantId', async () => {
      mockRedis.incrementLLMCallCount.mockResolvedValueOnce(1);

      await rateLimiter.checkRateLimit('tenant-xyz', 100);

      expect(mockRedis.incrementLLMCallCount).toHaveBeenCalledWith('tenant-xyz');
    });

    it('should build the correct key for TTL lookup', async () => {
      mockRedis.incrementLLMCallCount.mockResolvedValueOnce(1);

      await rateLimiter.checkRateLimit('tenant-abc', 50);

      expect(mockRedis.buildTenantLLMCallsKey).toHaveBeenCalledWith('tenant-abc');
    });

    it('should propagate Redis errors', async () => {
      mockRedis.incrementLLMCallCount.mockRejectedValueOnce(new Error('Redis connection lost'));

      await expect(rateLimiter.checkRateLimit('tenant-a', 60)).rejects.toThrow(
        'Redis connection lost',
      );
    });

    it('should handle rate limit of 1 request per minute', async () => {
      mockRedis.incrementLLMCallCount.mockResolvedValueOnce(1);
      mockRedis._mockClient.ttl.mockResolvedValueOnce(60);

      const result1 = await rateLimiter.checkRateLimit('tenant-a', 1);
      expect(result1.allowed).toBe(true);

      mockRedis.incrementLLMCallCount.mockResolvedValueOnce(2);
      mockRedis._mockClient.ttl.mockResolvedValueOnce(55);

      const result2 = await rateLimiter.checkRateLimit('tenant-a', 1);
      expect(result2.allowed).toBe(false);
    });

    it('should handle different tenants independently', async () => {
      // Tenant A at limit
      mockRedis.incrementLLMCallCount.mockResolvedValueOnce(60);
      mockRedis._mockClient.ttl.mockResolvedValueOnce(10);

      const resultA = await rateLimiter.checkRateLimit('tenant-a', 60);
      expect(resultA.allowed).toBe(true);

      // Tenant B well below limit
      mockRedis.incrementLLMCallCount.mockResolvedValueOnce(5);
      mockRedis._mockClient.ttl.mockResolvedValueOnce(50);

      const resultB = await rateLimiter.checkRateLimit('tenant-b', 60);
      expect(resultB.allowed).toBe(true);
      expect(resultB.currentCount).toBe(5);
    });
  });
});

describe('RateLimitExceededError', () => {
  it('should have the correct error code', () => {
    const error = new RateLimitExceededError({
      tenantId: 'tenant-a',
      currentCount: 61,
      limit: 60,
      resetInSeconds: 30,
    });

    expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('should include rate limit details', () => {
    const error = new RateLimitExceededError({
      tenantId: 'tenant-a',
      currentCount: 61,
      limit: 60,
      resetInSeconds: 30,
    });

    expect(error.currentCount).toBe(61);
    expect(error.limit).toBe(60);
    expect(error.resetInSeconds).toBe(30);
  });

  it('should have a descriptive message', () => {
    const error = new RateLimitExceededError({
      tenantId: 'tenant-a',
      currentCount: 61,
      limit: 60,
      resetInSeconds: 30,
    });

    expect(error.message).toContain('tenant-a');
    expect(error.message).toContain('61/60');
  });

  it('should have the correct name', () => {
    const error = new RateLimitExceededError({
      tenantId: 'tenant-a',
      currentCount: 61,
      limit: 60,
      resetInSeconds: 30,
    });

    expect(error.name).toBe('RateLimitExceededError');
  });

  it('should be an instance of Error', () => {
    const error = new RateLimitExceededError({
      tenantId: 'tenant-a',
      currentCount: 61,
      limit: 60,
      resetInSeconds: 30,
    });

    expect(error).toBeInstanceOf(Error);
  });
});
