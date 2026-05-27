/**
 * Agent Platform Type Definitions
 *
 * Interfaces and types for Agent registration, lifecycle management,
 * request routing, and load balancing.
 */

import type { AgentStatus } from '../../shared/types.js';

/** Agent definition describing an agent's capabilities and configuration */
export interface AgentDefinition {
  id: string;
  name: string;
  type: string; // e.g., 'order-query', 'onboarding'
  version: string;
  description: string;
  tools: string[]; // allowed tool names
  systemPrompt: string;
  config: Record<string, unknown>;
}

/** A running instance of an agent */
export interface AgentInstance {
  id: string;
  definitionId: string;
  tenantId: string;
  status: AgentStatus;
  activeSessions: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Filter criteria for listing agents */
export interface AgentFilter {
  type?: string;
  status?: AgentStatus;
  tenantId?: string;
}

/** Context propagated with routed requests */
export interface RequestContext {
  tenantId: string;
  userId: string;
  roles: string[];
  permissions: string[];
}

/** A request to be routed to an appropriate agent */
export interface AgentRequest {
  intentType: string;
  context: RequestContext;
  payload?: unknown;
}

/** Event published when agent status changes */
export interface AgentStatusChangeEvent {
  agentId: string;
  oldStatus: AgentStatus;
  newStatus: AgentStatus;
  timestamp: string;
  tenantId: string;
}

/** Valid state transitions for the agent lifecycle */
export const VALID_TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  registered: ['ready'],
  ready: ['running', 'stopped'],
  running: ['paused', 'stopped'],
  paused: ['running', 'stopped'],
  stopped: [],
};

/** Agent Platform interface */
export interface AgentPlatform {
  /** Register a new agent and create an instance */
  registerAgent(definition: AgentDefinition, tenantId: string): Promise<AgentInstance>;
  /** Update an existing agent definition */
  updateAgent(id: string, updates: Partial<AgentDefinition>): Promise<void>;
  /** Get a single agent instance by ID */
  getAgent(id: string): Promise<AgentInstance>;
  /** List agents matching filter criteria */
  listAgents(filter: AgentFilter): Promise<AgentInstance[]>;
  /** Transition agent to 'ready' status (or resume from paused) */
  startAgent(id: string): Promise<void>;
  /** Pause a running agent */
  pauseAgent(id: string): Promise<void>;
  /** Stop an agent */
  stopAgent(id: string): Promise<void>;
  /** Route a request to an appropriate agent instance */
  route(request: AgentRequest): Promise<AgentInstance>;
}

/** Message broker interface (subset needed by agent platform) */
export interface AgentEventPublisher {
  publish(topic: string, message: unknown, options?: {
    exchange: string;
    routingKey: string;
    persistent: boolean;
  }): Promise<void>;
}
