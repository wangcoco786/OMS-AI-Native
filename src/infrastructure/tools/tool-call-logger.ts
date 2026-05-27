/**
 * Tool Call Logger
 *
 * Persists tool call records to the tool_calls table for observability
 * and audit purposes. Uses a fire-and-forget pattern so logging does
 * not block the tool response.
 *
 * Requirements: 3.5
 */

import pino from 'pino';

import type { PostgresDatabaseService } from '../database/database-service.js';
import type { ToolCallRequest, ToolCallResult } from './types.js';

/**
 * ToolCallLogger records every tool invocation (success or failure)
 * into the tool_calls PostgreSQL table.
 */
export class ToolCallLogger {
  private readonly logger: pino.Logger;

  constructor(
    private readonly db: PostgresDatabaseService,
    options?: { logger?: pino.Logger },
  ) {
    this.logger = (options?.logger ?? pino({ name: 'tool-call-logger' })).child({
      component: 'tool-call-logger',
    });
  }

  /**
   * Log a tool call record to the tool_calls table.
   *
   * This method is designed to be called in a fire-and-forget manner.
   * It catches and logs any errors internally so it never throws.
   *
   * @param request - The original tool call request
   * @param result - The result of the tool execution
   */
  async log(request: ToolCallRequest, result: ToolCallResult): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO tool_calls (tool_name, caller_id, tenant_id, trace_id, input, output, success, error_message, execution_time_ms)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            request.toolName,
            request.callerId,
            request.tenantId,
            request.traceId,
            JSON.stringify(request.input),
            result.output !== undefined ? JSON.stringify(result.output) : null,
            result.success,
            result.error?.message ?? null,
            result.executionTime,
          ],
        );
      });

      this.logger.debug(
        {
          toolName: request.toolName,
          traceId: request.traceId,
          success: result.success,
          executionTimeMs: result.executionTime,
        },
        'Tool call logged successfully',
      );
    } catch (error) {
      this.logger.error(
        {
          error,
          toolName: request.toolName,
          traceId: request.traceId,
        },
        'Failed to log tool call',
      );
    }
  }
}
