/**
 * Data Sync Bootstrap
 *
 * Wires together the Data Sync → Dashboard → MCP Tools data pipeline:
 * 1. Registers the Bull Queue processor that invokes SyncWorker
 * 2. After each sync job completes, triggers SyncPipeline.onSyncComplete()
 * 3. SyncPipeline triggers KPI Aggregator → SSE push → MCP cache invalidation
 *
 * This module is the integration glue between:
 * - Data Sync: sync-worker writes data to DB
 * - Dashboard: kpi-aggregator re-aggregates, dashboard-sse pushes updates
 * - MCP Tools: query-cache is invalidated so agents get fresh data
 *
 * Requirements: 5.1, 9.1, 10.1
 */

import pino from 'pino';

import type { SyncQueueManager, SyncJobData } from './queue-manager.js';
import type { SyncWorker } from './sync-worker.js';
import { SyncPipeline } from './sync-pipeline.js';
import type { SyncPipelineDeps, SyncPipelineConfig } from './sync-pipeline.js';
import type { KPIAggregator } from '../dashboard/kpi-aggregator.js';
import type { DashboardSSE } from '../dashboard/dashboard-sse.js';
import type { QueryCache } from '../mcp-tools/query-cache.js';

const defaultLogger = pino({ name: 'data-sync-bootstrap' });

/** Dependencies for bootstrapping the data sync pipeline */
export interface DataSyncBootstrapDeps {
  /** The queue manager (must be initialized with Redis before calling bootstrap) */
  queueManager: SyncQueueManager;
  /** The sync worker that processes individual sync jobs */
  worker: SyncWorker;
  /** KPI Aggregator from the Dashboard module */
  kpiAggregator: KPIAggregator;
  /** Dashboard SSE service for real-time push */
  dashboardSSE: DashboardSSE;
  /** MCP query cache for invalidation after sync */
  mcpQueryCache: QueryCache;
  /** Optional logger */
  logger?: pino.Logger;
  /** Optional pipeline configuration */
  pipelineConfig?: SyncPipelineConfig;
}

/** Result of bootstrapping the data sync pipeline */
export interface DataSyncBootstrapResult {
  /** The instantiated SyncPipeline (can be passed to routes) */
  pipeline: SyncPipeline;
}

/**
 * Bootstrap the Data Sync pipeline by:
 * 1. Creating a SyncPipeline instance that wires KPI Aggregator → SSE → Cache
 * 2. Registering a Bull Queue processor that calls SyncWorker and then SyncPipeline
 *
 * After calling this function:
 * - Scheduled sync jobs will automatically trigger the full pipeline
 * - Manual triggers via the API route (with pipeline dep) also trigger the pipeline
 * - KPI data is re-aggregated after order syncs
 * - Dashboard clients receive real-time SSE updates
 * - MCP tool queries return fresh data (cache invalidated)
 */
export function bootstrapDataSyncPipeline(deps: DataSyncBootstrapDeps): DataSyncBootstrapResult {
  const logger = (deps.logger ?? defaultLogger).child({ component: 'data-sync-bootstrap' });

  // 1. Create the SyncPipeline that wires KPI Aggregator → SSE → Cache
  const pipelineDeps: SyncPipelineDeps = {
    kpiAggregator: deps.kpiAggregator,
    dashboardSSE: deps.dashboardSSE,
    mcpQueryCache: deps.mcpQueryCache,
    logger: deps.logger,
  };

  const pipeline = new SyncPipeline(pipelineDeps, deps.pipelineConfig);
  logger.info('SyncPipeline created and wired (KPI Aggregator → SSE, Cache invalidation)');

  // 2. Register the Bull Queue processor
  const queue = deps.queueManager.getQueue();
  if (queue) {
    queue.process(async (job) => {
      const jobData: SyncJobData = job.data;

      logger.info({ jobId: jobData.jobId, tenantId: jobData.tenantId, dataType: jobData.dataType }, 'Processing scheduled sync job');

      // Execute the sync worker
      const result = await deps.worker.processJob(jobData);

      // Trigger the downstream pipeline (aggregation, SSE, cache invalidation)
      await pipeline.onSyncComplete(jobData.tenantId, result, jobData.dataType);

      logger.info(
        { jobId: jobData.jobId, status: result.status, recordsProcessed: result.recordsProcessed },
        'Sync job and pipeline processing complete',
      );

      return result;
    });

    logger.info('Bull Queue processor registered with pipeline integration');
  } else {
    logger.warn('Queue not initialized — processor not registered. Call queueManager.initialize() first.');
  }

  return { pipeline };
}
