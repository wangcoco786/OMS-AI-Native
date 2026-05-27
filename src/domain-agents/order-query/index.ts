/**
 * Order Query Domain Agent
 *
 * Parses natural language order queries, invokes
 * the order query tool, and returns formatted results.
 *
 * Exports:
 * - OrderQueryTool: executes order queries against the database
 * - Order Query Agent definition and registration helper
 * - Formatter utilities for structuring query results
 * - Audit logger for recording query operations
 */

export {
  OrderQueryTool,
  QUERY_ORDERS_TOOL_DEFINITION,
  type QueryOrdersInput,
  type OrderRecord,
  type OrderQueryResult,
} from './order-query-tool.js';

export {
  ORDER_QUERY_AGENT_DEFINITION,
  ORDER_QUERY_SYSTEM_PROMPT,
  registerOrderQueryAgent,
} from './order-query-agent.js';

export {
  formatOrder,
  formatQueryResponse,
  checkClarification,
  type FormattedOrder,
  type FormattedQueryResponse,
  type ClarificationRequest,
} from './formatter.js';

export {
  OrderQueryAuditLogger,
  type OrderQueryAuditEntry,
} from './audit.js';
