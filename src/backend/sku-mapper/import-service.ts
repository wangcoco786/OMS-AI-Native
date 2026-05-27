/**
 * Import Service for SKU Mapper
 *
 * Handles batch import of Channel SKUs from CSV or API format.
 * Inserts records into the channel_skus table and returns import results
 * with counts of imported, skipped, and errored records.
 */

import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';
import type { PostgresDatabaseService } from '../../infrastructure/database/database-service.js';
import type { ChannelSKU, ImportData, ImportResult } from '../../shared/m2-types.js';

/** CSV row structure after parsing */
interface CSVRow {
  externalId?: string;
  external_id?: string;
  name?: string;
  description?: string;
  attributes?: string;
  price?: string;
  imageUrl?: string;
  image_url?: string;
  channelId?: string;
  channel_id?: string;
}

export class ImportService {
  private readonly logger: pino.Logger;
  private readonly db: PostgresDatabaseService;

  constructor(db: PostgresDatabaseService, options?: { logger?: pino.Logger }) {
    this.db = db;
    this.logger = (options?.logger ?? pino({ name: 'import-service' })).child({
      component: 'import-service',
    });
  }

  /**
   * Import Channel SKUs from structured data (CSV or API format).
   * Returns the import result with counts and any errors.
   */
  async importChannelSkus(data: ImportData): Promise<ImportResult> {
    this.logger.info(
      { tenantId: data.tenantId, shopId: data.shopId, format: data.format, recordCount: data.records.length },
      'Starting channel SKU import',
    );

    const result: ImportResult = {
      totalRecords: data.records.length,
      importedCount: 0,
      skippedCount: 0,
      errors: [],
    };

    if (data.records.length === 0) {
      return result;
    }

    await this.db.transaction(async (tx) => {
      for (let i = 0; i < data.records.length; i++) {
        const record = data.records[i];

        // Validate required fields
        const validationError = this.validateRecord(record, i);
        if (validationError) {
          result.errors.push({ index: i, reason: validationError });
          result.skippedCount++;
          continue;
        }

        try {
          const id = uuidv4();
          await tx.query(
            `INSERT INTO channel_skus (id, tenant_id, shop_id, external_id, name, description, attributes, price, image_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (tenant_id, shop_id, external_id) DO UPDATE
             SET name = $5, description = $6, attributes = $7, price = $8, image_url = $9, imported_at = NOW()`,
            [
              id,
              data.tenantId,
              data.shopId,
              record.externalId,
              record.name,
              record.description ?? null,
              JSON.stringify(record.attributes ?? {}),
              record.price ?? null,
              record.imageUrl ?? null,
            ],
          );
          result.importedCount++;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          this.logger.warn({ error, index: i }, 'Failed to import record');
          result.errors.push({ index: i, reason: message });
          result.skippedCount++;
        }
      }
    });

    this.logger.info(
      {
        tenantId: data.tenantId,
        imported: result.importedCount,
        skipped: result.skippedCount,
        errors: result.errors.length,
      },
      'Channel SKU import completed',
    );

    return result;
  }

  /**
   * Parse CSV text into ImportData records.
   * Expected CSV columns: externalId, name, description, attributes (JSON), price, imageUrl, channelId
   */
  parseCSV(csvText: string, tenantId: string, shopId: string): ImportData {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) {
      return { tenantId, shopId, format: 'csv', records: [] };
    }

    const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
    const records: Omit<ChannelSKU, 'id'>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      const row: CSVRow = {};

      headers.forEach((header, idx) => {
        (row as Record<string, string>)[header] = values[idx]?.trim().replace(/^"|"$/g, '') ?? '';
      });

      const externalId = row.externalId || row.external_id || '';
      const name = row.name || '';
      const channelId = row.channelId || row.channel_id || '';

      if (!externalId || !name) continue;

      let attributes: Record<string, string> = {};
      if (row.attributes) {
        try {
          attributes = JSON.parse(row.attributes);
        } catch {
          // If attributes is not valid JSON, skip it
        }
      }

      records.push({
        channelId: channelId,
        externalId,
        name,
        description: row.description || undefined,
        attributes,
        price: row.price ? parseFloat(row.price) : undefined,
        imageUrl: row.imageUrl || row.image_url || undefined,
      });
    }

    return { tenantId, shopId, format: 'csv', records };
  }

  /**
   * Validate a single import record.
   * Returns an error message if invalid, or null if valid.
   */
  private validateRecord(record: Omit<ChannelSKU, 'id'>, _index: number): string | null {
    if (!record.externalId || record.externalId.trim() === '') {
      return 'Missing required field: externalId';
    }
    if (!record.name || record.name.trim() === '') {
      return 'Missing required field: name';
    }
    if (!record.channelId || record.channelId.trim() === '') {
      return 'Missing required field: channelId';
    }
    if (record.price !== undefined && record.price !== null && isNaN(Number(record.price))) {
      return 'Invalid price: must be a number';
    }
    return null;
  }

  /**
   * Parse a single CSV line, handling quoted fields with commas.
   */
  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current);
    return result;
  }
}
