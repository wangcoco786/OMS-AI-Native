/**
 * Agent SDK Wrapper Implementation
 *
 * Wraps the LLM Gateway to provide a higher-level Agent abstraction:
 * - Session management with conversation history
 * - Tool Use protocol handling (tool_use → tool_result loop)
 * - Streaming AgentEvent emission
 * - Context window management
 */

import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';

import type { LLMGateway, StreamEvent, ToolDefinition } from '../../infrastructure/llm/types.js';
import type { ErrorResponse } from '../../shared/types.js';
import type { AgentSDKConfig, AgentEvent, AgentSession, AgentSDKWrapper } from './types.js';
import { TokenCounter } from './token-counter.js';

/**
 * AgentSDKWrapperService implements the AgentSDKWrapper interface.
 * It manages agent sessions and orchestrates the Tool Use protocol
 * between the LLM and external tool executors.
 */
export class AgentSDKWrapperService implements AgentSDKWrapper {
  private readonly llmGateway: LLMGateway;
  private readonly contextWindowSize: number;
  private readonly compressionThreshold: number;
  private readonly sessions: Map<string, AgentSession> = new Map();
  private readonly logger: pino.Logger;
  private readonly tokenCounter: TokenCounter;

  constructor(config: AgentSDKConfig, options?: { logger?: pino.Logger }) {
    this.llmGateway = config.llmGateway;
    this.contextWindowSize = config.contextWindowSize;
    this.compressionThreshold = config.compressionThreshold;
    this.tokenCounter = new TokenCounter();
    this.logger = (options?.logger ?? pino({ name: 'agent-sdk-wrapper' })).child({
      component: 'agent-sdk-wrapper',
    });
  }

  /**
   * Create a new agent session.
   * Initializes an empty conversation context with the given agent/tenant/user.
   */
  async createSession(agentId: string, tenantId: string, userId: string): Promise<AgentSession> {
    const sessionId = uuidv4();

    const session: AgentSession = {
      id: sessionId,
      agentId,
      tenantId,
      userId,
      context: {
        sessionId,
        messages: [],
        tools: [],
        systemPrompt: '',
        metadata: {},
      },
      createdAt: new Date(),
      lastActiveAt: new Date(),
    };

    this.sessions.set(sessionId, session);
    this.logger.info({ sessionId, agentId, tenantId, userId }, 'Session created');

    return session;
  }

