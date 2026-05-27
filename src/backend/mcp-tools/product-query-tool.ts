/**
 * MCP Product/SKU Query Tool
 *
 * MCP-protocol compliant tool for querying products and SKUs from the database.
 * Supports filtering by name, attributes, channel, category, and pagination.
 * Integrates Redis caching for high-frequency queries.
 *
 * Requirements: 10.3, 10.4, 10.5, 10.6
 */

import pino from 'pino';

import type { PostgresDatabaseService } from '../../infrastructure/database/database-service.js';
import type { MCPToolDefinition, ToolCallResult } from '../../infrastructure/tools/types.js';
import type { QueryCache } from './query-cache.js';

/** Input parameters for the product query tool */
export interface ProductQueryInput {
  name?: string;
  attributes?: Record<string, string>;
  channelId?: string;
  category?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

/** A single product/SKU record returned from the database */
export interface ProductRecord {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  attributes: Record<string, string>;
  category: string | null;
  status: string;
  channel_mappings: ChannelMapping[];
  created_at: Date;
  updated_at: Date;
}

/** Channel mapping info for a product */
export interface ChannelMapping {
  channel_sku_id: string;
  external_id: string;
  channel_name: string;
  shop_id: string;
}

/** Paginated product query result */
export interface ProductQueryResult {
  products: ProductRecord[];
  total: number;
  page: number;
  pageSize: number;
}

/** Structured validation error for invalid input */
export interface ParameterValidationError {
  field: string;
  expected: string;
  actual: unknown;
  message: string;
}

/** Default pagination values */
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** Valid product statuses */
const VALID_PRODUCT_STATUSES = ['active', 'inactive'] as const;

/**
 * MCP Tool Definition for query_products.
 * Registered with the MCP Tool Registry for agent discovery and invocation.
 */
export const PRODUCT_QUERY_TOOL_DEFINITION: MCPToolDefinition = {
  name: 'query_products',
  description: '查询商品/SKU 信息，支持按名称、属性、渠道、分类等条件筛选，支持分页',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '商品名称（模糊匹配）' },
      attributes: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: '属性筛选（键值对，如 { "color": "red", "size": "L" }）',
      },
      channelId: { type: 'string', description: '渠道 ID（筛选有该渠道映射的商品）' },
      category: { type: 'string', description: '商品分类' },
      status: {
        type: 'string',
        enum: VALID_PRODUCT_STATUSES,
        description: '商品状态',
      },
      page: { type: 'integer', minimum: 1, description: '页码，默认 1' },
      pageSize: { type: 'integer', minimum: 1, maximum: 100, description: '每页数量，默认 20，最大 100' },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      products: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            sku: { type: 'string' },
            name: { type: 'string' },
            description: { type: ['string', 'null'] },
            attributes: { type: 'object' },
            category: { type: ['string', 'null'] },
            status: { type: 'string' },
            channel_mappings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  channel_sku_id: { type: 'string' },
                  external_id: { type: 'string' },
                  channel_name: { type: 'string' },
                  shop_id: { type: 'string' },
                },
              },
            },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
      },
      total: { type: 'integer' },
      page: { type: 'integer' },
      pageSize: { type: 'integer' },
    },
    required: ['products', 'total', 'page', 'pageSize'],
  },
  version: '1.0.0',
  permissions: ['products:read'],
  timeout: 10000,
  sandbox: 'v8-isolate',
};

/**
 * ProductQueryTool executes product/SKU queries against the database with
 * Redis caching and multi-tenant isolation.
 */
export class ProductQueryTool {
  private readonly logger: pino.Logger;

  constructor(
    private readonly db: PostgresDatabaseService,
    private readonly cache: QueryCache,
    options?: { logger?: pino.Logger },
  ) {
    this.logger = (options?.logger ?? pino({ name: 'mcp-product-query-tool' })).child({
      component: 'query-products',
    });
  }

