import { describe, it, expect } from 'vitest';
import {
  LLMError,
  createStructuredError,
  mapStatusToErrorCode,
  isRetryableStatus,
  createDegradationResponse,
} from './error-handler.js';

describe('LLMError', () => {
  it('should create an error with all required fields', () => {
    const error = new LLMError({
      code: 'LLM_TIMEOUT',
      message: 'Request timed out',
      statusCode: 408,
      traceId: 'trace-123',
      timestamp: '2024-01-01T00:00:00.000Z',
      details: { attempt: 3 },
    });

    expect(error.name).toBe('LLMError');
    expect(error.code).toBe('LLM_TIMEOUT');
    expect(error.message).toBe('Request timed out');
    expect(error.statusCode).toBe(408);
    expect(error.traceId).toBe('trace-123');
    expect(error.timestamp).toBe('2024-01-01T00:00:00.000Z');
    expect(error.details).toEqual({ attempt: 3 });
  });

  it('should auto-generate traceId and timestamp when not provided', () => {
    const error = new LLMError({
      code: 'LLM_SERVER_ERROR',
      message: 'Server error',
      statusCode: 500,
    });

    expect(error.traceId).toBeDefined();
    expect(error.traceId.length).toBeGreaterThan(0);
    expect(error.timestamp).toBeDefined();
    expect(new Date(error.timestamp).getTime()).not.toBeNaN();
  });

  it('should extend Error', () => {
    const error = new LLMError({
      code: 'LLM_RATE_LIMIT',
      message: 'Rate limited',
      statusCode: 429,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.stack).toBeDefined();
  });

  describe('toErrorResponse()', () => {
    it('should return a structured error response', () => {
      const error = new LLMError({
        code: 'LLM_AUTH_ERROR',
        message: 'Invalid API key',
        statusCode: 401,
        traceId: 'trace-abc',
        timestamp: '2024-06-15T12:00:00.000Z',
      });

      const response = error.toErrorResponse();

      expect(response).toEqual({
        error: {
          code: 'LLM_AUTH_ERROR',
          message: 'Invalid API key',
          traceId: 'trace-abc',
          timestamp: '2024-06-15T12:00:00.000Z',
        },
      });
    });

    it('should include details when present', () => {
      const error = new LLMError({
        code: 'LLM_VALIDATION_ERROR',
        message: 'Bad request',
        statusCode: 400,
        details: { field: 'messages', reason: 'required' },
      });

      const response = error.toErrorResponse();
      expect(response.error.details).toEqual({ field: 'messages', reason: 'required' });
    });

    it('should not include details when undefined', () => {
      const error = new LLMError({
        code: 'LLM_SERVER_ERROR',
        message: 'Internal error',
        statusCode: 500,
      });

      const response = error.toErrorResponse();
      expect(response.error).not.toHaveProperty('details');
    });
  });
});

describe('mapStatusToErrorCode()', () => {
  it('should map 408 to LLM_TIMEOUT', () => {
    expect(mapStatusToErrorCode(408)).toBe('LLM_TIMEOUT');
  });

  it('should map 429 to LLM_RATE_LIMIT', () => {
    expect(mapStatusToErrorCode(429)).toBe('LLM_RATE_LIMIT');
  });

  it('should map 401 to LLM_AUTH_ERROR', () => {
    expect(mapStatusToErrorCode(401)).toBe('LLM_AUTH_ERROR');
  });

  it('should map 403 to LLM_AUTH_ERROR', () => {
    expect(mapStatusToErrorCode(403)).toBe('LLM_AUTH_ERROR');
  });

  it('should map 400 to LLM_VALIDATION_ERROR', () => {
    expect(mapStatusToErrorCode(400)).toBe('LLM_VALIDATION_ERROR');
  });

  it('should map 404 to LLM_VALIDATION_ERROR', () => {
    expect(mapStatusToErrorCode(404)).toBe('LLM_VALIDATION_ERROR');
  });

  it('should map 500 to LLM_SERVER_ERROR', () => {
    expect(mapStatusToErrorCode(500)).toBe('LLM_SERVER_ERROR');
  });

  it('should map 502 to LLM_SERVER_ERROR', () => {
    expect(mapStatusToErrorCode(502)).toBe('LLM_SERVER_ERROR');
  });

  it('should map 503 to LLM_SERVER_ERROR', () => {
    expect(mapStatusToErrorCode(503)).toBe('LLM_SERVER_ERROR');
  });

  it('should map 504 to LLM_SERVER_ERROR', () => {
    expect(mapStatusToErrorCode(504)).toBe('LLM_SERVER_ERROR');
  });

  it('should map unknown 5xx to LLM_SERVER_ERROR', () => {
    expect(mapStatusToErrorCode(599)).toBe('LLM_SERVER_ERROR');
  });

  it('should map unknown 4xx to LLM_VALIDATION_ERROR', () => {
    expect(mapStatusToErrorCode(418)).toBe('LLM_VALIDATION_ERROR');
  });
});

describe('createStructuredError()', () => {
  it('should create an LLMError from status and JSON body', () => {
    const body = JSON.stringify({
      error: { type: 'rate_limit_error', message: 'Too many requests' },
    });

    const error = createStructuredError(429, body, 'trace-xyz');

    expect(error).toBeInstanceOf(LLMError);
    expect(error.code).toBe('LLM_RATE_LIMIT');
    expect(error.message).toBe('Too many requests');
    expect(error.statusCode).toBe(429);
    expect(error.traceId).toBe('trace-xyz');
    expect(error.details).toEqual({ type: 'rate_limit_error' });
  });

  it('should handle non-JSON body gracefully', () => {
    const error = createStructuredError(500, 'Internal Server Error');

    expect(error).toBeInstanceOf(LLMError);
    expect(error.code).toBe('LLM_SERVER_ERROR');
    expect(error.statusCode).toBe(500);
    expect(error.message).toBe('LLM API error (500)');
  });

  it('should handle empty body', () => {
    const error = createStructuredError(503, '');

    expect(error).toBeInstanceOf(LLMError);
    expect(error.code).toBe('LLM_SERVER_ERROR');
    expect(error.statusCode).toBe(503);
  });

  it('should auto-generate traceId when not provided', () => {
    const error = createStructuredError(408, '{}');

    expect(error.traceId).toBeDefined();
    expect(error.traceId.length).toBeGreaterThan(0);
  });
});

describe('isRetryableStatus()', () => {
  it('should return true for 408 (timeout)', () => {
    expect(isRetryableStatus(408)).toBe(true);
  });

  it('should return true for 429 (rate limit)', () => {
    expect(isRetryableStatus(429)).toBe(true);
  });

  it('should return true for 500 (server error)', () => {
    expect(isRetryableStatus(500)).toBe(true);
  });

  it('should return true for 502 (bad gateway)', () => {
    expect(isRetryableStatus(502)).toBe(true);
  });

  it('should return true for 503 (service unavailable)', () => {
    expect(isRetryableStatus(503)).toBe(true);
  });

  it('should return true for 504 (gateway timeout)', () => {
    expect(isRetryableStatus(504)).toBe(true);
  });

  it('should return false for 400 (bad request)', () => {
    expect(isRetryableStatus(400)).toBe(false);
  });

  it('should return false for 401 (unauthorized)', () => {
    expect(isRetryableStatus(401)).toBe(false);
  });

  it('should return false for 403 (forbidden)', () => {
    expect(isRetryableStatus(403)).toBe(false);
  });

  it('should return false for 404 (not found)', () => {
    expect(isRetryableStatus(404)).toBe(false);
  });
});

describe('createDegradationResponse()', () => {
  it('should create an LLMError with degradation info', () => {
    const error = createDegradationResponse('trace-degrade');

    expect(error).toBeInstanceOf(LLMError);
    expect(error.code).toBe('LLM_UNAVAILABLE');
    expect(error.statusCode).toBe(503);
    expect(error.traceId).toBe('trace-degrade');
    expect(error.message).toContain('暂时不可用');
    expect(error.details).toEqual({ degraded: true });
  });

  it('should auto-generate traceId when not provided', () => {
    const error = createDegradationResponse();

    expect(error.traceId).toBeDefined();
    expect(error.traceId.length).toBeGreaterThan(0);
  });
});
