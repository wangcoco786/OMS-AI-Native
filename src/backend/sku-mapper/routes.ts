/**
 * SKU Mapper REST API Routes
 *
 * Provides SKU mapping management endpoints:
 * - POST   /api/v1/sku-mapper/batch-match       — Batch match Channel SKUs
 * - POST   /api/v1/sku-mapper/match             — Match a single Channel SKU
 * - PUT    /api/v1/sku-mapper/mappings/:id/confirm — Confirm or correct a mapping
 * - POST   /api/v1/sku-mapper/import            — Batch import Channel SKUs
 * - GET    /api/v1/sku-mapper/stats             — Get accuracy statistics
 *
 * All endpoints require authentication (req.user must be set by auth middleware).
 * Data is isolated by tenant.
 */

import { Router } from 'express';
import type { Response } from 'express';
import pino from 'pino';

import type { AuthenticatedRequest } from '../auth/middleware.js';
import type { TracedRequest } from '../observability/trace-id.js';
import type { SKUMapperService } from './sku-mapper-service.js';
import type { FallbackMatcher } from './fallback-matcher.js';
import type { ImportService } from './import-service.js';
import type { AccuracyService } from './accuracy-service.js';
import type { LearningService } from './learning-service.js';
import type { ChannelSKU, MatchOptions } from '../../shared/m2-types.js';

const logger = pino({ name: 'routes-sku-mapper' });

/** Combined request type with auth and trace */
type AppRequest = AuthenticatedRequest & TracedRequest;

/** Extract a route param as a string */
function getParam(req: AppRequest, name: string): string {
  const value = req.params[name];
  return typeof value === 'string' ? value : String(value);
}

