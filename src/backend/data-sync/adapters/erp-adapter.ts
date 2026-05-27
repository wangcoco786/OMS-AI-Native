/**
 * ERP (Enterprise Resource Planning) Sync Adapter
 *
 * Fetches data from ERP API (product master data, supplier information).
 * Uses cursor-based pagination and transforms ERP data format
 * into the standard SyncRecord format.
 *
 * Config shape:
 * - apiKey: string - ERP API authentication key
 * - baseUrl: string - ERP API base URL
 * - dataType: 'products' | 'suppliers'
 * - pageSize?: number - Number of records per page (default: 100)
 */

import type { SyncAdapter, SyncFetchResult, SyncRecord } from '../sync-adapter.js';

/** ERP adapter configuration */
export interface ErpAdapterConfig {
  apiKey: string;
  baseUrl: string;
  dataType: 'products' | 'suppliers';
  pageSize?: number;
}

/** Raw ERP product master data */
interface ErpProduct {
  material_number: string;
  description: string;
  category: string;
  unit_of_measure: string;
  weight?: number;
  dimensions?: { length: number; width: number; height: number };
  attributes: Record<string, string>;
  supplier_id?: string;
  status: string;
  modified_at: string;
  created_at: string;
}

/** Raw ERP supplier record */
interface ErpSupplier {
  supplier_id: string;
  name: string;
  contact_email?: string;
  contact_phone?: string;
  address?: {
    street?: string;
    city?: string;
    country?: string;
    postal_code?: string;
  };
  lead_time_days?: number;
  status: string;
  modified_at: string;
}

/** ERP API paginated response envelope */
interface ErpApiResponse<T> {
  results: T[];
  meta: {
    nextCursor?: string;
    hasMore: boolean;
    totalCount?: number;
  };
}

const DEFAULT_PAGE_SIZE = 100;

/**
 * ERP Sync Adapter implementation.
 * Connects to ERP API to fetch product master data and supplier information.
 */
export class ErpAdapter implements SyncAdapter {
  /**
   * Fetch records from ERP API.
   *
   * @param config - ERP-specific configuration (apiKey, baseUrl, dataType)
   * @param cursor - Pagination cursor from previous fetch
   * @returns Transformed SyncFetchResult with standardized records
   */
  async fetchRecords(config: Record<string, unknown>, cursor?: string): Promise<SyncFetchResult> {
    const adapterConfig = this.parseConfig(config);
    const response = await this.callErpApi(adapterConfig, cursor);
    const records = this.transformRecords(response.results, adapterConfig.dataType);

    return {
      records,
      nextCursor: response.meta.nextCursor ?? cursor ?? '',
      hasMore: response.meta.hasMore,
    };
  }

  /**
   * Parse and validate the raw config into a typed ErpAdapterConfig.
   */
  private parseConfig(config: Record<string, unknown>): ErpAdapterConfig {
    const apiKey = config.apiKey as string | undefined;
    const baseUrl = config.baseUrl as string | undefined;
    const dataType = config.dataType as string | undefined;
    const pageSize = config.pageSize as number | undefined;

    if (!apiKey) {
      throw new Error('ERP adapter requires apiKey in config');
    }
    if (!baseUrl) {
      throw new Error('ERP adapter requires baseUrl in config');
    }
    if (!dataType || !['products', 'suppliers'].includes(dataType)) {
      throw new Error('ERP adapter requires dataType (products | suppliers) in config');
    }

    return {
      apiKey,
      baseUrl: baseUrl.replace(/\/$/, ''),
      dataType: dataType as ErpAdapterConfig['dataType'],
      pageSize: pageSize ?? DEFAULT_PAGE_SIZE,
    };
  }

  /**
   * Call the ERP API endpoint.
   * In production, this would use fetch() to call the real ERP REST API.
   */
  private async callErpApi(
    config: ErpAdapterConfig,
    cursor?: string,
  ): Promise<ErpApiResponse<ErpProduct | ErpSupplier>> {
    const endpoint = this.buildEndpoint(config, cursor);

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'X-API-Key': config.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`ERP API error: ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as ErpApiResponse<ErpProduct | ErpSupplier>;

    return body;
  }

  /**
   * Build the API endpoint URL based on data type and cursor.
   */
  private buildEndpoint(config: ErpAdapterConfig, cursor?: string): string {
    const { baseUrl, dataType, pageSize } = config;
    const params = new URLSearchParams();
    params.set('page_size', String(pageSize ?? DEFAULT_PAGE_SIZE));

    if (cursor) {
      params.set('cursor', cursor);
    }

    const pathMap: Record<string, string> = {
      products: '/api/v2/materials',
      suppliers: '/api/v2/suppliers',
    };

    return `${baseUrl}${pathMap[dataType]}?${params.toString()}`;
  }

  /**
   * Transform raw ERP records into standardized SyncRecord format.
   */
  private transformRecords(
    data: Array<ErpProduct | ErpSupplier>,
    dataType: ErpAdapterConfig['dataType'],
  ): SyncRecord[] {
    switch (dataType) {
      case 'products':
        return (data as ErpProduct[]).map((item) => this.transformProduct(item));
      case 'suppliers':
        return (data as ErpSupplier[]).map((item) => this.transformSupplier(item));
      default:
        return [];
    }
  }

  private transformProduct(item: ErpProduct): SyncRecord {
    return {
      id: `erp-product-${item.material_number}`,
      data: {
        materialNumber: item.material_number,
        description: item.description,
        category: item.category,
        unitOfMeasure: item.unit_of_measure,
        weight: item.weight,
        dimensions: item.dimensions,
        attributes: item.attributes,
        supplierId: item.supplier_id,
        status: item.status,
        source: 'erp',
        createdAt: item.created_at,
      },
      updatedAt: item.modified_at,
      action: item.status === 'active' ? 'create' : 'update',
    };
  }

  private transformSupplier(item: ErpSupplier): SyncRecord {
    return {
      id: `erp-supplier-${item.supplier_id}`,
      data: {
        supplierId: item.supplier_id,
        name: item.name,
        contactEmail: item.contact_email,
        contactPhone: item.contact_phone,
        address: item.address,
        leadTimeDays: item.lead_time_days,
        status: item.status,
        source: 'erp',
      },
      updatedAt: item.modified_at,
      action: 'update',
    };
  }
}
