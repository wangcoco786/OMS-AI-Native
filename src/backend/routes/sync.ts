/**
 * Sync Job Routes
 *
 * Provides endpoints for the Data Sync Service:
 * - POST   /api/sync-jobs             - Create a new sync job
 * - GET    /api/sync-jobs             - List sync jobs for the tenant
 * - GET    /api/sync-jobs/:id         - Get a specific sync job
 * - PUT    /api/sync-jobs/:id         - Update a sync job
 * - DELETE /api/sync-jobs/:id         - Delete a sync job
 * - POST   /api/sync-jobs/:id/trigger - Manually trigger a sync job
 * - GET    /api/sync-jobs/:id/history - Get sync job run history
 * - GET    /api/sync-jobs/stats       - Get sync statistics
 *
 * Requires authentication (req.user must be set by auth middleware).
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7
 */

import { Router } from 'express';
import type { Response } from 'express';
import pino from 'pino';

import type { AuthenticatedRequest } from '../auth/middleware.js';
import type { TracedRequest } from '../observability/trace-id.js';

const logger = pino({ name: 'routes-sync' });

/** Combined request type with auth and trace */
type AppRequest = AuthenticatedRequest & TracedRequest;

/**
 * Create the sync jobs router.
 * Dependencies will be injected when the service layer is implemented.
 */
export function createSyncRouter(): Router {
  const router = Router();

  /**
   * POST /api/sync-jobs
   * Create a new sync job configuration.
   * Body: { source, dataType, cronExpression, config }
   */
  router.post('/', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      const { source, dataType, cronExpression, config } = req.body as {
        source?: string;
        dataType?: string;
        cronExpression?: string;
        config?: Record<string, unknown>;
      };

      if (!source || !dataType || !cronExpression) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'source, dataType, and cronExpression are required',
            traceId: req.traceId ?? 'unknown',
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      // TODO: Integrate with DataSyncService when implemented
      res.status(201).json({
        job: {
          id: crypto.randomUUID(),
          tenantId,
          source,
          dataType,
          cronExpression,
          enabled: true,
          config: config ?? {},
          createdAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to create sync job');
      res.status(500).json({
        error: {
          code: 'SYNC_JOB_CREATE_FAILED',
          message: 'Failed to create sync job',
          traceId: (req as AppRequest).traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  /**
   * GET /api/sync-jobs
   * List all sync jobs for the authenticated tenant.
   */
  router.get('/', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;

      // TODO: Integrate with DataSyncService when implemented
      res.json({
        tenantId,
        jobs: [],
        total: 0,
      });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to list sync jobs');
      res.status(500).json({
        error: {
          code: 'SYNC_JOB_LIST_FAILED',
          message: 'Failed to list sync jobs',
          traceId: (req as AppRequest).traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  /**
   * GET /api/sync-jobs/stats
   * Get sync statistics for the authenticated tenant.
   * Note: This must be defined before /:id to avoid route conflicts.
   */
  router.get('/stats', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;

      // TODO: Integrate with DataSyncService when implemented
      res.json({
        tenantId,
        stats: {
          totalJobs: 0,
          activeJobs: 0,
          lastHourSyncs: 0,
          failureRate: 0,
          avgDuration: 0,
        },
      });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to get sync stats');
      res.status(500).json({
        error: {
          code: 'SYNC_STATS_FAILED',
          message: 'Failed to get sync statistics',
          traceId: (req as AppRequest).traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  /**
   * GET /api/sync-jobs/:id
   * Get a specific sync job by ID.
   */
  router.get('/:id', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      // TODO: Integrate with DataSyncService when implemented
      res.json({
        job: {
          id,
          source: null,
          dataType: null,
          cronExpression: null,
          enabled: false,
        },
      });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to get sync job');
      res.status(500).json({
        error: {
          code: 'SYNC_JOB_GET_FAILED',
          message: 'Failed to get sync job',
          traceId: (req as AppRequest).traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  /**
   * PUT /api/sync-jobs/:id
   * Update a sync job configuration.
   * Body: Partial<{ source, dataType, cronExpression, enabled, config }>
   */
  router.put('/:id', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const updates = req.body;

      // TODO: Integrate with DataSyncService when implemented
      res.json({
        job: {
          id,
          ...updates,
          updatedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to update sync job');
      res.status(500).json({
        error: {
          code: 'SYNC_JOB_UPDATE_FAILED',
          message: 'Failed to update sync job',
          traceId: (req as AppRequest).traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  /**
   * DELETE /api/sync-jobs/:id
   * Delete a sync job.
   */
  router.delete('/:id', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const { id: _id } = req.params;

      // TODO: Integrate with DataSyncService when implemented
      res.status(204).end();
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to delete sync job');
      res.status(500).json({
        error: {
          code: 'SYNC_JOB_DELETE_FAILED',
          message: 'Failed to delete sync job',
          traceId: (req as AppRequest).traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  /**
   * POST /api/sync-jobs/:id/trigger
   * Manually trigger a sync job execution.
   */
  router.post('/:id/trigger', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      // TODO: Integrate with DataSyncService when implemented
      res.json({
        jobId: id,
        triggered: true,
        message: 'Sync job triggered successfully',
      });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to trigger sync job');
      res.status(500).json({
        error: {
          code: 'SYNC_JOB_TRIGGER_FAILED',
          message: 'Failed to trigger sync job',
          traceId: (req as AppRequest).traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  /**
   * GET /api/sync-jobs/:id/history
   * Get run history for a sync job.
   * Query: { limit? }
   */
  router.get('/:id/history', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 20;

      // TODO: Integrate with DataSyncService when implemented
      res.json({
        jobId: id,
        runs: [],
        total: 0,
        limit,
      });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to get sync job history');
      res.status(500).json({
        error: {
          code: 'SYNC_JOB_HISTORY_FAILED',
          message: 'Failed to get sync job history',
          traceId: (req as AppRequest).traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  return router;
}
