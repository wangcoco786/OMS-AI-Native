/**
 * Onboarding Session Service
 *
 * Manages onboarding session lifecycle:
 * - createSession: Creates a new session with initial state
 * - getSession: Retrieves session from Redis cache or PostgreSQL
 * - resumeSession: Resumes an existing session, refreshing cache
 *
 * Storage strategy:
 * - Redis cache (TTL: 2h) for fast access
 * - PostgreSQL for persistence
 * - Write-through: writes go to both Redis and PostgreSQL
 * - Read: Redis first, fallback to PostgreSQL
 */

import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';

import type { RedisCacheService } from '../../infrastructure/database/redis-service.js';
import type { DatabaseService } from '../../infrastructure/database/types.js';
import type { OnboardingSession, OnboardingStep, StepData } from '../../shared/m2-types.js';

const logger = pino({ name: 'onboarding-session-service' });

/** Redis TTL for onboarding sessions: 2 hours */
const SESSION_CACHE_TTL = 2 * 60 * 60;

/** Redis key prefix for onboarding sessions */
const CACHE_KEY_PREFIX = 'onboarding';

/** All onboarding steps in order */
export const ONBOARDING_STEPS: OnboardingStep[] = [
  'channel_connection',
  'basic_config',
  'sku_mapping',
  'rule_setup',
  'validation',
];

/** Build Redis key for a session */
function buildSessionKey(sessionId: string): string {
  return `${CACHE_KEY_PREFIX}:${sessionId}:state`;
}

/** Create initial step data for all steps */
function createInitialStepData(): Record<OnboardingStep, StepData> {
  const stepData = {} as Record<OnboardingStep, StepData>;
  for (const step of ONBOARDING_STEPS) {
    stepData[step] = {
      status: 'pending',
      data: {},
    };
  }
  return stepData;
}

/** Dependencies for the session service */
export interface SessionServiceDeps {
  redis: RedisCacheService;
  db: DatabaseService;
}

/** Serializable session format for Redis/DB storage */
interface SerializedSession {
  id: string;
  tenantId: string;
  userId: string;
  shopId: string;
  currentStep: OnboardingStep;
  stepData: Record<OnboardingStep, StepData>;
  startedAt: string;
  completedSteps: OnboardingStep[];
  status: 'in_progress' | 'completed' | 'abandoned';
  metadata: {
    totalDuration?: number;
    interactionCount: number;
  };
}

/** Serialize session for storage */
function serializeSession(session: OnboardingSession & { status?: string }): SerializedSession {
  return {
    id: session.id,
    tenantId: session.tenantId,
    userId: session.userId,
    shopId: session.shopId,
    currentStep: session.currentStep,
    stepData: session.stepData,
    startedAt: session.startedAt instanceof Date
      ? session.startedAt.toISOString()
      : String(session.startedAt),
    completedSteps: session.completedSteps,
    status: (session as { status?: string }).status as 'in_progress' | 'completed' | 'abandoned' ?? 'in_progress',
    metadata: session.metadata,
  };
}

/** Deserialize session from storage */
function deserializeSession(data: SerializedSession): OnboardingSession {
  return {
    id: data.id,
    tenantId: data.tenantId,
    userId: data.userId,
    shopId: data.shopId,
    currentStep: data.currentStep,
    stepData: data.stepData,
    startedAt: new Date(data.startedAt),
    completedSteps: data.completedSteps,
    metadata: data.metadata,
  };
}

/**
 * OnboardingSessionService manages the lifecycle of onboarding sessions.
 * Uses Redis for fast access with PostgreSQL as the persistent store.
 */
export class OnboardingSessionService {
  private readonly redis: RedisCacheService;
  private readonly db: DatabaseService;

  constructor(deps: SessionServiceDeps) {
    this.redis = deps.redis;
    this.db = deps.db;
  }

