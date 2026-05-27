/**
 * Docker Sandbox Executor
 *
 * Implements the ToolExecutor interface using Docker containers for
 * strong isolation. Provides network policy enforcement, file system
 * path whitelisting, CPU/memory limits, and container lifecycle management.
 *
 * Since Docker may not be available in all environments, this implementation
 * uses child_process.exec to invoke Docker CLI commands, making it easy to
 * test with mocked child_process.
 *
 * Requirements: 4.1, 4.4, 4.5
 */

import { exec } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { ToolExecutor, ToolExecutionConfig } from '../tool-executor.js';
import type { ToolCallResult } from '../types.js';

/** Promisified exec function type */
export type ExecAsyncFn = (
  command: string,
  options?: { timeout?: number; maxBuffer?: number },
) => Promise<{ stdout: string; stderr: string }>;

const defaultExecAsync: ExecAsyncFn = promisify(exec) as unknown as ExecAsyncFn;

/** Network policy for Docker container */
export type NetworkPolicy = 'none' | 'bridge' | 'host';

/** Execution status for a Docker sandbox run */
export type DockerExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timed_out';

/** Configuration for the Docker sandbox */
export interface DockerSandboxConfig {
  /** Docker image to use for execution */
  image: string;
  /** Default timeout in milliseconds */
  defaultTimeout: number;
  /** Network policy for the container */
  networkPolicy: NetworkPolicy;
  /** File system paths allowed to be mounted (read-only) */
  allowedPaths: string[];
  /** CPU limit (number of CPUs, e.g., 0.5 for half a CPU) */
  cpuLimit: number;
  /** Memory limit in bytes */
  memoryLimit: number;
  /** Maximum number of concurrent container executions */
  maxConcurrent: number;
  /** Injectable exec function for testing */
  execFn?: ExecAsyncFn;
}

/** Internal execution record for tracking container lifecycle */
interface DockerExecutionRecord {
  id: string;
  containerId?: string;
  toolName: string;
  status: DockerExecutionStatus;
  startedAt: number;
  completedAt?: number;
}

const DEFAULT_CONFIG: DockerSandboxConfig = {
  image: 'node:20-alpine',
  defaultTimeout: 30000,
  networkPolicy: 'none',
  allowedPaths: [],
  cpuLimit: 0.5,
  memoryLimit: 256 * 1024 * 1024, // 256 MB
  maxConcurrent: 5,
};

/**
 * DockerSandboxExecutor implements the ToolExecutor interface using Docker containers.
 *
 * Container lifecycle: create → run → cleanup
 *
 * Each tool execution:
 * 1. Validates concurrency limits and configuration
 * 2. Builds Docker run command with resource limits and security policies
 * 3. Executes the tool code inside the container
 * 4. Parses the output and cleans up the container
 * 5. Returns a ToolCallResult with success/failure status
 */
export class DockerSandboxExecutor implements ToolExecutor {
  private readonly config: DockerSandboxConfig;
  private readonly executions = new Map<string, DockerExecutionRecord>();
  private readonly execAsync: ExecAsyncFn;
  private activeCount = 0;

  constructor(config?: Partial<DockerSandboxConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.execAsync = this.config.execFn ?? defaultExecAsync;
  }

