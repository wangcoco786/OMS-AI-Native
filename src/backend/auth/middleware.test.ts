import { describe, it, expect, vi } from 'vitest';
import type { Response, NextFunction } from 'express';
import { authMiddleware, requirePermission } from './middleware.js';
import type { AuthenticatedRequest } from './middleware.js';
import type { AuthService, User } from './types.js';
import { AuthError } from './types.js';

function createMockRequest(headers: Record<string, string> = {}): AuthenticatedRequest {
  return {
    headers,
    user: undefined,
  } as unknown as AuthenticatedRequest;
}

function createMockResponse(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
  } as unknown as Response & { statusCode: number; body: unknown };
  return res;
}

const testUser: User = {
  id: 'user-123',
  tenantId: 'tenant-456',
  roles: ['operator'],
  permissions: ['orders:read', 'orders:write'],
};

function createMockAuthService(overrides: Partial<AuthService> = {}): AuthService {
  return {
    authenticate: vi.fn().mockResolvedValue(testUser),
    generateToken: vi.fn().mockReturnValue('mock-token'),
    refreshToken: vi.fn().mockReturnValue('mock-refreshed-token'),
    ...overrides,
  };
}

describe('authMiddleware', () => {
  it('should return 401 when Authorization header is missing', async () => {
    const authService = createMockAuthService();
    const middleware = authMiddleware(authService);
    const req = createMockRequest();
    const res = createMockResponse();
    const next = vi.fn();

    await middleware(req, res as unknown as Response, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({
      error: {
        code: 'AUTH_TOKEN_MISSING',
        message: 'Authorization header with Bearer token is required',
      },
    });
    expect((res.body as { error: { timestamp: string } }).error.timestamp).toBeDefined();
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 when Authorization header does not start with Bearer', async () => {
    const authService = createMockAuthService();
    const middleware = authMiddleware(authService);
    const req = createMockRequest({ authorization: 'Basic abc123' });
    const res = createMockResponse();
    const next = vi.fn();

    await middleware(req, res as unknown as Response, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({
      error: { code: 'AUTH_TOKEN_MISSING' },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should authenticate user and attach to req.user on valid token', async () => {
    const authService = createMockAuthService();
    const middleware = authMiddleware(authService);
    const req = createMockRequest({ authorization: 'Bearer valid-token' });
    const res = createMockResponse();
    const next = vi.fn();

    await middleware(req, res as unknown as Response, next);

    expect(authService.authenticate).toHaveBeenCalledWith('valid-token');
    expect(req.user).toEqual(testUser);
    expect(next).toHaveBeenCalled();
  });

  it('should return 401 with AuthError details when token is expired', async () => {
    const authService = createMockAuthService({
      authenticate: vi.fn().mockRejectedValue(
        new AuthError('AUTH_TOKEN_EXPIRED', 'Token has expired'),
      ),
    });
    const middleware = authMiddleware(authService);
    const req = createMockRequest({ authorization: 'Bearer expired-token' });
    const res = createMockResponse();
    const next = vi.fn();

    await middleware(req, res as unknown as Response, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({
      error: {
        code: 'AUTH_TOKEN_EXPIRED',
        message: 'Token has expired',
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 with AuthError details when token is invalid', async () => {
    const authService = createMockAuthService({
      authenticate: vi.fn().mockRejectedValue(
        new AuthError('AUTH_TOKEN_INVALID', 'Token signature is invalid'),
      ),
    });
    const middleware = authMiddleware(authService);
    const req = createMockRequest({ authorization: 'Bearer bad-token' });
    const res = createMockResponse();
    const next = vi.fn();

    await middleware(req, res as unknown as Response, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({
      error: {
        code: 'AUTH_TOKEN_INVALID',
        message: 'Token signature is invalid',
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 with generic error for unexpected errors', async () => {
    const authService = createMockAuthService({
      authenticate: vi.fn().mockRejectedValue(new Error('Unexpected failure')),
    });
    const middleware = authMiddleware(authService);
    const req = createMockRequest({ authorization: 'Bearer some-token' });
    const res = createMockResponse();
    const next = vi.fn();

    await middleware(req, res as unknown as Response, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({
      error: {
        code: 'AUTH_INTERNAL_ERROR',
        message: 'Authentication failed',
      },
    });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requirePermission', () => {
  it('should return 401 when req.user is not set', () => {
    const middleware = requirePermission('orders', 'read');
    const req = createMockRequest() as AuthenticatedRequest;
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res as unknown as Response, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({
      error: {
        code: 'AUTH_NOT_AUTHENTICATED',
        message: 'Authentication is required',
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 403 when user lacks required permission', () => {
    const middleware = requirePermission('agents', 'delete');
    const req = createMockRequest() as AuthenticatedRequest;
    req.user = testUser; // has orders:read, orders:write, role: operator
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res as unknown as Response, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({
      error: {
        code: 'AUTH_PERMISSION_DENIED',
        message: 'Permission denied: requires agents:delete',
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should call next() when user has the required permission', () => {
    const middleware = requirePermission('orders', 'read');
    const req = createMockRequest() as AuthenticatedRequest;
    req.user = testUser;
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(0); // not set
  });

  it('should allow access based on role-derived permissions', () => {
    const middleware = requirePermission('sessions', 'read');
    const req = createMockRequest() as AuthenticatedRequest;
    // operator role has sessions:read in default mapping
    req.user = makeUser({ roles: ['operator'] });
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalled();
  });

  it('should support custom role permission mapping', () => {
    const customMap = { tester: ['reports:read'] };
    const middleware = requirePermission('reports', 'read', customMap);
    const req = createMockRequest() as AuthenticatedRequest;
    req.user = makeUser({ roles: ['tester'] });
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalled();
  });

  it('should include resource:action in 403 error message', () => {
    const middleware = requirePermission('tools', 'execute');
    const req = createMockRequest() as AuthenticatedRequest;
    req.user = makeUser();
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res as unknown as Response, next);

    expect(res.statusCode).toBe(403);
    expect((res.body as { error: { message: string } }).error.message).toContain('tools:execute');
  });
});

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    tenantId: 'tenant-1',
    roles: [],
    permissions: [],
    ...overrides,
  };
}
