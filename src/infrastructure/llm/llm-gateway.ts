/**
 * LLM Gateway Service Implementation
 *
 * Provides:
 * - Unified Claude API access via native fetch
 * - Streaming responses via SSE parsing (AsyncIterable<StreamEvent>)
 * - Multi-tenant API Key configuration isolation
 * - Usage tracking per tenant
 * - Structured error handling
 */

import pino from 'pino';

import type { RetryConfig } from '../../shared/types.js';
import type { RedisCacheService } from '../database/redis-service.js';
import type { LLMCallLogRepository } from './call-log-repository.js';
import { createStructuredError } from './error-handler.js';
import { RateLimiter, RateLimitExceededError } from './rate-limiter.js';
import { withRetry, LLM_RETRY_CONFIG } from './retry-strategy.js';
import type {
  LLMGateway,
  LLMGatewayConfig,
  LLMRequest,
  LLMResponse,
  StreamEvent,
  UsageStats,
  ClaudeAPIRequest,
  ClaudeAPIResponse,
  LLMCallLog,
} from './types.js';

/** Claude API endpoint */
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

/** Claude API version header */
const ANTHROPIC_VERSION = '2023-06-01';

/** Default max tokens if not specified */
const DEFAULT_MAX_TOKENS = 4096;

/**
 * LLMGatewayService implements the LLMGateway interface.
 * It manages multi-tenant Claude API access with streaming support.
 */
export class LLMGatewayService implements LLMGateway {
  private readonly tenantConfigs: Map<string, LLMGatewayConfig> = new Map();
  private readonly callLogs: LLMCallLog[] = [];
  private readonly logger: pino.Logger;
  private readonly rateLimiter: RateLimiter | null;
  private readonly retryConfig: RetryConfig;
  private readonly callLogRepository: LLMCallLogRepository | null;

  constructor(options?: { logger?: pino.Logger; redis?: RedisCacheService; retryConfig?: RetryConfig; callLogRepository?: LLMCallLogRepository }) {
    this.logger = (options?.logger ?? pino({ name: 'llm-gateway' })).child({
      component: 'llm-gateway',
    });
    this.rateLimiter = options?.redis
      ? new RateLimiter(options.redis, { logger: this.logger })
      : null;
    this.retryConfig = options?.retryConfig ?? LLM_RETRY_CONFIG;
    this.callLogRepository = options?.callLogRepository ?? null;
  }

  /**
   * Register a tenant configuration.
   * Each tenant has its own API key, model, and rate limit settings.
   */
  registerTenant(config: LLMGatewayConfig): void {
    this.tenantConfigs.set(config.tenantId, config);
    this.logger.info({ tenantId: config.tenantId, model: config.model }, 'Tenant registered');
  }

  /**
   * Remove a tenant configuration.
   */
  unregisterTenant(tenantId: string): void {
    this.tenantConfigs.delete(tenantId);
    this.logger.info({ tenantId }, 'Tenant unregistered');
  }

  /**
   * Get a tenant's configuration.
   */
  getTenantConfig(tenantId: string): LLMGatewayConfig | undefined {
    return this.tenantConfigs.get(tenantId);
  }

  /**
   * Synchronous (non-streaming) completion call to Claude API.
   * Includes retry with exponential backoff for transient errors.
   */
  async complete(request: LLMRequest): Promise<LLMResponse> {
    const config = this.getTenantConfigOrThrow(request.tenantId);
    const startTime = Date.now();

    // Check rate limit before making the API call
    await this.enforceRateLimit(request.tenantId, config.rateLimit);

    const apiRequest = this.buildAPIRequest(request, config, false);

    try {
      const result = await withRetry(
        async () => {
          const response = await this.callClaudeAPI(config.apiKey, apiRequest);

          if (!response.ok) {
            const errorBody = await response.text();
            throw createStructuredError(response.status, errorBody);
          }

          return response;
        },
        this.retryConfig,
      );

      const body = (await result.json()) as ClaudeAPIResponse;
      const latencyMs = Date.now() - startTime;

      const llmResponse: LLMResponse = {
        id: body.id,
        content: body.content,
        usage: {
          inputTokens: body.usage.input_tokens,
          outputTokens: body.usage.output_tokens,
        },
        stopReason: body.stop_reason as LLMResponse['stopReason'],
      };

      this.recordCallLog({
        tenantId: request.tenantId,
        sessionId: request.sessionId,
        model: config.model,
        inputTokens: llmResponse.usage.inputTokens,
        outputTokens: llmResponse.usage.outputTokens,
        latencyMs,
        status: 'success',
      });

      return llmResponse;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.recordCallLog({
        tenantId: request.tenantId,
        sessionId: request.sessionId,
        model: config.model,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs,
        status: 'error',
        errorMessage,
      });

      throw error;
    }
  }

