/**
 * Tests for SyncWorker
 *
 * Tests the incremental sync logic including:
 * - Fetching records via adapter with pagination
 * - Filtering records by lastSyncCursor
 * - Updating lastSyncCursor after successful sync
 * - Recording run results (records_processed, records_created, records_updated, duration_ms)
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SyncWorker } from './sync-worker.js';
import type { SyncJobData } from './queue-manager.js';
import type { SyncJobRepository } from './sync-job-repository.js';
import type { SyncAdapter, SyncAdapterRegistry, SyncRecord } from './sync-adapter.js';
import { SyncRetryStrategy, DEFAULT_SYNC_RETRY_CONFIG } from './retry-strategy.js';
import type { SyncJobConfig } from '../../shared/m2-types.js';

function createMockRepository(): {
  repository: SyncJobRepository;
  mocks: {
    createRun: ReturnType<typeof vi.fn>;
    updateRun: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
} {
  const mocks = {
    createRun: vi.fn().mockResolvedValue('run-1'),
    updateRun: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn(),
    update: vi.fn().mockResolvedValue(null),
  };

  return {
    repository: mocks as unknown as SyncJobRepository,
    mocks,
  };
}

function createMockAdapter(): {
  adapter: SyncAdapter;
  fetchRecords: ReturnType<typeof vi.fn>;
} {
  const fetchRecords = vi.fn();
  return {
    adapter: { fetchRecords } as SyncAdapter,
    fetchRecords,
  };
}

function createMockRegistry(adapter?: SyncAdapter): SyncAdapterRegistry {
  return {
    getAdapter: vi.fn().mockReturnValue(adapter ?? null),
  };
}

function createJobData(overrides?: Partial<SyncJobData>): SyncJobData {
  return {
    jobId: 'job-1',
    tenantId: 'tenant-1',
    source: 'shopify',
    dataType: 'orders',
    config: { apiKey: 'test-key' },
    ...overrides,
  };
}

function createJobConfig(overrides?: Partial<SyncJobConfig>): SyncJobConfig {
  return {
    id: 'job-1',
    tenantId: 'tenant-1',
    source: 'shopify',
    dataType: 'orders',
    cronExpression: '*/5 * * * *',
    enabled: true,
    config: { apiKey: 'test-key' },
    ...overrides,
  };
}

function createSyncRecord(overrides?: Partial<SyncRecord>): SyncRecord {
  return {
    id: 'record-1',
    data: { name: 'Test Order' },
    updatedAt: '2024-01-15T10:00:00Z',
    action: 'create',
    ...overrides,
  };
}

