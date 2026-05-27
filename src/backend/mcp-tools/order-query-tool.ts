/**
 * MCP Order Query Tool
 *
 * MCP-protocol compliant tool for querying orders from the database.
 * Supports filtering by order number, status, date range, channel, shop,
 * and pagination. Integrates Redis caching for high-frequency queries.
 *
 * Requirements: 10.1, 10.4, 10.5, 10.6
 */

import pino from 'pino';

import type { PostgresDatabaseService } from '../../infrastructure/database/database-service.js';
import type { MCPToolDefinition, ToolCallResult } from '../../infrastructure/tools/types.js';
import type { QueryCache } from './query-cache.js';

/** Input parameters for the order query tool */
export interface OrderQueryInput {
  orderNo?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  channelId?: string;
  shopId?: string;
  page?: number;
  pageSize?: number;
}

/** A single order record returned from the database */
export interface OrderRecord {
  id: string;
  order_no: string;
  external_order_no: string | null;
  shop_id: string | null;
  channel_id: string | null;
  status: string;
  customer_name: string | null;
  total_amount: string | null;
  currency: string;
  items: unknown[];
  shipping_info: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

/** Paginated order query result */
export interface OrderQueryResult {
  orders: OrderRecord[];
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

/** Valid order statuses */
const VALID_ORDER_STATUSES = [
  'pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded',
] as const;

/**
 * MCP Tool Definition for query_orders.
 * Registered with the MCP Tool Registry for agent discovery and invocation.
 */
export const ORDER_QUERY_TOOL_DEFINITION: MCPToolDefinition = {
  name: 'query_orders',
  description: '查询订单信息，支持按订单号、状态、时间范围、渠道、店铺等条件筛选，支持分页',
  inputSchema: {
    type: 'object',
    properties: {
      orderNo: { type: 'string', description: '订单号（模糊匹配）' },
      status: {
        type: 'string',
        enum: VALID_ORDER_STATUSES,
        description: '订单状态',
      },
      startDate: { type: 'string', format: 'date', description: '开始日期（YYYY-MM-DD）' },
      endDate: { type: 'string', format: 'date', description: '结束日期（YYYY-MM-DD）' },
      channelId: { type: 'string', description: '渠道 ID' },
      shopId: { type: 'string', description: '店铺 ID' },
      page: { type: 'integer', minimum: 1, description: '页码，默认 1' },
      pageSize: { type: 'integer', minimum: 1, maximum: 100, description: '每页数量，默认 20，最大 100' },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      orders: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            order_no: { type: 'string' },
            external_order_no: { type: ['string', 'null'] },
            shop_id: { type: ['string', 'null'] },
            channel_id: { type: ['string', 'null'] },
            status: { type: 'string' },
            customer_name: { type: ['string', 'null'] },
            total_amount: { type: ['string', 'null'] },
            currency: { type: 'string' },
            items: { type: 'array' },
            shipping_info: { type: 'object' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
      },
      total: { type: 'integer' },
      page: { type: 'integer' },
      pageSize: { type: 'integer' },
    },
    required: ['orders', 'total', 'page', 'pageSize'],
  },
  version: '1.0.0',
  permissions: ['orders:read'],
  timeout: 10000,
  sandbox: 'v8-isolate',
};

/**
 * OrderQueryTool executes order queries against the database with
 * Redis caching and multi-tenant isolation.
 */
export class OrderQueryTool {
  private readonly logger: pino.Logger;

  constructor(
    private readonly db: PostgresDatabaseService,
    private readonly cache: QueryCache,
    options?: { logger?: pino.Logger },
  ) {
    this.logger = (options?.logger ?? pino({ name: 'mcp-order-query-tool' })).child({
      component: 'query-orders',
    });
  }

