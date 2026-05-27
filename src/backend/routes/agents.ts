/**
 * Agent Routes
 *
 * Provides:
 * - GET  /api/v1/agents  - List registered agents (with optional filters)
 * - POST /api/v1/agents  - Register a new agent
 *
 * Requires authentication (req.user must be set by auth middleware).
 */

import { Router } from 'express';
import type { Response } from 'express';
import pino from 'pino';

import type { AuthenticatedRequest } from '../auth/middleware.js';
import type { TracedRequest } from '../observability/trace-id.js';
import type { AgentPlatform, AgentDefinition, AgentFilter } from '../../agent-runtime/platform/types.js';
import type { AgentStatus } from '../../shared/types.js';

const logger = pino({ name: 'routes-agents' });

/** Combined request type with auth and trace */
type AppRequest = AuthenticatedRequest & TracedRequest;

/**
 * Create the agents router.
 * Accepts an AgentPlatform instance for dependency injection.
 */
export function createAgentsRouter(agentPlatform: AgentPlatform): Router {
  const router = Router();

  /**
   * GET /api/v1/agents
   * List agents with optional query filters: type, status, tenantId
   */
  router.get('/', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const filter: AgentFilter = {};

      if (typeof req.query.type === 'string') {
        filter.type = req.query.type;
      }
      if (typeof req.query.status === 'string') {
        filter.status = req.query.status as AgentStatus;
      }
      // Use the authenticated user's tenantId by default
      filter.tenantId = req.user?.tenantId;

      const agents = await agentPlatform.listAgents(filter);

      res.json({ agents, total: agents.length });
    } catch (error) {
      logger.error({ error, traceId: req.traceId }, 'Failed to list agents');
      res.status(500).json({
        error: {
          code: 'AGENT_LIST_FAILED',
          message: 'Failed to list agents',
          traceId: req.traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  /**
   * POST /api/v1/agents
   * Register a new agent definition.
   * Body: { name, type, version, description, tools, systemPrompt, config }
   */
  router.post('/', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const { name, type, version, description, tools, systemPrompt, config } = req.body as Partial<AgentDefinition>;

      if (!name || !type || !version) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'name, type, and version are required',
            traceId: req.traceId ?? 'unknown',
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const definition: AgentDefinition = {
        id: '', // Will be assigned by platform
        name,
        type,
        version,
        description: description ?? '',
        tools: tools ?? [],
        systemPrompt: systemPrompt ?? '',
        config: config ?? {},
      };

      const tenantId = req.user?.tenantId ?? 'default';
      const instance = await agentPlatform.registerAgent(definition, tenantId);

      res.status(201).json({ agent: instance });
    } catch (error) {
      logger.error({ error, traceId: req.traceId }, 'Failed to register agent');
      res.status(500).json({
        error: {
          code: 'AGENT_REGISTER_FAILED',
          message: 'Failed to register agent',
          traceId: req.traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  return router;
}
