import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DashboardFilters } from './DashboardFilters';
import { useDashboardStore } from '@/stores/dashboard-store';

describe('DashboardFilters', () => {
  beforeEach(() => {
    useDashboardStore.getState().resetFilters();
  });

  it('renders granularity toggle buttons', () => {
    render(<DashboardFilters />);

    expect(screen.getByTestId('granularity-hour')).toBeInTheDocument();
    expect(screen.getByTestId('granularity-day')).toBeInTheDocument();
    expect(screen.getByTestId('granularity-week')).toBeInTheDocument();
  });

  it('highlights the active granularity button', () => {
    render(<DashboardFilters />);

    // Default is 'day'
    expect(screen.getByTestId('granularity-day')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('granularity-hour')).toHaveAttribute('aria-pressed', 'false');
  });

  it('changes granularity when a button is clicked', () => {
    render(<DashboardFilters />);

    fireEvent.click(screen.getByTestId('granularity-hour'));

    expect(useDashboardStore.getState().granularity).toBe('hour');
    expect(screen.getByTestId('granularity-hour')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('granularity-day')).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders shop filter dropdown', () => {
    render(<DashboardFilters />);

    const shopSelect = screen.getByTestId('filter-shop');
    expect(shopSelect).toBeInTheDocument();
    expect(shopSelect).toHaveValue('');
  });

  it('renders channel filter dropdown', () => {
    render(<DashboardFilters />);

    const channelSelect = screen.getByTestId('filter-channel');
    expect(channelSelect).toBeInTheDocument();
    expect(channelSelect).toHaveValue('');
  });

  it('renders warehouse filter dropdown', () => {
    render(<DashboardFilters />);

    const warehouseSelect = screen.getByTestId('filter-warehouse');
    expect(warehouseSelect).toBeInTheDocument();
    expect(warehouseSelect).toHaveValue('');
  });

  it('updates store when shop filter changes', () => {
    render(<DashboardFilters />);

    fireEvent.change(screen.getByTestId('filter-shop'), { target: { value: 'shop-1' } });

    expect(useDashboardStore.getState().shopId).toBe('shop-1');
  });

  it('updates store when channel filter changes', () => {
    render(<DashboardFilters />);

    fireEvent.change(screen.getByTestId('filter-channel'), { target: { value: 'shopify' } });

    expect(useDashboardStore.getState().channelId).toBe('shopify');
  });

  it('updates store when warehouse filter changes', () => {
    render(<DashboardFilters />);

    fireEvent.change(screen.getByTestId('filter-warehouse'), { target: { value: 'wh-1' } });

    expect(useDashboardStore.getState().warehouseId).toBe('wh-1');
  });

  it('clears filter when empty option is selected', () => {
    useDashboardStore.getState().setShopId('shop-1');
    render(<DashboardFilters />);

    fireEvent.change(screen.getByTestId('filter-shop'), { target: { value: '' } });

    expect(useDashboardStore.getState().shopId).toBeNull();
  });
});
