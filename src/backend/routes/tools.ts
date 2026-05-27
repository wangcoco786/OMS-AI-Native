/**
 * Tool Routes
 *
 * Provides:
 * - GET  /api/v1/tools  - List registered tools (with optional filters)
 * - POST /api/v1/tools  - Register a new tool
 *
 * Requires authentication (req.user must be set by auth middleware).
 */

import { Router } from 'express';
import type { Response } from 'express';
import pino from 'pino';

import type { AuthenticatedRequest } from '../auth/middleware.js';
import type { TracedRequest } from '../observability/trace-id.js';
import type { MCPToolRegistry, ToolFilter } from '../../infrastructure/tools/types.js';
import type { MCPToolDefinition } from '../../agent-runtime/sdk/mcp-converter.js';

const logger = pino({ name: 'routes-tools' });

/** Combined request type with auth and trace */
type AppRequest = AuthenticatedRequest & TracedRequest;

/**
 * Create the tools router.
 * Accepts an MCPToolRegistry instance for dependency injection.
 */
export function createToolsRouter(toolRegistry: MCPToolRegistry): Router {
  const router = Router();

  /**
   * GET /api/v1/tools
   * List tools with optional query filters: name, status, sandbox
   */
  router.get('/', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const filter: ToolFilter = {};

      if (typeof req.query.name === 'string') {
        filter.name = req.query.name;
      }
      if (typeof req.query.status === 'string') {
        filter.status = req.query.status as 'active' | 'inactive';
      }
      if (typeof req.query.sandbox === 'string') {
        filter.sandbox = req.query.sandbox as 'docker' | 'v8-isolate';
      }

      const tools = await toolRegistry.discover(filter);

      res.json({ tools, total: tools.length });
    } catch (error) {
      logger.error({ error, traceId: req.traceId }, 'Failed to list tools');
      res.status(500).json({
        error: {
          code: 'TOOL_LIST_FAILED',
          message: 'Failed to list tools',
          traceId: req.traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  /**
   * POST /api/v1/tools
   * Register a new tool definition.
   * Body: { name, description, inputSchema, outputSchema, version, permissions, timeout, sandbox }
   */
  router.post('/', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const { name, description, inputSchema, outputSchema, version, permissions, timeout, sandbox } =
        req.body as Partial<MCPToolDefinition>;

      if (!name || !inputSchema || !outputSchema || !version) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'name, inputSchema, outputSchema, and version are required',
            traceId: req.traceId ?? 'unknown',
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const toolDefinition: MCPToolDefinition = {
        name,
        description: description ?? '',
        inputSchema,
        outputSchema,
        version,
        permissions: permissions ?? [],
        timeout: timeout ?? 30000,
        sandbox: sandbox ?? 'v8-isolate',
      };

      await toolRegistry.register(toolDefinition);

      res.status(201).json({ tool: toolDefinition });
    } catch (error) {
      logger.error({ error, traceId: req.traceId }, 'Failed to register tool');
      res.status(500).json({
        error: {
          code: 'TOOL_REGISTER_FAILED',
          message: 'Failed to register tool',
          traceId: req.traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  return router;
}