/** Dependencies for the SKU mapper router */
export interface SKUMapperRouterDeps {
  skuMapperService: SKUMapperService;
  fallbackMatcher: FallbackMatcher;
  importService: ImportService;
  accuracyService: AccuracyService;
  learningService: LearningService;
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

/**
 * Create the SKU mapper router.
 * Accepts dependencies for matching, import, and accuracy services.
 */
export function createSKUMapperRouter(deps: SKUMapperRouterDeps): Router {
  const { skuMapperService, importService, accuracyService, learningService } = deps;
  const router = Router();

  // ─── POST /api/v1/sku-mapper/batch-match — Batch match Channel SKUs ───────

  router.post('/batch-match', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      const { channelSkus, options } = req.body as {
        channelSkus?: ChannelSKU[];
        options?: MatchOptions;
      };

      if (!channelSkus || !Array.isArray(channelSkus) || channelSkus.length === 0) {
        sendError(
          res,
          400,
          'VALIDATION_ERROR',
          'channelSkus must be a non-empty array',
          req.traceId,
        );
        return;
      }

      // Validate each channel SKU has required fields
      for (let i = 0; i < channelSkus.length; i++) {
        const sku = channelSkus[i];
        if (!sku.id || !sku.name || !sku.channelId || !sku.externalId) {
          sendError(
            res,
            400,
            'VALIDATION_ERROR',
            `channelSkus[${i}] is missing required fields (id, name, channelId, externalId)`,
            req.traceId,
          );
          return;
        }
      }

      const results = await skuMapperService.batchMatch(tenantId, channelSkus, options);

      res.json({
        results,
        total: results.length,
        summary: {
          highConfidence: results.filter((r) => r.matchType === 'high_confidence').length,
          needsReview: results.filter((r) => r.matchType === 'needs_review').length,
          noMatch: results.filter((r) => r.matchType === 'no_match').length,
        },
      });
    } catch (error) {
      logger.error({ error, traceId: req.traceId }, 'Failed to batch match SKUs');
      sendError(res, 500, 'BATCH_MATCH_FAILED', 'Failed to batch match SKUs', req.traceId);
    }
  });

  // ─── POST /api/v1/sku-mapper/match — Match a single Channel SKU ───────────

  router.post('/match', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      const { channelSku } = req.body as { channelSku?: ChannelSKU };

      if (!channelSku) {
        sendError(res, 400, 'VALIDATION_ERROR', 'channelSku is required', req.traceId);
        return;
      }

      if (!channelSku.id || !channelSku.name || !channelSku.channelId || !channelSku.externalId) {
        sendError(
          res,
          400,
          'VALIDATION_ERROR',
          'channelSku is missing required fields (id, name, channelId, externalId)',
          req.traceId,
        );
        return;
      }

      const result = await skuMapperService.matchSingle(tenantId, channelSku);

      res.json({ result });
    } catch (error) {
      logger.error({ error, traceId: req.traceId }, 'Failed to match SKU');
      sendError(res, 500, 'MATCH_FAILED', 'Failed to match SKU', req.traceId);
    }
  });

  // ─── PUT /api/v1/sku-mapper/mappings/:id/confirm — Confirm or correct ─────

  router.put('/mappings/:id/confirm', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      const userId = req.user?.id;
      if (!tenantId || !userId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      const mappingId = getParam(req, 'id');
      if (!mappingId) {
        sendError(res, 400, 'VALIDATION_ERROR', 'Mapping ID is required', req.traceId);
        return;
      }

      const { confirmed, correctedSkuId, channelSkuAttributes } = req.body as {
        confirmed?: boolean;
        correctedSkuId?: string;
        channelSkuAttributes?: Record<string, string>;
      };

      if (confirmed === undefined || typeof confirmed !== 'boolean') {
        sendError(
          res,
          400,
          'VALIDATION_ERROR',
          'confirmed must be a boolean value',
          req.traceId,
        );
        return;
      }

      if (!confirmed && correctedSkuId) {
        // Record the correction for learning
        await learningService.recordCorrection({
          tenantId,
          mappingId,
          originalSystemSkuId: null, // Will be resolved from the mapping
          correctedSystemSkuId: correctedSkuId,
          channelSkuAttributes: channelSkuAttributes ?? {},
          correctedBy: userId,
        });
      } else {
        // Simple confirm or reject
        await skuMapperService.confirmMatch(mappingId, confirmed, correctedSkuId);
      }

      res.json({ success: true, mappingId, confirmed });
    } catch (error) {
      logger.error({ error, traceId: req.traceId }, 'Failed to confirm/correct mapping');
      sendError(res, 500, 'CONFIRM_FAILED', 'Failed to confirm/correct mapping', req.traceId);
    }
  });

  // ─── POST /api/v1/sku-mapper/import — Batch import Channel SKUs ───────────

  router.post('/import', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      const { shopId, format, records, csvText } = req.body as {
        shopId?: string;
        format?: 'csv' | 'api';
        records?: Omit<ChannelSKU, 'id'>[];
        csvText?: string;
      };

      if (!shopId) {
        sendError(res, 400, 'VALIDATION_ERROR', 'shopId is required', req.traceId);
        return;
      }

      if (!format || !['csv', 'api'].includes(format)) {
        sendError(
          res,
          400,
          'VALIDATION_ERROR',
          'format must be "csv" or "api"',
          req.traceId,
        );
        return;
      }

      let importData;

      if (format === 'csv') {
        if (!csvText || typeof csvText !== 'string') {
          sendError(res, 400, 'VALIDATION_ERROR', 'csvText is required for CSV format', req.traceId);
          return;
        }
        importData = importService.parseCSV(csvText, tenantId, shopId);
      } else {
        if (!records || !Array.isArray(records) || records.length === 0) {
          sendError(
            res,
            400,
            'VALIDATION_ERROR',
            'records must be a non-empty array for API format',
            req.traceId,
          );
          return;
        }
        importData = { tenantId, shopId, format: 'api' as const, records };
      }

      const result = await importService.importChannelSkus(importData);

      res.status(201).json({ result });
    } catch (error) {
      logger.error({ error, traceId: req.traceId }, 'Failed to import channel SKUs');
      sendError(res, 500, 'IMPORT_FAILED', 'Failed to import channel SKUs', req.traceId);
    }
  });

  // ─── GET /api/v1/sku-mapper/stats — Get accuracy statistics ───────────────

  router.get('/stats', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;

      const report = await accuracyService.getAccuracyReport(tenantId, sessionId);

      res.json(report);
    } catch (error) {
      logger.error({ error, traceId: req.traceId }, 'Failed to get accuracy stats');
      sendError(res, 500, 'STATS_FAILED', 'Failed to get accuracy statistics', req.traceId);
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
