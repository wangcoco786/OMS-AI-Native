import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecurityAuditLogger } from './audit-logger.js';
import type { User } from './types.js';
import type { PostgresDatabaseService } from '../../infrastructure/database/database-service.js';

function createMockDb(): PostgresDatabaseService {
  return {
    query: vi.fn().mockResolvedValue([]),
    transaction: vi.fn(),
    migrate: vi.fn(),
    getPoolStats: vi.fn(),
    shutdown: vi.fn(),
  } as unknown as PostgresDatabaseService;
}

const testUser: User = {
  id: 'user-123',
  tenantId: 'tenant-456',
  roles: ['operator'],
  permissions: ['orders:read', 'orders:write'],
};

describe('SecurityAuditLogger', () => {
  let mockDb: PostgresDatabaseService;
  let auditLogger: SecurityAuditLogger;

  beforeEach(() => {
    mockDb = createMockDb();
    auditLogger = new SecurityAuditLogger(mockDb);
  });

  describe('logAuthFailure', () => {
    it('should insert an auth failure record into audit_logs', async () => {
      await auditLogger.logAuthFailure('unknown-actor', 'AUTH_TOKEN_EXPIRED');

      // Allow fire-and-forget to execute
      await vi.waitFor(() => {
        expect(mockDb.query).toHaveBeenCalled();
      });

      const [sql, params, tenantId] = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[0];

      expect(sql).toContain('INSERT INTO audit_logs');
      expect(params[0]).toBe('00000000-0000-0000-0000-000000000000'); // tenant_id (system)
      expect(params[1]).toBe('unknown-actor'); // actor_id
      expect(params[2]).toBe('user'); // actor_type
      expect(params[3]).toBe('auth.failure'); // action
      expect(params[4]).toBe('auth'); // resource_type
      expect(params[5]).toBeNull(); // resource_id

      const details = JSON.parse(params[6] as string);
      expect(details.reason).toBe('AUTH_TOKEN_EXPIRED');

      expect(tenantId).toBe('00000000-0000-0000-0000-000000000000');
    });

    it('should include additional details when provided', async () => {
      await auditLogger.logAuthFailure('actor-1', 'AUTH_TOKEN_INVALID', {
        ip: '192.168.1.1',
        path: '/api/orders',
      });

      await vi.waitFor(() => {
        expect(mockDb.query).toHaveBeenCalled();
      });

      const [, params] = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[0];
      const details = JSON.parse(params[6] as string);

      expect(details.reason).toBe('AUTH_TOKEN_INVALID');
      expect(details.ip).toBe('192.168.1.1');
      expect(details.path).toBe('/api/orders');
    });

    it('should not throw when database write fails', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Connection refused'),
      );

      // Should not throw
      await expect(
        auditLogger.logAuthFailure('actor-1', 'AUTH_TOKEN_MISSING'),
      ).resolves.toBeUndefined();
    });
  });

  describe('logPermissionDenied', () => {
    it('should insert a permission denied record into audit_logs', async () => {
      await auditLogger.logPermissionDenied(testUser, 'agents', 'delete');

      await vi.waitFor(() => {
        expect(mockDb.query).toHaveBeenCalled();
      });

      const [sql, params, tenantId] = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[0];

      expect(sql).toContain('INSERT INTO audit_logs');
      expect(params[0]).toBe('tenant-456'); // tenant_id from user
      expect(params[1]).toBe('user-123'); // actor_id from user
      expect(params[2]).toBe('user'); // actor_type
      expect(params[3]).toBe('permission.denied'); // action
      expect(params[4]).toBe('agents'); // resource_type
      expect(params[5]).toBeNull(); // resource_id

      const details = JSON.parse(params[6] as string);
      expect(details.reason).toBe('Permission denied: requires agents:delete');
      expect(details.attempted_action).toBe('delete');
      expect(details.user_roles).toEqual(['operator']);
      expect(details.user_permissions).toEqual(['orders:read', 'orders:write']);

      expect(tenantId).toBe('tenant-456');
    });

    it('should not throw when database write fails', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Connection refused'),
      );

      await expect(
        auditLogger.logPermissionDenied(testUser, 'agents', 'delete'),
      ).resolves.toBeUndefined();
    });
  });

  describe('middleware integration', () => {
    it('should work with authMiddleware when auth fails', async () => {
      // Import middleware dynamically to test integration
      const { authMiddleware } = await import('./middleware.js');
      const { AuthError } = await import('./types.js');

      const authService = {
        authenticate: vi.fn().mockRejectedValue(
          new AuthError('AUTH_TOKEN_EXPIRED', 'Token has expired'),
        ),
        generateToken: vi.fn(),
        refreshToken: vi.fn(),
      };

      const middleware = authMiddleware(authService, auditLogger);

      const req = {
        headers: { authorization: 'Bearer expired-token' },
        ip: '127.0.0.1',
        path: '/api/test',
        user: undefined,
      } as unknown as import('./middleware.js').AuthenticatedRequest;

      const res = {
        statusCode: 0,
        status(code: number) {
          res.statusCode = code;
          return res;
        },
        json() {
          return res;
        },
      } as unknown as import('express').Response;

      const next = vi.fn();

      await middleware(req, res, next);

      expect(res.statusCode).toBe(401);

      await vi.waitFor(() => {
        expect(mockDb.query).toHaveBeenCalled();
      });

      const [, params] = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(params[1]).toBe('unknown'); // actor_id
      expect(params[3]).toBe('auth.failure'); // action
      const details = JSON.parse(params[6] as string);
      expect(details.reason).toBe('AUTH_TOKEN_EXPIRED');
    });

    it('should work with requirePermission when permission denied', async () => {
      const { requirePermission } = await import('./middleware.js');

      const middleware = requirePermission('agents', 'delete', undefined, auditLogger);

      const req = {
        headers: {},
        user: testUser,
      } as unknown as import('./middleware.js').AuthenticatedRequest;

      const res = {
        statusCode: 0,
        status(code: number) {
          res.statusCode = code;
          return res;
        },
        json() {
          return res;
        },
      } as unknown as import('express').Response;

      const next = vi.fn();

      middleware(req, res, next);

      expect(res.statusCode).toBe(403);

      await vi.waitFor(() => {
        expect(mockDb.query).toHaveBeenCalled();
      });

      const [, params] = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(params[0]).toBe('tenant-456'); // tenant_id
      expect(params[1]).toBe('user-123'); // actor_id
      expect(params[3]).toBe('permission.denied'); // action
      expect(params[4]).toBe('agents'); // resource_type
    });
  });
});
