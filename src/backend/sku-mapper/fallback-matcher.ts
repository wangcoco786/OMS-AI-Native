/**
 * Fallback Matcher for SKU Mapping
 *
 * Provides rule-based matching when LLM is unavailable or as a fallback.
 * Implements a chain of matching strategies:
 * 1. Exact name match
 * 2. Normalized name match (lowercase, trimmed, no special chars)
 * 3. Attribute similarity (Jaccard-like comparison)
 * 4. Historical corrections (learning from past user corrections)
 *
 * The fallback chain is: LLM → Rule-based → Mark for manual review.
 */

import pino from 'pino';
import type { PostgresDatabaseService } from '../../infrastructure/database/database-service.js';
import type {
  ChannelSKU,
  SystemSKU,
  SKUMatchResult,
} from '../../shared/m2-types.js';

/** Minimum attribute similarity score to consider a match */
const ATTRIBUTE_SIMILARITY_THRESHOLD = 0.5;

/** Confidence assigned to exact name matches */
const EXACT_MATCH_CONFIDENCE = 95;

/** Confidence assigned to normalized name matches */
const NORMALIZED_MATCH_CONFIDENCE = 80;

/** Base confidence for attribute similarity matches (scaled by similarity) */
const ATTRIBUTE_MATCH_BASE_CONFIDENCE = 70;

/** Confidence assigned to historical correction matches */
const HISTORICAL_MATCH_CONFIDENCE = 90;

/** Historical correction row from the database */
interface CorrectionRow {
  corrected_system_sku_id: string;
  channel_sku_attributes: Record<string, string>;
}

export class FallbackMatcher {
  private readonly logger: pino.Logger;
  private readonly db: PostgresDatabaseService;

  constructor(db: PostgresDatabaseService, options?: { logger?: pino.Logger }) {
    this.db = db;
    this.logger = (options?.logger ?? pino({ name: 'fallback-matcher' })).child({
      component: 'fallback-matcher',
    });
  }

  /**
   * Attempt rule-based matching for a Channel SKU against System SKUs.
   * Tries strategies in order: exact → normalized → historical → attribute similarity.
   */
  async match(
    tenantId: string,
    channelSku: ChannelSKU,
    systemSkus: SystemSKU[],
  ): Promise<SKUMatchResult> {
    this.logger.debug(
      { tenantId, channelSkuId: channelSku.id },
      'Attempting rule-based fallback match',
    );

    // Strategy 1: Exact name match
    const exactMatch = this.exactNameMatch(channelSku, systemSkus);
    if (exactMatch) return exactMatch;

    // Strategy 2: Normalized name match
    const normalizedMatch = this.normalizedNameMatch(channelSku, systemSkus);
    if (normalizedMatch) return normalizedMatch;

    // Strategy 3: Historical corrections
    const historicalMatch = await this.historicalCorrectionMatch(tenantId, channelSku, systemSkus);
    if (historicalMatch) return historicalMatch;

    // Strategy 4: Attribute similarity
    const attributeMatch = this.attributeSimilarityMatch(channelSku, systemSkus);
    if (attributeMatch) return attributeMatch;

    // No match found — mark for manual review
    return this.markForManualReview(channelSku);
  }

  /**
   * Strategy 1: Exact name match.
   * Compares channel SKU name directly with system SKU names.
   */
  private exactNameMatch(channelSku: ChannelSKU, systemSkus: SystemSKU[]): SKUMatchResult | null {
    const match = systemSkus.find((ssku) => ssku.name === channelSku.name);
    if (!match) return null;

    return {
      channelSkuId: channelSku.id,
      systemSkuId: match.id,
      confidence: EXACT_MATCH_CONFIDENCE,
      matchType: 'high_confidence',
      reasoning: `Exact name match: "${channelSku.name}"`,
    };
  }

  /**
   * Strategy 2: Normalized name match.
   * Normalizes both names (lowercase, trim, remove special characters) before comparing.
   */
  private normalizedNameMatch(channelSku: ChannelSKU, systemSkus: SystemSKU[]): SKUMatchResult | null {
    const normalizedChannelName = this.normalizeName(channelSku.name);

    const match = systemSkus.find(
      (ssku) => this.normalizeName(ssku.name) === normalizedChannelName,
    );
    if (!match) return null;

    return {
      channelSkuId: channelSku.id,
      systemSkuId: match.id,
      confidence: NORMALIZED_MATCH_CONFIDENCE,
      matchType: 'needs_review',
      reasoning: `Normalized name match: "${channelSku.name}" ≈ "${match.name}"`,
      differencePoints: ['Names differ in casing or special characters'],
    };
  }

