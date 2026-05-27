/**
 * Unit tests for MessageBrokerMetrics
 *
 * Tests cover:
 * - Start/stop lifecycle
 * - Periodic polling of queue stats
 * - Queue depth threshold warnings
 * - Publish rate tracking
 * - Consumed rate calculation
 * - Consumer lag tracking
 * - getAllQueueStats aggregation
 * - getMetrics snapshot
 * - Error handling during poll
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MessageBrokerConfig, QueueStats } from './types.js';

// --- Mock setup ---

const mockLogger = {
  child: vi.fn().mockReturnThis(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock('pino', () => ({
  default: () => mockLogger,
}));

import { MessageBrokerMetrics } from './metrics.js';
import type { MessageBrokerService } from './message-broker.js';

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
};

function createMockBroker(statsMap?: Record<string, QueueStats>): MessageBrokerService {
  const defaultStats: Record<string, QueueStats> = {
    'agent.status.changes': { name: 'agent.status.changes', messageCount: 5, consumerCount: 2 },
    'tool.call.logs': { name: 'tool.call.logs', messageCount: 10, consumerCount: 1 },
    'audit.logs': { name: 'audit.logs', messageCount: 0, consumerCount: 3 },
  };

  const stats = statsMap ?? defaultStats;

  return {
    getQueueStats: vi.fn(async (queue: string) => {
      const result = stats[queue];
      if (!result) {
        throw new Error(`Queue not found: ${queue}`);
      }
      return result;
    }),
  } as unknown as MessageBrokerService;
}

describe('MessageBrokerMetrics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const broker = createMockBroker();
      const metrics = new MessageBrokerMetrics(broker, testConfig);

      expect(metrics.running).toBe(false);
    });

    it('should accept custom metrics config', () => {
      const broker = createMockBroker();
      const metrics = new MessageBrokerMetrics(broker, testConfig, {
        metricsConfig: {
          pollingIntervalMs: 5000,
          queueDepthWarningThreshold: 500,
        },
      });

      expect(metrics.running).toBe(false);
    });
  });

  describe('start/stop lifecycle', () => {
    it('should start polling and set running to true', async () => {
      const broker = createMockBroker();
      const metrics = new MessageBrokerMetrics(broker, testConfig, {
        metricsConfig: { pollingIntervalMs: 1000 },
      });

      metrics.start();

      expect(metrics.running).toBe(true);

      // Allow the initial poll to complete
      await vi.advanceTimersByTimeAsync(0);

      metrics.stop();
    });

    it('should stop polling and set running to false', async () => {
      const broker = createMockBroker();
      const metrics = new MessageBrokerMetrics(broker, testConfig, {
        metricsConfig: { pollingIntervalMs: 1000 },
      });

      metrics.start();
      await vi.advanceTimersByTimeAsync(0);

      metrics.stop();

      expect(metrics.running).toBe(false);
    });

    it('should not start twice if already running', async () => {
      const broker = createMockBroker();
      const metrics = new MessageBrokerMetrics(broker, testConfig, {
        metricsConfig: { pollingIntervalMs: 1000 },
      });

      metrics.start();
      await vi.advanceTimersByTimeAsync(0);

      metrics.start(); // second call should warn

      expect(mockLogger.warn).toHaveBeenCalledWith('Metrics collector is already running');

      metrics.stop();
    });

    it('should be safe to call stop when not running', () => {
      const broker = createMockBroker();
      const metrics = new MessageBrokerMetrics(broker, testConfig);

      // Should not throw
      metrics.stop();
      expect(metrics.running).toBe(false);
    });
  });

  describe('periodic polling', () => {
    it('should poll immediately on start', async () => {
      const broker = createMockBroker();
      const metrics = new MessageBrokerMetrics(broker, testConfig, {
        metricsConfig: { pollingIntervalMs: 5000 },
      });

      metrics.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(broker.getQueueStats).toHaveBeenCalledTimes(3); // 3 queues

      metrics.stop();
    });

    it('should poll at configured interval', async () => {
      const broker = createMockBroker();
      const metrics = new MessageBrokerMetrics(broker, testConfig, {
        metricsConfig: { pollingIntervalMs: 5000 },
      });

      metrics.start();
      await vi.advanceTimersByTimeAsync(0); // initial poll

      vi.clearAllMocks();

      await vi.advanceTimersByTimeAsync(5000); // next poll

      expect(broker.getQueueStats).toHaveBeenCalledTimes(3);

      metrics.stop();
    });

    it('should not poll after stop', async () => {
      const broker = createMockBroker();
      const metrics = new MessageBrokerMetrics(broker, testConfig, {
        metricsConfig: { pollingIntervalMs: 1000 },
      });

      metrics.start();
      await vi.advanceTimersByTimeAsync(0);

      metrics.stop();
      vi.clearAllMocks();

      await vi.advanceTimersByTimeAsync(5000);

      expect(broker.getQueueStats).not.toHaveBeenCalled();
    });
  });

  describe('getAllQueueStats', () => {
    it('should return stats for all configured queues', async () => {
      const broker = createMockBroker();
      const metrics = new MessageBrokerMetrics(broker, testConfig);

      const stats = await metrics.getAllQueueStats();

      expect(stats).toHaveLength(3);
      expect(stats[0]).toEqual({
        name: 'agent.status.changes',
        messageCount: 5,
        consumerCount: 2,
      });
      expect(stats[1]).toEqual({
        name: 'tool.call.logs',
        messageCount: 10,
        consumerCount: 1,
      });
      expect(stats[2]).toEqual({
        name: 'audit.logs',
        messageCount: 0,
        consumerCount: 3,
      });
    });

    it('should handle errors for individual queues gracefully', async () => {
      const broker = {
        getQueueStats: vi.fn(async (queue: string) => {
          if (queue === 'tool.call.logs') {
            throw new Error('Queue unavailable');
          }
          return { name: queue, messageCount: 1, consumerCount: 1 };
        }),
      } as unknown as MessageBrokerService;

      const metrics = new MessageBrokerMetrics(broker, testConfig);
      const stats = await metrics.getAllQueueStats();

      // Should return stats for the 2 successful queues
      expect(stats).toHaveLength(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ queue: 'tool.call.logs' }),
        'Failed to get stats for queue',
      );
    });
  });

  describe('getMetrics', () => {
    it('should return empty metrics before first poll', () => {
      const broker = createMockBroker();
      const metrics = new MessageBrokerMetrics(broker, testConfig);

      const result = metrics.getMetrics();

      expect(result.queues).toHaveLength(0);
      expect(result.totalMessages).toBe(0);
      expect(result.totalConsumers).toBe(0);
      expect(result.isPolling).toBe(false);
    });

    it('should return populated metrics after poll', async () => {
      const broker = createMockBroker();
      const metrics = new MessageBrokerMetrics(broker, testConfig, {
        metricsConfig: { pollingIntervalMs: 1000 },
      });

      metrics.start();
      await vi.advanceTimersByTimeAsync(0);

      const result = metrics.getMetrics();

      expect(result.queues).toHaveLength(3);
      expect(result.totalMessages).toBe(15); // 5 + 10 + 0
      expect(result.totalConsumers).toBe(6); // 2 + 1 + 3
      expect(result.isPolling).toBe(true);
      expect(result.collectedAt).toBeDefined();

      metrics.stop();
    });

    it('should include per-queue metrics with correct fields', async () => {
      const broker = createMockBroker();
      const metrics = new MessageBrokerMetrics(broker, testConfig, {
        metricsConfig: { pollingIntervalMs: 1000 },
      });

      metrics.start();
      await vi.advanceTimersByTimeAsync(0);

      const result = metrics.getMetrics();
      const agentQueue = result.queues.find((q) => q.name === 'agent.status.changes');

      expect(agentQueue).toBeDefined();
      expect(agentQueue!.messageCount).toBe(5);
      expect(agentQueue!.consumerCount).toBe(2);
      expect(agentQueue!.consumerLag).toBe(5); // has consumers and messages
      expect(agentQueue!.lastPolledAt).toBeDefined();

      metrics.stop();
    });
  });

  describe('queue depth threshold warnings', () => {
    it('should log warning when queue depth exceeds threshold', async () => {
      const broker = createMockBroker({
        'agent.status.changes': { name: 'agent.status.changes', messageCount: 1500, consumerCount: 1 },
        'tool.call.logs': { name: 'tool.call.logs', messageCount: 50, consumerCount: 1 },
        'audit.logs': { name: 'audit.logs', messageCount: 0, consumerCount: 1 },
      });

      const metrics = new MessageBrokerMetrics(broker, testConfig, {
        metricsConfig: { pollingIntervalMs: 1000, queueDepthWarningThreshold: 1000 },
      });

      metrics.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          queue: 'agent.status.changes',
          messageCount: 1500,
          threshold: 1000,
        }),
        'Queue depth exceeds warning threshold',
      );

      metrics.stop();
    });

    it('should not log warning when queue depth is below threshold', async () => {
      const broker = createMockBroker({
        'agent.status.changes': { name: 'agent.status.changes', messageCount: 5, consumerCount: 1 },
        'tool.call.logs': { name: 'tool.call.logs', messageCount: 10, consumerCount: 1 },
        'audit.logs': { name: 'audit.logs', messageCount: 0, consumerCount: 1 },
      });

      const metrics = new MessageBrokerMetrics(broker, testConfig, {
        metricsConfig: { pollingIntervalMs: 1000, queueDepthWarningThreshold: 1000 },
      });

      metrics.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.objectContaining({ queue: expect.any(String), threshold: expect.any(Number) }),
        'Queue depth exceeds warning threshold',
      );

      metrics.stop();
    });
  });

  describe('publish rate tracking', () => {
    it('should track publish counts per queue', async () => {
      const broker = createMockBroker();
      const metrics = new MessageBrokerMetrics(broker, testConfig, {
        metricsConfig: { pollingIntervalMs: 1000 },
      });

      metrics.recordPublish('agent.status.changes');
      metrics.recordPublish('agent.status.changes');
      metrics.recordPublish('tool.call.logs');

      metrics.start();
      await vi.advanceTimersByTimeAsync(0);

      const result = metrics.getMetrics();
      const agentQueue = result.queues.find((q) => q.name === 'agent.status.changes');
      const toolQueue = result.queues.find((q) => q.name === 'tool.call.logs');

      expect(agentQueue!.publishedRate).toBe(2);
      expect(toolQueue!.publishedRate).toBe(1);

      metrics.stop();
    });

    it('should reset publish counts after each poll', async () => {
      const broker = createMockBroker();
      const metrics = new MessageBrokerMetrics(broker, testConfig, {
        metricsConfig: { pollingIntervalMs: 1000 },
      });

      metrics.start();
      await vi.advanceTimersByTimeAsync(0);

      metrics.recordPublish('agent.status.changes');
      metrics.recordPublish('agent.status.changes');

      await vi.advanceTimersByTimeAsync(1000); // next poll

      const result = metrics.getMetrics();
      const agentQueue = result.queues.find((q) => q.name === 'agent.status.changes');
      expect(agentQueue!.publishedRate).toBe(2);

      // After another poll with no publishes, rate should be 0
      await vi.advanceTimersByTimeAsync(1000);
      const result2 = metrics.getMetrics();
      const agentQueue2 = result2.queues.find((q) => q.name === 'agent.status.changes');
      expect(agentQueue2!.publishedRate).toBe(0);

      metrics.stop();
    });
  });

  describe('consumed rate calculation', () => {
    it('should calculate consumed rate based on message count delta', async () => {
      let callCount = 0;
      const broker = {
        getQueueStats: vi.fn(async (queue: string) => {
          callCount++;
          if (queue === 'agent.status.changes') {
            // First poll: 10 messages, second poll: 7 messages (3 consumed)
            return {
              name: queue,
              messageCount: callCount <= 3 ? 10 : 7,
              consumerCount: 2,
            };
          }
          return { name: queue, messageCount: 0, consumerCount: 1 };
        }),
      } as unknown as MessageBrokerService;

      const metrics = new MessageBrokerMetrics(broker, testConfig, {
        metricsConfig: { pollingIntervalMs: 1000 },
      });

      metrics.start();
      await vi.advanceTimersByTimeAsync(0); // first poll

      // First poll has no previous data, so consumedRate = 0
      let result = metrics.getMetrics();
      let agentQueue = result.queues.find((q) => q.name === 'agent.status.changes');
      expect(agentQueue!.consumedRate).toBe(0);

      await vi.advanceTimersByTimeAsync(1000); // second poll

      result = metrics.getMetrics();
      agentQueue = result.queues.find((q) => q.name === 'agent.status.changes');
      // previous=10, published=0, current=7 → consumed = 10 + 0 - 7 = 3
      expect(agentQueue!.consumedRate).toBe(3);

      metrics.stop();
    });
  });

  describe('consumer lag tracking', () => {
    it('should report consumer lag when consumers exist and messages are pending', async () => {
      const broker = createMockBroker({
        'agent.status.changes': { name: 'agent.status.changes', messageCount: 50, consumerCount: 2 },
        'tool.call.logs': { name: 'tool.call.logs', messageCount: 0, consumerCount: 1 },
        'audit.logs': { name: 'audit.logs', messageCount: 10, consumerCount: 0 },
      });

      const metrics = new MessageBrokerMetrics(broker, testConfig, {
        metricsConfig: { pollingIntervalMs: 1000 },
      });

      metrics.start();
      await vi.advanceTimersByTimeAsync(0);

      const result = metrics.getMetrics();

      const agentQueue = result.queues.find((q) => q.name === 'agent.status.changes');
      expect(agentQueue!.consumerLag).toBe(50); // has consumers, messages pending

      const toolQueue = result.queues.find((q) => q.name === 'tool.call.logs');
      expect(toolQueue!.consumerLag).toBe(0); // has consumers but no messages

      const auditQueue = result.queues.find((q) => q.name === 'audit.logs');
      expect(auditQueue!.consumerLag).toBe(0); // no consumers, so lag is 0

      metrics.stop();
    });
  });

  describe('error handling', () => {
    it('should handle poll errors gracefully and continue running', async () => {
      const broker = {
        getQueueStats: vi.fn().mockRejectedValue(new Error('Connection lost')),
      } as unknown as MessageBrokerService;

      const metrics = new MessageBrokerMetrics(broker, testConfig, {
        metricsConfig: { pollingIntervalMs: 1000 },
      });

      metrics.start();
      await vi.advanceTimersByTimeAsync(0);

      // Should log error but remain running
      expect(metrics.running).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalled();

      metrics.stop();
    });
  });
});
