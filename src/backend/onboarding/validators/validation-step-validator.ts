/**
 * Validation Step Validator
 *
 * The final validation step is a pass-through that checks
 * all previous steps are completed. The actual validation
 * logic is handled by the Configuration Validator (Task 7).
 */

import type { OnboardingSession } from '../../../shared/m2-types.js';
import { ONBOARDING_STEPS } from '../session-service.js';
import type { StepValidationResult, StepValidator } from './types.js';

/**
 * ValidationStepValidator ensures all prior steps are completed
 * before the final validation step can proceed.
 */
export class ValidationStepValidator implements StepValidator {
  async validate(_data: Record<string, unknown>, session?: OnboardingSession): Promise<StepValidationResult> {
    if (!session) {
      return {
        valid: false,
        errors: [{ field: 'session', message: 'Session context is required for validation step' }],
      };
    }

    const errors: Array<{ field: string; message: string; code?: string }> = [];

    // Check that all prior steps are completed
    const priorSteps = ONBOARDING_STEPS.slice(0, -1); // All steps except 'validation'
    for (const step of priorSteps) {
      if (!session.completedSteps.includes(step)) {
        errors.push({
          field: step,
          message: `Step "${step}" must be completed before final validation`,
          code: 'STEP_INCOMPLETE',
        });
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true };
  }
}
