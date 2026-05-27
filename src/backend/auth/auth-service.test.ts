import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { createAuthService } from './auth-service.js';
import { AuthError } from './types.js';
import type { SSOProvider, User } from './types.js';

const TEST_SECRET = 'test-jwt-secret-key';
const TEST_EXPIRY = 3600;

const testUser: User = {
  id: 'user-123',
  tenantId: 'tenant-456',
  roles: ['admin', 'viewer'],
  permissions: ['orders:read', 'orders:write'],
};

function createTestService(ssoProvider?: SSOProvider) {
  return createAuthService(
    { jwtSecret: TEST_SECRET, tokenExpiry: TEST_EXPIRY, ssoProvider: 'internal' },
    ssoProvider,
  );
}

describe('AuthService', () => {
  describe('generateToken()', () => {
    it('should generate a valid JWT token', () => {
      const service = createTestService();
      const token = service.generateToken(testUser);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('should include user fields in the token payload', () => {
      const service = createTestService();
      const token = service.generateToken(testUser);
      const decoded = jwt.decode(token) as Record<string, unknown>;

      expect(decoded.userId).toBe(testUser.id);
      expect(decoded.tenantId).toBe(testUser.tenantId);
      expect(decoded.roles).toEqual(testUser.roles);
      expect(decoded.permissions).toEqual(testUser.permissions);
    });

    it('should set expiry based on config', () => {
      const service = createTestService();
      const token = service.generateToken(testUser);
      const decoded = jwt.decode(token) as { iat: number; exp: number };

      expect(decoded.exp - decoded.iat).toBe(TEST_EXPIRY);
    });
  });

  describe('authenticate()', () => {
    it('should return user from a valid token', async () => {
      const service = createTestService();
      const token = service.generateToken(testUser);
      const user = await service.authenticate(token);

      expect(user).toEqual(testUser);
    });

    it('should throw AUTH_TOKEN_EXPIRED for expired tokens', async () => {
      const service = createTestService();
      const expiredToken = jwt.sign(
        { userId: testUser.id, tenantId: testUser.tenantId, roles: [], permissions: [] },
        TEST_SECRET,
        { expiresIn: -10 },
      );

      await expect(service.authenticate(expiredToken)).rejects.toThrow(AuthError);
      await expect(service.authenticate(expiredToken)).rejects.toMatchObject({
        code: 'AUTH_TOKEN_EXPIRED',
      });
    });

    it('should throw AUTH_TOKEN_INVALID for tokens with wrong signature', async () => {
      const service = createTestService();
      const badToken = jwt.sign(
        { userId: 'u1', tenantId: 't1', roles: [], permissions: [] },
        'wrong-secret',
      );

      await expect(service.authenticate(badToken)).rejects.toThrow(AuthError);
      await expect(service.authenticate(badToken)).rejects.toMatchObject({
        code: 'AUTH_TOKEN_INVALID',
      });
    });

    it('should throw AUTH_TOKEN_MALFORMED for non-JWT strings', async () => {
      const service = createTestService();

      await expect(service.authenticate('not-a-jwt')).rejects.toThrow(AuthError);
      await expect(service.authenticate('not-a-jwt')).rejects.toMatchObject({
        code: 'AUTH_TOKEN_MALFORMED',
      });
    });

    it('should throw AUTH_TOKEN_MALFORMED for empty string', async () => {
      const service = createTestService();

      await expect(service.authenticate('')).rejects.toThrow(AuthError);
      await expect(service.authenticate('')).rejects.toMatchObject({
        code: 'AUTH_TOKEN_MALFORMED',
      });
    });
  });

  describe('refreshToken()', () => {
    it('should return a valid token with same user data', () => {
      const service = createTestService();
      const originalToken = service.generateToken(testUser);
      const refreshedToken = service.refreshToken(originalToken);

      expect(refreshedToken).toBeDefined();
      expect(typeof refreshedToken).toBe('string');
      expect(refreshedToken.split('.')).toHaveLength(3);

      // Verify the refreshed token is itself valid
      const decoded = jwt.decode(refreshedToken) as Record<string, unknown>;
      expect(decoded.userId).toBe(testUser.id);
      expect(decoded.tenantId).toBe(testUser.tenantId);
    });

    it('should preserve user data in refreshed token', () => {
      const service = createTestService();
      const originalToken = service.generateToken(testUser);
      const refreshedToken = service.refreshToken(originalToken);
      const decoded = jwt.decode(refreshedToken) as Record<string, unknown>;

      expect(decoded.userId).toBe(testUser.id);
      expect(decoded.tenantId).toBe(testUser.tenantId);
      expect(decoded.roles).toEqual(testUser.roles);
      expect(decoded.permissions).toEqual(testUser.permissions);
    });

    it('should throw AUTH_TOKEN_EXPIRED for expired tokens', () => {
      const service = createTestService();
      const expiredToken = jwt.sign(
        { userId: 'u1', tenantId: 't1', roles: [], permissions: [] },
        TEST_SECRET,
        { expiresIn: -10 },
      );

      expect(() => service.refreshToken(expiredToken)).toThrow(AuthError);
    });

    it('should throw AUTH_TOKEN_INVALID for tokens with wrong signature', () => {
      const service = createTestService();
      const badToken = jwt.sign(
        { userId: 'u1', tenantId: 't1', roles: [], permissions: [] },
        'wrong-secret',
      );

      expect(() => service.refreshToken(badToken)).toThrow(AuthError);
    });
  });

  describe('SSO Provider integration', () => {
    it('should use SSO provider when available and token is valid', async () => {
      const ssoUser: User = {
        id: 'sso-user-1',
        tenantId: 'sso-tenant',
        roles: ['sso-role'],
        permissions: ['sso:access'],
      };

      const ssoProvider: SSOProvider = {
        validateToken: vi.fn().mockResolvedValue(ssoUser),
      };

      const service = createTestService(ssoProvider);
      const user = await service.authenticate('sso-token-abc');

      expect(user).toEqual(ssoUser);
      expect(ssoProvider.validateToken).toHaveBeenCalledWith('sso-token-abc');
    });

    it('should fall back to JWT when SSO returns null', async () => {
      const ssoProvider: SSOProvider = {
        validateToken: vi.fn().mockResolvedValue(null),
      };

      const service = createTestService(ssoProvider);
      const token = service.generateToken(testUser);
      const user = await service.authenticate(token);

      expect(user).toEqual(testUser);
      expect(ssoProvider.validateToken).toHaveBeenCalledWith(token);
    });

    it('should fall back to JWT when SSO throws an error', async () => {
      const ssoProvider: SSOProvider = {
        validateToken: vi.fn().mockRejectedValue(new Error('SSO service unavailable')),
      };

      const service = createTestService(ssoProvider);
      const token = service.generateToken(testUser);
      const user = await service.authenticate(token);

      expect(user).toEqual(testUser);
    });
  });

  describe('AuthError', () => {
    it('should have correct properties', () => {
      const error = new AuthError('AUTH_TOKEN_EXPIRED', 'Token has expired');

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('AuthError');
      expect(error.code).toBe('AUTH_TOKEN_EXPIRED');
      expect(error.message).toBe('Token has expired');
      expect(error.timestamp).toBeDefined();
      expect(new Date(error.timestamp).getTime()).not.toBeNaN();
    });
  });
});
