/**
 * Sync Worker
 *
 * Processes data synchronization jobs from the Bull Queue.
 * Implements incremental sync logic:
 * 1. Receives a job from Bull Queue
 * 2. Looks up the SyncJobConfig from the repository (to get lastSyncCursor)
 * 3. Calls the appropriate sync adapter (paginated fetch until hasMore is false)
 * 4. Processes the returned records (counts creates and updates)
 * 5. Updates lastSyncCursor to the latest record timestamp
 * 6. Records the run result in sync_job_runs
 */

import pino from 'pino';

import type { ConflictRecord } from '../../shared/m2-types.js';
import type { SyncJobData } from './queue-manager.js';
import type { SyncJobRepository, SyncRunUpdate } from './sync-job-repository.js';
import type { SyncAdapter, SyncAdapterRegistry, SyncRecord } from './sync-adapter.js';
import { SyncRetryStrategy, DEFAULT_SYNC_RETRY_CONFIG } from './retry-strategy.js';
import type { SyncRetryConfig } from './retry-strategy.js';
import { ConflictResolver } from './conflict-resolver.js';

const defaultLogger = pino({ name: 'sync-worker' });

/** Result of processing a sync job */
export interface SyncWorkerResult {
  runId: string;
  status: 'success' | 'partial' | 'failed';
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  conflicts: ConflictRecord[];
  durationMs: number;
  error?: string;
}

/**
 * SyncWorker processes sync jobs from the Bull Queue.
 * It coordinates between the adapter registry and the job repository
 * to perform incremental data synchronization.
 */
export class SyncWorker {
  private readonly repository: SyncJobRepository;
  private readonly adapterRegistry: SyncAdapterRegistry;
  private readonly retryStrategy: SyncRetryStrategy;
  private readonly conflictResolver: ConflictResolver;
  private readonly logger: pino.Logger;

  constructor(
    repository: SyncJobRepository,
    adapterRegistry: SyncAdapterRegistry,
    parentLogger?: pino.Logger,
    options?: { retryConfig?: SyncRetryConfig; retryStrategy?: SyncRetryStrategy },
  ) {
    this.repository = repository;
    this.adapterRegistry = adapterRegistry;
    this.logger = (parentLogger ?? defaultLogger).child({ component: 'sync-worker' });
    this.retryStrategy = options?.retryStrategy ??
      new SyncRetryStrategy(options?.retryConfig ?? DEFAULT_SYNC_RETRY_CONFIG, this.logger);
    this.conflictResolver = new ConflictResolver(this.logger);
  }

