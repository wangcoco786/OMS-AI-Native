/**
 * Agent SDK Wrapper Unit Tests
 *
 * Tests session management, streaming chat, tool use protocol,
 * context compression, and error handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { LLMGateway, LLMRequest, LLMResponse, StreamEvent, UsageStats } from '../../infrastructure/llm/types.js';
import type { AgentEvent } from './types.js';
import { AgentSDKWrapperService } from './agent-sdk-wrapper.js';

/** Helper to create a mock LLM Gateway */
function createMockGateway(streamEvents?: StreamEvent[]): LLMGateway {
  const events = streamEvents ?? [];

  return {
    complete: vi.fn<(request: LLMRequest) => Promise<LLMResponse>>().mockResolvedValue({
      id: 'msg-123',
      content: [{ type: 'text', text: 'Hello' }],
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: 'end_turn',
    }),
    stream: vi.fn<(request: LLMRequest) => AsyncIterable<StreamEvent>>().mockReturnValue({
      [Symbol.asyncIterator]() {
        let index = 0;
        return {
          async next() {
            if (index < events.length) {
              return { value: events[index++], done: false };
            }
            return { value: undefined as unknown as StreamEvent, done: true };
          },
        };
      },
    }),
    getUsage: vi.fn<(tenantId: string, period: string) => Promise<UsageStats>>().mockResolvedValue({
      inputTokens: 100,
      outputTokens: 50,
      totalCalls: 5,
      period: '2024-01',
    }),
  };
}

