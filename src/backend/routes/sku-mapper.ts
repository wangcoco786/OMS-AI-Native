/**
 * SKU Mapper Routes
 *
 * Provides endpoints for SKU mapping operations:
 * - POST   /api/sku-mapper/batch-match      - Batch match channel SKUs to system SKUs
 * - POST   /api/sku-mapper/match            - Match a single channel SKU
 * - POST   /api/sku-mapper/confirm/:id      - Confirm or correct a match
 * - POST   /api/sku-mapper/import           - Bulk import channel SKUs
 * - GET    /api/sku-mapper/stats            - Get accuracy statistics
 *
 * Requires authentication (req.user must be set by auth middleware).
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8
 */

import { Router } from 'express';
import type { Response } from 'express';
import pino from 'pino';

import type { AuthenticatedRequest } from '../auth/middleware.js';
import type { TracedRequest } from '../observability/trace-id.js';

const logger = pino({ name: 'routes-sku-mapper' });

/** Combined request type with auth and trace */
type AppRequest = AuthenticatedRequest & TracedRequest;

/**
 * Create the SKU mapper router.
 * Dependencies will be injected when the service layer is implemented.
 */
export function createSkuMapperRouter(): Router {
  const router = Router();

  /**
   * POST /api/sku-mapper/batch-match
   * Batch match channel SKUs against system SKUs.
   * Body: { channelSkus: ChannelSKU[], options?: MatchOptions }
   */
  router.post('/batch-match', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      const { channelSkus, options: _options } = req.body as {
        channelSkus?: unknown[];
        options?: { confidenceThreshold?: number; batchSize?: number; useLearningData?: boolean };
      };

      if (!channelSkus || !Array.isArray(channelSkus) || channelSkus.length === 0) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'channelSkus array is required and must not be empty',
            traceId: req.traceId ?? 'unknown',
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      // TODO: Integrate with SKUMapperService when implemented
      res.json({
        results: [],
        totalProcessed: channelSkus.length,
        tenantId,
      });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to batch match SKUs');
      res.status(500).json({
        error: {
          code: 'SKU_BATCH_MATCH_FAILED',
          message: 'Failed to batch match SKUs',
          traceId: (req as AppRequest).traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  /**
   * POST /api/sku-mapper/match
   * Match a single channel SKU against system SKUs.
   * Body: { channelSku: ChannelSKU }
   */
  router.post('/match', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      const { channelSku } = req.body as { channelSku?: unknown };

      if (!channelSku) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'channelSku is required',
            traceId: req.traceId ?? 'unknown',
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      // TODO: Integrate with SKUMapperService when implemented
      res.json({
        result: null,
        tenantId,
      });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to match SKU');
      res.status(500).json({
        error: {
          code: 'SKU_MATCH_FAILED',
          message: 'Failed to match SKU',
          traceId: (req as AppRequest).traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  /**
   * POST /api/sku-mapper/confirm/:id
   * Confirm or correct a SKU match.
   * Body: { confirmed: boolean, correctedSkuId?: string }
   */
  router.post('/confirm/:id', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { confirmed, correctedSkuId } = req.body as {
        confirmed?: boolean;
        correctedSkuId?: string;
      };

      if (typeof confirmed !== 'boolean') {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'confirmed (boolean) is required',
            traceId: req.traceId ?? 'unknown',
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      // TODO: Integrate with SKUMapperService when implemented
      res.json({
        matchId: id,
        confirmed,
        correctedSkuId: correctedSkuId ?? null,
        status: 'updated',
      });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to confirm SKU match');
      res.status(500).json({
        error: {
          code: 'SKU_CONFIRM_FAILED',
          message: 'Failed to confirm SKU match',
          traceId: (req as AppRequest).traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  /**
   * POST /api/sku-mapper/import
   * Bulk import channel SKUs (CSV or API format).
   * Body: { data: ImportData }
   */
  router.post('/import', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      const { data } = req.body as { data?: unknown };

      if (!data) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'data is required',
            traceId: req.traceId ?? 'unknown',
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      // TODO: Integrate with SKUMapperService when implemented
      res.status(201).json({
        imported: 0,
        failed: 0,
        tenantId,
      });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to import channel SKUs');
      res.status(500).json({
        error: {
          code: 'SKU_IMPORT_FAILED',
          message: 'Failed to import channel SKUs',
          traceId: (req as AppRequest).traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  /**
   * GET /api/sku-mapper/stats
   * Get accuracy statistics for the current tenant.
   * Query: { sessionId?: string }
   */
  router.get('/stats', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;

      // TODO: Integrate with SKUMapperService when implemented
      res.json({
        tenantId,
        sessionId: sessionId ?? null,
        stats: {
          totalMatches: 0,
          correctMatches: 0,
          accuracy: 0,
          highConfidenceCount: 0,
          needsReviewCount: 0,
          noMatchCount: 0,
        },
      });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to get SKU stats');
      res.status(500).json({
        error: {
          code: 'SKU_STATS_FAILED',
          message: 'Failed to get SKU mapping statistics',
          traceId: (req as AppRequest).traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  return router;
}
