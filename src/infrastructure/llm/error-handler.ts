/**
 * LLM Error Handler
 *
 * Provides:
 * - Structured LLMError class with error code, statusCode, traceId, timestamp, details
 * - Factory function to create structured errors from HTTP responses
 * - Error code mapping from HTTP status codes
 * - Degradation response when all retries fail
 */

import { randomUUID } from 'node:crypto';

/** Error codes for LLM-related failures */
export type LLMErrorCode =
  | 'LLM_TIMEOUT'
  | 'LLM_RATE_LIMIT'
  | 'LLM_AUTH_ERROR'
  | 'LLM_SERVER_ERROR'
  | 'LLM_VALIDATION_ERROR'
  | 'LLM_UNAVAILABLE';

/**
 * Structured LLM error with full context for debugging and tracing.
 */
export class LLMError extends Error {
  public readonly code: LLMErrorCode;
  public readonly statusCode: number;
  public readonly traceId: string;
  public readonly timestamp: string;
  public readonly details?: unknown;

  constructor(options: {
    code: LLMErrorCode;
    message: string;
    statusCode: number;
    traceId?: string;
    timestamp?: string;
    details?: unknown;
  }) {
    super(options.message);
    this.name = 'LLMError';
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.traceId = options.traceId ?? randomUUID();
    this.timestamp = options.timestamp ?? new Date().toISOString();
    this.details = options.details;
  }

  /**
   * Convert to a structured error response suitable for API responses.
   * Does not expose internal implementation details.
   */
  toErrorResponse(): {
    error: {
      code: string;
      message: string;
      traceId: string;
      timestamp: string;
      details?: unknown;
    };
  } {
    return {
      error: {
        code: this.code,
        message: this.message,
        traceId: this.traceId,
        timestamp: this.timestamp,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

/**
 * Map an HTTP status code to an LLMErrorCode.
 */
export function mapStatusToErrorCode(status: number): LLMErrorCode {
  switch (status) {
    case 408:
      return 'LLM_TIMEOUT';
    case 429:
      return 'LLM_RATE_LIMIT';
    case 401:
    case 403:
      return 'LLM_AUTH_ERROR';
    case 400:
    case 404:
    case 422:
      return 'LLM_VALIDATION_ERROR';
    case 500:
    case 502:
    case 503:
    case 504:
      return 'LLM_SERVER_ERROR';
    default:
      return status >= 500 ? 'LLM_SERVER_ERROR' : 'LLM_VALIDATION_ERROR';
  }
}

/**
 * Create a structured LLMError from an HTTP status code and response body.
 */
export function createStructuredError(
  status: number,
  body: string,
  traceId?: string,
): LLMError {
  const code = mapStatusToErrorCode(status);
  let message = `LLM API error (${status})`;
  let details: unknown = undefined;

  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; type?: string } };
    if (parsed.error?.message) {
      message = parsed.error.message;
    }
    if (parsed.error?.type) {
      details = { type: parsed.error.type };
    }
  } catch {
    // If body is not JSON, use a generic message
    if (body) {
      message = `LLM API error (${status})`;
    }
  }

  return new LLMError({
    code,
    message,
    statusCode: status,
    traceId,
    details,
  });
}

/**
 * Check if an HTTP status code is retryable.
 * Retryable: 408 (timeout), 429 (rate limit), 500, 502, 503, 504 (server errors)
 * Non-retryable: 400, 401, 403, 404 (client errors)
 */
export function isRetryableStatus(status: number): boolean {
  const retryableStatuses = [408, 429, 500, 502, 503, 504];
  return retryableStatuses.includes(status);
}

/**
 * Create a degradation response when the LLM service is completely unavailable.
 * Returns a user-friendly message instead of a raw error.
 */
export function createDegradationResponse(traceId?: string): LLMError {
  return new LLMError({
    code: 'LLM_UNAVAILABLE',
    message: 'AI 服务暂时不可用，请稍后重试。如问题持续，请联系技术支持。',
    statusCode: 503,
    traceId,
    details: { degraded: true },
  });
}
