/**
 * SKU Mapper Service
 *
 * AI-driven SKU matching service that uses LLM (Claude) to automatically
 * match Channel SKUs with System SKUs. Provides confidence scoring,
 * classification, and persistence of match results.
 */

import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';
import type { LLMGateway, LLMRequest, LLMResponse } from '../../infrastructure/llm/types.js';
import type { PostgresDatabaseService } from '../../infrastructure/database/database-service.js';
import type {
  ChannelSKU,
  SystemSKU,
  SKUMatchResult,
  MatchOptions,
} from '../../shared/m2-types.js';

/** Default confidence threshold for high_confidence classification */
const DEFAULT_CONFIDENCE_THRESHOLD = 85;

/** Default batch size for LLM calls */
const DEFAULT_BATCH_SIZE = 10;

/** LLM response structure for a single SKU match */
interface LLMMatchResponse {
  channelSkuId: string;
  systemSkuId: string | null;
  confidence: number;
  reasoning: string;
  differencePoints?: string[];
}

/** Persisted SKU mapping row */
interface SKUMappingRow {
  id: string;
  tenant_id: string;
  channel_sku_id: string;
  system_sku_id: string | null;
  confidence: number;
  match_type: string;
  reasoning: string;
  status: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export class SKUMapperService {
  private readonly logger: pino.Logger;
  private readonly llmGateway: LLMGateway;
  private readonly db: PostgresDatabaseService;

  constructor(
    llmGateway: LLMGateway,
    db: PostgresDatabaseService,
    options?: { logger?: pino.Logger },
  ) {
    this.llmGateway = llmGateway;
    this.db = db;
    this.logger = (options?.logger ?? pino({ name: 'sku-mapper-service' })).child({
      component: 'sku-mapper',
    });
  }

  /**
   * Batch match multiple Channel SKUs against System SKUs.
   * Processes in batches via LLM to avoid token limits.
   */
  async batchMatch(
    tenantId: string,
    channelSkus: ChannelSKU[],
    options?: MatchOptions,
  ): Promise<SKUMatchResult[]> {
    const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;

    this.logger.info(
      { tenantId, channelSkuCount: channelSkus.length, batchSize },
      'Starting batch SKU matching',
    );

    // Fetch all active system SKUs for this tenant
    const systemSkus = await this.fetchSystemSkus(tenantId);

    if (systemSkus.length === 0) {
      this.logger.warn({ tenantId }, 'No active system SKUs found for tenant');
      return channelSkus.map((csku) => this.buildNoMatchResult(csku));
    }

    const results: SKUMatchResult[] = [];

    // Process in batches
    for (let i = 0; i < channelSkus.length; i += batchSize) {
      const batch = channelSkus.slice(i, i + batchSize);
      const batchResults = await this.matchBatch(tenantId, batch, systemSkus, options);
      results.push(...batchResults);
    }

    // Persist all results
    await this.persistResults(tenantId, results);

    this.logger.info(
      { tenantId, totalMatched: results.length },
      'Batch SKU matching completed',
    );

    return results;
  }

  /**
   * Match a single Channel SKU against System SKUs.
   */
  async matchSingle(
    tenantId: string,
    channelSku: ChannelSKU,
  ): Promise<SKUMatchResult> {
    this.logger.info(
      { tenantId, channelSkuId: channelSku.id },
      'Starting single SKU matching',
    );

    const systemSkus = await this.fetchSystemSkus(tenantId);

    if (systemSkus.length === 0) {
      const result = this.buildNoMatchResult(channelSku);
      await this.persistResults(tenantId, [result]);
      return result;
    }

    const results = await this.matchBatch(tenantId, [channelSku], systemSkus);
    const result = results[0];

    await this.persistResults(tenantId, [result]);

    return result;
  }

  /**
   * Confirm or reject a SKU mapping.
   * If rejected with a correctedSkuId, records the correction for learning.
   */
  async confirmMatch(
    mappingId: string,
    confirmed: boolean,
    correctedSkuId?: string,
  ): Promise<void> {
    this.logger.info(
      { mappingId, confirmed, correctedSkuId },
      'Confirming SKU match',
    );

    if (confirmed) {
      await this.db.transaction(async (tx) => {
        await tx.query(
          `UPDATE sku_mappings
           SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [mappingId],
        );
      });
    } else {
      await this.db.transaction(async (tx) => {
        if (correctedSkuId) {
          // Update the mapping with the corrected SKU
          await tx.query(
            `UPDATE sku_mappings
             SET status = 'corrected', system_sku_id = $2, confirmed_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [mappingId, correctedSkuId],
          );

          // Record the correction for learning
          const [mapping] = await tx.query<SKUMappingRow>(
            `SELECT * FROM sku_mappings WHERE id = $1`,
            [mappingId],
          );

          if (mapping) {
            await tx.query(
              `INSERT INTO sku_mapping_corrections
               (id, tenant_id, mapping_id, original_system_sku_id, corrected_system_sku_id, channel_sku_attributes, corrected_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                uuidv4(),
                mapping.tenant_id,
                mappingId,
                mapping.system_sku_id,
                correctedSkuId,
                '{}', // Will be populated from channel_sku attributes
                mapping.confirmed_by ?? 'system',
              ],
            );
          }
        } else {
          await tx.query(
            `UPDATE sku_mappings
             SET status = 'rejected', confirmed_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [mappingId],
          );
        }
      });
    }
  }

  /**
   * Match a batch of Channel SKUs against System SKUs using LLM.
   */
  private async matchBatch(
    tenantId: string,
    channelSkus: ChannelSKU[],
    systemSkus: SystemSKU[],
    options?: MatchOptions,
  ): Promise<SKUMatchResult[]> {
    const prompt = this.buildMatchPrompt(channelSkus, systemSkus);

    try {
      const request: LLMRequest = {
        tenantId,
        sessionId: `sku-match-${uuidv4()}`,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        system: this.buildSystemPrompt(),
      };

      const response: LLMResponse = await this.llmGateway.complete(request);
      const llmResults = this.parseLLMResponse(response);

      return channelSkus.map((csku) => {
        const llmResult = llmResults.find((r) => r.channelSkuId === csku.id);
        if (llmResult) {
          return this.classifyResult(llmResult, options);
        }
        // If LLM didn't return a result for this SKU, mark as no_match
        return this.buildNoMatchResult(csku);
      });
    } catch (error) {
      this.logger.error(
        { error, tenantId, batchSize: channelSkus.length },
        'LLM matching failed, returning no_match for batch',
      );
      // On LLM failure, mark all as no_match
      return channelSkus.map((csku) => this.buildNoMatchResult(csku));
    }
  }

  /**
   * Build the system prompt for SKU matching.
   */
  private buildSystemPrompt(): string {
    return `You are an expert SKU matching assistant for an Order Management System.
Your task is to compare Channel SKUs (from external sales channels) with System SKUs (internal product catalog) and determine the best match.

For each Channel SKU, analyze:
1. Product name similarity (accounting for abbreviations, translations, and variations)
2. Attribute matching (color, size, material, etc.)
3. Description overlap
4. Price range compatibility (if available)

Return your analysis as a JSON array with the following structure for each Channel SKU:
{
  "channelSkuId": "the channel SKU id",
  "systemSkuId": "the best matching system SKU id, or null if no match",
  "confidence": 0-100 (how confident you are in the match),
  "reasoning": "brief explanation of why this match was chosen",
  "differencePoints": ["list of differences between the channel and system SKU, if any"]
}

Rules:
- confidence 0 means no match found at all
- confidence 1-84 means partial match with notable differences
- confidence 85-100 means high confidence match
- Always provide reasoning for your decision
- If no system SKU is a reasonable match, set systemSkuId to null and confidence to 0
- Return ONLY valid JSON array, no other text`;
  }

  /**
   * Build the user prompt with Channel SKU and System SKU data.
   */
  buildMatchPrompt(channelSkus: ChannelSKU[], systemSkus: SystemSKU[]): string {
    const channelSkuData = channelSkus.map((csku) => ({
      id: csku.id,
      name: csku.name,
      description: csku.description ?? '',
      attributes: csku.attributes,
      price: csku.price,
    }));

    const systemSkuData = systemSkus.map((ssku) => ({
      id: ssku.id,
      sku: ssku.sku,
      name: ssku.name,
      description: ssku.description ?? '',
      attributes: ssku.attributes,
      category: ssku.category ?? '',
    }));

    return `Please match the following Channel SKUs with the most appropriate System SKU.

## Channel SKUs to match:
${JSON.stringify(channelSkuData, null, 2)}

## Available System SKUs:
${JSON.stringify(systemSkuData, null, 2)}

Return a JSON array with one match result per Channel SKU.`;
  }

  /**
   * Parse the LLM response to extract match results.
   */
  parseLLMResponse(response: LLMResponse): LLMMatchResponse[] {
    const textContent = response.content.find((block) => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      this.logger.warn('LLM response contains no text content');
      return [];
    }

    const text = textContent.text.trim();

    try {
      // Try to parse the entire response as JSON
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return this.validateLLMResults(parsed);
      }
      // If it's a single object, wrap in array
      if (typeof parsed === 'object' && parsed !== null) {
        return this.validateLLMResults([parsed]);
      }
    } catch {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1].trim());
          if (Array.isArray(parsed)) {
            return this.validateLLMResults(parsed);
          }
        } catch {
          this.logger.warn('Failed to parse JSON from code block in LLM response');
        }
      }
    }

    this.logger.warn({ responseText: text.substring(0, 200) }, 'Failed to parse LLM response');
    return [];
  }

  /**
   * Validate and normalize LLM match results.
   */
  private validateLLMResults(results: unknown[]): LLMMatchResponse[] {
    return results
      .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
      .map((r) => ({
        channelSkuId: String(r.channelSkuId ?? ''),
        systemSkuId: r.systemSkuId != null ? String(r.systemSkuId) : null,
        confidence: Math.max(0, Math.min(100, Number(r.confidence) || 0)),
        reasoning: String(r.reasoning ?? 'No reasoning provided'),
        differencePoints: Array.isArray(r.differencePoints)
          ? r.differencePoints.map(String)
          : undefined,
      }))
      .filter((r) => r.channelSkuId !== '');
  }

  /**
   * Classify a match result based on confidence score.
   *
   * - confidence >= 85 → high_confidence
   * - 0 < confidence < 85 → needs_review (with differencePoints)
   * - confidence = 0 or no match → no_match (with suggestNewSku)
   */
  classifyResult(
    llmResult: LLMMatchResponse,
    options?: MatchOptions,
  ): SKUMatchResult {
    const threshold = options?.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    const confidence = llmResult.confidence;

    if (confidence === 0 || llmResult.systemSkuId === null) {
      return {
        channelSkuId: llmResult.channelSkuId,
        systemSkuId: null,
        confidence: 0,
        matchType: 'no_match',
        reasoning: llmResult.reasoning,
        differencePoints: llmResult.differencePoints,
        suggestNewSku: true,
      };
    }

    if (confidence >= threshold) {
      return {
        channelSkuId: llmResult.channelSkuId,
        systemSkuId: llmResult.systemSkuId,
        confidence,
        matchType: 'high_confidence',
        reasoning: llmResult.reasoning,
      };
    }

    // 0 < confidence < threshold → needs_review
    return {
      channelSkuId: llmResult.channelSkuId,
      systemSkuId: llmResult.systemSkuId,
      confidence,
      matchType: 'needs_review',
      reasoning: llmResult.reasoning,
      differencePoints: llmResult.differencePoints ?? ['Confidence below threshold'],
    };
  }

  /**
   * Build a no_match result for a Channel SKU (when no system SKUs exist or LLM fails).
   */
  private buildNoMatchResult(channelSku: ChannelSKU): SKUMatchResult {
    return {
      channelSkuId: channelSku.id,
      systemSkuId: null,
      confidence: 0,
      matchType: 'no_match',
      reasoning: 'No matching System SKU found',
      suggestNewSku: true,
    };
  }

  /**
   * Persist match results to the sku_mappings table.
   */
  private async persistResults(
    tenantId: string,
    results: SKUMatchResult[],
  ): Promise<void> {
    if (results.length === 0) return;

    await this.db.transaction(async (tx) => {
      for (const result of results) {
        await tx.query(
          `INSERT INTO sku_mappings (id, tenant_id, channel_sku_id, system_sku_id, confidence, match_type, reasoning, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (tenant_id, channel_sku_id)
           DO UPDATE SET system_sku_id = $4, confidence = $5, match_type = $6, reasoning = $7, status = $8, updated_at = NOW()`,
          [
            uuidv4(),
            tenantId,
            result.channelSkuId,
            result.systemSkuId,
            result.confidence,
            result.matchType,
            result.reasoning,
            'pending',
          ],
        );
      }
    });
  }

  /**
   * Fetch all active System SKUs for a tenant.
   */
  private async fetchSystemSkus(tenantId: string): Promise<SystemSKU[]> {
    const rows = await this.db.query<{
      id: string;
      tenant_id: string;
      sku: string;
      name: string;
      description: string | null;
      attributes: Record<string, string>;
      category: string | null;
      status: string;
    }>(
      `SELECT id, tenant_id, sku, name, description, attributes, category, status
       FROM system_skus
       WHERE status = 'active'`,
      [],
      tenantId,
    );

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      sku: row.sku,
      name: row.name,
      description: row.description ?? undefined,
      attributes: row.attributes,
      category: row.category ?? undefined,
      status: row.status as 'active' | 'inactive',
    }));
  }
}
