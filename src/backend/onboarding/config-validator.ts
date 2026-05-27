/**
 * Configuration Validator
 *
 * Validates shop configuration completeness across 4 dimensions:
 * - Channel connection status
 * - SKU mapping coverage
 * - Logistics rules configuration
 * - Inventory association
 *
 * Determines if a shop can go live based on all dimensions passing.
 * Each failed dimension includes a fix suggestion.
 *
 * Requirements: 3.1, 3.2, 3.5, 3.6
 */

import pino from 'pino';

import type { DatabaseService } from '../../infrastructure/database/types.js';
import type {
  ValidationDimension,
  ValidationCheckResult,
  ValidationReport,
} from '../../shared/m2-types.js';

const logger = pino({ name: 'config-validator' });

/** Minimum SKU mapping coverage percentage required to pass */
const MIN_SKU_MAPPING_COVERAGE = 80;

/** Dependencies for the ConfigurationValidator */
export interface ConfigValidatorDeps {
  db: DatabaseService;
}

/**
 * ConfigurationValidator checks shop configuration completeness
 * and determines go-live readiness.
 */
export class ConfigurationValidator {
  private readonly db: DatabaseService;

  constructor(deps: ConfigValidatorDeps) {
    this.db = deps.db;
  }

  /**
   * Validate all 4 dimensions for a shop and produce a full report.
   * canGoLive is true only when all dimensions pass.
   */
  async validateAll(tenantId: string, shopId: string): Promise<ValidationReport> {
    const dimensions: ValidationDimension[] = [
      'channel_connection',
      'sku_mapping_coverage',
      'logistics_rules',
      'inventory_association',
    ];

    const checks: ValidationCheckResult[] = await Promise.all(
      dimensions.map((dimension) => this.validateDimension(tenantId, shopId, dimension)),
    );

    const allPassed = checks.every((check) => check.passed);

    const report: ValidationReport = {
      shopId,
      overallStatus: allPassed ? 'pass' : 'fail',
      checks,
      simulation: { success: false, steps: [] },
      generatedAt: new Date(),
      canGoLive: allPassed,
    };

    logger.info(
      { tenantId, shopId, overallStatus: report.overallStatus, canGoLive: report.canGoLive },
      'Configuration validation completed',
    );

    return report;
  }

  /**
   * Validate a single dimension for a shop.
   */
  async validateDimension(
    tenantId: string,
    shopId: string,
    dimension: ValidationDimension,
  ): Promise<ValidationCheckResult> {
    switch (dimension) {
      case 'channel_connection':
        return this.validateChannelConnection(tenantId, shopId);
      case 'sku_mapping_coverage':
        return this.validateSkuMappingCoverage(tenantId, shopId);
      case 'logistics_rules':
        return this.validateLogisticsRules(tenantId, shopId);
      case 'inventory_association':
        return this.validateInventoryAssociation(tenantId, shopId);
    }
  }

  /**
   * Validate channel connection status.
   * Checks that the shop has a valid channel configuration and is not in 'pending' status.
   */
  private async validateChannelConnection(
    tenantId: string,
    shopId: string,
  ): Promise<ValidationCheckResult> {
    try {
      const rows = await this.db.query<{
        channel_type: string;
        channel_config: Record<string, unknown>;
        status: string;
      }>(
        `SELECT channel_type, channel_config, status FROM shops WHERE id = $1`,
        [shopId],
        tenantId,
      );

      if (rows.length === 0) {
        return {
          dimension: 'channel_connection',
          passed: false,
          details: 'Shop not found',
          fixSuggestion: 'Ensure the shop exists and belongs to the current tenant.',
        };
      }

      const shop = rows[0];

      if (!shop.channel_type) {
        return {
          dimension: 'channel_connection',
          passed: false,
          details: 'No channel type configured',
          fixSuggestion: 'Select a channel type (shopify, wms, or erp) in the channel connection step.',
        };
      }

      const config = shop.channel_config ?? {};
      const hasConfig = Object.keys(config).length > 0;

      if (!hasConfig) {
        return {
          dimension: 'channel_connection',
          passed: false,
          details: 'Channel configuration is empty — no API credentials provided',
          fixSuggestion: 'Provide the required API credentials for the selected channel type.',
        };
      }

      if (shop.status === 'pending') {
        return {
          dimension: 'channel_connection',
          passed: false,
          details: 'Channel connection has not been verified',
          fixSuggestion: 'Complete the channel connection step to verify API credentials.',
        };
      }

      return {
        dimension: 'channel_connection',
        passed: true,
        details: `Channel "${shop.channel_type}" connected and verified`,
      };
    } catch (error) {
      logger.error({ error, tenantId, shopId }, 'Error validating channel connection');
      return {
        dimension: 'channel_connection',
        passed: false,
        details: 'Failed to validate channel connection due to an internal error',
        fixSuggestion: 'Retry the validation. If the issue persists, re-authorize the channel connection.',
      };
    }
  }

