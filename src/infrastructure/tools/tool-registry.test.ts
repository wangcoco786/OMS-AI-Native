import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPToolRegistryService } from './tool-registry.js';
import type { MCPToolDefinition } from './types.js';

// Mock PostgresDatabaseService
const mockTransaction = vi.fn();
const mockDb = {
  transaction: mockTransaction,
} as any;

// Mock RedisCacheService
const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheDel = vi.fn();
const mockCache = {
  cacheGet: mockCacheGet,
  cacheSet: mockCacheSet,
  cacheDel: mockCacheDel,
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

/** Helper to create a valid MCPToolDefinition */
function createTestTool(overrides?: Partial<MCPToolDefinition>): MCPToolDefinition {
  return {
    name: 'query_orders',
    description: 'Query order information',
    inputSchema: { type: 'object', properties: { orderNo: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { orders: { type: 'array' } } },
    version: '1.0.0',
    permissions: ['orders:read'],
    timeout: 30000,
    sandbox: 'v8-isolate',
    ...overrides,
  };
}

describe('MCPToolRegistryService', () => {
  let registry: MCPToolRegistryService;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new MCPToolRegistryService(mockDb, mockCache);
  });

  describe('register', () => {
    it('should insert tool into database and invalidate cache', async () => {
      const tool = createTestTool();
      const mockTxQuery = vi.fn().mockResolvedValue([]);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: mockTxQuery });
      });
      mockCacheDel.mockResolvedValue(undefined);

      await registry.register(tool);

      // Verify DB insert was called
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockTxQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockTxQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO tools');
      expect(sql).toContain('ON CONFLICT (name) DO UPDATE');
      expect(params[0]).toBe('query_orders');
      expect(params[1]).toBe('Query order information');
      expect(params[2]).toBe('1.0.0');
      expect(params[5]).toEqual(['orders:read']);
      expect(params[6]).toBe(30000);
      expect(params[7]).toBe('v8-isolate');

      // Verify cache invalidation
      expect(mockCacheDel).toHaveBeenCalledWith('tools:registry');
    });

    it('should handle re-registration (upsert) of existing tool', async () => {
      const tool = createTestTool({ version: '2.0.0' });
      const mockTxQuery = vi.fn().mockResolvedValue([]);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: mockTxQuery });
      });
      mockCacheDel.mockResolvedValue(undefined);

      await registry.register(tool);

      const [sql] = mockTxQuery.mock.calls[0];
      expect(sql).toContain('ON CONFLICT (name) DO UPDATE');
    });

    it('should propagate database errors', async () => {
      const tool = createTestTool();
      mockTransaction.mockRejectedValue(new Error('DB connection failed'));

      await expect(registry.register(tool)).rejects.toThrow('DB connection failed');
    });

    it('should still invalidate cache even if cache delete fails gracefully', async () => {
      const tool = createTestTool();
      const mockTxQuery = vi.fn().mockResolvedValue([]);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: mockTxQuery });
      });
      // Cache delete fails but should not throw
      mockCacheDel.mockRejectedValue(new Error('Redis down'));

      // Should not throw - cache invalidation failure is non-fatal
      await registry.register(tool);
      expect(mockCacheDel).toHaveBeenCalledWith('tools:registry');
    });
  });

  describe('unregister', () => {
    it('should set tool status to inactive and invalidate cache', async () => {
      const mockTxQuery = vi.fn().mockResolvedValue([{ id: 'uuid-123' }]);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: mockTxQuery });
      });
      mockCacheDel.mockResolvedValue(undefined);

      await registry.unregister('query_orders');

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      const [sql, params] = mockTxQuery.mock.calls[0];
      expect(sql).toContain("SET status = 'inactive'");
      expect(sql).toContain("WHERE name = $1 AND status = 'active'");
      expect(params[0]).toBe('query_orders');

      // Verify cache invalidation
      expect(mockCacheDel).toHaveBeenCalledWith('tools:registry');
    });

    it('should throw when tool not found or already inactive', async () => {
      const mockTxQuery = vi.fn().mockResolvedValue([]);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: mockTxQuery });
      });

      await expect(registry.unregister('nonexistent_tool')).rejects.toThrow(
        "Tool 'nonexistent_tool' not found or already inactive",
      );
    });

    it('should propagate database errors', async () => {
      mockTransaction.mockRejectedValue(new Error('DB timeout'));

      await expect(registry.unregister('query_orders')).rejects.toThrow('DB timeout');
    });
  });

  describe('discover', () => {
    const toolRow = {
      id: 'uuid-123',
      name: 'query_orders',
      description: 'Query order information',
      version: '1.0.0',
      input_schema: { type: 'object', properties: { orderNo: { type: 'string' } } },
      output_schema: { type: 'object', properties: { orders: { type: 'array' } } },
      permissions: ['orders:read'],
      timeout_ms: 30000,
      sandbox_type: 'v8-isolate',
      status: 'active',
      created_at: new Date(),
      updated_at: new Date(),
    };

    it('should return cached tools when available (no filter)', async () => {
      const cachedTools: MCPToolDefinition[] = [createTestTool()];
      mockCacheGet.mockResolvedValue(cachedTools);

      const result = await registry.discover();

      expect(result).toEqual(cachedTools);
      expect(mockCacheGet).toHaveBeenCalledWith('tools:registry');
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('should query database on cache miss and cache the result', async () => {
      mockCacheGet.mockResolvedValue(null);
      const mockTxQuery = vi.fn().mockResolvedValue([toolRow]);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: mockTxQuery });
      });
      mockCacheSet.mockResolvedValue(undefined);

      const result = await registry.discover();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('query_orders');
      expect(result[0].description).toBe('Query order information');
      expect(result[0].version).toBe('1.0.0');
      expect(result[0].timeout).toBe(30000);
      expect(result[0].sandbox).toBe('v8-isolate');
      expect(result[0].permissions).toEqual(['orders:read']);

      // Verify caching
      expect(mockCacheSet).toHaveBeenCalledWith('tools:registry', result, 300);
    });

    it('should bypass cache when filter is provided', async () => {
      const mockTxQuery = vi.fn().mockResolvedValue([toolRow]);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: mockTxQuery });
      });

      const result = await registry.discover({ name: 'query' });

      expect(result).toHaveLength(1);
      expect(mockCacheGet).not.toHaveBeenCalled();
      // Should NOT cache filtered results
      expect(mockCacheSet).not.toHaveBeenCalled();
    });

    it('should filter by name (partial match)', async () => {
      const mockTxQuery = vi.fn().mockResolvedValue([toolRow]);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: mockTxQuery });
      });

      await registry.discover({ name: 'order' });

      const [sql, params] = mockTxQuery.mock.calls[0];
      expect(sql).toContain('name ILIKE');
      expect(params).toContain('%order%');
    });

    it('should filter by status', async () => {
      const mockTxQuery = vi.fn().mockResolvedValue([]);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: mockTxQuery });
      });

      await registry.discover({ status: 'inactive' });

      const [_sql, params] = mockTxQuery.mock.calls[0];
      expect(params).toContain('inactive');
    });

    it('should filter by sandbox type', async () => {
      const mockTxQuery = vi.fn().mockResolvedValue([toolRow]);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: mockTxQuery });
      });

      await registry.discover({ sandbox: 'docker' });

      const [sql, params] = mockTxQuery.mock.calls[0];
      expect(sql).toContain('sandbox_type');
      expect(params).toContain('docker');
    });

    it('should filter by permission', async () => {
      const mockTxQuery = vi.fn().mockResolvedValue([toolRow]);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: mockTxQuery });
      });

      await registry.discover({ permission: 'orders:read' });

      const [sql, params] = mockTxQuery.mock.calls[0];
      expect(sql).toContain('ANY(permissions)');
      expect(params).toContain('orders:read');
    });

    it('should fall back to database when cache read fails', async () => {
      mockCacheGet.mockRejectedValue(new Error('Redis connection lost'));
      const mockTxQuery = vi.fn().mockResolvedValue([toolRow]);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: mockTxQuery });
      });
      mockCacheSet.mockResolvedValue(undefined);

      const result = await registry.discover();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('query_orders');
    });

    it('should return empty array when no tools match', async () => {
      mockCacheGet.mockResolvedValue(null);
      const mockTxQuery = vi.fn().mockResolvedValue([]);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: mockTxQuery });
      });
      mockCacheSet.mockResolvedValue(undefined);

      const result = await registry.discover();

      expect(result).toEqual([]);
    });

    it('should handle null description in tool row', async () => {
      mockCacheGet.mockResolvedValue(null);
      const rowWithNullDesc = { ...toolRow, description: null };
      const mockTxQuery = vi.fn().mockResolvedValue([rowWithNullDesc]);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: mockTxQuery });
      });
      mockCacheSet.mockResolvedValue(undefined);

      const result = await registry.discover();

      expect(result[0].description).toBe('');
    });
  });

  describe('hot-plug behavior', () => {
    it('should make newly registered tool discoverable immediately', async () => {
      const tool = createTestTool({ name: 'new_tool' });

      // Register: insert + invalidate cache
      const mockTxQuery = vi.fn().mockResolvedValue([]);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: mockTxQuery });
      });
      mockCacheDel.mockResolvedValue(undefined);

      await registry.register(tool);

      // Cache was invalidated
      expect(mockCacheDel).toHaveBeenCalledWith('tools:registry');

      // Next discover() will miss cache and query DB
      mockCacheGet.mockResolvedValue(null);
      const newToolRow = {
        id: 'uuid-new',
        name: 'new_tool',
        description: 'Query order information',
        version: '1.0.0',
        input_schema: tool.inputSchema,
        output_schema: tool.outputSchema,
        permissions: tool.permissions,
        timeout_ms: tool.timeout,
        sandbox_type: tool.sandbox,
        status: 'active',
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: vi.fn().mockResolvedValue([newToolRow]) });
      });
      mockCacheSet.mockResolvedValue(undefined);

      const result = await registry.discover();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('new_tool');
    });

    it('should make unregistered tool undiscoverable immediately', async () => {
      // Unregister: set inactive + invalidate cache
      const mockTxQuery = vi.fn().mockResolvedValue([{ id: 'uuid-123' }]);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: mockTxQuery });
      });
      mockCacheDel.mockResolvedValue(undefined);

      await registry.unregister('old_tool');

      // Cache was invalidated
      expect(mockCacheDel).toHaveBeenCalledWith('tools:registry');

      // Next discover() returns empty (tool is inactive)
      mockCacheGet.mockResolvedValue(null);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: vi.fn().mockResolvedValue([]) });
      });
      mockCacheSet.mockResolvedValue(undefined);

      const result = await registry.discover();
      expect(result).toEqual([]);
    });
  });

  describe('invoke', () => {
    const toolRow = {
      id: 'uuid-123',
      name: 'query_orders',
      description: 'Query order information',
      version: '1.0.0',
      input_schema: {
        type: 'object',
        properties: { orderNo: { type: 'string' } },
        required: ['orderNo'],
      },
      output_schema: { type: 'object' },
      permissions: ['orders:read'],
      timeout_ms: 30000,
      sandbox_type: 'v8-isolate',
      status: 'active',
      created_at: new Date(),
      updated_at: new Date(),
    };

    it('should return validation error when input is invalid', async () => {
      // Setup: discover returns the tool
      mockCacheGet.mockResolvedValue(null);
      const mockTxQuery = vi.fn().mockResolvedValue([toolRow]);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: mockTxQuery });
      });
      mockCacheSet.mockResolvedValue(undefined);

      const result = await registry.invoke({
        toolName: 'query_orders',
        input: {}, // missing required 'orderNo'
        callerId: 'agent-1',
        tenantId: 'tenant-1',
        traceId: 'trace-1',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_FAILED');
      expect(result.executionTime).toBe(0);
    });

    it('should return error when tool executor is not configured', async () => {
      // Setup: discover returns the tool, input is valid
      mockCacheGet.mockResolvedValue(null);
      const mockTxQuery = vi.fn().mockResolvedValue([toolRow]);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: mockTxQuery });
      });
      mockCacheSet.mockResolvedValue(undefined);

      const result = await registry.invoke({
        toolName: 'query_orders',
        input: { orderNo: 'ORD-001' },
        callerId: 'agent-1',
        tenantId: 'tenant-1',
        traceId: 'trace-1',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EXECUTOR_NOT_CONFIGURED');
    });

    it('should delegate to tool executor and return result on success', async () => {
      // Setup: configure a mock executor
      const mockExecutor = {
        execute: vi.fn().mockResolvedValue({
          success: true,
          output: { orders: [] },
          executionTime: 100,
        }),
      };
      registry.setToolExecutor(mockExecutor);

      // Setup: discover returns the tool
      mockCacheGet.mockResolvedValue(null);
      const mockTxQuery = vi.fn().mockResolvedValue([toolRow]);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: mockTxQuery });
      });
      mockCacheSet.mockResolvedValue(undefined);

      const result = await registry.invoke({
        toolName: 'query_orders',
        input: { orderNo: 'ORD-001' },
        callerId: 'agent-1',
        tenantId: 'tenant-1',
        traceId: 'trace-1',
      });

      expect(result.success).toBe(true);
      expect(result.output).toEqual({ orders: [] });
      expect(mockExecutor.execute).toHaveBeenCalledWith(
        'query_orders',
        { orderNo: 'ORD-001' },
        { timeout: 30000, sandbox: 'v8-isolate' },
      );
    });

    it('should return error result when executor throws', async () => {
      const mockExecutor = {
        execute: vi.fn().mockRejectedValue(new Error('Sandbox crashed')),
      };
      registry.setToolExecutor(mockExecutor);

      // Setup: discover returns the tool
      mockCacheGet.mockResolvedValue(null);
      const mockTxQuery = vi.fn().mockResolvedValue([toolRow]);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: mockTxQuery });
      });
      mockCacheSet.mockResolvedValue(undefined);

      const result = await registry.invoke({
        toolName: 'query_orders',
        input: { orderNo: 'ORD-001' },
        callerId: 'agent-1',
        tenantId: 'tenant-1',
        traceId: 'trace-1',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EXECUTION_ERROR');
      expect(result.error?.message).toBe('Sandbox crashed');
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it('should return error when tool is not found', async () => {
      const mockExecutor = { execute: vi.fn() };
      registry.setToolExecutor(mockExecutor);

      // Setup: discover returns empty (tool not found)
      mockCacheGet.mockResolvedValue(null);
      const mockTxQuery = vi.fn().mockResolvedValue([]);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: mockTxQuery });
      });
      mockCacheSet.mockResolvedValue(undefined);

      const result = await registry.invoke({
        toolName: 'nonexistent_tool',
        input: {},
        callerId: 'agent-1',
        tenantId: 'tenant-1',
        traceId: 'trace-1',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_FAILED');
      expect(result.error?.message).toContain('not found');
    });
  });

  describe('validate', () => {
    it('should return error when tool is not found', async () => {
      // discover returns empty for the tool name
      mockCacheGet.mockResolvedValue(null);
      const mockTxQuery = vi.fn().mockResolvedValue([]);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: mockTxQuery });
      });
      mockCacheSet.mockResolvedValue(undefined);

      const result = await registry.validate('nonexistent_tool', { foo: 'bar' });

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].message).toContain('not found');
    });

    it('should return valid when input matches tool schema', async () => {
      const toolRow = {
        id: 'uuid-123',
        name: 'query_orders',
        description: 'Query order information',
        version: '1.0.0',
        input_schema: {
          type: 'object',
          properties: { orderNo: { type: 'string' } },
          required: ['orderNo'],
        },
        output_schema: { type: 'object' },
        permissions: ['orders:read'],
        timeout_ms: 30000,
        sandbox_type: 'v8-isolate',
        status: 'active',
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockCacheGet.mockResolvedValue(null);
      const mockTxQuery = vi.fn().mockResolvedValue([toolRow]);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: mockTxQuery });
      });
      mockCacheSet.mockResolvedValue(undefined);

      const result = await registry.validate('query_orders', { orderNo: 'ORD-001' });

      expect(result.valid).toBe(true);
    });

    it('should return errors when input does not match tool schema', async () => {
      const toolRow = {
        id: 'uuid-123',
        name: 'query_orders',
        description: 'Query order information',
        version: '1.0.0',
        input_schema: {
          type: 'object',
          properties: { orderNo: { type: 'string' } },
          required: ['orderNo'],
        },
        output_schema: { type: 'object' },
        permissions: ['orders:read'],
        timeout_ms: 30000,
        sandbox_type: 'v8-isolate',
        status: 'active',
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockCacheGet.mockResolvedValue(null);
      const mockTxQuery = vi.fn().mockResolvedValue([toolRow]);
      mockTransaction.mockImplementation(async (fn: any) => {
        return fn({ query: mockTxQuery });
      });
      mockCacheSet.mockResolvedValue(undefined);

      const result = await registry.validate('query_orders', {});

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].field).toBe('orderNo');
    });
  });
});
