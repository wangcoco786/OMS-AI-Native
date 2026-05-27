import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { ErrorResponse, AgentStatus } from './types.js';

describe('Shared Types', () => {
  it('should define valid AgentStatus values', () => {
    const validStatuses: AgentStatus[] = ['registered', 'ready', 'running', 'paused', 'stopped'];
    expect(validStatuses).toHaveLength(5);
  });

  it('should construct a valid ErrorResponse', () => {
    const error: ErrorResponse = {
      error: {
        code: 'TEST_ERROR',
        message: 'Something went wrong',
        traceId: '123e4567-e89b-12d3-a456-426614174000',
        timestamp: new Date().toISOString(),
      },
    };
    expect(error.error.code).toBe('TEST_ERROR');
    expect(error.error.traceId).toBeDefined();
    expect(error.error.timestamp).toBeDefined();
  });
});

describe('Property: ErrorResponse structure', () => {
  it('should always have required fields for any input', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.uuid(), (code, message, traceId) => {
        const error: ErrorResponse = {
          error: {
            code,
            message,
            traceId,
            timestamp: new Date().toISOString(),
          },
        };
        expect(error.error.code).toBe(code);
        expect(error.error.message).toBe(message);
        expect(error.error.traceId).toBe(traceId);
        expect(error.error.timestamp).toBeTruthy();
      }),
      { numRuns: 100 },
    );
  });
});
