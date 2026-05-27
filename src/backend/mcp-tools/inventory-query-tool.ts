/**
 * MCP Inventory Query Tool
 *
 * MCP-protocol compliant tool for querying inventory data from the database.
 * Supports filtering by SKU, warehouse, stock level (below safety threshold),
 * and pagination. Integrates Redis caching for high-frequency queries.
 *
 * Requirements: 10.2, 10.4, 10.5, 10.6
 */

import pino from 'pino';

import type { PostgresDatabaseService } from '../../infrastructure/database/database-service.js';
import type { MCPToolDefinition, ToolCallResult } from '../../infrastructure/tools/types.js';
import type { QueryCache } from './query-cache.js';

/** Input parameters for the inventory query tool */
export interface InventoryQueryInput {
  sku?: string;
  warehouseId?: string;
  belowSafetyLevel?: boolean;
  page?: number;
  pageSize?: number;
}

/** A single inventory record returned from the database */
export interface InventoryRecord {
  id: string;
  system_sku_id: string;
  sku: string;
  sku_name: string;
  warehouse_id: string;
  warehouse_name: string;
  quantity: number;
  safety_threshold: number;
  max_capacity: number | null;
  below_safety: boolean;
  utilization_rate: number | null;
  last_sync_at: Date | null;
}

/** Paginated inventory query result */
export interface InventoryQueryResult {
  inventory: InventoryRecord[];
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

/**
 * MCP Tool Definition for query_inventory.
 * Registered with the MCP Tool Registry for agent discovery and invocation.
 */
export const INVENTORY_QUERY_TOOL_DEFINITION: MCPToolDefinition = {
  name: 'query_inventory',
  description: '查询库存信息，支持按 SKU、仓库、库存水位等条件筛选，支持分页',
  inputSchema: {
    type: 'object',
    properties: {
      sku: { type: 'string', description: 'SKU 编码（模糊匹配）' },
      warehouseId: { type: 'string', description: '仓库 ID' },
      belowSafetyLevel: { type: 'boolean', description: '是否仅返回低于安全库存的记录' },
      page: { type: 'integer', minimum: 1, description: '页码，默认 1' },
      pageSize: { type: 'integer', minimum: 1, maximum: 100, description: '每页数量，默认 20，最大 100' },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      inventory: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            system_sku_id: { type: 'string' },
            sku: { type: 'string' },
            sku_name: { type: 'string' },
            warehouse_id: { type: 'string' },
            warehouse_name: { type: 'string' },
            quantity: { type: 'integer' },
            safety_threshold: { type: 'integer' },
            max_capacity: { type: ['integer', 'null'] },
            below_safety: { type: 'boolean' },
            utilization_rate: { type: ['number', 'null'] },
            last_sync_at: { type: ['string', 'null'], format: 'date-time' },
          },
        },
      },
      total: { type: 'integer' },
      page: { type: 'integer' },
      pageSize: { type: 'integer' },
    },
    required: ['inventory', 'total', 'page', 'pageSize'],
  },
  version: '1.0.0',
  permissions: ['inventory:read'],
  timeout: 10000,
  sandbox: 'v8-isolate',
};

/**
 * InventoryQueryTool executes inventory queries against the database with
 * Redis caching and multi-tenant isolation.
 */
export class InventoryQueryTool {
  private readonly logger: pino.Logger;

  constructor(
    private readonly db: PostgresDatabaseService,
    private readonly cache: QueryCache,
    options?: { logger?: pino.Logger },
  ) {
    this.logger = (options?.logger ?? pino({ name: 'mcp-inventory-query-tool' })).child({
      component: 'query-inventory',
    });
  }

  /**
   * Execute the query_inventory tool.
   * Validates input, checks cache, queries database, and caches result.
   */
  async execute(input: InventoryQueryInput, tenantId: string): Promise<ToolCallResult> {
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
      const cached = await this.cache.get<InventoryQueryResult>(
        INVENTORY_QUERY_TOOL_DEFINITION.name,
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
      const result = await this.queryInventory(input, tenantId);

      // Cache the result
      await this.cache.set(INVENTORY_QUERY_TOOL_DEFINITION.name, input, tenantId, result);

      return {
        success: true,
        output: result,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      this.logger.error({ error, input, tenantId }, 'Inventory query failed');

      return {
        success: false,
        error: {
          code: 'INVENTORY_QUERY_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error during inventory query',
        },
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Validate input parameters and return structured errors for invalid fields.
   */
  validateInput(input: InventoryQueryInput): ParameterValidationError[] {
    const errors: ParameterValidationError[] = [];

    if (input.belowSafetyLevel !== undefined && typeof input.belowSafetyLevel !== 'boolean') {
      errors.push({
        field: 'belowSafetyLevel',
        expected: 'boolean',
        actual: input.belowSafetyLevel,
        message: `Invalid belowSafetyLevel value: "${input.belowSafetyLevel}"`,
      });
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
   * Query inventory from the database with the given filters.
   * Joins with system_skus and warehouses tables for enriched data.
   */
  private async queryInventory(input: InventoryQueryInput, tenantId: string): Promise<InventoryQueryResult> {
    const page = Math.max(DEFAULT_PAGE, input.page ?? DEFAULT_PAGE);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE));
    const offset = (page - 1) * pageSize;

    const { whereClause, params } = this.buildWhereClause(input);

    // Count query
    const countSql = `SELECT COUNT(*) as count FROM inventory i JOIN system_skus s ON i.system_sku_id = s.id LEFT JOIN warehouses w ON i.warehouse_id = w.code AND i.tenant_id = w.tenant_id ${whereClause}`;
    const countResult = await this.db.query<{ count: string }>(countSql, params, tenantId);
    const total = parseInt(countResult[0]?.count ?? '0', 10);

    // Data query with joins
    const paramCount = params.length;
    const dataSql = `SELECT i.id, i.system_sku_id, s.sku, s.name as sku_name, i.warehouse_id, COALESCE(w.name, i.warehouse_id) as warehouse_name, i.quantity, i.safety_threshold, i.max_capacity, (i.quantity < i.safety_threshold) as below_safety, CASE WHEN i.max_capacity > 0 THEN ROUND((i.quantity::numeric / i.max_capacity::numeric) * 100, 2) ELSE NULL END as utilization_rate, i.last_sync_at FROM inventory i JOIN system_skus s ON i.system_sku_id = s.id LEFT JOIN warehouses w ON i.warehouse_id = w.code AND i.tenant_id = w.tenant_id ${whereClause} ORDER BY i.updated_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    const dataParams = [...params, pageSize, offset];
    const inventory = await this.db.query<InventoryRecord>(dataSql, dataParams, tenantId);

    this.logger.info(
      { tenantId, total, page, pageSize, filterCount: params.length },
      'Inventory query executed',
    );

    return { inventory, total, page, pageSize };
  }

  /**
   * Build a WHERE clause from the input filters.
   * Tenant isolation is handled automatically by the DatabaseService.
   */
  private buildWhereClause(input: InventoryQueryInput): { whereClause: string; params: unknown[] } {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (input.sku) {
      conditions.push(`s.sku ILIKE $${paramIndex++}`);
      params.push(`%${input.sku}%`);
    }

    if (input.warehouseId) {
      conditions.push(`i.warehouse_id = $${paramIndex++}`);
      params.push(input.warehouseId);
    }

    if (input.belowSafetyLevel === true) {
      conditions.push(`i.quantity < i.safety_threshold`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return { whereClause, params };
  }
}
