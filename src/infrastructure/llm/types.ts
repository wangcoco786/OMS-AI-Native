/**
 * LLM Gateway Type Definitions
 *
 * Interfaces for the unified LLM Gateway service that manages
 * Claude API access with streaming, rate limiting, and multi-tenant isolation.
 */

/** Configuration for a tenant's LLM access */
export interface LLMGatewayConfig {
  tenantId: string;
  apiKey: string;
  model: string; // e.g., "claude-sonnet-4-20250514"
  maxTokens: number;
  rateLimit: number; // requests per minute
}

/** Message role in a conversation */
export type MessageRole = 'user' | 'assistant';

/** A single message in a conversation */
export interface Message {
  role: MessageRole;
  content: string | ContentBlock[];
}

/** Content block types returned by Claude API */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

/** Tool definition for Claude API */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** LLM request payload */
export interface LLMRequest {
  tenantId: string;
  sessionId: string;
  messages: Message[];
  tools?: ToolDefinition[];
  stream: boolean;
  maxTokens?: number;
  system?: string;
}

/** Stop reason from Claude API */
export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens';

/** LLM response from a non-streaming call */
export interface LLMResponse {
  id: string;
  content: ContentBlock[];
  usage: { inputTokens: number; outputTokens: number };
  stopReason: StopReason;
}

/** Stream event types emitted during streaming */
export type StreamEvent =
  | { type: 'message_start'; message: { id: string } }
  | { type: 'content_block_start'; index: number; contentBlock: ContentBlock }
  | { type: 'content_block_delta'; index: number; delta: ContentBlockDelta }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stopReason: StopReason }; usage: { outputTokens: number } }
  | { type: 'message_stop' }
  | { type: 'error'; error: { type: string; message: string } };

/** Delta types for streaming content blocks */
export type ContentBlockDelta =
  | { type: 'text_delta'; text: string }
  | { type: 'input_json_delta'; partial_json: string };

/** Usage statistics for a tenant */
export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  totalCalls: number;
  period: string;
}

/** LLM call log entry */
export interface LLMCallLog {
  tenantId: string;
  sessionId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: 'success' | 'error';
  errorMessage?: string;
}

/** Claude API request body format */
export interface ClaudeAPIRequest {
  model: string;
  max_tokens: number;
  messages: Array<{ role: string; content: string | ContentBlock[] }>;
  tools?: ToolDefinition[];
  stream?: boolean;
  system?: string;
}

/** Claude API response body format */
export interface ClaudeAPIResponse {
  id: string;
  type: string;
  role: string;
  content: ContentBlock[];
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/** LLM Gateway interface */
export interface LLMGateway {
  /** Synchronous (non-streaming) completion */
  complete(request: LLMRequest): Promise<LLMResponse>;
  /** Streaming completion returning an async iterable of events */
  stream(request: LLMRequest): AsyncIterable<StreamEvent>;
  /** Get usage statistics for a tenant in a given period */
  getUsage(tenantId: string, period: string): Promise<UsageStats>;
}
