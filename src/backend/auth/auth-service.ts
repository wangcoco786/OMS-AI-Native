/**
 * Auth Service implementation.
 *
 * Provides JWT-based authentication with IAM SSO integration placeholder.
 */

import jwt from 'jsonwebtoken';
import pino from 'pino';
import type { AuthConfig, AuthService, SSOProvider, TokenPayload, User } from './types.js';
import { AuthError } from './types.js';

const logger = pino({ name: 'auth-service' });

/** Default auth configuration */
const DEFAULT_CONFIG: AuthConfig = {
  ssoProvider: 'internal',
  jwtSecret: 'change-me-in-production',
  tokenExpiry: 3600, // 1 hour
};

/**
 * Creates an AuthService instance with the given configuration and optional SSO provider.
 */
export function createAuthService(
  config: Partial<AuthConfig> = {},
  ssoProvider?: SSOProvider,
): AuthService {
  const resolvedConfig: AuthConfig = { ...DEFAULT_CONFIG, ...config };

  return {
    authenticate: (token: string) => authenticate(resolvedConfig, ssoProvider, token),
    generateToken: (user: User) => generateToken(resolvedConfig, user),
    refreshToken: (token: string) => refreshToken(resolvedConfig, token),
  };
}

/**
 * Verify a JWT token and return the authenticated user.
 * If an SSO provider is configured, it will be tried first.
 */
async function authenticate(
  config: AuthConfig,
  ssoProvider: SSOProvider | undefined,
  token: string,
): Promise<User> {
  // Try SSO provider first if available
  if (ssoProvider) {
    try {
      const user = await ssoProvider.validateToken(token);
      if (user) {
        logger.info({ userId: user.id, tenantId: user.tenantId }, 'SSO authentication successful');
        return user;
      }
    } catch (error) {
      logger.warn({ error }, 'SSO validation failed, falling back to JWT');
    }
  }

  // Fall back to JWT verification
  return verifyJwt(config, token);
}

/**
 * Verify a JWT token and extract the user payload.
 */
function verifyJwt(config: AuthConfig, token: string): User {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as TokenPayload;

    return {
      id: payload.userId,
      tenantId: payload.tenantId,
      roles: payload.roles,
      permissions: payload.permissions,
    };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      logger.warn('Token expired');
      throw new AuthError('AUTH_TOKEN_EXPIRED', 'Token has expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      if (error.message === 'jwt malformed' || error.message === 'jwt must be provided') {
        logger.warn({ message: error.message }, 'Malformed token');
        throw new AuthError('AUTH_TOKEN_MALFORMED', 'Token is malformed');
      }
      logger.warn({ message: error.message }, 'Invalid token');
      throw new AuthError('AUTH_TOKEN_INVALID', 'Token signature is invalid');
    }
    logger.error({ error }, 'Unexpected error during token verification');
    throw new AuthError('AUTH_TOKEN_INVALID', 'Token verification failed');
  }
}

/**
 * Generate a new JWT token for a user.
 */
function generateToken(config: AuthConfig, user: User): string {
  const payload: TokenPayload = {
    userId: user.id,
    tenantId: user.tenantId,
    roles: user.roles,
    permissions: user.permissions,
  };

  const token = jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.tokenExpiry,
  });

  logger.info({ userId: user.id, tenantId: user.tenantId }, 'Token generated');
  return token;
}

/**
 * Refresh an existing token with a new expiry.
 * Verifies the current token and issues a new one.
 */
function refreshToken(config: AuthConfig, token: string): string {
  const user = verifyJwt(config, token);
  logger.info({ userId: user.id }, 'Token refreshed');
  return generateToken(config, user);
}
