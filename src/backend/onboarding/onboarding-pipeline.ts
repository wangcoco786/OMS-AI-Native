/**
 * Onboarding Pipeline Integration
 *
 * Connects the full onboarding flow:
 *   Onboarding Agent → SKU Mapper → Configuration Validator
 *
 * Responsibilities:
 * - Step 3 (sku_mapping): Calls SKU Mapper Service to batch-match channel SKUs
 * - Step 5 (validation): Calls Configuration Validator + Order Flow Simulator
 * - On successful validation: Updates shop status to 'active'
 *
 * Requirements: 1.1, 2.1, 3.5, 11.1
 */

import pino from 'pino';

import type { DatabaseService } from '../../infrastructure/database/types.js';
import type { SKUMapperService } from '../sku-mapper/sku-mapper-service.js';
import type { ChannelSKU, OnboardingReport, ValidationReport } from '../../shared/m2-types.js';
import { ConfigurationValidator } from './config-validator.js';
import { OrderFlowSimulator } from './order-flow-simulator.js';
import type { OnboardingSessionService } from './session-service.js';

const logger = pino({ name: 'onboarding-pipeline' });

/** Dependencies for the OnboardingPipeline */
export interface OnboardingPipelineDeps {
  db: DatabaseService;
  sessionService: OnboardingSessionService;
  skuMapperService: SKUMapperService;
  configValidator: ConfigurationValidator;
  orderFlowSimulator: OrderFlowSimulator;
}

/**
 * OnboardingPipeline orchestrates the full onboarding flow, integrating
 * SKU Mapper and Configuration Validator into the step engine lifecycle.
 */
export class OnboardingPipeline {
  private readonly db: DatabaseService;
  private readonly sessionService: OnboardingSessionService;
  private readonly skuMapperService: SKUMapperService;
  private readonly configValidator: ConfigurationValidator;
  private readonly orderFlowSimulator: OrderFlowSimulator;

  constructor(deps: OnboardingPipelineDeps) {
    this.db = deps.db;
    this.sessionService = deps.sessionService;
    this.skuMapperService = deps.skuMapperService;
    this.configValidator = deps.configValidator;
    this.orderFlowSimulator = deps.orderFlowSimulator;
  }

