/**
 * Dashboard REST API Routes
 *
 * Provides dashboard data endpoints:
 * - GET /api/v1/dashboard/kpi           — Get KPI metrics for a period
 * - GET /api/v1/dashboard/kpi/trend     — Get KPI trend data for a metric
 * - GET /api/v1/dashboard/inventory     — Get inventory levels
 * - GET /api/v1/dashboard/inventory/trend — Get inventory trend for a SKU
 * - GET /api/v1/dashboard/shift/tasks   — Get shift tasks
 * - GET /api/v1/dashboard/shift/progress — Get shift progress
 * - GET /api/v1/dashboard/subscribe     — SSE subscription for real-time updates
 *
 * All endpoints require authentication (req.user must be set by auth middleware).
 * Data is isolated by tenant.
 */

import { Router } from 'express';
import type { Response } from 'express';
import pino from 'pino';

import type { AuthenticatedRequest } from '../auth/middleware.js';
import type { TracedRequest } from '../observability/trace-id.js';
import type { KPIQueryService } from './kpi-query-service.js';
import type { InventoryService } from './inventory-service.js';
import type { ShiftService } from './shift-service.js';
import type { DashboardSSE } from './dashboard-sse.js';
import type { TimePeriod, TimeGranularity, DimensionFilter } from '../../shared/m2-types.js';

const logger = pino({ name: 'routes-dashboard' });

/** Combined request type with auth and trace */
type AppRequest = AuthenticatedRequest & TracedRequest;

