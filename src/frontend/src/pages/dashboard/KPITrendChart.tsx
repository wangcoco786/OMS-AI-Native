import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Dot,
} from 'recharts';
import type { KPITrendData } from './types';

interface KPITrendChartProps {
  data: KPITrendData | null | undefined;
}

function formatTimestamp(timestamp: string, granularity: string): string {
  const date = new Date(timestamp);
  switch (granularity) {
    case 'hour':
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    case 'day':
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    case 'week':
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    default:
      return date.toLocaleDateString();
  }
}

function AnomalyDot(props: Record<string, unknown>) {
  const { cx, cy, payload } = props as {
    cx: number;
    cy: number;
    payload: { anomaly?: boolean };
  };

  if (payload?.anomaly) {
    return (
      <Dot
        cx={cx}
        cy={cy}
        r={6}
        fill="#ef4444"
        stroke="#fff"
        strokeWidth={2}
      />
    );
  }
  return <Dot cx={cx} cy={cy} r={3} fill="#3b82f6" stroke="none" />;
}

export function KPITrendChart({ data }: KPITrendChartProps) {
  if (!data || data.points.length === 0) {
    return (
      <div data-testid="kpi-trend-chart-empty" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
        暂无趋势数据
      </div>
    );
  }

  const chartData = data.points.map((point) => ({
    ...point,
    label: formatTimestamp(point.timestamp, data.granularity),
  }));

  return (
    <div data-testid="kpi-trend-chart" style={{ width: '100%', height: 300 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: '#64748b' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 12, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            }}
            formatter={(value: number) => [value.toLocaleString(), data.metric]}
            labelFormatter={(label: string) => `时间: ${label}`}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={<AnomalyDot />}
            activeDot={{ r: 6, fill: '#3b82f6' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
