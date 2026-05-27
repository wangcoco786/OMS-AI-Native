/**
 * Decision Step Logger
 *
 * Records the complete decision chain of Agent interactions:
 * - Intent recognition
 * - Tool selection
 * - Tool call
 * - Response generation
 *
 * Each step is associated with the same trace_id and written to the audit_logs table
 * using a fire-and-forget pattern to avoid blocking request processing.
 */

import pino from 'pino';
import type { PostgresDatabaseService } from '../../infrastructure/database/database-service.js';

/** Valid decision step types in the Agent interaction chain */
export type DecisionStep =
  | 'intent_recognition'
  | 'tool_selection'
  | 'tool_call'
  | 'response_generation';

/** Details for a decision step log entry */
export interface DecisionStepDetails {
  /** The agent ID performing the action */
  agentId?: string;
  /** The tenant context */
  tenantId: string;
  /** The session ID */
  sessionId?: string;
  /** Step-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * DecisionLogger records Agent decision steps to the audit_logs table.
 * Uses fire-and-forget pattern to avoid blocking the request flow.
 */
export class DecisionLogger {
  private readonly db: PostgresDatabaseService;
  private readonly logger: pino.Logger;

  constructor(db: PostgresDatabaseService, logger?: pino.Logger) {
    this.db = db;
    this.logger = (logger ?? pino({ name: 'decision-logger' })).child({
      component: 'decision-logger',
    });
  }

  /**
   * Log a decision step in the Agent interaction chain.
   *
   * Fire-and-forget: errors are logged but do not propagate to the caller.
   *
   * @param traceId - The trace ID linking all steps in this interaction
   * @param step - The type of decision step
   * @param details - Additional context for the step
   */
  logStep(traceId: string, step: DecisionStep, details: DecisionStepDetails): void {
    const sql = `
      INSERT INTO audit_logs (tenant_id, trace_id, actor_id, actor_type, action, resource_type, resource_id, details)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;

    const params = [
      details.tenantId,
      traceId,
      details.agentId ?? 'system',
      'agent',
      `decision.${step}`,
      'agent_session',
      details.sessionId ?? null,
      JSON.stringify({
        step,
        ...details.metadata,
      }),
    ];

    // Fire-and-forget: execute without awaiting, catch errors silently
    this.db.query(sql, params, details.tenantId).catch((error) => {
      this.logger.error(
        { error, traceId, step },
        'Failed to persist decision step log entry',
      );
    });
  }
}
