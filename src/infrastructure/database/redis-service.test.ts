import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RedisCacheService, DEFAULT_TTL, KEY_PREFIX } from './redis-service.js';
import type { RedisConfig } from './types.js';

// Mock ioredis
const mockPipeline = {
  incr: vi.fn().mockReturnThis(),
  ttl: vi.fn().mockReturnThis(),
  exec: vi.fn(),
};

const mockRedisClient = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  expire: vi.fn(),
  incr: vi.fn(),
  pipeline: vi.fn(() => mockPipeline),
  quit: vi.fn().mockResolvedValue('OK'),
  on: vi.fn(),
};

vi.mock('ioredis', () => {
  return {
    default: vi.fn(() => mockRedisClient),
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

const testConfig: RedisConfig = {
  host: 'localhost',
  port: 6379,
  password: 'test_pass',
  maxConnections: 10,
  db: 0,
};

describe('RedisCacheService', () => {
  let service: RedisCacheService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RedisCacheService(testConfig);
  });

  afterEach(async () => {
    await service.shutdown();
  });

  describe('constructor', () => {
    it('should create a service with default config', () => {
      const svc = new RedisCacheService(testConfig);
      expect(svc).toBeDefined();
    });

    it('should accept custom retry config', () => {
      const svc = new RedisCacheService(testConfig, {
        retryConfig: { maxRetries: 10, baseDelayMs: 500 },
      });
      expect(svc).toBeDefined();
    });
  });

  describe('cacheGet', () => {
    it('should return parsed JSON value when key exists', async () => {
      const data = { name: 'test', value: 42 };
      mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(data));

      const result = await service.cacheGet<typeof data>('test-key');
      expect(result).toEqual(data);
      expect(mockRedisClient.get).toHaveBeenCalledWith('test-key');
    });

    it('should return null when key does not exist', async () => {
      mockRedisClient.get.mockResolvedValueOnce(null);

      const result = await service.cacheGet('missing-key');
      expect(result).toBeNull();
    });

    it('should throw on Redis error', async () => {
      mockRedisClient.get.mockRejectedValueOnce(new Error('Connection lost'));

      await expect(service.cacheGet('error-key')).rejects.toThrow('Connection lost');
    });
  });

  describe('cacheSet', () => {
    it('should set value with TTL when provided', async () => {
      mockRedisClient.set.mockResolvedValueOnce('OK');

      await service.cacheSet('my-key', { data: 'hello' }, 300);
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'my-key',
        JSON.stringify({ data: 'hello' }),
        'EX',
        300,
      );
    });

    it('should set value without TTL when not provided', async () => {
      mockRedisClient.set.mockResolvedValueOnce('OK');

      await service.cacheSet('my-key', { data: 'hello' });
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'my-key',
        JSON.stringify({ data: 'hello' }),
      );
    });

    it('should set value without TTL when ttl is 0', async () => {
      mockRedisClient.set.mockResolvedValueOnce('OK');

      await service.cacheSet('my-key', 'value', 0);
      expect(mockRedisClient.set).toHaveBeenCalledWith('my-key', JSON.stringify('value'));
    });

    it('should throw on Redis error', async () => {
      mockRedisClient.set.mockRejectedValueOnce(new Error('Write failed'));

      await expect(service.cacheSet('error-key', 'val')).rejects.toThrow('Write failed');
    });
  });

  describe('cacheDel', () => {
    it('should delete the key', async () => {
      mockRedisClient.del.mockResolvedValueOnce(1);

      await service.cacheDel('delete-me');
      expect(mockRedisClient.del).toHaveBeenCalledWith('delete-me');
    });

    it('should not throw when key does not exist', async () => {
      mockRedisClient.del.mockResolvedValueOnce(0);

      await expect(service.cacheDel('nonexistent')).resolves.toBeUndefined();
    });

    it('should throw on Redis error', async () => {
      mockRedisClient.del.mockRejectedValueOnce(new Error('Delete failed'));

      await expect(service.cacheDel('error-key')).rejects.toThrow('Delete failed');
    });
  });

  describe('Session Context Operations', () => {
    const sessionId = 'session-abc-123';
    const expectedKey = `${KEY_PREFIX.SESSION_CONTEXT}:${sessionId}:context`;

    const mockContext = {
      sessionId,
      messages: [
        { role: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
        { role: 'assistant', content: 'Hi there!', timestamp: '2024-01-01T00:00:01Z' },
      ],
      metadata: { agentId: 'agent-1', tenantId: 'tenant-1' },
    };

    describe('buildSessionContextKey', () => {
      it('should build correct key format', () => {
        const key = service.buildSessionContextKey(sessionId);
        expect(key).toBe(expectedKey);
      });
    });

    describe('setSessionContext', () => {
      it('should store context with 30-minute TTL', async () => {
        mockRedisClient.set.mockResolvedValueOnce('OK');

        await service.setSessionContext(sessionId, mockContext);
        expect(mockRedisClient.set).toHaveBeenCalledWith(
          expectedKey,
          JSON.stringify(mockContext),
          'EX',
          DEFAULT_TTL.SESSION_CONTEXT,
        );
      });
    });

    describe('getSessionContext', () => {
      it('should retrieve stored context', async () => {
        mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(mockContext));

        const result = await service.getSessionContext(sessionId);
        expect(result).toEqual(mockContext);
        expect(mockRedisClient.get).toHaveBeenCalledWith(expectedKey);
      });

      it('should return null when session expired', async () => {
        mockRedisClient.get.mockResolvedValueOnce(null);

        const result = await service.getSessionContext(sessionId);
        expect(result).toBeNull();
      });
    });

    describe('deleteSessionContext', () => {
      it('should delete session context', async () => {
        mockRedisClient.del.mockResolvedValueOnce(1);

        await service.deleteSessionContext(sessionId);
        expect(mockRedisClient.del).toHaveBeenCalledWith(expectedKey);
      });
    });
  });

  describe('Tenant Rate Limit Counter Operations', () => {
    const tenantId = 'tenant-xyz-789';
    const expectedKey = `${KEY_PREFIX.TENANT_LLM_CALLS}:${tenantId}:llm_calls`;

    describe('buildTenantLLMCallsKey', () => {
      it('should build correct key format', () => {
        const key = service.buildTenantLLMCallsKey(tenantId);
        expect(key).toBe(expectedKey);
      });
    });

    describe('incrementLLMCallCount', () => {
      it('should increment counter and set TTL on first call', async () => {
        // First call: ttl returns -1 (no expiry set)
        mockPipeline.exec.mockResolvedValueOnce([
          [null, 1], // incr result
          [null, -1], // ttl result (no expiry)
        ]);
        mockRedisClient.expire.mockResolvedValueOnce(1);

        const count = await service.incrementLLMCallCount(tenantId);
        expect(count).toBe(1);
        expect(mockRedisClient.expire).toHaveBeenCalledWith(expectedKey, DEFAULT_TTL.RATE_LIMIT);
      });

      it('should increment counter without resetting TTL on subsequent calls', async () => {
        // Subsequent call: ttl returns positive value
        mockPipeline.exec.mockResolvedValueOnce([
          [null, 5], // incr result (5th call)
          [null, 45], // ttl result (45 seconds remaining)
        ]);

        const count = await service.incrementLLMCallCount(tenantId);
        expect(count).toBe(5);
        expect(mockRedisClient.expire).not.toHaveBeenCalled();
      });

      it('should throw when pipeline returns null', async () => {
        mockPipeline.exec.mockResolvedValueOnce(null);

        await expect(service.incrementLLMCallCount(tenantId)).rejects.toThrow(
          'Pipeline execution returned null',
        );
      });
    });

    describe('getLLMCallCount', () => {
      it('should return current count', async () => {
        mockRedisClient.get.mockResolvedValueOnce('15');

        const count = await service.getLLMCallCount(tenantId);
        expect(count).toBe(15);
        expect(mockRedisClient.get).toHaveBeenCalledWith(expectedKey);
      });

      it('should return 0 when counter does not exist', async () => {
        mockRedisClient.get.mockResolvedValueOnce(null);

        const count = await service.getLLMCallCount(tenantId);
        expect(count).toBe(0);
      });
    });

    describe('resetLLMCallCount', () => {
      it('should delete the counter key', async () => {
        mockRedisClient.del.mockResolvedValueOnce(1);

        await service.resetLLMCallCount(tenantId);
        expect(mockRedisClient.del).toHaveBeenCalledWith(expectedKey);
      });
    });
  });

  describe('Connection & Lifecycle', () => {
    describe('getConnectionStatus', () => {
      it('should return connection status', () => {
        // Initially false since we mock the client
        const status = service.getConnectionStatus();
        expect(typeof status).toBe('boolean');
      });
    });

    describe('getClient', () => {
      it('should return the underlying Redis client', () => {
        const client = service.getClient();
        expect(client).toBeDefined();
      });
    });

    describe('shutdown', () => {
      it('should call quit on the Redis client', async () => {
        await service.shutdown();
        expect(mockRedisClient.quit).toHaveBeenCalled();
      });
    });
  });

  describe('DEFAULT_TTL constants', () => {
    it('should have correct session context TTL (30 minutes)', () => {
      expect(DEFAULT_TTL.SESSION_CONTEXT).toBe(1800);
    });

    it('should have correct rate limit TTL (1 minute)', () => {
      expect(DEFAULT_TTL.RATE_LIMIT).toBe(60);
    });

    it('should have correct agent status TTL (5 minutes)', () => {
      expect(DEFAULT_TTL.AGENT_STATUS).toBe(300);
    });

    it('should have correct tool registry TTL (5 minutes)', () => {
      expect(DEFAULT_TTL.TOOL_REGISTRY).toBe(300);
    });
  });
});
