/**
 * Onboarding Routes
 *
 * Provides endpoints for the Onboarding Agent workflow:
 * - POST   /api/onboarding/sessions          - Create a new onboarding session
 * - GET    /api/onboarding/sessions/:id       - Get session details
 * - POST   /api/onboarding/sessions/:id/resume - Resume an existing session
 * - POST   /api/onboarding/sessions/:id/steps/:step - Submit step data
 * - POST   /api/onboarding/sessions/:id/back  - Go back to previous step
 * - GET    /api/onboarding/sessions/:id/help/:step - Get step help content
 * - POST   /api/onboarding/sessions/:id/validate/:step - Validate a step
 * - POST   /api/onboarding/sessions/:id/complete - Complete onboarding
 *
 * Requires authentication (req.user must be set by auth middleware).
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
 */

import { Router } from 'express';
import type { Response } from 'express';
import pino from 'pino';

import type { AuthenticatedRequest } from '../auth/middleware.js';
import type { TracedRequest } from '../observability/trace-id.js';

const logger = pino({ name: 'routes-onboarding' });

/** Combined request type with auth and trace */
type AppRequest = AuthenticatedRequest & TracedRequest;

/**
 * Create the onboarding router.
 * Dependencies will be injected when the service layer is implemented.
 */
export function createOnboardingRouter(): Router {
  const router = Router();

  /**
   * POST /api/onboarding/sessions
   * Create a new onboarding session for a shop.
   * Body: { shopId }
   */
  router.post('/sessions', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const { shopId } = req.body as { shopId?: string };
      const tenantId = req.user?.tenantId;
      const userId = req.user?.id;

      if (!shopId) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'shopId is required',
            traceId: req.traceId ?? 'unknown',
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      // TODO: Integrate with OnboardingAgentService when implemented
      res.status(201).json({
        session: {
          id: crypto.randomUUID(),
          tenantId,
          userId,
          shopId,
          currentStep: 'channel_connection',
          completedSteps: [],
          status: 'in_progress',
          startedAt: new Date().toISOString(),
          metadata: { interactionCount: 0 },
        },
      });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to create onboarding session');
      res.status(500).json({
        error: {
          code: 'ONBOARDING_SESSION_CREATE_FAILED',
          message: 'Failed to create onboarding session',
          traceId: (req as AppRequest).traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  /**
   * GET /api/onboarding/sessions/:id
   * Get onboarding session details.
   */
  router.get('/sessions/:id', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      // TODO: Integrate with OnboardingAgentService when implemented
      res.json({
        session: {
          id,
          currentStep: 'channel_connection',
          completedSteps: [],
          status: 'in_progress',
        },
      });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to get onboarding session');
      res.status(500).json({
        error: {
          code: 'ONBOARDING_SESSION_GET_FAILED',
          message: 'Failed to get onboarding session',
          traceId: (req as AppRequest).traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  /**
   * POST /api/onboarding/sessions/:id/resume
   * Resume an existing onboarding session.
   */
  router.post('/sessions/:id/resume', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      // TODO: Integrate with OnboardingAgentService when implemented
      res.json({
        session: {
          id,
          currentStep: 'channel_connection',
          completedSteps: [],
          status: 'in_progress',
        },
      });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to resume onboarding session');
      res.status(500).json({
        error: {
          code: 'ONBOARDING_SESSION_RESUME_FAILED',
          message: 'Failed to resume onboarding session',
          traceId: (req as AppRequest).traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  /**
   * POST /api/onboarding/sessions/:id/steps/:step
   * Submit data for a specific step.
   * Body: step-specific data
   */
  router.post('/sessions/:id/steps/:step', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const { id, step } = req.params;
      const data = req.body;

      // TODO: Integrate with OnboardingAgentService when implemented
      res.json({
        success: true,
        sessionId: id,
        step,
        data,
        nextStep: null,
      });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to submit step');
      res.status(500).json({
        error: {
          code: 'ONBOARDING_STEP_SUBMIT_FAILED',
          message: 'Failed to submit step data',
          traceId: (req as AppRequest).traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  /**
   * POST /api/onboarding/sessions/:id/back
   * Go back to the previous step.
   */
  router.post('/sessions/:id/back', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      // TODO: Integrate with OnboardingAgentService when implemented
      res.json({
        session: {
          id,
          currentStep: 'channel_connection',
          completedSteps: [],
        },
      });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to go back');
      res.status(500).json({
        error: {
          code: 'ONBOARDING_BACK_FAILED',
          message: 'Failed to navigate back',
          traceId: (req as AppRequest).traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  /**
   * GET /api/onboarding/sessions/:id/help/:step
   * Get help content for a specific step.
   */
  router.get('/sessions/:id/help/:step', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const { id, step } = req.params;

      // TODO: Integrate with OnboardingAgentService when implemented
      res.json({
        sessionId: id,
        step,
        help: {
          title: `Help for ${step}`,
          description: '',
          examples: [],
        },
      });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to get step help');
      res.status(500).json({
        error: {
          code: 'ONBOARDING_HELP_FAILED',
          message: 'Failed to get step help',
          traceId: (req as AppRequest).traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  /**
   * POST /api/onboarding/sessions/:id/validate/:step
   * Validate a specific step's data.
   */
  router.post('/sessions/:id/validate/:step', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const { id, step } = req.params;

      // TODO: Integrate with OnboardingAgentService when implemented
      res.json({
        sessionId: id,
        step,
        valid: true,
        errors: [],
      });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to validate step');
      res.status(500).json({
        error: {
          code: 'ONBOARDING_VALIDATE_FAILED',
          message: 'Failed to validate step',
          traceId: (req as AppRequest).traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  /**
   * POST /api/onboarding/sessions/:id/complete
   * Complete the onboarding process and generate a report.
   */
  router.post('/sessions/:id/complete', async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      // TODO: Integrate with OnboardingAgentService when implemented
      res.json({
        sessionId: id,
        status: 'completed',
        report: {
          totalDuration: 0,
          stepsCompleted: 0,
          canGoLive: false,
        },
      });
    } catch (error) {
      logger.error({ error, traceId: (req as AppRequest).traceId }, 'Failed to complete onboarding');
      res.status(500).json({
        error: {
          code: 'ONBOARDING_COMPLETE_FAILED',
          message: 'Failed to complete onboarding',
          traceId: (req as AppRequest).traceId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  return router;
}
