/**
 * SSE (Server-Sent Events) Manager Implementation
 *
 * Provides:
 * - SSE stream creation with proper headers
 * - Event pushing in SSE format (event: {type}\ndata: {json}\n\n)
 * - Stream lifecycle management
 * - Idle timeout (30 minutes) with automatic stream closure
 * - Heartbeat comments to keep connections alive
 */

import type { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';

import type { AgentEvent } from '../../shared/types.js';
import type { SSEStream, SSEManager as ISSEManager, SSEManagerConfig } from './types.js';

/** Default configuration values */
const DEFAULTS: Required<SSEManagerConfig> = {
  idleTimeoutMs: 30 * 60 * 1000, // 30 minutes
  heartbeatIntervalMs: 15_000, // 15 seconds
};

/**
 * SSEManagerImpl manages Server-Sent Event streams for real-time
 * streaming of Agent responses to clients.
 *
 * Each stream is associated with a session and automatically closes
 * after 30 minutes of inactivity.
 */
export class SSEManagerImpl implements ISSEManager {
  /** Map of streamId -> SSEStream for active streams */
  private readonly streams: Map<string, SSEStream> = new Map();
  /** Map of streamId -> idle timeout handle */
  private readonly idleTimers: Map<string, NodeJS.Timeout> = new Map();
  /** Map of streamId -> heartbeat interval handle */
  private readonly heartbeatTimers: Map<string, NodeJS.Timeout> = new Map();

  private readonly config: Required<SSEManagerConfig>;
  private readonly logger: pino.Logger;

  constructor(options?: { config?: SSEManagerConfig; logger?: pino.Logger }) {
    this.config = { ...DEFAULTS, ...options?.config };
    this.logger = (options?.logger ?? pino({ name: 'realtime' })).child({
      component: 'sse-manager',
    });
  }

  /**
   * Create a new SSE stream for a session.
   * Sets appropriate headers on the response and returns a stream handle.
   */
  createStream(res: Response, sessionId: string): SSEStream {
    const streamId = uuidv4();
    const now = new Date();

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Flush headers immediately
    res.flushHeaders();

    const stream: SSEStream = {
      streamId,
      sessionId,
      res,
      createdAt: now,
      lastActivityAt: now,
    };

    this.streams.set(streamId, stream);

    // Set up idle timeout
    this.resetIdleTimer(stream);

    // Set up heartbeat to keep connection alive
    this.startHeartbeat(stream);

    // Handle client disconnect
    res.on('close', () => {
      this.cleanupStream(streamId);
      this.logger.debug({ streamId, sessionId }, 'SSE stream closed by client');
    });

    this.logger.info({ streamId, sessionId }, 'SSE stream created');

    return stream;
  }

  /**
   * Push an event to an SSE stream.
   * Formats the event in SSE protocol format:
   *   event: {type}
   *   data: {json}
   *
   */
  pushEvent(stream: SSEStream, event: AgentEvent): void {
    if (!this.streams.has(stream.streamId)) {
      this.logger.warn({ streamId: stream.streamId }, 'Attempted to push to closed stream');
      return;
    }

    try {
      const eventType = event.type;
      const data = JSON.stringify(event);

      const sseMessage = `event: ${eventType}\ndata: ${data}\n\n`;
      stream.res.write(sseMessage);

      // Update last activity and reset idle timer
      stream.lastActivityAt = new Date();
      this.resetIdleTimer(stream);

      this.logger.trace({ streamId: stream.streamId, eventType }, 'SSE event pushed');
    } catch (error) {
      this.logger.error(
        { error, streamId: stream.streamId },
        'Failed to push SSE event',
      );
      // If write fails, the stream is likely broken - clean up
      this.cleanupStream(stream.streamId);
    }
  }

  /**
   * Close an SSE stream gracefully.
   */
  closeStream(stream: SSEStream): void {
    if (!this.streams.has(stream.streamId)) {
      return;
    }

    try {
      // Send a close event before ending
      stream.res.write(`event: close\ndata: {"reason":"stream_closed"}\n\n`);
      stream.res.end();
    } catch {
      // Ignore errors during close - stream may already be broken
    }

    this.cleanupStream(stream.streamId);
    this.logger.info({ streamId: stream.streamId, sessionId: stream.sessionId }, 'SSE stream closed');
  }

  /**
   * Get the number of active streams.
   */
  getActiveStreamCount(): number {
    return this.streams.size;
  }

  /**
   * Get a stream by its ID.
   */
  getStream(streamId: string): SSEStream | undefined {
    return this.streams.get(streamId);
  }

  /**
   * Gracefully shut down the manager, closing all streams.
   */
  shutdown(): void {
    for (const [streamId] of this.streams) {
      const stream = this.streams.get(streamId);
      if (stream) {
        this.closeStream(stream);
      }
    }
    this.logger.info('SSE manager shut down');
  }

  // --- Private Methods ---

  /**
   * Reset the idle timer for a stream.
   * If no activity occurs within the idle timeout, the stream is closed.
   */
  private resetIdleTimer(stream: SSEStream): void {
    const existing = this.idleTimers.get(stream.streamId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.logger.info(
        { streamId: stream.streamId, sessionId: stream.sessionId },
        'SSE stream idle timeout reached, closing',
      );
      this.closeStream(stream);
    }, this.config.idleTimeoutMs);

    // Allow process to exit
    if (timer.unref) {
      timer.unref();
    }

    this.idleTimers.set(stream.streamId, timer);
  }

  /**
   * Start sending heartbeat comments to keep the connection alive.
   * SSE comment format: ": heartbeat\n\n"
   */
  private startHeartbeat(stream: SSEStream): void {
    const timer = setInterval(() => {
      if (!this.streams.has(stream.streamId)) {
        clearInterval(timer);
        return;
      }

      try {
        stream.res.write(`: heartbeat\n\n`);
      } catch {
        // Stream is broken, clean up
        this.cleanupStream(stream.streamId);
      }
    }, this.config.heartbeatIntervalMs);

    // Allow process to exit
    if (timer.unref) {
      timer.unref();
    }

    this.heartbeatTimers.set(stream.streamId, timer);
  }

  /**
   * Clean up all resources associated with a stream.
   */
  private cleanupStream(streamId: string): void {
    // Clear idle timer
    const idleTimer = this.idleTimers.get(streamId);
    if (idleTimer) {
      clearTimeout(idleTimer);
      this.idleTimers.delete(streamId);
    }

    // Clear heartbeat timer
    const heartbeatTimer = this.heartbeatTimers.get(streamId);
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      this.heartbeatTimers.delete(streamId);
    }

    // Remove from active streams
    this.streams.delete(streamId);
  }
}