  /**
   * Create a new onboarding session.
   * Initial state: currentStep='channel_connection', completedSteps=[], interactionCount=0, status='in_progress'
   */
  async createSession(tenantId: string, userId: string, shopId: string): Promise<OnboardingSession> {
    const id = uuidv4();
    const now = new Date();

    const session: OnboardingSession = {
      id,
      tenantId,
      userId,
      shopId,
      currentStep: 'channel_connection',
      stepData: createInitialStepData(),
      startedAt: now,
      completedSteps: [],
      metadata: {
        interactionCount: 0,
      },
    };

    // Persist to PostgreSQL
    await this.persistToDatabase(session);

    // Cache in Redis
    await this.cacheSession(session);

    logger.info({ sessionId: id, tenantId, userId, shopId }, 'Onboarding session created');

    return session;
  }

  /**
   * Get an existing session by ID.
   * Reads from Redis cache first, falls back to PostgreSQL.
   */
  async getSession(sessionId: string): Promise<OnboardingSession | null> {
    // Try Redis cache first
    const cached = await this.redis.cacheGet<SerializedSession>(buildSessionKey(sessionId));
    if (cached) {
      logger.debug({ sessionId }, 'Session loaded from cache');
      return deserializeSession(cached);
    }

    // Fallback to PostgreSQL
    const session = await this.loadFromDatabase(sessionId);
    if (session) {
      // Re-populate cache
      await this.cacheSession(session);
      logger.debug({ sessionId }, 'Session loaded from database and cached');
    }

    return session;
  }

  /**
   * Resume an existing session.
   * Refreshes the cache TTL and increments interaction count.
   */
  async resumeSession(sessionId: string): Promise<OnboardingSession | null> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    // Increment interaction count
    session.metadata.interactionCount += 1;

    // Update both stores
    await this.updateSession(session);

    logger.info({ sessionId, interactionCount: session.metadata.interactionCount }, 'Session resumed');

    return session;
  }

  /**
   * Update a session in both Redis and PostgreSQL.
   */
  async updateSession(session: OnboardingSession): Promise<void> {
    await this.persistToDatabase(session);
    await this.cacheSession(session);
  }

  /**
   * Cache session in Redis with TTL.
   */
  private async cacheSession(session: OnboardingSession): Promise<void> {
    const key = buildSessionKey(session.id);
    const serialized = serializeSession(session);
    await this.redis.cacheSet(key, serialized, SESSION_CACHE_TTL);
  }

  /**
   * Persist session to PostgreSQL.
   */
  private async persistToDatabase(session: OnboardingSession): Promise<void> {
    const sql = `
      INSERT INTO onboarding_sessions (id, tenant_id, user_id, shop_id, current_step, completed_steps, step_data, status, interaction_count, started_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        current_step = EXCLUDED.current_step,
        completed_steps = EXCLUDED.completed_steps,
        step_data = EXCLUDED.step_data,
        status = EXCLUDED.status,
        interaction_count = EXCLUDED.interaction_count
    `;

    const params = [
      session.id,
      session.userId,
      session.shopId,
      session.currentStep,
      session.completedSteps,
      JSON.stringify(session.stepData),
      'in_progress',
      session.metadata.interactionCount,
      session.startedAt,
    ];

    await this.db.query(sql, params, session.tenantId);
  }

  /**
   * Load session from PostgreSQL.
   */
  private async loadFromDatabase(sessionId: string): Promise<OnboardingSession | null> {
    const sql = `
      SELECT id, tenant_id, user_id, shop_id, current_step, completed_steps, step_data, status, interaction_count, started_at
      FROM onboarding_sessions
      WHERE id = $1
    `;

    // Use a wildcard tenant for lookup by ID (session ID is globally unique)
    const rows = await this.db.query<{
      id: string;
      tenant_id: string;
      user_id: string;
      shop_id: string;
      current_step: OnboardingStep;
      completed_steps: OnboardingStep[];
      step_data: Record<OnboardingStep, StepData>;
      status: string;
      interaction_count: number;
      started_at: string;
    }>(sql, [sessionId], '');

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      shopId: row.shop_id,
      currentStep: row.current_step,
      stepData: typeof row.step_data === 'string' ? JSON.parse(row.step_data) : row.step_data,
      startedAt: new Date(row.started_at),
      completedSteps: row.completed_steps ?? [],
      metadata: {
        interactionCount: row.interaction_count ?? 0,
      },
    };
  }
}
