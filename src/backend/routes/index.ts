/**
 * Route Registration
 *
 * Centralizes all API route mounting.
 * - M1 routes: /api/v1/agents, /api/v1/tools, /api/v1/sessions
 * - M2 routes: /api/onboarding, /api/sku-mapper, /api/dashboard, /api/sync-jobs
 *
 * Each route module receives its dependencies via factory functions.
 */

import type { Express } from 'express';

import { createAgentsRouter } from './agents.js';
import { createToolsRouter } from './tools.js';
import { createSessionsRouter, type SessionsRouterDeps } from './sessions.js';
import { createOnboardingRouter } from './onboarding.js';
import { createSkuMapperRouter } from './sku-mapper.js';
import { createDashboardRouter } from './dashboard.js';
import { createSyncRouter } from './sync.js';
import type { AgentPlatform } from '../../agent-runtime/platform/types.js';
import type { MCPToolRegistry } from '../../infrastructure/tools/types.js';

/** Dependencies required for route registration */
export interface RouteDependencies {
  agentPlatform: AgentPlatform;
  toolRegistry: MCPToolRegistry;
  sessions: SessionsRouterDeps;
}

/**
 * Register all API routes on the Express app.
 * - M1 routes under /api/v1 prefix
 * - M2 routes under /api prefix with feature-specific paths
 *
 * Auth middleware is applied to all /api routes in server.ts,
 * so all routes registered here are protected.
 */
export function registerRoutes(app: Express, deps: RouteDependencies): void {
  // --- M1 Routes ---
  const agentsRouter = createAgentsRouter(deps.agentPlatform);
  const toolsRouter = createToolsRouter(deps.toolRegistry);
  const sessionsRouter = createSessionsRouter(deps.sessions);

  app.use('/api/v1/agents', agentsRouter);
  app.use('/api/v1/tools', toolsRouter);
  app.use('/api/v1/sessions', sessionsRouter);

  // --- M2 Routes ---
  const onboardingRouter = createOnboardingRouter();
  const skuMapperRouter = createSkuMapperRouter();
  const dashboardRouter = createDashboardRouter();
  const syncRouter = createSyncRouter();

  app.use('/api/onboarding', onboardingRouter);
  app.use('/api/sku-mapper', skuMapperRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/sync-jobs', syncRouter);
}
