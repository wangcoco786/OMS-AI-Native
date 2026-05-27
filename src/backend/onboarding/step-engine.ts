/**
 * Onboarding Step Engine
 *
 * Manages step flow and validation gating:
 * - submitStep: Validates step data, advances to next step on success
 * - goBack: Returns to previous step, preserving filled data
 * - validateStep: Runs step-specific validation
 *
 * Validation gating rules:
 * - Validation failure: currentStep unchanged, completedSteps unchanged
 * - Validation success: currentStep advances, current step added to completedSteps
 * - Cascade re-validation: modifying step K resets steps K+1..N status
 */

import pino from 'pino';

import type { OnboardingSession, OnboardingStep, StepResult, ValidationError } from '../../shared/m2-types.js';
import { ONBOARDING_STEPS, type OnboardingSessionService } from './session-service.js';
import type { StepValidator } from './validators/types.js';

const logger = pino({ name: 'onboarding-step-engine' });

/** Dependencies for the step engine */
export interface StepEngineDeps {
  sessionService: OnboardingSessionService;
  validators: Record<OnboardingStep, StepValidator>;
}

/**
 * Get the index of a step in the ordered step list.
 */
export function getStepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

/**
 * Get the next step after the given step, or null if at the end.
 */
export function getNextStep(step: OnboardingStep): OnboardingStep | null {
  const index = getStepIndex(step);
  if (index < 0 || index >= ONBOARDING_STEPS.length - 1) {
    return null;
  }
  return ONBOARDING_STEPS[index + 1];
}

/**
 * Get the previous step before the given step, or null if at the beginning.
 */
export function getPreviousStep(step: OnboardingStep): OnboardingStep | null {
  const index = getStepIndex(step);
  if (index <= 0) {
    return null;
  }
  return ONBOARDING_STEPS[index - 1];
}

/**
 * OnboardingStepEngine manages step transitions and validation gating.
 */
export class OnboardingStepEngine {
  private readonly sessionService: OnboardingSessionService;
  private readonly validators: Record<OnboardingStep, StepValidator>;

  constructor(deps: StepEngineDeps) {
    this.sessionService = deps.sessionService;
    this.validators = deps.validators;
  }

  /**
   * Submit data for a step. Validates the data and advances if valid.
   *
   * Rules:
   * - If validation fails: currentStep unchanged, completedSteps unchanged
   * - If validation passes: currentStep advances, step added to completedSteps
   * - If step is already completed (re-submission): cascade re-validation
   */
  async submitStep(
    sessionId: string,
    step: OnboardingStep,
    data: Record<string, unknown>,
  ): Promise<StepResult> {
    const session = await this.sessionService.getSession(sessionId);
    if (!session) {
      return {
        success: false,
        errors: [{ field: 'session', message: 'Session not found' }],
      };
    }

    // Validate the step data
    const validationResult = await this.validateStep(session, step, data);

    if (validationResult.length > 0) {
      // Validation failed: currentStep unchanged, completedSteps unchanged
      session.stepData[step].validationErrors = validationResult;
      session.stepData[step].status = 'failed';
      session.metadata.interactionCount += 1;
      await this.sessionService.updateSession(session);

      logger.info({ sessionId, step, errors: validationResult.length }, 'Step validation failed');

      return {
        success: false,
        errors: validationResult,
      };
    }

    // Validation passed: update step data
    session.stepData[step].data = data;
    session.stepData[step].status = 'completed';
    session.stepData[step].completedAt = new Date();
    session.stepData[step].validationErrors = undefined;

    // Check if this is a re-submission of an already completed step
    const isResubmission = session.completedSteps.includes(step);

    if (isResubmission) {
      // Cascade re-validation: reset steps after this one
      this.cascadeReset(session, step);
    }

    // Add to completedSteps if not already there
    if (!session.completedSteps.includes(step)) {
      session.completedSteps.push(step);
    }

    // Advance to next step
    const nextStep = getNextStep(step);
    if (nextStep) {
      session.currentStep = nextStep;
      if (session.stepData[nextStep].status === 'pending') {
        session.stepData[nextStep].status = 'in_progress';
      }
    }

    session.metadata.interactionCount += 1;
    await this.sessionService.updateSession(session);

    logger.info({ sessionId, step, nextStep }, 'Step submitted successfully');

    return {
      success: true,
      nextStep: nextStep ?? undefined,
    };
  }

  /**
   * Go back to the previous step.
   * Preserves all filled data — only changes currentStep.
   */
  async goBack(sessionId: string): Promise<OnboardingSession | null> {
    const session = await this.sessionService.getSession(sessionId);
    if (!session) {
      return null;
    }

    const previousStep = getPreviousStep(session.currentStep);
    if (!previousStep) {
      // Already at the first step, cannot go back
      return session;
    }

    // Move back — data is preserved
    session.currentStep = previousStep;
    session.metadata.interactionCount += 1;

    await this.sessionService.updateSession(session);

    logger.info({ sessionId, previousStep }, 'Stepped back');

    return session;
  }

  /**
   * Validate step data without submitting.
   * Returns an array of validation errors (empty if valid).
   */
  async validateStep(
    session: OnboardingSession,
    step: OnboardingStep,
    data: Record<string, unknown>,
  ): Promise<ValidationError[]> {
    const validator = this.validators[step];
    if (!validator) {
      logger.warn({ step }, 'No validator found for step');
      return [];
    }

    const result = await validator.validate(data, session);
    return result.valid ? [] : (result.errors ?? []);
  }

  /**
   * Cascade reset: when step K is modified, reset steps K+1..N status.
   * This forces re-validation of subsequent steps.
   */
  private cascadeReset(session: OnboardingSession, modifiedStep: OnboardingStep): void {
    const modifiedIndex = getStepIndex(modifiedStep);

    for (let i = modifiedIndex + 1; i < ONBOARDING_STEPS.length; i++) {
      const step = ONBOARDING_STEPS[i];
      if (session.completedSteps.includes(step)) {
        // Reset status to require re-validation, but preserve data
        session.stepData[step].status = 'pending';
        session.stepData[step].completedAt = undefined;
        session.stepData[step].validationErrors = undefined;

        // Remove from completedSteps
        session.completedSteps = session.completedSteps.filter((s) => s !== step);
      }
    }

    logger.info(
      { sessionId: session.id, modifiedStep, remainingCompleted: session.completedSteps },
      'Cascade reset applied',
    );
  }
}