describe('SyncWorker', () => {
  let worker: SyncWorker;
  let repoMocks: ReturnType<typeof createMockRepository>['mocks'];
  let adapterMock: ReturnType<typeof createMockAdapter>;
  let registry: SyncAdapterRegistry;

  beforeEach(() => {
    vi.clearAllMocks();

    const { repository, mocks } = createMockRepository();
    repoMocks = mocks;

    adapterMock = createMockAdapter();
    registry = createMockRegistry(adapterMock.adapter);

    // Use a retry strategy with instant sleep for tests
    const noDelaySleep = () => Promise.resolve();
    const retryStrategy = new SyncRetryStrategy(DEFAULT_SYNC_RETRY_CONFIG, undefined, noDelaySleep);
    worker = new SyncWorker(repository, registry, undefined, { retryStrategy });
  });

  describe('processJob - successful sync', () => {
    it('processes a job with no previous cursor (initial sync)', async () => {
      const jobConfig = createJobConfig({ lastSyncCursor: undefined });
      repoMocks.findById.mockResolvedValue(jobConfig);

      const records: SyncRecord[] = [
        createSyncRecord({ id: 'r1', updatedAt: '2024-01-15T10:00:00Z', action: 'create' }),
        createSyncRecord({ id: 'r2', updatedAt: '2024-01-15T11:00:00Z', action: 'update' }),
        createSyncRecord({ id: 'r3', updatedAt: '2024-01-15T12:00:00Z', action: 'create' }),
      ];

      adapterMock.fetchRecords.mockResolvedValue({
        records,
        nextCursor: '2024-01-15T12:00:00Z',
        hasMore: false,
      });

      const result = await worker.processJob(createJobData());

      expect(result.status).toBe('success');
      expect(result.recordsProcessed).toBe(3);
      expect(result.recordsCreated).toBe(2);
      expect(result.recordsUpdated).toBe(1);
      expect(result.runId).toBe('run-1');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('filters records based on lastSyncCursor (incremental sync)', async () => {
      const jobConfig = createJobConfig({ lastSyncCursor: '2024-01-15T10:00:00Z' });
      repoMocks.findById.mockResolvedValue(jobConfig);

      const records: SyncRecord[] = [
        createSyncRecord({ id: 'r1', updatedAt: '2024-01-15T09:00:00Z', action: 'create' }), // Before cursor - filtered out
        createSyncRecord({ id: 'r2', updatedAt: '2024-01-15T10:00:00Z', action: 'update' }), // Equal to cursor - filtered out
        createSyncRecord({ id: 'r3', updatedAt: '2024-01-15T11:00:00Z', action: 'create' }), // After cursor - included
        createSyncRecord({ id: 'r4', updatedAt: '2024-01-15T12:00:00Z', action: 'update' }), // After cursor - included
      ];

      adapterMock.fetchRecords.mockResolvedValue({
        records,
        nextCursor: '2024-01-15T12:00:00Z',
        hasMore: false,
      });

      const result = await worker.processJob(createJobData());

      expect(result.status).toBe('success');
      expect(result.recordsProcessed).toBe(2); // Only records after cursor
      expect(result.recordsCreated).toBe(1);
      expect(result.recordsUpdated).toBe(1);
    });

    it('updates lastSyncCursor to the latest record timestamp', async () => {
      const jobConfig = createJobConfig({ lastSyncCursor: '2024-01-15T08:00:00Z' });
      repoMocks.findById.mockResolvedValue(jobConfig);

      const records: SyncRecord[] = [
        createSyncRecord({ id: 'r1', updatedAt: '2024-01-15T09:00:00Z', action: 'create' }),
        createSyncRecord({ id: 'r2', updatedAt: '2024-01-15T12:00:00Z', action: 'update' }),
        createSyncRecord({ id: 'r3', updatedAt: '2024-01-15T10:00:00Z', action: 'create' }),
      ];

      adapterMock.fetchRecords.mockResolvedValue({
        records,
        nextCursor: '2024-01-15T12:00:00Z',
        hasMore: false,
      });

      await worker.processJob(createJobData());

      expect(repoMocks.update).toHaveBeenCalledWith('job-1', 'tenant-1', {
        lastSyncCursor: '2024-01-15T12:00:00Z',
        lastSyncAt: expect.any(Date),
      });
    });

    it('does not update cursor when no new records are found', async () => {
      const jobConfig = createJobConfig({ lastSyncCursor: '2024-01-15T12:00:00Z' });
      repoMocks.findById.mockResolvedValue(jobConfig);

      // All records are at or before the cursor
      const records: SyncRecord[] = [
        createSyncRecord({ id: 'r1', updatedAt: '2024-01-15T10:00:00Z', action: 'create' }),
        createSyncRecord({ id: 'r2', updatedAt: '2024-01-15T11:00:00Z', action: 'update' }),
      ];

      adapterMock.fetchRecords.mockResolvedValue({
        records,
        nextCursor: '2024-01-15T11:00:00Z',
        hasMore: false,
      });

      const result = await worker.processJob(createJobData());

      expect(result.status).toBe('success');
      expect(result.recordsProcessed).toBe(0);
      // Cursor should not be updated since no new records
      expect(repoMocks.update).not.toHaveBeenCalled();
    });

    it('handles pagination (multiple fetch calls)', async () => {
      const jobConfig = createJobConfig({ lastSyncCursor: undefined });
      repoMocks.findById.mockResolvedValue(jobConfig);

      // First page
      adapterMock.fetchRecords
        .mockResolvedValueOnce({
          records: [
            createSyncRecord({ id: 'r1', updatedAt: '2024-01-15T10:00:00Z', action: 'create' }),
            createSyncRecord({ id: 'r2', updatedAt: '2024-01-15T11:00:00Z', action: 'create' }),
          ],
          nextCursor: '2024-01-15T11:00:00Z',
          hasMore: true,
        })
        // Second page
        .mockResolvedValueOnce({
          records: [
            createSyncRecord({ id: 'r3', updatedAt: '2024-01-15T12:00:00Z', action: 'update' }),
          ],
          nextCursor: '2024-01-15T12:00:00Z',
          hasMore: false,
        });

      const result = await worker.processJob(createJobData());

      expect(result.status).toBe('success');
      expect(result.recordsProcessed).toBe(3);
      expect(result.recordsCreated).toBe(2);
      expect(result.recordsUpdated).toBe(1);
      expect(adapterMock.fetchRecords).toHaveBeenCalledTimes(2);
    });

    it('records run result with correct fields', async () => {
      const jobConfig = createJobConfig({ lastSyncCursor: undefined });
      repoMocks.findById.mockResolvedValue(jobConfig);

      adapterMock.fetchRecords.mockResolvedValue({
        records: [
          createSyncRecord({ id: 'r1', action: 'create' }),
          createSyncRecord({ id: 'r2', action: 'update', updatedAt: '2024-01-15T11:00:00Z' }),
        ],
        nextCursor: '2024-01-15T11:00:00Z',
        hasMore: false,
      });

      await worker.processJob(createJobData());

      expect(repoMocks.updateRun).toHaveBeenCalledWith('run-1', {
        status: 'success',
        recordsProcessed: 2,
        recordsCreated: 1,
        recordsUpdated: 1,
        conflicts: [],
        durationMs: expect.any(Number),
      });
    });

    it('counts delete actions as updates', async () => {
      const jobConfig = createJobConfig({ lastSyncCursor: undefined });
      repoMocks.findById.mockResolvedValue(jobConfig);

      adapterMock.fetchRecords.mockResolvedValue({
        records: [
          createSyncRecord({ id: 'r1', action: 'delete', updatedAt: '2024-01-15T10:00:00Z' }),
          createSyncRecord({ id: 'r2', action: 'create', updatedAt: '2024-01-15T11:00:00Z' }),
        ],
        nextCursor: '2024-01-15T11:00:00Z',
        hasMore: false,
      });

      const result = await worker.processJob(createJobData());

      expect(result.recordsProcessed).toBe(2);
      expect(result.recordsCreated).toBe(1);
      expect(result.recordsUpdated).toBe(1); // delete counted as update
    });
  });

  describe('processJob - error handling', () => {
    it('fails when job config is not found', async () => {
      repoMocks.findById.mockResolvedValue(null);

      const result = await worker.processJob(createJobData());

      expect(result.status).toBe('failed');
      expect(result.error).toContain('Sync job not found');
      expect(repoMocks.updateRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
        status: 'failed',
        errorMessage: expect.stringContaining('Sync job not found'),
      }));
    });

    it('fails when no adapter is found for the source', async () => {
      const jobConfig = createJobConfig();
      repoMocks.findById.mockResolvedValue(jobConfig);

      // Override registry to return no adapter
      const emptyRegistry = createMockRegistry(undefined);
      const noDelaySleep = () => Promise.resolve();
      const retryStrategy = new SyncRetryStrategy(DEFAULT_SYNC_RETRY_CONFIG, undefined, noDelaySleep);
      const workerWithNoAdapter = new SyncWorker(
        repoMocks as unknown as SyncJobRepository,
        emptyRegistry,
        undefined,
        { retryStrategy },
      );

      const result = await workerWithNoAdapter.processJob(createJobData());

      expect(result.status).toBe('failed');
      expect(result.error).toContain('No adapter found for source');
    });

    it('fails when adapter throws an error', async () => {
      const jobConfig = createJobConfig();
      repoMocks.findById.mockResolvedValue(jobConfig);

      adapterMock.fetchRecords.mockRejectedValue(new Error('API connection timeout'));

      const result = await worker.processJob(createJobData());

      expect(result.status).toBe('failed');
      expect(result.error).toBe('API connection timeout');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(repoMocks.updateRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
        status: 'failed',
        errorMessage: 'API connection timeout',
        durationMs: expect.any(Number),
      }));
    });

    it('returns failed result when createRun fails', async () => {
      repoMocks.createRun.mockRejectedValue(new Error('DB connection failed'));

      const result = await worker.processJob(createJobData());

      expect(result.status).toBe('failed');
      expect(result.runId).toBe('');
      expect(result.error).toContain('Failed to create run record');
    });

    it('records duration even on failure', async () => {
      const jobConfig = createJobConfig();
      repoMocks.findById.mockResolvedValue(jobConfig);

      adapterMock.fetchRecords.mockRejectedValue(new Error('Network error'));

      const result = await worker.processJob(createJobData());

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('processJob - edge cases', () => {
    it('handles empty records from adapter', async () => {
      const jobConfig = createJobConfig({ lastSyncCursor: '2024-01-15T08:00:00Z' });
      repoMocks.findById.mockResolvedValue(jobConfig);

      adapterMock.fetchRecords.mockResolvedValue({
        records: [],
        nextCursor: '2024-01-15T08:00:00Z',
        hasMore: false,
      });

      const result = await worker.processJob(createJobData());

      expect(result.status).toBe('success');
      expect(result.recordsProcessed).toBe(0);
      expect(result.recordsCreated).toBe(0);
      expect(result.recordsUpdated).toBe(0);
    });

    it('passes the correct cursor to the adapter', async () => {
      const jobConfig = createJobConfig({ lastSyncCursor: '2024-01-15T08:00:00Z' });
      repoMocks.findById.mockResolvedValue(jobConfig);

      adapterMock.fetchRecords.mockResolvedValue({
        records: [],
        nextCursor: '2024-01-15T08:00:00Z',
        hasMore: false,
      });

      await worker.processJob(createJobData());

      expect(adapterMock.fetchRecords).toHaveBeenCalledWith(
        { apiKey: 'test-key' },
        '2024-01-15T08:00:00Z',
      );
    });

    it('passes undefined cursor to adapter when no lastSyncCursor exists', async () => {
      const jobConfig = createJobConfig({ lastSyncCursor: undefined });
      repoMocks.findById.mockResolvedValue(jobConfig);

      adapterMock.fetchRecords.mockResolvedValue({
        records: [],
        nextCursor: '',
        hasMore: false,
      });

      await worker.processJob(createJobData());

      expect(adapterMock.fetchRecords).toHaveBeenCalledWith(
        { apiKey: 'test-key' },
        undefined,
      );
    });

    it('creates a run record before processing', async () => {
      const jobConfig = createJobConfig();
      repoMocks.findById.mockResolvedValue(jobConfig);

      adapterMock.fetchRecords.mockResolvedValue({
        records: [],
        nextCursor: '',
        hasMore: false,
      });

      await worker.processJob(createJobData());

      expect(repoMocks.createRun).toHaveBeenCalledWith('job-1', 'tenant-1');
    });
  });
});
