import { describe, it, expect, vi } from 'vitest';
import {
  withRetry,
  calculateDelay,
  isRetryableError,
  LLM_RETRY_CONFIG,
} from './retry-strategy.js';
import { LLMError } from './error-handler.js';
import type { RetryConfig } from '../../shared/types.js';

describe('calculateDelay()', () => {
  const config: RetryConfig = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
    retryableErrors: [],
  };

  it('should return baseDelay for attempt 0', () => {
    expect(calculateDelay(0, config)).toBe(1000);
  });

  it('should double delay for each attempt', () => {
    expect(calculateDelay(1, config)).toBe(2000);
    expect(calculateDelay(2, config)).toBe(4000);
    expect(calculateDelay(3, config)).toBe(8000);
  });

  it('should cap delay at maxDelay', () => {
    expect(calculateDelay(4, config)).toBe(10000); // 16000 capped to 10000
    expect(calculateDelay(10, config)).toBe(10000);
  });

  it('should use custom backoff multiplier', () => {
    const customConfig = { ...config, backoffMultiplier: 3 };
    expect(calculateDelay(0, customConfig)).toBe(1000);
    expect(calculateDelay(1, customConfig)).toBe(3000);
    expect(calculateDelay(2, customConfig)).toBe(9000);
    expect(calculateDelay(3, customConfig)).toBe(10000); // capped
  });
});

describe('isRetryableError()', () => {
  it('should return true for LLMError with retryable status 429', () => {
    const error = new LLMError({ code: 'LLM_RATE_LIMIT', message: 'Rate limited', statusCode: 429 });
    expect(isRetryableError(error)).toBe(true);
  });

  it('should return true for LLMError with retryable status 408', () => {
    const error = new LLMError({ code: 'LLM_TIMEOUT', message: 'Timeout', statusCode: 408 });
    expect(isRetryableError(error)).toBe(true);
  });

  it('should return true for LLMError with retryable status 500', () => {
    const error = new LLMError({ code: 'LLM_SERVER_ERROR', message: 'Server error', statusCode: 500 });
    expect(isRetryableError(error)).toBe(true);
  });

  it('should return true for LLMError with retryable status 503', () => {
    const error = new LLMError({ code: 'LLM_SERVER_ERROR', message: 'Unavailable', statusCode: 503 });
    expect(isRetryableError(error)).toBe(true);
  });

  it('should return false for LLMError with non-retryable status 400', () => {
    const error = new LLMError({ code: 'LLM_VALIDATION_ERROR', message: 'Bad request', statusCode: 400 });
    expect(isRetryableError(error)).toBe(false);
  });

  it('should return false for LLMError with non-retryable status 401', () => {
    const error = new LLMError({ code: 'LLM_AUTH_ERROR', message: 'Unauthorized', statusCode: 401 });
    expect(isRetryableError(error)).toBe(false);
  });

  it('should return false for LLMError with non-retryable status 403', () => {
    const error = new LLMError({ code: 'LLM_AUTH_ERROR', message: 'Forbidden', statusCode: 403 });
    expect(isRetryableError(error)).toBe(false);
  });

  it('should return true for generic Error with retryable statusCode', () => {
    const error = new Error('Server error') as Error & { statusCode: number };
    error.statusCode = 502;
    expect(isRetryableError(error)).toBe(true);
  });

  it('should return false for generic Error with non-retryable statusCode', () => {
    const error = new Error('Not found') as Error & { statusCode: number };
    error.statusCode = 404;
    expect(isRetryableError(error)).toBe(false);
  });

  it('should return true for network errors (no statusCode)', () => {
    const error = new Error('ECONNREFUSED');
    expect(isRetryableError(error)).toBe(true);
  });

  it('should return true for unknown error types', () => {
    expect(isRetryableError('some string error')).toBe(true);
  });
});

