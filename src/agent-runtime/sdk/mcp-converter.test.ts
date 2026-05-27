/**
 * MCP Protocol Format Converter Tests
 *
 * Tests for MCPToolConverter covering:
 * - MCP → Claude API format conversion
 * - Claude API → MCP format conversion
 * - Tool call request construction
 * - Tool call result parsing
 * - Error response creation
 */

import { describe, it, expect } from 'vitest';
import {
  MCPToolConverter,
  type MCPToolDefinition,
  type ToolCallResult,
} from './mcp-converter.js';
import type { ToolDefinition } from '../../infrastructure/llm/types.js';

describe('MCPToolConverter', () => {
  const converter = new MCPToolConverter();

  const sampleMCPTool: MCPToolDefinition = {
    name: 'query_orders',
    description: '查询订单信息',
    inputSchema: {
      type: 'object',
      properties: {
        orderNo: { type: 'string', description: '订单号' },
        status: { type: 'string', enum: ['pending', 'shipped', 'delivered'] },
        page: { type: 'number', default: 1 },
      },
      required: ['orderNo'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        orders: { type: 'array' },
        total: { type: 'number' },
      },
    },
    version: '1.0.0',
    permissions: ['orders:read'],
    timeout: 30000,
    sandbox: 'v8-isolate',
  };

  const sampleClaudeTool: ToolDefinition = {
    name: 'query_orders',
    description: '查询订单信息',
    input_schema: {
      type: 'object',
      properties: {
        orderNo: { type: 'string', description: '订单号' },
        status: { type: 'string', enum: ['pending', 'shipped', 'delivered'] },
        page: { type: 'number', default: 1 },
      },
      required: ['orderNo'],
    },
  };

  describe('toClaudeFormat', () => {
    it('should convert MCP tool definition to Claude API format', () => {
      const result = converter.toClaudeFormat(sampleMCPTool);

      expect(result).toEqual({
        name: 'query_orders',
        description: '查询订单信息',
        input_schema: sampleMCPTool.inputSchema,
      });
    });

    it('should map inputSchema to input_schema', () => {
      const result = converter.toClaudeFormat(sampleMCPTool);

      expect(result.input_schema).toBe(sampleMCPTool.inputSchema);
    });

    it('should not include MCP-specific fields in Claude format', () => {
      const result = converter.toClaudeFormat(sampleMCPTool);

      expect(result).not.toHaveProperty('outputSchema');
      expect(result).not.toHaveProperty('version');
      expect(result).not.toHaveProperty('permissions');
      expect(result).not.toHaveProperty('timeout');
      expect(result).not.toHaveProperty('sandbox');
    });

    it('should handle tool with empty inputSchema', () => {
      const tool: MCPToolDefinition = {
        ...sampleMCPTool,
        inputSchema: {},
      };

      const result = converter.toClaudeFormat(tool);

      expect(result.input_schema).toEqual({});
    });
  });

  describe('fromClaudeFormat', () => {
    it('should convert Claude API tool definition to partial MCP format', () => {
      const result = converter.fromClaudeFormat(sampleClaudeTool);

      expect(result).toEqual({
        name: 'query_orders',
        description: '查询订单信息',
        inputSchema: sampleClaudeTool.input_schema,
      });
    });

    it('should map input_schema to inputSchema', () => {
      const result = converter.fromClaudeFormat(sampleClaudeTool);

      expect(result.inputSchema).toBe(sampleClaudeTool.input_schema);
    });

    it('should not include fields not present in Claude format', () => {
      const result = converter.fromClaudeFormat(sampleClaudeTool);

      expect(result.outputSchema).toBeUndefined();
      expect(result.version).toBeUndefined();
      expect(result.permissions).toBeUndefined();
      expect(result.timeout).toBeUndefined();
      expect(result.sandbox).toBeUndefined();
    });

    it('should handle tool with complex input_schema', () => {
      const complexTool: ToolDefinition = {
        name: 'complex_tool',
        description: 'A complex tool',
        input_schema: {
          type: 'object',
          properties: {
            nested: {
              type: 'object',
              properties: {
                deep: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      };

      const result = converter.fromClaudeFormat(complexTool);

      expect(result.name).toBe('complex_tool');
      expect(result.inputSchema).toEqual(complexTool.input_schema);
    });
  });

  describe('round-trip conversion', () => {
    it('should preserve name, description, and inputSchema through MCP → Claude → MCP', () => {
      const claudeFormat = converter.toClaudeFormat(sampleMCPTool);
      const backToMCP = converter.fromClaudeFormat(claudeFormat);

      expect(backToMCP.name).toBe(sampleMCPTool.name);
      expect(backToMCP.description).toBe(sampleMCPTool.description);
      expect(backToMCP.inputSchema).toEqual(sampleMCPTool.inputSchema);
    });

    it('should preserve all Claude fields through Claude → MCP → Claude', () => {
      const mcpFormat = converter.fromClaudeFormat(sampleClaudeTool);
      // Fill in required MCP fields to make a full MCPToolDefinition
      const fullMCP: MCPToolDefinition = {
        name: mcpFormat.name!,
        description: mcpFormat.description!,
        inputSchema: mcpFormat.inputSchema!,
        outputSchema: {},
        version: '1.0.0',
        permissions: [],
        timeout: 30000,
        sandbox: 'v8-isolate',
      };
      const backToClaude = converter.toClaudeFormat(fullMCP);

      expect(backToClaude.name).toBe(sampleClaudeTool.name);
      expect(backToClaude.description).toBe(sampleClaudeTool.description);
      expect(backToClaude.input_schema).toEqual(sampleClaudeTool.input_schema);
    });
  });

  describe('buildToolCallRequest', () => {
    it('should construct a valid tool call request', () => {
      const result = converter.buildToolCallRequest(
        'query_orders',
        { orderNo: 'ORD-001' },
        'agent-123',
        'tenant-456',
        'trace-789',
      );

      expect(result).toEqual({
        toolName: 'query_orders',
        input: { orderNo: 'ORD-001' },
        callerId: 'agent-123',
        tenantId: 'tenant-456',
        traceId: 'trace-789',
      });
    });

    it('should handle null input', () => {
      const result = converter.buildToolCallRequest(
        'simple_tool',
        null,
        'agent-1',
        'tenant-1',
        'trace-1',
      );

      expect(result.input).toBeNull();
    });

    it('should handle complex input objects', () => {
      const complexInput = {
        filters: { status: 'pending', dateRange: { start: '2024-01-01', end: '2024-12-31' } },
        pagination: { page: 1, pageSize: 20 },
      };

      const result = converter.buildToolCallRequest(
        'query_orders',
        complexInput,
        'agent-1',
        'tenant-1',
        'trace-1',
      );

      expect(result.input).toEqual(complexInput);
    });
  });

  describe('parseToolCallResult', () => {
    it('should parse a successful result', () => {
      const result: ToolCallResult = {
        success: true,
        output: { orders: [{ id: '1', status: 'pending' }], total: 1 },
        executionTime: 150,
      };

      const parsed = converter.parseToolCallResult(result);

      expect(parsed).toEqual({
        success: true,
        output: { orders: [{ id: '1', status: 'pending' }], total: 1 },
      });
    });

    it('should parse a failed result with error', () => {
      const result: ToolCallResult = {
        success: false,
        error: { code: 'TIMEOUT', message: 'Tool execution timed out' },
        executionTime: 30000,
      };

      const parsed = converter.parseToolCallResult(result);

      expect(parsed).toEqual({
        success: false,
        error: 'Tool execution timed out',
      });
    });

    it('should handle failed result without error details', () => {
      const result: ToolCallResult = {
        success: false,
        executionTime: 0,
      };

      const parsed = converter.parseToolCallResult(result);

      expect(parsed).toEqual({
        success: false,
        error: 'Unknown tool execution error',
      });
    });

    it('should not include output in failed results', () => {
      const result: ToolCallResult = {
        success: false,
        error: { code: 'ERROR', message: 'Something went wrong' },
        executionTime: 100,
      };

      const parsed = converter.parseToolCallResult(result);

      expect(parsed.output).toBeUndefined();
    });

    it('should handle successful result with undefined output', () => {
      const result: ToolCallResult = {
        success: true,
        executionTime: 50,
      };

      const parsed = converter.parseToolCallResult(result);

      expect(parsed.success).toBe(true);
      expect(parsed.output).toBeUndefined();
    });
  });

  describe('createToolErrorResponse', () => {
    it('should create an error response from an Error', () => {
      const error = new Error('Connection refused');

      const result = converter.createToolErrorResponse('query_orders', error);

      expect(result).toEqual({
        success: false,
        error: {
          code: 'TOOL_EXECUTION_FAILED',
          message: "Tool 'query_orders' failed: Connection refused",
        },
        executionTime: 0,
      });
    });

    it('should include tool name in error message', () => {
      const error = new Error('timeout');

      const result = converter.createToolErrorResponse('my_tool', error);

      expect(result.error?.message).toContain('my_tool');
    });

    it('should always set success to false', () => {
      const error = new Error('any error');

      const result = converter.createToolErrorResponse('tool', error);

      expect(result.success).toBe(false);
    });

    it('should set executionTime to 0', () => {
      const error = new Error('any error');

      const result = converter.createToolErrorResponse('tool', error);

      expect(result.executionTime).toBe(0);
    });

    it('should handle errors with empty message', () => {
      const error = new Error('');

      const result = converter.createToolErrorResponse('tool', error);

      expect(result.error?.message).toBe("Tool 'tool' failed: ");
    });
  });
});
