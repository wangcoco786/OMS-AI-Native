/**
 * Session / Chat Routes
 *
 * Provides:
 * - POST /api/v1/sessions              - Create a new agent session
 * - POST /api/v1/sessions/:sessionId/chat - Send message and get SSE streaming response
 *
 * End-to-end flow for chat:
 * 1. Auth middleware validates token → req.user
 * 2. Trace ID middleware generates trace ID
 * 3. Route handler gets/creates session from Agent SDK Wrapper
 * 4. Calls wrapper.chat(session, message)
 * 5. Creates SSE stream on the response
 * 6. Iterates over AgentEvents and pushes to SSE stream
 * 7. On 'end' event, closes the stream
 */

import { Router } from 'express';
import type { Response } from 'express';
import pino from 'pino';

import type { AuthenticatedRequest } from '../auth/middleware.js';
import type { TracedRequest } from '../observability/trace-id.js';
import type { AgentSDKWrapper, AgentSession } from '../../agent-runtime/sdk/types.js';
import type { SSEManager } from '../realtime/types.js';

const logger = pino({ name: 'routes-sessions' });

/** Combined request type with auth and trace */
type AppRequest = AuthenticatedRequest & TracedRequest;

/** Dependencies for the sessions router */
export interface SessionsRouterDeps {
  agentSDK: AgentSDKWrapper;
  sseManager: SSEManager;
}

/**
 * Create the sessions router.
 * Accepts AgentSDKWrapper and SSEManager for dependency injection.
 */
export function createSessionsRouter(deps: SessionsRouterDeps): Router {
  const { agentSDK, sseManager } = deps;
  const router = Router();

  /**
   * POST /api/v1/sessions
   * Create a new agent session.
   * Body: { agentId }
   */
  router.post('/', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const { agentId } = req.body as { agentId?: string };

      if (!agentId) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'agentId is required',
            traceId: req.traceId ?? 'unknown',
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      const userId = req.user?.id ?? 'anonymous';
      const tenantId = req.user?.tenantId ?? 'default';

      const session = await agentSDK.createSession(agentId, tenantId, userId);

      res.status(201).json({
        session: {
          id: session.id,
          agentId: session.agentId,
          tenantId: session.tenantId,
          userId: session.userId,
          createdAt: session.createdAt.toISOString(),
        },
      });
    } catch (error) {
      logger.error({ error, traceId: req.traceId }, 'Failed to create session');
      res.status(500).json({
        error: {
          code: 'SESSION_CREATE_FAILED',
          message: 'Failed to create session',
          traceId: req.traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  /**
   * POST /api/v1/sessions/:sessionId/chat
   * Send a message and receive SSE streaming response.
   *
   * End-to-end flow:
   * 1. Validate session exists
   * 2. Create SSE stream
   * 3. Call agentSDK.chat() to get async iterable of AgentEvents
   * 4. Push each event to the SSE stream
   * 5. Close stream on 'end' or 'error' event
   */
  router.post('/:sessionId/chat', async (req: AppRequest, res: Response): Promise<void> => {
    const sessionId = req.params.sessionId as string;
    const { message } = req.body as { message?: string };

    if (!message) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'message is required',
          traceId: req.traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Retrieve the session from the SDK wrapper
    const sdkWrapper = agentSDK as AgentSDKWrapper & { getSession?(id: string): AgentSession | undefined };
    let session: AgentSession | undefined;

    if (typeof sdkWrapper.getSession === 'function') {
      session = sdkWrapper.getSession(sessionId);
    }

    if (!session) {
      res.status(404).json({
        error: {
          code: 'SESSION_NOT_FOUND',
          message: `Session ${sessionId} not found`,
          traceId: req.traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Create SSE stream for this response
    const stream = sseManager.createStream(res, sessionId);

    try {
      logger.info(
        { sessionId, traceId: req.traceId, userId: req.user?.id },
        'Starting chat stream',
      );

      // Get the async iterable of agent events
      const events = agentSDK.chat(session, message);

      // Iterate over events and push to SSE stream
      for await (const event of events) {
        sseManager.pushEvent(stream, event);

        // Close stream on terminal events
        if (event.type === 'end' || event.type === 'error') {
          sseManager.closeStream(stream);
          return;
        }
      }

      // If the iterable completes without an explicit end event, close the stream
      sseManager.closeStream(stream);
    } catch (error) {
      logger.error({ error, sessionId, traceId: req.traceId }, 'Chat stream error');

      // Push error event to the stream before closing
      sseManager.pushEvent(stream, {
        type: 'error',
        error: {
          error: {
            code: 'STREAM_ERROR',
            message: error instanceof Error ? error.message : 'Unknown stream error',
            traceId: req.traceId ?? 'unknown',
            timestamp: new Date().toISOString(),
          },
        },
      });
      sseManager.closeStream(stream);
    }
  });

  return router;
}
