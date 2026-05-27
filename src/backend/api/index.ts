/**
 * API Gateway
 *
 * Express-based HTTP API gateway with routing,
 * middleware, and request handling.
 *
 * Re-exports from the routes and server modules.
 */

export { createApp, type AppConfig } from '../server.js';
export { registerRoutes, type RouteDependencies } from '../routes/index.js';
