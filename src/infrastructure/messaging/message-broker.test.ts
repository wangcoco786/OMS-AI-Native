/**
 * Unit tests for MessageBrokerService
 *
 * Tests cover:
 * - Initialization (exchange and queue setup)
 * - Publishing messages with routing keys and persistence
 * - Subscribing to topics with consumer handlers
 * - Point-to-point send to specific queues
 * - Error handling for unconnected state
 * - Queue stats retrieval
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MessageBrokerConfig } from './types.js';

// --- Mock setup using vi.hoisted ---

const mocks = vi.hoisted(() => {
  const mockAck = vi.fn();
  const mockNack = vi.fn();

  const mockChannel = {
    assertExchange: vi.fn().mockResolvedValue({}),
    assertQueue: vi.fn().mockResolvedValue({ queue: 'test-queue' }),
    bindQueue: vi.fn().mockResolvedValue({}),
    publish: vi.fn().mockReturnValue(true),
    sendToQueue: vi.fn().mockReturnValue(true),
    consume: vi.fn().mockResolvedValue({ consumerTag: 'ctag-1' }),
    cancel: vi.fn().mockResolvedValue({}),
    checkQueue: vi.fn().mockResolvedValue({ messageCount: 5, consumerCount: 2 }),
    prefetch: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue({}),
    ack: mockAck,
    nack: mockNack,
    on: vi.fn(),
  };

  const mockConnection = {
    createChannel: vi.fn().mockResolvedValue(mockChannel),
    close: vi.fn().mockResolvedValue({}),
    on: vi.fn(),
  };

  return { mockAck, mockNack, mockChannel, mockConnection };
});

vi.mock('amqplib', () => ({
  default: {
    connect: vi.fn().mockResolvedValue(mocks.mockConnection),
  },
}));

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

// Import after mocks are set up
import { MessageBrokerService } from './message-broker.js';

// --- Test Configuration ---

const testConfig: MessageBrokerConfig = {
  url: 'amqp://guest:guest@localhost:5672',
  exchanges: [
    { name: 'agent.events', type: 'topic', durable: true },
    { name: 'system.events', type: 'fanout', durable: true },
  ],
  queues: [
    { name: 'agent.status.changes', exchange: 'agent.events', routingKey: 'agent.status.*' },
    { name: 'tool.call.logs', exchange: 'agent.events', routingKey: 'tool.call.*' },
    { name: 'audit.logs', exchange: 'system.events', routingKey: '' },
  ],
  deadLetterExchange: 'dlx',
  prefetchCount: 10,
};

describe('MessageBrokerService', () => {
  let broker: MessageBrokerService;

  beforeEach(() => {
    vi.clearAllMocks();
    broker = new MessageBrokerService(testConfig);
  });

  describe('initialize', () => {
    it('should connect and setup exchanges and queues', async () => {
      await broker.initialize();

      // Should assert all configured exchanges + DLX
      expect(mocks.mockChannel.assertExchange).toHaveBeenCalledWith('agent.events', 'topic', {
        durable: true,
        autoDelete: false,
      });
      expect(mocks.mockChannel.assertExchange).toHaveBeenCalledWith('system.events', 'fanout', {
        durable: true,
        autoDelete: false,
      });
      expect(mocks.mockChannel.assertExchange).toHaveBeenCalledWith('dlx', 'topic', {
        durable: true,
      });

      // Should assert all configured queues + dead-letter queue
      expect(mocks.mockChannel.assertQueue).toHaveBeenCalledTimes(4);
      expect(mocks.mockChannel.assertQueue).toHaveBeenCalledWith('dead-letter', {
        durable: true,
      });
      expect(mocks.mockChannel.assertQueue).toHaveBeenCalledWith('agent.status.changes', {
        durable: true,
        deadLetterExchange: 'dlx',
      });
      expect(mocks.mockChannel.assertQueue).toHaveBeenCalledWith('tool.call.logs', {
        durable: true,
        deadLetterExchange: 'dlx',
      });
      expect(mocks.mockChannel.assertQueue).toHaveBeenCalledWith('audit.logs', {
        durable: true,
        deadLetterExchange: 'dlx',
      });

      // Should bind queues to exchanges (including dead-letter queue)
      expect(mocks.mockChannel.bindQueue).toHaveBeenCalledWith(
        'dead-letter',
        'dlx',
        '#',
      );
      expect(mocks.mockChannel.bindQueue).toHaveBeenCalledWith(
        'agent.status.changes',
        'agent.events',
        'agent.status.*',
      );
      expect(mocks.mockChannel.bindQueue).toHaveBeenCalledWith(
        'tool.call.logs',
        'agent.events',
        'tool.call.*',
      );
      expect(mocks.mockChannel.bindQueue).toHaveBeenCalledWith(
        'audit.logs',
        'system.events',
        '',
      );
    });

    it('should set prefetch count on channel', async () => {
      await broker.initialize();

      expect(mocks.mockChannel.prefetch).toHaveBeenCalledWith(10);
    });
  });

  describe('publish', () => {
    beforeEach(async () => {
      await broker.initialize();
    });

    it('should publish a message to the default topic exchange', async () => {
      const message = { agentId: 'agent-1', status: 'running' };

      await broker.publish('agent.status.changed', message);

      expect(mocks.mockChannel.publish).toHaveBeenCalledWith(
        'agent.events', // default topic exchange
        'agent.status.changed', // routing key from topic
        expect.any(Buffer),
        expect.objectContaining({
          persistent: true,
          contentType: 'application/json',
          contentEncoding: 'utf-8',
        }),
      );
    });

    it('should publish with custom options', async () => {
      const message = { event: 'test' };
      const options = {
        exchange: 'system.events',
        routingKey: 'system.alert',
        persistent: true,
        headers: { 'x-priority': 'high' },
      };

      await broker.publish('system.alert', message, options);

      expect(mocks.mockChannel.publish).toHaveBeenCalledWith(
        'system.events',
        'system.alert',
        expect.any(Buffer),
        expect.objectContaining({
          persistent: true,
          headers: { 'x-priority': 'high' },
        }),
      );
    });

    it('should serialize message content as JSON', async () => {
      const message = { key: 'value', nested: { data: [1, 2, 3] } };

      await broker.publish('test.topic', message);

      const publishCall = mocks.mockChannel.publish.mock.calls[0];
      const buffer = publishCall[2] as Buffer;
      expect(JSON.parse(buffer.toString())).toEqual(message);
    });

    it('should throw if not connected', async () => {
      const disconnectedBroker = new MessageBrokerService(testConfig);

      await expect(
        disconnectedBroker.publish('test', { data: 'hello' }),
      ).rejects.toThrow('Message broker is not connected');
    });
  });

  describe('subscribe', () => {
    beforeEach(async () => {
      await broker.initialize();
    });

    it('should subscribe to an existing configured queue by routing key', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);

      const subscription = await broker.subscribe('agent.status.*', handler);

      expect(mocks.mockChannel.consume).toHaveBeenCalledWith(
        'agent.status.changes',
        expect.any(Function),
        { noAck: false },
      );
      expect(subscription.consumerTag).toBe('ctag-1');
      expect(subscription.queue).toBe('agent.status.changes');
    });

    it('should subscribe to an existing configured queue by name', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);

      const subscription = await broker.subscribe('audit.logs', handler);

      expect(mocks.mockChannel.consume).toHaveBeenCalledWith(
        'audit.logs',
        expect.any(Function),
        { noAck: false },
      );
      expect(subscription.queue).toBe('audit.logs');
    });

    it('should create a temporary queue for unknown topics', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);

      await broker.subscribe('custom.topic.#', handler);

      // Should create a temporary exclusive queue
      expect(mocks.mockChannel.assertQueue).toHaveBeenCalledWith('', {
        exclusive: true,
        autoDelete: true,
      });
      // Should bind it to the default topic exchange
      expect(mocks.mockChannel.bindQueue).toHaveBeenCalledWith(
        'test-queue',
        'agent.events',
        'custom.topic.#',
      );
    });

    it('should cancel subscription when cancel is called', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);

      const subscription = await broker.subscribe('agent.status.*', handler);
      await subscription.cancel();

      expect(mocks.mockChannel.cancel).toHaveBeenCalledWith('ctag-1');
    });

    it('should invoke handler with parsed BrokerMessage on message receipt', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);

      // Capture the consume callback
      let consumeCallback: ((msg: unknown) => void) | undefined;
      mocks.mockChannel.consume.mockImplementation(
        async (_queue: string, cb: (msg: unknown) => void) => {
          consumeCallback = cb;
          return { consumerTag: 'ctag-2' };
        },
      );

      await broker.subscribe('agent.status.*', handler);

      // Simulate receiving a message
      const fakeMsg = {
        content: Buffer.from(JSON.stringify({ agentId: 'a1', status: 'running' })),
        fields: { routingKey: 'agent.status.changed', exchange: 'agent.events' },
        properties: {
          messageId: 'msg-123',
          timestamp: Math.floor(Date.now() / 1000),
          headers: { 'x-source': 'test' },
        },
      };

      consumeCallback!(fakeMsg);

      // Wait for async handler
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-123',
          content: { agentId: 'a1', status: 'running' },
          routingKey: 'agent.status.changed',
          exchange: 'agent.events',
        }),
      );
    });

    it('should republish message for retry when handler throws (first attempt)', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Processing failed'));

      let consumeCallback: ((msg: unknown) => void) | undefined;
      mocks.mockChannel.consume.mockImplementation(
        async (_queue: string, cb: (msg: unknown) => void) => {
          consumeCallback = cb;
          return { consumerTag: 'ctag-3' };
        },
      );

      await broker.subscribe('agent.status.*', handler);

      const fakeMsg = {
        content: Buffer.from(JSON.stringify({ data: 'test' })),
        fields: { routingKey: 'agent.status.changed', exchange: 'agent.events' },
        properties: { messageId: 'msg-fail', timestamp: null, headers: {} },
      };

      consumeCallback!(fakeMsg);

      // Wait for async handler rejection and retry logic
      await new Promise((resolve) => setTimeout(resolve, 10));

      // With retry handler, first failure republishes the message
      expect(mocks.mockChannel.publish).toHaveBeenCalled();
      // Original message is acked after successful republish
      expect(mocks.mockAck).toHaveBeenCalledWith(fakeMsg);
    });
  });

  describe('send', () => {
    beforeEach(async () => {
      await broker.initialize();
    });

    it('should send a message directly to a queue', async () => {
      const message = { taskId: 'task-1', payload: 'data' };

      await broker.send('agent.status.changes', message);

      expect(mocks.mockChannel.sendToQueue).toHaveBeenCalledWith(
        'agent.status.changes',
        expect.any(Buffer),
        expect.objectContaining({
          persistent: true,
          contentType: 'application/json',
          contentEncoding: 'utf-8',
        }),
      );
    });

    it('should serialize message content as JSON', async () => {
      const message = { complex: { nested: true }, array: [1, 2] };

      await broker.send('test-queue', message);

      const sendCall = mocks.mockChannel.sendToQueue.mock.calls[0];
      const buffer = sendCall[1] as Buffer;
      expect(JSON.parse(buffer.toString())).toEqual(message);
    });

    it('should throw if not connected', async () => {
      const disconnectedBroker = new MessageBrokerService(testConfig);

      await expect(
        disconnectedBroker.send('test-queue', { data: 'hello' }),
      ).rejects.toThrow('Message broker is not connected');
    });
  });

  describe('getQueueStats', () => {
    beforeEach(async () => {
      await broker.initialize();
    });

    it('should return queue statistics', async () => {
      const stats = await broker.getQueueStats('agent.status.changes');

      expect(mocks.mockChannel.checkQueue).toHaveBeenCalledWith('agent.status.changes');
      expect(stats).toEqual({
        name: 'agent.status.changes',
        messageCount: 5,
        consumerCount: 2,
      });
    });
  });

  describe('shutdown', () => {
    it('should close channel and connection', async () => {
      await broker.initialize();
      await broker.shutdown();

      expect(mocks.mockChannel.close).toHaveBeenCalled();
      expect(mocks.mockConnection.close).toHaveBeenCalled();
    });

    it('should handle shutdown when not connected', async () => {
      // Should not throw
      await expect(broker.shutdown()).resolves.toBeUndefined();
    });
  });

  describe('message persistence', () => {
    beforeEach(async () => {
      await broker.initialize();
    });

    it('should default to persistent messages on publish', async () => {
      await broker.publish('test.topic', { data: 'important' });

      expect(mocks.mockChannel.publish).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(Buffer),
        expect.objectContaining({ persistent: true }),
      );
    });

    it('should respect non-persistent option', async () => {
      await broker.publish('test.topic', { data: 'transient' }, {
        exchange: 'agent.events',
        routingKey: 'test.topic',
        persistent: false,
      });

      expect(mocks.mockChannel.publish).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(Buffer),
        expect.objectContaining({ persistent: false }),
      );
    });

    it('should always use persistent for point-to-point send', async () => {
      await broker.send('some-queue', { data: 'always-persist' });

      expect(mocks.mockChannel.sendToQueue).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Buffer),
        expect.objectContaining({ persistent: true }),
      );
    });
  });

  describe('exchange and queue configuration', () => {
    it('should configure queues with dead letter exchange', async () => {
      await broker.initialize();

      // All queues should have DLX configured
      for (const queue of testConfig.queues) {
        expect(mocks.mockChannel.assertQueue).toHaveBeenCalledWith(
          queue.name,
          expect.objectContaining({
            deadLetterExchange: 'dlx',
          }),
        );
      }
    });

    it('should configure queues as durable by default', async () => {
      await broker.initialize();

      for (const queue of testConfig.queues) {
        expect(mocks.mockChannel.assertQueue).toHaveBeenCalledWith(
          queue.name,
          expect.objectContaining({
            durable: true,
          }),
        );
      }
    });
  });
});
