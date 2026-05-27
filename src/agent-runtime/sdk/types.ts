/**
 * Agent SDK Wrapper Type Definitions
 *
 * Interfaces for the Agent SDK Wrapper that provides a higher-level
 * Agent abstraction over the LLM Gateway, managing sessions, tool use
 * protocol, and streaming events.
 */

import type { ErrorResponse, UsageStats } from '../../shared/types.js';
import type { LLMGateway, Message, ToolDefinition } from '../../infrastructure/llm/types.js';

/** Configuration for the Agent SDK Wrapper */
export interface AgentSDKConfig {
  llmGateway: LLMGateway;
  contextWindowSize: number; // max tokens
  compressionThreshold: number; // trigger compression at this % (0-1)
}

/** Agent session context holding conversation state */
export interface AgentContext {
  sessionId: string;
  messages: Message[];
  tools: ToolDefinition[];
  systemPrompt: string;
  metadata: Record<string, unknown>;
}

/** An active agent session */
export interface AgentSession {
  id: string;
  agentId: string;
  tenantId: string;
  userId: string;
  context: AgentContext;
  createdAt: Date;
  lastActiveAt: Date;
}

/** Events emitted during agent chat streaming */
export type AgentEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_use'; toolName: string; input: unknown }
  | { type: 'tool_result'; toolName: string; output: unknown }
  | { type: 'end'; usage: UsageStats }
  | { type: 'error'; error: ErrorResponse };

/** Interface for the Agent SDK Wrapper */
export interface AgentSDKWrapper {
  /** Create a new agent session */
  createSession(agentId: string, tenantId: string, userId: string): Promise<AgentSession>;
  /** Send a user message and receive streaming agent events */
  chat(session: AgentSession, userMessage: string): AsyncIterable<AgentEvent>;
  /** Compress the session context to fit within token limits */
  compressContext(session: AgentSession): Promise<void>;
  /** Get the current token count for a session's context */
  getContextTokenCount(session: AgentSession): number;
  /** Close and clean up a session */
  closeSession(sessionId: string): Promise<void>;
}
