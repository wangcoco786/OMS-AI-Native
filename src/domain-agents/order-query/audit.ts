/**
 * Order Query Audit Logger
 *
 * Records every order query operation to the audit_logs table.
 * Uses fire-and-forget pattern to avoid blocking query responses.
 *
 * Requirements: 9.7
 */

import pino from 'pino';

import type { PostgresDatabaseService } from '../../infrastructure/database/database-service.js';
import type { QueryOrdersInput } from './order-query-tool.js';

/** Audit log entry for an order query */
export interface OrderQueryAuditEntry {
  userId: string;
  tenantId: string;
  queryConditions: QueryOrdersInput;
  resultCount: number;
  timestamp: string;
}

/**
 * OrderQueryAuditLogger persists order query audit events
 * to the audit_logs table using a fire-and-forget pattern.
 */
export class OrderQueryAuditLogger {
  private readonly logger: pino.Logger;

  constructor(
    private readonly db: PostgresDatabaseService,
    options?: { logger?: pino.Logger },
  ) {
    this.logger = (options?.logger ?? pino({ name: 'order-query-audit' })).child({
      component: 'order-query-audit',
    });
  }

  /**
   * Log an order query operation.
   *
   * Fire-and-forget: the promise is not awaited by the caller.
   * Errors are caught and logged without propagating.
   */
  log(entry: OrderQueryAuditEntry): void {
    const sql = `
      INSERT INTO audit_logs (tenant_id, actor_id, actor_type, action, resource_type, resource_id, details)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;

    const params = [
      entry.tenantId,
      entry.userId,
      'user',
      'order.query',
      'orders',
      null,
      JSON.stringify({
        query_conditions: entry.queryConditions,
        result_count: entry.resultCount,
        timestamp: entry.timestamp,
      }),
    ];

    this.db.query(sql, params, entry.tenantId).catch((error) => {
      this.logger.error(
        { error, entry },
        'Failed to persist order query audit log',
      );
    });
  }
}
