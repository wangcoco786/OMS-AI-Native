/**
 * Sync Adapter Registry
 *
 * Maps source names ('shopify', 'wms', 'erp') to their respective adapter instances.
 * Implements the SyncAdapterRegistry interface defined in sync-adapter.ts.
 */

import type { SyncAdapter, SyncAdapterRegistry } from '../sync-adapter.js';
import { ShopifyAdapter } from './shopify-adapter.js';
import { WmsAdapter } from './wms-adapter.js';
import { ErpAdapter } from './erp-adapter.js';

/**
 * Default adapter registry that provides pre-configured adapters
 * for all supported sync sources (Shopify, WMS, ERP).
 */
export class DefaultAdapterRegistry implements SyncAdapterRegistry {
  private readonly adapters: Map<string, SyncAdapter>;

  constructor(customAdapters?: Record<string, SyncAdapter>) {
    this.adapters = new Map<string, SyncAdapter>();

    // Register default adapters
    this.adapters.set('shopify', new ShopifyAdapter());
    this.adapters.set('wms', new WmsAdapter());
    this.adapters.set('erp', new ErpAdapter());

    // Override with custom adapters if provided
    if (customAdapters) {
      for (const [source, adapter] of Object.entries(customAdapters)) {
        this.adapters.set(source, adapter);
      }
    }
  }

  /**
   * Get the adapter for a given source name.
   *
   * @param source - The source identifier (e.g., 'shopify', 'wms', 'erp')
   * @returns The adapter instance, or undefined if no adapter is registered for the source
   */
  getAdapter(source: string): SyncAdapter | undefined {
    return this.adapters.get(source);
  }

  /**
   * Register a new adapter for a source.
   * Can be used to add custom adapters or override existing ones.
   *
   * @param source - The source identifier
   * @param adapter - The adapter instance
   */
  registerAdapter(source: string, adapter: SyncAdapter): void {
    this.adapters.set(source, adapter);
  }

  /**
   * Get all registered source names.
   */
  getSources(): string[] {
    return Array.from(this.adapters.keys());
  }
}
