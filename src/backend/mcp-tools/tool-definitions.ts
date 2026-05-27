/**
 * MCP Data Tools - Tool Definitions
 *
 * Central registry of all MCPToolDefinition constants for the MCP Data Tools module.
 * These definitions are used for tool registration, discovery, and schema validation.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4
 */

import type { MCPToolDefinition } from '../../infrastructure/tools/types.js';

import { ORDER_QUERY_TOOL_DEFINITION } from './order-query-tool.js';
import { INVENTORY_QUERY_TOOL_DEFINITION } from './inventory-query-tool.js';
import { PRODUCT_QUERY_TOOL_DEFINITION } from './product-query-tool.js';

/**
 * All MCP Data Tool definitions for registration with the MCP Tool Registry.
 */
export const MCP_DATA_TOOL_DEFINITIONS: MCPToolDefinition[] = [
  ORDER_QUERY_TOOL_DEFINITION,
  INVENTORY_QUERY_TOOL_DEFINITION,
  PRODUCT_QUERY_TOOL_DEFINITION,
];

export {
  ORDER_QUERY_TOOL_DEFINITION,
  INVENTORY_QUERY_TOOL_DEFINITION,
  PRODUCT_QUERY_TOOL_DEFINITION,
};
