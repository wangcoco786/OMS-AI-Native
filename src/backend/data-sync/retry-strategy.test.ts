/**
 * Tests for SyncRetryStrategy
 *
 * Tests the exponential backoff retry logic:
 * - Delay calculation: baseDelay × 2^(attempt-1), capped at maxDelay
 * - shouldRetry: checks retryable errors and attempt limits
 * - executeWithRetry: wraps functions with retry logic
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SyncRetryStrategy, DEFAULT_SYNC_RETRY_CONFIG } from './retry-strategy.js';
import type { SyncRetryConfig } from './retry-strategy.js';

function createError(code?: string): Error & { code?: string } {
  const error = new Error(`Test error: ${code ?? 'unknown'}`) as Error & { code?: string };
  if (code) {
    error.code = code;
  }
  return error;
}

describe('SyncRetryStrategy', () => {
  let strategy: SyncRetryStrategy;
  let sleepFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sleepFn = vi.fn().mockResolvedValue(undefined);
    strategy = new SyncRetryStrategy(DEFAULT_SYNC_RETRY_CONFIG, undefined, sleepFn);
  });

  describe('getDelay', () => {
    it('returns baseDelay for the first retry (attempt=1)', () => {
      const delay = strategy.getDelay(1);
      expect(delay).toBe(60000); // baseDelay × 2^0 = 60000
    });

    it('returns baseDelay × 2 for the second retry (attempt=2)', () => {
      const delay = strategy.getDelay(2);
      expect(delay).toBe(120000); // baseDelay × 2^1 = 120000
    });

    it('returns baseDelay × 4 for the third retry (attempt=3)', () => {
      const delay = strategy.getDelay(3);
      expect(delay).toBe(240000); // baseDelay × 2^2 = 240000
    });

    it('caps delay at maxDelay', () => {
      const config: SyncRetryConfig = {
        ...DEFAULT_SYNC_RETRY_CONFIG,
        baseDelay: 500000,
        maxDelay: 900000,
      };
      const s = new SyncRetryStrategy(config, undefined, sleepFn);

      // 500000 × 2^1 = 1000000, capped at 900000
      expect(s.getDelay(2)).toBe(900000);
    });

    it('uses custom backoff multiplier', () => {
      const config: SyncRetryConfig = {
        ...DEFAULT_SYNC_RETRY_CONFIG,
        baseDelay: 1000,
        backoffMultiplier: 3,
        maxDelay: 100000,
      };
      const s = new SyncRetryStrategy(config, undefined, sleepFn);

      expect(s.getDelay(1)).toBe(1000); // 1000 × 3^0
      expect(s.getDelay(2)).toBe(3000); // 1000 × 3^1
      expect(s.getDelay(3)).toBe(9000); // 1000 × 3^2
    });
  });

  describe('shouldRetry', () => {
    it('returns true for retryable error codes when attempts remain', () => {
      expect(strategy.shouldRetry(createError('NETWORK_TIMEOUT'), 0)).toBe(true);
      expect(strategy.shouldRetry(createError('RATE_LIMIT'), 1)).toBe(true);
      expect(strategy.shouldRetry(createError('SERVICE_UNAVAILABLE'), 2)).toBe(true);
      expect(strategy.shouldRetry(createError('CONNECTION_RESET'), 0)).toBe(true);
    });

    it('returns false for non-retryable error codes', () => {
      expect(strategy.shouldRetry(createError('AUTH_FAILED'), 0)).toBe(false);
      expect(strategy.shouldRetry(createError('INVALID_CONFIG'), 0)).toBe(false);
      expect(strategy.shouldRetry(createError('PERMISSION_DENIED'), 0)).toBe(false);
    });

    it('returns false when max retries reached', () => {
      expect(strategy.shouldRetry(createError('NETWORK_TIMEOUT'), 3)).toBe(false);
      expect(strategy.shouldRetry(createError('RATE_LIMIT'), 3)).toBe(false);
    });

    it('returns true for unknown error codes (treated as retryable)', () => {
      expect(strategy.shouldRetry(createError('UNKNOWN_ERROR'), 0)).toBe(true);
      expect(strategy.shouldRetry(createError(), 0)).toBe(true);
    });

    it('returns true for errors without a code property', () => {
      const error = new Error('Generic error');
      expect(strategy.shouldRetry(error, 0)).toBe(true);
    });
  });

  describe('executeWithRetry', () => {
    it('returns result on first successful attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await strategy.executeWithRetry(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(sleepFn).not.toHaveBeenCalled();
    });

    it('retries on retryable error and succeeds', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(createError('NETWORK_TIMEOUT'))
        .mockResolvedValue('success after retry');

      const result = await strategy.executeWithRetry(fn);

      expect(result).toBe('success after retry');
      expect(fn).toHaveBeenCalledTimes(2);
      expect(sleepFn).toHaveBeenCalledTimes(1);
      expect(sleepFn).toHaveBeenCalledWith(60000); // First retry delay
    });

    it('retries multiple times with increasing delays', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(createError('NETWORK_TIMEOUT'))
        .mockRejectedValueOnce(createError('SERVICE_UNAVAILABLE'))
        .mockResolvedValue('success after 2 retries');

      const result = await strategy.executeWithRetry(fn);

      expect(result).toBe('success after 2 retries');
      expect(fn).toHaveBeenCalledTimes(3);
      expect(sleepFn).toHaveBeenCalledTimes(2);
      expect(sleepFn).toHaveBeenNthCalledWith(1, 60000);  // 60000 × 2^0
      expect(sleepFn).toHaveBeenNthCalledWith(2, 120000); // 60000 × 2^1
    });

    it('throws immediately on non-retryable error', async () => {
      const fn = vi.fn().mockRejectedValue(createError('AUTH_FAILED'));

      await expect(strategy.executeWithRetry(fn)).rejects.toThrow('Test error: AUTH_FAILED');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(sleepFn).not.toHaveBeenCalled();
    });

    it('throws after exhausting all retries', async () => {
      const fn = vi.fn().mockRejectedValue(createError('NETWORK_TIMEOUT'));

      await expect(strategy.executeWithRetry(fn)).rejects.toThrow('Test error: NETWORK_TIMEOUT');
      // Initial attempt + 3 retries = 4 calls
      expect(fn).toHaveBeenCalledTimes(4);
      expect(sleepFn).toHaveBeenCalledTimes(3);
    });

    it('uses correct delays for all 3 retries', async () => {
      const fn = vi.fn().mockRejectedValue(createError('RATE_LIMIT'));

      await expect(strategy.executeWithRetry(fn)).rejects.toThrow();

      expect(sleepFn).toHaveBeenNthCalledWith(1, 60000);  // 60000 × 2^0
      expect(sleepFn).toHaveBeenNthCalledWith(2, 120000); // 60000 × 2^1
      expect(sleepFn).toHaveBeenNthCalledWith(3, 240000); // 60000 × 2^2
    });

    it('handles non-Error thrown values', async () => {
      const fn = vi.fn().mockRejectedValue('string error');

      await expect(strategy.executeWithRetry(fn)).rejects.toThrow('string error');
    });

    it('works with custom config (fewer retries)', async () => {
      const config: SyncRetryConfig = {
        ...DEFAULT_SYNC_RETRY_CONFIG,
        maxRetries: 1,
        baseDelay: 100,
      };
      const s = new SyncRetryStrategy(config, undefined, sleepFn);
      const fn = vi.fn().mockRejectedValue(createError('NETWORK_TIMEOUT'));

      await expect(s.executeWithRetry(fn)).rejects.toThrow();
      // Initial attempt + 1 retry = 2 calls
      expect(fn).toHaveBeenCalledTimes(2);
      expect(sleepFn).toHaveBeenCalledTimes(1);
    });
  });
});
