/**
 * Express Application Factory
 *
 * Creates and configures the Express application with:
 * - JSON body parsing (express.json())
 * - CORS (allow all origins for development)
 * - Trace ID middleware (from observability module)
 * - Auth middleware (from auth module)
 * - Error handling middleware (catch-all)
 * - /metrics endpoint (from metrics module)
 * - /health endpoint (simple health check)
 * - API routes (/api/v1/agents, /api/v1/tools, /api/v1/sessions)
 *
 * Exports createApp() for testability (does not start listening).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';

import { traceIdMiddleware } from './observability/trace-id.js';
import { authMiddleware } from './auth/middleware.js';
import { MetricsCollector } from './observability/metrics.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { registerRoutes, type RouteDependencies } from './routes/index.js';
import type { AuthService } from './auth/types.js';
import type { SecurityAuditLogger } from './auth/audit-logger.js';

/** Configuration for creating the Express app */
export interface AppConfig {
  /** Auth service for token validation */
  authService: AuthService;
  /** Optional audit logger for auth events */
  auditLogger?: SecurityAuditLogger;
  /** Route dependencies (agent platform, tool registry, sessions) */
  routes: RouteDependencies;
  /** Optional metrics collector (creates a default one if not provided) */
  metrics?: MetricsCollector;
}

/**
 * CORS middleware that allows all origins (development mode).
 * Sets appropriate headers for cross-origin requests.
 */
function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-trace-id');
  res.setHeader('Access-Control-Expose-Headers', 'x-trace-id');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}

/**
 * Create and configure the Express application.
 * Does not start listening — call app.listen() separately for testability.
 */
export function createApp(config: AppConfig): Express {
  const app = express();
  const metrics = config.metrics ?? new MetricsCollector();

  // --- Global middleware (applied to all routes) ---

  // CORS - allow all origins for development
  app.use(corsMiddleware);

  // JSON body parsing
  app.use(express.json());

  // Trace ID generation/propagation
  app.use(traceIdMiddleware);

  // --- Public endpoints (no auth required) ---

  // Serve static frontend files from /public
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.resolve(__dirname, '../../public');
  app.use(express.static(publicDir));

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Prometheus metrics
  app.get('/metrics', (req: Request, res: Response) => {
    metrics.metricsHandler(req, res);
  });

  // --- Auth middleware (applied to /api routes) ---
  app.use('/api', authMiddleware(config.authService, config.auditLogger));

  // --- API routes ---
  registerRoutes(app, config.routes);

  // --- Error handling (must be last) ---
  // SPA fallback: serve index.html for non-API routes (React Router)
  app.get('*', (req: Request, res: Response, next) => {
    if (req.path.startsWith('/api') || req.path === '/health' || req.path === '/metrics') {
      return next();
    }
    const indexPath = path.resolve(publicDir, 'index.html');
    res.sendFile(indexPath, (err) => {
      if (err) next();
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
