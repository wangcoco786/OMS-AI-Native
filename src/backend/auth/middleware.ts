/**
 * Auth Middleware for Express.
 *
 * Provides authentication and authorization middleware:
 * - authMiddleware: Extracts Bearer token, authenticates user, attaches to req.user
 * - requirePermission: Checks if authenticated user has required permission
 *
 * Error responses:
 * - 401 Unauthorized: Missing/invalid token
 * - 403 Forbidden: Insufficient permissions
 */

import type { Request, Response, NextFunction } from 'express';
import type { AuthService, User } from './types.js';
import { AuthError } from './types.js';
import { createRBAC, type RolePermissionMap } from './rbac.js';
import type { SecurityAuditLogger } from './audit-logger.js';

/** Extend Express Request to include authenticated user */
export interface AuthenticatedRequest extends Request {
  user?: User;
}

/** Structured error response format */
interface AuthErrorResponse {
  error: {
    code: string;
    message: string;
    timestamp: string;
  };
}

/**
 * Creates authentication middleware that extracts Bearer token from the
 * Authorization header, authenticates the user, and attaches to req.user.
 *
 * Returns 401 with structured error for missing or invalid tokens.
 * Optionally logs auth failures to the audit log.
 */
export function authMiddleware(authService: AuthService, auditLogger?: SecurityAuditLogger) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      const response: AuthErrorResponse = {
        error: {
          code: 'AUTH_TOKEN_MISSING',
          message: 'Authorization header with Bearer token is required',
          timestamp: new Date().toISOString(),
        },
      };
      auditLogger?.logAuthFailure('unknown', 'AUTH_TOKEN_MISSING', {
        ip: req.ip,
        path: req.path,
      });
      res.status(401).json(response);
      return;
    }

    const token = authHeader.slice(7); // Remove "Bearer " prefix

    try {
      const user = await authService.authenticate(token);
      req.user = user;
      next();
    } catch (error) {
      if (error instanceof AuthError) {
        const response: AuthErrorResponse = {
          error: {
            code: error.code,
            message: error.message,
            timestamp: error.timestamp,
          },
        };
        auditLogger?.logAuthFailure('unknown', error.code, {
          message: error.message,
          ip: req.ip,
          path: req.path,
        });
        res.status(401).json(response);
        return;
      }

      const response: AuthErrorResponse = {
        error: {
          code: 'AUTH_INTERNAL_ERROR',
          message: 'Authentication failed',
          timestamp: new Date().toISOString(),
        },
      };
      auditLogger?.logAuthFailure('unknown', 'AUTH_INTERNAL_ERROR', {
        ip: req.ip,
        path: req.path,
      });
      res.status(401).json(response);
    }
  };
}

/**
 * Creates authorization middleware that checks if the authenticated user
 * has the required permission for a resource and action.
 *
 * Must be used after authMiddleware (requires req.user to be set).
 * Returns 401 if user is not authenticated, 403 if permission is denied.
 * Optionally logs permission denials to the audit log.
 */
export function requirePermission(
  resource: string,
  action: string,
  rolePermissions?: RolePermissionMap,
  auditLogger?: SecurityAuditLogger,
) {
  const rbac = createRBAC(rolePermissions);

  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const user = req.user;

    if (!user) {
      const response: AuthErrorResponse = {
        error: {
          code: 'AUTH_NOT_AUTHENTICATED',
          message: 'Authentication is required',
          timestamp: new Date().toISOString(),
        },
      };
      res.status(401).json(response);
      return;
    }

    if (!rbac.authorize(user, resource, action)) {
      const response: AuthErrorResponse = {
        error: {
          code: 'AUTH_PERMISSION_DENIED',
          message: `Permission denied: requires ${resource}:${action}`,
          timestamp: new Date().toISOString(),
        },
      };
      auditLogger?.logPermissionDenied(user, resource, action);
      res.status(403).json(response);
      return;
    }

    next();
  };
}
