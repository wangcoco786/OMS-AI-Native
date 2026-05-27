/**
 * Onboarding REST API Routes
 *
 * Provides onboarding session management endpoints:
 * - POST   /api/v1/onboarding/sessions              — Create a new session
 * - GET    /api/v1/onboarding/sessions/:id          — Get session details
 * - POST   /api/v1/onboarding/sessions/:id/steps/:step — Submit step data
 * - POST   /api/v1/onboarding/sessions/:id/back     — Go back to previous step
 * - GET    /api/v1/onboarding/sessions/:id/help/:step — Get step help content
 *
 * All endpoints require authentication (req.user must be set by auth middleware).
 * Data is isolated by tenant.
 */

import { Router } from 'express';
import type { Response } from 'express';
import pino from 'pino';

import type { AuthenticatedRequest } from '../auth/middleware.js';
import type { TracedRequest } from '../observability/trace-id.js';
import type { OnboardingStep } from '../../shared/m2-types.js';
import type { OnboardingSessionService } from './session-service.js';
import type { OnboardingStepEngine } from './step-engine.js';
import type { OnboardingAgent } from './onboarding-agent.js';
import { ONBOARDING_STEPS } from './session-service.js';

const logger = pino({ name: 'routes-onboarding' });

/** Combined request type with auth and trace */
type AppRequest = AuthenticatedRequest & TracedRequest;

/** Dependencies for the onboarding router */
export interface OnboardingRouterDeps {
  sessionService: OnboardingSessionService;
  stepEngine: OnboardingStepEngine;
  onboardingAgent: OnboardingAgent;
}

/** Structured error response */
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    traceId: string;
    timestamp: string;
  };
}

/**
 * Create the onboarding router.
 * Accepts dependencies for session management, step engine, and agent.
 */
