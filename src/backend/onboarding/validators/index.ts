/**
 * Onboarding Step Validators
 *
 * Exports all step validators and a factory function to create
 * the complete validator map for the step engine.
 */

export { ChannelConnectionValidator } from './channel-connection-validator.js';
export { BasicConfigValidator } from './basic-config-validator.js';
export { SKUMappingValidator } from './sku-mapping-validator.js';
export { RuleSetupValidator } from './rule-setup-validator.js';
export { ValidationStepValidator } from './validation-step-validator.js';
export type { StepValidator, StepValidationResult } from './types.js';

import type { OnboardingStep } from '../../../shared/m2-types.js';
import { ChannelConnectionValidator } from './channel-connection-validator.js';
import { BasicConfigValidator } from './basic-config-validator.js';
import { SKUMappingValidator } from './sku-mapping-validator.js';
import { RuleSetupValidator } from './rule-setup-validator.js';
import { ValidationStepValidator } from './validation-step-validator.js';
import type { StepValidator } from './types.js';

/**
 * Create the complete validator map for all onboarding steps.
 */
export function createValidators(): Record<OnboardingStep, StepValidator> {
  return {
    channel_connection: new ChannelConnectionValidator(),
    basic_config: new BasicConfigValidator(),
    sku_mapping: new SKUMappingValidator(),
    rule_setup: new RuleSetupValidator(),
    validation: new ValidationStepValidator(),
  };
}
