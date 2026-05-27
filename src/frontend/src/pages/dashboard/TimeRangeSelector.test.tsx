import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimeRangeSelector } from './TimeRangeSelector';
import { useDashboardStore } from '@/stores/dashboard-store';

describe('TimeRangeSelector', () => {
  beforeEach(() => {
    useDashboardStore.getState().resetFilters();
  });

  it('renders all preset buttons', () => {
    render(<TimeRangeSelector />);

    expect(screen.getByTestId('preset-1h')).toBeInTheDocument();
    expect(screen.getByTestId('preset-24h')).toBeInTheDocument();
    expect(screen.getByTestId('preset-7d')).toBeInTheDocument();
    expect(screen.getByTestId('preset-30d')).toBeInTheDocument();
  });

  it('renders preset buttons with correct labels', () => {
    render(<TimeRangeSelector />);

    expect(screen.getByTestId('preset-1h')).toHaveTextContent('最近1小时');
    expect(screen.getByTestId('preset-24h')).toHaveTextContent('最近24小时');
    expect(screen.getByTestId('preset-7d')).toHaveTextContent('最近7天');
    expect(screen.getByTestId('preset-30d')).toHaveTextContent('最近30天');
  });

  it('renders custom date range inputs', () => {
    render(<TimeRangeSelector />);

    expect(screen.getByTestId('time-range-start')).toBeInTheDocument();
    expect(screen.getByTestId('time-range-end')).toBeInTheDocument();
  });

  it('no preset is active initially', () => {
    render(<TimeRangeSelector />);

    expect(screen.getByTestId('preset-1h')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('preset-24h')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('preset-7d')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('preset-30d')).toHaveAttribute('aria-pressed', 'false');
  });

  it('activates preset button on click and updates store', () => {
    render(<TimeRangeSelector />);

    fireEvent.click(screen.getByTestId('preset-24h'));

    expect(screen.getByTestId('preset-24h')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('preset-1h')).toHaveAttribute('aria-pressed', 'false');

    const state = useDashboardStore.getState();
    expect(state.startTime).not.toBeNull();
    expect(state.endTime).not.toBeNull();
  });

  it('sets correct time range for 1h preset', () => {
    render(<TimeRangeSelector />);

    const before = Date.now();
    fireEvent.click(screen.getByTestId('preset-1h'));
    const after = Date.now();

    const state = useDashboardStore.getState();
    const start = new Date(state.startTime!).getTime();
    const end = new Date(state.endTime!).getTime();

    // End should be approximately now
    expect(end).toBeGreaterThanOrEqual(before);
    expect(end).toBeLessThanOrEqual(after);

    // Start should be approximately 1 hour before end
    const diff = end - start;
    expect(diff).toBeGreaterThanOrEqual(59 * 60 * 1000);
    expect(diff).toBeLessThanOrEqual(61 * 60 * 1000);
  });

  it('sets correct time range for 7d preset', () => {
    render(<TimeRangeSelector />);

    fireEvent.click(screen.getByTestId('preset-7d'));

    const state = useDashboardStore.getState();
    const start = new Date(state.startTime!).getTime();
    const end = new Date(state.endTime!).getTime();

    const diff = end - start;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(diff).toBeGreaterThanOrEqual(sevenDaysMs - 1000);
    expect(diff).toBeLessThanOrEqual(sevenDaysMs + 1000);
  });

  it('updates store when custom start time is changed', () => {
    render(<TimeRangeSelector />);

    fireEvent.change(screen.getByTestId('time-range-start'), {
      target: { value: '2024-01-15T10:00' },
    });

    const state = useDashboardStore.getState();
    expect(state.startTime).not.toBeNull();
    const startDate = new Date(state.startTime!);
    expect(startDate.getFullYear()).toBe(2024);
    expect(startDate.getMonth()).toBe(0); // January
    expect(startDate.getDate()).toBe(15);
  });

  it('updates store when custom end time is changed', () => {
    render(<TimeRangeSelector />);

    fireEvent.change(screen.getByTestId('time-range-end'), {
      target: { value: '2024-01-20T18:00' },
    });

    const state = useDashboardStore.getState();
    expect(state.endTime).not.toBeNull();
    const endDate = new Date(state.endTime!);
    expect(endDate.getFullYear()).toBe(2024);
    expect(endDate.getMonth()).toBe(0);
    expect(endDate.getDate()).toBe(20);
  });

  it('clears active preset when custom date is entered', () => {
    render(<TimeRangeSelector />);

    // First select a preset
    fireEvent.click(screen.getByTestId('preset-24h'));
    expect(screen.getByTestId('preset-24h')).toHaveAttribute('aria-pressed', 'true');

    // Then enter a custom date
    fireEvent.change(screen.getByTestId('time-range-start'), {
      target: { value: '2024-01-15T10:00' },
    });

    // Preset should be deactivated
    expect(screen.getByTestId('preset-24h')).toHaveAttribute('aria-pressed', 'false');
  });

  it('has proper accessibility attributes', () => {
    render(<TimeRangeSelector />);

    expect(screen.getByRole('group', { name: '时间范围预设' })).toBeInTheDocument();
    expect(screen.getByLabelText('开始时间')).toBeInTheDocument();
    expect(screen.getByLabelText('结束时间')).toBeInTheDocument();
  });
});
