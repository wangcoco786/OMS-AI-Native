/**
 * Shift Service
 *
 * Provides shift workbench queries:
 * - Task list by shift with priority sorting (high < medium < low)
 * - Progress calculation: completedCount / totalCount
 * - Handover task statistics: tasks from previous shift with status ≠ 'completed'
 *
 * Enforces tenant isolation on all queries.
 */

import pino from 'pino';

import type { PostgresDatabaseService } from '../../infrastructure/database/database-service.js';
import type { RedisCacheService } from '../../infrastructure/database/redis-service.js';
import type { ShiftTask, ShiftProgress, SortOptions } from '../../shared/m2-types.js';
import { CACHE_TTL } from './kpi-aggregator.js';

/** Dependencies for ShiftService */
export interface ShiftServiceDeps {
  db: PostgresDatabaseService;
  redis: RedisCacheService;
  logger?: pino.Logger;
}

/** Raw shift task row from database */
interface ShiftTaskRow {
  id: string;
  type: string;
  priority: string;
  status: string;
  deadline: string | null;
  assignee: string | null;
  shift_id: string;
}

/** Priority ordering for sorting (lower number = higher priority) */
const PRIORITY_ORDER: Record<string, number> = {
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * ShiftService provides shift workbench task queries with
 * priority sorting and progress tracking.
 */
export class ShiftService {
  private readonly db: PostgresDatabaseService;
  private readonly redis: RedisCacheService;
  private readonly logger: pino.Logger;

  constructor(deps: ShiftServiceDeps) {
    this.db = deps.db;
    this.redis = deps.redis;
    this.logger = (deps.logger ?? pino({ name: 'dashboard' })).child({ component: 'shift-service' });
  }

  /**
   * Get tasks for a specific shift, sorted by priority (high first).
   * Supports custom sort options.
   */
  async getShiftTasks(
    tenantId: string,
    shiftId: string,
    sort?: SortOptions,
  ): Promise<ShiftTask[]> {
    this.logger.debug({ tenantId, shiftId, sort }, 'Querying shift tasks');

    const cacheKey = `shift_tasks:${tenantId}:${shiftId}:${JSON.stringify(sort ?? {})}`;
    const cached = await this.tryGetFromCache<ShiftTask[]>(cacheKey);
    if (cached) {
      return cached;
    }

    // Query tasks for this shift
    const sql = `
      SELECT id, type, priority, status, deadline, assignee, shift_id
      FROM shift_tasks
      WHERE shift_id = $1
      ORDER BY 
        CASE priority 
          WHEN 'high' THEN 1 
          WHEN 'medium' THEN 2 
          WHEN 'low' THEN 3 
        END ASC,
        deadline ASC NULLS LAST
    `;
    const params = [shiftId];

    const rows = await this.db.query<ShiftTaskRow>(sql, params, tenantId);

    let tasks: ShiftTask[] = rows.map((row) => ({
      id: row.id,
      type: row.type as ShiftTask['type'],
      priority: row.priority as ShiftTask['priority'],
      status: row.status as ShiftTask['status'],
      deadline: row.deadline ? new Date(row.deadline) : undefined,
      assignee: row.assignee ?? undefined,
    }));

    // Apply custom sort if provided
    if (sort) {
      tasks = this.applySortOptions(tasks, sort);
    }

    // Cache for 60 seconds
    await this.cacheResult(cacheKey, tasks, CACHE_TTL.realtime);

    return tasks;
  }

  /**
   * Get progress for a specific shift.
   * Calculates completedCount/totalCount and handover tasks.
   */
  async getShiftProgress(tenantId: string, shiftId: string): Promise<ShiftProgress> {
    this.logger.debug({ tenantId, shiftId }, 'Querying shift progress');

    const cacheKey = `shift_progress:${tenantId}:${shiftId}`;
    const cached = await this.tryGetFromCache<ShiftProgress>(cacheKey);
    if (cached) {
      return cached;
    }

    // Get total and completed task counts
    const countSql = `
      SELECT 
        COUNT(*) as total_tasks,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_tasks
      FROM shift_tasks
      WHERE shift_id = $1
    `;
    const countResult = await this.db.query<{ total_tasks: string; completed_tasks: string }>(
      countSql,
      [shiftId],
      tenantId,
    );

    const totalTasks = parseInt(countResult[0]?.total_tasks ?? '0', 10);
    const completedTasks = parseInt(countResult[0]?.completed_tasks ?? '0', 10);
    const progressRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100 * 100) / 100 : 0;

    // Get handover tasks: tasks from previous shift that are not completed
    const handoverTasks = await this.getHandoverTaskCount(tenantId, shiftId);

    const progress: ShiftProgress = {
      shiftId,
      totalTasks,
      completedTasks,
      progressRate,
      handoverTasks,
    };

    // Cache for 60 seconds
    await this.cacheResult(cacheKey, progress, CACHE_TTL.realtime);

    return progress;
  }

  /**
   * Sort tasks by priority (high < medium < low).
   * This is a pure function useful for in-memory sorting.
   */
  sortByPriority(tasks: ShiftTask[]): ShiftTask[] {
    return [...tasks].sort((a, b) => {
      const priorityA = PRIORITY_ORDER[a.priority] ?? 99;
      const priorityB = PRIORITY_ORDER[b.priority] ?? 99;
      return priorityA - priorityB;
    });
  }

  /**
   * Calculate progress rate from completed and total counts.
   */
  calculateProgressRate(completedCount: number, totalCount: number): number {
    if (totalCount === 0) return 0;
    return Math.round((completedCount / totalCount) * 100 * 100) / 100;
  }

  // --- Private Methods ---

  /**
   * Get the count of handover tasks from the previous shift.
   * Handover tasks are tasks from the previous shift with status ≠ 'completed'.
   */
  private async getHandoverTaskCount(tenantId: string, currentShiftId: string): Promise<number> {
    // Find the previous shift
    const prevShiftSql = `
      SELECT id FROM shifts
      WHERE end_time <= (SELECT start_time FROM shifts WHERE id = $1 LIMIT 1)
      ORDER BY end_time DESC
      LIMIT 1
    `;
    const prevShiftResult = await this.db.query<{ id: string }>(prevShiftSql, [currentShiftId], tenantId);

    if (prevShiftResult.length === 0) {
      return 0;
    }

    const previousShiftId = prevShiftResult[0].id;

    // Count incomplete tasks from previous shift
    const handoverSql = `
      SELECT COUNT(*) as count
      FROM shift_tasks
      WHERE shift_id = $1 AND status != 'completed'
    `;
    const handoverResult = await this.db.query<{ count: string }>(handoverSql, [previousShiftId], tenantId);

    return parseInt(handoverResult[0]?.count ?? '0', 10);
  }

  /**
   * Apply custom sort options to a task list.
   */
  private applySortOptions(tasks: ShiftTask[], sort: SortOptions): ShiftTask[] {
    return [...tasks].sort((a, b) => {
      const field = sort.field as keyof ShiftTask;
      const aVal = a[field];
      const bVal = b[field];

      // Handle priority sorting specially
      if (field === 'priority') {
        const aOrder = PRIORITY_ORDER[aVal as string] ?? 99;
        const bOrder = PRIORITY_ORDER[bVal as string] ?? 99;
        return sort.direction === 'asc' ? aOrder - bOrder : bOrder - aOrder;
      }

      // Handle date sorting
      if (aVal instanceof Date && bVal instanceof Date) {
        return sort.direction === 'asc'
          ? aVal.getTime() - bVal.getTime()
          : bVal.getTime() - aVal.getTime();
      }

      // Handle string/number sorting
      if (aVal === undefined && bVal === undefined) return 0;
      if (aVal === undefined) return sort.direction === 'asc' ? 1 : -1;
      if (bVal === undefined) return sort.direction === 'asc' ? -1 : 1;

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sort.direction === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      return 0;
    });
  }

  /**
   * Try to get a value from Redis cache.
   */
  private async tryGetFromCache<T>(key: string): Promise<T | null> {
    try {
      return await this.redis.cacheGet<T>(key);
    } catch {
      return null;
    }
  }

  /**
   * Cache a result in Redis.
   */
  private async cacheResult(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.cacheSet(key, value, ttlSeconds);
    } catch {
      this.logger.warn('Cache write failed (non-fatal)');
    }
  }
}
