/**
 * Dashboard Service Module
 *
 * Exports all dashboard components:
 * - KPIAggregator: Computes and stores KPI metrics
 * - KPIQueryService: Queries pre-aggregated KPI data
 * - AnomalyDetector: Detects anomalous data points in time series
 * - InventoryService: Queries warehouse inventory levels
 * - ShiftService: Queries shift workbench tasks and progress
 * - DashboardSSE: Real-time metric updates via Server-Sent Events
 * - createDashboardRouter: Express router for dashboard REST API
 */

export { KPIAggregator, CACHE_TTL, KPI_METRICS } from './kpi-aggregator.js';
export type { KPIAggregatorDeps, AggregationResult, KPIMetricName, MetricUpdateCallback } from './kpi-aggregator.js';

export { KPIQueryService } from './kpi-query-service.js';
export type { KPIQueryServiceDeps } from './kpi-query-service.js';

export { AnomalyDetector } from './anomaly-detector.js';
export type { AnomalyDetectorConfig } from './anomaly-detector.js';

export { InventoryService } from './inventory-service.js';
export type { InventoryServiceDeps } from './inventory-service.js';

export { ShiftService } from './shift-service.js';
export type { ShiftServiceDeps } from './shift-service.js';

export { DashboardSSE } from './dashboard-sse.js';
export type { DashboardSubscription, DashboardSSEConfig } from './dashboard-sse.js';

export { createDashboardRouter } from './routes.js';
export type { DashboardRouterDeps } from './routes.js';
