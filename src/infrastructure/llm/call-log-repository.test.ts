import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMCallLogRepository } from './call-log-repository.js';
import type { LLMCallLog } from './types.js';

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

// Mock PostgresDatabaseService
function createMockDb() {
  const mockTx = {
    query: vi.fn().mockResolvedValue([]),
    client: {} as never,
  };

  const db = {
    transaction: vi.fn().mockImplementation(async (fn: (tx: typeof mockTx) => Promise<unknown>) => {
      return fn(mockTx);
    }),
    query: vi.fn().mockResolvedValue([]),
    migrate: vi.fn(),
    getPoolStats: vi.fn(),
    shutdown: vi.fn(),
  };

  return { db, mockTx };
}

const sampleLog: LLMCallLog = {
  tenantId: 'tenant-1',
  sessionId: 'session-abc',
  model: 'claude-sonnet-4-20250514',
  inputTokens: 100,
  outputTokens: 50,
  latencyMs: 1200,
  status: 'success',
};

const sampleErrorLog: LLMCallLog = {
  tenantId: 'tenant-1',
  sessionId: 'session-def',
  model: 'claude-sonnet-4-20250514',
  inputTokens: 0,
  outputTokens: 0,
  latencyMs: 3000,
  status: 'error',
  errorMessage: 'Rate limit exceeded',
};

describe('LLMCallLogRepository', () => {
  let repository: LLMCallLogRepository;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    repository = new LLMCallLogRepository(mockDb.db as never);
  });

  describe('save()', () => {
    it('should insert a successful call log into the database', async () => {
      await repository.save(sampleLog);

      expect(mockDb.db.transaction).toHaveBeenCalledTimes(1);
      expect(mockDb.mockTx.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO llm_call_logs'),
        [
          'tenant-1',
          'session-abc',
          'claude-sonnet-4-20250514',
          100,
          50,
          1200,
          'success',
          null,
        ],
      );
    });

    it('should insert an error call log with error message', async () => {
      await repository.save(sampleErrorLog);

      expect(mockDb.mockTx.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO llm_call_logs'),
        [
          'tenant-1',
          'session-def',
          'claude-sonnet-4-20250514',
          0,
          0,
          3000,
          'error',
          'Rate limit exceeded',
        ],
      );
    });

    it('should handle null sessionId gracefully', async () => {
      const logWithEmptySession: LLMCallLog = {
        ...sampleLog,
        sessionId: '',
      };

      await repository.save(logWithEmptySession);

      expect(mockDb.mockTx.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO llm_call_logs'),
        expect.arrayContaining([null]), // empty string becomes null
      );
    });

    it('should propagate database errors', async () => {
      mockDb.db.transaction.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(repository.save(sampleLog)).rejects.toThrow('Connection refused');
    });
  });

  describe('findByTenant()', () => {
    it('should query logs for a specific tenant with default pagination', async () => {
      mockDb.mockTx.query.mockResolvedValueOnce([
        {
          tenant_id: 'tenant-1',
          session_id: 'session-abc',
          model: 'claude-sonnet-4-20250514',
          input_tokens: 100,
          output_tokens: 50,
          latency_ms: 1200,
          status: 'success',
          error_message: null,
        },
      ]);

      const results = await repository.findByTenant('tenant-1');

      expect(mockDb.mockTx.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE tenant_id = $1'),
        ['tenant-1', 50, 0],
      );
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        tenantId: 'tenant-1',
        sessionId: 'session-abc',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 1200,
        status: 'success',
        errorMessage: undefined,
      });
    });

    it('should apply custom limit and offset', async () => {
      mockDb.mockTx.query.mockResolvedValueOnce([]);

      await repository.findByTenant('tenant-1', { limit: 10, offset: 20 });

      expect(mockDb.mockTx.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $2 OFFSET $3'),
        ['tenant-1', 10, 20],
      );
    });

    it('should map error logs correctly', async () => {
      mockDb.mockTx.query.mockResolvedValueOnce([
        {
          tenant_id: 'tenant-1',
          session_id: null,
          model: 'claude-sonnet-4-20250514',
          input_tokens: 0,
          output_tokens: 0,
          latency_ms: 3000,
          status: 'error',
          error_message: 'Timeout',
        },
      ]);

      const results = await repository.findByTenant('tenant-1');

      expect(results[0]).toEqual({
        tenantId: 'tenant-1',
        sessionId: '',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 3000,
        status: 'error',
        errorMessage: 'Timeout',
      });
    });

    it('should return empty array when no logs exist', async () => {
      mockDb.mockTx.query.mockResolvedValueOnce([]);

      const results = await repository.findByTenant('tenant-nonexistent');

      expect(results).toEqual([]);
    });
  });

  describe('getUsageStats()', () => {
    it('should return aggregated usage stats for a date range', async () => {
      mockDb.mockTx.query.mockResolvedValueOnce([
        {
          input_tokens: '500',
          output_tokens: '250',
          total_calls: '10',
        },
      ]);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const stats = await repository.getUsageStats('tenant-1', startDate, endDate);

      expect(mockDb.mockTx.query).toHaveBeenCalledWith(
        expect.stringContaining("status = 'success'"),
        ['tenant-1', startDate, endDate],
      );
      expect(stats).toEqual({
        inputTokens: 500,
        outputTokens: 250,
        totalCalls: 10,
        period: `${startDate.toISOString()}/${endDate.toISOString()}`,
      });
    });

    it('should return zero stats when no data exists', async () => {
      mockDb.mockTx.query.mockResolvedValueOnce([
        {
          input_tokens: 0,
          output_tokens: 0,
          total_calls: 0,
        },
      ]);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const stats = await repository.getUsageStats('tenant-1', startDate, endDate);

      expect(stats.inputTokens).toBe(0);
      expect(stats.outputTokens).toBe(0);
      expect(stats.totalCalls).toBe(0);
    });

    it('should handle numeric string values from PostgreSQL', async () => {
      // PostgreSQL returns bigint/numeric as strings
      mockDb.mockTx.query.mockResolvedValueOnce([
        {
          input_tokens: '123456',
          output_tokens: '78901',
          total_calls: '42',
        },
      ]);

      const stats = await repository.getUsageStats(
        'tenant-1',
        new Date('2024-01-01'),
        new Date('2024-12-31'),
      );

      expect(stats.inputTokens).toBe(123456);
      expect(stats.outputTokens).toBe(78901);
      expect(stats.totalCalls).toBe(42);
    });
  });
});

