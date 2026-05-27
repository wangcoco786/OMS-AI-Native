/**
 * Data Sync Service Module
 *
 * Provides multi-channel data synchronization capabilities:
 * - Bull Queue-based job scheduling with cron expressions
 * - Sync job CRUD operations (sync_jobs and sync_job_runs tables)
 * - Cron expression validation (interval ≥ 5 min, ≤ 24 hours)
 * - Incremental sync worker with cursor-based pagination
 * - Sync adapter interface for pluggable data sources
 * - Exponential backoff retry strategy for failed sync operations
 * - Conflict resolution with channel-data-priority strategy
 */

export { SyncQueueManager } from './queue-manager.js';
export type { SyncJobData, JobStatus } from './queue-manager.js';

export { SyncJobRepository } from './sync-job-repository.js';
export type { SyncJobUpdate, SyncRunUpdate } from './sync-job-repository.js';

export { validateCronExpression } from './cron-validator.js';
export type { CronValidationResult } from './cron-validator.js';

export { SyncWorker } from './sync-worker.js';
export type { SyncWorkerResult } from './sync-worker.js';

export { SyncRetryStrategy, DEFAULT_SYNC_RETRY_CONFIG } from './retry-strategy.js';
export type { SyncRetryConfig, RetryResult } from './retry-strategy.js';

export { ConflictResolver } from './conflict-resolver.js';
export type { ConflictResolutionResult } from './conflict-resolver.js';

export type { SyncAdapter, SyncAdapterRegistry, SyncRecord, SyncFetchResult } from './sync-adapter.js';

export { ShopifyAdapter, WmsAdapter, ErpAdapter, DefaultAdapterRegistry } from './adapters/index.js';
export type { ShopifyAdapterConfig, WmsAdapterConfig, ErpAdapterConfig } from './adapters/index.js';

export { SyncPipeline } from './sync-pipeline.js';
export type { SyncPipelineDeps, SyncPipelineConfig } from './sync-pipeline.js';

export { bootstrapDataSyncPipeline } from './data-sync-bootstrap.js';
export type { DataSyncBootstrapDeps, DataSyncBootstrapResult } from './data-sync-bootstrap.js';

export { createSyncRouter } from './routes.js';
export type { SyncRouterDeps } from './routes.js';
