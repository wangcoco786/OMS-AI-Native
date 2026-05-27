/**
 * Real-time Communication Type Definitions
 *
 * Interfaces for WebSocket connection management and SSE streaming.
 */

import type { Response } from 'express';
import type WebSocket from 'ws';
import type { AgentEvent } from '../../shared/types.js';

/** Information about an active WebSocket connection */
export interface ConnectionInfo {
  connectionId: string;
  userId: string;
  tenantId: string;
  ws: WebSocket;
  connectedAt: Date;
}

/** System-level events broadcast to tenants */
export interface SystemEvent {
  type: string;
  payload: unknown;
  timestamp: string;
}

/** WebSocket Manager interface for managing real-time connections */
export interface WebSocketManager {
  /** Handle a new WebSocket connection */
  handleConnection(ws: WebSocket, userId: string, tenantId: string): void;
  /** Handle a connection disconnect */
  handleDisconnect(connectionId: string): void;
  /** Send an event to all active connections for a user */
  sendToUser(userId: string, event: AgentEvent): void;
  /** Broadcast an event to all connections in a tenant */
  broadcastToTenant(tenantId: string, event: SystemEvent): void;
  /** Get all active connections for a user */
  getActiveConnections(userId: string): ConnectionInfo[];
}

/** An active SSE stream handle */
export interface SSEStream {
  streamId: string;
  sessionId: string;
  res: Response;
  createdAt: Date;
  lastActivityAt: Date;
}

/** SSE Manager interface for managing server-sent event streams */
export interface SSEManager {
  /** Create a new SSE stream for a session */
  createStream(res: Response, sessionId: string): SSEStream;
  /** Push an event to an SSE stream */
  pushEvent(stream: SSEStream, event: AgentEvent): void;
  /** Close an SSE stream */
  closeStream(stream: SSEStream): void;
}

/** Configuration for WebSocket Manager */
export interface WebSocketManagerConfig {
  /** Heartbeat interval in milliseconds (default: 30000) */
  heartbeatIntervalMs?: number;
  /** Grace period for reconnection in milliseconds (default: 5000) */
  reconnectGracePeriodMs?: number;
}

/** Configuration for SSE Manager */
export interface SSEManagerConfig {
  /** Idle timeout in milliseconds (default: 30 minutes) */
  idleTimeoutMs?: number;
  /** Heartbeat interval to keep connection alive (default: 15000ms) */
  heartbeatIntervalMs?: number;
}

/** Redis service interface subset needed by WebSocket manager */
export interface RedisConnectionTracker {
  /** Add a connection ID to the user's connection set */
  addConnection(userId: string, connectionId: string): Promise<void>;
  /** Remove a connection ID from the user's connection set */
  removeConnection(userId: string, connectionId: string): Promise<void>;
  /** Get all connection IDs for a user */
  getConnections(userId: string): Promise<string[]>;
}
