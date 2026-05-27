import { describe, it, expect } from 'vitest';
import { calculateBackoff, buildWsUrl, parseWsMessage } from './use-onboarding-ws';

describe('use-onboarding-ws utilities', () => {
  describe('calculateBackoff', () => {
    it('should return baseDelay for first attempt', () => {
      expect(calculateBackoff(1, 1000)).toBe(1000);
    });

    it('should double delay for each subsequent attempt', () => {
      expect(calculateBackoff(2, 1000)).toBe(2000);
      expect(calculateBackoff(3, 1000)).toBe(4000);
      expect(calculateBackoff(4, 1000)).toBe(8000);
    });

    it('should cap delay at 30 seconds', () => {
      expect(calculateBackoff(10, 1000)).toBe(30000);
      expect(calculateBackoff(20, 1000)).toBe(30000);
    });

    it('should work with different base delays', () => {
      expect(calculateBackoff(1, 500)).toBe(500);
      expect(calculateBackoff(2, 500)).toBe(1000);
      expect(calculateBackoff(3, 500)).toBe(2000);
    });
  });

  describe('buildWsUrl', () => {
    it('should build URL with custom baseUrl', () => {
      const url = buildWsUrl('session-123', 'ws://localhost:4000');
      expect(url).toBe('ws://localhost:4000/ws/onboarding/session-123');
    });

    it('should build URL with wss baseUrl', () => {
      const url = buildWsUrl('session-456', 'wss://api.example.com');
      expect(url).toBe('wss://api.example.com/ws/onboarding/session-456');
    });

    it('should auto-detect protocol from window.location when no baseUrl', () => {
      // In jsdom, window.location.protocol is 'http:' and host is 'localhost'
      const url = buildWsUrl('session-789');
      expect(url).toMatch(/^ws:\/\/.+\/ws\/onboarding\/session-789$/);
    });
  });

  describe('parseWsMessage', () => {
    it('should parse valid step_help message', () => {
      const raw = JSON.stringify({
        type: 'step_help',
        content: 'Fill in your API key',
        step: 'channel_connection',
        id: 'msg-1',
        timestamp: '2024-01-01T00:00:00Z',
      });

      const result = parseWsMessage(raw);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('step_help');
      expect(result!.content).toBe('Fill in your API key');
      expect(result!.step).toBe('channel_connection');
      expect(result!.id).toBe('msg-1');
      expect(result!.timestamp).toBe('2024-01-01T00:00:00Z');
    });

    it('should parse valid validation_update message', () => {
      const raw = JSON.stringify({
        type: 'validation_update',
        content: 'Validation passed',
      });

      const result = parseWsMessage(raw);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('validation_update');
      expect(result!.content).toBe('Validation passed');
    });

    it('should parse valid agent_suggestion message', () => {
      const raw = JSON.stringify({
        type: 'agent_suggestion',
        content: 'Consider adding more SKU attributes',
      });

      const result = parseWsMessage(raw);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('agent_suggestion');
    });

    it('should generate id and timestamp when not provided', () => {
      const raw = JSON.stringify({
        type: 'step_help',
        content: 'Some help',
      });

      const result = parseWsMessage(raw);
      expect(result).not.toBeNull();
      expect(result!.id).toBeTruthy();
      expect(result!.timestamp).toBeTruthy();
    });

    it('should return null for invalid JSON', () => {
      expect(parseWsMessage('not json')).toBeNull();
    });

    it('should return null for missing type', () => {
      const raw = JSON.stringify({ content: 'no type' });
      expect(parseWsMessage(raw)).toBeNull();
    });

    it('should return null for missing content', () => {
      const raw = JSON.stringify({ type: 'step_help' });
      expect(parseWsMessage(raw)).toBeNull();
    });

    it('should return null for invalid type', () => {
      const raw = JSON.stringify({ type: 'unknown_type', content: 'test' });
      expect(parseWsMessage(raw)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parseWsMessage('')).toBeNull();
    });
  });
});
