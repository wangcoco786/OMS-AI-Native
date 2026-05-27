/**
 * Agent Platform Service Implementation
 *
 * Provides:
 * - Agent registration with unique ID assignment
 * - Agent definition updates and version management
 * - Agent lifecycle state machine (registered → ready → running → paused → stopped)
 * - Agent query with filtering (type, status, tenant_id)
 * - Request routing by intent type with round-robin load balancing
 * - Context propagation (tenant_id, user_id, roles, permissions)
 * - State change event publishing to message broker
 * - Logging via pino
 */

import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';

import type {
  AgentDefinition,
  AgentInstance,
  AgentFilter,
  AgentRequest,
  AgentPlatform,
  AgentEventPublisher,
  AgentStatusChangeEvent,
} from './types.js';
import { VALID_TRANSITIONS } from './types.js';
import type { AgentStatus } from '../../shared/types.js';

/** Configuration for the Agent Platform service */
export interface AgentPlatformConfig {
  /** Exchange name for agent events */
  eventsExchange?: string;
}

const DEFAULT_EVENTS_EXCHANGE = 'agent.events';

/**
 * AgentPlatformService implements the AgentPlatform interface
 * with in-memory storage, lifecycle state machine, and round-robin routing.
 */
export class AgentPlatformService implements AgentPlatform {
  private readonly instances: Map<string, AgentInstance> = new Map();
  private readonly definitions: Map<string, AgentDefinition> = new Map();
  private readonly logger: pino.Logger;
  private readonly eventPublisher: AgentEventPublisher | null;
  private readonly eventsExchange: string;

  /** Round-robin index per agent type for load balancing */
  private readonly roundRobinIndex: Map<string, number> = new Map();

  constructor(options?: {
    logger?: pino.Logger;
    eventPublisher?: AgentEventPublisher;
    config?: AgentPlatformConfig;
  }) {
    this.logger = (options?.logger ?? pino({ name: 'agent-platform' })).child({
      component: 'agent-platform',
    });
    this.eventPublisher = options?.eventPublisher ?? null;
    this.eventsExchange = options?.config?.eventsExchange ?? DEFAULT_EVENTS_EXCHANGE;
  }

