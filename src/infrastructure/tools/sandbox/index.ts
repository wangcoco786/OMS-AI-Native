/**
 * Tool Sandbox Module
 *
 * Provides isolated execution environments for tool functions.
 * - V8 Isolate: Lightweight sandbox using Node.js vm module
 * - Docker: Strong isolation using Docker containers
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */

export {
  V8SandboxExecutor,
  ToolFunctionRegistry,
  type ToolFunction,
  type ExecutionStatus,
  type V8SandboxConfig,
} from './v8-sandbox.js';

export {
  DockerSandboxExecutor,
  type DockerSandboxConfig,
  type DockerExecutionStatus,
  type NetworkPolicy,
  type ExecAsyncFn,
} from './docker-sandbox.js';