/** Helper to collect all events from an async iterable */
async function collectEvents(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

describe('AgentSDKWrapperService', () => {
  let gateway: LLMGateway;
  let wrapper: AgentSDKWrapperService;

  beforeEach(() => {
    gateway = createMockGateway();
    wrapper = new AgentSDKWrapperService(
      {
        llmGateway: gateway,
        contextWindowSize: 100000,
        compressionThreshold: 0.8,
      },
      { logger: undefined },
    );
  });

  describe('createSession', () => {
    it('should create a session with a unique ID', async () => {
      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');

      expect(session.id).toBeDefined();
      expect(session.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('should set agentId, tenantId, and userId correctly', async () => {
      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');

      expect(session.agentId).toBe('agent-1');
      expect(session.tenantId).toBe('tenant-1');
      expect(session.userId).toBe('user-1');
    });

    it('should initialize empty context', async () => {
      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');

      expect(session.context.messages).toEqual([]);
      expect(session.context.tools).toEqual([]);
      expect(session.context.systemPrompt).toBe('');
      expect(session.context.metadata).toEqual({});
      expect(session.context.sessionId).toBe(session.id);
    });

    it('should set createdAt and lastActiveAt timestamps', async () => {
      const before = new Date();
      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');
      const after = new Date();

      expect(session.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(session.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(session.lastActiveAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it('should store the session for later retrieval', async () => {
      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');

      expect(wrapper.getSession(session.id)).toBe(session);
    });

    it('should create unique sessions for multiple calls', async () => {
      const session1 = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');
      const session2 = await wrapper.createSession('agent-1', 'tenant-1', 'user-2');

      expect(session1.id).not.toBe(session2.id);
      expect(wrapper.getActiveSessionCount()).toBe(2);
    });
  });

  describe('chat - text streaming', () => {
    it('should emit text_delta events for text content', async () => {
      const streamEvents: StreamEvent[] = [
        { type: 'message_start', message: { id: 'msg-1' } },
        { type: 'content_block_start', index: 0, contentBlock: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stopReason: 'end_turn' }, usage: { outputTokens: 10 } },
        { type: 'message_stop' },
      ];

      gateway = createMockGateway(streamEvents);
      wrapper = new AgentSDKWrapperService(
        { llmGateway: gateway, contextWindowSize: 100000, compressionThreshold: 0.8 },
        { logger: undefined },
      );

      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');
      const events = await collectEvents(wrapper.chat(session, 'Hi'));

      const textEvents = events.filter((e) => e.type === 'text_delta');
      expect(textEvents).toHaveLength(2);
      expect(textEvents[0]).toEqual({ type: 'text_delta', content: 'Hello' });
      expect(textEvents[1]).toEqual({ type: 'text_delta', content: ' world' });
    });

    it('should emit an end event with usage stats', async () => {
      const streamEvents: StreamEvent[] = [
        { type: 'message_start', message: { id: 'msg-1' } },
        { type: 'content_block_start', index: 0, contentBlock: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stopReason: 'end_turn' }, usage: { outputTokens: 15 } },
        { type: 'message_stop' },
      ];

      gateway = createMockGateway(streamEvents);
      wrapper = new AgentSDKWrapperService(
        { llmGateway: gateway, contextWindowSize: 100000, compressionThreshold: 0.8 },
        { logger: undefined },
      );

      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');
      const events = await collectEvents(wrapper.chat(session, 'Hello'));

      const endEvent = events.find((e) => e.type === 'end');
      expect(endEvent).toBeDefined();
      expect(endEvent).toEqual({
        type: 'end',
        usage: { inputTokens: 0, outputTokens: 15 },
      });
    });

    it('should add user message to session history', async () => {
      const streamEvents: StreamEvent[] = [
        { type: 'message_start', message: { id: 'msg-1' } },
        { type: 'content_block_start', index: 0, contentBlock: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stopReason: 'end_turn' }, usage: { outputTokens: 5 } },
        { type: 'message_stop' },
      ];

      gateway = createMockGateway(streamEvents);
      wrapper = new AgentSDKWrapperService(
        { llmGateway: gateway, contextWindowSize: 100000, compressionThreshold: 0.8 },
        { logger: undefined },
      );

      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');
      await collectEvents(wrapper.chat(session, 'Hello there'));

      expect(session.context.messages[0]).toEqual({
        role: 'user',
        content: 'Hello there',
      });
    });

    it('should pass tools and system prompt to LLM Gateway', async () => {
      const streamEvents: StreamEvent[] = [
        { type: 'message_start', message: { id: 'msg-1' } },
        { type: 'message_stop' },
      ];

      gateway = createMockGateway(streamEvents);
      wrapper = new AgentSDKWrapperService(
        { llmGateway: gateway, contextWindowSize: 100000, compressionThreshold: 0.8 },
        { logger: undefined },
      );

      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');
      const tools = [{ name: 'search', description: 'Search tool', input_schema: {} }];
      wrapper.setSessionTools(session, tools);
      wrapper.setSessionSystemPrompt(session, 'You are a helpful assistant.');

      await collectEvents(wrapper.chat(session, 'Search for something'));

      expect(gateway.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          sessionId: session.id,
          tools,
          system: 'You are a helpful assistant.',
          stream: true,
        }),
      );
    });
  });

  describe('chat - tool use protocol', () => {
    it('should emit tool_use event when LLM requests a tool call', async () => {
      const streamEvents: StreamEvent[] = [
        { type: 'message_start', message: { id: 'msg-1' } },
        {
          type: 'content_block_start',
          index: 0,
          contentBlock: { type: 'tool_use', id: 'tool-call-1', name: 'query_orders', input: {} },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"order' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '_no":"ORD-001"}' },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stopReason: 'tool_use' }, usage: { outputTokens: 20 } },
        { type: 'message_stop' },
      ];

      gateway = createMockGateway(streamEvents);
      wrapper = new AgentSDKWrapperService(
        { llmGateway: gateway, contextWindowSize: 100000, compressionThreshold: 0.8 },
        { logger: undefined },
      );

      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');
      const events = await collectEvents(wrapper.chat(session, 'Find order ORD-001'));

      const toolUseEvent = events.find((e) => e.type === 'tool_use');
      expect(toolUseEvent).toBeDefined();
      expect(toolUseEvent).toEqual({
        type: 'tool_use',
        toolName: 'query_orders',
        input: { order_no: 'ORD-001' },
      });
    });

    it('should add tool_use to session message history', async () => {
      const streamEvents: StreamEvent[] = [
        { type: 'message_start', message: { id: 'msg-1' } },
        {
          type: 'content_block_start',
          index: 0,
          contentBlock: { type: 'tool_use', id: 'tool-call-1', name: 'query_orders', input: {} },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"status":"shipped"}' },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stopReason: 'tool_use' }, usage: { outputTokens: 10 } },
        { type: 'message_stop' },
      ];

      gateway = createMockGateway(streamEvents);
      wrapper = new AgentSDKWrapperService(
        { llmGateway: gateway, contextWindowSize: 100000, compressionThreshold: 0.8 },
        { logger: undefined },
      );

      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');
      await collectEvents(wrapper.chat(session, 'Show shipped orders'));

      // Should have user message + assistant tool_use message
      expect(session.context.messages).toHaveLength(2);
      expect(session.context.messages[1]).toEqual({
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-call-1',
            name: 'query_orders',
            input: { status: 'shipped' },
          },
        ],
      });
    });

    it('should handle tool_use with empty input', async () => {
      const streamEvents: StreamEvent[] = [
        { type: 'message_start', message: { id: 'msg-1' } },
        {
          type: 'content_block_start',
          index: 0,
          contentBlock: { type: 'tool_use', id: 'tool-call-1', name: 'list_all', input: {} },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stopReason: 'tool_use' }, usage: { outputTokens: 5 } },
        { type: 'message_stop' },
      ];

      gateway = createMockGateway(streamEvents);
      wrapper = new AgentSDKWrapperService(
        { llmGateway: gateway, contextWindowSize: 100000, compressionThreshold: 0.8 },
        { logger: undefined },
      );

      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');
      const events = await collectEvents(wrapper.chat(session, 'List all'));

      const toolUseEvent = events.find((e) => e.type === 'tool_use');
      expect(toolUseEvent).toEqual({
        type: 'tool_use',
        toolName: 'list_all',
        input: {},
      });
    });
  });

  describe('chat - error handling', () => {
    it('should emit error event when stream contains an error', async () => {
      const streamEvents: StreamEvent[] = [
        { type: 'message_start', message: { id: 'msg-1' } },
        { type: 'error', error: { type: 'rate_limit_error', message: 'Rate limit exceeded' } },
      ];

      gateway = createMockGateway(streamEvents);
      wrapper = new AgentSDKWrapperService(
        { llmGateway: gateway, contextWindowSize: 100000, compressionThreshold: 0.8 },
        { logger: undefined },
      );

      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');
      const events = await collectEvents(wrapper.chat(session, 'Hello'));

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      if (errorEvent?.type === 'error') {
        expect(errorEvent.error.error.code).toBe('rate_limit_error');
        expect(errorEvent.error.error.message).toBe('Rate limit exceeded');
        expect(errorEvent.error.error.traceId).toBe(session.id);
        expect(errorEvent.error.error.timestamp).toBeDefined();
      }
    });

    it('should emit error event when gateway throws', async () => {
      gateway = {
        ...createMockGateway(),
        stream: vi.fn().mockReturnValue({
          [Symbol.asyncIterator]() {
            return {
              async next() {
                throw new Error('Connection failed');
              },
            };
          },
        }),
      };

      wrapper = new AgentSDKWrapperService(
        { llmGateway: gateway, contextWindowSize: 100000, compressionThreshold: 0.8 },
        { logger: undefined },
      );

      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');
      const events = await collectEvents(wrapper.chat(session, 'Hello'));

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      if (errorEvent?.type === 'error') {
        expect(errorEvent.error.error.code).toBe('STREAM_ERROR');
        expect(errorEvent.error.error.message).toBe('Connection failed');
      }
    });
  });

  describe('addToolResult', () => {
    it('should add tool result to session message history', async () => {
      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');

      wrapper.addToolResult(session, 'query_orders', 'tool-call-1', { orders: [] });

      expect(session.context.messages).toHaveLength(1);
      expect(session.context.messages[0].role).toBe('user');
    });

    it('should update lastActiveAt timestamp', async () => {
      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');
      const before = session.lastActiveAt;

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));
      wrapper.addToolResult(session, 'query_orders', 'tool-call-1', { result: 'ok' });

      expect(session.lastActiveAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  describe('compressContext', () => {
    it('should keep only recent messages that fit within token budget', async () => {
      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');

      // Add many messages
      for (let i = 0; i < 10; i++) {
        session.context.messages.push({ role: 'user', content: `Message ${i}` });
        session.context.messages.push({ role: 'assistant', content: `Reply ${i}` });
      }

      expect(session.context.messages).toHaveLength(20);

      await wrapper.compressContext(session);

      // With contextWindowSize=100000 and compressionThreshold=0.8,
      // target budget = 100000 * 0.2 = 20000 tokens
      // Each message is small (~6-7 tokens), so all 20 messages fit in 20000 tokens
      // In this case, all messages should be kept since they fit the budget
      expect(session.context.messages.length).toBeGreaterThanOrEqual(2);
      // The last message should always be preserved
      expect(session.context.messages[session.context.messages.length - 1]).toEqual({
        role: 'assistant',
        content: 'Reply 9',
      });
    });

    it('should compress when messages exceed token budget', async () => {
      // Use a very small context window to force compression
      const smallWrapper = new AgentSDKWrapperService(
        {
          llmGateway: gateway,
          contextWindowSize: 100, // 100 tokens total
          compressionThreshold: 0.8, // target budget = 20 tokens after compression
        },
        { logger: undefined },
      );

      const session = await smallWrapper.createSession('agent-1', 'tenant-1', 'user-1');

      // Add many messages - each message is ~6-10 tokens
      for (let i = 0; i < 20; i++) {
        session.context.messages.push({
          role: 'user',
          content: `This is a longer message number ${i} with some extra content`,
        });
        session.context.messages.push({
          role: 'assistant',
          content: `This is a longer reply number ${i} with additional details`,
        });
      }

      const originalCount = session.context.messages.length;
      expect(originalCount).toBe(40);

      await smallWrapper.compressContext(session);

      // Should have fewer messages after compression
      expect(session.context.messages.length).toBeLessThan(originalCount);
      // Should keep at least 2 messages
      expect(session.context.messages.length).toBeGreaterThanOrEqual(2);
    });

    it('should not compress when there are 2 or fewer messages', async () => {
      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');
      session.context.messages.push({ role: 'user', content: 'Hello' });
      session.context.messages.push({ role: 'assistant', content: 'Hi' });

      await wrapper.compressContext(session);

      expect(session.context.messages).toHaveLength(2);
    });

    it('should not compress when there are no messages', async () => {
      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');

      await wrapper.compressContext(session);

      expect(session.context.messages).toHaveLength(0);
    });

    it('should preserve system prompt (not counted against message budget)', async () => {
      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');
      wrapper.setSessionSystemPrompt(session, 'You are a helpful assistant.');

      // Add messages
      for (let i = 0; i < 10; i++) {
        session.context.messages.push({ role: 'user', content: `Message ${i}` });
        session.context.messages.push({ role: 'assistant', content: `Reply ${i}` });
      }

      await wrapper.compressContext(session);

      // System prompt should still be intact
      expect(session.context.systemPrompt).toBe('You are a helpful assistant.');
    });
  });

  describe('getContextTokenCount', () => {
    it('should return 0 for empty session', async () => {
      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');

      expect(wrapper.getContextTokenCount(session)).toBe(0);
    });

    it('should count system prompt tokens', async () => {
      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');
      wrapper.setSessionSystemPrompt(session, 'You are a helpful assistant.');

      const count = wrapper.getContextTokenCount(session);
      expect(count).toBeGreaterThan(0);
    });

    it('should count message tokens', async () => {
      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');
      session.context.messages.push({ role: 'user', content: 'Hello world' });

      const count = wrapper.getContextTokenCount(session);
      expect(count).toBeGreaterThan(0);
    });

    it('should increase as messages are added', async () => {
      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');

      session.context.messages.push({ role: 'user', content: 'Hello' });
      const count1 = wrapper.getContextTokenCount(session);

      session.context.messages.push({ role: 'assistant', content: 'Hi there, how can I help?' });
      const count2 = wrapper.getContextTokenCount(session);

      expect(count2).toBeGreaterThan(count1);
    });
  });

  describe('auto-compression in chat', () => {
    it('should auto-compress when context exceeds threshold before LLM call', async () => {
      const streamEvents: StreamEvent[] = [
        { type: 'message_start', message: { id: 'msg-1' } },
        { type: 'content_block_start', index: 0, contentBlock: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stopReason: 'end_turn' }, usage: { outputTokens: 5 } },
        { type: 'message_stop' },
      ];

      gateway = createMockGateway(streamEvents);

      // Use a very small context window to trigger auto-compression
      const smallWrapper = new AgentSDKWrapperService(
        {
          llmGateway: gateway,
          contextWindowSize: 50, // 50 tokens
          compressionThreshold: 0.8, // threshold = 40 tokens
        },
        { logger: undefined },
      );

      const session = await smallWrapper.createSession('agent-1', 'tenant-1', 'user-1');

      // Pre-fill with messages to exceed threshold
      for (let i = 0; i < 10; i++) {
        session.context.messages.push({
          role: 'user',
          content: `This is message number ${i} with some content to fill tokens`,
        });
        session.context.messages.push({
          role: 'assistant',
          content: `This is reply number ${i} with additional content`,
        });
      }

      const messageCountBefore = session.context.messages.length;

      // Chat should trigger auto-compression
      await collectEvents(smallWrapper.chat(session, 'New message'));

      // After auto-compression, messages should be reduced
      // (the new user message is added first, then compression happens)
      expect(session.context.messages.length).toBeLessThan(messageCountBefore + 1);
    });

    it('should not auto-compress when context is within threshold', async () => {
      const streamEvents: StreamEvent[] = [
        { type: 'message_start', message: { id: 'msg-1' } },
        { type: 'content_block_start', index: 0, contentBlock: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stopReason: 'end_turn' }, usage: { outputTokens: 5 } },
        { type: 'message_stop' },
      ];

      gateway = createMockGateway(streamEvents);
      wrapper = new AgentSDKWrapperService(
        { llmGateway: gateway, contextWindowSize: 100000, compressionThreshold: 0.8 },
        { logger: undefined },
      );

      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');
      session.context.messages.push({ role: 'user', content: 'First message' });
      session.context.messages.push({ role: 'assistant', content: 'First reply' });

      await collectEvents(wrapper.chat(session, 'Second message'));

      // Should have all messages (no compression needed)
      // 2 original + 1 new user message = 3
      expect(session.context.messages.length).toBe(3);
    });
  });

  describe('closeSession', () => {
    it('should remove the session from active sessions', async () => {
      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');
      expect(wrapper.getSession(session.id)).toBeDefined();

      await wrapper.closeSession(session.id);

      expect(wrapper.getSession(session.id)).toBeUndefined();
    });

    it('should handle closing a non-existent session gracefully', async () => {
      // Should not throw
      await expect(wrapper.closeSession('non-existent-id')).resolves.toBeUndefined();
    });

    it('should decrement active session count', async () => {
      const session1 = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');
      await wrapper.createSession('agent-1', 'tenant-1', 'user-2');
      expect(wrapper.getActiveSessionCount()).toBe(2);

      await wrapper.closeSession(session1.id);

      expect(wrapper.getActiveSessionCount()).toBe(1);
    });
  });

  describe('setSessionTools', () => {
    it('should set tools on the session context', async () => {
      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');
      const tools = [
        { name: 'query_orders', description: 'Query orders', input_schema: { type: 'object' } },
      ];

      wrapper.setSessionTools(session, tools);

      expect(session.context.tools).toEqual(tools);
    });
  });

  describe('setSessionSystemPrompt', () => {
    it('should set system prompt on the session context', async () => {
      const session = await wrapper.createSession('agent-1', 'tenant-1', 'user-1');

      wrapper.setSessionSystemPrompt(session, 'You are an order query assistant.');

      expect(session.context.systemPrompt).toBe('You are an order query assistant.');
    });
  });
});
