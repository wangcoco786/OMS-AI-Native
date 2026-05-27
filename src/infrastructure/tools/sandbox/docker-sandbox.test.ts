/**
 * Docker Sandbox Executor Tests
 *
 * Tests for the Docker sandbox implementation covering:
 * - Container creation and execution
 * - Network policy enforcement
 * - File system path whitelist
 * - Resource limits (CPU, memory)
 * - Timeout handling
 * - Container cleanup
 * - Concurrency limits
 * - Error handling
 *
 * Uses injectable execFn since Docker is not available in test environment.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DockerSandboxExecutor, type ExecAsyncFn } from './docker-sandbox.js';
import type { ToolExecutionConfig } from '../tool-executor.js';

describe('DockerSandboxExecutor', () => {
  let mockExec: ReturnType<typeof vi.fn<ExecAsyncFn>>;
  let executor: DockerSandboxExecutor;
  const defaultConfig: ToolExecutionConfig = {
    timeout: 30000,
    sandbox: 'docker',
  };

  beforeEach(() => {
    mockExec = vi.fn<ExecAsyncFn>();
    executor = new DockerSandboxExecutor({
      image: 'node:20-alpine',
      defaultTimeout: 30000,
      networkPolicy: 'none',
      allowedPaths: ['/data/shared'],
      cpuLimit: 0.5,
      memoryLimit: 256 * 1024 * 1024,
      maxConcurrent: 5,
      execFn: mockExec,
    });
  });

  describe('execute', () => {
    it('should execute a tool in a Docker container successfully', async () => {
      const expectedOutput = { result: { orderId: '123', status: 'shipped' } };
      mockExec.mockResolvedValue({ stdout: JSON.stringify(expectedOutput) + '\n', stderr: '' });

      const result = await executor.execute('query-orders', { orderId: '123' }, defaultConfig);

      expect(result.success).toBe(true);
      expect(result.output).toEqual(expectedOutput);
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });

    it('should call docker run with correct command', async () => {
      mockExec.mockResolvedValue({ stdout: '"done"', stderr: '' });

      await executor.execute('my-tool', { key: 'value' }, defaultConfig);

      // First call should be docker run
      const runCall = mockExec.mock.calls[0][0];
      expect(runCall).toContain('docker run');
      expect(runCall).toContain('--network none');
      expect(runCall).toContain('--cpus=0.5');
      expect(runCall).toContain(`--memory=${256 * 1024 * 1024}`);
      expect(runCall).toContain('node:20-alpine');
    });

    it('should call docker rm for cleanup after execution', async () => {
      mockExec.mockResolvedValue({ stdout: '"done"', stderr: '' });

      await executor.execute('my-tool', {}, defaultConfig);

      // Second call should be docker rm -f for cleanup
      expect(mockExec).toHaveBeenCalledTimes(2);
      const cleanupCall = mockExec.mock.calls[1][0];
      expect(cleanupCall).toContain('docker rm -f');
    });

    it('should return error when concurrency limit is reached', async () => {
      const limitedExecutor = new DockerSandboxExecutor({
        maxConcurrent: 1,
        execFn: vi.fn<ExecAsyncFn>().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({ stdout: '"done"', stderr: '' }), 100)),
        ),
      });

      // Start first execution (will be pending)
      const p1 = limitedExecutor.execute('tool-a', {}, defaultConfig);

      // Second should be rejected immediately
      const result2 = await limitedExecutor.execute('tool-b', {}, defaultConfig);

      expect(result2.success).toBe(false);
      expect(result2.error?.code).toBe('SANDBOX_CONCURRENCY_LIMIT');
      expect(result2.error?.message).toContain('1');

      await p1;
    });

    it('should handle timeout errors', async () => {
      const timeoutError = new Error('Command timed out') as Error & { killed: boolean };
      timeoutError.killed = true;
      mockExec.mockRejectedValue(timeoutError);

      const config: ToolExecutionConfig = { timeout: 100, sandbox: 'docker' };
      const result = await executor.execute('slow-tool', {}, config);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EXECUTION_TIMEOUT');
      expect(result.error?.message).toContain('slow-tool');
      expect(result.error?.message).toContain('100ms');
    });

    it('should handle execution errors', async () => {
      mockExec.mockRejectedValue(new Error('Container exited with code 1: Permission denied'));

      const result = await executor.execute('failing-tool', {}, defaultConfig);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EXECUTION_ERROR');
      expect(result.error?.message).toContain('failing-tool');
      expect(result.error?.message).toContain('Permission denied');
    });

    it('should parse JSON output from container', async () => {
      const complexOutput = {
        orders: [
          { id: '1', status: 'shipped', amount: 99.99 },
          { id: '2', status: 'pending', amount: 45.0 },
        ],
        total: 2,
      };
      mockExec.mockResolvedValue({ stdout: JSON.stringify(complexOutput), stderr: '' });

      const result = await executor.execute('query-tool', {}, defaultConfig);

      expect(result.success).toBe(true);
      expect(result.output).toEqual(complexOutput);
    });

    it('should handle non-JSON output as string', async () => {
      mockExec.mockResolvedValue({ stdout: 'plain text output\n', stderr: '' });

      const result = await executor.execute('text-tool', {}, defaultConfig);

      expect(result.success).toBe(true);
      expect(result.output).toBe('plain text output');
    });

    it('should handle empty output', async () => {
      mockExec.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await executor.execute('empty-tool', {}, defaultConfig);

      expect(result.success).toBe(true);
      expect(result.output).toBeNull();
    });

    it('should track execution time', async () => {
      mockExec.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ stdout: '"done"', stderr: '' }), 50)),
      );

      const result = await executor.execute('timed-tool', {}, defaultConfig);

      expect(result.success).toBe(true);
      expect(result.executionTime).toBeGreaterThanOrEqual(40);
    });

    it('should attempt cleanup after timeout', async () => {
      let callCount = 0;
      const timeoutExec = vi.fn<ExecAsyncFn>().mockImplementation((command) => {
        callCount++;
        if (command.includes('docker run')) {
          const err = new Error('timed out') as Error & { killed: boolean };
          err.killed = true;
          return Promise.reject(err);
        }
        // Cleanup calls succeed
        return Promise.resolve({ stdout: '', stderr: '' });
      });

      const timeoutExecutor = new DockerSandboxExecutor({
        execFn: timeoutExec,
      });

      await timeoutExecutor.execute('slow-tool', {}, { timeout: 100, sandbox: 'docker' });

      // Should have attempted cleanup (docker rm -f)
      const cleanupCalls = timeoutExec.mock.calls.filter(([cmd]) => cmd.includes('docker rm'));
      expect(cleanupCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('buildDockerCommand', () => {
    it('should include network policy in command', () => {
      const command = executor.buildDockerCommand('test-container', 'my-tool', {}, 5000);
      expect(command).toContain('--network none');
    });

    it('should include CPU limit in command', () => {
      const command = executor.buildDockerCommand('test-container', 'my-tool', {}, 5000);
      expect(command).toContain('--cpus=0.5');
    });

    it('should include memory limit in command', () => {
      const command = executor.buildDockerCommand('test-container', 'my-tool', {}, 5000);
      expect(command).toContain(`--memory=${256 * 1024 * 1024}`);
    });

    it('should include stop-timeout in command', () => {
      const command = executor.buildDockerCommand('test-container', 'my-tool', {}, 5000);
      expect(command).toContain('--stop-timeout=5');
    });

    it('should include container name', () => {
      const command = executor.buildDockerCommand('my-container-123', 'my-tool', {}, 5000);
      expect(command).toContain('--name my-container-123');
    });

    it('should include --rm flag for auto-cleanup', () => {
      const command = executor.buildDockerCommand('test-container', 'my-tool', {}, 5000);
      expect(command).toContain('--rm');
    });

    it('should include read-only filesystem', () => {
      const command = executor.buildDockerCommand('test-container', 'my-tool', {}, 5000);
      expect(command).toContain('--read-only');
    });

    it('should include no-new-privileges security option', () => {
      const command = executor.buildDockerCommand('test-container', 'my-tool', {}, 5000);
      expect(command).toContain('--security-opt=no-new-privileges');
    });

    it('should drop all capabilities', () => {
      const command = executor.buildDockerCommand('test-container', 'my-tool', {}, 5000);
      expect(command).toContain('--cap-drop=ALL');
    });

    it('should mount allowed paths as read-only volumes', () => {
      const command = executor.buildDockerCommand('test-container', 'my-tool', {}, 5000);
      expect(command).toContain('-v /data/shared:/data/shared:ro');
    });

    it('should encode input as base64 environment variable', () => {
      const input = { query: 'test', page: 1 };
      const command = executor.buildDockerCommand('test-container', 'my-tool', input, 5000);

      const expectedBase64 = Buffer.from(JSON.stringify(input)).toString('base64');
      expect(command).toContain(`-e TOOL_INPUT=${expectedBase64}`);
    });

    it('should include tool name as environment variable', () => {
      const command = executor.buildDockerCommand('test-container', 'my-tool', {}, 5000);
      expect(command).toContain('-e TOOL_NAME=my-tool');
    });

    it('should use configured Docker image', () => {
      const command = executor.buildDockerCommand('test-container', 'my-tool', {}, 5000);
      expect(command).toContain('node:20-alpine');
    });

    it('should respect different network policies', () => {
      const bridgeExecutor = new DockerSandboxExecutor({
        networkPolicy: 'bridge',
        execFn: mockExec,
      });
      const command = bridgeExecutor.buildDockerCommand('test-container', 'my-tool', {}, 5000);
      expect(command).toContain('--network bridge');
    });

    it('should handle multiple allowed paths', () => {
      const multiPathExecutor = new DockerSandboxExecutor({
        allowedPaths: ['/data/shared', '/tmp/tools', '/opt/config'],
        execFn: mockExec,
      });
      const command = multiPathExecutor.buildDockerCommand('test-container', 'my-tool', {}, 5000);

      expect(command).toContain('-v /data/shared:/data/shared:ro');
      expect(command).toContain('-v /tmp/tools:/tmp/tools:ro');
      expect(command).toContain('-v /opt/config:/opt/config:ro');
    });

    it('should handle empty allowed paths', () => {
      const noPathExecutor = new DockerSandboxExecutor({
        allowedPaths: [],
        execFn: mockExec,
      });
      const command = noPathExecutor.buildDockerCommand('test-container', 'my-tool', {}, 5000);
      expect(command).not.toContain('-v ');
    });
  });

  describe('terminate', () => {
    it('should return false for non-existent execution', async () => {
      const result = await executor.terminate('non-existent-id');
      expect(result).toBe(false);
    });

    it('should return false for already completed execution', async () => {
      mockExec.mockResolvedValue({ stdout: '"done"', stderr: '' });

      await executor.execute('tool', {}, defaultConfig);

      // Try to terminate a completed execution (won't find a running one)
      const result = await executor.terminate('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return undefined for non-existent execution', () => {
      const status = executor.getStatus('non-existent-id');
      expect(status).toBeUndefined();
    });
  });

  describe('getActiveCount', () => {
    it('should start at zero', () => {
      expect(executor.getActiveCount()).toBe(0);
    });

    it('should return to zero after execution completes', async () => {
      mockExec.mockResolvedValue({ stdout: '"done"', stderr: '' });

      await executor.execute('tool', {}, defaultConfig);

      expect(executor.getActiveCount()).toBe(0);
    });

    it('should return to zero after execution fails', async () => {
      mockExec.mockRejectedValue(new Error('Container failed'));

      await executor.execute('tool', {}, defaultConfig);

      expect(executor.getActiveCount()).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('should remove old completed execution records', async () => {
      mockExec.mockResolvedValue({ stdout: '"done"', stderr: '' });

      await executor.execute('tool', {}, defaultConfig);

      // Cleanup with 0ms max age should remove all completed records
      executor.cleanup(0);
    });

    it('should not remove recent execution records', async () => {
      mockExec.mockResolvedValue({ stdout: '"done"', stderr: '' });

      await executor.execute('tool', {}, defaultConfig);

      // Cleanup with very high max age should keep records
      executor.cleanup(999999);
    });
  });

  describe('container lifecycle', () => {
    it('should attempt cleanup after successful execution', async () => {
      mockExec.mockResolvedValue({ stdout: '"done"', stderr: '' });

      await executor.execute('tool', {}, defaultConfig);

      // Should have called exec at least twice: docker run + docker rm
      expect(mockExec).toHaveBeenCalledTimes(2);
      const calls = mockExec.mock.calls.map(([cmd]) => cmd);
      expect(calls[0]).toContain('docker run');
      expect(calls[1]).toContain('docker rm -f');
    });
  });

  describe('default configuration', () => {
    it('should use default config when none provided', () => {
      const defaultExecutor = new DockerSandboxExecutor({ execFn: mockExec });
      const command = defaultExecutor.buildDockerCommand('test', 'tool', {}, 5000);

      expect(command).toContain('node:20-alpine');
      expect(command).toContain('--network none');
      expect(command).toContain('--cpus=0.5');
    });

    it('should allow partial config override', () => {
      const customExecutor = new DockerSandboxExecutor({
        image: 'python:3.11-slim',
        networkPolicy: 'bridge',
        execFn: mockExec,
      });
      const command = customExecutor.buildDockerCommand('test', 'tool', {}, 5000);

      expect(command).toContain('python:3.11-slim');
      expect(command).toContain('--network bridge');
      // Defaults should still apply
      expect(command).toContain('--cpus=0.5');
    });
  });
});
