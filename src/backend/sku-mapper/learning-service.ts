/**
 * Learning Service for SKU Mapper
 *
 * Records user corrections to the sku_mapping_corrections table so that
 * future matching can reference historical corrections. This enables the
 * system to learn from human feedback and improve accuracy over time.
 */

import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';
import type { PostgresDatabaseService } from '../../infrastructure/database/database-service.js';

/** Input for recording a correction */
export interface CorrectionInput {
  tenantId: string;
  mappingId: string;
  originalSystemSkuId: string | null;
  correctedSystemSkuId: string;
  channelSkuAttributes: Record<string, string>;
  correctedBy: string;
}

/** Stored correction record */
export interface CorrectionRecord {
  id: string;
  tenantId: string;
  mappingId: string;
  originalSystemSkuId: string | null;
  correctedSystemSkuId: string;
  channelSkuAttributes: Record<string, string>;
  correctedBy: string;
  createdAt: Date;
}

/** Database row for corrections */
interface CorrectionRow {
  id: string;
  tenant_id: string;
  mapping_id: string;
  original_system_sku_id: string | null;
  corrected_system_sku_id: string;
  channel_sku_attributes: Record<string, string>;
  corrected_by: string;
  created_at: string;
}

export class LearningService {
  private readonly logger: pino.Logger;
  private readonly db: PostgresDatabaseService;

  constructor(db: PostgresDatabaseService, options?: { logger?: pino.Logger }) {
    this.db = db;
    this.logger = (options?.logger ?? pino({ name: 'learning-service' })).child({
      component: 'learning-service',
    });
  }

  /**
   * Record a user correction for a SKU mapping.
   * This data is used by the FallbackMatcher to improve future matches.
   */
  async recordCorrection(input: CorrectionInput): Promise<CorrectionRecord> {
    this.logger.info(
      {
        tenantId: input.tenantId,
        mappingId: input.mappingId,
        correctedSystemSkuId: input.correctedSystemSkuId,
      },
      'Recording SKU mapping correction',
    );

    const id = uuidv4();

    await this.db.transaction(async (tx) => {
      // Insert the correction record
      await tx.query(
        `INSERT INTO sku_mapping_corrections
         (id, tenant_id, mapping_id, original_system_sku_id, corrected_system_sku_id, channel_sku_attributes, corrected_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          input.tenantId,
          input.mappingId,
          input.originalSystemSkuId,
          input.correctedSystemSkuId,
          JSON.stringify(input.channelSkuAttributes),
          input.correctedBy,
        ],
      );

      // Update the mapping status to 'corrected' and set the new system SKU
      await tx.query(
        `UPDATE sku_mappings
         SET status = 'corrected',
             system_sku_id = $2,
             confirmed_by = $3,
             confirmed_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [input.mappingId, input.correctedSystemSkuId, input.correctedBy],
      );
    });

    return {
      id,
      tenantId: input.tenantId,
      mappingId: input.mappingId,
      originalSystemSkuId: input.originalSystemSkuId,
      correctedSystemSkuId: input.correctedSystemSkuId,
      channelSkuAttributes: input.channelSkuAttributes,
      correctedBy: input.correctedBy,
      createdAt: new Date(),
    };
  }

  /**
   * Get recent corrections for a tenant (used for learning context).
   */
  async getRecentCorrections(tenantId: string, limit: number = 100): Promise<CorrectionRecord[]> {
    const rows = await this.db.query<CorrectionRow>(
      `SELECT id, tenant_id, mapping_id, original_system_sku_id, corrected_system_sku_id,
              channel_sku_attributes, corrected_by, created_at
       FROM sku_mapping_corrections
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
      tenantId,
    );

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      mappingId: row.mapping_id,
      originalSystemSkuId: row.original_system_sku_id,
      correctedSystemSkuId: row.corrected_system_sku_id,
      channelSkuAttributes: row.channel_sku_attributes,
      correctedBy: row.corrected_by,
      createdAt: new Date(row.created_at),
    }));
  }
}
