/**
 * Order Query Result Formatter
 *
 * Formats raw order query results into structured, user-friendly responses.
 * Handles clarification prompts when query conditions are ambiguous.
 *
 * Requirements: 9.3, 9.4, 9.6
 */

import type { OrderRecord, OrderQueryResult, QueryOrdersInput } from './order-query-tool.js';

/** A formatted order entry with key display fields */
export interface FormattedOrder {
  orderNo: string;
  status: string;
  statusLabel: string;
  totalAmount: string;
  currency: string;
  customerName: string;
  shopId: string;
  createdAt: string;
}

/** Formatted query response for display */
export interface FormattedQueryResponse {
  summary: string;
  orders: FormattedOrder[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

/** Clarification request when query conditions are ambiguous */
export interface ClarificationRequest {
  needsClarification: true;
  message: string;
  suggestions: string[];
}

/** Status label mapping (Chinese) */
const STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  confirmed: '已确认',
  processing: '处理中',
  shipped: '已发货',
  delivered: '已送达',
  cancelled: '已取消',
  refunded: '已退款',
};

/**
 * Format a single order record into a display-friendly structure.
 */
export function formatOrder(order: OrderRecord): FormattedOrder {
  return {
    orderNo: order.order_no,
    status: order.status,
    statusLabel: STATUS_LABELS[order.status] ?? order.status,
    totalAmount: order.total_amount ?? '0.00',
    currency: order.currency ?? 'CNY',
    customerName: order.customer_name ?? '-',
    shopId: order.shop_id ?? '-',
    createdAt: formatDate(order.created_at),
  };
}

/**
 * Format the full query result into a structured response.
 */
export function formatQueryResponse(result: OrderQueryResult): FormattedQueryResponse {
  const totalPages = Math.ceil(result.total / result.pageSize);

  const summary = result.total === 0
    ? '未找到符合条件的订单'
    : `共找到 ${result.total} 条订单，当前显示第 ${result.page} 页（共 ${totalPages} 页）`;

  return {
    summary,
    orders: result.orders.map(formatOrder),
    pagination: {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages,
    },
  };
}

/**
 * Check if the query input needs clarification and generate a prompt.
 * Returns null if the input is sufficiently specific.
 */
export function checkClarification(input: QueryOrdersInput): ClarificationRequest | null {
  const hasOrderNo = Boolean(input.orderNo);
  const hasStatus = Boolean(input.status);
  const hasDateRange = Boolean(input.startDate || input.endDate);
  const hasShopId = Boolean(input.shopId);

  // If no conditions are specified at all, ask for clarification
  if (!hasOrderNo && !hasStatus && !hasDateRange && !hasShopId) {
    return {
      needsClarification: true,
      message: '请提供更具体的查询条件，以便我为您精确查找订单。',
      suggestions: [
        '请提供订单号进行精确查询',
        '请指定订单状态（如：待处理、已发货、已完成等）',
        '请指定时间范围（如：最近7天、本月等）',
        '请指定店铺名称或ID',
      ],
    };
  }

  return null;
}

/**
 * Format a Date object or date string into a readable string.
 */
function formatDate(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) {
    return String(date);
  }
  return d.toISOString().replace('T', ' ').slice(0, 19);
}
