/**
 * Sync Job Repository
 *
 * CRUD operations for sync_jobs and sync_job_runs tables.
 * Uses PostgresDatabaseService for database access with tenant isolation.
 */

import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';

import type { PostgresDatabaseService } from '../../infrastructure/database/database-service.js';
import type { Transaction } from '../../infrastructure/database/types.js';
import type { SyncJobConfig, SyncJobResult, SyncSource, SyncDataType } from '../../shared/m2-types.js';

const logger = pino({ name: 'sync-job-repository' });

/** Database row representation of a sync job */
interface SyncJobRow {
  id: string;
  tenant_id: string;
  source: SyncSource;
  data_type: SyncDataType;
  cron_expression: string;
  enabled: boolean;
  config: Record<string, unknown>;
  last_sync_at: Date | null;
  last_sync_cursor: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Database row representation of a sync job run */
interface SyncJobRunRow {
  id: string;
  job_id: string;
  tenant_id: string;
  status: string;
  records_processed: number;
  records_created: number;
  records_updated: number;
  conflicts: unknown[];
  duration_ms: number | null;
  error_message: string | null;
  retry_count: number;
  started_at: Date;
  completed_at: Date | null;
}

/** Fields that can be updated on a sync job */
export interface SyncJobUpdate {
  source?: SyncSource;
  dataType?: SyncDataType;
  cronExpression?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  lastSyncAt?: Date;
  lastSyncCursor?: string;
}

/** Run result data for updating a sync job run */
export interface SyncRunUpdate {
  status: 'success' | 'partial' | 'failed';
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  conflicts: unknown[];
  durationMs: number;
  errorMessage?: string;
  retryCount?: number;
}

/**
 * SyncJobRepository provides CRUD operations for sync_jobs and sync_job_runs tables.
 */
export class SyncJobRepository {
  private readonly db: PostgresDatabaseService;
  private readonly logger: pino.Logger;

  constructor(db: PostgresDatabaseService, parentLogger?: pino.Logger) {
    this.db = db;
    this.logger = (parentLogger ?? logger).child({ component: 'sync-job-repository' });
  }

  // --- sync_jobs CRUD ---

  /**
   * Create a new sync job.
   */
  async create(config: Omit<SyncJobConfig, 'id'>): Promise<SyncJobConfig> {
    const id = uuidv4();
    const now = new Date();

    const result = await this.db.transaction<SyncJobConfig>(async (tx: Transaction) => {
      const rows = await tx.query<SyncJobRow>(
        `INSERT INTO sync_jobs (id, tenant_id, source, data_type, cron_expression, enabled, config, last_sync_at, last_sync_cursor, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          id,
          config.tenantId,
          config.source,
          config.dataType,
          config.cronExpression,
          config.enabled,
          JSON.stringify(config.config),
          config.lastSyncAt ?? null,
          config.lastSyncCursor ?? null,
          now,
          now,
        ],
      );

      return this.mapRowToConfig(rows[0]);
    });

    this.logger.info({ jobId: id, tenantId: config.tenantId }, 'Sync job created');
    return result;
  }

  /**
   * Update an existing sync job.
   */
  async update(jobId: string, tenantId: string, updates: SyncJobUpdate): Promise<SyncJobConfig | null> {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (updates.source !== undefined) {
      setClauses.push(`source = $${paramIndex++}`);
      params.push(updates.source);
    }
    if (updates.dataType !== undefined) {
      setClauses.push(`data_type = $${paramIndex++}`);
      params.push(updates.dataType);
    }
    if (updates.cronExpression !== undefined) {
      setClauses.push(`cron_expression = $${paramIndex++}`);
      params.push(updates.cronExpression);
    }
    if (updates.enabled !== undefined) {
      setClauses.push(`enabled = $${paramIndex++}`);
      params.push(updates.enabled);
    }
    if (updates.config !== undefined) {
      setClauses.push(`config = $${paramIndex++}`);
      params.push(JSON.stringify(updates.config));
    }
    if (updates.lastSyncAt !== undefined) {
      setClauses.push(`last_sync_at = $${paramIndex++}`);
      params.push(updates.lastSyncAt);
    }
    if (updates.lastSyncCursor !== undefined) {
      setClauses.push(`last_sync_cursor = $${paramIndex++}`);
      params.push(updates.lastSyncCursor);
    }

    if (setClauses.length === 0) {
      return this.findById(jobId, tenantId);
    }

    setClauses.push(`updated_at = $${paramIndex++}`);
    params.push(new Date());

    params.push(jobId);
    const jobIdParam = paramIndex++;

    const sql = `UPDATE sync_jobs SET ${setClauses.join(', ')} WHERE id = $${jobIdParam - 1} AND tenant_id = $${jobIdParam} RETURNING *`;
    params.push(tenantId);

    const result = await this.db.transaction<SyncJobConfig | null>(async (tx: Transaction) => {
      const rows = await tx.query<SyncJobRow>(sql, params);
      if (rows.length === 0) return null;
      return this.mapRowToConfig(rows[0]);
    });

    if (result) {
      this.logger.info({ jobId, tenantId }, 'Sync job updated');
    }

    return result;
  }

  /**
   * Delete a sync job.
   */
  async delete(jobId: string, tenantId: string): Promise<boolean> {
    const result = await this.db.transaction<boolean>(async (tx: Transaction) => {
      const rows = await tx.query<{ id: string }>(
        'DELETE FROM sync_jobs WHERE id = $1 AND tenant_id = $2 RETURNING id',
        [jobId, tenantId],
      );
      return rows.length > 0;
    });

    if (result) {
      this.logger.info({ jobId, tenantId }, 'Sync job deleted');
    }

    return result;
  }

  /**
   * Find all sync jobs for a tenant.
   */
  async findByTenant(tenantId: string): Promise<SyncJobConfig[]> {
    const rows = await this.db.query<SyncJobRow>(
      'SELECT * FROM sync_jobs ORDER BY created_at DESC',
      [],
      tenantId,
    );

    return rows.map((row) => this.mapRowToConfig(row));
  }

  /**
   * Find a single sync job by ID.
   */
  async findById(jobId: string, tenantId: string): Promise<SyncJobConfig | null> {
    const rows = await this.db.query<SyncJobRow>(
      'SELECT * FROM sync_jobs WHERE id = $1',
      [jobId],
      tenantId,
    );

    if (rows.length === 0) return null;
    return this.mapRowToConfig(rows[0]);
  }

  // --- sync_job_runs CRUD ---

  /**
   * Create a new sync job run record.
   */
  async createRun(jobId: string, tenantId: string): Promise<string> {
    const id = uuidv4();
    const now = new Date();

    await this.db.transaction(async (tx: Transaction) => {
      await tx.query(
        `INSERT INTO sync_job_runs (id, job_id, tenant_id, status, started_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, jobId, tenantId, 'running', now],
      );
    });

    this.logger.info({ runId: id, jobId, tenantId }, 'Sync job run created');
    return id;
  }

