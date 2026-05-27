import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ValidationStep } from './ValidationStep';
import { useOnboardingStore } from '@/stores/onboarding-store';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ValidationStep', () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset();
    useOnboardingStore.setState({
      sessionId: 'test-session',
      status: 'in_progress',
      currentStep: 'validation',
    });
    mockFetch.mockReset();
  });

  it('renders the step title and description', () => {
    render(<ValidationStep />);
    expect(screen.getByRole('heading', { name: '验证上线' })).toBeInTheDocument();
    expect(screen.getByText(/运行配置验证/)).toBeInTheDocument();
  });

  it('renders the run validation button', () => {
    render(<ValidationStep />);
    expect(screen.getByRole('button', { name: '运行验证' })).toBeInTheDocument();
  });

  it('renders the go live button as disabled initially', () => {
    render(<ValidationStep />);
    expect(screen.getByRole('button', { name: '确认上线' })).toBeDisabled();
  });

  it('shows validation results after running validation', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          checks: [
            { dimension: 'channel_connection', passed: true, details: '连接正常' },
            { dimension: 'sku_mapping_coverage', passed: true, details: '覆盖率 100%' },
            { dimension: 'logistics_rules', passed: true, details: '规则完整' },
            { dimension: 'inventory_association', passed: true, details: '库存关联完整' },
          ],
          simulation: null,
        }),
    });

    render(<ValidationStep />);
    fireEvent.click(screen.getByRole('button', { name: '运行验证' }));

    await waitFor(() => {
      expect(screen.getByText('渠道连接')).toBeInTheDocument();
      expect(screen.getByText('SKU 覆盖率')).toBeInTheDocument();
      expect(screen.getByText('物流规则')).toBeInTheDocument();
      expect(screen.getByText('库存关联')).toBeInTheDocument();
    });
  });

  it('enables go live button when all checks pass', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          checks: [
            { dimension: 'channel_connection', passed: true, details: '正常' },
            { dimension: 'sku_mapping_coverage', passed: true, details: '正常' },
            { dimension: 'logistics_rules', passed: true, details: '正常' },
            { dimension: 'inventory_association', passed: true, details: '正常' },
          ],
          simulation: null,
        }),
    });

    render(<ValidationStep />);
    fireEvent.click(screen.getByRole('button', { name: '运行验证' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '确认上线' })).not.toBeDisabled();
    });
  });

  it('shows fix suggestions for failed checks', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          checks: [
            { dimension: 'channel_connection', passed: true, details: '正常' },
            {
              dimension: 'sku_mapping_coverage',
              passed: false,
              details: '覆盖率不足',
              fixSuggestion: '请补充 SKU 映射',
            },
            { dimension: 'logistics_rules', passed: true, details: '正常' },
            { dimension: 'inventory_association', passed: true, details: '正常' },
          ],
          simulation: null,
        }),
    });

    render(<ValidationStep />);
    fireEvent.click(screen.getByRole('button', { name: '运行验证' }));

    await waitFor(() => {
      expect(screen.getByText(/请补充 SKU 映射/)).toBeInTheDocument();
    });

    // Go live should be disabled
    expect(screen.getByRole('button', { name: '确认上线' })).toBeDisabled();
  });

  it('shows simulation results when available', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          checks: [
            { dimension: 'channel_connection', passed: true, details: '正常' },
            { dimension: 'sku_mapping_coverage', passed: true, details: '正常' },
            { dimension: 'logistics_rules', passed: true, details: '正常' },
            { dimension: 'inventory_association', passed: true, details: '正常' },
          ],
          simulation: {
            success: true,
            steps: [
              { name: '订单接收', status: 'passed' },
              { name: 'SKU 解析', status: 'passed' },
              { name: '库存扣减', status: 'passed' },
              { name: '物流分配', status: 'passed' },
              { name: '发货确认', status: 'passed' },
            ],
          },
        }),
    });

    render(<ValidationStep />);
    fireEvent.click(screen.getByRole('button', { name: '运行验证' }));

    await waitFor(() => {
      expect(screen.getByText('订单流转模拟')).toBeInTheDocument();
      expect(screen.getByText('订单接收')).toBeInTheDocument();
      expect(screen.getByText('发货确认')).toBeInTheDocument();
    });
  });

  it('handles network errors gracefully with fallback data', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    render(<ValidationStep />);
    fireEvent.click(screen.getByRole('button', { name: '运行验证' }));

    // Should show fallback validation results
    await waitFor(() => {
      expect(screen.getByText('渠道连接')).toBeInTheDocument();
    });
  });
});
