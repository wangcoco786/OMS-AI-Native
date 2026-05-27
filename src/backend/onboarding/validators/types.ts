/**
 * Step Validator Types
 *
 * Common interface for all onboarding step validators.
 * Each validator checks step-specific data and returns validation results.
 */

import type { OnboardingSession, ValidationError } from '../../../shared/m2-types.js';

/** Validation result returned by step validators */
export interface StepValidationResult {
  valid: boolean;
  errors?: ValidationError[];
}

/** Interface that all step validators must implement */
export interface StepValidator {
  /** Validate step data, optionally using session context */
  validate(data: Record<string, unknown>, session?: OnboardingSession): Promise<StepValidationResult>;
}
