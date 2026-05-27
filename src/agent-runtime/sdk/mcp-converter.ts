/**
 * MCP Protocol Format Converter
 *
 * Converts between MCP tool definitions and Claude API tool definitions.
 * Handles MCP request construction, response parsing, and error propagation
 * for tool calls.
 *
 * Requirements: 2.3, 2.5
 */

import type { ToolDefinition } from '../../infrastructure/llm/types.js';

/** JSON Schema type (subset used for tool definitions) */
export type JSONSchema = Record<string, unknown>;

/** MCP Tool Definition following the MCP protocol */
export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  version: string;
  permissions: string[];
  timeout: number;
  sandbox: 'docker' | 'v8-isolate';
}

/** MCP Tool Call Request */
export interface ToolCallRequest {
  toolName: string;
  input: unknown;
  callerId: string;
  tenantId: string;
  traceId: string;
}

/** MCP Tool Call Result */
export interface ToolCallResult {
  success: boolean;
  output?: unknown;
  error?: { code: string; message: string };
  executionTime: number;
}

/** Parsed result from a ToolCallResult */
export interface ParsedToolCallResult {
  success: boolean;
  output?: unknown;
  error?: string;
}

/**
 * MCPToolConverter handles conversion between MCP tool definitions
 * and Claude API tool definitions, as well as constructing tool call
 * requests and parsing tool call results.
 */
export class MCPToolConverter {
  /**
   * Convert an MCP tool definition to Claude API ToolDefinition format.
   *
   * Maps:
   * - name → name
   * - description → description
   * - inputSchema → input_schema
   *
   * MCP-specific fields (outputSchema, version, permissions, timeout, sandbox)
   * are not represented in the Claude API format and are dropped.
   */
  toClaudeFormat(mcpTool: MCPToolDefinition): ToolDefinition {
    return {
      name: mcpTool.name,
      description: mcpTool.description,
      input_schema: mcpTool.inputSchema,
    };
  }

  /**
   * Convert a Claude API ToolDefinition to a partial MCP tool definition.
   *
   * Since Claude API format lacks MCP-specific fields (outputSchema, version,
   * permissions, timeout, sandbox), those are not included in the result.
   *
   * Maps:
   * - name → name
   * - description → description
   * - input_schema → inputSchema
   */
  fromClaudeFormat(claudeTool: ToolDefinition): Partial<MCPToolDefinition> {
    return {
      name: claudeTool.name,
      description: claudeTool.description,
      inputSchema: claudeTool.input_schema,
    };
  }

  /**
   * Build an MCP tool call request with the required context fields.
   *
   * @param toolName - Name of the tool to call
   * @param input - Input parameters for the tool
   * @param callerId - ID of the agent or user making the call
   * @param tenantId - Tenant ID for multi-tenant isolation
   * @param traceId - Trace ID for observability
   */
  buildToolCallRequest(
    toolName: string,
    input: unknown,
    callerId: string,
    tenantId: string,
    traceId: string,
  ): ToolCallRequest {
    return {
      toolName,
      input,
      callerId,
      tenantId,
      traceId,
    };
  }

  /**
   * Parse an MCP tool call result into a simplified format.
   *
   * Extracts success/failure status, output data, and error message
   * from the raw ToolCallResult.
   */
  parseToolCallResult(result: ToolCallResult): ParsedToolCallResult {
    if (result.success) {
      return {
        success: true,
        output: result.output,
      };
    }

    return {
      success: false,
      error: result.error?.message ?? 'Unknown tool execution error',
    };
  }

  /**
   * Create an error response for a failed tool call.
   *
   * Wraps an Error into a ToolCallResult with:
   * - success: false
   * - error code derived from the error name
   * - error message from the error
   * - executionTime: 0 (since the tool didn't execute)
   */
  createToolErrorResponse(toolName: string, error: Error): ToolCallResult {
    return {
      success: false,
      error: {
        code: `TOOL_EXECUTION_FAILED`,
        message: `Tool '${toolName}' failed: ${error.message}`,
      },
      executionTime: 0,
    };
  }
}
