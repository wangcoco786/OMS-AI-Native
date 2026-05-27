/**
 * Rule Setup Validator
 *
 * Validates logistics rule configuration:
 * - rules: required, non-empty array of logistics rules
 * - Each rule must have: name, type, conditions, actions
 * - Rule types: 'shipping', 'warehouse_allocation', 'priority', 'custom'
 * - At least one shipping rule is required
 * - Conditions must be non-empty
 * - Actions must be non-empty
 */

import pino from 'pino';

import type { OnboardingSession } from '../../../shared/m2-types.js';
import type { StepValidationResult, StepValidator } from './types.js';

const logger = pino({ name: 'rule-setup-validator' });

/** Valid rule types */
const VALID_RULE_TYPES = ['shipping', 'warehouse_allocation', 'priority', 'custom'] as const;

/** Logistics rule structure */
interface LogisticsRule {
  name?: string;
  type?: string;
  conditions?: unknown[];
  actions?: unknown[];
  enabled?: boolean;
}

/**
 * RuleSetupValidator validates logistics rule configuration.
 */
export class RuleSetupValidator implements StepValidator {
  async validate(data: Record<string, unknown>, _session?: OnboardingSession): Promise<StepValidationResult> {
    const errors: Array<{ field: string; message: string; code?: string }> = [];

    // Validate rules array
    const rules = data.rules;
    if (!rules || !Array.isArray(rules)) {
      errors.push({
        field: 'rules',
        message: 'Logistics rules array is required',
        code: 'REQUIRED',
      });
      return { valid: false, errors };
    }

    if (rules.length === 0) {
      errors.push({
        field: 'rules',
        message: 'At least one logistics rule is required',
        code: 'MIN_LENGTH',
      });
      return { valid: false, errors };
    }

    const typedRules = rules as LogisticsRule[];
    let hasShippingRule = false;

    for (let i = 0; i < typedRules.length; i++) {
      const rule = typedRules[i];

      // Validate name
      if (!rule.name || typeof rule.name !== 'string' || rule.name.trim().length === 0) {
        errors.push({
          field: `rules[${i}].name`,
          message: 'Rule name is required',
          code: 'REQUIRED',
        });
      }

      // Validate type
      if (!rule.type || typeof rule.type !== 'string') {
        errors.push({
          field: `rules[${i}].type`,
          message: 'Rule type is required',
          code: 'REQUIRED',
        });
      } else if (!VALID_RULE_TYPES.includes(rule.type as typeof VALID_RULE_TYPES[number])) {
        errors.push({
          field: `rules[${i}].type`,
          message: `Invalid rule type. Must be one of: ${VALID_RULE_TYPES.join(', ')}`,
          code: 'INVALID_VALUE',
        });
      } else if (rule.type === 'shipping') {
        hasShippingRule = true;
      }

      // Validate conditions
      if (!rule.conditions || !Array.isArray(rule.conditions) || rule.conditions.length === 0) {
        errors.push({
          field: `rules[${i}].conditions`,
          message: 'Rule must have at least one condition',
          code: 'MIN_LENGTH',
        });
      }

      // Validate actions
      if (!rule.actions || !Array.isArray(rule.actions) || rule.actions.length === 0) {
        errors.push({
          field: `rules[${i}].actions`,
          message: 'Rule must have at least one action',
          code: 'MIN_LENGTH',
        });
      }
    }

    // At least one shipping rule is required
    if (!hasShippingRule && errors.length === 0) {
      errors.push({
        field: 'rules',
        message: 'At least one shipping rule is required',
        code: 'MISSING_SHIPPING_RULE',
      });
    }

    if (errors.length > 0) {
      logger.debug({ errors: errors.length }, 'Rule setup validation failed');
      return { valid: false, errors };
    }

    return { valid: true };
  }
}
