/**
 * PostgreSQL Database Service Implementation
 *
 * Provides:
 * - Connection pool management (100+ concurrent connections)
 * - Multi-tenant data isolation (automatic tenant_id injection)
 * - Transaction support with proper rollback
 * - Connection retry with exponential backoff
 * - Logging via pino
 */

import pg from 'pg';
import pino from 'pino';
import { exec } from 'child_process';
import { promisify } from 'util';

import type {
  PostgresConfig,
  ConnectionRetryConfig,
  Transaction,
  PoolStats,
  DatabaseService,
} from './types.js';

const { Pool } = pg;
type Pool = InstanceType<typeof Pool>;
type PoolClient = pg.PoolClient;

const execAsync = promisify(exec);

/** Default retry configuration */
const DEFAULT_RETRY_CONFIG: ConnectionRetryConfig = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * PostgresDatabaseService implements the DatabaseService interface
 * with connection pooling, multi-tenant isolation, and retry logic.
 */
export class PostgresDatabaseService implements DatabaseService {
  private pool: Pool;
  private readonly logger: pino.Logger;
  private readonly config: PostgresConfig;
  private readonly retryConfig: ConnectionRetryConfig;

  constructor(
    config: PostgresConfig,
    options?: {
      retryConfig?: Partial<ConnectionRetryConfig>;
      logger?: pino.Logger;
    },
  ) {
    this.config = config;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...options?.retryConfig };
    this.logger = (options?.logger ?? pino({ name: 'database-service' })).child({
      component: 'postgres',
    });