  /**
   * Streaming completion call to Claude API.
   * Returns an AsyncIterable that yields StreamEvent objects.
   */
  stream(request: LLMRequest): AsyncIterable<StreamEvent> {
    const config = this.getTenantConfigOrThrow(request.tenantId);
    const apiRequest = this.buildAPIRequest(request, config, true);
    const self = this;

    return {
      [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
        let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
        let buffer = '';
        let done = false;
        const eventQueue: StreamEvent[] = [];
        let readerInitialized = false;
        let initPromise: Promise<void> | null = null;
        const startTime = Date.now();
        let totalOutputTokens = 0;

        async function initialize(): Promise<void> {
          // Check rate limit before making the API call
          await self.enforceRateLimit(request.tenantId, config.rateLimit);

          const response = await self.callClaudeAPI(config.apiKey, apiRequest);

          if (!response.ok) {
            const errorBody = await response.text();
            throw createStructuredError(response.status, errorBody);
          }

          if (!response.body) {
            throw new Error('Response body is null - streaming not supported');
          }

          reader = response.body.getReader();
          readerInitialized = true;
        }

        async function readNextEvents(): Promise<void> {
          if (!reader) return;

          const { value, done: streamDone } = await reader.read();

          if (streamDone) {
            done = true;
            // Record the call log on stream completion
            self.recordCallLog({
              tenantId: request.tenantId,
              sessionId: request.sessionId,
              model: config.model,
              inputTokens: 0, // Input tokens are reported in message_start
              outputTokens: totalOutputTokens,
              latencyMs: Date.now() - startTime,
              status: 'success',
            });
            return;
          }

          const decoder = new TextDecoder();
          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events from buffer
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          let currentEventType = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                done = true;
                return;
              }

              try {
                const parsed = JSON.parse(data) as Record<string, unknown>;
                const event = self.parseSSEEvent(currentEventType, parsed);
                if (event) {
                  eventQueue.push(event);

                  // Track usage from stream events
                  if (event.type === 'message_delta' && event.usage) {
                    totalOutputTokens = event.usage.outputTokens;
                  }
                }
              } catch {
                // Skip malformed JSON lines
                self.logger.debug({ data, eventType: currentEventType }, 'Skipping malformed SSE data');
              }
              currentEventType = '';
            }
          }
        }

