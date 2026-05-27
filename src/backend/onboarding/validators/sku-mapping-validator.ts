/**
 * SKU Mapping Validator
 *
 * Validates SKU mapping coverage:
 * - mappings: required, non-empty array of SKU mappings
 * - Each mapping must have channelSkuId and either systemSkuId or suggestNewSku=true
 * - Coverage rate: percentage of channel SKUs with confirmed mappings
 * - Minimum coverage threshold: 80% (configurable)
 */

import pino from 'pino';

import type { OnboardingSession } from '../../../shared/m2-types.js';
import type { StepValidationResult, StepValidator } from './types.js';

const logger = pino({ name: 'sku-mapping-validator' });

/** Minimum SKU mapping coverage rate (percentage) */
const MIN_COVERAGE_RATE = 80;

/** SKU mapping entry structure */
interface SKUMappingEntry {
  channelSkuId: string;
  systemSkuId?: string | null;
  status?: 'confirmed' | 'pending' | 'rejected';
  suggestNewSku?: boolean;
}

/**
 * SKUMappingValidator validates SKU mapping coverage.
 */
export class SKUMappingValidator implements StepValidator {
  async validate(data: Record<string, unknown>, _session?: OnboardingSession): Promise<StepValidationResult> {
    const errors: Array<{ field: string; message: string; code?: string }> = [];

    // Validate mappings array
    const mappings = data.mappings;
    if (!mappings || !Array.isArray(mappings)) {
      errors.push({
        field: 'mappings',
        message: 'SKU mappings array is required',
        code: 'REQUIRED',
      });
      return { valid: false, errors };
    }

    if (mappings.length === 0) {
      errors.push({
        field: 'mappings',
        message: 'At least one SKU mapping is required',
        code: 'MIN_LENGTH',
      });
      return { valid: false, errors };
    }

    // Validate individual mappings
    const typedMappings = mappings as SKUMappingEntry[];
    let confirmedCount = 0;

    for (let i = 0; i < typedMappings.length; i++) {
      const mapping = typedMappings[i];

      if (!mapping.channelSkuId || typeof mapping.channelSkuId !== 'string') {
        errors.push({
          field: `mappings[${i}].channelSkuId`,
          message: 'Channel SKU ID is required for each mapping',
          code: 'REQUIRED',
        });
        continue;
      }

      // A mapping is valid if it has a systemSkuId or suggests creating a new SKU
      const hasMapping = (mapping.systemSkuId && typeof mapping.systemSkuId === 'string') || mapping.suggestNewSku === true;
      if (!hasMapping) {
        errors.push({
          field: `mappings[${i}].systemSkuId`,
          message: 'Each mapping must have a system SKU ID or suggest creating a new SKU',
          code: 'REQUIRED',
        });
      }

      // Count confirmed mappings
      if (mapping.status === 'confirmed' || hasMapping) {
        confirmedCount++;
      }
    }

    // Check coverage rate
    const totalChannelSkus = data.totalChannelSkus;
    const total = typeof totalChannelSkus === 'number' ? totalChannelSkus : typedMappings.length;
    const coverageRate = total > 0 ? (confirmedCount / total) * 100 : 0;

    if (coverageRate < MIN_COVERAGE_RATE) {
      errors.push({
        field: 'coverageRate',
        message: `SKU mapping coverage is ${coverageRate.toFixed(1)}%, minimum required is ${MIN_COVERAGE_RATE}%`,
        code: 'BELOW_THRESHOLD',
      });
    }

    if (errors.length > 0) {
      logger.debug({ errors: errors.length, coverageRate }, 'SKU mapping validation failed');
      return { valid: false, errors };
    }

    return { valid: true };
  }
}
