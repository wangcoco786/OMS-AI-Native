/**
 * WebSocket Connection Manager Implementation
 *
 * Provides:
 * - Multi-session support per user (Map<userId, Set<ConnectionInfo>>)
 * - Unique connectionId (UUID) per connection
 * - Redis-backed active connection tracking (user:{userId}:connections)
 * - Graceful reconnection handling (5s grace period)
 * - Heartbeat/ping-pong for connection health
 * - Broadcast to tenant (all connections)
 */

import type WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';

import type { AgentEvent } from '../../shared/types.js';
import type {
  ConnectionInfo,
  SystemEvent,
  WebSocketManager as IWebSocketManager,
  WebSocketManagerConfig,
  RedisConnectionTracker,
} from './types.js';

/** Default configuration values */
const DEFAULTS: Required<WebSocketManagerConfig> = {
  heartbeatIntervalMs: 30_000,
  reconnectGracePeriodMs: 5_000,
};

/**
 * WebSocketManagerImpl manages WebSocket connections for real-time
 * communication between users and the agent system.
 *
 * Supports multiple concurrent sessions per user and tracks active
 * connections in Redis for distributed awareness.
 */
export class WebSocketManagerImpl implements IWebSocketManager {
  /** Map of userId -> Set of active connections */
  private readonly connections: Map<string, Map<string, ConnectionInfo>> = new Map();
  /** Map of connectionId -> userId for reverse lookup */
  private readonly connectionToUser: Map<string, string> = new Map();
  /** Pending disconnections awaiting grace period expiry */
  private readonly pendingDisconnects: Map<string, NodeJS.Timeout> = new Map();
  /** Heartbeat interval handle */
  private heartbeatInterval: NodeJS.Timeout | null = null;

  private readonly config: Required<WebSocketManagerConfig>;
  private readonly logger: pino.Logger;
  private readonly redis: RedisConnectionTracker | null;

  constructor(options?: {
    config?: WebSocketManagerConfig;
    redis?: RedisConnectionTracker;
    logger?: pino.Logger;
  }) {
    this.config = { ...DEFAULTS, ...options?.config };
    this.redis = options?.redis ?? null;
    this.logger = (options?.logger ?? pino({ name: 'realtime' })).child({
      component: 'websocket-manager',
    });

    this.startHeartbeat();
  }

