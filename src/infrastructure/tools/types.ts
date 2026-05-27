/**
 * MCP Tool Registry Type Definitions
 *
 * Interfaces and types for Tool registration, discovery,
 * parameter validation, and invocation.
 */

import type { MCPToolDefinition, ToolCallRequest, ToolCallResult } from '../../agent-runtime/sdk/mcp-converter.js';

/** Filter criteria for tool discovery */
export interface ToolFilter {
  /** Filter by tool name (partial match) */
  name?: string;
  /** Filter by tool status */
  status?: 'active' | 'inactive';
  /** Filter by sandbox type */
  sandbox?: 'docker' | 'v8-isolate';
  /** Filter by required permission */
  permission?: string;
}

/** Result of input validation against a tool's schema */
export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
}

/** Individual validation error detail */
export interface ValidationError {
  field: string;
  message: string;
}

/** Tool row as stored in PostgreSQL */
export interface ToolRow {
  id: string;
  name: string;
  description: string | null;
  version: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  permissions: string[];
  timeout_ms: number;
  sandbox_type: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

/** MCP Tool Registry interface */
export interface MCPToolRegistry {
  /** Register a new tool definition */
  register(tool: MCPToolDefinition): Promise<void>;
  /** Unregister a tool by name (sets status to inactive) */
  unregister(toolName: string): Promise<void>;
  /** Discover tools matching optional filter criteria */
  discover(filter?: ToolFilter): Promise<MCPToolDefinition[]>;
  /** Invoke a tool with the given request */
  invoke(request: ToolCallRequest): Promise<ToolCallResult>;
  /** Validate input against a tool's input schema */
  validate(toolName: string, input: unknown): Promise<ValidationResult>;
}

export type { MCPToolDefinition, ToolCallRequest, ToolCallResult };
