/**
 * MCP Tool Registry Service Implementation
 *
 * Provides:
 * - Tool registration with PostgreSQL persistence + Redis cache invalidation
 * - Tool unregistration (soft-delete via status='inactive') + cache invalidation
 * - Tool discovery with Redis cache (5-min TTL) and PostgreSQL fallback
 * - Hot-plug support: register/unregister invalidates cache so next discover() is fresh
 *
 * Requirements: 3.1, 3.2, 3.3
 */

import pino from 'pino';

import type { PostgresDatabaseService } from '../database/database-service.js';
import type { RedisCacheService } from '../database/redis-service.js';
import { SchemaValidator } from './schema-validator.js';
import { ToolCallLogger } from './tool-call-logger.js';
import type { ToolExecutor } from './tool-executor.js';
import type {
  MCPToolRegistry as IMCPToolRegistry,
  MCPToolDefinition,
  ToolFilter,
  ToolRow,
  ToolCallRequest,
  ToolCallResult,
  ValidationResult,
} from './types.js';

/** Redis cache key for the tool registry */
const CACHE_KEY = 'tools:registry';

/** Cache TTL in seconds (5 minutes) */
const CACHE_TTL_SECONDS = 5 * 60;

/**
 * MCPToolRegistryService implements tool registration, discovery,
 * and cache management for the MCP Tool Registry.
 */
export class MCPToolRegistryService implements IMCPToolRegistry {
  private readonly logger: pino.Logger;
  private readonly schemaValidator: SchemaValidator;
  private readonly toolCallLogger: ToolCallLogger;
  private toolExecutor: ToolExecutor | null = null;

  constructor(
    private readonly db: PostgresDatabaseService,
    private readonly cache: RedisCacheService,
    options?: { logger?: pino.Logger; toolExecutor?: ToolExecutor },
  ) {
    this.logger = (options?.logger ?? pino({ name: 'tool-registry' })).child({
      component: 'mcp-tool-registry',
    });
    this.schemaValidator = new SchemaValidator();
    this.toolCallLogger = new ToolCallLogger(db, { logger: this.logger });
    if (options?.toolExecutor) {
      this.toolExecutor = options.toolExecutor;
    }
  }

  /**
   * Set the tool executor (sandbox) for tool invocation.
   * This allows late-binding of the executor after construction.
   */
  setToolExecutor(executor: ToolExecutor): void {
    this.toolExecutor = executor;
  }