  /**
   * Validate SKU mapping coverage.
   * Coverage = (mapped channel SKUs / total channel SKUs) * 100
   * Must be >= MIN_SKU_MAPPING_COVERAGE to pass.
   */
  private async validateSkuMappingCoverage(
    tenantId: string,
    shopId: string,
  ): Promise<ValidationCheckResult> {
    try {
      // Count total channel SKUs for this shop
      const totalRows = await this.db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM channel_skus WHERE shop_id = $1`,
        [shopId],
        tenantId,
      );
      const totalCount = parseInt(totalRows[0]?.count ?? '0', 10);

      if (totalCount === 0) {
        return {
          dimension: 'sku_mapping_coverage',
          passed: false,
          details: 'No channel SKUs imported for this shop',
          fixSuggestion: 'Import channel SKU data via CSV or API in the SKU mapping step.',
        };
      }

      // Count mapped channel SKUs (those with a confirmed/high_confidence mapping)
      const mappedRows = await this.db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM sku_mappings sm
         JOIN channel_skus cs ON cs.id = sm.channel_sku_id
         WHERE cs.shop_id = $1 AND sm.system_sku_id IS NOT NULL AND sm.status IN ('confirmed', 'pending')`,
        [shopId],
        tenantId,
      );
      const mappedCount = parseInt(mappedRows[0]?.count ?? '0', 10);

      const coverage = (mappedCount / totalCount) * 100;

      if (coverage < MIN_SKU_MAPPING_COVERAGE) {
        return {
          dimension: 'sku_mapping_coverage',
          passed: false,
          details: `SKU mapping coverage is ${coverage.toFixed(1)}% (${mappedCount}/${totalCount}), minimum required is ${MIN_SKU_MAPPING_COVERAGE}%`,
          fixSuggestion: `Map at least ${Math.ceil((totalCount * MIN_SKU_MAPPING_COVERAGE) / 100) - mappedCount} more SKUs to reach the ${MIN_SKU_MAPPING_COVERAGE}% threshold.`,
        };
      }

      return {
        dimension: 'sku_mapping_coverage',
        passed: true,
        details: `SKU mapping coverage is ${coverage.toFixed(1)}% (${mappedCount}/${totalCount})`,
      };
    } catch (error) {
      logger.error({ error, tenantId, shopId }, 'Error validating SKU mapping coverage');
      return {
        dimension: 'sku_mapping_coverage',
        passed: false,
        details: 'Failed to validate SKU mapping coverage due to an internal error',
        fixSuggestion: 'Retry the validation. Ensure channel SKUs have been imported.',
      };
    }
  }

  /**
   * Validate logistics rules configuration.
   * At least one logistics/shipping rule must be configured for the shop.
   */
  private async validateLogisticsRules(
    tenantId: string,
    shopId: string,
  ): Promise<ValidationCheckResult> {
    try {
      // Check onboarding session step_data for rule_setup
      const rows = await this.db.query<{ step_data: Record<string, unknown> }>(
        `SELECT step_data FROM onboarding_sessions WHERE shop_id = $1 AND status = 'in_progress' ORDER BY started_at DESC LIMIT 1`,
        [shopId],
        tenantId,
      );

      if (rows.length === 0) {
        return {
          dimension: 'logistics_rules',
          passed: false,
          details: 'No onboarding session found for this shop',
          fixSuggestion: 'Start the onboarding process and complete the rule setup step.',
        };
      }

      const stepData = typeof rows[0].step_data === 'string'
        ? JSON.parse(rows[0].step_data as unknown as string)
        : rows[0].step_data;

      const ruleSetup = stepData?.rule_setup;

      if (!ruleSetup || ruleSetup.status !== 'completed') {
        return {
          dimension: 'logistics_rules',
          passed: false,
          details: 'Logistics rules have not been configured',
          fixSuggestion: 'Complete the rule setup step with at least one shipping rule.',
        };
      }

      const rules = ruleSetup.data?.rules ?? [];
      if (!Array.isArray(rules) || rules.length === 0) {
        return {
          dimension: 'logistics_rules',
          passed: false,
          details: 'No logistics rules defined',
          fixSuggestion: 'Add at least one shipping rule in the rule setup step.',
        };
      }

      return {
        dimension: 'logistics_rules',
        passed: true,
        details: `${rules.length} logistics rule(s) configured`,
      };
    } catch (error) {
      logger.error({ error, tenantId, shopId }, 'Error validating logistics rules');
      return {
        dimension: 'logistics_rules',
        passed: false,
        details: 'Failed to validate logistics rules due to an internal error',
        fixSuggestion: 'Retry the validation. Ensure the rule setup step is completed.',
      };
    }
  }

  /**
   * Validate inventory association.
   * At least one warehouse must have inventory records linked to mapped system SKUs.
   */
  private async validateInventoryAssociation(
    tenantId: string,
    shopId: string,
  ): Promise<ValidationCheckResult> {
    try {
      // Check if there are inventory records for system SKUs that are mapped to this shop's channel SKUs
      const rows = await this.db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM inventory i
         JOIN sku_mappings sm ON sm.system_sku_id = i.system_sku_id
         JOIN channel_skus cs ON cs.id = sm.channel_sku_id
         WHERE cs.shop_id = $1 AND sm.system_sku_id IS NOT NULL`,
        [shopId],
        tenantId,
      );

      const count = parseInt(rows[0]?.count ?? '0', 10);

      if (count === 0) {
        return {
          dimension: 'inventory_association',
          passed: false,
          details: 'No inventory records associated with mapped SKUs',
          fixSuggestion: 'Ensure at least one warehouse has inventory for the mapped system SKUs. Sync inventory data or manually add stock levels.',
        };
      }

      return {
        dimension: 'inventory_association',
        passed: true,
        details: `${count} inventory record(s) associated with mapped SKUs`,
      };
    } catch (error) {
      logger.error({ error, tenantId, shopId }, 'Error validating inventory association');
      return {
        dimension: 'inventory_association',
        passed: false,
        details: 'Failed to validate inventory association due to an internal error',
        fixSuggestion: 'Retry the validation. Ensure inventory data has been synced.',
      };
    }
  }
}
