import { describe, it, expect } from 'vitest';
import { authorize, createRBAC, getEffectivePermissions } from './rbac.js';
import type { User } from './types.js';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    tenantId: 'tenant-1',
    roles: [],
    permissions: [],
    ...overrides,
  };
}

describe('RBAC', () => {
  describe('authorize (standalone)', () => {
    it('should allow access when user has exact permission', () => {
      const user = makeUser({ permissions: ['orders:read'] });
      expect(authorize(user, 'orders', 'read')).toBe(true);
    });

    it('should deny access when user lacks the permission', () => {
      const user = makeUser({ permissions: ['orders:read'] });
      expect(authorize(user, 'orders', 'write')).toBe(false);
    });

    it('should allow access with resource wildcard permission', () => {
      const user = makeUser({ permissions: ['orders:*'] });
      expect(authorize(user, 'orders', 'read')).toBe(true);
      expect(authorize(user, 'orders', 'write')).toBe(true);
      expect(authorize(user, 'orders', 'delete')).toBe(true);
    });

    it('should not allow resource wildcard to grant access to other resources', () => {
      const user = makeUser({ permissions: ['orders:*'] });
      expect(authorize(user, 'agents', 'read')).toBe(false);
    });

    it('should allow access with superadmin wildcard (*:*)', () => {
      const user = makeUser({ permissions: ['*:*'] });
      expect(authorize(user, 'orders', 'read')).toBe(true);
      expect(authorize(user, 'agents', 'write')).toBe(true);
      expect(authorize(user, 'anything', 'anything')).toBe(true);
    });

    it('should allow access based on role-derived permissions', () => {
      const user = makeUser({ roles: ['viewer'] });
      expect(authorize(user, 'orders', 'read')).toBe(true);
    });

    it('should deny access when role does not include the permission', () => {
      const user = makeUser({ roles: ['viewer'] });
      expect(authorize(user, 'orders', 'write')).toBe(false);
    });

    it('should allow admin role full access via *:* mapping', () => {
      const user = makeUser({ roles: ['admin'] });
      expect(authorize(user, 'orders', 'read')).toBe(true);
      expect(authorize(user, 'orders', 'write')).toBe(true);
      expect(authorize(user, 'agents', 'delete')).toBe(true);
    });

    it('should deny access for user with no roles and no permissions', () => {
      const user = makeUser();
      expect(authorize(user, 'orders', 'read')).toBe(false);
    });
  });

  describe('createRBAC with custom role permissions', () => {
    it('should use custom role-to-permission mapping', () => {
      const rbac = createRBAC({
        custom_role: ['reports:read', 'reports:write'],
      });

      const user = makeUser({ roles: ['custom_role'] });
      expect(rbac.authorize(user, 'reports', 'read')).toBe(true);
      expect(rbac.authorize(user, 'reports', 'write')).toBe(true);
      expect(rbac.authorize(user, 'reports', 'delete')).toBe(false);
    });

    it('should combine direct permissions with role permissions', () => {
      const rbac = createRBAC({
        basic: ['orders:read'],
      });

      const user = makeUser({
        roles: ['basic'],
        permissions: ['agents:read'],
      });

      expect(rbac.authorize(user, 'orders', 'read')).toBe(true);
      expect(rbac.authorize(user, 'agents', 'read')).toBe(true);
      expect(rbac.authorize(user, 'agents', 'write')).toBe(false);
    });

    it('should handle unknown roles gracefully', () => {
      const rbac = createRBAC({ known_role: ['orders:read'] });
      const user = makeUser({ roles: ['unknown_role'] });
      expect(rbac.authorize(user, 'orders', 'read')).toBe(false);
    });
  });

  describe('getEffectivePermissions', () => {
    it('should return direct permissions when user has no roles', () => {
      const user = makeUser({ permissions: ['orders:read', 'agents:write'] });
      const perms = getEffectivePermissions(user, {});
      expect(perms).toContain('orders:read');
      expect(perms).toContain('agents:write');
      expect(perms).toHaveLength(2);
    });

    it('should merge role permissions with direct permissions', () => {
      const user = makeUser({
        roles: ['viewer'],
        permissions: ['custom:action'],
      });
      const roleMap = { viewer: ['orders:read'] };
      const perms = getEffectivePermissions(user, roleMap);

      expect(perms).toContain('custom:action');
      expect(perms).toContain('orders:read');
    });

    it('should deduplicate permissions', () => {
      const user = makeUser({
        roles: ['role_a'],
        permissions: ['orders:read'],
      });
      const roleMap = { role_a: ['orders:read', 'orders:write'] };
      const perms = getEffectivePermissions(user, roleMap);

      const orderReadCount = perms.filter((p) => p === 'orders:read').length;
      expect(orderReadCount).toBe(1);
    });
  });
});
