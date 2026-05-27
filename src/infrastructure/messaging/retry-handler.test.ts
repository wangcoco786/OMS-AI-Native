/**
 * Unit tests for RetryHandler
 *
 * Tests cover:
 * - Exponential backoff delay calculation
 * - Retry count extraction from headers
 * - Successful message handling (ack)
 * - Failed message handling with retry (republish)
 * - Max retries exceeded (nack to DLX)
 * - Failure reason recording in headers
 * - Republish failure fallback to DLX
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  RetryHandler,
  calculateBackoffDelay,
  getRetryCount,
  DEFAULT_RETRY_CONFIG,
} from './retry-handler.js';
import type { RetryConfig, RetryPublisher } from './retry-handler.js';
import type { BrokerMessage } from './types.js';

vi.mock('pino', () => ({
  default: () => ({
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  }),
}));

// --- Helper factories ---

function createMockMessage(overrides?: Partial<BrokerMessage>): BrokerMessage {
  return {
    id: 'msg-001',
    content: { data: 'test-payload' },
    routingKey: 'agent.status.changed',
    exchange: 'agent.events',
    timestamp: new Date().toISOString(),
    headers: {},
    ack: vi.fn(),
    nack: vi.fn(),
    ...overrides,
  };
}

function createMockPublisher(): RetryPublisher {
  return {
    republish: vi.fn().mockResolvedValue(undefined),
  };
}

// --- Tests ---

describe('calculateBackoffDelay', () => {
  const config: RetryConfig = {
    maxRetries: 5,
    baseDelay: 500,
    maxDelay: 30000,
    backoffMultiplier: 2,
    retryableErrors: [],
  };

  it('should calculate delay for attempt 0', () => {
    // 500 * 2^0 = 500
    expect(calculateBackoffDelay(0, config)).toBe(500);
  });

  it('should calculate delay for attempt 1', () => {
    // 500 * 2^1 = 1000
    expect(calculateBackoffDelay(1, config)).toBe(1000);
  });

  it('should calculate delay for attempt 2', () => {
    // 500 * 2^2 = 2000
    expect(calculateBackoffDelay(2, config)).toBe(2000);
  });

  it('should calculate delay for attempt 3', () => {
    // 500 * 2^3 = 4000
    expect(calculateBackoffDelay(3, config)).toBe(4000);
  });

  it('should calculate delay for attempt 4', () => {
    // 500 * 2^4 = 8000
    expect(calculateBackoffDelay(4, config)).toBe(8000);
  });

  it('should cap delay at maxDelay', () => {
    // 500 * 2^10 = 512000, capped at 30000
    expect(calculateBackoffDelay(10, config)).toBe(30000);
  });

  it('should handle custom backoff multiplier', () => {
    const customConfig = { ...config, backoffMultiplier: 3 };
    // 500 * 3^2 = 4500
    expect(calculateBackoffDelay(2, customConfig)).toBe(4500);
  });
});

describe('getRetryCount', () => {
  it('should return 0 when no retry count header exists', () => {
    expect(getRetryCount({})).toBe(0);
  });

  it('should return 0 for undefined header value', () => {
    expect(getRetryCount({ 'other-header': 'value' })).toBe(0);
  });

  it('should parse numeric string header', () => {
    expect(getRetryCount({ 'x-retry-count': '3' })).toBe(3);
  });

  it('should return 0 for non-numeric header value', () => {
    expect(getRetryCount({ 'x-retry-count': 'invalid' })).toBe(0);
  });

  it('should handle zero retry count', () => {
    expect(getRetryCount({ 'x-retry-count': '0' })).toBe(0);
  });
});

describe('RetryHandler', () => {
  let retryHandler: RetryHandler;
  let publisher: RetryPublisher;

  beforeEach(() => {
    vi.clearAllMocks();
    retryHandler = new RetryHandler();
    publisher = createMockPublisher();
  });

  describe('constructor', () => {
    it('should use default config when none provided', () => {
      const handler = new RetryHandler();
      expect(handler.getConfig()).toEqual(DEFAULT_RETRY_CONFIG);
    });

    it('should merge partial config with defaults', () => {
      const handler = new RetryHandler({ maxRetries: 3, baseDelay: 1000 });
      const config = handler.getConfig();
      expect(config.maxRetries).toBe(3);
      expect(config.baseDelay).toBe(1000);
      expect(config.maxDelay).toBe(DEFAULT_RETRY_CONFIG.maxDelay);
      expect(config.backoffMultiplier).toBe(DEFAULT_RETRY_CONFIG.backoffMultiplier);
    });
  });

  describe('wrapHandler - successful processing', () => {
    it('should ack message when handler succeeds', async () => {
      const message = createMockMessage();
      const handler = vi.fn().mockResolvedValue(undefined);

      const wrappedHandler = retryHandler.wrapHandler(handler, publisher);
      await wrappedHandler(message);

      expect(handler).toHaveBeenCalledWith(message);
      expect(message.ack).toHaveBeenCalledTimes(1);
      expect(message.nack).not.toHaveBeenCalled();
      expect(publisher.republish).not.toHaveBeenCalled();
    });
  });

  describe('wrapHandler - retry on failure', () => {
    it('should republish message on first failure (retry count 0)', async () => {
      const message = createMockMessage({ headers: {} });
      const handler = vi.fn().mockRejectedValue(new Error('Processing failed'));

      const wrappedHandler = retryHandler.wrapHandler(handler, publisher);
      await wrappedHandler(message);

      expect(publisher.republish).toHaveBeenCalledWith(
        'agent.events',
        'agent.status.changed',
        { data: 'test-payload' },
        expect.objectContaining({
          'x-retry-count': '1',
          'x-failure-reason': 'Processing failed',
          'x-original-exchange': 'agent.events',
          'x-original-routing-key': 'agent.status.changed',
        }),
        500, // baseDelay * 2^0
      );
      // Original message should be acked after successful republish
      expect(message.ack).toHaveBeenCalledTimes(1);
      expect(message.nack).not.toHaveBeenCalled();
    });

    it('should increment retry count on subsequent failures', async () => {
      const message = createMockMessage({
        headers: { 'x-retry-count': '2' },
      });
      const handler = vi.fn().mockRejectedValue(new Error('Still failing'));

      const wrappedHandler = retryHandler.wrapHandler(handler, publisher);
      await wrappedHandler(message);

      expect(publisher.republish).toHaveBeenCalledWith(
        'agent.events',
        'agent.status.changed',
        { data: 'test-payload' },
        expect.objectContaining({
          'x-retry-count': '3',
          'x-failure-reason': 'Still failing',
        }),
        2000, // 500 * 2^2
      );
    });

    it('should use exponential backoff for delay', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('fail'));

      // Test retry at count 3 → delay should be 500 * 2^3 = 4000
      const message = createMockMessage({
        headers: { 'x-retry-count': '3' },
      });

      const wrappedHandler = retryHandler.wrapHandler(handler, publisher);
      await wrappedHandler(message);

      expect(publisher.republish).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.anything(),
        expect.any(Object),
        4000,
      );
    });
  });

  describe('wrapHandler - max retries exceeded', () => {
    it('should nack message when max retries reached', async () => {
      const message = createMockMessage({
        headers: { 'x-retry-count': '5' }, // Already at max (5)
      });
      const handler = vi.fn().mockRejectedValue(new Error('Final failure'));

      const wrappedHandler = retryHandler.wrapHandler(handler, publisher);
      await wrappedHandler(message);

      expect(message.nack).toHaveBeenCalledWith(false);
      expect(publisher.republish).not.toHaveBeenCalled();
      expect(message.ack).not.toHaveBeenCalled();
    });

    it('should nack when retry count exceeds max retries', async () => {
      const message = createMockMessage({
        headers: { 'x-retry-count': '7' },
      });
      const handler = vi.fn().mockRejectedValue(new Error('Way past max'));

      const wrappedHandler = retryHandler.wrapHandler(handler, publisher);
      await wrappedHandler(message);

      expect(message.nack).toHaveBeenCalledWith(false);
      expect(publisher.republish).not.toHaveBeenCalled();
    });

    it('should retry on attempt 4 (one before max)', async () => {
      const message = createMockMessage({
        headers: { 'x-retry-count': '4' },
      });
      const handler = vi.fn().mockRejectedValue(new Error('Almost there'));

      const wrappedHandler = retryHandler.wrapHandler(handler, publisher);
      await wrappedHandler(message);

      // Should still retry (count 4 < maxRetries 5)
      expect(publisher.republish).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.anything(),
        expect.objectContaining({ 'x-retry-count': '5' }),
        8000, // 500 * 2^4
      );
      expect(message.ack).toHaveBeenCalled();
    });
  });

  describe('wrapHandler - failure reason recording', () => {
    it('should record Error message as failure reason', async () => {
      const message = createMockMessage();
      const handler = vi.fn().mockRejectedValue(new Error('Database connection lost'));

      const wrappedHandler = retryHandler.wrapHandler(handler, publisher);
      await wrappedHandler(message);

      expect(publisher.republish).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.anything(),
        expect.objectContaining({
          'x-failure-reason': 'Database connection lost',
        }),
        expect.any(Number),
      );
    });

    it('should record non-Error thrown value as string', async () => {
      const message = createMockMessage();
      const handler = vi.fn().mockRejectedValue('string error');

      const wrappedHandler = retryHandler.wrapHandler(handler, publisher);
      await wrappedHandler(message);

      expect(publisher.republish).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.anything(),
        expect.objectContaining({
          'x-failure-reason': 'string error',
        }),
        expect.any(Number),
      );
    });

    it('should preserve original headers when adding retry headers', async () => {
      const message = createMockMessage({
        headers: { 'x-custom': 'value', 'x-trace-id': 'trace-123' },
      });
      const handler = vi.fn().mockRejectedValue(new Error('fail'));

      const wrappedHandler = retryHandler.wrapHandler(handler, publisher);
      await wrappedHandler(message);

      expect(publisher.republish).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.anything(),
        expect.objectContaining({
          'x-custom': 'value',
          'x-trace-id': 'trace-123',
          'x-retry-count': '1',
          'x-failure-reason': 'fail',
        }),
        expect.any(Number),
      );
    });
  });

  describe('wrapHandler - republish failure fallback', () => {
    it('should nack to DLX if republish fails', async () => {
      const message = createMockMessage();
      const handler = vi.fn().mockRejectedValue(new Error('handler fail'));
      const failingPublisher: RetryPublisher = {
        republish: vi.fn().mockRejectedValue(new Error('publish fail')),
      };

      const wrappedHandler = retryHandler.wrapHandler(handler, failingPublisher);
      await wrappedHandler(message);

      expect(message.nack).toHaveBeenCalledWith(false);
    });
  });

  describe('isRetryableError', () => {
    it('should return true for configured retryable errors', () => {
      expect(retryHandler.isRetryableError('DELIVERY_FAILED')).toBe(true);
      expect(retryHandler.isRetryableError('CONSUMER_TIMEOUT')).toBe(true);
    });

    it('should return false for non-retryable errors', () => {
      expect(retryHandler.isRetryableError('VALIDATION_ERROR')).toBe(false);
      expect(retryHandler.isRetryableError('UNKNOWN')).toBe(false);
    });

    it('should return true for all errors when retryableErrors is empty', () => {
      const handler = new RetryHandler({ retryableErrors: [] });
      expect(handler.isRetryableError('ANY_ERROR')).toBe(true);
    });
  });

  describe('custom retry config', () => {
    it('should respect custom maxRetries', async () => {
      const customHandler = new RetryHandler({ maxRetries: 2 });
      const message = createMockMessage({
        headers: { 'x-retry-count': '2' },
      });
      const handler = vi.fn().mockRejectedValue(new Error('fail'));

      const wrappedHandler = customHandler.wrapHandler(handler, publisher);
      await wrappedHandler(message);

      // Should nack since count (2) >= maxRetries (2)
      expect(message.nack).toHaveBeenCalledWith(false);
      expect(publisher.republish).not.toHaveBeenCalled();
    });

    it('should respect custom baseDelay and backoffMultiplier', async () => {
      const customHandler = new RetryHandler({
        baseDelay: 1000,
        backoffMultiplier: 3,
      });
      const message = createMockMessage({
        headers: { 'x-retry-count': '1' },
      });
      const handler = vi.fn().mockRejectedValue(new Error('fail'));

      const wrappedHandler = customHandler.wrapHandler(handler, publisher);
      await wrappedHandler(message);

      // Delay: 1000 * 3^1 = 3000
      expect(publisher.republish).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.anything(),
        expect.any(Object),
        3000,
      );
    });

    it('should cap delay at custom maxDelay', async () => {
      const customHandler = new RetryHandler({
        baseDelay: 1000,
        backoffMultiplier: 10,
        maxDelay: 5000,
      });
      const message = createMockMessage({
        headers: { 'x-retry-count': '3' },
      });
      const handler = vi.fn().mockRejectedValue(new Error('fail'));

      const wrappedHandler = customHandler.wrapHandler(handler, publisher);
      await wrappedHandler(message);

      // Delay: min(1000 * 10^3, 5000) = 5000
      expect(publisher.republish).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.anything(),
        expect.any(Object),
        5000,
      );
    });
  });
});