  /**
   * Send a user message and receive streaming agent events.
   *
   * The chat method:
   * 1. Adds the user message to the session's message history
   * 2. Calls LLMGateway.stream() with the full message history + tools
   * 3. Parses stream events and yields AgentEvents
   * 4. If the LLM returns a tool_use, yields a tool_use event
   * 5. Yields an 'end' event with usage stats when complete
   */
  chat(session: AgentSession, userMessage: string): AsyncIterable<AgentEvent> {
    const self = this;

    return {
      [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
        const eventQueue: AgentEvent[] = [];
        let streamIterator: AsyncIterator<StreamEvent> | null = null;
        let done = false;
        let initialized = false;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;

        // Accumulated state for parsing stream events
        let currentToolName = '';
        let currentToolInput = '';
        let currentToolId = '';

        async function initialize(): Promise<void> {
          // Add user message to conversation history
          session.context.messages.push({
            role: 'user',
            content: userMessage,
          });
          session.lastActiveAt = new Date();

          // Auto-compress if context exceeds threshold
          const totalTokens = self.getContextTokenCount(session);
          const threshold = self.contextWindowSize * self.compressionThreshold;
          if (totalTokens > threshold) {
            self.logger.info(
              { sessionId: session.id, totalTokens, threshold },
              'Auto-compressing context before LLM call',
            );
            await self.compressContext(session);
          }

          // Start streaming from LLM Gateway
          const streamIterable = self.llmGateway.stream({
            tenantId: session.tenantId,
            sessionId: session.id,
            messages: session.context.messages,
            tools: session.context.tools.length > 0 ? session.context.tools : undefined,
            stream: true,
            system: session.context.systemPrompt || undefined,
          });

          streamIterator = streamIterable[Symbol.asyncIterator]();
          initialized = true;
        }

        function processStreamEvent(event: StreamEvent): void {
          switch (event.type) {
            case 'content_block_start': {
              const block = event.contentBlock;
              if (block.type === 'tool_use') {
                currentToolName = block.name;
                currentToolId = block.id;
                currentToolInput = '';
              }
              break;
            }

            case 'content_block_delta': {
              const delta = event.delta;
              if (delta.type === 'text_delta') {
                eventQueue.push({ type: 'text_delta', content: delta.text });
              } else if (delta.type === 'input_json_delta') {
                currentToolInput += delta.partial_json;
              }
              break;
            }

            case 'content_block_stop': {
              // If we were accumulating a tool_use, emit it now
              if (currentToolName) {
                let parsedInput: unknown = {};
                try {
                  if (currentToolInput) {
                    parsedInput = JSON.parse(currentToolInput);
                  }
                } catch {
                  self.logger.warn(
                    { toolName: currentToolName, rawInput: currentToolInput },
                    'Failed to parse tool input JSON',
                  );
                }

                eventQueue.push({
                  type: 'tool_use',
                  toolName: currentToolName,
                  input: parsedInput,
                });

                // Add assistant message with tool_use to conversation history
                session.context.messages.push({
                  role: 'assistant',
                  content: [
                    {
                      type: 'tool_use',
                      id: currentToolId,
                      name: currentToolName,
                      input: parsedInput,
                    },
                  ],
                });

                // Reset tool accumulation state
                currentToolName = '';
                currentToolInput = '';
                currentToolId = '';
              }
              break;
            }

            case 'message_delta': {
              if (event.usage) {
                totalOutputTokens = event.usage.outputTokens;
              }
              break;
            }

            case 'message_stop': {
              // Stream complete - emit end event
              eventQueue.push({
                type: 'end',
                usage: {
                  inputTokens: totalInputTokens,
                  outputTokens: totalOutputTokens,
                },
              });
              done = true;
              break;
            }

            case 'message_start': {
              // Track message ID if needed
              break;
            }

            case 'error': {
              const errorResponse: ErrorResponse = {
                error: {
                  code: event.error.type,
                  message: event.error.message,
                  traceId: session.id,
                  timestamp: new Date().toISOString(),
                },
              };
              eventQueue.push({ type: 'error', error: errorResponse });
              done = true;
              break;
            }
          }
        }

        return {
          async next(): Promise<IteratorResult<AgentEvent>> {
            try {
              // Initialize on first call
              if (!initialized) {
                await initialize();
              }

              // Return queued events first
              if (eventQueue.length > 0) {
                return { value: eventQueue.shift()!, done: false };
              }

              if (done) {
                return { value: undefined as unknown as AgentEvent, done: true };
              }

              // Read from stream until we have an event to yield
              while (!done && eventQueue.length === 0) {
                if (!streamIterator) {
                  done = true;
                  break;
                }

                const result = await streamIterator.next();
                if (result.done) {
                  // Stream ended without message_stop - emit end event
                  if (!done) {
                    eventQueue.push({
                      type: 'end',
                      usage: {
                        inputTokens: totalInputTokens,
                        outputTokens: totalOutputTokens,
                      },
                    });
                    done = true;
                  }
                  break;
                }

                processStreamEvent(result.value);
              }

              if (eventQueue.length > 0) {
                return { value: eventQueue.shift()!, done: false };
              }

              return { value: undefined as unknown as AgentEvent, done: true };
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              self.logger.error({ error: errorMessage, sessionId: session.id }, 'Chat stream error');

              const errorResponse: ErrorResponse = {
                error: {
                  code: 'STREAM_ERROR',
                  message: errorMessage,
                  traceId: session.id,
                  timestamp: new Date().toISOString(),
                },
              };

              done = true;
              return {
                value: { type: 'error', error: errorResponse },
                done: false,
              };
            }
          },

          async return(): Promise<IteratorResult<AgentEvent>> {
            done = true;
            if (streamIterator?.return) {
              await streamIterator.return(undefined);
            }
            return { value: undefined as unknown as AgentEvent, done: true };
          },

          async throw(error: Error): Promise<IteratorResult<AgentEvent>> {
            done = true;
            if (streamIterator?.throw) {
              await streamIterator.throw(error);
            }
            throw error;
          },
        };
      },
    };
  }