  /**
   * Execute SKU mapping for onboarding step 3.
   *
   * Fetches channel SKUs for the shop and calls the SKU Mapper Service
   * to perform batch matching against system SKUs.
   *
   * Returns the match results to be presented to the user for confirmation.
   */
  async executeSkuMapping(
    tenantId: string,
    shopId: string,
    sessionId: string,
  ): Promise<{
    success: boolean;
    matchResults: import('../../shared/m2-types.js').SKUMatchResult[];
    totalChannelSkus: number;
    error?: string;
  }> {
    logger.info({ tenantId, shopId, sessionId }, 'Executing SKU mapping for onboarding step 3');

    try {
      // Fetch channel SKUs for this shop
      const channelSkus = await this.fetchChannelSkus(tenantId, shopId);

      if (channelSkus.length === 0) {
        return {
          success: false,
          matchResults: [],
          totalChannelSkus: 0,
          error: 'No channel SKUs found for this shop. Please import SKU data first.',
        };
      }

      // Call SKU Mapper Service for batch matching
      const matchResults = await this.skuMapperService.batchMatch(tenantId, channelSkus, {
        confidenceThreshold: 85,
        useLearningData: true,
      });

      logger.info(
        {
          tenantId,
          shopId,
          totalSkus: channelSkus.length,
          matched: matchResults.filter((r) => r.matchType === 'high_confidence').length,
          needsReview: matchResults.filter((r) => r.matchType === 'needs_review').length,
          noMatch: matchResults.filter((r) => r.matchType === 'no_match').length,
        },
        'SKU mapping completed for onboarding',
      );

      return {
        success: true,
        matchResults,
        totalChannelSkus: channelSkus.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error, tenantId, shopId }, 'SKU mapping failed during onboarding');
      return {
        success: false,
        matchResults: [],
        totalChannelSkus: 0,
        error: `SKU mapping failed: ${message}`,
      };
    }
  }

  /**
   * Execute validation for onboarding step 5.
   *
   * Calls the Configuration Validator to check all 4 dimensions,
   * then runs the Order Flow Simulator to verify the complete pipeline.
   *
   * If all validations pass, updates the shop status to 'active'.
   */
  async executeValidation(
    tenantId: string,
    shopId: string,
    sessionId: string,
  ): Promise<ValidationReport> {
    logger.info({ tenantId, shopId, sessionId }, 'Executing validation for onboarding step 5');

    // Step 1: Run configuration validation across all 4 dimensions
    const configReport = await this.configValidator.validateAll(tenantId, shopId);

    // Step 2: Run order flow simulation
    const simulationResult = await this.orderFlowSimulator.simulate(tenantId, shopId);

    // Step 3: Generate and persist the full validation report
    const report = await this.orderFlowSimulator.generateAndPersistReport(
      tenantId,
      shopId,
      configReport.checks,
      simulationResult,
      sessionId,
    );

    logger.info(
      {
        tenantId,
        shopId,
        canGoLive: report.canGoLive,
        overallStatus: report.overallStatus,
      },
      'Validation report generated',
    );

    // Step 4: If all validations pass, update shop status to 'active'
    if (report.canGoLive) {
      await this.activateShop(tenantId, shopId);
    }

    return report;
  }

  /**
   * Complete the full onboarding process.
   *
   * Called after all steps are done and validation passes.
   * Marks the session as completed and generates a summary report.
   */
  async completeOnboarding(
    tenantId: string,
    sessionId: string,
  ): Promise<OnboardingReport | null> {
    const session = await this.sessionService.getSession(sessionId);
    if (!session) {
      logger.warn({ sessionId }, 'Session not found for completion');
      return null;
    }

    // Calculate total duration
    const totalDuration = Date.now() - session.startedAt.getTime();

    // Run final validation
    const validationReport = await this.executeValidation(tenantId, session.shopId, sessionId);

    // Update session status to completed
    await this.markSessionCompleted(tenantId, sessionId, totalDuration);

    const report: OnboardingReport = {
      sessionId,
      shopId: session.shopId,
      totalDuration,
      interactionCount: session.metadata.interactionCount,
      completedSteps: session.completedSteps,
      validationReport,
      completedAt: new Date(),
    };

    logger.info(
      {
        sessionId,
        shopId: session.shopId,
        totalDuration,
        canGoLive: validationReport.canGoLive,
      },
      'Onboarding process completed',
    );

    return report;
  }

  /**
   * Update shop status to 'active' in the shops table.
   */
  private async activateShop(tenantId: string, shopId: string): Promise<void> {
    try {
      await this.db.query(
        `UPDATE shops SET status = 'active', updated_at = NOW() WHERE id = $1`,
        [shopId],
        tenantId,
      );
      logger.info({ tenantId, shopId }, 'Shop status updated to active');
    } catch (error) {
      logger.error({ error, tenantId, shopId }, 'Failed to update shop status to active');
      throw error;
    }
  }

  /**
   * Mark the onboarding session as completed.
   */
  private async markSessionCompleted(
    tenantId: string,
    sessionId: string,
    totalDuration: number,
  ): Promise<void> {
    try {
      await this.db.query(
        `UPDATE onboarding_sessions
         SET status = 'completed', completed_at = NOW(), total_duration_ms = $2
         WHERE id = $1`,
        [sessionId, totalDuration],
        tenantId,
      );
      logger.info({ sessionId, totalDuration }, 'Onboarding session marked as completed');
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to mark session as completed');
      throw error;
    }
  }

  /**
   * Fetch channel SKUs for a given shop from the database.
   */
  private async fetchChannelSkus(tenantId: string, shopId: string): Promise<ChannelSKU[]> {
    const rows = await this.db.query<{
      id: string;
      external_id: string;
      name: string;
      description: string | null;
      attributes: Record<string, string>;
      price: number | null;
      image_url: string | null;
    }>(
      `SELECT id, external_id, name, description, attributes, price, image_url
       FROM channel_skus WHERE shop_id = $1`,
      [shopId],
      tenantId,
    );

    return rows.map((row) => ({
      id: row.id,
      channelId: shopId,
      externalId: row.external_id,
      name: row.name,
      description: row.description ?? undefined,
      attributes: row.attributes ?? {},
      price: row.price ?? undefined,
      imageUrl: row.image_url ?? undefined,
    }));
  }
}
