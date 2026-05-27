/**
 * Order Query Domain Agent - Unit Tests
 *
 * Tests for:
 * - OrderQueryTool: query execution, filtering, pagination
 * - Order Query Agent definition
 * - Formatter: result formatting, clarification logic
 * - Audit logger: fire-and-forget logging
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { OrderQueryTool, QUERY_ORDERS_TOOL_DEFINITION } from './order-query-tool.js';
import type { QueryOrdersInput, OrderRecord } from './order-query-tool.js';
import {
  ORDER_QUERY_AGENT_DEFINITION,
  ORDER_QUERY_SYSTEM_PROMPT,
  registerOrderQueryAgent,
} from './order-query-agent.js';
import {
  formatOrder,
  formatQueryResponse,
  checkClarification,
} from './formatter.js';
import { OrderQueryAuditLogger } from './audit.js';

// --- Mock Database Service ---

function createMockDb(queryResults: unknown[] = []) {
  return {
    query: vi.fn().mockResolvedValue(queryResults),
    transaction: vi.fn(),
    migrate: vi.fn(),
    getPoolStats: vi.fn(),
    shutdown: vi.fn(),
    injectTenantFilter: vi.fn(),
  };
}

// --- OrderQueryTool Tests ---

describe('OrderQueryTool', () => {
  const tenantId = 'tenant-001';

  const sampleOrders: OrderRecord[] = [
    {
      id: 'order-1',
      order_no: 'ORD-2024-001',
      external_order_no: null,
      shop_id: 'shop-a',
      status: 'pending',
      customer_name: '张三',
      total_amount: '199.99',
      currency: 'CNY',
      items: [],
      shipping_info: {},
      created_at: new Date('2024-01-15T10:00:00Z'),
      updated_at: new Date('2024-01-15T10:00:00Z'),
    },
    {
      id: 'order-2',
      order_no: 'ORD-2024-002',
      external_order_no: 'EXT-002',
      shop_id: 'shop-b',
      status: 'shipped',
      customer_name: '李四',
      total_amount: '599.00',
      currency: 'CNY',
      items: [],
      shipping_info: {},
      created_at: new Date('2024-01-16T14:30:00Z'),
      updated_at: new Date('2024-01-16T14:30:00Z'),
    },
  ];

  it('should execute a basic query with default pagination', async () => {
    const mockDb = createMockDb();
    // First call: count query
    mockDb.query.mockResolvedValueOnce([{ count: '2' }]);
    // Second call: data query
    mockDb.query.mockResolvedValueOnce(sampleOrders);

    const tool = new OrderQueryTool(mockDb as any);
    const result = await tool.execute({}, tenantId);

    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      orders: sampleOrders,
      total: 2,
      page: 1,
      pageSize: 20,
    });
    expect(result.executionTime).toBeGreaterThanOrEqual(0);
  });

  it('should filter by order number', async () => {
    const mockDb = createMockDb();
    mockDb.query.mockResolvedValueOnce([{ count: '1' }]);
    mockDb.query.mockResolvedValueOnce([sampleOrders[0]]);

    const tool = new OrderQueryTool(mockDb as any);
    const input: QueryOrdersInput = { orderNo: 'ORD-2024-001' };
    const result = await tool.execute(input, tenantId);

    expect(result.success).toBe(true);
    // Verify the count query includes the ILIKE filter
    const countCall = mockDb.query.mock.calls[0];
    expect(countCall[0]).toContain('ILIKE');
    expect(countCall[1]).toContain('%ORD-2024-001%');
  });

  it('should filter by status', async () => {
    const mockDb = createMockDb();
    mockDb.query.mockResolvedValueOnce([{ count: '1' }]);
    mockDb.query.mockResolvedValueOnce([sampleOrders[1]]);

    const tool = new OrderQueryTool(mockDb as any);
    const input: QueryOrdersInput = { status: 'shipped' };
    const result = await tool.execute(input, tenantId);

    expect(result.success).toBe(true);
    const countCall = mockDb.query.mock.calls[0];
    expect(countCall[0]).toContain('status =');
    expect(countCall[1]).toContain('shipped');
  });

  it('should filter by date range', async () => {
    const mockDb = createMockDb();
    mockDb.query.mockResolvedValueOnce([{ count: '2' }]);
    mockDb.query.mockResolvedValueOnce(sampleOrders);

    const tool = new OrderQueryTool(mockDb as any);
    const input: QueryOrdersInput = {
      startDate: '2024-01-01',
      endDate: '2024-01-31',
    };
    const result = await tool.execute(input, tenantId);

    expect(result.success).toBe(true);
    const countCall = mockDb.query.mock.calls[0];
    expect(countCall[0]).toContain('created_at >=');
    expect(countCall[0]).toContain('created_at <');
    expect(countCall[1]).toContain('2024-01-01');
    expect(countCall[1]).toContain('2024-01-31T23:59:59.999Z');
  });

  it('should filter by shop ID', async () => {
    const mockDb = createMockDb();
    mockDb.query.mockResolvedValueOnce([{ count: '1' }]);
    mockDb.query.mockResolvedValueOnce([sampleOrders[0]]);

    const tool = new OrderQueryTool(mockDb as any);
    const input: QueryOrdersInput = { shopId: 'shop-a' };
    const result = await tool.execute(input, tenantId);

    expect(result.success).toBe(true);
    const countCall = mockDb.query.mock.calls[0];
    expect(countCall[0]).toContain('shop_id =');
    expect(countCall[1]).toContain('shop-a');
  });

  it('should handle pagination correctly', async () => {
    const mockDb = createMockDb();
    mockDb.query.mockResolvedValueOnce([{ count: '50' }]);
    mockDb.query.mockResolvedValueOnce(sampleOrders);

    const tool = new OrderQueryTool(mockDb as any);
    const input: QueryOrdersInput = { page: 3, pageSize: 10 };
    const result = await tool.execute(input, tenantId);

    expect(result.success).toBe(true);
    const output = result.output as any;
    expect(output.page).toBe(3);
    expect(output.pageSize).toBe(10);

    // Verify OFFSET is (page-1) * pageSize = 20
    const dataCall = mockDb.query.mock.calls[1];
    expect(dataCall[1]).toContain(10); // LIMIT
    expect(dataCall[1]).toContain(20); // OFFSET
  });

  it('should cap pageSize at 100', async () => {
    const mockDb = createMockDb();
    mockDb.query.mockResolvedValueOnce([{ count: '0' }]);
    mockDb.query.mockResolvedValueOnce([]);

    const tool = new OrderQueryTool(mockDb as any);
    const input: QueryOrdersInput = { pageSize: 500 };
    const result = await tool.execute(input, tenantId);

    expect(result.success).toBe(true);
    const output = result.output as any;
    expect(output.pageSize).toBe(100);
  });

  it('should return error result on database failure', async () => {
    const mockDb = createMockDb();
    mockDb.query.mockRejectedValueOnce(new Error('Connection refused'));

    const tool = new OrderQueryTool(mockDb as any);
    const result = await tool.execute({}, tenantId);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ORDER_QUERY_FAILED');
    expect(result.error?.message).toContain('Connection refused');
  });

  it('should pass tenantId to database service for isolation', async () => {
    const mockDb = createMockDb();
    mockDb.query.mockResolvedValueOnce([{ count: '0' }]);
    mockDb.query.mockResolvedValueOnce([]);

    const tool = new OrderQueryTool(mockDb as any);
    await tool.execute({}, tenantId);

    // Both count and data queries should pass tenantId
    expect(mockDb.query.mock.calls[0][2]).toBe(tenantId);
    expect(mockDb.query.mock.calls[1][2]).toBe(tenantId);
  });
});

// --- QUERY_ORDERS_TOOL_DEFINITION Tests ---

describe('QUERY_ORDERS_TOOL_DEFINITION', () => {
  it('should have correct name and description', () => {
    expect(QUERY_ORDERS_TOOL_DEFINITION.name).toBe('query_orders');
    expect(QUERY_ORDERS_TOOL_DEFINITION.description).toContain('查询订单');
  });

  it('should define input schema with all supported filters', () => {
    const props = QUERY_ORDERS_TOOL_DEFINITION.inputSchema.properties as Record<string, any>;
    expect(props).toHaveProperty('orderNo');
    expect(props).toHaveProperty('status');
    expect(props).toHaveProperty('startDate');
    expect(props).toHaveProperty('endDate');
    expect(props).toHaveProperty('shopId');
    expect(props).toHaveProperty('page');
    expect(props).toHaveProperty('pageSize');
  });

  it('should have valid MCP tool definition fields', () => {
    expect(QUERY_ORDERS_TOOL_DEFINITION.version).toBe('1.0.0');
    expect(QUERY_ORDERS_TOOL_DEFINITION.permissions).toContain('orders:read');
    expect(QUERY_ORDERS_TOOL_DEFINITION.timeout).toBeGreaterThan(0);
    expect(['docker', 'v8-isolate']).toContain(QUERY_ORDERS_TOOL_DEFINITION.sandbox);
  });
});

// --- Order Query Agent Definition Tests ---

describe('Order Query Agent Definition', () => {
  it('should have correct agent type and tools', () => {
    expect(ORDER_QUERY_AGENT_DEFINITION.id).toBe('order-query-agent');
    expect(ORDER_QUERY_AGENT_DEFINITION.type).toBe('order-query');
    expect(ORDER_QUERY_AGENT_DEFINITION.tools).toContain('query_orders');
  });

  it('should have a Chinese system prompt', () => {
    expect(ORDER_QUERY_SYSTEM_PROMPT).toContain('订单查询');
    expect(ORDER_QUERY_SYSTEM_PROMPT).toContain('query_orders');
  });

  it('should register agent with the platform', async () => {
    const mockPlatform = {
      registerAgent: vi.fn().mockResolvedValue({
        id: 'instance-1',
        definitionId: 'order-query-agent',
        tenantId: 'tenant-001',
        status: 'registered',
        activeSessions: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };

    const instance = await registerOrderQueryAgent(mockPlatform as any, 'tenant-001');

    expect(mockPlatform.registerAgent).toHaveBeenCalledWith(
      ORDER_QUERY_AGENT_DEFINITION,
      'tenant-001',
    );
    expect(instance.status).toBe('registered');
    expect(instance.tenantId).toBe('tenant-001');
  });
});

// --- Formatter Tests ---

describe('formatOrder', () => {
  const sampleOrder: OrderRecord = {
    id: 'order-1',
    order_no: 'ORD-2024-001',
    external_order_no: null,
    shop_id: 'shop-a',
    status: 'shipped',
    customer_name: '张三',
    total_amount: '299.99',
    currency: 'CNY',
    items: [],
    shipping_info: {},
    created_at: new Date('2024-03-15T08:30:00Z'),
    updated_at: new Date('2024-03-15T08:30:00Z'),
  };

  it('should format order with all key fields', () => {
    const formatted = formatOrder(sampleOrder);

    expect(formatted.orderNo).toBe('ORD-2024-001');
    expect(formatted.status).toBe('shipped');
    expect(formatted.statusLabel).toBe('已发货');
    expect(formatted.totalAmount).toBe('299.99');
    expect(formatted.currency).toBe('CNY');
    expect(formatted.customerName).toBe('张三');
    expect(formatted.shopId).toBe('shop-a');
    expect(formatted.createdAt).toBe('2024-03-15 08:30:00');
  });

  it('should handle null fields gracefully', () => {
    const orderWithNulls: OrderRecord = {
      ...sampleOrder,
      customer_name: null,
      total_amount: null,
      shop_id: null,
    };

    const formatted = formatOrder(orderWithNulls);

    expect(formatted.customerName).toBe('-');
    expect(formatted.totalAmount).toBe('0.00');
    expect(formatted.shopId).toBe('-');
  });

  it('should map all known statuses to Chinese labels', () => {
    const statuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'];
    const expectedLabels = ['待处理', '已确认', '处理中', '已发货', '已送达', '已取消', '已退款'];

    statuses.forEach((status, i) => {
      const formatted = formatOrder({ ...sampleOrder, status });
      expect(formatted.statusLabel).toBe(expectedLabels[i]);
    });
  });
});

describe('formatQueryResponse', () => {
  it('should format empty results with appropriate message', () => {
    const response = formatQueryResponse({
      orders: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });

    expect(response.summary).toContain('未找到');
    expect(response.orders).toHaveLength(0);
    expect(response.pagination.totalPages).toBe(0);
  });

  it('should format results with pagination info', () => {
    const orders: OrderRecord[] = [{
      id: 'order-1',
      order_no: 'ORD-001',
      external_order_no: null,
      shop_id: 'shop-a',
      status: 'pending',
      customer_name: '用户',
      total_amount: '100.00',
      currency: 'CNY',
      items: [],
      shipping_info: {},
      created_at: new Date('2024-01-01'),
      updated_at: new Date('2024-01-01'),
    }];

    const response = formatQueryResponse({
      orders,
      total: 50,
      page: 2,
      pageSize: 10,
    });

    expect(response.summary).toContain('50');
    expect(response.summary).toContain('第 2 页');
    expect(response.summary).toContain('共 5 页');
    expect(response.pagination.totalPages).toBe(5);
    expect(response.orders).toHaveLength(1);
  });
});

describe('checkClarification', () => {
  it('should request clarification when no conditions are provided', () => {
    const result = checkClarification({});

    expect(result).not.toBeNull();
    expect(result!.needsClarification).toBe(true);
    expect(result!.message).toBeTruthy();
    expect(result!.suggestions.length).toBeGreaterThan(0);
  });

  it('should not request clarification when orderNo is provided', () => {
    const result = checkClarification({ orderNo: 'ORD-001' });
    expect(result).toBeNull();
  });

  it('should not request clarification when status is provided', () => {
    const result = checkClarification({ status: 'pending' });
    expect(result).toBeNull();
  });

  it('should not request clarification when date range is provided', () => {
    const result = checkClarification({ startDate: '2024-01-01' });
    expect(result).toBeNull();
  });

  it('should not request clarification when shopId is provided', () => {
    const result = checkClarification({ shopId: 'shop-a' });
    expect(result).toBeNull();
  });
});

// --- Audit Logger Tests ---

describe('OrderQueryAuditLogger', () => {
  it('should log query audit entry to database', () => {
    const mockDb = createMockDb();
    mockDb.query.mockResolvedValue([]);

    const auditLogger = new OrderQueryAuditLogger(mockDb as any);

    auditLogger.log({
      userId: 'user-001',
      tenantId: 'tenant-001',
      queryConditions: { status: 'pending', page: 1 },
      resultCount: 5,
      timestamp: '2024-01-15T10:00:00Z',
    });

    // Fire-and-forget: the query should be called
    expect(mockDb.query).toHaveBeenCalledTimes(1);

    const [sql, params, tenantId] = mockDb.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO audit_logs');
    expect(params).toContain('user-001');       // actor_id
    expect(params).toContain('tenant-001');     // tenant_id
    expect(params).toContain('user');           // actor_type
    expect(params).toContain('order.query');    // action
    expect(params).toContain('orders');         // resource_type
    expect(tenantId).toBe('tenant-001');

    // Verify details JSON contains required fields
    const detailsJson = params[6] as string;
    const details = JSON.parse(detailsJson);
    expect(details.query_conditions).toEqual({ status: 'pending', page: 1 });
    expect(details.result_count).toBe(5);
    expect(details.timestamp).toBe('2024-01-15T10:00:00Z');
  });

  it('should not throw when database write fails', () => {
    const mockDb = createMockDb();
    mockDb.query.mockRejectedValue(new Error('DB connection lost'));

    const auditLogger = new OrderQueryAuditLogger(mockDb as any);

    // Should not throw
    expect(() => {
      auditLogger.log({
        userId: 'user-001',
        tenantId: 'tenant-001',
        queryConditions: {},
        resultCount: 0,
        timestamp: '2024-01-15T10:00:00Z',
      });
    }).not.toThrow();
  });
});
