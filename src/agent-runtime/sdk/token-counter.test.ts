/**
 * Token Counter Unit Tests
 *
 * Tests the approximate token counting utility used for
 * context window management and compression decisions.
 */

import { describe, it, expect } from 'vitest';

import type { Message } from '../../infrastructure/llm/types.js';
import { TokenCounter } from './token-counter.js';

describe('TokenCounter', () => {
  const counter = new TokenCounter();

  describe('countString', () => {
    it('should return 0 for empty string', () => {
      expect(counter.countString('')).toBe(0);
    });

    it('should return 0 for null/undefined-like input', () => {
      expect(counter.countString('')).toBe(0);
    });

    it('should approximate tokens at ~4 chars per token', () => {
      // 12 chars → 3 tokens
      expect(counter.countString('Hello World!')).toBe(3);
    });

    it('should round up partial tokens', () => {
      // 5 chars → ceil(5/4) = 2 tokens
      expect(counter.countString('Hello')).toBe(2);
    });

    it('should handle longer text', () => {
      const text = 'a'.repeat(100);
      // 100 chars → 25 tokens
      expect(counter.countString(text)).toBe(25);
    });

    it('should handle Chinese text', () => {
      // Chinese characters are typically 3 bytes each but we count by char length
      const text = '你好世界'; // 4 chars → ceil(4/4) = 1 token
      expect(counter.countString(text)).toBe(1);
    });
  });

  describe('countMessage', () => {
    it('should count a simple text message with framing overhead', () => {
      const message: Message = { role: 'user', content: 'Hello' };
      // ceil(5/4) + 4 framing = 2 + 4 = 6
      expect(counter.countMessage(message)).toBe(6);
    });

    it('should count a message with content blocks', () => {
      const message: Message = {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello World!' }],
      };
      // 4 framing + ceil(12/4) = 4 + 3 = 7
      expect(counter.countMessage(message)).toBe(7);
    });

    it('should count a tool_use content block', () => {
      const message: Message = {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'query_orders',
            input: { status: 'shipped' },
          },
        ],
      };
      // 4 framing + countString("query_orders") + countString(JSON.stringify({status:"shipped"}))
      // = 4 + ceil(12/4) + ceil(20/4) = 4 + 3 + 5 = 12
      expect(counter.countMessage(message)).toBe(12);
    });

    it('should count multiple content blocks', () => {
      const message: Message = {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me search.' },
          { type: 'tool_use', id: 'tool-1', name: 'search', input: { q: 'test' } },
        ],
      };
      // 4 framing + ceil(14/4) + ceil(6/4) + ceil(12/4)
      // = 4 + 4 + 2 + 3 = 13
      expect(counter.countMessage(message)).toBe(13);
    });
  });

  describe('countMessages', () => {
    it('should return 0 for empty array', () => {
      expect(counter.countMessages([])).toBe(0);
    });

    it('should sum token counts of all messages', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];
      // Message 1: ceil(5/4) + 4 = 6
      // Message 2: ceil(9/4) + 4 = 3 + 4 = 7
      expect(counter.countMessages(messages)).toBe(13);
    });
  });

  describe('countSystemPrompt', () => {
    it('should return 0 for empty system prompt', () => {
      expect(counter.countSystemPrompt('')).toBe(0);
    });

    it('should count system prompt with framing overhead', () => {
      const prompt = 'You are a helpful assistant.';
      // ceil(28/4) + 4 = 7 + 4 = 11
      expect(counter.countSystemPrompt(prompt)).toBe(11);
    });
  });

  describe('countContext', () => {
    it('should sum system prompt and messages', () => {
      const systemPrompt = 'You are helpful.';
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
      ];
      // System: ceil(16/4) + 4 = 4 + 4 = 8
      // Message: ceil(5/4) + 4 = 2 + 4 = 6
      expect(counter.countContext(systemPrompt, messages)).toBe(14);
    });

    it('should handle empty system prompt', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
      ];
      // System: 0
      // Message: ceil(5/4) + 4 = 6
      expect(counter.countContext('', messages)).toBe(6);
    });

    it('should handle empty messages', () => {
      expect(counter.countContext('System prompt', [])).toBe(
        counter.countSystemPrompt('System prompt'),
      );
    });
  });

  describe('custom charsPerToken', () => {
    it('should use custom chars per token ratio', () => {
      const customCounter = new TokenCounter(2);
      // 10 chars / 2 = 5 tokens
      expect(customCounter.countString('0123456789')).toBe(5);
    });
  });
});
