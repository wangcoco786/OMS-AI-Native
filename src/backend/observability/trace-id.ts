/**
 * Trace ID Generation and Propagation
 *
 * Provides:
 * - Globally unique trace ID generation using crypto.randomUUID()
 * - Express middleware that generates or extracts trace ID from x-trace-id header
 * - Attaches trace ID to req.traceId and sets x-trace-id response header
 * - Ensures trace ID propagates through LLM calls, Tool calls, and message queues
 */

import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

/** Extend Express Request to include traceId */
export interface TracedRequest extends Request {
  traceId?: string;
}

/**
 * Generate a globally unique trace ID using crypto.randomUUID().
 * Returns a UUID v4 string.
 */
export function generateTraceId(): string {
  return crypto.randomUUID();
}

/**
 * Express middleware that generates or extracts a trace ID for each request.
 *
 * Behavior:
 * - If the incoming request has an `x-trace-id` header, it is reused.
 * - Otherwise, a new trace ID is generated.
 * - The trace ID is attached to `req.traceId`.
 * - The trace ID is set as the `x-trace-id` response header.
 */
export function traceIdMiddleware(req: TracedRequest, res: Response, next: NextFunction): void {
  const existingTraceId = req.headers['x-trace-id'];

  const traceId =
    typeof existingTraceId === 'string' && existingTraceId.length > 0
      ? existingTraceId
      : generateTraceId();

  req.traceId = traceId;
  res.setHeader('x-trace-id', traceId);

  next();
}
