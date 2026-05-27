/**
 * Auth Service type definitions.
 *
 * Interfaces for IAM SSO authentication and JWT token management.
 */

/** Auth module configuration */
export interface AuthConfig {
  /** SSO provider identifier (e.g., 'internal', 'okta', 'azure-ad') */
  ssoProvider: string;
  /** Secret key for JWT signing and verification */
  jwtSecret: string;
  /** Token expiry duration in seconds (default: 3600 = 1 hour) */
  tokenExpiry: number;
}

/** Authenticated user representation */
export interface User {
  id: string;
  tenantId: string;
  roles: string[];
  permissions: string[];
}

/** JWT token payload structure */
export interface TokenPayload {
  userId: string;
  tenantId: string;
  roles: string[];
  permissions: string[];
  iat?: number;
  exp?: number;
}

/** SSO Provider interface - placeholder for future IAM integration */
export interface SSOProvider {
  /** Validate an SSO token and return the associated user, or null if invalid */
  validateToken(token: string): Promise<User | null>;
}

/** Auth service interface */
export interface AuthService {
  /** Verify a JWT token and return the authenticated user */
  authenticate(token: string): Promise<User>;
  /** Generate a new JWT token for a user */
  generateToken(user: User): string;
  /** Refresh an existing token with a new expiry */
  refreshToken(token: string): string;
}

/** Auth error codes */
export type AuthErrorCode =
  | 'AUTH_TOKEN_EXPIRED'
  | 'AUTH_TOKEN_INVALID'
  | 'AUTH_TOKEN_MALFORMED'
  | 'AUTH_SSO_FAILED';

/** Structured auth error */
export class AuthError extends Error {
  public readonly code: AuthErrorCode;
  public readonly timestamp: string;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.timestamp = new Date().toISOString();
  }
}
