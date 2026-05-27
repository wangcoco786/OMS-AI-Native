import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PostgresDatabaseService } from './database-service.js';
import type { PostgresConfig } from './types.js';

// Mock pg module
vi.mock('pg', () => {
  const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  };

  const mockPool = {
    connect: vi.fn().mockResolvedValue(mockClient),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    totalCount: 10,
    idleCount: 5,
    waitingCount: 0,
  };

  return {
    default: {
      Pool: vi.fn(() => mockPool),
    },
  };
});

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

const testConfig: PostgresConfig = {
  host: 'localhost',
  port: 5432,
  database: 'test_db',
  user: 'test_user',
  password: 'test_pass',
  poolSize: 100,
  connectionTimeoutMs: 5000,
  idleTimeoutMs: 30000,
  statementTimeoutMs: 30000,
};

describe('PostgresDatabaseService', () => {
  let service: PostgresDatabaseService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PostgresDatabaseService(testConfig);
  });

  afterEach(async () => {
    await service.shutdown();
  });

  describe('constructor', () => {
    it('should create a service with default retry config', () => {
      const svc = new PostgresDatabaseService(testConfig);
      expect(svc).toBeDefined();
    });

    it('should accept custom retry config', () => {
      const svc = new PostgresDatabaseService(testConfig, {
        retryConfig: { maxRetries: 10, baseDelayMs: 500 },
      });
      expect(svc).toBeDefined();
    });
  });

  describe('getPoolStats', () => {
    it('should return pool statistics', () => {
      const stats = service.getPoolStats();
      expect(stats).toEqual({
        totalCount: 10,
        idleCount: 5,
        waitingCount: 0,
      });
    });
  });

  describe('injectTenantFilter', () => {
    it('should add WHERE clause when none exists', () => {
      const { isolatedSql, isolatedParams } = service.injectTenantFilter(
        'SELECT * FROM orders',
        [],
        'tenant-123',
      );
      expect(isolatedSql).toBe('SELECT * FROM orders WHERE tenant_id = $1');
      expect(isolatedParams).toEqual(['tenant-123']);
    });

    it('should add AND condition when WHERE already exists', () => {
      const { isolatedSql, isolatedParams } = service.injectTenantFilter(
        'SELECT * FROM orders WHERE status = $1',
        ['active'],
        'tenant-456',
      );
      expect(isolatedSql).toBe(
        'SELECT * FROM orders WHERE tenant_id = $2 AND status = $1',
      );
      expect(isolatedParams).toEqual(['active', 'tenant-456']);
    });

    it('should handle queries with ORDER BY', () => {
      const { isolatedSql, isolatedParams } = service.injectTenantFilter(
        'SELECT * FROM orders ORDER BY created_at DESC',
        [],
        'tenant-789',
      );
      expect(isolatedSql).toBe(
        'SELECT * FROM orders WHERE tenant_id = $1 ORDER BY created_at DESC',
      );
      expect(isolatedParams).toEqual(['tenant-789']);
    });

    it('should handle queries with LIMIT and OFFSET', () => {
      const { isolatedSql, isolatedParams } = service.injectTenantFilter(
        'SELECT * FROM orders LIMIT 10 OFFSET 20',
        [],
        'tenant-abc',
      );
      expect(isolatedSql).toBe(
        'SELECT * FROM orders WHERE tenant_id = $1 LIMIT 10 OFFSET 20',
      );
      expect(isolatedParams).toEqual(['tenant-abc']);
    });

    it('should handle queries with GROUP BY and HAVING', () => {
      const { isolatedSql, isolatedParams } = service.injectTenantFilter(
        'SELECT status, COUNT(*) FROM orders GROUP BY status HAVING COUNT(*) > 1',
        [],
        'tenant-xyz',
      );
      expect(isolatedSql).toBe(
        'SELECT status, COUNT(*) FROM orders WHERE tenant_id = $1 GROUP BY status HAVING COUNT(*) > 1',
      );
      expect(isolatedParams).toEqual(['tenant-xyz']);
    });

    it('should handle WHERE with multiple existing params', () => {
      const { isolatedSql, isolatedParams } = service.injectTenantFilter(
        'SELECT * FROM orders WHERE status = $1 AND amount > $2',
        ['shipped', 100],
        'tenant-multi',
      );
      expect(isolatedSql).toBe(
        'SELECT * FROM orders WHERE tenant_id = $3 AND status = $1 AND amount > $2',
      );
      expect(isolatedParams).toEqual(['shipped', 100, 'tenant-multi']);
    });

    it('should be case-insensitive for SQL keywords', () => {
      const { isolatedSql } = service.injectTenantFilter(
        'select * from orders where status = $1',
        ['active'],
        'tenant-case',
      );
      expect(isolatedSql).toContain('tenant_id = $2');
    });
  });

  describe('query', () => {
    it('should execute query with tenant isolation', async () => {
      const pg = await import('pg');
      const mockPool = new pg.default.Pool() as unknown as {
        connect: ReturnType<typeof vi.fn>;
        on: ReturnType<typeof vi.fn>;
      };
      const mockClient = await mockPool.connect();
      (mockClient as unknown as { query: ReturnType<typeof vi.fn> }).query.mockResolvedValueOnce({
        rows: [{ id: '1', order_no: 'ORD-001' }],
      });

      const result = await service.query(
        'SELECT * FROM orders WHERE status = $1',
        ['active'],
        'tenant-query',
      );

      expect(result).toEqual([{ id: '1', order_no: 'ORD-001' }]);
    });

    it('should release client after query', async () => {
      const pg = await import('pg');
      const mockPool = new pg.default.Pool() as unknown as {
        connect: ReturnType<typeof vi.fn>;
        on: ReturnType<typeof vi.fn>;
      };
      const mockClient = await mockPool.connect();
      (mockClient as unknown as { query: ReturnType<typeof vi.fn> }).query.mockResolvedValueOnce({
        rows: [],
      });

      await service.query('SELECT * FROM orders', [], 'tenant-release');

      expect(
        (mockClient as unknown as { release: ReturnType<typeof vi.fn> }).release,
      ).toHaveBeenCalled();
    });
  });

  describe('transaction', () => {
    it('should execute transaction with BEGIN and COMMIT', async () => {
      const pg = await import('pg');
      const mockPool = new pg.default.Pool() as unknown as {
        connect: ReturnType<typeof vi.fn>;
        on: ReturnType<typeof vi.fn>;
      };
      const mockClient = await mockPool.connect();
      const queryFn = (mockClient as unknown as { query: ReturnType<typeof vi.fn> }).query;
      queryFn.mockResolvedValue({ rows: [] });

      const result = await service.transaction(async (tx) => {
        await tx.query('INSERT INTO orders (id) VALUES ($1)', ['order-1']);
        return 'done';
      });

      expect(result).toBe('done');
      expect(queryFn).toHaveBeenCalledWith('BEGIN');
      expect(queryFn).toHaveBeenCalledWith('COMMIT');
    });

    it('should ROLLBACK on error', async () => {
      const pg = await import('pg');
      const mockPool = new pg.default.Pool() as unknown as {
        connect: ReturnType<typeof vi.fn>;
        on: ReturnType<typeof vi.fn>;
      };
      const mockClient = await mockPool.connect();
      const queryFn = (mockClient as unknown as { query: ReturnType<typeof vi.fn> }).query;
      queryFn.mockResolvedValue({ rows: [] });

      await expect(
        service.transaction(async () => {
          throw new Error('Something failed');
        }),
      ).rejects.toThrow('Something failed');

      expect(queryFn).toHaveBeenCalledWith('BEGIN');
      expect(queryFn).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should release client after transaction completes', async () => {
      const pg = await import('pg');
      const mockPool = new pg.default.Pool() as unknown as {
        connect: ReturnType<typeof vi.fn>;
        on: ReturnType<typeof vi.fn>;
      };
      const mockClient = await mockPool.connect();
      (mockClient as unknown as { query: ReturnType<typeof vi.fn> }).query.mockResolvedValue({
        rows: [],
      });

      await service.transaction(async () => 'ok');

      expect(
        (mockClient as unknown as { release: ReturnType<typeof vi.fn> }).release,
      ).toHaveBeenCalled();
    });

    it('should release client after transaction fails', async () => {
      const pg = await import('pg');
      const mockPool = new pg.default.Pool() as unknown as {
        connect: ReturnType<typeof vi.fn>;
        on: ReturnType<typeof vi.fn>;
      };
      const mockClient = await mockPool.connect();
      (mockClient as unknown as { query: ReturnType<typeof vi.fn> }).query.mockResolvedValue({
        rows: [],
      });

      await expect(
        service.transaction(async () => {
          throw new Error('fail');
        }),
      ).rejects.toThrow();

      expect(
        (mockClient as unknown as { release: ReturnType<typeof vi.fn> }).release,
      ).toHaveBeenCalled();
    });
  });

  describe('retry logic', () => {
    it('should retry on connection errors', async () => {
      const pg = await import('pg');
      const mockPool = new pg.default.Pool() as unknown as {
        connect: ReturnType<typeof vi.fn>;
        on: ReturnType<typeof vi.fn>;
      };
      const mockClient = await mockPool.connect();
      const queryFn = (mockClient as unknown as { query: ReturnType<typeof vi.fn> }).query;

      const connError = new Error('Connection refused');
      (connError as Error & { code?: string }).code = 'ECONNREFUSED';

      queryFn
        .mockRejectedValueOnce(connError)
        .mockRejectedValueOnce(connError)
        .mockResolvedValueOnce({ rows: [{ id: '1' }] });

      // Use a service with minimal retry delay for testing
      const fastService = new PostgresDatabaseService(testConfig, {
        retryConfig: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10, backoffMultiplier: 1 },
      });

      const result = await fastService.query('SELECT * FROM orders', [], 'tenant-retry');
      expect(result).toEqual([{ id: '1' }]);
    });

    it('should throw after max retries exhausted', async () => {
      const pg = await import('pg');
      const mockPool = new pg.default.Pool() as unknown as {
        connect: ReturnType<typeof vi.fn>;
        on: ReturnType<typeof vi.fn>;
      };
      const mockClient = await mockPool.connect();
      const queryFn = (mockClient as unknown as { query: ReturnType<typeof vi.fn> }).query;

      const connError = new Error('Connection timeout');
      (connError as Error & { code?: string }).code = 'ETIMEDOUT';

      queryFn.mockRejectedValue(connError);

      const fastService = new PostgresDatabaseService(testConfig, {
        retryConfig: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5, backoffMultiplier: 1 },
      });

      await expect(
        fastService.query('SELECT * FROM orders', [], 'tenant-exhaust'),
      ).rejects.toThrow('Connection timeout');
    });

    it('should not retry non-retryable errors', async () => {
      const pg = await import('pg');
      const mockPool = new pg.default.Pool() as unknown as {
        connect: ReturnType<typeof vi.fn>;
        on: ReturnType<typeof vi.fn>;
      };
      const mockClient = await mockPool.connect();
      const queryFn = (mockClient as unknown as { query: ReturnType<typeof vi.fn> }).query;

      const syntaxError = new Error('syntax error at position 42');
      (syntaxError as Error & { code?: string }).code = '42601'; // PostgreSQL syntax error

      queryFn.mockRejectedValue(syntaxError);

      const fastService = new PostgresDatabaseService(testConfig, {
        retryConfig: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5, backoffMultiplier: 1 },
      });

      await expect(
        fastService.query('SELEC * FROM orders', [], 'tenant-syntax'),
      ).rejects.toThrow('syntax error');

      // Should only be called once (no retries)
      expect(queryFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('shutdown', () => {
    it('should end the pool', async () => {
      const pg = await import('pg');
      const mockPool = new pg.default.Pool() as unknown as {
        end: ReturnType<typeof vi.fn>;
        on: ReturnType<typeof vi.fn>;
      };

      await service.shutdown();

      expect(mockPool.end).toHaveBeenCalled();
    });
  });
});