  /**
   * Strategy 3: Historical correction match.
   * Looks up past corrections for similar channel SKU attributes.
   */
  private async historicalCorrectionMatch(
    tenantId: string,
    channelSku: ChannelSKU,
    systemSkus: SystemSKU[],
  ): Promise<SKUMatchResult | null> {
    try {
      const corrections = await this.db.query<CorrectionRow>(
        `SELECT corrected_system_sku_id, channel_sku_attributes
         FROM sku_mapping_corrections
         ORDER BY created_at DESC
         LIMIT 100`,
        [],
        tenantId,
      );

      if (corrections.length === 0) return null;

      // Find a correction with matching attributes
      for (const correction of corrections) {
        const similarity = this.computeAttributeSimilarity(
          channelSku.attributes,
          correction.channel_sku_attributes,
        );

        if (similarity >= 0.8) {
          // Verify the corrected SKU is still in the system SKU list
          const systemSku = systemSkus.find(
            (ssku) => ssku.id === correction.corrected_system_sku_id,
          );
          if (systemSku) {
            return {
              channelSkuId: channelSku.id,
              systemSkuId: systemSku.id,
              confidence: HISTORICAL_MATCH_CONFIDENCE,
              matchType: 'high_confidence',
              reasoning: `Historical correction match: similar attributes previously corrected to "${systemSku.name}"`,
            };
          }
        }
      }

      return null;
    } catch (error) {
      this.logger.warn({ error }, 'Failed to query historical corrections');
      return null;
    }
  }

  /**
   * Strategy 4: Attribute similarity match.
   * Computes similarity between channel SKU attributes and each system SKU's attributes.
   */
  private attributeSimilarityMatch(
    channelSku: ChannelSKU,
    systemSkus: SystemSKU[],
  ): SKUMatchResult | null {
    let bestMatch: SystemSKU | null = null;
    let bestSimilarity = 0;

    for (const ssku of systemSkus) {
      const similarity = this.computeAttributeSimilarity(channelSku.attributes, ssku.attributes);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = ssku;
      }
    }

    if (!bestMatch || bestSimilarity < ATTRIBUTE_SIMILARITY_THRESHOLD) {
      return null;
    }

    const confidence = Math.round(ATTRIBUTE_MATCH_BASE_CONFIDENCE * bestSimilarity);
    const differencePoints = this.computeDifferencePoints(channelSku.attributes, bestMatch.attributes);

    return {
      channelSkuId: channelSku.id,
      systemSkuId: bestMatch.id,
      confidence,
      matchType: confidence >= 85 ? 'high_confidence' : 'needs_review',
      reasoning: `Attribute similarity match (${Math.round(bestSimilarity * 100)}% similar) with "${bestMatch.name}"`,
      differencePoints: differencePoints.length > 0 ? differencePoints : undefined,
    };
  }

  /**
   * Mark a Channel SKU for manual review when no rule-based match is found.
   */
  markForManualReview(channelSku: ChannelSKU): SKUMatchResult {
    return {
      channelSkuId: channelSku.id,
      systemSkuId: null,
      confidence: 0,
      matchType: 'no_match',
      reasoning: 'No rule-based match found; marked for manual review',
      suggestNewSku: true,
    };
  }

  /**
   * Normalize a name for comparison: lowercase, trim, remove special characters.
   */
  normalizeName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\u4e00-\u9fff\s]/g, '')
      .replace(/\s+/g, ' ');
  }

  /**
   * Compute Jaccard-like similarity between two attribute maps.
   * Compares both keys and values.
   */
  computeAttributeSimilarity(
    attrsA: Record<string, string>,
    attrsB: Record<string, string>,
  ): number {
    const keysA = Object.keys(attrsA);
    const keysB = Object.keys(attrsB);

    if (keysA.length === 0 && keysB.length === 0) return 0;

    const allKeys = new Set([...keysA, ...keysB]);
    let matchCount = 0;

    for (const key of allKeys) {
      if (key in attrsA && key in attrsB) {
        const valA = attrsA[key].toLowerCase().trim();
        const valB = attrsB[key].toLowerCase().trim();
        if (valA === valB) {
          matchCount++;
        } else {
          // Partial credit for having the same key
          matchCount += 0.3;
        }
      }
    }

    return matchCount / allKeys.size;
  }

  /**
   * Compute difference points between two attribute maps.
   */
  private computeDifferencePoints(
    channelAttrs: Record<string, string>,
    systemAttrs: Record<string, string>,
  ): string[] {
    const differences: string[] = [];
    const allKeys = new Set([...Object.keys(channelAttrs), ...Object.keys(systemAttrs)]);

    for (const key of allKeys) {
      const channelVal = channelAttrs[key];
      const systemVal = systemAttrs[key];

      if (channelVal && !systemVal) {
        differences.push(`Channel has "${key}=${channelVal}" but system does not`);
      } else if (!channelVal && systemVal) {
        differences.push(`System has "${key}=${systemVal}" but channel does not`);
      } else if (channelVal && systemVal && channelVal.toLowerCase() !== systemVal.toLowerCase()) {
        differences.push(`"${key}" differs: channel="${channelVal}" vs system="${systemVal}"`);
      }
    }

    return differences;
  }
}
