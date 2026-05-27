/**
 * Security Audit Logger
 *
 * Records authentication failures and permission denials to the audit_logs table.
 * Uses fire-and-forget pattern to avoid blocking request responses.
 */

import pino from 'pino';
import type { PostgresDatabaseService } from '../../infrastructure/database/database-service.js';
import type { User } from './types.js';

/** Audit log entry structure matching the audit_logs table */
interface AuditLogEntry {
  tenant_id: string;
  actor_id: string;
  actor_type: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown>;
}

/**
 * SecurityAuditLogger persists security events (auth failures, permission denials)
 * to the audit_logs table using a fire-and-forget pattern.
 */
export class SecurityAuditLogger {
  private readonly db: PostgresDatabaseService;
  private readonly logger: pino.Logger;

  constructor(db: PostgresDatabaseService, logger?: pino.Logger) {
    this.db = db;
    this.logger = (logger ?? pino({ name: 'security-audit' })).child({
      component: 'audit-logger',
    });
  }

  /**
   * Log an authentication failure event.
   * Fire-and-forget: errors are logged but do not propagate.
   */
  async logAuthFailure(
    actorId: string,
    reason: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    const entry: AuditLogEntry = {
      tenant_id: '00000000-0000-0000-0000-000000000000', // system-level, no tenant context
      actor_id: actorId,
      actor_type: 'user',
      action: 'auth.failure',
      resource_type: 'auth',
      resource_id: null,
      details: { reason, ...details },
    };

    this.persistEntry(entry);
  }

  /**
   * Log a permission denied event.
   * Fire-and-forget: errors are logged but do not propagate.
   */
  async logPermissionDenied(
    user: User,
    resource: string,
    action: string,
  ): Promise<void> {
    const entry: AuditLogEntry = {
      tenant_id: user.tenantId,
      actor_id: user.id,
      actor_type: 'user',
      action: 'permission.denied',
      resource_type: resource,
      resource_id: null,
      details: {
        reason: `Permission denied: requires ${resource}:${action}`,
        attempted_action: action,
        user_roles: user.roles,
        user_permissions: user.permissions,
      },
    };

    this.persistEntry(entry);
  }

  /**
   * Persist an audit log entry to the database.
   * Uses fire-and-forget: catches and logs errors without propagating.
   */
  private persistEntry(entry: AuditLogEntry): void {
    const sql = `
      INSERT INTO audit_logs (tenant_id, actor_id, actor_type, action, resource_type, resource_id, details)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;

    const params = [
      entry.tenant_id,
      entry.actor_id,
      entry.actor_type,
      entry.action,
      entry.resource_type,
      entry.resource_id,
      JSON.stringify(entry.details),
    ];

    // Fire-and-forget: execute without awaiting, catch errors silently
    this.db.query(sql, params, entry.tenant_id).catch((error) => {
      this.logger.error(
        { error, entry },
        'Failed to persist security audit log entry',
      );
    });
  }
}