describe('withRetry()', () => {
  const fastConfig: RetryConfig = {
    maxRetries: 3,
    baseDelay: 100,
    maxDelay: 1000,
    backoffMultiplier: 2,
    retryableErrors: [],
  };

  it('should return result on first successful attempt', async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockResolvedValue('success');

    const result = await withRetry(fn, fastConfig, sleepFn);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it('should retry on retryable error and succeed', async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn()
      .mockRejectedValueOnce(new LLMError({ code: 'LLM_SERVER_ERROR', message: 'Error', statusCode: 500 }))
      .mockRejectedValueOnce(new LLMError({ code: 'LLM_SERVER_ERROR', message: 'Error', statusCode: 502 }))
      .mockResolvedValue('recovered');

    const result = await withRetry(fn, fastConfig, sleepFn);

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });

  it('should throw immediately on non-retryable error', async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const authError = new LLMError({ code: 'LLM_AUTH_ERROR', message: 'Invalid key', statusCode: 401 });
    const fn = vi.fn().mockRejectedValue(authError);

    await expect(withRetry(fn, fastConfig, sleepFn)).rejects.toThrow('Invalid key');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it('should throw degradation error when all retries exhausted', async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const serverError = new LLMError({ code: 'LLM_SERVER_ERROR', message: 'Down', statusCode: 503 });
    const fn = vi.fn().mockRejectedValue(serverError);

    await expect(withRetry(fn, fastConfig, sleepFn)).rejects.toMatchObject({
      code: 'LLM_UNAVAILABLE',
      statusCode: 503,
    });

    // 1 initial + 3 retries = 4 total attempts
    expect(fn).toHaveBeenCalledTimes(4);
    expect(sleepFn).toHaveBeenCalledTimes(3);
  });

  it('should use exponential backoff delays', async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const serverError = new LLMError({ code: 'LLM_SERVER_ERROR', message: 'Error', statusCode: 500 });
    const fn = vi.fn().mockRejectedValue(serverError);

    await withRetry(fn, fastConfig, sleepFn).catch(() => {});

    expect(sleepFn).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenNthCalledWith(1, 100);  // baseDelay * 2^0
    expect(sleepFn).toHaveBeenNthCalledWith(2, 200);  // baseDelay * 2^1
    expect(sleepFn).toHaveBeenNthCalledWith(3, 400);  // baseDelay * 2^2
  });

  it('should cap delay at maxDelay', async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const tinyConfig: RetryConfig = {
      maxRetries: 5,
      baseDelay: 500,
      maxDelay: 1000,
      backoffMultiplier: 3,
      retryableErrors: [],
    };
    const serverError = new LLMError({ code: 'LLM_SERVER_ERROR', message: 'Error', statusCode: 500 });
    const fn = vi.fn().mockRejectedValue(serverError);

    await withRetry(fn, tinyConfig, sleepFn).catch(() => {});

    // Delays: 500, 1000 (capped from 1500), 1000 (capped), 1000 (capped), 1000 (capped)
    expect(sleepFn).toHaveBeenNthCalledWith(1, 500);
    expect(sleepFn).toHaveBeenNthCalledWith(2, 1000);
    expect(sleepFn).toHaveBeenNthCalledWith(3, 1000);
  });

  it('should retry on network errors (no statusCode)', async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const networkError = new Error('fetch failed');
    const fn = vi.fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValue('recovered');

    const result = await withRetry(fn, fastConfig, sleepFn);

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should not retry on 400 validation error', async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const validationError = new LLMError({
      code: 'LLM_VALIDATION_ERROR',
      message: 'Invalid messages format',
      statusCode: 400,
    });
    const fn = vi.fn().mockRejectedValue(validationError);

    await expect(withRetry(fn, fastConfig, sleepFn)).rejects.toThrow('Invalid messages format');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on 429 rate limit error', async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const rateLimitError = new LLMError({
      code: 'LLM_RATE_LIMIT',
      message: 'Rate limited',
      statusCode: 429,
    });
    const fn = vi.fn()
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValue('ok');

    const result = await withRetry(fn, fastConfig, sleepFn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('LLM_RETRY_CONFIG', () => {
  it('should have expected default values', () => {
    expect(LLM_RETRY_CONFIG.maxRetries).toBe(3);
    expect(LLM_RETRY_CONFIG.baseDelay).toBe(1000);
    expect(LLM_RETRY_CONFIG.maxDelay).toBe(10000);
    expect(LLM_RETRY_CONFIG.backoffMultiplier).toBe(2);
    expect(LLM_RETRY_CONFIG.retryableErrors).toContain('RATE_LIMIT');
    expect(LLM_RETRY_CONFIG.retryableErrors).toContain('TIMEOUT');
    expect(LLM_RETRY_CONFIG.retryableErrors).toContain('SERVICE_UNAVAILABLE');
  });
});
