/**
 * RBAC (Role-Based Access Control) module.
 *
 * Provides permission-based authorization with configurable role-to-permission mappings.
 * Permission format: "resource:action" (e.g., "orders:read", "agents:write")
 * Wildcard support: "resource:*" (all actions on resource), "*:*" (superadmin)
 */

import type { User } from './types.js';

/** Role-to-permissions mapping type */
export type RolePermissionMap = Record<string, string[]>;

/** Default role-to-permissions mapping */
const DEFAULT_ROLE_PERMISSIONS: RolePermissionMap = {
  admin: ['*:*'],
  manager: [
    'orders:read',
    'orders:write',
    'agents:read',
    'agents:write',
    'sessions:read',
    'sessions:write',
  ],
  operator: ['orders:read', 'orders:write', 'sessions:read', 'sessions:write'],
  viewer: ['orders:read', 'agents:read', 'sessions:read'],
};

/**
 * Creates an RBAC authorizer with the given role-to-permission mapping.
 * Returns an authorize function that checks if a user has the required permission.
 */
export function createRBAC(rolePermissions: RolePermissionMap = DEFAULT_ROLE_PERMISSIONS) {
  /**
   * Check if a user is authorized to perform an action on a resource.
   *
   * Authorization passes if any of the following is true:
   * 1. User's permissions array contains "resource:action"
   * 2. User's permissions array contains "resource:*"
   * 3. User's permissions array contains "*:*"
   * 4. Any of the user's roles map to permissions that satisfy conditions 1-3
   */
  function authorize(user: User, resource: string, action: string): boolean {
    const requiredPermission = `${resource}:${action}`;

    // Collect all effective permissions: direct user permissions + role-derived permissions
    const effectivePermissions = getEffectivePermissions(user, rolePermissions);

    return effectivePermissions.some(
      (perm) =>
        perm === requiredPermission || perm === `${resource}:*` || perm === '*:*',
    );
  }

  return { authorize };
}

/**
 * Get all effective permissions for a user, combining direct permissions
 * and permissions derived from their roles.
 */
export function getEffectivePermissions(
  user: User,
  rolePermissions: RolePermissionMap = DEFAULT_ROLE_PERMISSIONS,
): string[] {
  const permissions = new Set<string>(user.permissions);

  for (const role of user.roles) {
    const rolePerms = rolePermissions[role];
    if (rolePerms) {
      for (const perm of rolePerms) {
        permissions.add(perm);
      }
    }
  }

  return Array.from(permissions);
}

/**
 * Standalone authorize function using default role permissions.
 * Convenience export for simple usage without creating an RBAC instance.
 */
export function authorize(user: User, resource: string, action: string): boolean {
  const rbac = createRBAC();
  return rbac.authorize(user, resource, action);
}
