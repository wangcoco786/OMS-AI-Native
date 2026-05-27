/**
 * Tests for Data Sync Adapters (Shopify, WMS, ERP) and Adapter Registry
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShopifyAdapter } from './shopify-adapter.js';
import { WmsAdapter } from './wms-adapter.js';
import { ErpAdapter } from './erp-adapter.js';
import { DefaultAdapterRegistry } from './adapter-registry.js';
import type { SyncAdapter, SyncFetchResult } from '../sync-adapter.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ShopifyAdapter', () => {
  const adapter = new ShopifyAdapter();
  const baseConfig = {
    apiKey: 'shpat_test_key',
    baseUrl: 'https://test-store.myshopify.com',
    dataType: 'orders',
  };

  it('should throw if apiKey is missing', async () => {
    await expect(adapter.fetchRecords({ baseUrl: 'http://x', dataType: 'orders' })).rejects.toThrow(
      'Shopify adapter requires apiKey in config',
    );
  });

  it('should throw if baseUrl is missing', async () => {
    await expect(adapter.fetchRecords({ apiKey: 'key', dataType: 'orders' })).rejects.toThrow(
      'Shopify adapter requires baseUrl in config',
    );
  });

  it('should throw if dataType is invalid', async () => {
    await expect(
      adapter.fetchRecords({ apiKey: 'key', baseUrl: 'http://x', dataType: 'invalid' }),
    ).rejects.toThrow('Shopify adapter requires dataType');
  });

  it('should fetch and transform orders', async () => {
    const shopifyResponse = {
      data: [
        {
          id: 1001,
          order_number: 'ORD-001',
          status: 'fulfilled',
          total_price: '99.99',
          currency: 'USD',
          customer: { id: 42, email: 'test@example.com' },
          line_items: [{ sku: 'SKU-A', quantity: 2 }],
          updated_at: '2024-01-15T10:00:00Z',
          created_at: '2024-01-14T08:00:00Z',
        },
      ],
      nextPageCursor: 'cursor_page2',
      hasMore: true,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => shopifyResponse,
    });

    const result = await adapter.fetchRecords(baseConfig);

    expect(result.records).toHaveLength(1);
    expect(result.records[0].id).toBe('shopify-order-1001');
    expect(result.records[0].data.orderNumber).toBe('ORD-001');
    expect(result.records[0].data.source).toBe('shopify');
    expect(result.records[0].updatedAt).toBe('2024-01-15T10:00:00Z');
    expect(result.records[0].action).toBe('create');
    expect(result.nextCursor).toBe('cursor_page2');
    expect(result.hasMore).toBe(true);
  });

  it('should fetch and transform products', async () => {
    const shopifyResponse = {
      data: [
        {
          id: 2001,
          title: 'Blue T-Shirt',
          vendor: 'TestBrand',
          product_type: 'Apparel',
          variants: [{ id: 3001, sku: 'BTS-M', price: '29.99' }],
          updated_at: '2024-01-15T12:00:00Z',
        },
      ],
      hasMore: false,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => shopifyResponse,
    });

    const result = await adapter.fetchRecords({ ...baseConfig, dataType: 'products' });

    expect(result.records).toHaveLength(1);
    expect(result.records[0].id).toBe('shopify-product-2001');
    expect(result.records[0].data.title).toBe('Blue T-Shirt');
    expect(result.records[0].data.variants).toEqual([{ id: '3001', sku: 'BTS-M', price: '29.99' }]);
    expect(result.hasMore).toBe(false);
  });

  it('should fetch and transform inventory levels', async () => {
    const shopifyResponse = {
      data: [
        {
          inventory_item_id: 5001,
          location_id: 6001,
          available: 150,
          updated_at: '2024-01-15T14:00:00Z',
        },
      ],
      hasMore: false,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => shopifyResponse,
    });

    const result = await adapter.fetchRecords({ ...baseConfig, dataType: 'inventory' });

    expect(result.records).toHaveLength(1);
    expect(result.records[0].id).toBe('shopify-inventory-5001-6001');
    expect(result.records[0].data.available).toBe(150);
    expect(result.records[0].action).toBe('update');
  });

  it('should pass cursor as page_info parameter', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], hasMore: false }),
    });

    await adapter.fetchRecords(baseConfig, 'my_cursor_123');

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('page_info=my_cursor_123');
  });

  it('should include Shopify access token header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], hasMore: false }),
    });

    await adapter.fetchRecords(baseConfig);

    const calledOptions = mockFetch.mock.calls[0][1] as RequestInit;
    expect((calledOptions.headers as Record<string, string>)['X-Shopify-Access-Token']).toBe('shpat_test_key');
  });

  it('should throw on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
    });

    await expect(adapter.fetchRecords(baseConfig)).rejects.toThrow('Shopify API error: 429 Too Many Requests');
  });
});

describe('WmsAdapter', () => {
  const adapter = new WmsAdapter();
  const baseConfig = {
    apiKey: 'wms_test_key',
    baseUrl: 'https://wms.example.com',
    dataType: 'inventory',
  };

  it('should throw if apiKey is missing', async () => {
    await expect(adapter.fetchRecords({ baseUrl: 'http://x', dataType: 'inventory' })).rejects.toThrow(
      'WMS adapter requires apiKey in config',
    );
  });

  it('should throw if baseUrl is missing', async () => {
    await expect(adapter.fetchRecords({ apiKey: 'key', dataType: 'inventory' })).rejects.toThrow(
      'WMS adapter requires baseUrl in config',
    );
  });

  it('should throw if dataType is invalid', async () => {
    await expect(
      adapter.fetchRecords({ apiKey: 'key', baseUrl: 'http://x', dataType: 'invalid' }),
    ).rejects.toThrow('WMS adapter requires dataType');
  });

  it('should fetch and transform inventory records', async () => {
    const wmsResponse = {
      items: [
        {
          sku: 'SKU-001',
          warehouse_id: 'WH-A',
          quantity: 500,
          reserved: 50,
          available: 450,
          location_code: 'A-1-3',
          last_updated: '2024-01-15T09:00:00Z',
        },
      ],
      pagination: { cursor: 'next_cursor', hasNext: true },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => wmsResponse,
    });

    const result = await adapter.fetchRecords(baseConfig);

    expect(result.records).toHaveLength(1);
    expect(result.records[0].id).toBe('wms-inventory-WH-A-SKU-001');
    expect(result.records[0].data.sku).toBe('SKU-001');
    expect(result.records[0].data.available).toBe(450);
    expect(result.records[0].data.source).toBe('wms');
    expect(result.records[0].action).toBe('update');
    expect(result.nextCursor).toBe('next_cursor');
    expect(result.hasMore).toBe(true);
  });

  it('should fetch and transform movement records', async () => {
    const wmsResponse = {
      items: [
        {
          id: 'MOV-001',
          type: 'inbound',
          sku: 'SKU-002',
          warehouse_id: 'WH-B',
          quantity: 200,
          reference_no: 'PO-12345',
          status: 'completed',
          created_at: '2024-01-14T08:00:00Z',
          updated_at: '2024-01-15T10:00:00Z',
        },
      ],
      pagination: { hasNext: false },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => wmsResponse,
    });

    const result = await adapter.fetchRecords({ ...baseConfig, dataType: 'inbound' });

    expect(result.records).toHaveLength(1);
    expect(result.records[0].id).toBe('wms-movement-MOV-001');
    expect(result.records[0].data.type).toBe('inbound');
    expect(result.records[0].data.referenceNo).toBe('PO-12345');
    expect(result.records[0].action).toBe('create');
    expect(result.hasMore).toBe(false);
  });

  it('should include warehouseId filter in URL when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [], pagination: { hasNext: false } }),
    });

    await adapter.fetchRecords({ ...baseConfig, warehouseId: 'WH-X' });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('warehouse_id=WH-X');
  });

  it('should use Bearer token authorization', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [], pagination: { hasNext: false } }),
    });

    await adapter.fetchRecords(baseConfig);

    const calledOptions = mockFetch.mock.calls[0][1] as RequestInit;
    expect((calledOptions.headers as Record<string, string>).Authorization).toBe('Bearer wms_test_key');
  });

  it('should throw on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await expect(adapter.fetchRecords(baseConfig)).rejects.toThrow('WMS API error: 500 Internal Server Error');
  });
});

describe('ErpAdapter', () => {
  const adapter = new ErpAdapter();
  const baseConfig = {
    apiKey: 'erp_test_key',
    baseUrl: 'https://erp.example.com',
    dataType: 'products',
  };

  it('should throw if apiKey is missing', async () => {
    await expect(adapter.fetchRecords({ baseUrl: 'http://x', dataType: 'products' })).rejects.toThrow(
      'ERP adapter requires apiKey in config',
    );
  });

  it('should throw if baseUrl is missing', async () => {
    await expect(adapter.fetchRecords({ apiKey: 'key', dataType: 'products' })).rejects.toThrow(
      'ERP adapter requires baseUrl in config',
    );
  });

  it('should throw if dataType is invalid', async () => {
    await expect(
      adapter.fetchRecords({ apiKey: 'key', baseUrl: 'http://x', dataType: 'invalid' }),
    ).rejects.toThrow('ERP adapter requires dataType');
  });

  it('should fetch and transform product master data', async () => {
    const erpResponse = {
      results: [
        {
          material_number: 'MAT-001',
          description: 'Premium Cotton T-Shirt',
          category: 'Apparel',
          unit_of_measure: 'PCS',
          weight: 0.25,
          dimensions: { length: 30, width: 25, height: 2 },
          attributes: { color: 'blue', size: 'M' },
          supplier_id: 'SUP-001',
          status: 'active',
          modified_at: '2024-01-15T11:00:00Z',
          created_at: '2024-01-01T08:00:00Z',
        },
      ],
      meta: { nextCursor: 'erp_cursor_2', hasMore: true, totalCount: 500 },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => erpResponse,
    });

    const result = await adapter.fetchRecords(baseConfig);

    expect(result.records).toHaveLength(1);
    expect(result.records[0].id).toBe('erp-product-MAT-001');
    expect(result.records[0].data.materialNumber).toBe('MAT-001');
    expect(result.records[0].data.description).toBe('Premium Cotton T-Shirt');
    expect(result.records[0].data.attributes).toEqual({ color: 'blue', size: 'M' });
    expect(result.records[0].data.source).toBe('erp');
    expect(result.records[0].updatedAt).toBe('2024-01-15T11:00:00Z');
    expect(result.records[0].action).toBe('create');
    expect(result.nextCursor).toBe('erp_cursor_2');
    expect(result.hasMore).toBe(true);
  });

  it('should fetch and transform supplier data', async () => {
    const erpResponse = {
      results: [
        {
          supplier_id: 'SUP-001',
          name: 'Acme Textiles',
          contact_email: 'sales@acme.com',
          contact_phone: '+1-555-0100',
          address: { street: '123 Main St', city: 'New York', country: 'US', postal_code: '10001' },
          lead_time_days: 14,
          status: 'active',
          modified_at: '2024-01-15T08:00:00Z',
        },
      ],
      meta: { hasMore: false },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => erpResponse,
    });

    const result = await adapter.fetchRecords({ ...baseConfig, dataType: 'suppliers' });

    expect(result.records).toHaveLength(1);
    expect(result.records[0].id).toBe('erp-supplier-SUP-001');
    expect(result.records[0].data.name).toBe('Acme Textiles');
    expect(result.records[0].data.leadTimeDays).toBe(14);
    expect(result.records[0].data.source).toBe('erp');
    expect(result.records[0].action).toBe('update');
    expect(result.hasMore).toBe(false);
  });

  it('should use X-API-Key header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [], meta: { hasMore: false } }),
    });

    await adapter.fetchRecords(baseConfig);

    const calledOptions = mockFetch.mock.calls[0][1] as RequestInit;
    expect((calledOptions.headers as Record<string, string>)['X-API-Key']).toBe('erp_test_key');
  });

  it('should pass cursor in URL params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [], meta: { hasMore: false } }),
    });

    await adapter.fetchRecords(baseConfig, 'erp_cursor_5');

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('cursor=erp_cursor_5');
  });

  it('should throw on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    await expect(adapter.fetchRecords(baseConfig)).rejects.toThrow('ERP API error: 401 Unauthorized');
  });
});

describe('DefaultAdapterRegistry', () => {
  it('should return shopify adapter for "shopify" source', () => {
    const registry = new DefaultAdapterRegistry();
    const adapter = registry.getAdapter('shopify');
    expect(adapter).toBeInstanceOf(ShopifyAdapter);
  });

  it('should return wms adapter for "wms" source', () => {
    const registry = new DefaultAdapterRegistry();
    const adapter = registry.getAdapter('wms');
    expect(adapter).toBeInstanceOf(WmsAdapter);
  });

  it('should return erp adapter for "erp" source', () => {
    const registry = new DefaultAdapterRegistry();
    const adapter = registry.getAdapter('erp');
    expect(adapter).toBeInstanceOf(ErpAdapter);
  });

  it('should return undefined for unknown source', () => {
    const registry = new DefaultAdapterRegistry();
    const adapter = registry.getAdapter('unknown');
    expect(adapter).toBeUndefined();
  });

  it('should allow custom adapters to override defaults', () => {
    const customAdapter: SyncAdapter = {
      fetchRecords: async (): Promise<SyncFetchResult> => ({
        records: [],
        nextCursor: '',
        hasMore: false,
      }),
    };

    const registry = new DefaultAdapterRegistry({ shopify: customAdapter });
    const adapter = registry.getAdapter('shopify');
    expect(adapter).toBe(customAdapter);
  });

  it('should allow registering new adapters', () => {
    const registry = new DefaultAdapterRegistry();
    const customAdapter: SyncAdapter = {
      fetchRecords: async (): Promise<SyncFetchResult> => ({
        records: [],
        nextCursor: '',
        hasMore: false,
      }),
    };

    registry.registerAdapter('custom-source', customAdapter);
    expect(registry.getAdapter('custom-source')).toBe(customAdapter);
  });

  it('should list all registered sources', () => {
    const registry = new DefaultAdapterRegistry();
    const sources = registry.getSources();
    expect(sources).toContain('shopify');
    expect(sources).toContain('wms');
    expect(sources).toContain('erp');
    expect(sources).toHaveLength(3);
  });

  it('should include custom sources in getSources', () => {
    const registry = new DefaultAdapterRegistry();
    const customAdapter: SyncAdapter = {
      fetchRecords: async (): Promise<SyncFetchResult> => ({
        records: [],
        nextCursor: '',
        hasMore: false,
      }),
    };

    registry.registerAdapter('custom', customAdapter);
    const sources = registry.getSources();
    expect(sources).toContain('custom');
    expect(sources).toHaveLength(4);
  });
});
