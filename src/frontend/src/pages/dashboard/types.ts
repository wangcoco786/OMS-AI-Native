export interface KPIMetrics {
  orderCount: number;
  fulfillmentRate: number;
  returnRate: number;
  avgProcessingTime: number;
}

export interface KPITrendPoint {
  timestamp: string;
  value: number;
  anomaly?: boolean;
}

export interface KPITrendData {
  metric: KPIMetricName;
  granularity: TimeGranularity;
  points: KPITrendPoint[];
}

export type TimeGranularity = 'hour' | 'day' | 'week';

export type KPIMetricName =
  | 'orderCount'
  | 'fulfillmentRate'
  | 'returnRate'
  | 'avgProcessingTime';

export interface DashboardFilters {
  granularity: TimeGranularity;
  shopId?: string;
  channelId?: string;
  warehouseId?: string;
}

/** Time range for custom date selection */
export interface TimeRange {
  startTime: string; // ISO date string
  endTime: string;   // ISO date string
}

/** Preset time range options */
export type TimeRangePreset = '1h' | '24h' | '7d' | '30d';

/** Multi-metric trend data point */
export interface MultiMetricTrendPoint {
  timestamp: string;
  [metricKey: string]: string | number | boolean | undefined;
}

/** Multi-metric trend data */
export interface MultiMetricTrendData {
  granularity: TimeGranularity;
  metrics: KPIMetricName[];
  points: MultiMetricTrendPoint[];
}

/** Metric configuration for multi-metric chart */
export interface MetricConfig {
  key: KPIMetricName;
  label: string;
  color: string;
  visible: boolean;
  yAxisId?: 'left' | 'right';
}

/** Event annotation on the chart */
export interface EventAnnotation {
  id: string;
  timestamp: string;
  type: 'deployment' | 'promotion' | 'sync_error' | 'custom';
  label: string;
  description: string;
  color?: string;
}
