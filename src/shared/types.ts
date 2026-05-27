/**
 * Shared type definitions used across all layers.
 */

/** Structured error response format */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    traceId: string;
    timestamp: string;
  };
}

/** Agent lifecycle status */
export type AgentStatus = 'registered' | 'ready' | 'running' | 'paused' | 'stopped';

/** Order status */
export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

/** Agent event types emitted during streaming */
export type AgentEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_use'; toolName: string; input: unknown }
  | { type: 'tool_result'; toolName: string; output: unknown }
  | { type: 'end'; usage: UsageStats }
  | { type: 'error'; error: ErrorResponse };

/** Token usage statistics */
export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
}

/** Retry configuration */
export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}
