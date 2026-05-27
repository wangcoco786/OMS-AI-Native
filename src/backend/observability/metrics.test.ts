/**
 * Tests for Performance Metrics Collector.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { MetricsCollector } from './metrics.js';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;
  let mockLogger: { child: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockLogger = {
      child: vi.fn().mockReturnValue({
        warn: vi.fn(),
      }),
      warn: vi.fn(),
    };

    collector = new MetricsCollector({
      logger: mockLogger as unknown as import('pino').Logger,
    });
  });

  describe('recordResponseTime', () => {
    it('should record response times and increment request count', () => {
      collector.recordResponseTime(100);
      collector.recordResponseTime(200);
      collector.recordResponseTime(300);

      const metrics = collector.getMetrics();
      expect(metrics.requestCount).toBe(3);
      expect(metrics.responseTime.count).toBe(3);
    });

    it('should trigger a warning when response time exceeds 3000ms', () => {
      collector.recordResponseTime(3500);

      const childLogger = mockLogger.child.mock.results[0].value;
      expect(childLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ durationMs: 3500, threshold: 3000 }),
        expect.stringContaining('Performance alert'),
      );
    });

    it('should not trigger a warning when response time is under 3000ms', () => {
      collector.recordResponseTime(2999);

      const childLogger = mockLogger.child.mock.results[0].value;
      expect(childLogger.warn).not.toHaveBeenCalled();
    });

    it('should use custom alert threshold when provided', () => {
      const customCollector = new MetricsCollector({
        logger: mockLogger as unknown as import('pino').Logger,
        alertThresholdMs: 1000,
      });

      customCollector.recordResponseTime(1500);

      const childLogger = mockLogger.child.mock.results[0].value;
      expect(childLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ durationMs: 1500, threshold: 1000 }),
        expect.stringContaining('Performance alert'),
      );
    });
  });

  describe('recordError', () => {
    it('should count errors by type', () => {
      collector.recordError('timeout');
      collector.recordError('timeout');
      collector.recordError('validation');

      const metrics = collector.getMetrics();
      expect(metrics.errors['timeout']).toBe(2);
      expect(metrics.errors['validation']).toBe(1);
    });

    it('should handle new error types', () => {
      collector.recordError('new_error_type');

      const metrics = collector.getMetrics();
      expect(metrics.errors['new_error_type']).toBe(1);
    });
  });

  describe('session tracking', () => {
    it('should increment active sessions', () => {
      collector.incrementSessions();
      collector.incrementSessions();

      const metrics = collector.getMetrics();
      expect(metrics.activeSessions).toBe(2);
    });

    it('should decrement active sessions', () => {
      collector.incrementSessions();
      collector.incrementSessions();
      collector.decrementSessions();

      const metrics = collector.getMetrics();
      expect(metrics.activeSessions).toBe(1);
    });

    it('should not go below zero when decrementing', () => {
      collector.decrementSessions();

      const metrics = collector.getMetrics();
      expect(metrics.activeSessions).toBe(0);
    });
  });

  describe('getMetrics', () => {
    it('should return zero values when no data has been recorded', () => {
      const metrics = collector.getMetrics();

      expect(metrics.responseTime.count).toBe(0);
      expect(metrics.responseTime.p50).toBe(0);
      expect(metrics.responseTime.p95).toBe(0);
      expect(metrics.responseTime.p99).toBe(0);
      expect(metrics.errors).toEqual({});
      expect(metrics.activeSessions).toBe(0);
      expect(metrics.requestCount).toBe(0);
    });

    it('should calculate correct percentiles', () => {
      // Record 100 values from 1 to 100
      for (let i = 1; i <= 100; i++) {
        collector.recordResponseTime(i);
      }

      const metrics = collector.getMetrics();
      expect(metrics.responseTime.p50).toBe(50);
      expect(metrics.responseTime.p95).toBe(95);
      expect(metrics.responseTime.p99).toBe(99);
    });

    it('should handle a single response time value', () => {
      collector.recordResponseTime(500);

      const metrics = collector.getMetrics();
      expect(metrics.responseTime.p50).toBe(500);
      expect(metrics.responseTime.p95).toBe(500);
      expect(metrics.responseTime.p99).toBe(500);
    });
  });

  describe('reset', () => {
    it('should clear all metrics', () => {
      collector.recordResponseTime(100);
      collector.recordError('timeout');
      collector.incrementSessions();

      collector.reset();

      const metrics = collector.getMetrics();
      expect(metrics.responseTime.count).toBe(0);
      expect(metrics.errors).toEqual({});
      expect(metrics.activeSessions).toBe(0);
      expect(metrics.requestCount).toBe(0);
    });
  });

  describe('metricsHandler', () => {
    it('should return Prometheus text format', () => {
      collector.recordResponseTime(100);
      collector.recordResponseTime(200);
      collector.recordError('timeout');
      collector.incrementSessions();

      const mockReq = {} as Request;
      const mockRes = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as unknown as Response;

      collector.metricsHandler(mockReq, mockRes);

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/plain; version=0.0.4; charset=utf-8',
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);

      const body = (mockRes.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(body).toContain('# HELP oms_response_time_ms');
      expect(body).toContain('# TYPE oms_response_time_ms summary');
      expect(body).toContain('oms_response_time_ms{quantile="0.5"}');
      expect(body).toContain('oms_response_time_ms{quantile="0.95"}');
      expect(body).toContain('oms_response_time_ms{quantile="0.99"}');
      expect(body).toContain('oms_response_time_ms_count 2');
      expect(body).toContain('oms_errors_total{type="timeout"} 1');
      expect(body).toContain('oms_active_sessions 1');
      expect(body).toContain('oms_requests_total 2');
    });

    it('should handle empty metrics gracefully', () => {
      const mockReq = {} as Request;
      const mockRes = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as unknown as Response;

      collector.metricsHandler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      const body = (mockRes.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(body).toContain('oms_response_time_ms_count 0');
      expect(body).toContain('oms_active_sessions 0');
      expect(body).toContain('oms_requests_total 0');
    });
  });
});
