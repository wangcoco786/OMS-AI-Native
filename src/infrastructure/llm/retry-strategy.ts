/**
 * LLM Retry Strategy
 *
 * Provides:
 * - Generic withRetry<T> utility with exponential backoff
 * - Configurable retry parameters (max retries, base delay, max delay, backoff multiplier)
 * - Only retries on retryable errors (timeout, rate limit, server errors)
 * - Non-retryable errors are thrown immediately (400, 401, 403, 404)
 * - Degradation response when all retries are exhausted
 */

import type { RetryConfig } from '../../shared/types.js';
import { LLMError, isRetryableStatus, createDegradationResponse } from './error-handler.js';

/** Default retry configuration for LLM Gateway */
export const LLM_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
  retryableErrors: ['RATE_LIMIT', 'TIMEOUT', 'SERVICE_UNAVAILABLE'],
};

/**
 * Calculate exponential backoff delay for a given attempt.
 *
 * Formula: delay = min(baseDelay * backoffMultiplier^attempt, maxDelay)
 */
export function calculateDelay(attempt: number, config: RetryConfig): number {
  const delay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt);
  return Math.min(delay, config.maxDelay);
}

/**
 * Sleep for a given number of milliseconds.
 * Extracted for testability.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determine if an error is retryable.
 *
 * An error is retryable if:
 * - It's an LLMError with a retryable status code (408, 429, 500, 502, 503, 504)
 * - It's a generic Error with a statusCode property that is retryable
 * - It's a network error (no statusCode, e.g., fetch failure)
 *
 * Non-retryable: 400, 401, 403, 404
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof LLMError) {
    return isRetryableStatus(error.statusCode);
  }

  if (error instanceof Error) {
    const statusCode = (error as Error & { statusCode?: number }).statusCode;
    if (statusCode !== undefined) {
      return isRetryableStatus(statusCode);
    }
    // Network errors (no status code) are retryable
    // e.g., ECONNREFUSED, ENOTFOUND, fetch failures
    return true;
  }

  // Unknown errors are retryable by default
  return true;
}

/**
 * Execute a function with retry logic using exponential backoff.
 *
 * @param fn - The async function to execute
 * @param config - Retry configuration
 * @param sleepFn - Sleep function (injectable for testing)
 * @returns The result of the function if successful
 * @throws LLMError with degradation message if all retries are exhausted
 * @throws The original error if it's non-retryable
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = LLM_RETRY_CONFIG,
  sleepFn: (ms: number) => Promise<void> = sleep,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // If the error is not retryable, throw immediately
      if (!isRetryableError(error)) {
        throw error;
      }

      // If we've exhausted all retries, break out
      if (attempt >= config.maxRetries) {
        break;
      }

      // Wait with exponential backoff before next attempt
      const delay = calculateDelay(attempt, config);
      await sleepFn(delay);
    }
  }

  // All retries exhausted - return degradation error
  const traceId = lastError instanceof LLMError ? lastError.traceId : undefined;
  throw createDegradationResponse(traceId);
}
