import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLMGatewayService } from './llm-gateway.js';
import { LLMError } from './error-handler.js';
import type { LLMGatewayConfig, LLMRequest } from './types.js';

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

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const tenantConfigA: LLMGatewayConfig = {
  tenantId: 'tenant-a',
  apiKey: 'sk-ant-api-key-tenant-a',
  model: 'claude-sonnet-4-20250514',
  maxTokens: 4096,
  rateLimit: 60,
};

const tenantConfigB: LLMGatewayConfig = {
  tenantId: 'tenant-b',
  apiKey: 'sk-ant-api-key-tenant-b',
  model: 'claude-sonnet-4-20250514',
  maxTokens: 2048,
  rateLimit: 30,
};

const baseRequest: LLMRequest = {
  tenantId: 'tenant-a',
  sessionId: 'session-123',
  messages: [{ role: 'user', content: 'Hello, Claude!' }],
  stream: false,
};

describe('LLMGatewayService', () => {
  let gateway: LLMGatewayService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Disable retries for unit tests that test individual error behavior
    gateway = new LLMGatewayService({
      retryConfig: { maxRetries: 0, baseDelay: 0, maxDelay: 0, backoffMultiplier: 2, retryableErrors: [] },
    });
    gateway.registerTenant(tenantConfigA);
    gateway.registerTenant(tenantConfigB);
  });

  afterEach(() => {
    gateway.clearCallLogs();
  });

  describe('Tenant Configuration Management', () => {
    it('should register a tenant configuration', () => {
      const config = gateway.getTenantConfig('tenant-a');
      expect(config).toEqual(tenantConfigA);
    });

    it('should support multiple tenant configurations', () => {
      const configA = gateway.getTenantConfig('tenant-a');
      const configB = gateway.getTenantConfig('tenant-b');
      expect(configA?.apiKey).toBe('sk-ant-api-key-tenant-a');
      expect(configB?.apiKey).toBe('sk-ant-api-key-tenant-b');
    });

    it('should return undefined for unregistered tenant', () => {
      const config = gateway.getTenantConfig('tenant-unknown');
      expect(config).toBeUndefined();
    });

    it('should unregister a tenant', () => {
      gateway.unregisterTenant('tenant-a');
      const config = gateway.getTenantConfig('tenant-a');
      expect(config).toBeUndefined();
    });

    it('should isolate API keys between tenants', () => {
      const configA = gateway.getTenantConfig('tenant-a');
      const configB = gateway.getTenantConfig('tenant-b');
      expect(configA?.apiKey).not.toBe(configB?.apiKey);
    });
  });

  describe('complete()', () => {
    it('should send a request to Claude API and return parsed response', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello! How can I help you?' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 8 },
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const result = await gateway.complete(baseRequest);

      expect(result.id).toBe('msg_123');
      expect(result.content).toEqual([{ type: 'text', text: 'Hello! How can I help you?' }]);
      expect(result.usage.inputTokens).toBe(10);
      expect(result.usage.outputTokens).toBe(8);
      expect(result.stopReason).toBe('end_turn');
    });

    it('should use the correct tenant API key in the request', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'msg_456',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Response' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 3 },
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      await gateway.complete(baseRequest);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-api-key': 'sk-ant-api-key-tenant-a',
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          }),
        }),
      );
    });

    it('should use tenant B API key for tenant B requests', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'msg_789',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Response' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 3 },
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const requestB: LLMRequest = { ...baseRequest, tenantId: 'tenant-b' };
      await gateway.complete(requestB);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'sk-ant-api-key-tenant-b',
          }),
        }),
      );
    });

    it('should throw when tenant is not registered', async () => {
      const unknownRequest: LLMRequest = { ...baseRequest, tenantId: 'unknown-tenant' };
      await expect(gateway.complete(unknownRequest)).rejects.toThrow('Tenant not found: unknown-tenant');
    });

    it('should throw on API error response', async () => {
      const mockResponse = {
        ok: false,
        status: 429,
        text: vi.fn().mockResolvedValue(JSON.stringify({
          error: { type: 'rate_limit_error', message: 'Rate limit exceeded' },
        })),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const error = await gateway.complete(baseRequest).catch((e) => e);
      expect(error).toBeInstanceOf(LLMError);
      expect(error.code).toBe('LLM_UNAVAILABLE');
    });

    it('should throw on API 401 error', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        text: vi.fn().mockResolvedValue(JSON.stringify({
          error: { type: 'authentication_error', message: 'Invalid API key' },
        })),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      await expect(gateway.complete(baseRequest)).rejects.toThrow('Invalid API key');
    });

    it('should include tools in the request when provided', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'msg_tool',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'query_orders', input: { status: 'pending' } }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'tool_use',
          usage: { input_tokens: 20, output_tokens: 15 },
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const requestWithTools: LLMRequest = {
        ...baseRequest,
        tools: [{ name: 'query_orders', description: 'Query orders', input_schema: { type: 'object' } }],
      };

      const result = await gateway.complete(requestWithTools);
      expect(result.stopReason).toBe('tool_use');

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].name).toBe('query_orders');
    });

    it('should include system prompt when provided', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'msg_sys',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'I am an order query agent.' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 30, output_tokens: 10 },
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const requestWithSystem: LLMRequest = {
        ...baseRequest,
        system: 'You are an order query assistant.',
      };

      await gateway.complete(requestWithSystem);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.system).toBe('You are an order query assistant.');
    });

    it('should use request maxTokens over config maxTokens', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'msg_max',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Short response' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 3 },
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const requestWithMaxTokens: LLMRequest = { ...baseRequest, maxTokens: 1024 };
      await gateway.complete(requestWithMaxTokens);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.max_tokens).toBe(1024);
    });

    it('should set stream to false in the API request body', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'msg_ns',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Response' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 3 },
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      await gateway.complete(baseRequest);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.stream).toBe(false);
    });
  });

  describe('stream()', () => {
    it('should return an async iterable that yields stream events', async () => {
      const sseData = [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_stream_1","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4-20250514","stop_reason":null,"usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ];

      const encoder = new TextEncoder();
      let chunkIndex = 0;

      const mockReadableStream = {
        getReader: () => ({
          read: vi.fn().mockImplementation(async () => {
            if (chunkIndex < sseData.length) {
              const chunk = encoder.encode(sseData[chunkIndex]);
              chunkIndex++;
              return { value: chunk, done: false };
            }
            return { value: undefined, done: true };
          }),
          cancel: vi.fn(),
        }),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: mockReadableStream,
      });

      const streamRequest: LLMRequest = { ...baseRequest, stream: true };
      const events: unknown[] = [];

      for await (const event of gateway.stream(streamRequest)) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      expect(events[0]).toEqual({ type: 'message_start', message: { id: 'msg_stream_1' } });
    });

    it('should throw when tenant is not registered for streaming', async () => {
      const unknownRequest: LLMRequest = { ...baseRequest, tenantId: 'unknown-tenant', stream: true };

      await expect(async () => {
        for await (const _event of gateway.stream(unknownRequest)) {
          // Should not reach here
        }
      }).rejects.toThrow('Tenant not found: unknown-tenant');
    });

    it('should throw on API error during streaming', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue(JSON.stringify({
          error: { type: 'server_error', message: 'Internal server error' },
        })),
      });

      const streamRequest: LLMRequest = { ...baseRequest, stream: true };

      await expect(async () => {
        for await (const _event of gateway.stream(streamRequest)) {
          // Should not reach here
        }
      }).rejects.toThrow('Internal server error');
    });

    it('should throw when response body is null', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: null,
      });

      const streamRequest: LLMRequest = { ...baseRequest, stream: true };

      await expect(async () => {
        for await (const _event of gateway.stream(streamRequest)) {
          // Should not reach here
        }
      }).rejects.toThrow('Response body is null');
    });

    it('should parse content_block_delta events with text_delta', async () => {
      const sseData =
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"World"}}\n\n';

      const encoder = new TextEncoder();
      let readCount = 0;

      const mockReadableStream = {
        getReader: () => ({
          read: vi.fn().mockImplementation(async () => {
            if (readCount === 0) {
              readCount++;
              return { value: encoder.encode(sseData), done: false };
            }
            return { value: undefined, done: true };
          }),
          cancel: vi.fn(),
        }),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: mockReadableStream,
      });

      const streamRequest: LLMRequest = { ...baseRequest, stream: true };
      const events: unknown[] = [];

      for await (const event of gateway.stream(streamRequest)) {
        events.push(event);
      }

      expect(events).toContainEqual({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'World' },
      });
    });
  });

  describe('getUsage()', () => {
    it('should return usage stats for a tenant', async () => {
      // Make some successful calls to generate logs
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'msg_usage',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Response' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      await gateway.complete(baseRequest);
      await gateway.complete(baseRequest);

      const usage = await gateway.getUsage('tenant-a', '2024-01');

      expect(usage.totalCalls).toBe(2);
      expect(usage.inputTokens).toBe(20);
      expect(usage.outputTokens).toBe(10);
      expect(usage.period).toBe('2024-01');
    });

    it('should return zero stats for tenant with no calls', async () => {
      const usage = await gateway.getUsage('tenant-a', '2024-01');

      expect(usage.totalCalls).toBe(0);
      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBe(0);
    });

    it('should isolate usage between tenants', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'msg_iso',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Response' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      // Tenant A makes 2 calls
      await gateway.complete(baseRequest);
      await gateway.complete(baseRequest);

      // Tenant B makes 1 call
      const requestB: LLMRequest = { ...baseRequest, tenantId: 'tenant-b' };
      await gateway.complete(requestB);

      const usageA = await gateway.getUsage('tenant-a', '2024-01');
      const usageB = await gateway.getUsage('tenant-b', '2024-01');

      expect(usageA.totalCalls).toBe(2);
      expect(usageB.totalCalls).toBe(1);
    });

    it('should not count failed calls in usage stats', async () => {
      // First call succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'msg_ok',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'OK' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      });

      // Second call fails with a non-retryable error (401)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: vi.fn().mockResolvedValue(JSON.stringify({
          error: { type: 'authentication_error', message: 'Invalid API key' },
        })),
      });

      await gateway.complete(baseRequest);
      await gateway.complete(baseRequest).catch(() => {});

      const usage = await gateway.getUsage('tenant-a', '2024-01');
      expect(usage.totalCalls).toBe(1); // Only the successful call
    });
  });

  describe('Call Logging', () => {
    it('should record successful call logs', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'msg_log',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Logged' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 12, output_tokens: 7 },
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      await gateway.complete(baseRequest);

      const logs = gateway.getCallLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        tenantId: 'tenant-a',
        sessionId: 'session-123',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 12,
        outputTokens: 7,
        status: 'success',
      });
      expect(logs[0].latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should record error call logs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: vi.fn().mockResolvedValue(JSON.stringify({
          error: { type: 'authentication_error', message: 'Invalid API key' },
        })),
      });

      await gateway.complete(baseRequest).catch(() => {});

      const logs = gateway.getCallLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        tenantId: 'tenant-a',
        sessionId: 'session-123',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 0,
        outputTokens: 0,
        status: 'error',
      });
      expect(logs[0].errorMessage).toContain('Invalid API key');
    });

    it('should clear call logs', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'msg_clear',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Clear' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 3 },
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      await gateway.complete(baseRequest);
      expect(gateway.getCallLogs()).toHaveLength(1);

      gateway.clearCallLogs();
      expect(gateway.getCallLogs()).toHaveLength(0);
    });
  });

  describe('Multi-tenant Isolation', () => {
    it('should use different API keys for different tenants', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'msg_mt',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Response' }],
          model: 'claude-sonnet-4-20250514',
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 3 },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      // Call as tenant A
      await gateway.complete(baseRequest);
      const callA = mockFetch.mock.calls[0];
      const headersA = callA[1].headers;

      // Call as tenant B
      const requestB: LLMRequest = { ...baseRequest, tenantId: 'tenant-b' };
      await gateway.complete(requestB);
      const callB = mockFetch.mock.calls[1];
      const headersB = callB[1].headers;

      expect(headersA['x-api-key']).toBe('sk-ant-api-key-tenant-a');
      expect(headersB['x-api-key']).toBe('sk-ant-api-key-tenant-b');
    });

    it('should use tenant-specific model configuration', async () => {
      // Register tenant C with a different model
      gateway.registerTenant({
        tenantId: 'tenant-c',
        apiKey: 'sk-ant-api-key-tenant-c',
        model: 'claude-3-haiku-20240307',
        maxTokens: 1024,
        rateLimit: 100,
      });

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'msg_model',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Response' }],
          model: 'claude-3-haiku-20240307',
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 3 },
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const requestC: LLMRequest = { ...baseRequest, tenantId: 'tenant-c' };
      await gateway.complete(requestC);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body as string);
      expect(body.model).toBe('claude-3-haiku-20240307');
      expect(body.max_tokens).toBe(1024);
    });
  });
});
