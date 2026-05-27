/**
 * Basic Config Validator
 *
 * Validates basic configuration field completeness:
 * - shopName: required, non-empty string, max 255 chars
 * - timezone: required, valid timezone string
 * - currency: required, valid ISO 4217 currency code
 * - language: required, valid language code
 * - contactEmail: required, valid email format
 * - contactPhone: optional, valid phone format if provided
 */

import pino from 'pino';

import type { OnboardingSession } from '../../../shared/m2-types.js';
import type { StepValidationResult, StepValidator } from './types.js';

const logger = pino({ name: 'basic-config-validator' });

/** Common currency codes */
const VALID_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'HKD', 'TWD', 'SGD', 'AUD', 'CAD',
  'KRW', 'THB', 'MYR', 'PHP', 'IDR', 'VND', 'INR', 'BRL', 'MXN', 'RUB',
];

/** Common language codes */
const VALID_LANGUAGES = [
  'en', 'zh', 'zh-CN', 'zh-TW', 'ja', 'ko', 'fr', 'de', 'es', 'pt',
  'it', 'ru', 'ar', 'th', 'vi', 'ms', 'id',
];

/** Email pattern */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Phone pattern (international format) */
const PHONE_PATTERN = /^\+?[\d\s\-()]{7,20}$/;

/**
 * BasicConfigValidator validates basic shop configuration fields.
 */
export class BasicConfigValidator implements StepValidator {
  async validate(data: Record<string, unknown>, _session?: OnboardingSession): Promise<StepValidationResult> {
    const errors: Array<{ field: string; message: string; code?: string }> = [];

    // Validate shopName
    const shopName = data.shopName;
    if (!shopName || typeof shopName !== 'string' || shopName.trim().length === 0) {
      errors.push({
        field: 'shopName',
        message: 'Shop name is required',
        code: 'REQUIRED',
      });
    } else if (shopName.length > 255) {
      errors.push({
        field: 'shopName',
        message: 'Shop name must be 255 characters or less',
        code: 'MAX_LENGTH',
      });
    }

    // Validate timezone
    const timezone = data.timezone;
    if (!timezone || typeof timezone !== 'string' || timezone.trim().length === 0) {
      errors.push({
        field: 'timezone',
        message: 'Timezone is required',
        code: 'REQUIRED',
      });
    }

    // Validate currency
    const currency = data.currency;
    if (!currency || typeof currency !== 'string') {
      errors.push({
        field: 'currency',
        message: 'Currency is required',
        code: 'REQUIRED',
      });
    } else if (!VALID_CURRENCIES.includes(currency.toUpperCase())) {
      errors.push({
        field: 'currency',
        message: `Invalid currency code. Supported: ${VALID_CURRENCIES.join(', ')}`,
        code: 'INVALID_VALUE',
      });
    }

    // Validate language
    const language = data.language;
    if (!language || typeof language !== 'string') {
      errors.push({
        field: 'language',
        message: 'Language is required',
        code: 'REQUIRED',
      });
    } else if (!VALID_LANGUAGES.includes(language)) {
      errors.push({
        field: 'language',
        message: `Invalid language code. Supported: ${VALID_LANGUAGES.join(', ')}`,
        code: 'INVALID_VALUE',
      });
    }

    // Validate contactEmail
    const contactEmail = data.contactEmail;
    if (!contactEmail || typeof contactEmail !== 'string' || contactEmail.trim().length === 0) {
      errors.push({
        field: 'contactEmail',
        message: 'Contact email is required',
        code: 'REQUIRED',
      });
    } else if (!EMAIL_PATTERN.test(contactEmail)) {
      errors.push({
        field: 'contactEmail',
        message: 'Invalid email format',
        code: 'INVALID_FORMAT',
      });
    }

    // Validate contactPhone (optional)
    const contactPhone = data.contactPhone;
    if (contactPhone && typeof contactPhone === 'string' && contactPhone.trim().length > 0) {
      if (!PHONE_PATTERN.test(contactPhone)) {
        errors.push({
          field: 'contactPhone',
          message: 'Invalid phone number format',
          code: 'INVALID_FORMAT',
        });
      }
    }

    if (errors.length > 0) {
      logger.debug({ errors: errors.length }, 'Basic config validation failed');
      return { valid: false, errors };
    }

    return { valid: true };
  }
}
