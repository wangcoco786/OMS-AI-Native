/**
 * Main Entry Point - Backend Services
 *
 * Bootstraps the Express server by:
 * 1. Creating service instances (auth, agent platform, tool registry, SDK wrapper, SSE manager)
 * 2. Calling createApp() with all dependencies
 * 3. Starting the HTTP server on the configured port
 *
 * This file wires together all components for the end-to-end flow:
 * WebSocket/HTTP → API Gateway → Agent Platform → Agent SDK → LLM Gateway → Tool → Response
 */

import pino from 'pino';

import { createApp } from './server.js';
import { createAuthService } from './auth/auth-service.js';
import { SSEManagerImpl } from './realtime/sse-manager.js';
import { AgentPlatformService } from '../agent-runtime/platform/agent-platform.js';
import { AgentSDKWrapperService } from '../agent-runtime/sdk/agent-sdk-wrapper.js';
import { MetricsCollector } from './observability/metrics.js';
import type { AgentPlatform } from '../agent-runtime/platform/types.js';
import type { MCPToolRegistry } from '../infrastructure/tools/types.js';
import type { AgentSDKWrapper } from '../agent-runtime/sdk/types.js';
import type { LLMGateway } from '../infrastructure/llm/types.js';

const logger = pino({ name: 'oms-backend' });

const PORT = parseInt(process.env.PORT ?? '3000', 10);

/**
 * Bootstrap and start the server.
 * Creates all service instances and wires them together.
 */
async function main(): Promise<void> {
  logger.info('Starting OMS AI Native backend...');

  // --- Auth Service ---
  const authService = createAuthService({
    ssoProvider: process.env.SSO_PROVIDER ?? 'internal',
    jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
    tokenExpiry: parseInt(process.env.TOKEN_EXPIRY ?? '3600', 10),
  });

  // --- Metrics ---
  const metrics = new MetricsCollector({ logger });

  // --- SSE Manager ---
  const sseManager = new SSEManagerImpl({ logger });

  // --- Agent Platform ---
  // In production, this would receive a real message broker.
  // For M1, we use the platform without event publishing.
  const agentPlatform: AgentPlatform = new AgentPlatformService();

  // --- LLM Gateway (placeholder for M1 bootstrap) ---
  // The real LLM Gateway is configured with Claude API keys per tenant.
  // For the entry point, we create a minimal gateway that the SDK wrapper needs.
  const llmGateway: LLMGateway = {
    async complete() {
      throw new Error('LLM Gateway not configured - set ANTHROPIC_API_KEY');
    },
    stream() {
      // Return an async iterable that immediately errors
      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              throw new Error('LLM Gateway not configured - set ANTHROPIC_API_KEY');
            },
          };
        },
      };
    },
    async getUsage() {
      return { inputTokens: 0, outputTokens: 0, totalCalls: 0, period: 'none' };
    },
  };

  // --- Agent SDK Wrapper ---
  const agentSDK: AgentSDKWrapper = new AgentSDKWrapperService(
    {
      llmGateway,
      contextWindowSize: 100_000,
      compressionThreshold: 0.8,
    },
    { logger },
  );

  // --- Tool Registry (placeholder for M1 bootstrap) ---
  // In production, this connects to PostgreSQL for tool storage.
  const toolRegistry: MCPToolRegistry = {
    async register() { /* no-op for bootstrap */ },
    async unregister() { /* no-op for bootstrap */ },
    async discover() { return []; },
    async invoke() { return { success: false, output: null, error: { code: 'NOT_CONFIGURED', message: 'Tool registry not configured' }, executionTime: 0 }; },
    async validate() { return { valid: true }; },
  };

  // --- Create Express App ---
  const app = createApp({
    authService,
    metrics,
    routes: {
      agentPlatform,
      toolRegistry,
      sessions: {
        agentSDK,
        sseManager,
      },
    },
  });

  // --- Start Listening ---
  app.listen(PORT, () => {
    logger.info({ port: PORT }, 'OMS AI Native server running');
  });
}

// Run the server
main().catch((error) => {
  logger.fatal({ error }, 'Failed to start server');
  process.exit(1);
});