/** Dependencies for the dashboard router */
export interface DashboardRouterDeps {
  kpiQueryService: KPIQueryService;
  inventoryService: InventoryService;
  shiftService: ShiftService;
  dashboardSSE: DashboardSSE;
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

/** Valid time granularities */
const VALID_GRANULARITIES: TimeGranularity[] = ['hour', 'day', 'week'];

/**
 * Create the dashboard router.
 * Accepts dependencies for KPI, inventory, shift, and SSE services.
 */
export function createDashboardRouter(deps: DashboardRouterDeps): Router {
  const { kpiQueryService, inventoryService, shiftService, dashboardSSE } = deps;
  const router = Router();

  // ─── GET /api/v1/dashboard/kpi — Get KPI metrics ──────────────────────────

  router.get('/kpi', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      // Parse period from query params
      const period = parsePeriodFromQuery(req);
      if (!period) {
        sendError(res, 400, 'VALIDATION_ERROR', 'start, end, and granularity query parameters are required', req.traceId);
        return;
      }

      // Parse optional dimension filter
      const filter = parseDimensionFilter(req);

      const metrics = await kpiQueryService.getKPIMetrics(tenantId, period, filter);

      res.json({ metrics });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to get KPI metrics');
      sendError(res, 500, 'KPI_QUERY_FAILED', 'Failed to get KPI metrics', (req as AppRequest).traceId);
    }
  });

  // ─── GET /api/v1/dashboard/kpi/trend — Get KPI trend data ─────────────────

  router.get('/kpi/trend', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      const metric = req.query.metric as string | undefined;
      if (!metric) {
        sendError(res, 400, 'VALIDATION_ERROR', 'metric query parameter is required', req.traceId);
        return;
      }

      const period = parsePeriodFromQuery(req);
      if (!period) {
        sendError(res, 400, 'VALIDATION_ERROR', 'start, end, and granularity query parameters are required', req.traceId);
        return;
      }

      const filter = parseDimensionFilter(req);

      const trend = await kpiQueryService.getKPITrend(tenantId, metric, period, filter);

      res.json({ trend });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to get KPI trend');
      sendError(res, 500, 'KPI_TREND_FAILED', 'Failed to get KPI trend data', (req as AppRequest).traceId);
    }
  });

  // ─── GET /api/v1/dashboard/inventory — Get inventory levels ───────────────

  router.get('/inventory', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      const warehouseId = req.query.warehouseId as string | undefined;

      const levels = await inventoryService.getInventoryLevels(tenantId, warehouseId);

      res.json({ inventory: levels });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to get inventory levels');
      sendError(res, 500, 'INVENTORY_QUERY_FAILED', 'Failed to get inventory levels', (req as AppRequest).traceId);
    }
  });

  // ─── GET /api/v1/dashboard/inventory/trend — Get inventory trend ──────────

  router.get('/inventory/trend', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      const skuId = req.query.skuId as string | undefined;
      if (!skuId) {
        sendError(res, 400, 'VALIDATION_ERROR', 'skuId query parameter is required', req.traceId);
        return;
      }

      const period = parsePeriodFromQuery(req);
      if (!period) {
        sendError(res, 400, 'VALIDATION_ERROR', 'start, end, and granularity query parameters are required', req.traceId);
        return;
      }

      const trend = await inventoryService.getInventoryTrend(tenantId, skuId, period);

      res.json({ trend });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to get inventory trend');
      sendError(res, 500, 'INVENTORY_TREND_FAILED', 'Failed to get inventory trend data', (req as AppRequest).traceId);
    }
  });

  // ─── GET /api/v1/dashboard/shift/tasks — Get shift tasks ──────────────────

  router.get('/shift/tasks', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      const shiftId = req.query.shiftId as string | undefined;
      if (!shiftId) {
        sendError(res, 400, 'VALIDATION_ERROR', 'shiftId query parameter is required', req.traceId);
        return;
      }

      // Parse optional sort
      const sortField = req.query.sortField as string | undefined;
      const sortDirection = req.query.sortDirection as string | undefined;
      const sort = sortField
        ? { field: sortField, direction: (sortDirection === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc' }
        : undefined;

      const tasks = await shiftService.getShiftTasks(tenantId, shiftId, sort);

      res.json({ tasks, total: tasks.length });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to get shift tasks');
      sendError(res, 500, 'SHIFT_TASKS_FAILED', 'Failed to get shift tasks', (req as AppRequest).traceId);
    }
  });

  // ─── GET /api/v1/dashboard/shift/progress — Get shift progress ────────────

  router.get('/shift/progress', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      const shiftId = req.query.shiftId as string | undefined;
      if (!shiftId) {
        sendError(res, 400, 'VALIDATION_ERROR', 'shiftId query parameter is required', req.traceId);
        return;
      }

      const progress = await shiftService.getShiftProgress(tenantId, shiftId);

      res.json({ progress });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to get shift progress');
      sendError(res, 500, 'SHIFT_PROGRESS_FAILED', 'Failed to get shift progress', (req as AppRequest).traceId);
    }
  });

  // ─── GET /api/v1/dashboard/subscribe — SSE subscription ───────────────────

  router.get('/subscribe', (req: AppRequest, res: Response): void => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      // Parse metrics to subscribe to (comma-separated)
      const metricsParam = req.query.metrics as string | undefined;
      const metrics = metricsParam ? metricsParam.split(',').map((m) => m.trim()) : [];

      // Create SSE subscription
      dashboardSSE.subscribe(res, tenantId, metrics);

      logger.info({ tenantId, metrics, traceId: req.traceId }, 'Dashboard SSE subscription started');
    } catch (error) {
      logger.error({ error, traceId: req.traceId }, 'Failed to create SSE subscription');
      // If headers haven't been sent yet, send error
      if (!res.headersSent) {
        sendError(res, 500, 'SSE_SUBSCRIBE_FAILED', 'Failed to create SSE subscription', req.traceId);
      }
    }
  });

  return router;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Parse TimePeriod from query parameters.
 */
function parsePeriodFromQuery(req: AppRequest): TimePeriod | null {
  const start = req.query.start as string | undefined;
  const end = req.query.end as string | undefined;
  const granularity = req.query.granularity as string | undefined;

  if (!start || !end || !granularity) return null;

  if (!VALID_GRANULARITIES.includes(granularity as TimeGranularity)) return null;

  const startDate = new Date(start);
  const endDate = new Date(end);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return null;

  return {
    start: startDate,
    end: endDate,
    granularity: granularity as TimeGranularity,
  };
}

/**
 * Parse DimensionFilter from query parameters.
 */
function parseDimensionFilter(req: AppRequest): DimensionFilter | undefined {
  const shopId = req.query.shopId as string | undefined;
  const channelId = req.query.channelId as string | undefined;
  const warehouseId = req.query.warehouseId as string | undefined;

  if (!shopId && !channelId && !warehouseId) return undefined;

  return {
    ...(shopId && { shopId }),
    ...(channelId && { channelId }),
    ...(warehouseId && { warehouseId }),
  };
}

/**
 * Send a structured error response.
 */
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
