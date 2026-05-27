/**
 * Tests for SyncQueueManager
 *
 * Tests the queue manager's initialization, job scheduling,
 * removal, and shutdown logic using mocked Bull Queue.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncQueueManager } from './queue-manager.js';
import type { SyncJobConfig } from '../../shared/m2-types.js';

// Mock Bull
vi.mock('bull', () => {
  const mockQueue = {
    add: vi.fn().mockResolvedValue({ id: 'test-job-id' }),
    getRepeatableJobs: vi.fn().mockResolvedValue([]),
    removeRepeatableByKey: vi.fn().mockResolvedValue(undefined),
    getJob: vi.fn().mockResolvedValue(null),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  };

  return {
    default: vi.fn(() => mockQueue),
  };
});

describe('SyncQueueManager', () => {
  let manager: SyncQueueManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SyncQueueManager();
  });

  describe('initialize', () => {
    it('initializes the queue with a Redis URL', () => {
      manager.initialize('redis://localhost:6379');
      expect(manager.isInitialized()).toBe(true);
    });

    it('does not re-initialize if already initialized', () => {
      manager.initialize('redis://localhost:6379');
      manager.initialize('redis://localhost:6379');
      expect(manager.isInitialized()).toBe(true);
    });
  });

  describe('scheduleJob', () => {
    const validConfig: SyncJobConfig = {
      id: 'job-1',
      tenantId: 'tenant-1',
      source: 'shopify',
      dataType: 'orders',
      cronExpression: '*/5 * * * *',
      enabled: true,
      config: { apiKey: 'test-key' },
    };

    it('schedules a job with valid cron expression', async () => {
      manager.initialize('redis://localhost:6379');
      await manager.scheduleJob(validConfig);

      const queue = manager.getQueue();
      expect(queue!.add).toHaveBeenCalledWith(
        {
          jobId: 'job-1',
          tenantId: 'tenant-1',
          source: 'shopify',
          dataType: 'orders',
          config: { apiKey: 'test-key' },
        },
        {
          repeat: { cron: '*/5 * * * *' },
          jobId: 'job-1',
        },
      );
    });

    it('throws error for invalid cron expression', async () => {
      manager.initialize('redis://localhost:6379');

      const invalidConfig = { ...validConfig, cronExpression: '*/2 * * * *' };
      await expect(manager.scheduleJob(invalidConfig)).rejects.toThrow(
        'Invalid cron expression',
      );
    });

    it('skips scheduling for disabled jobs', async () => {
      manager.initialize('redis://localhost:6379');

      const disabledConfig = { ...validConfig, enabled: false };
      await manager.scheduleJob(disabledConfig);

      const queue = manager.getQueue();
      expect(queue!.add).not.toHaveBeenCalled();
    });

    it('throws error if not initialized', async () => {
      await expect(manager.scheduleJob(validConfig)).rejects.toThrow(
        'Queue manager not initialized',
      );
    });
  });

  describe('removeJob', () => {
    it('removes repeatable jobs matching the jobId', async () => {
      manager.initialize('redis://localhost:6379');

      const queue = manager.getQueue()!;
      vi.mocked(queue.getRepeatableJobs).mockResolvedValue([
        { id: 'job-1', key: 'repeat:job-1:cron', name: 'data-sync', cron: '*/5 * * * *', endDate: null, every: null, next: Date.now(), tz: '' },
      ] as unknown[]);

      await manager.removeJob('job-1');

      expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('repeat:job-1:cron');
    });

    it('throws error if not initialized', async () => {
      await expect(manager.removeJob('job-1')).rejects.toThrow(
        'Queue manager not initialized',
      );
    });
  });

  describe('getJobStatus', () => {
    it('returns unknown state for non-existent job', async () => {
      manager.initialize('redis://localhost:6379');

      const status = await manager.getJobStatus('non-existent');
      expect(status.jobId).toBe('non-existent');
      expect(status.state).toBe('unknown');
    });

    it('returns waiting state for repeatable job not yet run', async () => {
      manager.initialize('redis://localhost:6379');

      const queue = manager.getQueue()!;
      const nextTime = Date.now() + 300000;
      vi.mocked(queue.getRepeatableJobs).mockResolvedValue([
        { id: 'job-1', key: 'repeat:job-1:cron', next: nextTime, name: 'data-sync', cron: '*/5 * * * *', endDate: null, every: null, tz: '' },
      ] as unknown[]);

      const status = await manager.getJobStatus('job-1');
      expect(status.jobId).toBe('job-1');
      expect(status.state).toBe('waiting');
      expect(status.nextRun).toEqual(new Date(nextTime));
    });

    it('throws error if not initialized', async () => {
      await expect(manager.getJobStatus('job-1')).rejects.toThrow(
        'Queue manager not initialized',
      );
    });
  });

  describe('shutdown', () => {
    it('closes the queue and resets state', async () => {
      manager.initialize('redis://localhost:6379');
      const queue = manager.getQueue()!;

      await manager.shutdown();

      expect(queue.close).toHaveBeenCalled();
      expect(manager.isInitialized()).toBe(false);
      expect(manager.getQueue()).toBeNull();
    });

    it('handles shutdown when not initialized', async () => {
      await expect(manager.shutdown()).resolves.toBeUndefined();
    });
  });
});
