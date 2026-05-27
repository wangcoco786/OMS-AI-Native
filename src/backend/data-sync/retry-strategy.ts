/**
 * Sync Retry Strategy
 *
 * Implements exponential backoff retry for data sync operations:
 * - Formula: baseDelay × 2^(attempt-1), capped at maxDelay
 * - Maximum 3 retries
 * - Distinguishes retryable vs non-retryable errors
 * - Marks as final failure after exhausting retries
 */

import pino from 'pino';

const defaultLogger = pino({ name: 'sync-retry-strategy' });

/** Configuration for sync retry behavior */
export interface SyncRetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors: string[];
  nonRetryableErrors: string[];
}

/** Default sync retry configuration */
export const DEFAULT_SYNC_RETRY_CONFIG: SyncRetryConfig = {
  maxRetries: 3,
  baseDelay: 60000,
  maxDelay: 900000,
  backoffMultiplier: 2,
  retryableErrors: ['NETWORK_TIMEOUT', 'RATE_LIMIT', 'SERVICE_UNAVAILABLE', 'CONNECTION_RESET'],
  nonRetryableErrors: ['AUTH_FAILED', 'INVALID_CONFIG', 'PERMISSION_DENIED'],
};

/** Result of a retry execution */
export interface RetryResult<T> {
  success: boolean;
  data?: T;
  attempts: number;
  finalError?: Error;
}

/**
 * SyncRetryStrategy implements exponential backoff retry logic
 * specifically designed for data sync operations.
 */
export class SyncRetryStrategy {
  private readonly config: SyncRetryConfig;
  private readonly logger: pino.Logger;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(
    config: SyncRetryConfig = DEFAULT_SYNC_RETRY_CONFIG,
    parentLogger?: pino.Logger,
    sleepFn?: (ms: number) => Promise<void>,
  ) {
    this.config = config;
    this.logger = (parentLogger ?? defaultLogger).child({ component: 'sync-retry-strategy' });
    this.sleepFn = sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Determine if an error is retryable based on its code property.
   *
   * An error is retryable if:
   * - Its code is in the retryableErrors list, OR
   * - Its code is NOT in the nonRetryableErrors list (and no explicit retryable match)
   *
   * An error is NOT retryable if:
   * - Its code is in the nonRetryableErrors list
   *
   * @param error - The error to check
   * @param attempt - The current attempt number (1-based)
   * @returns true if the error is retryable and attempts remain
   */
  shouldRetry(error: Error, attempt: number): boolean {
    if (attempt >= this.config.maxRetries) {
      return false;
    }

    const errorCode = (error as Error & { code?: string }).code ?? '';

    // Non-retryable errors are never retried
    if (this.config.nonRetryableErrors.includes(errorCode)) {
      return false;
    }

    // If the error code is in the retryable list, retry
    if (this.config.retryableErrors.includes(errorCode)) {
      return true;
    }

    // For errors without a recognized code, treat as retryable (network errors, etc.)
    return true;
  }

  /**
   * Calculate the delay for a given attempt using exponential backoff.
   *
   * Formula: baseDelay × 2^(attempt-1), capped at maxDelay
   *
   * @param attempt - The attempt number (1-based: 1st retry, 2nd retry, 3rd retry)
   * @returns The delay in milliseconds
   */
  getDelay(attempt: number): number {
    const delay = this.config.baseDelay * Math.pow(this.config.backoffMultiplier, attempt - 1);
    return Math.min(delay, this.config.maxDelay);
  }

  /**
   * Execute a function with retry logic.
   * Retries on retryable errors with exponential backoff.
   * Throws immediately on non-retryable errors.
   * After exhausting all retries, throws the last error.
   *
   * @param fn - The async function to execute
   * @returns The result of the function if successful
   * @throws The original error if non-retryable or all retries exhausted
   */
  async executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // First attempt (attempt=0) is the initial call, not a retry
        // Retries are attempts 1, 2, 3
        if (!this.shouldRetry(lastError, attempt)) {
          this.logger.warn(
            { error: lastError.message, attempt, maxRetries: this.config.maxRetries },
            'Non-retryable error or max retries reached, failing immediately',
          );
          throw lastError;
        }

        const delay = this.getDelay(attempt + 1);
        this.logger.info(
          { error: lastError.message, attempt: attempt + 1, delay },
          'Retrying after delay',
        );

        await this.sleepFn(delay);
      }
    }

    // Should not reach here, but just in case
    throw lastError ?? new Error('Retry exhausted with no error captured');
  }
}
