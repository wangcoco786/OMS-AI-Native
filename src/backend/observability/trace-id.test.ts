/**
 * Tests for Trace ID generation and propagation middleware.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response, NextFunction } from 'express';
import { generateTraceId, traceIdMiddleware, type TracedRequest } from './trace-id.js';

describe('generateTraceId', () => {
  it('should return a valid UUID v4 string', () => {
    const traceId = generateTraceId();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(traceId).toMatch(uuidRegex);
  });

  it('should generate unique IDs on each call', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateTraceId());
    }
    expect(ids.size).toBe(1000);
  });
});

describe('traceIdMiddleware', () => {
  let mockReq: Partial<TracedRequest>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      headers: {},
    };
    mockRes = {
      setHeader: vi.fn(),
    };
    mockNext = vi.fn();
  });

  it('should generate a new trace ID when no x-trace-id header is present', () => {
    traceIdMiddleware(mockReq as TracedRequest, mockRes as Response, mockNext);

    expect(mockReq.traceId).toBeDefined();
    expect(mockReq.traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(mockRes.setHeader).toHaveBeenCalledWith('x-trace-id', mockReq.traceId);
    expect(mockNext).toHaveBeenCalled();
  });

  it('should reuse existing x-trace-id header from the request', () => {
    const existingTraceId = 'abc12345-1234-4567-8901-abcdef123456';
    mockReq.headers = { 'x-trace-id': existingTraceId };

    traceIdMiddleware(mockReq as TracedRequest, mockRes as Response, mockNext);

    expect(mockReq.traceId).toBe(existingTraceId);
    expect(mockRes.setHeader).toHaveBeenCalledWith('x-trace-id', existingTraceId);
    expect(mockNext).toHaveBeenCalled();
  });

  it('should generate a new trace ID when x-trace-id header is empty string', () => {
    mockReq.headers = { 'x-trace-id': '' };

    traceIdMiddleware(mockReq as TracedRequest, mockRes as Response, mockNext);

    expect(mockReq.traceId).toBeDefined();
    expect(mockReq.traceId).not.toBe('');
    expect(mockNext).toHaveBeenCalled();
  });

  it('should always call next()', () => {
    traceIdMiddleware(mockReq as TracedRequest, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalledTimes(1);
  });
});
