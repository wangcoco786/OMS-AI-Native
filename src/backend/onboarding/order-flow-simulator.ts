/**
 * Order Flow Simulator
 *
 * Simulates the complete order lifecycle from creation to shipment:
 * 1. Order Receiving — validates channel connection can accept orders
 * 2. SKU Resolution — resolves channel SKU to system SKU via mappings
 * 3. Inventory Deduction — checks sufficient stock and simulates deduction
 * 4. Logistics Allocation — verifies shipping rules can assign a carrier
 * 5. Shipment Confirmation — confirms the order can be marked as shipped
 *
 * Each step is timed and returns passed/failed/skipped status.
 * On failure, identifies the exact step and provides an error reason.
 * Generates a ValidationReport and persists it to the validation_reports table.
 *
 * Requirements: 3.3, 3.4, 3.7
 */

import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';

import type { DatabaseService } from '../../infrastructure/database/types.js';
import type {
  SimulationResult,
  SimulationStep,
  ValidationReport,
  ValidationCheckResult,
} from '../../shared/m2-types.js';

const logger = pino({ name: 'order-flow-simulator' });

/** Simulation step names in execution order */
const SIMULATION_STEPS = [
  'order_receiving',
  'sku_resolution',
  'inventory_deduction',
  'logistics_allocation',
  'shipment_confirmation',
] as const;

type SimulationStepName = (typeof SIMULATION_STEPS)[number];

/** Human-readable labels for simulation steps */
const STEP_LABELS: Record<SimulationStepName, string> = {
  order_receiving: '订单接收',
  sku_resolution: 'SKU 解析',
  inventory_deduction: '库存扣减',
  logistics_allocation: '物流分配',
  shipment_confirmation: '发货确认',
};

/** Dependencies for the OrderFlowSimulator */
export interface OrderFlowSimulatorDeps {
  db: DatabaseService;
}

/**
 * OrderFlowSimulator runs a simulated order through the full processing pipeline
 * to verify that all shop configurations are working correctly.
 */
export class OrderFlowSimulator {
  private readonly db: DatabaseService;

  constructor(deps: OrderFlowSimulatorDeps) {
    this.db = deps.db;
  }

