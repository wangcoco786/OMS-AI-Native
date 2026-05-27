/**
 * Order Query Tool Implementation
 *
 * MCP-protocol compliant tool for querying orders from the database.
 * Supports filtering by order number, status, date range, shop, and pagination.
 *
 * Requirements: 9.1, 9.2
 */

import pino from 'pino';

import type { PostgresDatabaseService } from '../../infrastructure/database/database-service.js';
import type { MCPToolDefinition, ToolCallResult } from '../../infrastructure/tools/types.js';
import type { OrderStatus } from '../../shared/types.js';

/** Input schema for the query_orders tool */
export interface QueryOrdersInput {
  orderNo?: string;
  status?: OrderStatus;
  startDate?: string;
  endDate?: string;
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
  status: string;
  customer_name: string | null;
  total_amount: string | null;
  currency: string;
  items: unknown[];
  shipping_info: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

/** Result of an order query */
export interface OrderQueryResult {
  orders: OrderRecord[];
  total: number;
  page: number;
  pageSize: number;
}

/** Default pagination values */
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * MCP Tool Definition for query_orders.
 * Follows the MCPToolDefinition interface for registration with the Tool Registry.
 */
export const QUERY_ORDERS_TOOL_DEFINITION: MCPToolDefinition = {
  name: 'query_orders',
  description: '查询订单信息，支持按订单号、状态、时间范围、店铺等条件筛选，支持分页',
  inputSchema: {
    type: 'object',
    properties: {
      orderNo: { type: 'string', description: '订单号（模糊匹配）' },
      status: {
        type: 'string',
        enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'],
        description: '订单状态',
      },
      startDate: { type: 'string', format: 'date', description: '开始日期（YYYY-MM-DD）' },
      endDate: { type: 'string', format: 'date', description: '结束日期（YYYY-MM-DD）' },
      shopId: { type: 'string', description: '店铺 ID' },
      page: { type: 'integer', minimum: 1, description: '页码，默认 1' },
      pageSize: { type: 'integer', minimum: 1, maximum: 100, description: '每页数量，默认 20' },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      orders: { type: 'array', items: { type: 'object' } },
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
 * OrderQueryTool executes order queries against the database.
 * It builds dynamic SQL based on the provided filter conditions
 * and enforces multi-tenant isolation via the DatabaseService.
 */
export class OrderQueryTool {
  private readonly logger: pino.Logger;

  constructor(
    private readonly db: PostgresDatabaseService,
    options?: { logger?: pino.Logger },
  ) {
    this.logger = (options?.logger ?? pino({ name: 'order-query-tool' })).child({
      component: 'query-orders',
    });
  }

  /**
   * Execute the query_orders tool.
   *
   * Builds a parameterized SQL query based on the input filters,
   * executes it with tenant isolation, and returns paginated results.
   */
  async execute(input: QueryOrdersInput, tenantId: string): Promise<ToolCallResult> {
    const startTime = Date.now();

    try {
      const result = await this.queryOrders(input, tenantId);

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
   * Query orders from the database with the given filters.
   * Returns paginated results with total count.
   */
  async queryOrders(input: QueryOrdersInput, tenantId: string): Promise<OrderQueryResult> {
    const page = Math.max(DEFAULT_PAGE, input.page ?? DEFAULT_PAGE);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE));
    const offset = (page - 1) * pageSize;

    const { whereClause, params } = this.buildWhereClause(input);

    // Count query for total
    const countSql = `SELECT COUNT(*) as count FROM orders ${whereClause}`;
    const countResult = await this.db.query<{ count: string }>(countSql, params, tenantId);
    const total = parseInt(countResult[0]?.count ?? '0', 10);

    // Data query with pagination
    const dataSql = `SELECT id, order_no, external_order_no, shop_id, status, customer_name, total_amount, currency, items, shipping_info, created_at, updated_at FROM orders ${whereClause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
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
   * Returns the clause string and parameter array.
   * Note: tenant_id filtering is handled by the DatabaseService automatically.
   */
  private buildWhereClause(input: QueryOrdersInput): {
    whereClause: string;
    params: unknown[];
  } {
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
      // Add one day to make endDate inclusive
      params.push(`${input.endDate}T23:59:59.999Z`);
    }

    if (input.shopId) {
      conditions.push(`shop_id = $${paramIndex++}`);
      params.push(input.shopId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    return { whereClause, params };
  }
}
