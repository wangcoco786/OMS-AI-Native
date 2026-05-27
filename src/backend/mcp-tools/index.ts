/**
 * MCP Data Tools Module
 *
 * Provides MCP-protocol compliant data query tools for AI agents.
 * Includes order, inventory, and product/SKU query capabilities
 * with Redis caching and multi-tenant isolation.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7
 */

export { OrderQueryTool } from './order-query-tool.js';
export type { OrderQueryInput, OrderQueryResult, OrderRecord } from './order-query-tool.js';

export { InventoryQueryTool } from './inventory-query-tool.js';
export type { InventoryQueryInput, InventoryQueryResult, InventoryRecord } from './inventory-query-tool.js';

export { ProductQueryTool } from './product-query-tool.js';
export type { ProductQueryInput, ProductQueryResult, ProductRecord, ChannelMapping } from './product-query-tool.js';

export { QueryCache } from './query-cache.js';
export type { QueryCacheOptions } from './query-cache.js';

export {
  MCP_DATA_TOOL_DEFINITIONS,
  ORDER_QUERY_TOOL_DEFINITION,
  INVENTORY_QUERY_TOOL_DEFINITION,
  PRODUCT_QUERY_TOOL_DEFINITION,
} from './tool-definitions.js';