  /**
   * Run the full order flow simulation for a shop.
   * Executes each step sequentially; stops on first failure (subsequent steps are skipped).
   */
  async simulate(tenantId: string, shopId: string): Promise<SimulationResult> {
    const steps: SimulationStep[] = [];
    let failed = false;
    let failedAt: string | undefined;
    let errorReason: string | undefined;

    for (const stepName of SIMULATION_STEPS) {
      if (failed) {
        steps.push({
          name: STEP_LABELS[stepName],
          status: 'skipped',
          duration: 0,
          details: 'Skipped due to prior step failure',
        });
        continue;
      }

      const startTime = Date.now();
      try {
        const result = await this.executeStep(tenantId, shopId, stepName);
        const duration = Date.now() - startTime;

        if (result.passed) {
          steps.push({
            name: STEP_LABELS[stepName],
            status: 'passed',
            duration,
            details: result.details,
          });
        } else {
          failed = true;
          failedAt = STEP_LABELS[stepName];
          errorReason = result.details;
          steps.push({
            name: STEP_LABELS[stepName],
            status: 'failed',
            duration,
            details: result.details,
          });
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        const message = error instanceof Error ? error.message : 'Unknown error';
        failed = true;
        failedAt = STEP_LABELS[stepName];
        errorReason = message;
        steps.push({
          name: STEP_LABELS[stepName],
          status: 'failed',
          duration,
          details: `Unexpected error: ${message}`,
        });
      }
    }

    const result: SimulationResult = {
      success: !failed,
      steps,
      ...(failed && { failedAt, errorReason }),
    };

    logger.info(
      { tenantId, shopId, success: result.success, failedAt: result.failedAt },
      'Order flow simulation completed',
    );

    return result;
  }

  /**
   * Generate a full validation report (combining checks and simulation)
   * and persist it to the validation_reports table.
   */
  async generateAndPersistReport(
    tenantId: string,
    shopId: string,
    checks: ValidationCheckResult[],
    simulation: SimulationResult,
    sessionId?: string,
  ): Promise<ValidationReport> {
    const allChecksPassed = checks.every((c) => c.passed);
    const canGoLive = allChecksPassed && simulation.success;

    const report: ValidationReport = {
      shopId,
      overallStatus: canGoLive ? 'pass' : 'fail',
      checks,
      simulation,
      generatedAt: new Date(),
      canGoLive,
    };

    // Persist to validation_reports table
    await this.persistReport(tenantId, shopId, report, sessionId);

    return report;
  }

  /**
   * Persist a validation report to the database.
   */
  private async persistReport(
    tenantId: string,
    shopId: string,
    report: ValidationReport,
    sessionId?: string,
  ): Promise<void> {
    const id = uuidv4();

    const sql = `
      INSERT INTO validation_reports (id, tenant_id, shop_id, session_id, overall_status, checks, simulation, can_go_live, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;

    const params = [
      id,
      shopId,
      sessionId ?? null,
      report.overallStatus,
      JSON.stringify(report.checks),
      JSON.stringify(report.simulation),
      report.canGoLive,
      report.generatedAt,
    ];

    try {
      await this.db.query(sql, params, tenantId);
      logger.info({ reportId: id, tenantId, shopId }, 'Validation report persisted');
    } catch (error) {
      logger.error({ error, tenantId, shopId }, 'Failed to persist validation report');
      throw error;
    }
  }

  /**
   * Execute a single simulation step.
   */
  private async executeStep(
    tenantId: string,
    shopId: string,
    step: SimulationStepName,
  ): Promise<{ passed: boolean; details: string }> {
    switch (step) {
      case 'order_receiving':
        return this.simulateOrderReceiving(tenantId, shopId);
      case 'sku_resolution':
        return this.simulateSkuResolution(tenantId, shopId);
      case 'inventory_deduction':
        return this.simulateInventoryDeduction(tenantId, shopId);
      case 'logistics_allocation':
        return this.simulateLogisticsAllocation(tenantId, shopId);
      case 'shipment_confirmation':
        return this.simulateShipmentConfirmation(tenantId, shopId);
    }
  }

  /**
   * Step 1: Order Receiving
   * Verifies the shop has an active channel connection that can receive orders.
   */
  private async simulateOrderReceiving(
    tenantId: string,
    shopId: string,
  ): Promise<{ passed: boolean; details: string }> {
    const rows = await this.db.query<{
      channel_type: string;
      channel_config: Record<string, unknown>;
      status: string;
    }>(
      `SELECT channel_type, channel_config, status FROM shops WHERE id = $1`,
      [shopId],
      tenantId,
    );

    if (rows.length === 0) {
      return { passed: false, details: 'Shop not found' };
    }

    const shop = rows[0];

    if (shop.status === 'pending') {
      return { passed: false, details: 'Shop channel connection is not active' };
    }

    if (!shop.channel_config || Object.keys(shop.channel_config).length === 0) {
      return { passed: false, details: 'No channel API credentials configured' };
    }

    return { passed: true, details: `Order can be received via ${shop.channel_type} channel` };
  }

  /**
   * Step 2: SKU Resolution
   * Verifies that at least one channel SKU can be resolved to a system SKU.
   */
  private async simulateSkuResolution(
    tenantId: string,
    shopId: string,
  ): Promise<{ passed: boolean; details: string }> {
    const rows = await this.db.query<{
      channel_sku_name: string;
      system_sku: string;
    }>(
      `SELECT cs.name as channel_sku_name, ss.sku as system_sku
       FROM sku_mappings sm
       JOIN channel_skus cs ON cs.id = sm.channel_sku_id
       JOIN system_skus ss ON ss.id = sm.system_sku_id
       WHERE cs.shop_id = $1 AND sm.system_sku_id IS NOT NULL
       LIMIT 1`,
      [shopId],
      tenantId,
    );

    if (rows.length === 0) {
      return { passed: false, details: 'No channel SKU can be resolved to a system SKU — no valid mappings found' };
    }

    return {
      passed: true,
      details: `SKU resolution successful: "${rows[0].channel_sku_name}" → "${rows[0].system_sku}"`,
    };
  }

  /**
   * Step 3: Inventory Deduction
   * Verifies that at least one mapped system SKU has available inventory.
   */
  private async simulateInventoryDeduction(
    tenantId: string,
    shopId: string,
  ): Promise<{ passed: boolean; details: string }> {
    const rows = await this.db.query<{
      system_sku_id: string;
      warehouse_id: string;
      quantity: number;
    }>(
      `SELECT i.system_sku_id, i.warehouse_id, i.quantity
       FROM inventory i
       JOIN sku_mappings sm ON sm.system_sku_id = i.system_sku_id
       JOIN channel_skus cs ON cs.id = sm.channel_sku_id
       WHERE cs.shop_id = $1 AND sm.system_sku_id IS NOT NULL AND i.quantity > 0
       LIMIT 1`,
      [shopId],
      tenantId,
    );

    if (rows.length === 0) {
      return {
        passed: false,
        details: 'No inventory available for mapped SKUs — cannot fulfill orders',
      };
    }

    return {
      passed: true,
      details: `Inventory available: warehouse "${rows[0].warehouse_id}" has ${rows[0].quantity} units`,
    };
  }

  /**
   * Step 4: Logistics Allocation
   * Verifies that logistics rules are configured and can allocate a shipping method.
   */
  private async simulateLogisticsAllocation(
    tenantId: string,
    shopId: string,
  ): Promise<{ passed: boolean; details: string }> {
    // Check onboarding session for rule_setup data
    const rows = await this.db.query<{ step_data: Record<string, unknown> }>(
      `SELECT step_data FROM onboarding_sessions
       WHERE shop_id = $1 AND status = 'in_progress'
       ORDER BY started_at DESC LIMIT 1`,
      [shopId],
      tenantId,
    );

    if (rows.length === 0) {
      return { passed: false, details: 'No onboarding session found — logistics rules not configured' };
    }

    const stepData = typeof rows[0].step_data === 'string'
      ? JSON.parse(rows[0].step_data as unknown as string)
      : rows[0].step_data;

    const ruleSetup = stepData?.rule_setup;

    if (!ruleSetup || ruleSetup.status !== 'completed') {
      return { passed: false, details: 'Logistics rules step not completed' };
    }

    const rules = ruleSetup.data?.rules ?? [];
    if (!Array.isArray(rules) || rules.length === 0) {
      return { passed: false, details: 'No shipping rules defined — cannot allocate logistics' };
    }

    return {
      passed: true,
      details: `Logistics allocation successful: ${rules.length} rule(s) available for matching`,
    };
  }

  /**
   * Step 5: Shipment Confirmation
   * Verifies that the system can mark an order as shipped (warehouse exists and is active).
   */
  private async simulateShipmentConfirmation(
    tenantId: string,
    shopId: string,
  ): Promise<{ passed: boolean; details: string }> {
    // Check that at least one active warehouse exists with inventory for this shop's SKUs
    const rows = await this.db.query<{
      warehouse_code: string;
      warehouse_name: string;
    }>(
      `SELECT w.code as warehouse_code, w.name as warehouse_name
       FROM warehouses w
       JOIN inventory i ON i.warehouse_id = w.id::text
       JOIN sku_mappings sm ON sm.system_sku_id = i.system_sku_id
       JOIN channel_skus cs ON cs.id = sm.channel_sku_id
       WHERE cs.shop_id = $1 AND w.status = 'active' AND i.quantity > 0
       LIMIT 1`,
      [shopId],
      tenantId,
    );

    if (rows.length === 0) {
      // Fallback: check if any active warehouse exists at all
      const warehouseRows = await this.db.query<{ code: string; name: string }>(
        `SELECT code, name FROM warehouses WHERE status = 'active' LIMIT 1`,
        [],
        tenantId,
      );

      if (warehouseRows.length === 0) {
        return { passed: false, details: 'No active warehouse found — cannot confirm shipment' };
      }

      return {
        passed: true,
        details: `Shipment can be confirmed via warehouse "${warehouseRows[0].name}" (${warehouseRows[0].code})`,
      };
    }

    return {
      passed: true,
      details: `Shipment confirmation ready: warehouse "${rows[0].warehouse_name}" (${rows[0].warehouse_code}) has stock`,
    };
  }
}