describe('LLMGatewayService integration with LLMCallLogRepository', () => {
  it('should persist call logs to repository when configured (fire-and-forget)', async () => {
    // We test this by importing the gateway and verifying the repository.save is called
    const { LLMGatewayService } = await import('./llm-gateway.js');

    const mockRepository = {
      save: vi.fn().mockResolvedValue(undefined),
      findByTenant: vi.fn(),
      getUsageStats: vi.fn(),
    };

    const gateway = new LLMGatewayService({
      callLogRepository: mockRepository as never,
      retryConfig: { maxRetries: 0, baseDelay: 0, maxDelay: 0, backoffMultiplier: 2, retryableErrors: [] },
    });

    gateway.registerTenant({
      tenantId: 'tenant-a',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      rateLimit: 60,
    });

    // Mock fetch for a successful response
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await gateway.complete({
      tenantId: 'tenant-a',
      sessionId: 'session-1',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: false,
    });

    // Allow the fire-and-forget promise to resolve
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockRepository.save).toHaveBeenCalledTimes(1);
    expect(mockRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        sessionId: 'session-1',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 10,
        outputTokens: 5,
        status: 'success',
      }),
    );
  });

  it('should not block the response if repository save fails', async () => {
    const { LLMGatewayService } = await import('./llm-gateway.js');

    const mockRepository = {
      save: vi.fn().mockRejectedValue(new Error('DB connection lost')),
      findByTenant: vi.fn(),
      getUsageStats: vi.fn(),
    };

    const gateway = new LLMGatewayService({
      callLogRepository: mockRepository as never,
      retryConfig: { maxRetries: 0, baseDelay: 0, maxDelay: 0, backoffMultiplier: 2, retryableErrors: [] },
    });

    gateway.registerTenant({
      tenantId: 'tenant-a',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      rateLimit: 60,
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: 'msg_456',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    // Should not throw even though repository.save fails
    const result = await gateway.complete({
      tenantId: 'tenant-a',
      sessionId: 'session-2',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: false,
    });

    expect(result.id).toBe('msg_456');

    // Allow the fire-and-forget promise to settle
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockRepository.save).toHaveBeenCalledTimes(1);
  });

  it('should work without a repository configured (backward compatible)', async () => {
    const { LLMGatewayService } = await import('./llm-gateway.js');

    const gateway = new LLMGatewayService({
      retryConfig: { maxRetries: 0, baseDelay: 0, maxDelay: 0, backoffMultiplier: 2, retryableErrors: [] },
    });

    gateway.registerTenant({
      tenantId: 'tenant-a',
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      rateLimit: 60,
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: 'msg_789',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    // Should work fine without repository
    const result = await gateway.complete({
      tenantId: 'tenant-a',
      sessionId: 'session-3',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: false,
    });

    expect(result.id).toBe('msg_789');
  });
});