        return {
          async next(): Promise<IteratorResult<StreamEvent>> {
            // Initialize on first call
            if (!readerInitialized && !initPromise) {
              initPromise = initialize();
            }
            if (initPromise) {
              await initPromise;
              initPromise = null;
            }

            // Return queued events first
            if (eventQueue.length > 0) {
              return { value: eventQueue.shift()!, done: false };
            }

            if (done) {
              return { value: undefined as unknown as StreamEvent, done: true };
            }

            // Read more data from the stream
            await readNextEvents();

            if (eventQueue.length > 0) {
              return { value: eventQueue.shift()!, done: false };
            }

            if (done) {
              return { value: undefined as unknown as StreamEvent, done: true };
            }

            // Keep reading until we get an event or stream ends
            while (!done && eventQueue.length === 0) {
              await readNextEvents();
            }

            if (eventQueue.length > 0) {
              return { value: eventQueue.shift()!, done: false };
            }

            return { value: undefined as unknown as StreamEvent, done: true };
          },

          async return(): Promise<IteratorResult<StreamEvent>> {
            if (reader) {
              await reader.cancel();
            }
            done = true;
            return { value: undefined as unknown as StreamEvent, done: true };
          },

          async throw(error: Error): Promise<IteratorResult<StreamEvent>> {
            if (reader) {
              await reader.cancel();
            }
            done = true;
            throw error;
          },
        };
      },
    };
  }

  /**
   * Get usage statistics for a tenant in a given period.
   */
  async getUsage(tenantId: string, period: string): Promise<UsageStats> {
    // Filter call logs for the given tenant and period
    const logs = this.callLogs.filter(
      (log) => log.tenantId === tenantId && log.status === 'success',
    );

    const stats: UsageStats = {
      inputTokens: logs.reduce((sum, log) => sum + log.inputTokens, 0),
      outputTokens: logs.reduce((sum, log) => sum + log.outputTokens, 0),
      totalCalls: logs.length,
      period,
    };

    return stats;
  }

  /**
   * Get all call logs (for testing/debugging purposes).
   */
  getCallLogs(): ReadonlyArray<LLMCallLog> {
    return this.callLogs;
  }

  /**
   * Clear all call logs.
   */
  clearCallLogs(): void {
    this.callLogs.length = 0;
  }

  // --- Private Methods ---

  /**
   * Enforce rate limit for a tenant. Throws RateLimitExceededError if limit is exceeded.
   */
  private async enforceRateLimit(tenantId: string, limit: number): Promise<void> {
    if (!this.rateLimiter) {
      return; // Rate limiting disabled when no Redis is configured
    }

    const result = await this.rateLimiter.checkRateLimit(tenantId, limit);
    if (!result.allowed) {
      throw new RateLimitExceededError({
        tenantId,
        currentCount: result.currentCount,
        limit: result.limit,
        resetInSeconds: result.resetInSeconds,
      });
    }
  }

  /**
   * Get tenant config or throw if not found.
   */
  private getTenantConfigOrThrow(tenantId: string): LLMGatewayConfig {
    const config = this.tenantConfigs.get(tenantId);
    if (!config) {
      throw new Error(`Tenant not found: ${tenantId}`);
    }
    return config;
  }

  /**
   * Build the Claude API request body.
   */
  private buildAPIRequest(
    request: LLMRequest,
    config: LLMGatewayConfig,
    stream: boolean,
  ): ClaudeAPIRequest {
    const apiRequest: ClaudeAPIRequest = {
      model: config.model,
      max_tokens: request.maxTokens ?? config.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: request.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      stream,
    };

    if (request.tools && request.tools.length > 0) {
      apiRequest.tools = request.tools;
    }

    if (request.system) {
      apiRequest.system = request.system;
    }

    return apiRequest;
  }

  /**
   * Make an HTTP call to the Claude API using native fetch.
   */
  private async callClaudeAPI(
    apiKey: string,
    body: ClaudeAPIRequest,
  ): Promise<Response> {
    return fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });
  }

  /**
   * Parse an SSE event from the Claude streaming API.
   */
  private parseSSEEvent(
    eventType: string,
    data: Record<string, unknown>,
  ): StreamEvent | null {
    switch (eventType) {
      case 'message_start': {
        const message = data.message as { id: string } | undefined;
        if (message) {
          return { type: 'message_start', message: { id: message.id } };
        }
        return null;
      }

      case 'content_block_start': {
        const index = data.index as number;
        const contentBlock = data.content_block as StreamEvent extends { type: 'content_block_start' } ? StreamEvent['contentBlock'] : never;
        if (contentBlock !== undefined) {
          return { type: 'content_block_start', index, contentBlock: contentBlock as LLMResponse['content'][number] };
        }
        return null;
      }

      case 'content_block_delta': {
        const index = data.index as number;
        const delta = data.delta as Record<string, unknown> | undefined;
        if (delta) {
          return {
            type: 'content_block_delta',
            index,
            delta: delta as StreamEvent extends { type: 'content_block_delta' } ? StreamEvent['delta'] : never,
          };
        }
        return null;
      }

      case 'content_block_stop': {
        const index = data.index as number;
        return { type: 'content_block_stop', index };
      }

      case 'message_delta': {
        const delta = data.delta as { stop_reason?: string } | undefined;
        const usage = data.usage as { output_tokens?: number } | undefined;
        if (delta) {
          return {
            type: 'message_delta',
            delta: { stopReason: (delta.stop_reason ?? 'end_turn') as LLMResponse['stopReason'] },
            usage: { outputTokens: usage?.output_tokens ?? 0 },
          };
        }
        return null;
      }

      case 'message_stop':
        return { type: 'message_stop' };

      case 'error': {
        const error = data.error as { type?: string; message?: string } | undefined;
        return {
          type: 'error',
          error: {
            type: error?.type ?? 'unknown_error',
            message: error?.message ?? 'Unknown error occurred',
          },
        };
      }

      default:
        // Ignore unknown event types (e.g., ping)
        return null;
    }
  }

  /**
   * Record a call log entry.
   * Persists to the database (fire-and-forget) when a repository is configured.
   */
  private recordCallLog(log: LLMCallLog): void {
    this.callLogs.push(log);
    this.logger.info(
      {
        tenantId: log.tenantId,
        sessionId: log.sessionId,
        model: log.model,
        inputTokens: log.inputTokens,
        outputTokens: log.outputTokens,
        latencyMs: log.latencyMs,
        status: log.status,
      },
      'LLM call logged',
    );

    // Fire-and-forget: persist to database without blocking the response
    if (this.callLogRepository) {
      this.callLogRepository.save(log).catch((error) => {
        this.logger.error(
          { error, tenantId: log.tenantId, sessionId: log.sessionId },
          'Failed to persist LLM call log to database',
        );
      });
    }
  }
}
