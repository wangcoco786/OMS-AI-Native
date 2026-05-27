import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { BasicConfigStep } from './BasicConfigStep';
import { useOnboardingStore } from '@/stores/onboarding-store';

describe('BasicConfigStep', () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset();
    useOnboardingStore.setState({
      sessionId: 'test-session',
      status: 'in_progress',
      currentStep: 'basic_config',
    });
  });

  it('renders the step title and description', () => {
    render(<BasicConfigStep />);
    expect(screen.getByRole('heading', { name: '基础配置' })).toBeInTheDocument();
    expect(screen.getByText(/填写店铺基本信息/)).toBeInTheDocument();
  });

  it('renders all form fields', () => {
    render(<BasicConfigStep />);
    expect(screen.getByLabelText(/店铺名称/)).toBeInTheDocument();
    expect(screen.getByLabelText(/店铺描述/)).toBeInTheDocument();
    expect(screen.getByLabelText(/默认仓库/)).toBeInTheDocument();
    expect(screen.getByLabelText(/默认货币/)).toBeInTheDocument();
    expect(screen.getByLabelText(/时区/)).toBeInTheDocument();
  });

  it('shows real-time validation error for empty shop name', () => {
    render(<BasicConfigStep />);
    const input = screen.getByLabelText(/店铺名称/);

    // Type and then clear
    fireEvent.change(input, { target: { value: 'a' } });
    expect(screen.getByText('店铺名称至少 2 个字符')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByText('店铺名称不能为空')).toBeInTheDocument();
  });

  it('clears validation error when shop name is valid', () => {
    render(<BasicConfigStep />);
    const input = screen.getByLabelText(/店铺名称/);

    fireEvent.change(input, { target: { value: 'a' } });
    expect(screen.getByText('店铺名称至少 2 个字符')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '我的店铺' } });
    expect(screen.queryByText('店铺名称至少 2 个字符')).not.toBeInTheDocument();
    expect(screen.queryByText('店铺名称不能为空')).not.toBeInTheDocument();
  });

  it('has default values for currency and timezone', () => {
    render(<BasicConfigStep />);
    const currencySelect = screen.getByLabelText(/默认货币/) as HTMLSelectElement;
    const timezoneSelect = screen.getByLabelText(/时区/) as HTMLSelectElement;

    expect(currencySelect.value).toBe('CNY');
    expect(timezoneSelect.value).toBe('Asia/Shanghai');
  });

  it('persists form data to the store', () => {
    render(<BasicConfigStep />);

    fireEvent.change(screen.getByLabelText(/店铺名称/), { target: { value: '测试店铺' } });
    fireEvent.change(screen.getByLabelText(/默认货币/), { target: { value: 'USD' } });

    const state = useOnboardingStore.getState();
    const data = state.stepData.basic_config.data as Record<string, unknown>;
    expect(data.shopName).toBe('测试店铺');
    expect(data.defaultCurrency).toBe('USD');
  });

  it('restores saved data from store', () => {
    useOnboardingStore.setState({
      stepData: {
        ...useOnboardingStore.getState().stepData,
        basic_config: {
          status: 'in_progress',
          data: {
            shopName: '已保存店铺',
            shopDescription: '描述',
            defaultWarehouse: 'wh-shanghai',
            defaultCurrency: 'EUR',
            timezone: 'Europe/London',
          },
        },
      },
    });

    render(<BasicConfigStep />);

    expect((screen.getByLabelText(/店铺名称/) as HTMLInputElement).value).toBe('已保存店铺');
    expect((screen.getByLabelText(/默认货币/) as HTMLSelectElement).value).toBe('EUR');
    expect((screen.getByLabelText(/时区/) as HTMLSelectElement).value).toBe('Europe/London');
  });
});