  /**
   * Execute the query_products tool.
   * Validates input, checks cache, queries database, and caches result.
   */
  async execute(input: ProductQueryInput, tenantId: string): Promise<ToolCallResult> {
    const startTime = Date.now();

    // Validate input parameters
    const validationErrors = this.validateInput(input);
    if (validationErrors.length > 0) {
      return {
        success: false,
        error: {
          code: 'INVALID_PARAMETERS',
          message: JSON.stringify(validationErrors),
        },
        executionTime: Date.now() - startTime,
      };
    }

    try {
      // Check cache first
      const cached = await this.cache.get<ProductQueryResult>(
        PRODUCT_QUERY_TOOL_DEFINITION.name,
        input,
        tenantId,
      );
      if (cached) {
        return {
          success: true,
          output: cached,
          executionTime: Date.now() - startTime,
        };
      }

      // Query database
      const result = await this.queryProducts(input, tenantId);

      // Cache the result
      await this.cache.set(PRODUCT_QUERY_TOOL_DEFINITION.name, input, tenantId, result);

      return {
        success: true,
        output: result,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      this.logger.error({ error, input, tenantId }, 'Product query failed');

      return {
        success: false,
        error: {
          code: 'PRODUCT_QUERY_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error during product query',
        },
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Validate input parameters and return structured errors for invalid fields.
   */
  validateInput(input: ProductQueryInput): ParameterValidationError[] {
    const errors: ParameterValidationError[] = [];

    if (input.status !== undefined && !VALID_PRODUCT_STATUSES.includes(input.status as typeof VALID_PRODUCT_STATUSES[number])) {
      errors.push({
        field: 'status',
        expected: `one of: ${VALID_PRODUCT_STATUSES.join(', ')}`,
        actual: input.status,
        message: `Invalid product status: "${input.status}"`,
      });
    }

    if (input.attributes !== undefined) {
      if (typeof input.attributes !== 'object' || input.attributes === null || Array.isArray(input.attributes)) {
        errors.push({
          field: 'attributes',
          expected: 'object with string key-value pairs',
          actual: input.attributes,
          message: 'Attributes must be an object with string values',
        });
      } else {
        for (const [key, value] of Object.entries(input.attributes)) {
          if (typeof value !== 'string') {
            errors.push({
              field: `attributes.${key}`,
              expected: 'string',
              actual: value,
              message: `Attribute value for "${key}" must be a string`,
            });
          }
        }
      }
    }

    if (input.page !== undefined && (!Number.isInteger(input.page) || input.page < 1)) {
      errors.push({
        field: 'page',
        expected: 'integer >= 1',
        actual: input.page,
        message: `Invalid page number: ${input.page}`,
      });
    }

    if (input.pageSize !== undefined && (!Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > MAX_PAGE_SIZE)) {
      errors.push({
        field: 'pageSize',
        expected: `integer between 1 and ${MAX_PAGE_SIZE}`,
        actual: input.pageSize,
        message: `Invalid page size: ${input.pageSize}`,
      });
    }

    return errors;
  }

  /**
   * Query products from the database with the given filters.
   * Includes channel mapping information via LEFT JOIN.
   */
  private async queryProducts(input: ProductQueryInput, tenantId: string): Promise<ProductQueryResult> {
    const page = Math.max(DEFAULT_PAGE, input.page ?? DEFAULT_PAGE);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE));
    const offset = (page - 1) * pageSize;

    const { whereClause, params } = this.buildWhereClause(input);

    // Count query
    const countSql = `SELECT COUNT(DISTINCT s.id) as count FROM system_skus s ${this.buildJoinClause(input)} ${whereClause}`;
    const countResult = await this.db.query<{ count: string }>(countSql, params, tenantId);
    const total = parseInt(countResult[0]?.count ?? '0', 10);

    // Data query - get product IDs first for pagination
    const paramCount = params.length;
    const idsSql = `SELECT DISTINCT s.id FROM system_skus s ${this.buildJoinClause(input)} ${whereClause} ORDER BY s.id LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    const idsParams = [...params, pageSize, offset];
    const idRows = await this.db.query<{ id: string }>(idsSql, idsParams, tenantId);

    if (idRows.length === 0) {
      return { products: [], total, page, pageSize };
    }

    // Fetch full product data with channel mappings
    const productIds = idRows.map((r) => r.id);
    const products = await this.fetchProductsWithMappings(productIds, tenantId);

    this.logger.info(
      { tenantId, total, page, pageSize, filterCount: params.length },
      'Product query executed',
    );

    return { products, total, page, pageSize };
  }

  /**
   * Fetch products with their channel mappings.
   */
  private async fetchProductsWithMappings(productIds: string[], tenantId: string): Promise<ProductRecord[]> {
    if (productIds.length === 0) return [];

    // Build placeholders for IN clause
    const placeholders = productIds.map((_, i) => `$${i + 1}`).join(', ');

    // Fetch products
    const productSql = `SELECT id, sku, name, description, attributes, category, status, created_at, updated_at FROM system_skus WHERE id IN (${placeholders}) ORDER BY created_at DESC`;
    const productRows = await this.db.query<Omit<ProductRecord, 'channel_mappings'>>(
      productSql,
      productIds,
      tenantId,
    );

    // Fetch channel mappings for these products
    const mappingSql = `SELECT sm.system_sku_id, cs.id as channel_sku_id, cs.external_id, cs.name as channel_name, cs.shop_id FROM sku_mappings sm JOIN channel_skus cs ON sm.channel_sku_id = cs.id WHERE sm.system_sku_id IN (${placeholders}) AND sm.status IN ('confirmed', 'pending')`;
    const mappingRows = await this.db.query<{
      system_sku_id: string;
      channel_sku_id: string;
      external_id: string;
      channel_name: string;
      shop_id: string;
    }>(mappingSql, productIds, tenantId);

    // Group mappings by product ID
    const mappingsByProduct = new Map<string, ChannelMapping[]>();
    for (const row of mappingRows) {
      const mappings = mappingsByProduct.get(row.system_sku_id) ?? [];
      mappings.push({
        channel_sku_id: row.channel_sku_id,
        external_id: row.external_id,
        channel_name: row.channel_name,
        shop_id: row.shop_id,
      });
      mappingsByProduct.set(row.system_sku_id, mappings);
    }

    // Combine products with their mappings
    return productRows.map((product) => ({
      ...product,
      channel_mappings: mappingsByProduct.get(product.id) ?? [],
    }));
  }

  /**
   * Build JOIN clause based on input filters.
   * Only joins channel tables when channelId filter is specified.
   */
  private buildJoinClause(input: ProductQueryInput): string {
    if (input.channelId) {
      return `LEFT JOIN sku_mappings sm ON s.id = sm.system_sku_id LEFT JOIN channel_skus cs ON sm.channel_sku_id = cs.id`;
    }
    return '';
  }

  /**
   * Build a WHERE clause from the input filters.
   * Tenant isolation is handled automatically by the DatabaseService.
   */
  private buildWhereClause(input: ProductQueryInput): { whereClause: string; params: unknown[] } {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (input.name) {
      conditions.push(`s.name ILIKE $${paramIndex++}`);
      params.push(`%${input.name}%`);
    }

    if (input.category) {
      conditions.push(`s.category = $${paramIndex++}`);
      params.push(input.category);
    }

    if (input.status) {
      conditions.push(`s.status = $${paramIndex++}`);
      params.push(input.status);
    }

    if (input.channelId) {
      conditions.push(`cs.shop_id = $${paramIndex++}`);
      params.push(input.channelId);
    }

    // Attribute filtering using JSONB containment operator
    if (input.attributes && Object.keys(input.attributes).length > 0) {
      conditions.push(`s.attributes @> $${paramIndex++}`);
      params.push(JSON.stringify(input.attributes));
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return { whereClause, params };
  }
}
