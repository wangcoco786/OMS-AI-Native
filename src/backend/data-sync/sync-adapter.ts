/**
 * Sync Adapter Interface
 *
 * Defines the contract for data source adapters (Shopify, WMS, ERP).
 * Each adapter implements fetchRecords to pull incremental data
 * from its respective source using a cursor-based pagination strategy.
 */

/**
 * A single record returned by a sync adapter.
 */
export interface SyncRecord {
  id: string;
  data: Record<string, unknown>;
  updatedAt: string;
  action: 'create' | 'update' | 'delete';
}

/**
 * Result of a single fetch call from an adapter.
 * Supports cursor-based pagination via nextCursor and hasMore.
 */
export interface SyncFetchResult {
  records: SyncRecord[];
  nextCursor: string;
  hasMore: boolean;
}

/**
 * Interface that all sync adapters must implement.
 * Adapters are responsible for connecting to external data sources
 * and returning incremental records based on a cursor.
 */
export interface SyncAdapter {
  /**
   * Fetch records from the data source.
   *
   * @param config - Source-specific configuration (API keys, endpoints, etc.)
   * @param cursor - Optional cursor from the last sync; if undefined, fetches from the beginning
   * @returns A SyncFetchResult containing records, the next cursor, and whether more data is available
   */
  fetchRecords(config: Record<string, unknown>, cursor?: string): Promise<SyncFetchResult>;
}

/**
 * Registry for sync adapters keyed by source type.
 */
export interface SyncAdapterRegistry {
  getAdapter(source: string): SyncAdapter | undefined;
}
