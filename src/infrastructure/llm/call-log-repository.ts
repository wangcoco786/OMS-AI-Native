/**
 * LLM Call Log Repository
 *
 * Persists LLM call logs to the llm_call_logs PostgreSQL table.
 * Provides query methods for usage analytics and audit.
 */

import pino from 'pino';

import type { PostgresDatabaseService } from '../database/database-service.js';
import type { LLMCallLog, UsageStats } from './types.js';

/**
 * LLMCallLogRepository handles persistence of LLM call logs
 * to the llm_call_logs table in PostgreSQL.
 */
export class LLMCallLogRepository {
  private readonly db: PostgresDatabaseService;
  private readonly logger: pino.Logger;

  constructor(db: PostgresDatabaseService, options?: { logger?: pino.Logger }) {
    this.db = db;
    this.logger = (options?.logger ?? pino({ name: 'llm-call-log-repository' })).child({
      component: 'llm-call-log-repository',
    });
  }

  /**
   * Persist a single LLM call log entry to the database.
   */
  async save(log: LLMCallLog): Promise<void> {
    const sql = `
      INSERT INTO llm_call_logs (tenant_id, session_id, model, input_tokens, output_tokens, latency_ms, status, error_message)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;

    const params = [
      log.tenantId,
      log.sessionId || null,
      log.model,
      log.inputTokens,
      log.outputTokens,
      log.latencyMs,
      log.status,
      log.errorMessage || null,
    ];

    await this.db.transaction(async (tx) => {
      await tx.query(sql, params);
    });

    this.logger.debug(
      { tenantId: log.tenantId, sessionId: log.sessionId, status: log.status },
      'LLM call log persisted',
    );
  }

  /**
   * Find call logs for a specific tenant with optional pagination.
   */
  async findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<LLMCallLog[]> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const sql = `
      SELECT tenant_id, session_id, model, input_tokens, output_tokens, latency_ms, status, error_message
      FROM llm_call_logs
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const rows = await this.db.transaction(async (tx) => {
      return tx.query<LLMCallLogRow>(sql, [tenantId, limit, offset]);
    });

    return rows.map(mapRowToCallLog);
  }

  /**
   * Get aggregated usage statistics for a tenant within a date range.
   */
  async getUsageStats(tenantId: string, startDate: Date, endDate: Date): Promise<UsageStats> {
    const sql = `
      SELECT
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COUNT(*) AS total_calls
      FROM llm_call_logs
      WHERE tenant_id = $1
        AND status = 'success'
        AND created_at >= $2
        AND created_at <= $3
    `;

    const rows = await this.db.transaction(async (tx) => {
      return tx.query<UsageStatsRow>(sql, [tenantId, startDate, endDate]);
    });

    const row = rows[0];

    return {
      inputTokens: Number(row?.input_tokens ?? 0),
      outputTokens: Number(row?.output_tokens ?? 0),
      totalCalls: Number(row?.total_calls ?? 0),
      period: `${startDate.toISOString()}/${endDate.toISOString()}`,
    };
  }
}

/** Database row shape for llm_call_logs */
interface LLMCallLogRow {
  tenant_id: string;
  session_id: string | null;
  model: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  status: string;
  error_message: string | null;
}

/** Database row shape for aggregated usage stats */
interface UsageStatsRow {
  input_tokens: string | number;
  output_tokens: string | number;
  total_calls: string | number;
}

/** Map a database row to an LLMCallLog domain object */
function mapRowToCallLog(row: LLMCallLogRow): LLMCallLog {
  return {
    tenantId: row.tenant_id,
    sessionId: row.session_id ?? '',
    model: row.model,
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    latencyMs: Number(row.latency_ms),
    status: row.status as 'success' | 'error',
    errorMessage: row.error_message ?? undefined,
  };
}