  /**
   * Add a tool result to the session's conversation history.
   * This is called externally after tool execution to continue the conversation.
   */
  addToolResult(session: AgentSession, toolName: string, toolUseId: string, output: unknown): void {
    session.context.messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result' as unknown as 'text',
          tool_use_id: toolUseId,
          content: typeof output === 'string' ? output : JSON.stringify(output),
        } as unknown as { type: 'text'; text: string },
      ],
    });

    session.lastActiveAt = new Date();
    this.logger.debug({ sessionId: session.id, toolName, toolUseId }, 'Tool result added to session');
  }

  /**
   * Compress the session context to fit within token limits.
   * Preserves the system prompt and keeps the most recent messages
   * that fit within the target token budget.
   *
   * Target budget = contextWindowSize * (1 - compressionThreshold)
   * Example: 100k window, 0.8 threshold → compress when >80k tokens, target 20k after compression
   */
  async compressContext(session: AgentSession): Promise<void> {
    const messages = session.context.messages;

    if (messages.length <= 2) {
      // Nothing to compress if we have 2 or fewer messages
      return;
    }

    // Calculate target token budget for messages after compression
    // System prompt is preserved separately and not counted against message budget
    const targetTokenBudget = Math.floor(this.contextWindowSize * (1 - this.compressionThreshold));

    // Walk backwards from the most recent messages, accumulating tokens
    // until we exceed the target budget
    let accumulatedTokens = 0;
    let keepFromIndex = messages.length;

    for (let i = messages.length - 1; i >= 0; i--) {
      const messageTokens = this.tokenCounter.countMessage(messages[i]);
      if (accumulatedTokens + messageTokens > targetTokenBudget) {
        break;
      }
      accumulatedTokens += messageTokens;
      keepFromIndex = i;
    }

    // Always keep at least the last 2 messages
    const minKeepIndex = Math.max(0, messages.length - 2);
    keepFromIndex = Math.min(keepFromIndex, minKeepIndex);

    const recentMessages = messages.slice(keepFromIndex);
    const originalCount = messages.length;

    session.context.messages = recentMessages;
    session.lastActiveAt = new Date();

    this.logger.info(
      {
        sessionId: session.id,
        originalCount,
        compressedCount: recentMessages.length,
        targetTokenBudget,
        actualTokens: accumulatedTokens,
      },
      'Context compressed',
    );
  }

  /**
   * Get the current token count for a session's context.
   * Includes system prompt and all messages.
   */
  getContextTokenCount(session: AgentSession): number {
    return this.tokenCounter.countContext(
      session.context.systemPrompt,
      session.context.messages,
    );
  }

  /**
   * Close and clean up a session.
   * Removes the session from the active sessions map.
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.logger.warn({ sessionId }, 'Attempted to close non-existent session');
      return;
    }

    this.sessions.delete(sessionId);
    this.logger.info({ sessionId, agentId: session.agentId }, 'Session closed');
  }

  /**
   * Get an active session by ID.
   */
  getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get the number of active sessions.
   */
  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Set tools available for a session.
   */
  setSessionTools(session: AgentSession, tools: ToolDefinition[]): void {
    session.context.tools = tools;
  }

  /**
   * Set the system prompt for a session.
   */
  setSessionSystemPrompt(session: AgentSession, systemPrompt: string): void {
    session.context.systemPrompt = systemPrompt;
  }
}