  /**
   * Update a sync job run with results.
   */
  async updateRun(runId: string, result: SyncRunUpdate): Promise<void> {
    await this.db.transaction(async (tx: Transaction) => {
      await tx.query(
        `UPDATE sync_job_runs
         SET status = $1, records_processed = $2, records_created = $3,
             records_updated = $4, conflicts = $5, duration_ms = $6,
             error_message = $7, retry_count = $8, completed_at = $9
         WHERE id = $10`,
        [
          result.status,
          result.recordsProcessed,
          result.recordsCreated,
          result.recordsUpdated,
          JSON.stringify(result.conflicts),
          result.durationMs,
          result.errorMessage ?? null,
          result.retryCount ?? 0,
          new Date(),
          runId,
        ],
      );
    });

    this.logger.info({ runId, status: result.status }, 'Sync job run updated');
  }

  /**
   * Get run history for a specific job.
   */
  async getRunHistory(jobId: string, tenantId: string, limit: number = 20): Promise<SyncJobResult[]> {
    const rows = await this.db.query<SyncJobRunRow>(
      'SELECT * FROM sync_job_runs WHERE job_id = $1 ORDER BY started_at DESC LIMIT $2',
      [jobId, limit],
      tenantId,
    );

    return rows.map((row) => this.mapRunRowToResult(row));
  }

  // --- Private Helpers ---

  private mapRowToConfig(row: SyncJobRow): SyncJobConfig {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      source: row.source,
      dataType: row.data_type,
      cronExpression: row.cron_expression,
      enabled: row.enabled,
      config: typeof row.config === 'string' ? JSON.parse(row.config as unknown as string) : row.config,
      lastSyncAt: row.last_sync_at ?? undefined,
      lastSyncCursor: row.last_sync_cursor ?? undefined,
    };
  }

  private mapRunRowToResult(row: SyncJobRunRow): SyncJobResult {
    return {
      jobId: row.job_id,
      status: row.status as 'success' | 'partial' | 'failed',
      recordsProcessed: row.records_processed,
      recordsCreated: row.records_created,
      recordsUpdated: row.records_updated,
      conflicts: Array.isArray(row.conflicts)
        ? row.conflicts as SyncJobResult['conflicts']
        : JSON.parse(row.conflicts as unknown as string),
      duration: row.duration_ms ?? 0,
      error: row.error_message ?? undefined,
    };
  }
}
