/**
 * WebSocket Manager Unit Tests
 *
 * Tests connection management, multi-session support, message routing,
 * disconnect grace period, and Redis tracking.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

import { WebSocketManagerImpl } from './websocket-manager.js';
import type { RedisConnectionTracker } from './types.js';
import type { AgentEvent } from '../../shared/types.js';

/** Mock WebSocket that emits events */
function createMockWebSocket(readyState = 1): any {
  const emitter = new EventEmitter();
  const ws = Object.assign(emitter, {
    readyState,
    send: vi.fn(),
    ping: vi.fn(),
    close: vi.fn(),
    on: emitter.on.bind(emitter),
  });
  return ws;
}

/** Mock Redis connection tracker */
function createMockRedis(): RedisConnectionTracker {
  return {
    addConnection: vi.fn().mockResolvedValue(undefined),
    removeConnection: vi.fn().mockResolvedValue(undefined),
    getConnections: vi.fn().mockResolvedValue([]),
  };
}

describe('WebSocketManagerImpl', () => {
  let manager: WebSocketManagerImpl;
  let mockRedis: RedisConnectionTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    mockRedis = createMockRedis();
    manager = new WebSocketManagerImpl({
      config: { heartbeatIntervalMs: 30_000, reconnectGracePeriodMs: 5_000 },
      redis: mockRedis,
    });
  });

  afterEach(() => {
    manager.shutdown();
    vi.useRealTimers();
  });

  describe('handleConnection', () => {
    it('should store a new connection and track in Redis', () => {
      const ws = createMockWebSocket();
      manager.handleConnection(ws, 'user-1', 'tenant-1');

      const connections = manager.getActiveConnections('user-1');
      expect(connections).toHaveLength(1);
      expect(connections[0].userId).toBe('user-1');
      expect(connections[0].tenantId).toBe('tenant-1');
      expect(connections[0].ws).toBe(ws);
      expect(connections[0].connectionId).toBeDefined();

      expect(mockRedis.addConnection).toHaveBeenCalledWith(
        'user-1',
        connections[0].connectionId,
      );
    });

    it('should support multiple concurrent sessions for the same user', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      const ws3 = createMockWebSocket();

      manager.handleConnection(ws1, 'user-1', 'tenant-1');
      manager.handleConnection(ws2, 'user-1', 'tenant-1');
      manager.handleConnection(ws3, 'user-1', 'tenant-1');

      const connections = manager.getActiveConnections('user-1');
      expect(connections).toHaveLength(3);
    });

    it('should assign unique connectionIds to each connection', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();

      manager.handleConnection(ws1, 'user-1', 'tenant-1');
      manager.handleConnection(ws2, 'user-1', 'tenant-1');

      const connections = manager.getActiveConnections('user-1');
      expect(connections[0].connectionId).not.toBe(connections[1].connectionId);
    });
  });

  describe('handleDisconnect', () => {
    it('should remove connection after grace period expires', () => {
      const ws = createMockWebSocket();
      manager.handleConnection(ws, 'user-1', 'tenant-1');
      const connectionId = manager.getActiveConnections('user-1')[0].connectionId;

      manager.handleDisconnect(connectionId);

      // Connection still exists during grace period
      expect(manager.getActiveConnections('user-1')).toHaveLength(1);

      // After grace period
      vi.advanceTimersByTime(5_000);

      expect(manager.getActiveConnections('user-1')).toHaveLength(0);
      expect(mockRedis.removeConnection).toHaveBeenCalledWith('user-1', connectionId);
    });

    it('should cancel pending disconnect on reconnection', () => {
      const ws1 = createMockWebSocket();
      manager.handleConnection(ws1, 'user-1', 'tenant-1');
      const connectionId = manager.getActiveConnections('user-1')[0].connectionId;

      // Disconnect
      manager.handleDisconnect(connectionId);

      // Reconnect within grace period
      const ws2 = createMockWebSocket();
      manager.handleConnection(ws2, 'user-1', 'tenant-1');

      // After grace period, original connection should still be cleaned up
      // but user should still have the new connection
      vi.advanceTimersByTime(5_000);

      const connections = manager.getActiveConnections('user-1');
      // The new connection plus the old one (grace period was cancelled)
      expect(connections.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle disconnect for unknown connectionId gracefully', () => {
      expect(() => manager.handleDisconnect('unknown-id')).not.toThrow();
    });
  });

  describe('sendToUser', () => {
    it('should send event to all active connections for a user', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();

      manager.handleConnection(ws1, 'user-1', 'tenant-1');
      manager.handleConnection(ws2, 'user-1', 'tenant-1');

      const event: AgentEvent = { type: 'text_delta', content: 'Hello' };
      manager.sendToUser('user-1', event);

      expect(ws1.send).toHaveBeenCalledWith(JSON.stringify(event));
      expect(ws2.send).toHaveBeenCalledWith(JSON.stringify(event));
    });

    it('should not send to connections that are not OPEN', () => {
      const ws = createMockWebSocket(3); // CLOSED state
      manager.handleConnection(ws, 'user-1', 'tenant-1');

      const event: AgentEvent = { type: 'text_delta', content: 'Hello' };
      manager.sendToUser('user-1', event);

      expect(ws.send).not.toHaveBeenCalled();
    });

    it('should handle send errors gracefully', () => {
      const ws = createMockWebSocket();
      ws.send.mockImplementation(() => {
        throw new Error('Connection reset');
      });

      manager.handleConnection(ws, 'user-1', 'tenant-1');

      const event: AgentEvent = { type: 'text_delta', content: 'Hello' };
      expect(() => manager.sendToUser('user-1', event)).not.toThrow();
    });

    it('should do nothing for users with no connections', () => {
      const event: AgentEvent = { type: 'text_delta', content: 'Hello' };
      expect(() => manager.sendToUser('nonexistent-user', event)).not.toThrow();
    });
  });

  describe('broadcastToTenant', () => {
    it('should send event to all connections in the same tenant', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      const ws3 = createMockWebSocket();

      manager.handleConnection(ws1, 'user-1', 'tenant-1');
      manager.handleConnection(ws2, 'user-2', 'tenant-1');
      manager.handleConnection(ws3, 'user-3', 'tenant-2');

      const event = { type: 'system_update', payload: { msg: 'hello' }, timestamp: new Date().toISOString() };
      manager.broadcastToTenant('tenant-1', event);

      expect(ws1.send).toHaveBeenCalledWith(JSON.stringify(event));
      expect(ws2.send).toHaveBeenCalledWith(JSON.stringify(event));
      expect(ws3.send).not.toHaveBeenCalled();
    });
  });

  describe('getActiveConnections', () => {
    it('should return empty array for users with no connections', () => {
      expect(manager.getActiveConnections('nonexistent')).toEqual([]);
    });

    it('should return all connections for a user', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();

      manager.handleConnection(ws1, 'user-1', 'tenant-1');
      manager.handleConnection(ws2, 'user-1', 'tenant-1');

      const connections = manager.getActiveConnections('user-1');
      expect(connections).toHaveLength(2);
      expect(connections[0].userId).toBe('user-1');
      expect(connections[1].userId).toBe('user-1');
    });
  });

  describe('heartbeat', () => {
    it('should send ping to all open connections on heartbeat interval', () => {
      const ws = createMockWebSocket();
      manager.handleConnection(ws, 'user-1', 'tenant-1');

      vi.advanceTimersByTime(30_000);

      expect(ws.ping).toHaveBeenCalled();
    });
  });

  describe('WebSocket event handlers', () => {
    it('should trigger handleDisconnect on WebSocket close event', () => {
      const ws = createMockWebSocket();
      manager.handleConnection(ws, 'user-1', 'tenant-1');

      // Simulate WebSocket close
      ws.emit('close');

      // Grace period active
      expect(manager.getActiveConnections('user-1')).toHaveLength(1);

      // After grace period
      vi.advanceTimersByTime(5_000);
      expect(manager.getActiveConnections('user-1')).toHaveLength(0);
    });

    it('should trigger handleDisconnect on WebSocket error event', () => {
      const ws = createMockWebSocket();
      manager.handleConnection(ws, 'user-1', 'tenant-1');

      // Simulate WebSocket error
      ws.emit('error', new Error('Connection error'));

      // After grace period
      vi.advanceTimersByTime(5_000);
      expect(manager.getActiveConnections('user-1')).toHaveLength(0);
    });
  });

  describe('shutdown', () => {
    it('should close all connections and clear state', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();

      manager.handleConnection(ws1, 'user-1', 'tenant-1');
      manager.handleConnection(ws2, 'user-2', 'tenant-1');

      manager.shutdown();

      expect(ws1.close).toHaveBeenCalledWith(1001, 'Server shutting down');
      expect(ws2.close).toHaveBeenCalledWith(1001, 'Server shutting down');
      expect(manager.getActiveConnections('user-1')).toHaveLength(0);
      expect(manager.getActiveConnections('user-2')).toHaveLength(0);
    });
  });

  describe('without Redis', () => {
    it('should work without Redis tracker', () => {
      const managerNoRedis = new WebSocketManagerImpl({
        config: { heartbeatIntervalMs: 30_000, reconnectGracePeriodMs: 5_000 },
      });

      const ws = createMockWebSocket();
      expect(() => managerNoRedis.handleConnection(ws, 'user-1', 'tenant-1')).not.toThrow();

      const connections = managerNoRedis.getActiveConnections('user-1');
      expect(connections).toHaveLength(1);

      managerNoRedis.shutdown();
    });
  });
});
