/**
 * Real-time Communication Module
 *
 * Provides WebSocket connection management and SSE streaming
 * for real-time bidirectional communication between users and agents.
 */

export { WebSocketManagerImpl } from './websocket-manager.js';
export { SSEManagerImpl } from './sse-manager.js';
export type {
  ConnectionInfo,
  SystemEvent,
  WebSocketManager,
  SSEStream,
  SSEManager,
  WebSocketManagerConfig,
  SSEManagerConfig,
  RedisConnectionTracker,
} from './types.js';
