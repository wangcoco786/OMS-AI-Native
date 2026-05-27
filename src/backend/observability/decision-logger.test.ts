/**
 * Tests for Decision Step Logger.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DecisionLogger, type DecisionStep, type DecisionStepDetails } from './decision-logger.js';
import type { PostgresDatabaseService } from '../../infrastructure/database/database-service.js';

describe('DecisionLogger', () => {
  let mockDb: { query: ReturnType<typeof vi.fn> };
  let mockLogger: { child: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let decisionLogger: DecisionLogger;

  beforeEach(() => {
    mockDb = {
      query: vi.fn().mockResolvedValue([]),
    };

    mockLogger = {
      child: vi.fn().mockReturnValue({
        error: vi.fn(),
      }),
      error: vi.fn(),
    };

    decisionLogger = new DecisionLogger(
      mockDb as unknown as PostgresDatabaseService,
      mockLogger as unknown as import('pino').Logger,
    );
  });

  it('should log an intent_recognition step to audit_logs', () => {
    const traceId = 'trace-123';
    const step: DecisionStep = 'intent_recognition';
    const details: DecisionStepDetails = {
      tenantId: 'tenant-abc',
      agentId: 'agent-1',
      sessionId: 'session-xyz',
      metadata: { intent: 'order_query' },
    };

    decisionLogger.logStep(traceId, step, details);

    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_logs'),
      expect.arrayContaining([
        'tenant-abc',
        'trace-123',
        'agent-1',
        'agent',
        'decision.intent_recognition',
        'agent_session',
        'session-xyz',
        expect.any(String),
      ]),
      'tenant-abc',
    );
  });

  it('should log a tool_selection step', () => {
    const traceId = 'trace-456';
    const step: DecisionStep = 'tool_selection';
    const details: DecisionStepDetails = {
      tenantId: 'tenant-def',
      agentId: 'agent-2',
      metadata: { selectedTool: 'query_orders' },
    };

    decisionLogger.logStep(traceId, step, details);

    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_logs'),
      expect.arrayContaining([
        'tenant-def',
        'trace-456',
        'agent-2',
        'agent',
        'decision.tool_selection',
      ]),
      'tenant-def',
    );
  });

  it('should log a tool_call step', () => {
    const traceId = 'trace-789';
    const step: DecisionStep = 'tool_call';
    const details: DecisionStepDetails = {
      tenantId: 'tenant-ghi',
      agentId: 'agent-3',
      sessionId: 'session-abc',
      metadata: { toolName: 'query_orders', input: { orderNo: 'ORD-001' } },
    };

    decisionLogger.logStep(traceId, step, details);

    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_logs'),
      expect.arrayContaining([
        'tenant-ghi',
        'trace-789',
        'agent-3',
        'agent',
        'decision.tool_call',
      ]),
      'tenant-ghi',
    );
  });

  it('should log a response_generation step', () => {
    const traceId = 'trace-101';
    const step: DecisionStep = 'response_generation';
    const details: DecisionStepDetails = {
      tenantId: 'tenant-jkl',
      agentId: 'agent-4',
      sessionId: 'session-def',
      metadata: { tokensGenerated: 150 },
    };

    decisionLogger.logStep(traceId, step, details);

    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_logs'),
      expect.arrayContaining([
        'tenant-jkl',
        'trace-101',
        'agent-4',
        'agent',
        'decision.response_generation',
      ]),
      'tenant-jkl',
    );
  });

  it('should use "system" as default actor_id when agentId is not provided', () => {
    const traceId = 'trace-202';
    const step: DecisionStep = 'intent_recognition';
    const details: DecisionStepDetails = {
      tenantId: 'tenant-mno',
    };

    decisionLogger.logStep(traceId, step, details);

    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_logs'),
      expect.arrayContaining(['system']),
      'tenant-mno',
    );
  });

  it('should use null as resource_id when sessionId is not provided', () => {
    const traceId = 'trace-303';
    const step: DecisionStep = 'tool_selection';
    const details: DecisionStepDetails = {
      tenantId: 'tenant-pqr',
      agentId: 'agent-5',
    };

    decisionLogger.logStep(traceId, step, details);

    const callArgs = mockDb.query.mock.calls[0][1] as unknown[];
    // resource_id is the 7th parameter (index 6)
    expect(callArgs[6]).toBeNull();
  });

  it('should not throw when database query fails (fire-and-forget)', async () => {
    mockDb.query.mockRejectedValue(new Error('DB connection failed'));

    // Should not throw
    expect(() => {
      decisionLogger.logStep('trace-404', 'intent_recognition', {
        tenantId: 'tenant-stu',
      });
    }).not.toThrow();
  });

  it('should serialize metadata in the details JSON field', () => {
    const traceId = 'trace-505';
    const step: DecisionStep = 'tool_call';
    const details: DecisionStepDetails = {
      tenantId: 'tenant-vwx',
      agentId: 'agent-6',
      metadata: { toolName: 'query_orders', executionTimeMs: 250 },
    };

    decisionLogger.logStep(traceId, step, details);

    const callArgs = mockDb.query.mock.calls[0][1] as string[];
    // details JSON is the 8th parameter (index 7)
    const parsedDetails = JSON.parse(callArgs[7]);
    expect(parsedDetails.step).toBe('tool_call');
    expect(parsedDetails.toolName).toBe('query_orders');
    expect(parsedDetails.executionTimeMs).toBe(250);
  });
});
