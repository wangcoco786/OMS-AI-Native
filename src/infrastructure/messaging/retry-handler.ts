/**
 * Retry Handler for Message Broker
 *
 * Provides:
 * - Exponential backoff retry logic for failed message consumption
 * - Retry count tracking via message headers (x-retry-count)
 * - Failure reason recording in headers (x-failure-reason)
 * - Dead letter routing after max retries exceeded
 * - Configurable retry parameters (max retries, delays, backoff multiplier)
 */

import pino from 'pino';

import type { BrokerMessage, MessageHandler } from './types.js';

/** Configuration for retry behavior */
export interface RetryConfig {
  /** Maximum number of retry attempts before sending to DLQ */
  maxRetries: number;
  /** Base delay in milliseconds for first retry */
  baseDelay: number;
  /** Maximum delay cap in milliseconds */
  maxDelay: number;
  /** Multiplier for exponential backoff */
  backoffMultiplier: number;
  /** Error codes that are eligible for retry */
  retryableErrors: string[];
}

/** Interface for republishing messages with retry headers */
export interface RetryPublisher {
  /** Republish a message with updated headers for retry */
  republish(
    exchange: string,
    routingKey: string,
    content: unknown,
    headers: Record<string, string>,
    delayMs: number,
  ): Promise<void>;
}

/** Default retry configuration for message broker */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelay: 500,
  maxDelay: 30000,
  backoffMultiplier: 2,
  retryableErrors: ['DELIVERY_FAILED', 'CONSUMER_TIMEOUT'],
};

/**
 * Calculate the delay for a given retry attempt using exponential backoff.
 *
 * Formula: delay = min(baseDelay * backoffMultiplier^attempt, maxDelay)
 */
export function calculateBackoffDelay(
  attempt: number,
  config: RetryConfig,
): number {
  const delay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt);
  return Math.min(delay, config.maxDelay);
}

/**
 * Extract the current retry count from message headers.
 * Returns 0 if no retry count header is present.
 */
export function getRetryCount(headers: Record<string, string>): number {
  const count = headers['x-retry-count'];
  if (count === undefined || count === null) {
    return 0;
  }
  const parsed = parseInt(String(count), 10);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * RetryHandler wraps a message handler with retry logic.
 *
 * On handler failure:
 * 1. Increments the retry count from message headers
 * 2. If retries < maxRetries, republishes the message with exponential delay
 * 3. If retries >= maxRetries, nacks the message (sending it to DLX)
 * 4. Records the failure reason in x-failure-reason header
 */
export class RetryHandler {
  private readonly config: RetryConfig;
  private readonly logger: pino.Logger;

  constructor(config?: Partial<RetryConfig>, options?: { logger?: pino.Logger }) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
    if (options?.logger) {
      // Use provided logger directly (assumed already scoped)
      this.logger = options.logger as pino.Logger;
    } else {
      this.logger = pino({ name: 'retry-handler' }).child({
        component: 'retry-handler',
      });
    }
  }

  /**
   * Get the current retry configuration.
   */
  getConfig(): RetryConfig {
    return { ...this.config };
  }

  /**
   * Wrap a message handler with retry logic.
   *
   * Returns a new handler that:
   * - Calls the original handler
   * - On success: acks the message
   * - On failure: either republishes for retry or nacks to DLX
   */
  wrapHandler(
    handler: MessageHandler,
    publisher: RetryPublisher,
  ): MessageHandler {
    return async (message: BrokerMessage): Promise<void> => {
      try {
        await handler(message);
        message.ack();
      } catch (error) {
        const failureReason = error instanceof Error ? error.message : String(error);
        const retryCount = getRetryCount(message.headers);

        this.logger.warn(
          {
            messageId: message.id,
            routingKey: message.routingKey,
            retryCount,
            failureReason,
          },
          'Message handler failed',
        );

        if (retryCount < this.config.maxRetries) {
          // Retry: republish with incremented count and delay
          const nextRetryCount = retryCount + 1;
          const delay = calculateBackoffDelay(retryCount, this.config);

          const updatedHeaders: Record<string, string> = {
            ...message.headers,
            'x-retry-count': String(nextRetryCount),
            'x-failure-reason': failureReason,
            'x-original-exchange': message.exchange || '',
            'x-original-routing-key': message.routingKey,
            'x-retry-timestamp': new Date().toISOString(),
          };

          try {
            await publisher.republish(
              message.exchange,
              message.routingKey,
              message.content,
              updatedHeaders,
              delay,
            );

            // Ack the original message since we've republished it
            message.ack();

            this.logger.info(
              {
                messageId: message.id,
                retryCount: nextRetryCount,
                delayMs: delay,
              },
              'Message scheduled for retry',
            );
          } catch (republishError) {
            // If republish fails, nack to DLX as fallback
            this.logger.error(
              { error: republishError, messageId: message.id },
              'Failed to republish message for retry, sending to DLX',
            );
            message.nack(false);
          }
        } else {
          // Max retries exceeded: nack without requeue → goes to DLX
          this.logger.error(
            {
              messageId: message.id,
              routingKey: message.routingKey,
              retryCount,
              failureReason,
            },
            'Max retries exceeded, sending message to dead letter queue',
          );
          message.nack(false);
        }
      }
    };
  }

  /**
   * Check if an error is retryable based on the configured error codes.
   * If retryableErrors is empty, all errors are considered retryable.
   */
  isRetryableError(errorCode: string): boolean {
    if (this.config.retryableErrors.length === 0) {
      return true;
    }
    return this.config.retryableErrors.includes(errorCode);
  }
}
