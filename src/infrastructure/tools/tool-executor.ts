/**
 * Tool Executor Interface
 *
 * Defines the contract for executing tools in a sandboxed environment.
 * The actual sandbox implementation (V8 Isolate or Docker) will implement
 * this interface in task 8.
 *
 * Requirements: 3.5
 */

import type { ToolCallResult } from './types.js';

/** Configuration for tool execution */
export interface ToolExecutionConfig {
  /** Maximum execution time in milliseconds */
  timeout: number;
  /** Sandbox type to use for execution */
  sandbox: 'docker' | 'v8-isolate';
}

/**
 * ToolExecutor defines the interface that sandbox implementations must fulfill.
 * It receives a tool name, input, and execution config, and returns the result.
 */
export interface ToolExecutor {
  execute(
    toolName: string,
    input: unknown,
    config: ToolExecutionConfig,
  ): Promise<ToolCallResult>;
}
