/**
 * Tests for Data Sync Bootstrap — Integration Wiring
 *
 * Verifies that the bootstrap function correctly wires:
 * 1. Sync Worker → SyncPipeline.onSyncComplete after job completion
 * 2. KPI Aggregator → SSE push (via pipeline constructor wiring)
 * 3. MCP cache invalidation after sync
 *
 * Requirements: 5.1, 9.1, 10.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bootstrapDataSyncPipeline } from './data-sync-bootstrap.js';
import type { DataSyncBootstrapDeps } from './data-sync-bootstrap.js';
import type { MetricUpdate } from '../../shared/m2-types.js';

describe('bootstrapDataSyncPipeline', () => {
  let mockQueueManager: DataSyncBootstrapDeps['queueManager'];
  let mockWorker: DataSyncBootstrapDeps['worker'];
  let mockKPIAggregator: DataSyncBootstrapDeps['kpiAggregator'];
  let mockDashboardSSE: DataSyncBootstrapDeps['dashboardSSE'];
  let mockQueryCache: DataSyncBootstrapDeps['mcpQueryCache'];
  let registeredProcessor: ((job: { data: unknown }) => Promise<unknown>) | null;
  let capturedOnUpdateCallback: ((update: MetricUpdate) => void) | undefined;

  beforeEach(() => {
    registeredProcessor = null;
    capturedOnUpdateCallback = undefined;

    const mockQueue = {
      process: vi.fn((fn: (job: { data: unknown }) => Promise<unknown>) => {
        registeredProcessor = fn;
      }),
    };

    mockQueueManager = {
      getQueue: vi.fn().mockReturnValue(mockQueue),
      isInitialized: vi.fn().mockReturnValue(true),
    } as unknown as DataSyncBootstrapDeps['queueManager'];

    mockWorker = {
      processJob: vi.fn().mockResolvedValue({
        runId: 'run-1',
        status: 'success',
        recordsProcessed: 10,
        recordsCreated: 5,
        recordsUpdated: 5,
        conflicts: [],
        durationMs: 1000,
      }),
    } as unknown as DataSyncBootstrapDeps['worker'];

    mockKPIAggregator = {
      aggregate: vi.fn().mockResolvedValue([]),
      onUpdate: vi.fn((cb) => {
        capturedOnUpdateCallback = cb;
      }),
      getCacheTTL: vi.fn().mockReturnValue(300),
      buildCacheKey: vi.fn().mockReturnValue('test-key'),
    } as unknown as DataSyncBootstrapDeps['kpiAggregator'];

    mockDashboardSSE = {
      notifyMetricUpdate: vi.fn(),
      broadcastToTenant: vi.fn(),
    } as unknown as DataSyncBootstrapDeps['dashboardSSE'];

    mockQueryCache = {
      invalidate: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    } as unknown as DataSyncBootstrapDeps['mcpQueryCache'];
  });

  it('should return a SyncPipeline instance', () => {
    const { pipeline } = bootstrapDataSyncPipeline({
      queueManager: mockQueueManager,
      worker: mockWorker,
      kpiAggregator: mockKPIAggregator,
      dashboardSSE: mockDashboardSSE,
      mcpQueryCache: mockQueryCache,
    });

    expect(pipeline).toBeDefined();
  });

  it('should register a Bull Queue processor', () => {
    bootstrapDataSyncPipeline({
      queueManager: mockQueueManager,
      worker: mockWorker,
      kpiAggregator: mockKPIAggregator,
      dashboardSSE: mockDashboardSSE,
      mcpQueryCache: mockQueryCache,
    });

    expect(registeredProcessor).not.toBeNull();
  });

  it('should wire KPI Aggregator updates to SSE push', () => {
    bootstrapDataSyncPipeline({
      queueManager: mockQueueManager,
      worker: mockWorker,
      kpiAggregator: mockKPIAggregator,
      dashboardSSE: mockDashboardSSE,
      mcpQueryCache: mockQueryCache,
    });

    expect(mockKPIAggregator.onUpdate).toHaveBeenCalled();
    expect(capturedOnUpdateCallback).toBeDefined();

    // Simulate KPI aggregator emitting an update
    const update: MetricUpdate = {
      metric: 'order_count',
      value: 42,
      timestamp: new Date(),
      tenantId: 'tenant-1',
      dimensions: {},
    };
    capturedOnUpdateCallback!(update);

    expect(mockDashboardSSE.notifyMetricUpdate).toHaveBeenCalledWith(update);
  });

  describe('queue processor integration', () => {
    it('should call worker.processJob when a scheduled job runs', async () => {
      bootstrapDataSyncPipeline({
        queueManager: mockQueueManager,
        worker: mockWorker,
        kpiAggregator: mockKPIAggregator,
        dashboardSSE: mockDashboardSSE,
        mcpQueryCache: mockQueryCache,
      });

      const jobData = {
        jobId: 'job-1',
        tenantId: 'tenant-1',
        source: 'shopify',
        dataType: 'orders',
        config: {},
      };

      await registeredProcessor!({ data: jobData });

      expect(mockWorker.processJob).toHaveBeenCalledWith(jobData);
    });

    it('should trigger KPI aggregation after order sync completes', async () => {
      bootstrapDataSyncPipeline({
        queueManager: mockQueueManager,
        worker: mockWorker,
        kpiAggregator: mockKPIAggregator,
        dashboardSSE: mockDashboardSSE,
        mcpQueryCache: mockQueryCache,
      });

      const jobData = {
        jobId: 'job-1',
        tenantId: 'tenant-1',
        source: 'shopify',
        dataType: 'orders',
        config: {},
      };

      await registeredProcessor!({ data: jobData });

      expect(mockKPIAggregator.aggregate).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ granularity: 'hour' }),
      );
    });

    it('should invalidate MCP cache after sync completes', async () => {
      bootstrapDataSyncPipeline({
        queueManager: mockQueueManager,
        worker: mockWorker,
        kpiAggregator: mockKPIAggregator,
        dashboardSSE: mockDashboardSSE,
        mcpQueryCache: mockQueryCache,
      });

      const jobData = {
        jobId: 'job-1',
        tenantId: 'tenant-1',
        source: 'shopify',
        dataType: 'orders',
        config: {},
      };

      await registeredProcessor!({ data: jobData });

      expect(mockQueryCache.invalidate).toHaveBeenCalledWith('query_orders', {}, 'tenant-1');
    });

    it('should broadcast sync_complete event via SSE', async () => {
      bootstrapDataSyncPipeline({
        queueManager: mockQueueManager,
        worker: mockWorker,
        kpiAggregator: mockKPIAggregator,
        dashboardSSE: mockDashboardSSE,
        mcpQueryCache: mockQueryCache,
      });

      const jobData = {
        jobId: 'job-1',
        tenantId: 'tenant-1',
        source: 'wms',
        dataType: 'inventory',
        config: {},
      };

      await registeredProcessor!({ data: jobData });

      expect(mockDashboardSSE.broadcastToTenant).toHaveBeenCalledWith(
        'tenant-1',
        'sync_complete',
        expect.objectContaining({
          dataType: 'inventory',
          recordsProcessed: 10,
          status: 'success',
        }),
      );
    });

    it('should not trigger pipeline for failed sync', async () => {
      (mockWorker.processJob as ReturnType<typeof vi.fn>).mockResolvedValue({
        runId: 'run-fail',
        status: 'failed',
        recordsProcessed: 0,
        recordsCreated: 0,
        recordsUpdated: 0,
        conflicts: [],
        durationMs: 50,
        error: 'Connection timeout',
      });

      bootstrapDataSyncPipeline({
        queueManager: mockQueueManager,
        worker: mockWorker,
        kpiAggregator: mockKPIAggregator,
        dashboardSSE: mockDashboardSSE,
        mcpQueryCache: mockQueryCache,
      });

      const jobData = {
        jobId: 'job-2',
        tenantId: 'tenant-1',
        source: 'erp',
        dataType: 'products',
        config: {},
      };

      await registeredProcessor!({ data: jobData });

      expect(mockKPIAggregator.aggregate).not.toHaveBeenCalled();
      expect(mockQueryCache.invalidate).not.toHaveBeenCalled();
    });
  });

  it('should handle missing queue gracefully', () => {
    (mockQueueManager.getQueue as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const { pipeline } = bootstrapDataSyncPipeline({
      queueManager: mockQueueManager,
      worker: mockWorker,
      kpiAggregator: mockKPIAggregator,
      dashboardSSE: mockDashboardSSE,
      mcpQueryCache: mockQueryCache,
    });

    // Pipeline should still be created even without queue
    expect(pipeline).toBeDefined();
    expect(registeredProcessor).toBeNull();
  });
});
