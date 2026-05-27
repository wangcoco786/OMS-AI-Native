/**
 * Accuracy Service for SKU Mapper
 *
 * Calculates SKU matching accuracy statistics:
 * - accuracy = confirmed / (confirmed + corrected) × 100%
 * - Provides low-accuracy warning when accuracy < 85%
 * - Supports filtering by session or tenant-wide stats
 */

import pino from 'pino';
import type { PostgresDatabaseService } from '../../infrastructure/database/database-service.js';
import type { AccuracyStats } from '../../shared/m2-types.js';

/** Accuracy threshold below which a data quality warning is issued */
const LOW_ACCURACY_THRESHOLD = 85;

/** Extended accuracy stats with optional warning */
export interface AccuracyReport {
  stats: AccuracyStats;
  warning?: {
    message: string;
    suggestions: string[];
  };
}

/** Database row for status counts */
interface StatusCountRow {
  status: string;
  count: string;
}

/** Database row for match type counts */
interface MatchTypeCountRow {
  match_type: string;
  count: string;
}

export class AccuracyService {
  private readonly logger: pino.Logger;
  private readonly db: PostgresDatabaseService;

  constructor(db: PostgresDatabaseService, options?: { logger?: pino.Logger }) {
    this.db = db;
    this.logger = (options?.logger ?? pino({ name: 'accuracy-service' })).child({
      component: 'accuracy-service',
    });
  }

  /**
   * Get accuracy statistics for a tenant, optionally filtered by session.
   * Accuracy = confirmed / (confirmed + corrected) × 100%
   *
   * When accuracy < 85%, includes a data quality warning.
   */
  async getAccuracyReport(tenantId: string, sessionId?: string): Promise<AccuracyReport> {
    this.logger.info({ tenantId, sessionId }, 'Calculating accuracy stats');

    const stats = await this.calculateStats(tenantId, sessionId);
    const report: AccuracyReport = { stats };

    if (stats.accuracy < LOW_ACCURACY_THRESHOLD) {
      report.warning = {
        message: `SKU matching accuracy is ${stats.accuracy.toFixed(1)}%, below the ${LOW_ACCURACY_THRESHOLD}% threshold. Data quality may be affected.`,
        suggestions: [
          'Review and correct pending SKU mappings',
          'Check channel SKU data quality (missing attributes, inconsistent naming)',
          'Consider adding more system SKUs to improve coverage',
          'Review recent corrections for patterns that could improve matching rules',
        ],
      };
    }

    return report;
  }

  /**
   * Get raw accuracy stats without the warning wrapper.
   */
  async getStats(tenantId: string, sessionId?: string): Promise<AccuracyStats> {
    return this.calculateStats(tenantId, sessionId);
  }

  /**
   * Calculate accuracy statistics from the sku_mappings table.
   */
  private async calculateStats(tenantId: string, sessionId?: string): Promise<AccuracyStats> {
    // Query status counts
    let statusQuery = `SELECT status, COUNT(*)::text as count FROM sku_mappings`;
    const statusParams: unknown[] = [];

    if (sessionId) {
      // Filter by channel_skus that were imported in a specific session
      statusQuery += ` WHERE channel_sku_id IN (
        SELECT id FROM channel_skus WHERE shop_id = $1
      )`;
      statusParams.push(sessionId);
    }

    statusQuery += ` GROUP BY status`;

    const statusRows = await this.db.query<StatusCountRow>(
      statusQuery,
      statusParams,
      tenantId,
    );

    // Query match type counts
    let matchTypeQuery = `SELECT match_type, COUNT(*)::text as count FROM sku_mappings`;
    const matchTypeParams: unknown[] = [];

    if (sessionId) {
      matchTypeQuery += ` WHERE channel_sku_id IN (
        SELECT id FROM channel_skus WHERE shop_id = $1
      )`;
      matchTypeParams.push(sessionId);
    }

    matchTypeQuery += ` GROUP BY match_type`;

    const matchTypeRows = await this.db.query<MatchTypeCountRow>(
      matchTypeQuery,
      matchTypeParams,
      tenantId,
    );

    // Parse counts
    const statusCounts: Record<string, number> = {};
    for (const row of statusRows) {
      statusCounts[row.status] = parseInt(row.count, 10);
    }

    const matchTypeCounts: Record<string, number> = {};
    for (const row of matchTypeRows) {
      matchTypeCounts[row.match_type] = parseInt(row.count, 10);
    }

    const confirmed = statusCounts['confirmed'] ?? 0;
    const corrected = statusCounts['corrected'] ?? 0;
    const totalDecided = confirmed + corrected;

    // Calculate accuracy: confirmed / (confirmed + corrected) × 100
    const accuracy = totalDecided > 0 ? (confirmed / totalDecided) * 100 : 100;

    const totalMatches =
      (statusCounts['pending'] ?? 0) +
      (statusCounts['confirmed'] ?? 0) +
      (statusCounts['corrected'] ?? 0) +
      (statusCounts['rejected'] ?? 0);

    return {
      totalMatches,
      correctMatches: confirmed,
      accuracy: Math.round(accuracy * 100) / 100, // Round to 2 decimal places
      highConfidenceCount: matchTypeCounts['high_confidence'] ?? 0,
      needsReviewCount: matchTypeCounts['needs_review'] ?? 0,
      noMatchCount: matchTypeCounts['no_match'] ?? 0,
    };
  }
}
