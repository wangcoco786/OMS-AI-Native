/**
 * Data Sync REST API Routes
 *
 * Provides sync job management endpoints:
 * - POST   /api/v1/sync-jobs          — Create a new sync job
 * - GET    /api/v1/sync-jobs          — List sync jobs for the authenticated tenant
 * - GET    /api/v1/sync-jobs/:id      — Get a single sync job
 * - PUT    /api/v1/sync-jobs/:id      — Update a sync job
 * - DELETE /api/v1/sync-jobs/:id      — Delete a sync job
 * - POST   /api/v1/sync-jobs/:id/trigger — Manually trigger a sync job
 * - GET    /api/v1/sync-jobs/:id/history — Get sync run history
 * - GET    /api/v1/sync/stats         — Get sync statistics for the tenant
 *
 * All endpoints require authentication (req.user must be set by auth middleware).
 * Data is isolated by tenant.
 */

import { Router } from 'express';
import type { Response } from 'express';
import pino from 'pino';

import type { AuthenticatedRequest } from '../auth/middleware.js';
import type { TracedRequest } from '../observability/trace-id.js';
import type { SyncJobRepository } from './sync-job-repository.js';
import type { SyncQueueManager } from './queue-manager.js';
import type { SyncWorker } from './sync-worker.js';
import type { SyncPipeline } from './sync-pipeline.js';
import { validateCronExpression } from './cron-validator.js';
import type { SyncSource, SyncDataType } from '../../shared/m2-types.js';

const logger = pino({ name: 'routes-sync' });

/** Combined request type with auth and trace */
type AppRequest = AuthenticatedRequest & TracedRequest;

/** Extract a route param as a string */
function getParam(req: AppRequest, name: string): string {
  const value = req.params[name];
  return typeof value === 'string' ? value : String(value);
}

/** Dependencies for the sync router */
export interface SyncRouterDeps {
  repository: SyncJobRepository;
  queueManager: SyncQueueManager;
  worker: SyncWorker;
  /** Optional sync pipeline for triggering downstream data flow (KPI aggregation, SSE, cache invalidation) */
  pipeline?: SyncPipeline;
}

/** Structured error response */
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    traceId: string;
    timestamp: string;
  };
}

/** Valid sync sources */
const VALID_SOURCES: SyncSource[] = ['shopify', 'wms', 'erp'];

/** Valid sync data types */
const VALID_DATA_TYPES: SyncDataType[] = ['orders', 'inventory', 'products'];

/**
 * Create the sync router.
 * Accepts dependencies for database, queue, and worker operations.
 */
