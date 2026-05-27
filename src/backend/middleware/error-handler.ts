/**
 * Global Error Handling Middleware
 *
 * Catches all unhandled errors in the Express pipeline and returns
 * a structured error response. Does not leak internal implementation details.
 *
 * Response format follows the ErrorResponse interface from shared/types.
 */

import type { Request, Response, NextFunction } from 'express';
import pino from 'pino';

import type { TracedRequest } from '../observability/trace-id.js';
import type { ErrorResponse } from '../../shared/types.js';

const logger = pino({ name: 'error-handler' });

/**
 * Express error-handling middleware (4-argument signature).
 * Catches errors thrown or passed via next(err) in route handlers.
 */
export function errorHandler(
  err: Error & { statusCode?: number; code?: string },
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const tracedReq = req as TracedRequest;
  const traceId = tracedReq.traceId ?? 'unknown';
  const statusCode = err.statusCode ?? 500;

  // Log the full error internally
  logger.error(
    {
      err,
      traceId,
      method: req.method,
      path: req.path,
      statusCode,
    },
    'Unhandled error in request pipeline',
  );

  // Return structured error response without internal details
  const response: ErrorResponse = {
    error: {
      code: err.code ?? 'INTERNAL_ERROR',
      message: statusCode === 500 ? 'An internal error occurred' : err.message,
      traceId,
      timestamp: new Date().toISOString(),
    },
  };

  res.status(statusCode).json(response);
}

/**
 * Middleware to handle 404 Not Found for unmatched routes.
 */
export function notFoundHandler(req: Request, res: Response): void {
  const tracedReq = req as TracedRequest;
  const traceId = tracedReq.traceId ?? 'unknown';

  const response: ErrorResponse = {
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
      traceId,
      timestamp: new Date().toISOString(),
    },
  };

  res.status(404).json(response);
}