  /**
   * Register a new tool definition.
   *
   * Inserts the tool into the PostgreSQL tools table and invalidates
   * the Redis cache so the next discover() call returns fresh data.
   */
  async register(tool: MCPToolDefinition): Promise<void> {
    this.logger.info({ toolName: tool.name, version: tool.version }, 'Registering tool');

    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO tools (name, description, version, input_schema, output_schema, permissions, timeout_ms, sandbox_type, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
         ON CONFLICT (name) DO UPDATE SET
           description = EXCLUDED.description,
           version = EXCLUDED.version,
           input_schema = EXCLUDED.input_schema,
           output_schema = EXCLUDED.output_schema,
           permissions = EXCLUDED.permissions,
           timeout_ms = EXCLUDED.timeout_ms,
           sandbox_type = EXCLUDED.sandbox_type,
           status = 'active',
           updated_at = NOW()`,
        [
          tool.name,
          tool.description,
          tool.version,
          JSON.stringify(tool.inputSchema),
          JSON.stringify(tool.outputSchema),
          tool.permissions,
          tool.timeout,
          tool.sandbox,
        ],
      );
    });

    // Invalidate cache for hot-plug support
    await this.invalidateCache();

    this.logger.info({ toolName: tool.name }, 'Tool registered successfully');
  }

  /**
   * Unregister a tool by name.
   *
   * Sets the tool's status to 'inactive' in PostgreSQL and invalidates
   * the Redis cache. The tool record is preserved for audit purposes.
   */
  async unregister(toolName: string): Promise<void> {
    this.logger.info({ toolName }, 'Unregistering tool');

    await this.db.transaction(async (tx) => {
      const result = await tx.query<ToolRow>(
        `UPDATE tools SET status = 'inactive', updated_at = NOW() WHERE name = $1 AND status = 'active' RETURNING id`,
        [toolName],
      );

      if (result.length === 0) {
        throw new Error(`Tool '${toolName}' not found or already inactive`);
      }
    });

    // Invalidate cache for hot-plug support
    await this.invalidateCache();

    this.logger.info({ toolName }, 'Tool unregistered successfully');
  }

  /**
   * Discover tools matching optional filter criteria.
   *
   * Checks Redis cache first. On cache miss, queries PostgreSQL
   * and caches the result with a 5-minute TTL.
   *
   * When a filter is provided, the cache is bypassed and a direct
   * PostgreSQL query is performed with the filter conditions.
   */
  async discover(filter?: ToolFilter): Promise<MCPToolDefinition[]> {
    // If no filter, try cache first
    if (!filter || Object.keys(filter).length === 0) {
      const cached = await this.getCachedTools();
      if (cached !== null) {
        this.logger.debug('Returning tools from cache');
        return cached;
      }
    }

    // Query PostgreSQL
    const tools = await this.queryTools(filter);

    // Cache result only when no filter is applied (full registry)
    if (!filter || Object.keys(filter).length === 0) {
      await this.cacheTools(tools);
    }

    return tools;
  }

  /**
   * Invoke a tool with the given request.
   *
   * Steps:
   * 1. Validate input against the tool's schema
   * 2. If validation fails, return error result immediately
   * 3. Delegate execution to the ToolExecutor (sandbox)
   * 4. Record execution time
   * 5. Log the call via ToolCallLogger (fire-and-forget)
   * 6. Return the ToolCallResult
   *
   * Requirements: 3.5
   */
  async invoke(request: ToolCallRequest): Promise<ToolCallResult> {
    this.logger.info(
      { toolName: request.toolName, traceId: request.traceId, callerId: request.callerId },
      'Invoking tool',
    );

    // Step 1: Validate input against tool schema
    const validation = await this.validate(request.toolName, request.input);

    if (!validation.valid) {
      const errorResult: ToolCallResult = {
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: `Input validation failed: ${validation.errors?.map((e) => e.message).join('; ') ?? 'unknown error'}`,
        },
        executionTime: 0,
      };

      // Log the failed validation (fire-and-forget)
      void this.toolCallLogger.log(request, errorResult);

      return errorResult;
    }

    // Step 2: Ensure a tool executor is configured
    if (!this.toolExecutor) {
      const errorResult: ToolCallResult = {
        success: false,
        error: {
          code: 'EXECUTOR_NOT_CONFIGURED',
          message: 'Tool executor (sandbox) is not configured',
        },
        executionTime: 0,
      };

      void this.toolCallLogger.log(request, errorResult);

      return errorResult;
    }

    // Step 3: Look up tool definition for execution config
    const tools = await this.discover({ name: request.toolName });
    const tool = tools.find((t) => t.name === request.toolName);

    if (!tool) {
      const errorResult: ToolCallResult = {
        success: false,
        error: {
          code: 'TOOL_NOT_FOUND',
          message: `Tool '${request.toolName}' not found`,
        },
        executionTime: 0,
      };

      void this.toolCallLogger.log(request, errorResult);

      return errorResult;
    }

    // Step 4: Execute the tool via the sandbox with timing
    const startTime = Date.now();
    let result: ToolCallResult;

    try {
      result = await this.toolExecutor.execute(request.toolName, request.input, {
        timeout: tool.timeout,
        sandbox: tool.sandbox,
      });
      // Ensure executionTime reflects our measurement
      result = { ...result, executionTime: Date.now() - startTime };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      result = {
        success: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown execution error',
        },
        executionTime,
      };
    }

    // Step 5: Log the call (fire-and-forget)
    void this.toolCallLogger.log(request, result);

    this.logger.info(
      {
        toolName: request.toolName,
        traceId: request.traceId,
        success: result.success,
        executionTimeMs: result.executionTime,
      },
      'Tool invocation completed',
    );

    return result;
  }

  /**
   * Validate input against a tool's input schema.
   *
   * Looks up the tool's inputSchema from the registry and validates
   * the provided input against it using JSON Schema validation.
   */
  async validate(toolName: string, input: unknown): Promise<ValidationResult> {
    this.logger.debug({ toolName }, 'Validating tool input');

    // Discover the tool by name
    const tools = await this.discover({ name: toolName });
    const tool = tools.find((t) => t.name === toolName);

    if (!tool) {
      return {
        valid: false,
        errors: [{ field: '', message: `Tool '${toolName}' not found` }],
      };
    }

    return this.schemaValidator.validate(tool.inputSchema, input);
  }

  // --- Private Methods ---

  /**
   * Get cached tool definitions from Redis.
   */
  private async getCachedTools(): Promise<MCPToolDefinition[] | null> {
    try {
      return await this.cache.cacheGet<MCPToolDefinition[]>(CACHE_KEY);
    } catch (error) {
      this.logger.warn({ error }, 'Failed to read tools from cache, falling back to DB');
      return null;
    }
  }

  /**
   * Cache tool definitions in Redis with TTL.
   */
  private async cacheTools(tools: MCPToolDefinition[]): Promise<void> {
    try {
      await this.cache.cacheSet(CACHE_KEY, tools, CACHE_TTL_SECONDS);
      this.logger.debug({ count: tools.length }, 'Tools cached successfully');
    } catch (error) {
      this.logger.warn({ error }, 'Failed to cache tools');
    }
  }

  /**
   * Invalidate the Redis cache for the tool registry.
   */
  private async invalidateCache(): Promise<void> {
    try {
      await this.cache.cacheDel(CACHE_KEY);
      this.logger.debug('Tool registry cache invalidated');
    } catch (error) {
      this.logger.warn({ error }, 'Failed to invalidate tool registry cache');
    }
  }

  /**
   * Query tools from PostgreSQL with optional filter criteria.
   */
  private async queryTools(filter?: ToolFilter): Promise<MCPToolDefinition[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    // Default: only active tools unless filter specifies otherwise
    if (filter?.status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(filter.status);
    } else {
      conditions.push(`status = $${paramIndex++}`);
      params.push('active');
    }

    if (filter?.name) {
      conditions.push(`name ILIKE $${paramIndex++}`);
      params.push(`%${filter.name}%`);
    }

    if (filter?.sandbox) {
      conditions.push(`sandbox_type = $${paramIndex++}`);
      params.push(filter.sandbox);
    }

    if (filter?.permission) {
      conditions.push(`$${paramIndex++} = ANY(permissions)`);
      params.push(filter.permission);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM tools ${whereClause} ORDER BY name ASC`;

    const rows = await this.db.transaction<ToolRow[]>(async (tx) => {
      return await tx.query<ToolRow>(sql, params);
    });

    return rows.map((row) => this.rowToToolDefinition(row));
  }

  /**
   * Convert a database row to an MCPToolDefinition.
   */
  private rowToToolDefinition(row: ToolRow): MCPToolDefinition {
    return {
      name: row.name,
      description: row.description ?? '',
      inputSchema: row.input_schema,
      outputSchema: row.output_schema,
      version: row.version,
      permissions: row.permissions ?? [],
      timeout: row.timeout_ms,
      sandbox: row.sandbox_type as 'docker' | 'v8-isolate',
    };
  }
}
