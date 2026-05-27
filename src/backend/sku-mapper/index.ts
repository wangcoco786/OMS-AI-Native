/**
 * SKU Mapper Module
 *
 * AI-driven SKU matching service that uses LLM to automatically
 * match Channel SKUs with System SKUs. Includes:
 * - Core LLM-based matching service
 * - Rule-based fallback matcher
 * - Learning service for recording corrections
 * - Import service for batch Channel SKU import
 * - Accuracy service for statistics and warnings
 * - REST API routes
 */

export { SKUMapperService } from './sku-mapper-service.js';
export { FallbackMatcher } from './fallback-matcher.js';
export { LearningService } from './learning-service.js';
export type { CorrectionInput, CorrectionRecord } from './learning-service.js';
export { ImportService } from './import-service.js';
export { AccuracyService } from './accuracy-service.js';
export type { AccuracyReport } from './accuracy-service.js';
export { createSKUMapperRouter } from './routes.js';
export type { SKUMapperRouterDeps } from './routes.js';
