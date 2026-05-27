import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OnboardingWizard } from './OnboardingWizard';
import { useOnboardingStore } from '@/stores/onboarding-store';

// Mock the api-client module
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

function renderWizard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <OnboardingWizard />
    </QueryClientProvider>,
  );
}

describe('OnboardingWizard', () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset();
  });

  it('renders the wizard title', async () => {
    // Pre-set session to avoid loading state
    useOnboardingStore.setState({
      sessionId: 'test-session',
      status: 'in_progress',
      currentStep: 'channel_connection',
    });

    renderWizard();
    expect(screen.getByRole('heading', { name: '店铺接入向导' })).toBeInTheDocument();
  });

  it('renders step progress with all 5 steps', () => {
    useOnboardingStore.setState({
      sessionId: 'test-session',
      status: 'in_progress',
      currentStep: 'channel_connection',
    });

    renderWizard();
    expect(screen.getAllByText('渠道连接').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('基础配置')).toBeInTheDocument();
    expect(screen.getByText('SKU 映射')).toBeInTheDocument();
    expect(screen.getByText('规则配置')).toBeInTheDocument();
    expect(screen.getByText('验证上线')).toBeInTheDocument();
  });

  it('renders navigation buttons', () => {
    useOnboardingStore.setState({
      sessionId: 'test-session',
      status: 'in_progress',
      currentStep: 'channel_connection',
    });

    renderWizard();
    expect(screen.getByRole('button', { name: '上一步' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一步' })).toBeInTheDocument();
  });

  it('disables back button on first step', () => {
    useOnboardingStore.setState({
      sessionId: 'test-session',
      status: 'in_progress',
      currentStep: 'channel_connection',
    });

    renderWizard();
    expect(screen.getByRole('button', { name: '上一步' })).toBeDisabled();
  });

  it('shows "完成" on last step', () => {
    useOnboardingStore.setState({
      sessionId: 'test-session',
      status: 'in_progress',
      currentStep: 'validation',
      completedSteps: ['channel_connection', 'basic_config', 'sku_mapping', 'rule_setup'],
    });

    renderWizard();
    expect(screen.getByRole('button', { name: '完成' })).toBeInTheDocument();
  });

  it('shows loading state when no session exists', () => {
    useOnboardingStore.setState({
      sessionId: null,
      status: 'idle',
      isLoading: true,
    });

    renderWizard();
    expect(screen.getByText('正在初始化引导会话...')).toBeInTheDocument();
  });

  it('displays error message when error is set', () => {
    useOnboardingStore.setState({
      sessionId: 'test-session',
      status: 'in_progress',
      currentStep: 'channel_connection',
      error: '网络连接失败',
    });

    renderWizard();
    expect(screen.getByRole('alert')).toHaveTextContent('网络连接失败');
  });

  it('renders the current step placeholder content', () => {
    useOnboardingStore.setState({
      sessionId: 'test-session',
      status: 'in_progress',
      currentStep: 'basic_config',
    });

    renderWizard();
    expect(screen.getByRole('heading', { name: '基础配置' })).toBeInTheDocument();
  });
});