    this.pool = this.createPool();
    this.setupPoolEventHandlers();
  }

  /**
   * Execute a SQL query with automatic tenant_id filtering.
   *
   * The tenantId is appended as the last parameter and a WHERE clause
   * condition `tenant_id = $N` is injected into the query.
   */
  async query<T>(sql: string, params: unknown[], tenantId: string): Promise<T[]> {
    const { isolatedSql, isolatedParams } = this.injectTenantFilter(sql, params, tenantId);

    return this.executeWithRetry(async () => {
      const client = await this.pool.connect();
      try {
        const result = await client.query(isolatedSql, isolatedParams);
        return result.rows as T[];
      } finally {
        client.release();
      }
    });
  }

  /**
   * Execute a function within a database transaction.
   * Automatically rolls back on error.
   */
  async transaction<T>(fn: (tx: Transaction) => Promise<T>, _tenantId?: string): Promise<T> {
    const client = await this.acquireClientWithRetry();

    try {
      await client.query('BEGIN');

      const tx: Transaction = {
        query: async <R>(sql: string, params?: unknown[]): Promise<R[]> => {
          const result = await client.query(sql, params ?? []);
          return result.rows as R[];
        },
        client,
      };

      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error({ error }, 'Transaction rolled back due to error');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Run database migrations using node-pg-migrate.
   */
  async migrate(direction: 'up' | 'down'): Promise<void> {
    const databaseUrl = this.buildConnectionString();
    const cmd = `npx node-pg-migrate ${direction} --migrations-dir migrations --migration-file-language sql --database-url "${databaseUrl}"`;

    this.logger.info({ direction }, 'Running database migration');

    try {
      const { stdout, stderr } = await execAsync(cmd);
      if (stdout) this.logger.info({ stdout: stdout.trim() }, 'Migration output');
      if (stderr) this.logger.warn({ stderr: stderr.trim() }, 'Migration stderr');
    } catch (error) {
      this.logger.error({ error }, 'Migration failed');
      throw error;
    }
  }

  /**
   * Get current connection pool statistics.
   */
  getPoolStats(): PoolStats {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
    };
  }

  /**
   * Gracefully shut down the connection pool.
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down database connection pool');
    await this.pool.end();
  }

  // --- Private Methods ---

  /**
   * Create a new connection pool with the configured settings.
   */
  private createPool(): Pool {
    return new Pool({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      max: this.config.poolSize,
      connectionTimeoutMillis: this.config.connectionTimeoutMs ?? 10000,
      idleTimeoutMillis: this.config.idleTimeoutMs ?? 30000,
      statement_timeout: this.config.statementTimeoutMs ?? 30000,
    });
  }

  /**
   * Set up event handlers for pool lifecycle events.
   */
  private setupPoolEventHandlers(): void {
    this.pool.on('error', (err) => {
      this.logger.error({ error: err }, 'Unexpected pool error - connection lost');
    });

    this.pool.on('connect', () => {
      this.logger.debug('New client connected to pool');
    });

    this.pool.on('remove', () => {
      this.logger.debug('Client removed from pool');
    });
  }

  /**
   * Inject tenant_id filter into a SQL query for multi-tenant isolation.
   *
   * Strategy: Appends `AND tenant_id = $N` if the query already has a WHERE clause,
   * or `WHERE tenant_id = $N` if it does not.
   */
  injectTenantFilter(
    sql: string,
    params: unknown[],
    tenantId: string,
  ): { isolatedSql: string; isolatedParams: unknown[] } {
    const paramIndex = params.length + 1;
    const tenantCondition = `tenant_id = $${paramIndex}`;

    // Normalize SQL for detection (case-insensitive)
    const upperSql = sql.toUpperCase();

    let isolatedSql: string;

    if (upperSql.includes('WHERE')) {
      // Insert tenant condition after the existing WHERE clause
      const whereIndex = upperSql.indexOf('WHERE');
      const afterWhere = whereIndex + 5; // length of 'WHERE'
      isolatedSql =
        sql.slice(0, afterWhere) + ` ${tenantCondition} AND` + sql.slice(afterWhere);
    } else {
      // Determine where to insert WHERE clause
      // Insert before ORDER BY, GROUP BY, HAVING, LIMIT, OFFSET if present
      const insertBeforeKeywords = ['ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET'];
      let insertPosition = sql.length;

      for (const keyword of insertBeforeKeywords) {
        const idx = upperSql.indexOf(keyword);
        if (idx !== -1 && idx < insertPosition) {
          insertPosition = idx;
        }
      }

      isolatedSql =
        sql.slice(0, insertPosition).trimEnd() +
        ` WHERE ${tenantCondition}` +
        (insertPosition < sql.length ? ' ' + sql.slice(insertPosition) : '');
    }

    return {
      isolatedSql,
      isolatedParams: [...params, tenantId],
    };
  }

  /**
   * Execute a database operation with exponential backoff retry.
   */
  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (!this.isRetryableError(error) || attempt === this.retryConfig.maxRetries) {
          break;
        }

        const delay = this.calculateBackoffDelay(attempt);
        this.logger.warn(
          { attempt: attempt + 1, maxRetries: this.retryConfig.maxRetries, delayMs: delay },
          'Query failed, retrying...',
        );

        await this.sleep(delay);
      }
    }

    this.logger.error(
      { error: lastError, maxRetries: this.retryConfig.maxRetries },
      'All retry attempts exhausted - triggering alert',
    );

    throw lastError;
  }

  /**
   * Acquire a pool client with retry logic for connection failures.
   */
  private async acquireClientWithRetry(): Promise<PoolClient> {
    return this.executeWithRetry(async () => {
      return await this.pool.connect();
    });
  }

  /**
   * Determine if an error is retryable (connection-related).
   */
  private isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    const retryableCodes = [
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'EPIPE',
      'EAI_AGAIN',
      'CONNECTION_LOST',
    ];

    const pgError = error as Error & { code?: string };

    // Check for pg error codes indicating connection issues
    if (pgError.code && retryableCodes.includes(pgError.code)) {
      return true;
    }

    // Check error message for connection-related keywords
    const message = error.message.toLowerCase();
    return (
      message.includes('connection') ||
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('econnreset')
    );
  }

  /**
   * Calculate exponential backoff delay with jitter.
   */
  private calculateBackoffDelay(attempt: number): number {
    const exponentialDelay =
      this.retryConfig.baseDelayMs * Math.pow(this.retryConfig.backoffMultiplier, attempt);
    const cappedDelay = Math.min(exponentialDelay, this.retryConfig.maxDelayMs);
    // Add jitter (±25%)
    const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(cappedDelay + jitter));
  }

  /**
   * Build a PostgreSQL connection string from config.
   */
  private buildConnectionString(): string {
    const { host, port, database, user, password } = this.config;
    return `postgresql://${user}:${password}@${host}:${port}/${database}`;
  }

  /**
   * Sleep for a given number of milliseconds.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