  /**
   * Process a sync job. This is the main entry point called by the Bull Queue processor.
   *
   * @param jobData - The job data from the Bull Queue
   * @param localRecords - Optional map of local records for conflict resolution (keyed by record ID)
   * @returns The result of the sync operation
   */
  async processJob(
    jobData: SyncJobData,
    localRecords?: Record<string, Record<string, unknown>>,
  ): Promise<SyncWorkerResult> {
    const startTime = Date.now();
    const { jobId, tenantId, source } = jobData;

    this.logger.info({ jobId, tenantId, source }, 'Starting sync job processing');

    // Create a run record
    let runId: string;
    try {
      runId = await this.repository.createRun(jobId, tenantId);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error({ jobId, error }, 'Failed to create run record');
      return {
        runId: '',
        status: 'failed',
        recordsProcessed: 0,
        recordsCreated: 0,
        recordsUpdated: 0,
        conflicts: [],
        durationMs: Date.now() - startTime,
        error: `Failed to create run record: ${error}`,
      };
    }

    try {
      // Look up the job config to get lastSyncCursor
      const jobConfig = await this.repository.findById(jobId, tenantId);
      if (!jobConfig) {
        throw new Error(`Sync job not found: ${jobId}`);
      }

      // Get the appropriate adapter
      const adapter = this.adapterRegistry.getAdapter(source);
      if (!adapter) {
        throw new Error(`No adapter found for source: ${source}`);
      }

      // Perform incremental sync with pagination and retry
      const result = await this.retryStrategy.executeWithRetry(() =>
        this.fetchAllRecords(adapter, jobData.config, jobConfig.lastSyncCursor),
      );

      // Filter records: only include those with updatedAt > lastSyncCursor
      const filteredRecords = this.filterByCursor(result.records, jobConfig.lastSyncCursor);

      // Resolve conflicts for update records using channel-priority strategy
      const allConflicts: ConflictRecord[] = [];
      for (const record of filteredRecords) {
        if (record.action === 'update' && localRecords) {
          const localRecord = localRecords[record.id];
          if (localRecord) {
            const { conflicts } = this.conflictResolver.resolve(
              localRecord,
              record.data,
              record.id,
            );
            allConflicts.push(...conflicts);
          }
        }
      }

      // Count creates and updates
      const recordsCreated = filteredRecords.filter((r) => r.action === 'create').length;
      const recordsUpdated = filteredRecords.filter((r) => r.action === 'update' || r.action === 'delete').length;
      const recordsProcessed = filteredRecords.length;

      // Determine the new cursor (latest updatedAt timestamp)
      const newCursor = this.determineNewCursor(filteredRecords, jobConfig.lastSyncCursor);

      // Update lastSyncCursor on the job config
      if (newCursor && newCursor !== jobConfig.lastSyncCursor) {
        await this.repository.update(jobId, tenantId, {
          lastSyncCursor: newCursor,
          lastSyncAt: new Date(),
        });
      }

      const durationMs = Date.now() - startTime;
      const status = allConflicts.length > 0 ? 'partial' : 'success';

      // Record the run result
      const runUpdate: SyncRunUpdate = {
        status,
        recordsProcessed,
        recordsCreated,
        recordsUpdated,
        conflicts: allConflicts,
        durationMs,
      };
      await this.repository.updateRun(runId, runUpdate);

      this.logger.info(
        { jobId, runId, recordsProcessed, recordsCreated, recordsUpdated, conflicts: allConflicts.length, durationMs },
        'Sync job completed successfully',
      );

      return {
        runId,
        status,
        recordsProcessed,
        recordsCreated,
        recordsUpdated,
        conflicts: allConflicts,
        durationMs,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - startTime;

      this.logger.error({ jobId, runId, error, durationMs }, 'Sync job failed');

      // Record the failure
      const runUpdate: SyncRunUpdate = {
        status: 'failed',
        recordsProcessed: 0,
        recordsCreated: 0,
        recordsUpdated: 0,
        conflicts: [],
        durationMs,
        errorMessage: error,
      };
      await this.repository.updateRun(runId, runUpdate);

      return {
        runId,
        status: 'failed',
        recordsProcessed: 0,
        recordsCreated: 0,
        recordsUpdated: 0,
        conflicts: [],
        durationMs,
        error,
      };
    }
  }

  /**
   * Fetch all records from the adapter using pagination.
   * Continues fetching until hasMore is false.
   */
  private async fetchAllRecords(
    adapter: SyncAdapter,
    config: Record<string, unknown>,
    cursor?: string,
  ): Promise<{ records: SyncRecord[]; lastCursor: string }> {
    const allRecords: SyncRecord[] = [];
    let currentCursor = cursor;
    let lastCursor = cursor ?? '';

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await adapter.fetchRecords(config, currentCursor);
      allRecords.push(...result.records);
      lastCursor = result.nextCursor;

      if (!result.hasMore) {
        break;
      }

      currentCursor = result.nextCursor;
    }

    return { records: allRecords, lastCursor };
  }

  /**
   * Filter records to only include those with updatedAt > lastSyncCursor.
   * If no cursor exists, all records are included.
   */
  private filterByCursor(records: SyncRecord[], lastSyncCursor?: string): SyncRecord[] {
    if (!lastSyncCursor) {
      return records;
    }

    return records.filter((record) => record.updatedAt > lastSyncCursor);
  }

  /**
   * Determine the new cursor value from the processed records.
   * The cursor is the latest updatedAt timestamp among all records.
   * If no records were processed, returns the existing cursor.
   */
  private determineNewCursor(records: SyncRecord[], existingCursor?: string): string | undefined {
    if (records.length === 0) {
      return existingCursor;
    }

    const latestTimestamp = records.reduce((latest, record) => {
      return record.updatedAt > latest ? record.updatedAt : latest;
    }, records[0].updatedAt);

    return latestTimestamp;
  }
}