  /**
   * Register a new agent definition and create an instance.
   * Assigns a unique ID and sets initial status to 'registered'.
   */
  async registerAgent(definition: AgentDefinition, tenantId: string): Promise<AgentInstance> {
    const instanceId = uuidv4();
    const now = new Date();

    // Store the definition
    this.definitions.set(definition.id, definition);

    // Create the instance
    const instance: AgentInstance = {
      id: instanceId,
      definitionId: definition.id,
      tenantId,
      status: 'registered',
      activeSessions: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.instances.set(instanceId, instance);

    this.logger.info(
      { instanceId, definitionId: definition.id, tenantId, type: definition.type },
      'Agent registered',
    );

    await this.publishStatusChange(instanceId, undefined, 'registered', tenantId);

    return instance;
  }

  /**
   * Update an existing agent definition.
   * Supports partial updates for version management.
   */
  async updateAgent(id: string, updates: Partial<AgentDefinition>): Promise<void> {
    // Find the instance to get the definitionId
    const instance = this.instances.get(id);
    if (!instance) {
      throw new Error(`Agent instance not found: ${id}`);
    }

    const definition = this.definitions.get(instance.definitionId);
    if (!definition) {
      throw new Error(`Agent definition not found: ${instance.definitionId}`);
    }

    // Apply updates to the definition
    const updatedDefinition: AgentDefinition = {
      ...definition,
      ...updates,
      id: definition.id, // ID cannot be changed
    };

    this.definitions.set(definition.id, updatedDefinition);

    // Update the instance timestamp
    instance.updatedAt = new Date();
    this.instances.set(id, instance);

    this.logger.info(
      { instanceId: id, definitionId: definition.id, updates: Object.keys(updates) },
      'Agent definition updated',
    );
  }

  /**
   * Get a single agent instance by ID.
   * Throws if not found.
   */
  async getAgent(id: string): Promise<AgentInstance> {
    const instance = this.instances.get(id);
    if (!instance) {
      throw new Error(`Agent instance not found: ${id}`);
    }
    return instance;
  }

  /**
   * List agent instances matching the given filter criteria.
   * Supports filtering by type, status, and tenant_id.
   */
  async listAgents(filter: AgentFilter): Promise<AgentInstance[]> {
    const results: AgentInstance[] = [];

    for (const instance of this.instances.values()) {
      if (this.matchesFilter(instance, filter)) {
        results.push(instance);
      }
    }

    return results;
  }

  /**
   * Start an agent (transition to 'ready' from 'registered', or 'running' from 'paused').
   */
  async startAgent(id: string): Promise<void> {
    const instance = await this.getAgent(id);
    const currentStatus = instance.status;

    let targetStatus: AgentStatus;
    if (currentStatus === 'registered') {
      targetStatus = 'ready';
    } else if (currentStatus === 'paused') {
      targetStatus = 'running';
    } else {
      throw new Error(
        `Invalid state transition: cannot start agent in '${currentStatus}' status`,
      );
    }

    this.validateTransition(currentStatus, targetStatus);
    await this.transitionStatus(id, instance, targetStatus);
  }

  /**
   * Pause a running agent.
   */
  async pauseAgent(id: string): Promise<void> {
    const instance = await this.getAgent(id);
    this.validateTransition(instance.status, 'paused');
    await this.transitionStatus(id, instance, 'paused');
  }

  /**
   * Stop an agent (from ready, running, or paused).
   */
  async stopAgent(id: string): Promise<void> {
    const instance = await this.getAgent(id);
    this.validateTransition(instance.status, 'stopped');
    await this.transitionStatus(id, instance, 'stopped');
  }

  /**
   * Route a request to an appropriate agent instance based on intent type.
   * Uses round-robin load balancing among instances of the same type
   * that are in 'ready' or 'running' status.
   *
   * Propagates context (tenant_id, user_id, roles, permissions) to the selected agent.
   */
  async route(request: AgentRequest): Promise<AgentInstance> {
    const { intentType, context } = request;

    // Find all available instances matching the intent type
    const candidates = this.getRoutableCandidates(intentType);

    if (candidates.length === 0) {
      this.logger.warn(
        { intentType, tenantId: context.tenantId },
        'No available agent instances for intent type',
      );
      throw new Error(
        `No available agent for intent type '${intentType}'. All agents of this type may be stopped or paused.`,
      );
    }

    // Round-robin selection
    const selected = this.selectRoundRobin(intentType, candidates);

    this.logger.info(
      {
        intentType,
        selectedAgentId: selected.id,
        tenantId: context.tenantId,
        userId: context.userId,
        candidateCount: candidates.length,
      },
      'Request routed to agent',
    );

    return selected;
  }

  // --- Private Methods ---

  /**
   * Check if an instance matches the given filter criteria.
   */
  private matchesFilter(instance: AgentInstance, filter: AgentFilter): boolean {
    // Filter by tenant_id
    if (filter.tenantId && instance.tenantId !== filter.tenantId) {
      return false;
    }

    // Filter by status
    if (filter.status && instance.status !== filter.status) {
      return false;
    }

    // Filter by type (requires looking up the definition)
    if (filter.type) {
      const definition = this.definitions.get(instance.definitionId);
      if (!definition || definition.type !== filter.type) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validate that a state transition is allowed.
   * Throws an error for invalid transitions.
   */
  private validateTransition(currentStatus: AgentStatus, targetStatus: AgentStatus): void {
    const allowedTransitions = VALID_TRANSITIONS[currentStatus];
    if (!allowedTransitions.includes(targetStatus)) {
      throw new Error(
        `Invalid state transition: '${currentStatus}' → '${targetStatus}'. ` +
        `Allowed transitions from '${currentStatus}': [${allowedTransitions.join(', ')}]`,
      );
    }
  }

  /**
   * Perform the status transition and publish the event.
   */
  private async transitionStatus(
    id: string,
    instance: AgentInstance,
    newStatus: AgentStatus,
  ): Promise<void> {
    const oldStatus = instance.status;

    instance.status = newStatus;
    instance.updatedAt = new Date();
    this.instances.set(id, instance);

    this.logger.info(
      { instanceId: id, oldStatus, newStatus },
      'Agent status transitioned',
    );

    await this.publishStatusChange(id, oldStatus, newStatus, instance.tenantId);
  }

  /**
   * Publish a status change event to the message broker.
   */
  private async publishStatusChange(
    agentId: string,
    oldStatus: AgentStatus | undefined,
    newStatus: AgentStatus,
    tenantId: string,
  ): Promise<void> {
    if (!this.eventPublisher) {
      return;
    }

    const event: AgentStatusChangeEvent = {
      agentId,
      oldStatus: oldStatus ?? ('none' as AgentStatus),
      newStatus,
      timestamp: new Date().toISOString(),
      tenantId,
    };

    try {
      await this.eventPublisher.publish(
        `agent.status.${newStatus}`,
        event,
        {
          exchange: this.eventsExchange,
          routingKey: `agent.status.${newStatus}`,
          persistent: true,
        },
      );

      this.logger.debug(
        { agentId, oldStatus, newStatus, exchange: this.eventsExchange },
        'Status change event published',
      );
    } catch (error) {
      this.logger.error(
        { error, agentId, oldStatus, newStatus },
        'Failed to publish status change event',
      );
    }
  }

  /**
   * Get all routable candidates for a given intent type.
   * Candidates must be in 'ready' or 'running' status.
   */
  private getRoutableCandidates(intentType: string): AgentInstance[] {
    const candidates: AgentInstance[] = [];

    for (const instance of this.instances.values()) {
      if (instance.status !== 'ready' && instance.status !== 'running') {
        continue;
      }

      const definition = this.definitions.get(instance.definitionId);
      if (definition && definition.type === intentType) {
        candidates.push(instance);
      }
    }

    return candidates;
  }

  /**
   * Select an instance using round-robin load balancing.
   */
  private selectRoundRobin(intentType: string, candidates: AgentInstance[]): AgentInstance {
    const currentIndex = this.roundRobinIndex.get(intentType) ?? 0;
    const selectedIndex = currentIndex % candidates.length;
    const selected = candidates[selectedIndex];

    // Advance the index for next time
    this.roundRobinIndex.set(intentType, currentIndex + 1);

    return selected;
  }
}
