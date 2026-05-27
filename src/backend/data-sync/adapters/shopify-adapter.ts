/**
 * Shopify Sync Adapter
 *
 * Fetches data from Shopify API (orders, products, inventory).
 * Uses cursor-based pagination and transforms Shopify data format
 * into the standard SyncRecord format.
 *
 * Config shape:
 * - apiKey: string - Shopify API key
 * - baseUrl: string - Shopify store URL (e.g., https://store.myshopify.com)
 * - dataType: 'orders' | 'products' | 'inventory'
 * - pageSize?: number - Number of records per page (default: 50)
 */

import type { SyncAdapter, SyncFetchResult, SyncRecord } from '../sync-adapter.js';

/** Shopify adapter configuration */
export interface ShopifyAdapterConfig {
  apiKey: string;
  baseUrl: string;
  dataType: 'orders' | 'products' | 'inventory';
  pageSize?: number;
}

/** Raw Shopify order from API */
interface ShopifyOrder {
  id: string | number;
  order_number: string;
  status: string;
  total_price: string;
  currency: string;
  customer?: { id: string | number; email?: string };
  line_items?: Array<{ sku?: string; quantity?: number }>;
  updated_at: string;
  created_at: string;
}

/** Raw Shopify product from API */
interface ShopifyProduct {
  id: string | number;
  title: string;
  vendor?: string;
  product_type?: string;
  variants?: Array<{ id: string | number; sku?: string; price?: string }>;
  updated_at: string;
}

/** Raw Shopify inventory level from API */
interface ShopifyInventoryLevel {
  inventory_item_id: string | number;
  location_id: string | number;
  available: number;
  updated_at: string;
}

/** Shopify API paginated response envelope */
interface ShopifyApiResponse<T> {
  data: T[];
  nextPageCursor?: string;
  hasMore: boolean;
}

const DEFAULT_PAGE_SIZE = 50;

/**
 * Shopify Sync Adapter implementation.
 * Connects to Shopify REST API to fetch orders, products, and inventory data.
 */
export class ShopifyAdapter implements SyncAdapter {
  /**
   * Fetch records from Shopify API.
   *
   * @param config - Shopify-specific configuration (apiKey, baseUrl, dataType)
   * @param cursor - Pagination cursor from previous fetch
   * @returns Transformed SyncFetchResult with standardized records
   */
  async fetchRecords(config: Record<string, unknown>, cursor?: string): Promise<SyncFetchResult> {
    const adapterConfig = this.parseConfig(config);
    const response = await this.callShopifyApi(adapterConfig, cursor);
    const records = this.transformRecords(response.data, adapterConfig.dataType);

    return {
      records,
      nextCursor: response.nextPageCursor ?? cursor ?? '',
      hasMore: response.hasMore,
    };
  }

  /**
   * Parse and validate the raw config into a typed ShopifyAdapterConfig.
   */
  private parseConfig(config: Record<string, unknown>): ShopifyAdapterConfig {
    const apiKey = config.apiKey as string | undefined;
    const baseUrl = config.baseUrl as string | undefined;
    const dataType = config.dataType as string | undefined;
    const pageSize = config.pageSize as number | undefined;

    if (!apiKey) {
      throw new Error('Shopify adapter requires apiKey in config');
    }
    if (!baseUrl) {
      throw new Error('Shopify adapter requires baseUrl in config');
    }
    if (!dataType || !['orders', 'products', 'inventory'].includes(dataType)) {
      throw new Error('Shopify adapter requires dataType (orders | products | inventory) in config');
    }

    return {
      apiKey,
      baseUrl: baseUrl.replace(/\/$/, ''),
      dataType: dataType as ShopifyAdapterConfig['dataType'],
      pageSize: pageSize ?? DEFAULT_PAGE_SIZE,
    };
  }

  /**
   * Call the Shopify API endpoint.
   * In production, this would use fetch() to call the real Shopify REST API.
   * The method is structured to be easily replaced with real HTTP calls.
   */
  private async callShopifyApi(
    config: ShopifyAdapterConfig,
    cursor?: string,
  ): Promise<ShopifyApiResponse<ShopifyOrder | ShopifyProduct | ShopifyInventoryLevel>> {
    const endpoint = this.buildEndpoint(config, cursor);

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': config.apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as ShopifyApiResponse<
      ShopifyOrder | ShopifyProduct | ShopifyInventoryLevel
    >;

    return body;
  }

  /**
   * Build the API endpoint URL based on data type and cursor.
   */
  private buildEndpoint(config: ShopifyAdapterConfig, cursor?: string): string {
    const { baseUrl, dataType, pageSize } = config;
    const params = new URLSearchParams();
    params.set('limit', String(pageSize ?? DEFAULT_PAGE_SIZE));

    if (cursor) {
      params.set('page_info', cursor);
    }

    const pathMap: Record<string, string> = {
      orders: '/admin/api/2024-01/orders.json',
      products: '/admin/api/2024-01/products.json',
      inventory: '/admin/api/2024-01/inventory_levels.json',
    };

    return `${baseUrl}${pathMap[dataType]}?${params.toString()}`;
  }

  /**
   * Transform raw Shopify records into standardized SyncRecord format.
   */
  private transformRecords(
    data: Array<ShopifyOrder | ShopifyProduct | ShopifyInventoryLevel>,
    dataType: ShopifyAdapterConfig['dataType'],
  ): SyncRecord[] {
    switch (dataType) {
      case 'orders':
        return (data as ShopifyOrder[]).map((order) => this.transformOrder(order));
      case 'products':
        return (data as ShopifyProduct[]).map((product) => this.transformProduct(product));
      case 'inventory':
        return (data as ShopifyInventoryLevel[]).map((level) => this.transformInventoryLevel(level));
      default:
        return [];
    }
  }

  private transformOrder(order: ShopifyOrder): SyncRecord {
    return {
      id: `shopify-order-${order.id}`,
      data: {
        orderNumber: order.order_number,
        status: order.status,
        totalPrice: order.total_price,
        currency: order.currency,
        customerId: order.customer?.id,
        customerEmail: order.customer?.email,
        lineItems: order.line_items?.map((li) => ({
          sku: li.sku,
          quantity: li.quantity,
        })),
        source: 'shopify',
        createdAt: order.created_at,
      },
      updatedAt: order.updated_at,
      action: 'create',
    };
  }

  private transformProduct(product: ShopifyProduct): SyncRecord {
    return {
      id: `shopify-product-${product.id}`,
      data: {
        title: product.title,
        vendor: product.vendor,
        productType: product.product_type,
        variants: product.variants?.map((v) => ({
          id: String(v.id),
          sku: v.sku,
          price: v.price,
        })),
        source: 'shopify',
      },
      updatedAt: product.updated_at,
      action: 'create',
    };
  }

  private transformInventoryLevel(level: ShopifyInventoryLevel): SyncRecord {
    return {
      id: `shopify-inventory-${level.inventory_item_id}-${level.location_id}`,
      data: {
        inventoryItemId: String(level.inventory_item_id),
        locationId: String(level.location_id),
        available: level.available,
        source: 'shopify',
      },
      updatedAt: level.updated_at,
      action: 'update',
    };
  }
}
