import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KPICards } from './KPICards';
import type { KPIMetrics, KPITrendData } from './types';

const mockMetrics: KPIMetrics = {
  orderCount: 1234,
  fulfillmentRate: 95.5,
  returnRate: 3.2,
  avgProcessingTime: 45,
};

describe('KPICards', () => {
  it('renders all 4 KPI cards', () => {
    render(<KPICards metrics={mockMetrics} />);

    expect(screen.getByTestId('kpi-card-orderCount')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-card-fulfillmentRate')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-card-returnRate')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-card-avgProcessingTime')).toBeInTheDocument();
  });

  it('displays orderCount as a formatted number', () => {
    render(<KPICards metrics={mockMetrics} />);

    const card = screen.getByTestId('kpi-card-orderCount');
    expect(card).toHaveTextContent('1,234');
    expect(card).toHaveTextContent('订单量');
  });

  it('displays fulfillmentRate as a percentage', () => {
    render(<KPICards metrics={mockMetrics} />);

    const card = screen.getByTestId('kpi-card-fulfillmentRate');
    expect(card).toHaveTextContent('95.5%');
    expect(card).toHaveTextContent('履约率');
  });

  it('displays returnRate as a percentage', () => {
    render(<KPICards metrics={mockMetrics} />);

    const card = screen.getByTestId('kpi-card-returnRate');
    expect(card).toHaveTextContent('3.2%');
    expect(card).toHaveTextContent('退货率');
  });

  it('displays avgProcessingTime in minutes', () => {
    render(<KPICards metrics={mockMetrics} />);

    const card = screen.getByTestId('kpi-card-avgProcessingTime');
    expect(card).toHaveTextContent('45 分钟');
    expect(card).toHaveTextContent('平均处理时长');
  });

  it('shows anomaly indicator when latest trend point is anomalous', () => {
    const trendData: KPITrendData = {
      metric: 'orderCount',
      granularity: 'day',
      points: [
        { timestamp: '2024-01-01T00:00:00Z', value: 100 },
        { timestamp: '2024-01-02T00:00:00Z', value: 500, anomaly: true },
      ],
    };

    render(<KPICards metrics={mockMetrics} trendData={trendData} />);

    expect(screen.getByTestId('anomaly-icon-orderCount')).toBeInTheDocument();
  });

  it('does not show anomaly indicator when latest point is normal', () => {
    const trendData: KPITrendData = {
      metric: 'orderCount',
      granularity: 'day',
      points: [
        { timestamp: '2024-01-01T00:00:00Z', value: 100 },
        { timestamp: '2024-01-02T00:00:00Z', value: 110 },
      ],
    };

    render(<KPICards metrics={mockMetrics} trendData={trendData} />);

    expect(screen.queryByTestId('anomaly-icon-orderCount')).not.toBeInTheDocument();
  });

  it('shows up arrow when value is increasing', () => {
    const trendData: KPITrendData = {
      metric: 'orderCount',
      granularity: 'day',
      points: [
        { timestamp: '2024-01-01T00:00:00Z', value: 100 },
        { timestamp: '2024-01-02T00:00:00Z', value: 150 },
      ],
    };

    render(<KPICards metrics={mockMetrics} trendData={trendData} />);

    const card = screen.getByTestId('kpi-card-orderCount');
    expect(card.querySelector('[aria-label="上升趋势"]')).toBeInTheDocument();
  });

  it('shows down arrow when value is decreasing', () => {
    const trendData: KPITrendData = {
      metric: 'orderCount',
      granularity: 'day',
      points: [
        { timestamp: '2024-01-01T00:00:00Z', value: 150 },
        { timestamp: '2024-01-02T00:00:00Z', value: 100 },
      ],
    };

    render(<KPICards metrics={mockMetrics} trendData={trendData} />);

    const card = screen.getByTestId('kpi-card-orderCount');
    expect(card.querySelector('[aria-label="下降趋势"]')).toBeInTheDocument();
  });
});
