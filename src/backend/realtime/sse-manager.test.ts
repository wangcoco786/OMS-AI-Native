/**
 * SSE Manager Unit Tests
 *
 * Tests stream creation, event pushing, idle timeout,
 * heartbeat, and stream closure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

import { SSEManagerImpl } from './sse-manager.js';
import type { AgentEvent } from '../../shared/types.js';

/** Create a mock Express Response object */
function createMockResponse(): any {
  const emitter = new EventEmitter();
  const res = Object.assign(emitter, {
    writeHead: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn().mockReturnValue(true),
    end: vi.fn(),
    on: emitter.on.bind(emitter),
  });
  return res;
}

describe('SSEManagerImpl', () => {
  let manager: SSEManagerImpl;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new SSEManagerImpl({
      config: {
        idleTimeoutMs: 30 * 60 * 1000, // 30 minutes
        heartbeatIntervalMs: 15_000,
      },
    });
  });

  afterEach(() => {
    manager.shutdown();
    vi.useRealTimers();
  });

  describe('createStream', () => {
    it('should set SSE headers on the response', () => {
      const res = createMockResponse();
      manager.createStream(res, 'session-1');

      expect(res.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      expect(res.flushHeaders).toHaveBeenCalled();
    });

    it('should return a valid SSEStream handle', () => {
      const res = createMockResponse();
      const stream = manager.createStream(res, 'session-1');

      expect(stream.streamId).toBeDefined();
      expect(stream.sessionId).toBe('session-1');
      expect(stream.res).toBe(res);
      expect(stream.createdAt).toBeInstanceOf(Date);
      expect(stream.lastActivityAt).toBeInstanceOf(Date);
    });

    it('should track the stream as active', () => {
      const res = createMockResponse();
      const stream = manager.createStream(res, 'session-1');

      expect(manager.getActiveStreamCount()).toBe(1);
      expect(manager.getStream(stream.streamId)).toBe(stream);
    });

    it('should support multiple concurrent streams', () => {
      const res1 = createMockResponse();
      const res2 = createMockResponse();
      const res3 = createMockResponse();

      manager.createStream(res1, 'session-1');
      manager.createStream(res2, 'session-2');
      manager.createStream(res3, 'session-3');

      expect(manager.getActiveStreamCount()).toBe(3);
    });
  });

  describe('pushEvent', () => {
    it('should write event in SSE format', () => {
      const res = createMockResponse();
      const stream = manager.createStream(res, 'session-1');

      const event: AgentEvent = { type: 'text_delta', content: 'Hello world' };
      manager.pushEvent(stream, event);

      const expectedMessage = `event: text_delta\ndata: ${JSON.stringify(event)}\n\n`;
      expect(res.write).toHaveBeenCalledWith(expectedMessage);
    });

    it('should handle different event types', () => {
      const res = createMockResponse();
      const stream = manager.createStream(res, 'session-1');

      const toolEvent: AgentEvent = { type: 'tool_use', toolName: 'query_orders', input: { orderNo: '123' } };
      manager.pushEvent(stream, toolEvent);

      const expectedMessage = `event: tool_use\ndata: ${JSON.stringify(toolEvent)}\n\n`;
      expect(res.write).toHaveBeenCalledWith(expectedMessage);
    });

    it('should update lastActivityAt on push', () => {
      const res = createMockResponse();
      const stream = manager.createStream(res, 'session-1');

      const initialActivity = stream.lastActivityAt;

      // Advance time
      vi.advanceTimersByTime(1000);

      const event: AgentEvent = { type: 'text_delta', content: 'Update' };
      manager.pushEvent(stream, event);

      expect(stream.lastActivityAt.getTime()).toBeGreaterThan(initialActivity.getTime());
    });

    it('should not write to a closed stream', () => {
      const res = createMockResponse();
      const stream = manager.createStream(res, 'session-1');

      manager.closeStream(stream);

      const event: AgentEvent = { type: 'text_delta', content: 'Should not appear' };
      manager.pushEvent(stream, event);

      // write is called during closeStream for the close event, but not for this push
      const writeCalls = res.write.mock.calls;
      const hasContent = writeCalls.some(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('Should not appear'),
      );
      expect(hasContent).toBe(false);
    });

    it('should clean up stream if write throws', () => {
      const res = createMockResponse();
      const stream = manager.createStream(res, 'session-1');

      // Make write throw on second call (first is heartbeat or close event)
      res.write.mockImplementation(() => {
        throw new Error('Connection reset');
      });

      const event: AgentEvent = { type: 'text_delta', content: 'Hello' };
      expect(() => manager.pushEvent(stream, event)).not.toThrow();

      expect(manager.getActiveStreamCount()).toBe(0);
    });
  });

  describe('closeStream', () => {
    it('should send a close event and end the response', () => {
      const res = createMockResponse();
      const stream = manager.createStream(res, 'session-1');

      manager.closeStream(stream);

      expect(res.write).toHaveBeenCalledWith(
        `event: close\ndata: {"reason":"stream_closed"}\n\n`,
      );
      expect(res.end).toHaveBeenCalled();
    });

    it('should remove the stream from active streams', () => {
      const res = createMockResponse();
      const stream = manager.createStream(res, 'session-1');

      expect(manager.getActiveStreamCount()).toBe(1);

      manager.closeStream(stream);

      expect(manager.getActiveStreamCount()).toBe(0);
      expect(manager.getStream(stream.streamId)).toBeUndefined();
    });

    it('should be idempotent (closing twice does not throw)', () => {
      const res = createMockResponse();
      const stream = manager.createStream(res, 'session-1');

      manager.closeStream(stream);
      expect(() => manager.closeStream(stream)).not.toThrow();
    });
  });

  describe('idle timeout', () => {
    it('should close stream after 30 minutes of inactivity', () => {
      const res = createMockResponse();
      const stream = manager.createStream(res, 'session-1');

      expect(manager.getActiveStreamCount()).toBe(1);

      // Advance time by 30 minutes
      vi.advanceTimersByTime(30 * 60 * 1000);

      expect(manager.getActiveStreamCount()).toBe(0);
      expect(res.end).toHaveBeenCalled();
    });

    it('should reset idle timer on pushEvent', () => {
      const res = createMockResponse();
      const stream = manager.createStream(res, 'session-1');

      // Advance 20 minutes
      vi.advanceTimersByTime(20 * 60 * 1000);

      // Push an event (resets timer)
      const event: AgentEvent = { type: 'text_delta', content: 'Keep alive' };
      manager.pushEvent(stream, event);

      // Advance another 20 minutes (total 40 from start, but only 20 from last activity)
      vi.advanceTimersByTime(20 * 60 * 1000);

      // Stream should still be active (only 20 min since last activity)
      expect(manager.getActiveStreamCount()).toBe(1);

      // Advance another 10 minutes (30 min since last activity)
      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(manager.getActiveStreamCount()).toBe(0);
    });
  });

  describe('heartbeat', () => {
    it('should send heartbeat comments at configured interval', () => {
      const res = createMockResponse();
      manager.createStream(res, 'session-1');

      // Advance past heartbeat interval
      vi.advanceTimersByTime(15_000);

      expect(res.write).toHaveBeenCalledWith(`: heartbeat\n\n`);
    });

    it('should stop heartbeat when stream is closed', () => {
      const res = createMockResponse();
      const stream = manager.createStream(res, 'session-1');

      manager.closeStream(stream);
      res.write.mockClear();

      // Advance past heartbeat interval
      vi.advanceTimersByTime(15_000);

      // No heartbeat should be sent after close
      const heartbeatCalls = res.write.mock.calls.filter(
        (call: any[]) => call[0] === `: heartbeat\n\n`,
      );
      expect(heartbeatCalls).toHaveLength(0);
    });
  });

  describe('client disconnect', () => {
    it('should clean up stream when client closes connection', () => {
      const res = createMockResponse();
      const stream = manager.createStream(res, 'session-1');

      expect(manager.getActiveStreamCount()).toBe(1);

      // Simulate client disconnect
      res.emit('close');

      expect(manager.getActiveStreamCount()).toBe(0);
    });
  });

  describe('shutdown', () => {
    it('should close all active streams', () => {
      const res1 = createMockResponse();
      const res2 = createMockResponse();

      manager.createStream(res1, 'session-1');
      manager.createStream(res2, 'session-2');

      expect(manager.getActiveStreamCount()).toBe(2);

      manager.shutdown();

      expect(manager.getActiveStreamCount()).toBe(0);
      expect(res1.end).toHaveBeenCalled();
      expect(res2.end).toHaveBeenCalled();
    });
  });
});
