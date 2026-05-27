/**
 * M2 Shared Type Definitions
 *
 * Core interfaces and enums for OMS AI Native M2 milestone:
 * - Onboarding Agent
 * - SKU Mapper
 * - Dashboard Service
 * - Data Sync Service
 * - Configuration Validator
 */

// ============================================================
// Onboarding Types
// ============================================================

/** Onboarding 步骤定义 */
export type OnboardingStep =
  | 'channel_connection'
  | 'basic_config'
  | 'sku_mapping'
  | 'rule_setup'
  | 'validation';

/** Onboarding 会话 */
export interface OnboardingSession {
  id: string;
  tenantId: string;
  userId: string;
  shopId: string;
  currentStep: OnboardingStep;
  stepData: Record<OnboardingStep, StepData>;
  startedAt: Date;
  completedSteps: OnboardingStep[];
  metadata: {
    totalDuration?: number;
    interactionCount: number;
  };
}

/** 步骤数据 */
export interface StepData {
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  data: Record<string, unknown>;
  completedAt?: Date;
  validationErrors?: ValidationError[];
}

/** 验证错误 */
export interface ValidationError {
  field: string;
  message: string;
  code?: string;
}

/** 步骤提交结果 */
export interface StepResult {
  success: boolean;
  nextStep?: OnboardingStep;
  errors?: ValidationError[];
  suggestions?: string[];
}

/** 帮助内容 */
export interface HelpContent {
  step: OnboardingStep;
  title: string;
  description: string;
  tips?: string[];
  examples?: string[];
}

/** Onboarding 完成报告 */
export interface OnboardingReport {
  sessionId: string;
  shopId: string;
  totalDuration: number;
  interactionCount: number;
  completedSteps: OnboardingStep[];
  validationReport: ValidationReport;
  completedAt: Date;
}

// ============================================================
// SKU Types
// ============================================================

/** 渠道 SKU */
export interface ChannelSKU {
  id: string;
  channelId: string;
  externalId: string;
  name: string;
  description?: string;
  attributes: Record<string, string>;
  price?: number;
  imageUrl?: string;
}

/** 系统 SKU */
export interface SystemSKU {
  id: string;
  tenantId: string;
  sku: string;
  name: string;
  description?: string;
  attributes: Record<string, string>;
  category?: string;
  status: 'active' | 'inactive';
}

/** SKU 匹配结果 */
export interface SKUMatchResult {
  channelSkuId: string;
  systemSkuId: string | null;
  confidence: number;
  matchType: 'high_confidence' | 'needs_review' | 'no_match';
  reasoning: string;
  differencePoints?: string[];
  suggestNewSku?: boolean;
}

/** 匹配选项 */
export interface MatchOptions {
  confidenceThreshold?: number;
  batchSize?: number;
  useLearningData?: boolean;
}

/** 准确率统计 */
export interface AccuracyStats {
  totalMatches: number;
  correctMatches: number;
  accuracy: number;
  highConfidenceCount: number;
  needsReviewCount: number;
  noMatchCount: number;
}

/** 批量导入数据 */
export interface ImportData {
  tenantId: string;
  shopId: string;
  format: 'csv' | 'api';
  records: Omit<ChannelSKU, 'id'>[];
}

/** 批量导入结果 */
export interface ImportResult {
  totalRecords: number;
  importedCount: number;
  skippedCount: number;
  errors: Array<{ index: number; reason: string }>;
}

// ============================================================
// Dashboard Types
// ============================================================

/** KPI 指标 */
export interface KPIMetrics {
  orderCount: number;
  fulfillmentRate: number;
  returnRate: number;
  avgProcessingTime: number;
  period: TimePeriod;
  dimensions?: DimensionFilter;
}

/** 时间粒度 */
export type TimeGranularity = 'hour' | 'day' | 'week';

/** 时间段 */
export interface TimePeriod {
  start: Date;
  end: Date;
  granularity: TimeGranularity;
}

/** 维度筛选 */
export interface DimensionFilter {
  shopId?: string;
  channelId?: string;
  warehouseId?: string;
}

/** 趋势数据点 */
export interface TrendDataPoint {
  timestamp: Date;
  value: number;
  anomaly?: boolean;
}

/** 库存水位 */
export interface InventoryLevel {
  warehouseId: string;
  warehouseName: string;
  currentStock: number;
  maxCapacity: number;
  utilizationRate: number;
  turnoverRate: number;
  belowSafetyThreshold: boolean;
}

/** 班次任务 */
export interface ShiftTask {
  id: string;
  type: 'picking' | 'packing' | 'shipping';
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed';
  deadline?: Date;
  assignee?: string;
}

/** 班次进度 */
export interface ShiftProgress {
  shiftId: string;
  totalTasks: number;
  completedTasks: number;
  progressRate: number;
  handoverTasks: number;
}

/** 指标实时更新 */
export interface MetricUpdate {
  metric: string;
  value: number;
  timestamp: Date;
  tenantId: string;
  dimensions?: DimensionFilter;
}

/** 排序选项 */
export interface SortOptions {
  field: string;
  direction: 'asc' | 'desc';
}

// ============================================================
// Data Sync Types
// ============================================================

/** 同步数据源 */
export type SyncSource = 'shopify' | 'wms' | 'erp';

/** 同步数据类型 */
export type SyncDataType = 'orders' | 'inventory' | 'products';

/** 同步作业配置 */
export interface SyncJobConfig {
  id: string;
  tenantId: string;
  source: SyncSource;
  dataType: SyncDataType;
  cronExpression: string;
  enabled: boolean;
  config: Record<string, unknown>;
  lastSyncAt?: Date;
  lastSyncCursor?: string;
}

/** 同步作业结果 */
export interface SyncJobResult {
  jobId: string;
  status: 'success' | 'partial' | 'failed';
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  conflicts: ConflictRecord[];
  duration: number;
  error?: string;
}

/** 冲突记录 */
export interface ConflictRecord {
  recordId: string;
  field: string;
  localValue: unknown;
  remoteValue: unknown;
  resolution: 'remote_wins' | 'local_wins' | 'manual';
}

/** 同步统计 */
export interface SyncStats {
  totalJobs: number;
  activeJobs: number;
  lastHourSyncs: number;
  failureRate: number;
  avgDuration: number;
}

// ============================================================
// Validation Types
// ============================================================

/** 验证维度 */
export type ValidationDimension =
  | 'channel_connection'
  | 'sku_mapping_coverage'
  | 'logistics_rules'
  | 'inventory_association';

/** 验证检查结果 */
export interface ValidationCheckResult {
  dimension: ValidationDimension;
  passed: boolean;
  details: string;
  fixSuggestion?: string;
}

/** 模拟结果 */
export interface SimulationResult {
  success: boolean;
  failedAt?: string;
  errorReason?: string;
  steps: SimulationStep[];
}

/** 模拟步骤 */
export interface SimulationStep {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  details?: string;
}

/** 验证报告 */
export interface ValidationReport {
  shopId: string;
  overallStatus: 'pass' | 'fail';
  checks: ValidationCheckResult[];
  simulation: SimulationResult;
  generatedAt: Date;
  canGoLive: boolean;
}
