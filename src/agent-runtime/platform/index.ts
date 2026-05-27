/**
 * Agent Platform
 *
 * Agent registration, lifecycle management,
 * request routing, and load balancing.
 */

export { AgentPlatformService } from './agent-platform.js';
export type { AgentPlatformConfig } from './agent-platform.js';
export type {
  AgentDefinition,
  AgentInstance,
  AgentFilter,
  AgentRequest,
  AgentPlatform,
  AgentEventPublisher,
  AgentStatusChangeEvent,
  RequestContext,
} from './types.js';
export { VALID_TRANSITIONS } from './types.js';