export function createOnboardingRouter(deps: OnboardingRouterDeps): Router {
  const { sessionService, stepEngine, onboardingAgent } = deps;
  const router = Router();

  // ─── POST /api/v1/onboarding/sessions — Create a new session ──────────────

  router.post('/sessions', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      const userId = req.user?.id;
      if (!tenantId || !userId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      const { shopId } = req.body as { shopId?: string };

      if (!shopId || typeof shopId !== 'string') {
        sendError(res, 400, 'VALIDATION_ERROR', 'shopId is required', req.traceId);
        return;
      }

      const session = await sessionService.createSession(tenantId, userId, shopId);

      res.status(201).json({ session });
    } catch (error) {
      logger.error({ error, traceId: req.traceId }, 'Failed to create onboarding session');
      sendError(res, 500, 'SESSION_CREATE_FAILED', 'Failed to create onboarding session', req.traceId);
    }
  });

  // ─── GET /api/v1/onboarding/sessions/:id — Get session details ────────────

  router.get('/sessions/:id', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      const sessionId = getParam(req, 'id');
      const session = await sessionService.getSession(sessionId);

      if (!session) {
        sendError(res, 404, 'SESSION_NOT_FOUND', `Session not found: ${sessionId}`, req.traceId);
        return;
      }

      // Verify tenant isolation
      if (session.tenantId !== tenantId) {
        sendError(res, 404, 'SESSION_NOT_FOUND', `Session not found: ${sessionId}`, req.traceId);
        return;
      }

      res.json({ session });
    } catch (error) {
      logger.error({ error, traceId: req.traceId }, 'Failed to get onboarding session');
      sendError(res, 500, 'SESSION_GET_FAILED', 'Failed to get onboarding session', req.traceId);
    }
  });

  // ─── POST /api/v1/onboarding/sessions/:id/steps/:step — Submit step ───────

  router.post('/sessions/:id/steps/:step', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      const sessionId = getParam(req, 'id');
      const step = getParam(req, 'step') as OnboardingStep;

      // Validate step name
      if (!ONBOARDING_STEPS.includes(step)) {
        sendError(
          res,
          400,
          'INVALID_STEP',
          `Invalid step: "${step}". Must be one of: ${ONBOARDING_STEPS.join(', ')}`,
          req.traceId,
        );
        return;
      }

      // Verify session exists and belongs to tenant
      const session = await sessionService.getSession(sessionId);
      if (!session) {
        sendError(res, 404, 'SESSION_NOT_FOUND', `Session not found: ${sessionId}`, req.traceId);
        return;
      }
      if (session.tenantId !== tenantId) {
        sendError(res, 404, 'SESSION_NOT_FOUND', `Session not found: ${sessionId}`, req.traceId);
        return;
      }

      const data = (req.body as { data?: Record<string, unknown> })?.data ?? req.body as Record<string, unknown>;

      const result = await stepEngine.submitStep(sessionId, step, data);

      if (result.success) {
        res.json({ result });
      } else {
        res.status(422).json({ result });
      }
    } catch (error) {
      logger.error({ error, traceId: req.traceId }, 'Failed to submit step');
      sendError(res, 500, 'STEP_SUBMIT_FAILED', 'Failed to submit step', req.traceId);
    }
  });

  // ─── POST /api/v1/onboarding/sessions/:id/back — Go back ─────────────────

  router.post('/sessions/:id/back', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      const sessionId = getParam(req, 'id');

      // Verify session exists and belongs to tenant
      const existingSession = await sessionService.getSession(sessionId);
      if (!existingSession) {
        sendError(res, 404, 'SESSION_NOT_FOUND', `Session not found: ${sessionId}`, req.traceId);
        return;
      }
      if (existingSession.tenantId !== tenantId) {
        sendError(res, 404, 'SESSION_NOT_FOUND', `Session not found: ${sessionId}`, req.traceId);
        return;
      }

      const session = await stepEngine.goBack(sessionId);

      if (!session) {
        sendError(res, 404, 'SESSION_NOT_FOUND', `Session not found: ${sessionId}`, req.traceId);
        return;
      }

      res.json({ session });
    } catch (error) {
      logger.error({ error, traceId: req.traceId }, 'Failed to go back');
      sendError(res, 500, 'STEP_BACK_FAILED', 'Failed to go back', req.traceId);
    }
  });

  // ─── GET /api/v1/onboarding/sessions/:id/help/:step — Get help ────────────

  router.get('/sessions/:id/help/:step', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        sendError(res, 401, 'AUTH_REQUIRED', 'Authentication is required', req.traceId);
        return;
      }

      const sessionId = getParam(req, 'id');
      const step = getParam(req, 'step') as OnboardingStep;

      // Validate step name
      if (!ONBOARDING_STEPS.includes(step)) {
        sendError(
          res,
          400,
          'INVALID_STEP',
          `Invalid step: "${step}". Must be one of: ${ONBOARDING_STEPS.join(', ')}`,
          req.traceId,
        );
        return;
      }

      // Verify session exists and belongs to tenant
      const session = await sessionService.getSession(sessionId);
      if (!session) {
        sendError(res, 404, 'SESSION_NOT_FOUND', `Session not found: ${sessionId}`, req.traceId);
        return;
      }
      if (session.tenantId !== tenantId) {
        sendError(res, 404, 'SESSION_NOT_FOUND', `Session not found: ${sessionId}`, req.traceId);
        return;
      }

      // Increment interaction count
      session.metadata.interactionCount += 1;
      await sessionService.updateSession(session);

      const help = onboardingAgent.getStepHelp(step);

      res.json({ help });
    } catch (error) {
      logger.error({ error, traceId: req.traceId }, 'Failed to get step help');
      sendError(res, 500, 'HELP_FAILED', 'Failed to get step help', req.traceId);
    }
  });

  return router;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Extract a route param as a string */
function getParam(req: AppRequest, name: string): string {
  const value = req.params[name];
  return typeof value === 'string' ? value : String(value);
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  traceId?: string,
): void {
  const response: ErrorResponse = {
    error: {
      code,
      message,
      traceId: traceId ?? 'unknown',
      timestamp: new Date().toISOString(),
    },
  };
  res.status(status).json(response);
}