  /**
   * Execute the query_orders tool.
   * Validates input, checks cache, queries database, and caches result.
   */
  async execute(input: OrderQueryInput, tenantId: string): Promise<ToolCallResult> {
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
      const cached = await this.cache.get<OrderQueryResult>(
        ORDER_QUERY_TOOL_DEFINITION.name,
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
      const result = await this.queryOrders(input, tenantId);

      // Cache the result
      await this.cache.set(ORDER_QUERY_TOOL_DEFINITION.name, input, tenantId, result);

      return {
        success: true,
        output: result,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      this.logger.error({ error, input, tenantId }, 'Order query failed');

      return {
        success: false,
        error: {
          code: 'ORDER_QUERY_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error during order query',
        },
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Validate input parameters and return structured errors for invalid fields.
   */
  validateInput(input: OrderQueryInput): ParameterValidationError[] {
    const errors: ParameterValidationError[] = [];

    if (input.status !== undefined && !VALID_ORDER_STATUSES.includes(input.status as typeof VALID_ORDER_STATUSES[number])) {
      errors.push({
        field: 'status',
        expected: `one of: ${VALID_ORDER_STATUSES.join(', ')}`,
        actual: input.status,
        message: `Invalid order status: "${input.status}"`,
      });
    }

    if (input.startDate !== undefined && !this.isValidDate(input.startDate)) {
      errors.push({
        field: 'startDate',
        expected: 'date string in YYYY-MM-DD format',
        actual: input.startDate,
        message: `Invalid start date format: "${input.startDate}"`,
      });
    }

    if (input.endDate !== undefined && !this.isValidDate(input.endDate)) {
      errors.push({
        field: 'endDate',
        expected: 'date string in YYYY-MM-DD format',
        actual: input.endDate,
        message: `Invalid end date format: "${input.endDate}"`,
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
   * Query orders from the database with the given filters.
   */
  private async queryOrders(input: OrderQueryInput, tenantId: string): Promise<OrderQueryResult> {
    const page = Math.max(DEFAULT_PAGE, input.page ?? DEFAULT_PAGE);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE));
    const offset = (page - 1) * pageSize;

    const { whereClause, params } = this.buildWhereClause(input);

    // Count query
    const countSql = `SELECT COUNT(*) as count FROM orders ${whereClause}`;
    const countResult = await this.db.query<{ count: string }>(countSql, params, tenantId);
    const total = parseInt(countResult[0]?.count ?? '0', 10);

    // Data query with pagination
    const paramCount = params.length;
    const dataSql = `SELECT id, order_no, external_order_no, shop_id, channel_id, status, customer_name, total_amount, currency, items, shipping_info, created_at, updated_at FROM orders ${whereClause} ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    const dataParams = [...params, pageSize, offset];
    const orders = await this.db.query<OrderRecord>(dataSql, dataParams, tenantId);

    this.logger.info(
      { tenantId, total, page, pageSize, filterCount: params.length },
      'Order query executed',
    );

    return { orders, total, page, pageSize };
  }

  /**
   * Build a WHERE clause from the input filters.
   * Tenant isolation is handled automatically by the DatabaseService.
   */
  private buildWhereClause(input: OrderQueryInput): { whereClause: string; params: unknown[] } {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (input.orderNo) {
      conditions.push(`order_no ILIKE $${paramIndex++}`);
      params.push(`%${input.orderNo}%`);
    }

    if (input.status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(input.status);
    }

    if (input.startDate) {
      conditions.push(`created_at >= $${paramIndex++}`);
      params.push(input.startDate);
    }

    if (input.endDate) {
      conditions.push(`created_at < $${paramIndex++}`);
      params.push(`${input.endDate}T23:59:59.999Z`);
    }

    if (input.channelId) {
      conditions.push(`channel_id = $${paramIndex++}`);
      params.push(input.channelId);
    }

    if (input.shopId) {
      conditions.push(`shop_id = $${paramIndex++}`);
      params.push(input.shopId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return { whereClause, params };
  }

  /**
   * Validate a date string is in YYYY-MM-DD format.
   */
  private isValidDate(dateStr: string): boolean {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateStr)) return false;
    const date = new Date(dateStr);
    return !isNaN(date.getTime());
  }
}