  /**
   * Handle a new WebSocket connection.
   * Assigns a unique connectionId, stores the connection, and tracks in Redis.
   */
  handleConnection(ws: WebSocket, userId: string, tenantId: string): void {
    const connectionId = uuidv4();

    const connectionInfo: ConnectionInfo = {
      connectionId,
      userId,
      tenantId,
      ws,
      connectedAt: new Date(),
    };

    // Cancel any pending disconnect grace period for this user
    // (handles reconnection within grace period)
    this.cancelPendingDisconnectsForUser(userId);

    // Store connection
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Map());
    }
    this.connections.get(userId)!.set(connectionId, connectionInfo);
    this.connectionToUser.set(connectionId, userId);

    // Track in Redis (fire and forget, log errors)
    this.trackConnectionInRedis(userId, connectionId);

    // Set up WebSocket event handlers
    this.setupWebSocketHandlers(ws, connectionId);

    this.logger.info({ connectionId, userId, tenantId }, 'WebSocket connection established');
  }

  /**
   * Handle a connection disconnect.
   * Starts a grace period before fully removing the connection,
   * allowing the client to reconnect within 5 seconds.
   */
  handleDisconnect(connectionId: string): void {
    const userId = this.connectionToUser.get(connectionId);
    if (!userId) {
      this.logger.warn({ connectionId }, 'Disconnect for unknown connection');
      return;
    }

    // Start grace period timer
    const timeout = setTimeout(() => {
      this.finalizeDisconnect(connectionId, userId);
      this.pendingDisconnects.delete(connectionId);
    }, this.config.reconnectGracePeriodMs);

    this.pendingDisconnects.set(connectionId, timeout);

    this.logger.debug(
      { connectionId, userId, gracePeriodMs: this.config.reconnectGracePeriodMs },
      'Disconnect grace period started',
    );
  }

  /**
   * Send an event to all active connections for a user.
   */
  sendToUser(userId: string, event: AgentEvent): void {
    const userConnections = this.connections.get(userId);
    if (!userConnections || userConnections.size === 0) {
      this.logger.debug({ userId }, 'No active connections for user');
      return;
    }

    const payload = JSON.stringify(event);

    for (const [connectionId, info] of userConnections) {
      try {
        if (info.ws.readyState === 1 /* WebSocket.OPEN */) {
          info.ws.send(payload);
        }
      } catch (error) {
        this.logger.error({ error, connectionId, userId }, 'Failed to send message to connection');
      }
    }
  }

  /**
   * Broadcast an event to all connections in a tenant.
   */
  broadcastToTenant(tenantId: string, event: SystemEvent): void {
    const payload = JSON.stringify(event);

    for (const [, userConnections] of this.connections) {
      for (const [connectionId, info] of userConnections) {
        if (info.tenantId === tenantId) {
          try {
            if (info.ws.readyState === 1 /* WebSocket.OPEN */) {
              info.ws.send(payload);
            }
          } catch (error) {
            this.logger.error(
              { error, connectionId, tenantId },
              'Failed to broadcast to connection',
            );
          }
        }
      }
    }
  }

  /**
   * Get all active connections for a user.
   */
  getActiveConnections(userId: string): ConnectionInfo[] {
    const userConnections = this.connections.get(userId);
    if (!userConnections) {
      return [];
    }
    return Array.from(userConnections.values());
  }

  /**
   * Get total number of active connections across all users.
   */
  getTotalConnectionCount(): number {
    let count = 0;
    for (const [, userConnections] of this.connections) {
      count += userConnections.size;
    }
    return count;
  }

  /**
   * Gracefully shut down the manager, closing all connections.
   */
  shutdown(): void {
    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Clear pending disconnects
    for (const [, timeout] of this.pendingDisconnects) {
      clearTimeout(timeout);
    }
    this.pendingDisconnects.clear();

    // Close all connections
    for (const [, userConnections] of this.connections) {
      for (const [, info] of userConnections) {
        try {
          info.ws.close(1001, 'Server shutting down');
        } catch {
          // Ignore close errors during shutdown
        }
      }
    }

    this.connections.clear();
    this.connectionToUser.clear();

    this.logger.info('WebSocket manager shut down');
  }

  // --- Private Methods ---

  /**
   * Set up event handlers on a WebSocket connection.
   */
  private setupWebSocketHandlers(ws: WebSocket, connectionId: string): void {
    ws.on('close', () => {
      this.handleDisconnect(connectionId);
    });

    ws.on('error', (error) => {
      this.logger.error({ error, connectionId }, 'WebSocket error');
      this.handleDisconnect(connectionId);
    });

    ws.on('pong', () => {
      // Connection is alive - no action needed
      this.logger.trace({ connectionId }, 'Pong received');
    });
  }

  /**
   * Finalize a disconnect after the grace period expires.
   */
  private finalizeDisconnect(connectionId: string, userId: string): void {
    const userConnections = this.connections.get(userId);
    if (userConnections) {
      userConnections.delete(connectionId);
      if (userConnections.size === 0) {
        this.connections.delete(userId);
      }
    }
    this.connectionToUser.delete(connectionId);

    // Remove from Redis
    this.untrackConnectionInRedis(userId, connectionId);

    this.logger.info({ connectionId, userId }, 'Connection fully disconnected');
  }

  /**
   * Cancel pending disconnect timers for a user (on reconnection).
   */
  private cancelPendingDisconnectsForUser(userId: string): void {
    for (const [connectionId, timeout] of this.pendingDisconnects) {
      if (this.connectionToUser.get(connectionId) === userId) {
        clearTimeout(timeout);
        this.pendingDisconnects.delete(connectionId);
        this.logger.debug({ connectionId, userId }, 'Pending disconnect cancelled (reconnection)');
      }
    }
  }

  /**
   * Track a connection in Redis.
   */
  private trackConnectionInRedis(userId: string, connectionId: string): void {
    if (!this.redis) return;
    this.redis.addConnection(userId, connectionId).catch((error) => {
      this.logger.error({ error, userId, connectionId }, 'Failed to track connection in Redis');
    });
  }

  /**
   * Remove a connection from Redis tracking.
   */
  private untrackConnectionInRedis(userId: string, connectionId: string): void {
    if (!this.redis) return;
    this.redis.removeConnection(userId, connectionId).catch((error) => {
      this.logger.error(
        { error, userId, connectionId },
        'Failed to untrack connection in Redis',
      );
    });
  }

  /**
   * Start the heartbeat interval to detect dead connections.
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const [, userConnections] of this.connections) {
        for (const [connectionId, info] of userConnections) {
          if (info.ws.readyState === 1 /* WebSocket.OPEN */) {
            try {
              info.ws.ping();
            } catch (error) {
              this.logger.error({ error, connectionId }, 'Failed to send ping');
            }
          }
        }
      }
    }, this.config.heartbeatIntervalMs);

    // Allow the process to exit even if the interval is running
    if (this.heartbeatInterval.unref) {
      this.heartbeatInterval.unref();
    }
  }
}
