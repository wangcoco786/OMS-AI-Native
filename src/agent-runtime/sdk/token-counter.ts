/**
 * Token Counter Utility
 *
 * Provides approximate token counting for context window management.
 * Uses a heuristic of ~4 characters per token, which is a common
 * approximation for English/Chinese mixed text.
 */

import type { Message } from '../../infrastructure/llm/types.js';

/** Characters per token approximation for mixed English/Chinese text */
const CHARS_PER_TOKEN = 4;

/**
 * TokenCounter provides methods to estimate token counts for messages
 * and strings without requiring a full tokenizer.
 */
export class TokenCounter {
  private readonly charsPerToken: number;

  constructor(charsPerToken: number = CHARS_PER_TOKEN) {
    this.charsPerToken = charsPerToken;
  }

  /**
   * Estimate the token count for a string.
   */
  countString(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / this.charsPerToken);
  }

  /**
   * Estimate the token count for a single message.
   * Accounts for both string content and structured content blocks.
   */
  countMessage(message: Message): number {
    const content = message.content;

    if (typeof content === 'string') {
      // Add a small overhead for message framing (role, etc.)
      return this.countString(content) + 4;
    }

    // Content is an array of ContentBlocks
    let tokens = 4; // message framing overhead
    for (const block of content) {
      if (block.type === 'text') {
        tokens += this.countString(block.text);
      } else if (block.type === 'tool_use') {
        tokens += this.countString(block.name);
        tokens += this.countString(JSON.stringify(block.input));
      }
    }
    return tokens;
  }

  /**
   * Estimate the total token count for an array of messages.
   */
  countMessages(messages: Message[]): number {
    let total = 0;
    for (const message of messages) {
      total += this.countMessage(message);
    }
    return total;
  }

  /**
   * Estimate the token count for a system prompt.
   */
  countSystemPrompt(systemPrompt: string): number {
    if (!systemPrompt) return 0;
    // System prompt has additional framing overhead
    return this.countString(systemPrompt) + 4;
  }

  /**
   * Calculate the total context token usage for a session
   * (system prompt + all messages).
   */
  countContext(systemPrompt: string, messages: Message[]): number {
    return this.countSystemPrompt(systemPrompt) + this.countMessages(messages);
  }
}
