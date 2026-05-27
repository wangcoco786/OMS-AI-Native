/**
 * Integration tests for SyncPipeline
 *
 * Verifies the end-to-end data pipeline:
 * 1. Data Sync writes → KPI Aggregator picks up and aggregates
 * 2. Aggregation results → SSE pushes to Dashboard clients
 * 3. MCP Data Tools → Query cache invalidated so fresh data is returned
 *
 * Requirements: 5.1, 9.1, 10.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncPipeline } from './sync-pipeline.js';
import type { SyncPipelineDeps } from './sync-pipeline.js';
import type { SyncWorkerResult } from './sync-worker.js';
import type { MetricUpdate } from '../../shared/m2-types.js';

describe('SyncPipeline', () => {
  let mockKPIAggregator: SyncPipelineDeps['kpiAggregator'];
  let mockDashboardSSE: SyncPipelineDeps['dashboardSSE'];
  let mockQueryCache: SyncPipelineDeps['mcpQueryCache'];
  let pipeline: SyncPipeline;
  let capturedOnUpdateCallback: ((update: MetricUpdate) => void) | undefined;

  beforeEach(() => {
    capturedOnUpdateCallback = undefined;

    mockKPIAggregator = {
      aggregate: vi.fn().mockResolvedValue([]),
      onUpdate: vi.fn((cb) => {
        capturedOnUpdateCallback = cb;
      }),
      getCacheTTL: vi.fn().mockReturnValue(300),
      buildCacheKey: vi.fn().mockReturnValue('test-key'),
    } as unknown as SyncPipelineDeps['kpiAggregator'];

    mockDashboardSSE = {
      notifyMetricUpdate: vi.fn(),
      broadcastToTenant: vi.fn(),
    } as unknown as SyncPipelineDeps['dashboardSSE'];

    mockQueryCache = {
      invalidate: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    } as unknown as SyncPipelineDeps['mcpQueryCache'];

    pipeline = new SyncPipeline({
      kpiAggregator: mockKPIAggregator,
      dashboardSSE: mockDashboardSSE,
      mcpQueryCache: mockQueryCache,
    });
  });

  describe('KPI Aggregator integration', () => {
    it('should trigger KPI aggregation after successful order sync', async () => {
      const result: SyncWorkerResult = {
        runId: 'run-1',
        status: 'success',
        recordsProcessed: 10,
        recordsCreated: 5,
        recordsUpdated: 5,
        conflicts: [],
        durationMs: 1000,
      };

      await pipeline.onSyncComplete('tenant-1', result, 'orders');

      expect(mockKPIAggregator.aggregate).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({
          granularity: 'hour',
          start: expect.any(Date),
          end: expect.any(Date),
        }),
      );
    });

    it('should NOT trigger KPI aggregation for inventory sync', async () => {
      const result: SyncWorkerResult = {
        runId: 'run-2',
        status: 'success',
        recordsProcessed: 20,
        recordsCreated: 10,
        recordsUpdated: 10,
        conflicts: [],
        durationMs: 500,
      };

      await pipeline.onSyncComplete('tenant-1', result, 'inventory');

      expect(mockKPIAggregator.aggregate).not.toHaveBeenCalled();
    });

    it('should NOT trigger pipeline for failed sync', async () => {
      const result: SyncWorkerResult = {
        runId: 'run-3',
        status: 'failed',
        recordsProcessed: 0,
        recordsCreated: 0,
        recordsUpdated: 0,
        conflicts: [],
        durationMs: 100,
        error: 'Connection timeout',
      };

      await pipeline.onSyncComplete('tenant-1', result, 'orders');

      expect(mockKPIAggregator.aggregate).not.toHaveBeenCalled();
      expect(mockQueryCache.invalidate).not.toHaveBeenCalled();
    });

    it('should NOT trigger pipeline for empty sync (zero records)', async () => {
      const result: SyncWorkerResult = {
        runId: 'run-4',
        status: 'success',
        recordsProcessed: 0,
        recordsCreated: 0,
        recordsUpdated: 0,
        conflicts: [],
        durationMs: 50,
      };

      await pipeline.onSyncComplete('tenant-1', result, 'orders');

      expect(mockKPIAggregator.aggregate).not.toHaveBeenCalled();
    });
  });

  describe('SSE push integration', () => {
    it('should wire KPI aggregator updates to SSE notifications', () => {
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

    it('should broadcast sync_complete event to dashboard subscribers', async () => {
      const result: SyncWorkerResult = {
        runId: 'run-5',
        status: 'success',
        recordsProcessed: 15,
        recordsCreated: 8,
        recordsUpdated: 7,
        conflicts: [],
        durationMs: 2000,
      };

      await pipeline.onSyncComplete('tenant-1', result, 'orders');

      expect(mockDashboardSSE.broadcastToTenant).toHaveBeenCalledWith(
        'tenant-1',
        'sync_complete',
        expect.objectContaining({
          dataType: 'orders',
          recordsProcessed: 15,
          recordsCreated: 8,
          recordsUpdated: 7,
          status: 'success',
          timestamp: expect.any(String),
        }),
      );
    });
  });

  describe('MCP cache invalidation', () => {
    it('should invalidate order query cache after order sync', async () => {
      const result: SyncWorkerResult = {
        runId: 'run-6',
        status: 'success',
        recordsProcessed: 5,
        recordsCreated: 5,
        recordsUpdated: 0,
        conflicts: [],
        durationMs: 300,
      };

      await pipeline.onSyncComplete('tenant-1', result, 'orders');

      expect(mockQueryCache.invalidate).toHaveBeenCalledWith('query_orders', {}, 'tenant-1');
    });

    it('should invalidate inventory query cache after inventory sync', async () => {
      const result: SyncWorkerResult = {
        runId: 'run-7',
        status: 'success',
        recordsProcessed: 10,
        recordsCreated: 0,
        recordsUpdated: 10,
        conflicts: [],
        durationMs: 400,
      };

      await pipeline.onSyncComplete('tenant-1', result, 'inventory');

      expect(mockQueryCache.invalidate).toHaveBeenCalledWith('query_inventory', {}, 'tenant-1');
    });

    it('should invalidate product query cache after product sync', async () => {
      const result: SyncWorkerResult = {
        runId: 'run-8',
        status: 'success',
        recordsProcessed: 3,
        recordsCreated: 3,
        recordsUpdated: 0,
        conflicts: [],
        durationMs: 200,
      };

      await pipeline.onSyncComplete('tenant-1', result, 'products');

      expect(mockQueryCache.invalidate).toHaveBeenCalledWith('query_products', {}, 'tenant-1');
    });

    it('should invalidate all caches for unknown data type', async () => {
      const result: SyncWorkerResult = {
        runId: 'run-9',
        status: 'success',
        recordsProcessed: 2,
        recordsCreated: 2,
        recordsUpdated: 0,
        conflicts: [],
        durationMs: 100,
      };

      await pipeline.onSyncComplete('tenant-1', result, 'unknown');

      expect(mockQueryCache.invalidate).toHaveBeenCalledWith('query_orders', {}, 'tenant-1');
      expect(mockQueryCache.invalidate).toHaveBeenCalledWith('query_inventory', {}, 'tenant-1');
      expect(mockQueryCache.invalidate).toHaveBeenCalledWith('query_products', {}, 'tenant-1');
    });
  });

  describe('pipeline configuration', () => {
    it('should skip KPI aggregation when disabled', async () => {
      const customPipeline = new SyncPipeline(
        {
          kpiAggregator: mockKPIAggregator,
          dashboardSSE: mockDashboardSSE,
          mcpQueryCache: mockQueryCache,
        },
        { enableKPIAggregation: false },
      );

      const result: SyncWorkerResult = {
        runId: 'run-10',
        status: 'success',
        recordsProcessed: 10,
        recordsCreated: 10,
        recordsUpdated: 0,
        conflicts: [],
        durationMs: 500,
      };

      await customPipeline.onSyncComplete('tenant-1', result, 'orders');

      expect(mockKPIAggregator.aggregate).not.toHaveBeenCalled();
      // Cache invalidation should still happen
      expect(mockQueryCache.invalidate).toHaveBeenCalled();
    });

    it('should skip cache invalidation when disabled', async () => {
      const customPipeline = new SyncPipeline(
        {
          kpiAggregator: mockKPIAggregator,
          dashboardSSE: mockDashboardSSE,
          mcpQueryCache: mockQueryCache,
        },
        { enableCacheInvalidation: false },
      );

      const result: SyncWorkerResult = {
        runId: 'run-11',
        status: 'success',
        recordsProcessed: 10,
        recordsCreated: 10,
        recordsUpdated: 0,
        conflicts: [],
        durationMs: 500,
      };

      await customPipeline.onSyncComplete('tenant-1', result, 'orders');

      expect(mockQueryCache.invalidate).not.toHaveBeenCalled();
      // KPI aggregation should still happen
      expect(mockKPIAggregator.aggregate).toHaveBeenCalled();
    });

    it('should handle partial sync status (with conflicts) correctly', async () => {
      const result: SyncWorkerResult = {
        runId: 'run-12',
        status: 'partial',
        recordsProcessed: 10,
        recordsCreated: 7,
        recordsUpdated: 3,
        conflicts: [
          { recordId: 'r1', field: 'price', localValue: 10, remoteValue: 12, resolution: 'remote_wins' },
        ],
        durationMs: 800,
      };

      await pipeline.onSyncComplete('tenant-1', result, 'orders');

      // Should still trigger aggregation for partial success
      expect(mockKPIAggregator.aggregate).toHaveBeenCalled();
      expect(mockQueryCache.invalidate).toHaveBeenCalled();
      expect(mockDashboardSSE.broadcastToTenant).toHaveBeenCalled();
    });
  });

  describe('error resilience', () => {
    it('should not throw if KPI aggregation fails', async () => {
      (mockKPIAggregator.aggregate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB connection failed'));

      const result: SyncWorkerResult = {
        runId: 'run-13',
        status: 'success',
        recordsProcessed: 5,
        recordsCreated: 5,
        recordsUpdated: 0,
        conflicts: [],
        durationMs: 200,
      };

      // Should not throw
      await expect(pipeline.onSyncComplete('tenant-1', result, 'orders')).resolves.toBeUndefined();

      // Cache invalidation and SSE should still be attempted
      expect(mockQueryCache.invalidate).toHaveBeenCalled();
      expect(mockDashboardSSE.broadcastToTenant).toHaveBeenCalled();
    });

    it('should not throw if cache invalidation fails', async () => {
      (mockQueryCache.invalidate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Redis unavailable'));

      const result: SyncWorkerResult = {
        runId: 'run-14',
        status: 'success',
        recordsProcessed: 5,
        recordsCreated: 5,
        recordsUpdated: 0,
        conflicts: [],
        durationMs: 200,
      };

      await expect(pipeline.onSyncComplete('tenant-1', result, 'orders')).resolves.toBeUndefined();
    });
  });
});
