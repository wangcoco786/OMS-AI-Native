/**
 * Tests for SyncJobRepository
 *
 * Tests CRUD operations for sync_jobs and sync_job_runs tables
 * using a mocked PostgresDatabaseService.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncJobRepository } from './sync-job-repository.js';
import type { SyncJobConfig } from '../../shared/m2-types.js';

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-1234'),
}));

// Create mock database service
function createMockDb() {
  const mockTx = {
    query: vi.fn(),
    client: {} as unknown,
  };

  const db = {
    query: vi.fn(),
    transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => {
      return fn(mockTx);
    }),
    migrate: vi.fn(),
    getPoolStats: vi.fn(),
    shutdown: vi.fn(),
  };

  return { db, mockTx };
}

describe('SyncJobRepository', () => {
  let repo: SyncJobRepository;
  let db: ReturnType<typeof createMockDb>['db'];
  let mockTx: ReturnType<typeof createMockDb>['mockTx'];

  beforeEach(() => {
    vi.clearAllMocks();
    const mocks = createMockDb();
    db = mocks.db;
    mockTx = mocks.mockTx;
    repo = new SyncJobRepository(db as never);
  });

  describe('create', () => {
    it('inserts a new sync job and returns the config', async () => {
      const now = new Date();
      const row = {
        id: 'mock-uuid-1234',
        tenant_id: 'tenant-1',
        source: 'shopify',
        data_type: 'orders',
        cron_expression: '*/5 * * * *',
        enabled: true,
        config: { apiKey: 'key' },
        last_sync_at: null,
        last_sync_cursor: null,
        created_at: now,
        updated_at: now,
      };

      mockTx.query.mockResolvedValue([row]);

      const result = await repo.create({
        tenantId: 'tenant-1',
        source: 'shopify',
        dataType: 'orders',
        cronExpression: '*/5 * * * *',
        enabled: true,
        config: { apiKey: 'key' },
      });

      expect(result.id).toBe('mock-uuid-1234');
      expect(result.tenantId).toBe('tenant-1');
      expect(result.source).toBe('shopify');
      expect(result.dataType).toBe('orders');
      expect(result.cronExpression).toBe('*/5 * * * *');
      expect(result.enabled).toBe(true);
      expect(result.config).toEqual({ apiKey: 'key' });
      expect(mockTx.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('findByTenant', () => {
    it('returns all jobs for a tenant', async () => {
      const rows = [
        {
          id: 'job-1',
          tenant_id: 'tenant-1',
          source: 'shopify',
          data_type: 'orders',
          cron_expression: '*/5 * * * *',
          enabled: true,
          config: {},
          last_sync_at: null,
          last_sync_cursor: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 'job-2',
          tenant_id: 'tenant-1',
          source: 'wms',
          data_type: 'inventory',
          cron_expression: '*/10 * * * *',
          enabled: false,
          config: {},
          last_sync_at: null,
          last_sync_cursor: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      db.query.mockResolvedValue(rows);

      const result = await repo.findByTenant('tenant-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('job-1');
      expect(result[1].id).toBe('job-2');
      expect(db.query).toHaveBeenCalledWith(
        'SELECT * FROM sync_jobs ORDER BY created_at DESC',
        [],
        'tenant-1',
      );
    });
  });

  describe('findById', () => {
    it('returns a job by ID', async () => {
      const row = {
        id: 'job-1',
        tenant_id: 'tenant-1',
        source: 'shopify',
        data_type: 'orders',
        cron_expression: '*/5 * * * *',
        enabled: true,
        config: {},
        last_sync_at: null,
        last_sync_cursor: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      db.query.mockResolvedValue([row]);

      const result = await repo.findById('job-1', 'tenant-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('job-1');
      expect(db.query).toHaveBeenCalledWith(
        'SELECT * FROM sync_jobs WHERE id = $1',
        ['job-1'],
        'tenant-1',
      );
    });

    it('returns null when job not found', async () => {
      db.query.mockResolvedValue([]);

      const result = await repo.findById('non-existent', 'tenant-1');
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('deletes a job and returns true', async () => {
      mockTx.query.mockResolvedValue([{ id: 'job-1' }]);

      const result = await repo.delete('job-1', 'tenant-1');
      expect(result).toBe(true);
    });

    it('returns false when job not found', async () => {
      mockTx.query.mockResolvedValue([]);

      const result = await repo.delete('non-existent', 'tenant-1');
      expect(result).toBe(false);
    });
  });

  describe('createRun', () => {
    it('creates a new run record and returns the ID', async () => {
      mockTx.query.mockResolvedValue([]);

      const runId = await repo.createRun('job-1', 'tenant-1');

      expect(runId).toBe('mock-uuid-1234');
      expect(mockTx.query).toHaveBeenCalledTimes(1);
      expect(mockTx.query.mock.calls[0][0]).toContain('INSERT INTO sync_job_runs');
    });
  });

  describe('updateRun', () => {
    it('updates a run record with results', async () => {
      mockTx.query.mockResolvedValue([]);

      await repo.updateRun('run-1', {
        status: 'success',
        recordsProcessed: 100,
        recordsCreated: 50,
        recordsUpdated: 30,
        conflicts: [],
        durationMs: 5000,
      });

      expect(mockTx.query).toHaveBeenCalledTimes(1);
      expect(mockTx.query.mock.calls[0][0]).toContain('UPDATE sync_job_runs');
      expect(mockTx.query.mock.calls[0][1]).toContain('success');
      expect(mockTx.query.mock.calls[0][1]).toContain(100);
      expect(mockTx.query.mock.calls[0][1]).toContain(50);
      expect(mockTx.query.mock.calls[0][1]).toContain(30);
    });
  });

  describe('getRunHistory', () => {
    it('returns run history for a job', async () => {
      const rows = [
        {
          id: 'run-1',
          job_id: 'job-1',
          tenant_id: 'tenant-1',
          status: 'success',
          records_processed: 100,
          records_created: 50,
          records_updated: 30,
          conflicts: [],
          duration_ms: 5000,
          error_message: null,
          retry_count: 0,
          started_at: new Date(),
          completed_at: new Date(),
        },
      ];

      db.query.mockResolvedValue(rows);

      const result = await repo.getRunHistory('job-1', 'tenant-1', 10);

      expect(result).toHaveLength(1);
      expect(result[0].jobId).toBe('job-1');
      expect(result[0].status).toBe('success');
      expect(result[0].recordsProcessed).toBe(100);
      expect(result[0].recordsCreated).toBe(50);
      expect(result[0].recordsUpdated).toBe(30);
      expect(result[0].duration).toBe(5000);
    });
  });
});
