/**
 * WMS (Warehouse Management System) Sync Adapter
 *
 * Fetches data from WMS API (inventory levels, inbound/outbound records).
 * Uses cursor-based pagination and transforms WMS data format
 * into the standard SyncRecord format.
 *
 * Config shape:
 * - apiKey: string - WMS API authentication key
 * - baseUrl: string - WMS API base URL
 * - dataType: 'inventory' | 'inbound' | 'outbound'
 * - warehouseId?: string - Optional warehouse filter
 * - pageSize?: number - Number of records per page (default: 100)
 */

import type { SyncAdapter, SyncFetchResult, SyncRecord } from '../sync-adapter.js';

/** WMS adapter configuration */
export interface WmsAdapterConfig {
  apiKey: string;
  baseUrl: string;
  dataType: 'inventory' | 'inbound' | 'outbound';
  warehouseId?: string;
  pageSize?: number;
}

/** Raw WMS inventory record */
interface WmsInventoryRecord {
  sku: string;
  warehouse_id: string;
  quantity: number;
  reserved: number;
  available: number;
  location_code?: string;
  last_updated: string;
}

/** Raw WMS inbound/outbound record */
interface WmsMovementRecord {
  id: string;
  type: 'inbound' | 'outbound';
  sku: string;
  warehouse_id: string;
  quantity: number;
  reference_no?: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/** WMS API paginated response envelope */
interface WmsApiResponse<T> {
  items: T[];
  pagination: {
    cursor?: string;
    hasNext: boolean;
    total?: number;
  };
}

const DEFAULT_PAGE_SIZE = 100;

/**
 * WMS Sync Adapter implementation.
 * Connects to WMS API to fetch inventory levels and movement records.
 */
export class WmsAdapter implements SyncAdapter {
  /**
   * Fetch records from WMS API.
   *
   * @param config - WMS-specific configuration (apiKey, baseUrl, dataType)
   * @param cursor - Pagination cursor from previous fetch
   * @returns Transformed SyncFetchResult with standardized records
   */
  async fetchRecords(config: Record<string, unknown>, cursor?: string): Promise<SyncFetchResult> {
    const adapterConfig = this.parseConfig(config);
    const response = await this.callWmsApi(adapterConfig, cursor);
    const records = this.transformRecords(response.items, adapterConfig.dataType);

    return {
      records,
      nextCursor: response.pagination.cursor ?? cursor ?? '',
      hasMore: response.pagination.hasNext,
    };
  }

  /**
   * Parse and validate the raw config into a typed WmsAdapterConfig.
   */
  private parseConfig(config: Record<string, unknown>): WmsAdapterConfig {
    const apiKey = config.apiKey as string | undefined;
    const baseUrl = config.baseUrl as string | undefined;
    const dataType = config.dataType as string | undefined;
    const warehouseId = config.warehouseId as string | undefined;
    const pageSize = config.pageSize as number | undefined;

    if (!apiKey) {
      throw new Error('WMS adapter requires apiKey in config');
    }
    if (!baseUrl) {
      throw new Error('WMS adapter requires baseUrl in config');
    }
    if (!dataType || !['inventory', 'inbound', 'outbound'].includes(dataType)) {
      throw new Error('WMS adapter requires dataType (inventory | inbound | outbound) in config');
    }

    return {
      apiKey,
      baseUrl: baseUrl.replace(/\/$/, ''),
      dataType: dataType as WmsAdapterConfig['dataType'],
      warehouseId,
      pageSize: pageSize ?? DEFAULT_PAGE_SIZE,
    };
  }

  /**
   * Call the WMS API endpoint.
   * In production, this would use fetch() to call the real WMS REST API.
   */
  private async callWmsApi(
    config: WmsAdapterConfig,
    cursor?: string,
  ): Promise<WmsApiResponse<WmsInventoryRecord | WmsMovementRecord>> {
    const endpoint = this.buildEndpoint(config, cursor);

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`WMS API error: ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as WmsApiResponse<
      WmsInventoryRecord | WmsMovementRecord
    >;

    return body;
  }

  /**
   * Build the API endpoint URL based on data type and cursor.
   */
  private buildEndpoint(config: WmsAdapterConfig, cursor?: string): string {
    const { baseUrl, dataType, warehouseId, pageSize } = config;
    const params = new URLSearchParams();
    params.set('limit', String(pageSize ?? DEFAULT_PAGE_SIZE));

    if (cursor) {
      params.set('cursor', cursor);
    }
    if (warehouseId) {
      params.set('warehouse_id', warehouseId);
    }

    const pathMap: Record<string, string> = {
      inventory: '/api/v1/inventory',
      inbound: '/api/v1/movements/inbound',
      outbound: '/api/v1/movements/outbound',
    };

    return `${baseUrl}${pathMap[dataType]}?${params.toString()}`;
  }

  /**
   * Transform raw WMS records into standardized SyncRecord format.
   */
  private transformRecords(
    data: Array<WmsInventoryRecord | WmsMovementRecord>,
    dataType: WmsAdapterConfig['dataType'],
  ): SyncRecord[] {
    switch (dataType) {
      case 'inventory':
        return (data as WmsInventoryRecord[]).map((item) => this.transformInventory(item));
      case 'inbound':
      case 'outbound':
        return (data as WmsMovementRecord[]).map((item) => this.transformMovement(item));
      default:
        return [];
    }
  }

  private transformInventory(item: WmsInventoryRecord): SyncRecord {
    return {
      id: `wms-inventory-${item.warehouse_id}-${item.sku}`,
      data: {
        sku: item.sku,
        warehouseId: item.warehouse_id,
        quantity: item.quantity,
        reserved: item.reserved,
        available: item.available,
        locationCode: item.location_code,
        source: 'wms',
      },
      updatedAt: item.last_updated,
      action: 'update',
    };
  }

  private transformMovement(item: WmsMovementRecord): SyncRecord {
    return {
      id: `wms-movement-${item.id}`,
      data: {
        type: item.type,
        sku: item.sku,
        warehouseId: item.warehouse_id,
        quantity: item.quantity,
        referenceNo: item.reference_no,
        status: item.status,
        source: 'wms',
        createdAt: item.created_at,
      },
      updatedAt: item.updated_at,
      action: 'create',
    };
  }
}