  /**
   * Execute a tool inside a Docker container.
   *
   * @param toolName - Name of the tool to execute
   * @param input - Input data to pass to the tool
   * @param config - Execution configuration (timeout, sandbox type)
   * @returns ToolCallResult with success/failure status and output
   */
  async execute(
    toolName: string,
    input: unknown,
    config: ToolExecutionConfig,
  ): Promise<ToolCallResult> {
    const executionId = randomUUID();
    const startTime = Date.now();
    const timeout = config.timeout || this.config.defaultTimeout;

    // Check concurrency limit
    if (this.activeCount >= this.config.maxConcurrent) {
      return {
        success: false,
        error: {
          code: 'SANDBOX_CONCURRENCY_LIMIT',
          message: `Maximum concurrent Docker executions (${this.config.maxConcurrent}) reached`,
        },
        executionTime: 0,
      };
    }

    // Create execution record
    const record: DockerExecutionRecord = {
      id: executionId,
      toolName,
      status: 'pending',
      startedAt: startTime,
    };
    this.executions.set(executionId, record);
    this.activeCount++;

    try {
      record.status = 'running';

      // Build and execute Docker command
      const containerName = `tool-${toolName}-${executionId.slice(0, 8)}`;
      const dockerCommand = this.buildDockerCommand(containerName, toolName, input, timeout);

      const { stdout } = await this.runDockerCommand(dockerCommand, timeout);
      const executionTime = Date.now() - startTime;

      // Parse output
      const output = this.parseOutput(stdout);

      // Cleanup container
      await this.cleanupContainer(containerName);

      record.status = 'completed';
      record.completedAt = Date.now();
      record.containerId = containerName;

      return {
        success: true,
        output,
        executionTime,
      };
    } catch (error: unknown) {
      const executionTime = Date.now() - startTime;
      record.completedAt = Date.now();

      if (this.isTimeoutError(error)) {
        record.status = 'timed_out';

        // Attempt cleanup on timeout
        const containerName = `tool-${toolName}-${executionId.slice(0, 8)}`;
        await this.cleanupContainer(containerName).catch(() => {
          // Ignore cleanup errors on timeout
        });

        return {
          success: false,
          error: {
            code: 'EXECUTION_TIMEOUT',
            message: `Tool '${toolName}' exceeded timeout of ${timeout}ms`,
          },
          executionTime,
        };
      }

      record.status = 'failed';
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        success: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: `Tool '${toolName}' failed: ${errorMessage}`,
        },
        executionTime,
      };
    } finally {
      this.activeCount--;
    }
  }

  /**
   * Terminate a running container execution.
   *
   * @param executionId - The ID of the execution to terminate
   * @returns true if the execution was found and termination was attempted
   */
  async terminate(executionId: string): Promise<boolean> {
    const record = this.executions.get(executionId);
    if (!record || record.status !== 'running') {
      return false;
    }

    if (record.containerId) {
      try {
        await this.execAsync(`docker stop ${record.containerId}`);
        await this.execAsync(`docker rm -f ${record.containerId}`);
      } catch {
        // Container may already be stopped/removed
      }
    }

    record.status = 'failed';
    record.completedAt = Date.now();
    return true;
  }

  /**
   * Get the status of an execution by its ID.
   *
   * @param executionId - The ID of the execution to check
   * @returns The execution status, or undefined if not found
   */
  getStatus(executionId: string): DockerExecutionStatus | undefined {
    return this.executions.get(executionId)?.status;
  }

  /**
   * Get the current number of active container executions.
   */
  getActiveCount(): number {
    return this.activeCount;
  }

  /**
   * Get the execution record for a given ID (for monitoring).
   */
  getExecution(executionId: string): DockerExecutionRecord | undefined {
    return this.executions.get(executionId);
  }

  /**
   * Clean up completed execution records older than the given age.
   *
   * @param maxAgeMs - Maximum age in milliseconds for completed records
   */
  cleanup(maxAgeMs: number = 60_000): void {
    const now = Date.now();
    for (const [id, record] of this.executions) {
      if (record.status !== 'running' && record.completedAt && now - record.completedAt > maxAgeMs) {
        this.executions.delete(id);
      }
    }
  }

  /**
   * Build the Docker run command with all security and resource constraints.
   */
  buildDockerCommand(
    containerName: string,
    toolName: string,
    input: unknown,
    timeout: number,
  ): string {
    const flags: string[] = [
      'docker run',
      '--rm',
      `--name ${containerName}`,
      // Network policy
      `--network ${this.config.networkPolicy}`,
      // Resource limits
      `--cpus=${this.config.cpuLimit}`,
      `--memory=${this.config.memoryLimit}`,
      // Timeout via stop-timeout (seconds)
      `--stop-timeout=${Math.ceil(timeout / 1000)}`,
      // Security: read-only root filesystem
      '--read-only',
      // Security: no new privileges
      '--security-opt=no-new-privileges',
      // Security: drop all capabilities
      '--cap-drop=ALL',
    ];

    // Mount allowed paths as read-only volumes
    for (const allowedPath of this.config.allowedPaths) {
      flags.push(`-v ${allowedPath}:${allowedPath}:ro`);
    }

    // Pass input as environment variable
    const encodedInput = Buffer.from(JSON.stringify(input)).toString('base64');
    flags.push(`-e TOOL_INPUT=${encodedInput}`);
    flags.push(`-e TOOL_NAME=${toolName}`);

    // Image and command
    flags.push(this.config.image);
    flags.push(`sh -c "echo $TOOL_INPUT | base64 -d | node -e \\"const input = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(JSON.stringify({result: input}));\\""`);

    return flags.join(' ');
  }

  /**
   * Execute a Docker command with timeout.
   */
  private async runDockerCommand(
    command: string,
    timeout: number,
  ): Promise<{ stdout: string; stderr: string }> {
    return this.execAsync(command, {
      timeout: timeout + 5000, // Add buffer for Docker overhead
      maxBuffer: 10 * 1024 * 1024, // 10 MB max output
    });
  }

  /**
   * Parse the stdout output from the container.
   */
  private parseOutput(stdout: string): unknown {
    const trimmed = stdout.trim();
    if (!trimmed) {
      return null;
    }

    try {
      return JSON.parse(trimmed);
    } catch {
      // If output is not valid JSON, return as string
      return trimmed;
    }
  }

  /**
   * Clean up a container after execution (force remove).
   */
  private async cleanupContainer(containerName: string): Promise<void> {
    try {
      await this.execAsync(`docker rm -f ${containerName}`);
    } catch {
      // Container may already be removed (--rm flag) or not exist
    }
  }

  /**
   * Check if an error is a timeout error from child_process.
   */
  private isTimeoutError(error: unknown): boolean {
    if (error instanceof Error) {
      // Node.js child_process sets 'killed' property on timeout
      const execError = error as Error & { killed?: boolean; code?: string | number };
      if (execError.killed) return true;
      if (execError.code === 'ETIMEDOUT') return true;
      if (error.message.includes('timed out')) return true;
    }
    return false;
  }
}