export function createSyncRouter(deps: SyncRouterDeps): Router {
  const { repository, queueManager, worker, pipeline } = deps;
  const router = Router();

  // ─── POST /api/v1/sync-jobs — Create a new sync job ───────────────────────

  router.post('/sync-jobs', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      const { source, dataType, cronExpression, enabled, config } = req.body as {
        source?: string;
        dataType?: string;
        cronExpression?: string;
        enabled?: boolean;
        config?: Record<string, unknown>;
      };

      // Validate required fields
      if (!source || !dataType || !cronExpression) {
        sendError(res, 400, 'VALIDATION_ERROR', 'source, dataType, and cronExpression are required', req.traceId);
        return;
      }

      // Validate source
      if (!VALID_SOURCES.includes(source as SyncSource)) {
        sendError(res, 400, 'VALIDATION_ERROR', `Invalid source: "${source}". Must be one of: ${VALID_SOURCES.join(', ')}`, req.traceId);
        return;
      }

      // Validate dataType
      if (!VALID_DATA_TYPES.includes(dataType as SyncDataType)) {
        sendError(res, 400, 'VALIDATION_ERROR', `Invalid dataType: "${dataType}". Must be one of: ${VALID_DATA_TYPES.join(', ')}`, req.traceId);
        return;
      }

      // Validate cron expression
      const cronValidation = validateCronExpression(cronExpression);
      if (!cronValidation.valid) {
        sendError(res, 400, 'INVALID_CRON', cronValidation.error ?? 'Invalid cron expression', req.traceId);
        return;
      }

      // Create the job in the database
      const jobConfig = await repository.create({
        tenantId,
        source: source as SyncSource,
        dataType: dataType as SyncDataType,
        cronExpression,
        enabled: enabled ?? true,
        config: config ?? {},
      });

      // Schedule in the queue if enabled
      if (jobConfig.enabled) {
        await queueManager.scheduleJob(jobConfig);
      }

      res.status(201).json({ job: jobConfig });
    } catch (error) {
      logger.error({ error, traceId: req.traceId }, 'Failed to create sync job');
      sendError(res, 500, 'SYNC_JOB_CREATE_FAILED', 'Failed to create sync job', req.traceId);
    }
  });

  // ─── GET /api/v1/sync-jobs — List sync jobs for the tenant ────────────────

  router.get('/sync-jobs', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      const jobs = await repository.findByTenant(tenantId);

      res.json({ jobs, total: jobs.length });
    } catch (error) {
      logger.error({ error, traceId: req.traceId }, 'Failed to list sync jobs');
      sendError(res, 500, 'SYNC_JOB_LIST_FAILED', 'Failed to list sync jobs', req.traceId);
    }
  });

  // ─── GET /api/v1/sync-jobs/:id — Get a single sync job ────────────────────

  router.get('/sync-jobs/:id', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      const jobId = getParam(req, 'id');
      const job = await repository.findById(jobId, tenantId);
      if (!job) {
        sendError(res, 404, 'SYNC_JOB_NOT_FOUND', `Sync job not found: ${jobId}`, req.traceId);
        return;
      }

      res.json({ job });
    } catch (error) {
      logger.error({ error, traceId: req.traceId }, 'Failed to get sync job');
      sendError(res, 500, 'SYNC_JOB_GET_FAILED', 'Failed to get sync job', req.traceId);
    }
  });

  // ─── PUT /api/v1/sync-jobs/:id — Update a sync job ────────────────────────

  router.put('/sync-jobs/:id', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      const { source, dataType, cronExpression, enabled, config } = req.body as {
        source?: string;
        dataType?: string;
        cronExpression?: string;
        enabled?: boolean;
        config?: Record<string, unknown>;
      };

      // Validate source if provided
      if (source !== undefined && !VALID_SOURCES.includes(source as SyncSource)) {
        sendError(res, 400, 'VALIDATION_ERROR', `Invalid source: "${source}". Must be one of: ${VALID_SOURCES.join(', ')}`, req.traceId);
        return;
      }

      // Validate dataType if provided
      if (dataType !== undefined && !VALID_DATA_TYPES.includes(dataType as SyncDataType)) {
        sendError(res, 400, 'VALIDATION_ERROR', `Invalid dataType: "${dataType}". Must be one of: ${VALID_DATA_TYPES.join(', ')}`, req.traceId);
        return;
      }

      // Validate cron expression if changed
      if (cronExpression !== undefined) {
        const cronValidation = validateCronExpression(cronExpression);
        if (!cronValidation.valid) {
          sendError(res, 400, 'INVALID_CRON', cronValidation.error ?? 'Invalid cron expression', req.traceId);
          return;
        }
      }

      // Build update object
      const updates: Record<string, unknown> = {};
      if (source !== undefined) updates.source = source;
      if (dataType !== undefined) updates.dataType = dataType;
      if (cronExpression !== undefined) updates.cronExpression = cronExpression;
      if (enabled !== undefined) updates.enabled = enabled;
      if (config !== undefined) updates.config = config;

      const jobId = getParam(req, 'id');
      const updatedJob = await repository.update(jobId, tenantId, updates);
      if (!updatedJob) {
        sendError(res, 404, 'SYNC_JOB_NOT_FOUND', `Sync job not found: ${jobId}`, req.traceId);
        return;
      }

      // Reschedule in the queue: remove old schedule and add new one if enabled
      await queueManager.removeJob(updatedJob.id);
      if (updatedJob.enabled) {
        await queueManager.scheduleJob(updatedJob);
      }

      res.json({ job: updatedJob });
    } catch (error) {
      logger.error({ error, traceId: req.traceId }, 'Failed to update sync job');
      sendError(res, 500, 'SYNC_JOB_UPDATE_FAILED', 'Failed to update sync job', req.traceId);
    }
  });

  // ─── DELETE /api/v1/sync-jobs/:id — Delete a sync job ─────────────────────

  router.delete('/sync-jobs/:id', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      // Remove from queue first
      const jobId = getParam(req, 'id');
      await queueManager.removeJob(jobId);

      // Delete from database
      const deleted = await repository.delete(jobId, tenantId);
      if (!deleted) {
        sendError(res, 404, 'SYNC_JOB_NOT_FOUND', `Sync job not found: ${jobId}`, req.traceId);
        return;
      }

      res.status(204).send();
    } catch (error) {
      logger.error({ error, traceId: req.traceId }, 'Failed to delete sync job');
      sendError(res, 500, 'SYNC_JOB_DELETE_FAILED', 'Failed to delete sync job', req.traceId);
    }
  });

  // ─── POST /api/v1/sync-jobs/:id/trigger — Manually trigger a sync job ─────

  router.post('/sync-jobs/:id/trigger', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      const jobId = getParam(req, 'id');
      const job = await repository.findById(jobId, tenantId);
      if (!job) {
        sendError(res, 404, 'SYNC_JOB_NOT_FOUND', `Sync job not found: ${jobId}`, req.traceId);
        return;
      }

      // Execute the sync job immediately via the worker
      const result = await worker.processJob({
        jobId: job.id,
        tenantId: job.tenantId,
        source: job.source,
        dataType: job.dataType,
        config: job.config,
      });

      // Trigger downstream pipeline (KPI aggregation, SSE push, MCP cache invalidation)
      if (pipeline) {
        await pipeline.onSyncComplete(job.tenantId, result, job.dataType);
      }

      res.json({ result });
    } catch (error) {
      logger.error({ error, traceId: req.traceId }, 'Failed to trigger sync job');
      sendError(res, 500, 'SYNC_JOB_TRIGGER_FAILED', 'Failed to trigger sync job', req.traceId);
    }
  });

  // ─── GET /api/v1/sync-jobs/:id/history — Get sync run history ─────────────

  router.get('/sync-jobs/:id/history', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      // Verify the job exists and belongs to this tenant
      const jobId = getParam(req, 'id');
      const job = await repository.findById(jobId, tenantId);
      if (!job) {
        sendError(res, 404, 'SYNC_JOB_NOT_FOUND', `Sync job not found: ${jobId}`, req.traceId);
        return;
      }

      const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 20;
      const history = await repository.getRunHistory(jobId, tenantId, limit);

      res.json({ history, total: history.length });
    } catch (error) {
      logger.error({ error, traceId: req.traceId }, 'Failed to get sync job history');
      sendError(res, 500, 'SYNC_JOB_HISTORY_FAILED', 'Failed to get sync job history', req.traceId);
    }
  });

  // ─── GET /api/v1/sync/stats — Get sync statistics for the tenant ──────────

  router.get('/sync/stats', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      // Get all jobs for the tenant
      const jobs = await repository.findByTenant(tenantId);

      const totalJobs = jobs.length;
      const activeJobs = jobs.filter((j) => j.enabled).length;

      // Gather recent run history across all jobs to compute stats
      let totalRuns = 0;
      let failedRuns = 0;
      let totalDuration = 0;
      let durationCount = 0;

      for (const job of jobs) {
        const runs = await repository.getRunHistory(job.id, tenantId, 50);
        for (const run of runs) {
          totalRuns++;
          if (run.status === 'failed') failedRuns++;
          if (run.duration > 0) {
            totalDuration += run.duration;
            durationCount++;
          }
        }
      }

      // Approximate lastHourSyncs from the most recent runs
      // Since SyncJobResult doesn't expose started_at, we use the most recent entries
      let lastHourSyncs = 0;
      for (const job of jobs) {
        const recentRuns = await repository.getRunHistory(job.id, tenantId, 10);
        lastHourSyncs += recentRuns.filter((r) => r.status !== 'failed').length;
      }

      const stats = {
        totalJobs,
        activeJobs,
        lastHourSyncs: Math.min(lastHourSyncs, totalRuns),
        failureRate: totalRuns > 0 ? failedRuns / totalRuns : 0,
        avgDuration: durationCount > 0 ? Math.round(totalDuration / durationCount) : 0,
      };

      res.json({ stats });
    } catch (error) {
      logger.error({ error, traceId: req.traceId }, 'Failed to get sync stats');
      sendError(res, 500, 'SYNC_STATS_FAILED', 'Failed to get sync statistics', req.traceId);
    }
  });

  return router;
}

// ─── Helper ─────────────────────────────────────────────────────────────────

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  traceId?: string,
): void {
  const response: ErrorResponse = {
    error: {
      code,
      message,
      traceId: traceId ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };
  res.status(status).json(response);
}
