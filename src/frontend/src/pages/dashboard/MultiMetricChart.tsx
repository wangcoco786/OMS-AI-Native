import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { useDashboardStore } from '@/stores/dashboard-store';
import type {
  KPIMetricName,
  MetricConfig,
  MultiMetricTrendPoint,
  EventAnnotation,
} from './types';
import styles from './MultiMetricChart.module.css';

const METRIC_CONFIGS: MetricConfig[] = [
  { key: 'orderCount', label: '订单量', color: '#3b82f6', visible: true, yAxisId: 'left' },
  { key: 'fulfillmentRate', label: '履约率', color: '#10b981', visible: true, yAxisId: 'right' },
  { key: 'returnRate', label: '退货率', color: '#f59e0b', visible: true, yAxisId: 'right' },
  { key: 'avgProcessingTime', label: '平均处理时长', color: '#8b5cf6', visible: true, yAxisId: 'left' },
];

interface MultiMetricChartProps {
  data: MultiMetricTrendPoint[];
  events?: EventAnnotation[];
  granularity?: string;
}

function formatTimestamp(timestamp: string, granularity?: string): string {
  const date = new Date(timestamp);
  switch (granularity) {
    case 'hour':
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    case 'day':
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    case 'week':
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    default:
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}

function getEventColor(type: EventAnnotation['type']): string {
  switch (type) {
    case 'deployment':
      return '#6366f1';
    case 'promotion':
      return '#f59e0b';
    case 'sync_error':
      return '#ef4444';
    default:
      return '#94a3b8';
  }
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    dataKey: string;
    value: number;
    color: string;
    payload: MultiMetricTrendPoint;
  }>;
  label?: string;
  data: MultiMetricTrendPoint[];
  visibleMetrics: KPIMetricName[];
}

function CustomTooltip({ active, payload, label, data, visibleMetrics }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const currentPoint = payload[0]?.payload;
  if (!currentPoint) return null;

  const currentIndex = data.findIndex((p) => p.timestamp === currentPoint.timestamp);
  const previousPoint = currentIndex > 0 ? data[currentIndex - 1] : null;

  const timestamp = new Date(currentPoint.timestamp);
  const formattedTime = timestamp.toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const hasAnomaly = visibleMetrics.some(
    (metric) => currentPoint[`${metric}_anomaly`] === true,
  );

  return (
    <div className={styles.tooltip} data-testid="chart-tooltip">
      <div className={styles.tooltipTime}>{formattedTime}</div>
      {payload.map((entry) => {
        const config = METRIC_CONFIGS.find((c) => c.key === entry.dataKey);
        if (!config) return null;

        const prevValue = previousPoint
          ? (previousPoint[entry.dataKey] as number | undefined)
          : undefined;
        const change =
          prevValue != null && prevValue !== 0
            ? ((entry.value - prevValue) / prevValue) * 100
            : null;

        return (
          <div key={entry.dataKey} className={styles.tooltipRow}>
            <span className={styles.tooltipDot} style={{ background: entry.color }} />
            <span className={styles.tooltipLabel}>{config.label}</span>
            <span className={styles.tooltipValue}>
              {entry.value.toLocaleString()}
            </span>
            {change !== null && (
              <span
                className={`${styles.tooltipChange} ${
                  change >= 0 ? styles.tooltipChangeUp : styles.tooltipChangeDown
                }`}
              >
                {change >= 0 ? '+' : ''}
                {change.toFixed(1)}%
              </span>
            )}
          </div>
        );
      })}
      {hasAnomaly && (
        <div className={styles.tooltipAnomaly}>⚠ 检测到异常波动</div>
      )}
    </div>
  );
}

export function MultiMetricChart({ data, events = [], granularity }: MultiMetricChartProps) {
  const { visibleMetrics, toggleMetric } = useDashboardStore();

  if (!data || data.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState} data-testid="multi-metric-chart-empty">
          暂无多指标趋势数据
        </div>
      </div>
    );
  }

  const chartData = data.map((point) => ({
    ...point,
    label: formatTimestamp(point.timestamp, granularity),
  }));

  const activeConfigs = METRIC_CONFIGS.filter((c) => visibleMetrics.includes(c.key));
  const hasLeftAxis = activeConfigs.some((c) => c.yAxisId === 'left');
  const hasRightAxis = activeConfigs.some((c) => c.yAxisId === 'right');

  return (
    <div className={styles.container} data-testid="multi-metric-chart">
      <div className={styles.metricToggles} role="group" aria-label="指标切换">
        {METRIC_CONFIGS.map((config) => {
          const isActive = visibleMetrics.includes(config.key);
          return (
            <button
              key={config.key}
              type="button"
              className={`${styles.metricToggle} ${isActive ? styles.metricToggleActive : ''}`}
              style={{ color: config.color }}
              onClick={() => toggleMetric(config.key)}
              aria-pressed={isActive}
              data-testid={`metric-toggle-${config.key}`}
            >
              <span className={styles.colorDot} style={{ background: config.color }} />
              {config.label}
            </button>
          );
        })}
      </div>

      <div className={styles.chartWrapper}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12, fill: '#64748b' }}
              tickLine={false}
            />
            {hasLeftAxis && (
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 12, fill: '#64748b' }}
                tickLine={false}
                axisLine={false}
              />
            )}
            {hasRightAxis && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 12, fill: '#64748b' }}
                tickLine={false}
                axisLine={false}
                domain={[0, 100]}
              />
            )}
            <Tooltip
              content={
                <CustomTooltip data={data} visibleMetrics={visibleMetrics} />
              }
            />
            <Legend />
            {activeConfigs.map((config) => (
              <Line
                key={config.key}
                type="monotone"
                dataKey={config.key}
                name={config.label}
                stroke={config.color}
                strokeWidth={2}
                yAxisId={config.yAxisId || 'left'}
                dot={{ r: 3 }}
                activeDot={{ r: 6 }}
                connectNulls
              />
            ))}
            {events.map((event) => (
              <ReferenceLine
                key={event.id}
                x={formatTimestamp(event.timestamp, granularity)}
                stroke={event.color || getEventColor(event.type)}
                strokeDasharray="4 4"
                strokeWidth={1.5}
                yAxisId={hasLeftAxis ? 'left' : 'right'}
                label={{
                  value: event.label,
                  position: 'top',
                  fill: event.color || getEventColor(event.type),
                  fontSize: 11,
                }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
