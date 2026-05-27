import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolCallLogger } from './tool-call-logger.js';
import type { ToolCallRequest, ToolCallResult } from './types.js';

// Mock PostgresDatabaseService
const mockTxQuery = vi.fn();
const mockTransaction = vi.fn();
const mockDb = {
  transaction: mockTransaction,
} as any;

// Mock pino
vi.mock('pino', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  return { default: vi.fn(() => mockLogger) };
});

/** Helper to create a valid ToolCallRequest */
function createTestRequest(overrides?: Partial<ToolCallRequest>): ToolCallRequest {
  return {
    toolName: 'query_orders',
    input: { orderNo: 'ORD-001' },
    callerId: 'agent-123',
    tenantId: 'tenant-456',
    traceId: 'trace-789',
    ...overrides,
  };
}

/** Helper to create a successful ToolCallResult */
function createSuccessResult(overrides?: Partial<ToolCallResult>): ToolCallResult {
  return {
    success: true,
    output: { orders: [{ id: '1', orderNo: 'ORD-001' }] },
    executionTime: 150,
    ...overrides,
  };
}

/** Helper to create a failed ToolCallResult */
function createFailureResult(overrides?: Partial<ToolCallResult>): ToolCallResult {
  return {
    success: false,
    error: { code: 'EXECUTION_ERROR', message: 'Tool timed out' },
    executionTime: 30000,
    ...overrides,
  };
}

describe('ToolCallLogger', () => {
  let logger: ToolCallLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTxQuery.mockResolvedValue([]);
    mockTransaction.mockImplementation(async (fn: any) => {
      return fn({ query: mockTxQuery });
    });
    logger = new ToolCallLogger(mockDb);
  });

  describe('log', () => {
    it('should insert a successful tool call record into tool_calls table', async () => {
      const request = createTestRequest();
      const result = createSuccessResult();

      await logger.log(request, result);

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockTxQuery).toHaveBeenCalledTimes(1);

      const [sql, params] = mockTxQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO tool_calls');
      expect(params[0]).toBe('query_orders');       // tool_name
      expect(params[1]).toBe('agent-123');           // caller_id
      expect(params[2]).toBe('tenant-456');          // tenant_id
      expect(params[3]).toBe('trace-789');           // trace_id
      expect(params[4]).toBe(JSON.stringify({ orderNo: 'ORD-001' })); // input
      expect(params[5]).toBe(JSON.stringify({ orders: [{ id: '1', orderNo: 'ORD-001' }] })); // output
      expect(params[6]).toBe(true);                  // success
      expect(params[7]).toBeNull();                  // error_message (null for success)
      expect(params[8]).toBe(150);                   // execution_time_ms
    });

    it('should insert a failed tool call record with error message', async () => {
      const request = createTestRequest();
      const result = createFailureResult();

      await logger.log(request, result);

      expect(mockTxQuery).toHaveBeenCalledTimes(1);

      const [_sql, params] = mockTxQuery.mock.calls[0];
      expect(params[5]).toBeNull();                  // output (null for failure)
      expect(params[6]).toBe(false);                 // success
      expect(params[7]).toBe('Tool timed out');      // error_message
      expect(params[8]).toBe(30000);                 // execution_time_ms
    });

    it('should handle null output gracefully', async () => {
      const request = createTestRequest();
      const result: ToolCallResult = {
        success: true,
        output: undefined,
        executionTime: 50,
      };

      await logger.log(request, result);

      const [_sql, params] = mockTxQuery.mock.calls[0];
      expect(params[5]).toBeNull(); // output should be null when undefined
    });

    it('should handle null input gracefully', async () => {
      const request = createTestRequest({ input: null });
      const result = createSuccessResult();

      await logger.log(request, result);

      const [_sql, params] = mockTxQuery.mock.calls[0];
      expect(params[4]).toBe('null'); // JSON.stringify(null) = 'null'
    });

    it('should not throw when database insert fails', async () => {
      mockTransaction.mockRejectedValue(new Error('DB connection lost'));

      const request = createTestRequest();
      const result = createSuccessResult();

      // Should not throw
      await expect(logger.log(request, result)).resolves.toBeUndefined();
    });

    it('should log all required fields for observability', async () => {
      const request = createTestRequest({
        toolName: 'create_order',
        callerId: 'user-abc',
        tenantId: 'tenant-xyz',
        traceId: 'trace-def',
        input: { items: [{ sku: 'SKU-1', qty: 2 }] },
      });
      const result: ToolCallResult = {
        success: true,
        output: { orderId: 'new-order-1' },
        executionTime: 250,
      };

      await logger.log(request, result);

      const [sql, params] = mockTxQuery.mock.calls[0];
      expect(sql).toContain('tool_name');
      expect(sql).toContain('caller_id');
      expect(sql).toContain('tenant_id');
      expect(sql).toContain('trace_id');
      expect(sql).toContain('input');
      expect(sql).toContain('output');
      expect(sql).toContain('success');
      expect(sql).toContain('error_message');
      expect(sql).toContain('execution_time_ms');

      expect(params[0]).toBe('create_order');
      expect(params[1]).toBe('user-abc');
      expect(params[2]).toBe('tenant-xyz');
      expect(params[3]).toBe('trace-def');
      expect(params[4]).toBe(JSON.stringify({ items: [{ sku: 'SKU-1', qty: 2 }] }));
      expect(params[5]).toBe(JSON.stringify({ orderId: 'new-order-1' }));
      expect(params[6]).toBe(true);
      expect(params[7]).toBeNull();
      expect(params[8]).toBe(250);
    });

    it('should handle result with no error field on failure', async () => {
      const request = createTestRequest();
      const result: ToolCallResult = {
        success: false,
        executionTime: 100,
      };

      await logger.log(request, result);

      const [_sql, params] = mockTxQuery.mock.calls[0];
      expect(params[6]).toBe(false);
      expect(params[7]).toBeNull(); // error?.message ?? null
    });
  });
});
