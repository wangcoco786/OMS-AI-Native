/**
 * Auth Service
 *
 * IAM SSO authentication and RBAC authorization.
 */

export { createAuthService } from './auth-service.js';
export { AuthError } from './types.js';
export type { AuthConfig, AuthService, SSOProvider, TokenPayload, User } from './types.js';

// RBAC
export { authorize, createRBAC, getEffectivePermissions } from './rbac.js';
export type { RolePermissionMap } from './rbac.js';

// Middleware
export { authMiddleware, requirePermission } from './middleware.js';
export type { AuthenticatedRequest } from './middleware.js';

// Audit Logger
export { SecurityAuditLogger } from './audit-logger.js';
