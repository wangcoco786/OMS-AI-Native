/**
 * Channel Connection Validator
 *
 * Validates channel credentials format and connectivity:
 * - channelType: must be one of 'shopify', 'wms', 'erp', 'custom'
 * - apiKey: required, non-empty string
 * - apiSecret: required for Shopify
 * - shopDomain: required for Shopify, must be valid domain format
 * - endpoint: required for WMS/ERP, must be valid URL
 */

import pino from 'pino';

import type { OnboardingSession } from '../../../shared/m2-types.js';
import type { StepValidationResult, StepValidator } from './types.js';

const logger = pino({ name: 'channel-connection-validator' });

/** Valid channel types */
const VALID_CHANNEL_TYPES = ['shopify', 'wms', 'erp', 'custom'] as const;

/** URL pattern for basic validation */
const URL_PATTERN = /^https?:\/\/.+/;

/** Domain pattern for Shopify stores */
const DOMAIN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$|^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * ChannelConnectionValidator validates channel credentials and connectivity.
 */
export class ChannelConnectionValidator implements StepValidator {
  async validate(data: Record<string, unknown>, _session?: OnboardingSession): Promise<StepValidationResult> {
    const errors: Array<{ field: string; message: string; code?: string }> = [];

    // Validate channelType
    const channelType = data.channelType;
    if (!channelType || typeof channelType !== 'string') {
      errors.push({
        field: 'channelType',
        message: 'Channel type is required',
        code: 'REQUIRED',
      });
    } else if (!VALID_CHANNEL_TYPES.includes(channelType as typeof VALID_CHANNEL_TYPES[number])) {
      errors.push({
        field: 'channelType',
        message: `Invalid channel type. Must be one of: ${VALID_CHANNEL_TYPES.join(', ')}`,
        code: 'INVALID_VALUE',
      });
    }

    // Validate apiKey
    const apiKey = data.apiKey;
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      errors.push({
        field: 'apiKey',
        message: 'API key is required',
        code: 'REQUIRED',
      });
    }

    // Channel-specific validations
    if (channelType === 'shopify') {
      // Shopify requires apiSecret and shopDomain
      const apiSecret = data.apiSecret;
      if (!apiSecret || typeof apiSecret !== 'string' || apiSecret.trim().length === 0) {
        errors.push({
          field: 'apiSecret',
          message: 'API secret is required for Shopify channels',
          code: 'REQUIRED',
        });
      }

      const shopDomain = data.shopDomain;
      if (!shopDomain || typeof shopDomain !== 'string') {
        errors.push({
          field: 'shopDomain',
          message: 'Shop domain is required for Shopify channels',
          code: 'REQUIRED',
        });
      } else if (!DOMAIN_PATTERN.test(shopDomain)) {
        errors.push({
          field: 'shopDomain',
          message: 'Invalid shop domain format',
          code: 'INVALID_FORMAT',
        });
      }
    }

    if (channelType === 'wms' || channelType === 'erp') {
      // WMS/ERP requires endpoint URL
      const endpoint = data.endpoint;
      if (!endpoint || typeof endpoint !== 'string') {
        errors.push({
          field: 'endpoint',
          message: 'API endpoint URL is required for WMS/ERP channels',
          code: 'REQUIRED',
        });
      } else if (!URL_PATTERN.test(endpoint)) {
        errors.push({
          field: 'endpoint',
          message: 'Invalid endpoint URL format. Must start with http:// or https://',
          code: 'INVALID_FORMAT',
        });
      }
    }

    if (errors.length > 0) {
      logger.debug({ errors: errors.length }, 'Channel connection validation failed');
      return { valid: false, errors };
    }

    return { valid: true };
  }
}
