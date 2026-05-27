/**
 * Sync Queue Manager
 *
 * Manages Bull Queue for data synchronization jobs.
 * Handles queue initialization, job scheduling with cron expressions,
 * job removal, status queries, and graceful shutdown.
 */

import Bull from 'bull';
import pino from 'pino';

import { validateCronExpression } from './cron-validator.js';
import type { SyncJobConfig } from '../../shared/m2-types.js';

const defaultLogger = pino({ name: 'queue-manager' });

/** Job data stored in the Bull queue */
export interface SyncJobData {
  jobId: string;
  tenantId: string;
  source: string;
  dataType: string;
  config: Record<string, unknown>;
}

/** Job status information */
export interface JobStatus {
  jobId: string;
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown';
  nextRun?: Date;
  lastRun?: Date;
  failedReason?: string;
}

/**
 * SyncQueueManager manages the Bull Queue lifecycle for data sync jobs.
 */
export class SyncQueueManager {
  private queue: Bull.Queue<SyncJobData> | null = null;
  private readonly logger: pino.Logger;
  private initialized: boolean = false;

  constructor(parentLogger?: pino.Logger) {
    this.logger = (parentLogger ?? defaultLogger).child({ component: 'sync-queue-manager' });
  }

  /**
   * Initialize the Bull Queue with a Redis connection.
   */
  initialize(redisUrl: string): void {
    if (this.initialized) {
      this.logger.warn('Queue manager already initialized');
      return;
    }

    this.queue = new Bull<SyncJobData>('data-sync', redisUrl, {
      defaultJobOptions: {
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 200, // Keep last 200 failed jobs
        attempts: 1, // Retries are handled by our own retry strategy
      },
    });

    this.setupEventHandlers();
    this.initialized = true;
    this.logger.info('Queue manager initialized');
  }

  /**
   * Schedule a sync job with a cron expression.
   * Validates the cron expression before scheduling.
   */
  async scheduleJob(config: SyncJobConfig): Promise<void> {
    this.ensureInitialized();

    // Validate cron expression
    const validation = validateCronExpression(config.cronExpression);
    if (!validation.valid) {
      throw new Error(`Invalid cron expression: ${validation.error}`);
    }

    if (!config.enabled) {
      this.logger.info({ jobId: config.id }, 'Job is disabled, skipping schedule');
      return;
    }

    const jobData: SyncJobData = {
      jobId: config.id,
      tenantId: config.tenantId,
      source: config.source,
      dataType: config.dataType,
      config: config.config,
    };

    await this.queue!.add(jobData, {
      repeat: {
        cron: config.cronExpression,
      },
      jobId: config.id,
    });

    this.logger.info(
      { jobId: config.id, cron: config.cronExpression },
      'Sync job scheduled',
    );
  }

  /**
   * Remove a scheduled job from the queue.
   */
  async removeJob(jobId: string): Promise<void> {
    this.ensureInitialized();

    // Remove repeatable jobs matching this jobId
    const repeatableJobs = await this.queue!.getRepeatableJobs();
    for (const job of repeatableJobs) {
      if (job.id === jobId) {
        await this.queue!.removeRepeatableByKey(job.key);
        this.logger.info({ jobId, key: job.key }, 'Repeatable job removed');
      }
    }

    // Also try to remove any existing job instance
    const existingJob = await this.queue!.getJob(jobId);
    if (existingJob) {
      await existingJob.remove();
      this.logger.info({ jobId }, 'Job instance removed');
    }
  }

  /**
   * Get the current status of a job.
   */
  async getJobStatus(jobId: string): Promise<JobStatus> {
    this.ensureInitialized();

    const job = await this.queue!.getJob(jobId);

    if (!job) {
      // Check if it's a repeatable job that hasn't run yet
      const repeatableJobs = await this.queue!.getRepeatableJobs();
      const repeatable = repeatableJobs.find((r) => r.id === jobId);

      if (repeatable) {
        return {
          jobId,
          state: 'waiting',
          nextRun: repeatable.next ? new Date(repeatable.next) : undefined,
        };
      }

      return { jobId, state: 'unknown' };
    }

    const state = await job.getState();
    const status: JobStatus = {
      jobId,
      state: state as JobStatus['state'],
    };

    if (job.processedOn) {
      status.lastRun = new Date(job.processedOn);
    }

    if (state === 'failed' && job.failedReason) {
      status.failedReason = job.failedReason;
    }

    return status;
  }

  /**
   * Get the underlying Bull Queue instance for registering processors.
   * Returns null if not initialized.
   */
  getQueue(): Bull.Queue<SyncJobData> | null {
    return this.queue;
  }

  /**
   * Check if the queue manager is initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Gracefully shut down the queue.
   */
  async shutdown(): Promise<void> {
    if (!this.queue) {
      this.logger.warn('Queue manager not initialized, nothing to shut down');
      return;
    }

    this.logger.info('Shutting down queue manager');
    await this.queue.close();
    this.queue = null;
    this.initialized = false;
    this.logger.info('Queue manager shut down complete');
  }

  // --- Private Methods ---

  private ensureInitialized(): void {
    if (!this.initialized || !this.queue) {
      throw new Error('Queue manager not initialized. Call initialize() first.');
    }
  }

  private setupEventHandlers(): void {
    if (!this.queue) return;

    this.queue.on('error', (error) => {
      this.logger.error({ error }, 'Queue error');
    });

    this.queue.on('failed', (job, error) => {
      this.logger.error(
        { jobId: job.id, jobData: job.data, error: error.message },
        'Job failed',
      );
    });

    this.queue.on('completed', (job) => {
      this.logger.info({ jobId: job.id, jobData: job.data }, 'Job completed');
    });

    this.queue.on('stalled', (job) => {
      this.logger.warn({ jobId: job.id }, 'Job stalled');
    });
  }
}
