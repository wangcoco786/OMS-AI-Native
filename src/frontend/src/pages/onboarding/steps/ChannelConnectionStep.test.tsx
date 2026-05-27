import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChannelConnectionStep } from './ChannelConnectionStep';
import { useOnboardingStore } from '@/stores/onboarding-store';

// Mock fetch for connection test
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ChannelConnectionStep', () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset();
    useOnboardingStore.setState({
      sessionId: 'test-session',
      status: 'in_progress',
      currentStep: 'channel_connection',
    });
    mockFetch.mockReset();
  });

  it('renders the step title and description', () => {
    render(<ChannelConnectionStep />);
    expect(screen.getByRole('heading', { name: '渠道连接' })).toBeInTheDocument();
    expect(screen.getByText(/选择渠道类型并输入 API 凭证/)).toBeInTheDocument();
  });

  it('renders all form fields', () => {
    render(<ChannelConnectionStep />);
    expect(screen.getByLabelText(/渠道类型/)).toBeInTheDocument();
    expect(screen.getByLabelText(/API Key/)).toBeInTheDocument();
    expect(screen.getByLabelText(/API Secret/)).toBeInTheDocument();
    expect(screen.getByLabelText(/店铺 URL/)).toBeInTheDocument();
  });

  it('renders channel type options', () => {
    render(<ChannelConnectionStep />);
    const select = screen.getByLabelText(/渠道类型/) as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.querySelector('option[value="shopify"]')).toBeInTheDocument();
    expect(select.querySelector('option[value="wms"]')).toBeInTheDocument();
    expect(select.querySelector('option[value="erp"]')).toBeInTheDocument();
    expect(select.querySelector('option[value="custom"]')).toBeInTheDocument();
  });

  it('shows validation errors when test connection is clicked with empty fields', () => {
    render(<ChannelConnectionStep />);
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

    // Use role="alert" to target error messages specifically
    const alerts = screen.getAllByRole('alert');
    const alertTexts = alerts.map((el) => el.textContent);
    expect(alertTexts).toContain('请选择渠道类型');
    expect(alertTexts).toContain('API Key 不能为空');
    expect(alertTexts).toContain('API Secret 不能为空');
    expect(alertTexts).toContain('请输入店铺 URL');
  });

  it('shows URL format error for invalid URL', () => {
    render(<ChannelConnectionStep />);

    fireEvent.change(screen.getByLabelText(/渠道类型/), { target: { value: 'shopify' } });
    fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: 'key123' } });
    fireEvent.change(screen.getByLabelText(/API Secret/), { target: { value: 'secret123' } });
    fireEvent.change(screen.getByLabelText(/店铺 URL/), { target: { value: 'not-a-url' } });

    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

    expect(screen.getByText('请输入有效的 URL 格式')).toBeInTheDocument();
  });

  it('clears field error when user types', () => {
    render(<ChannelConnectionStep />);

    // Trigger validation
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
    expect(screen.getByText('API Key 不能为空')).toBeInTheDocument();

    // Type in the field
    fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: 'key' } });
    expect(screen.queryByText('API Key 不能为空')).not.toBeInTheDocument();
  });

  it('calls API when form is valid and shows success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    render(<ChannelConnectionStep />);

    fireEvent.change(screen.getByLabelText(/渠道类型/), { target: { value: 'shopify' } });
    fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: 'key123' } });
    fireEvent.change(screen.getByLabelText(/API Secret/), { target: { value: 'secret123' } });
    fireEvent.change(screen.getByLabelText(/店铺 URL/), {
      target: { value: 'https://store.myshopify.com' },
    });

    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

    // Wait for the async operation
    const successBadge = await screen.findByText(/连接成功/);
    expect(successBadge).toBeInTheDocument();
  });

  it('shows failure message when connection test fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: '凭证无效' }),
    });

    render(<ChannelConnectionStep />);

    fireEvent.change(screen.getByLabelText(/渠道类型/), { target: { value: 'shopify' } });
    fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: 'key123' } });
    fireEvent.change(screen.getByLabelText(/API Secret/), { target: { value: 'secret123' } });
    fireEvent.change(screen.getByLabelText(/店铺 URL/), {
      target: { value: 'https://store.myshopify.com' },
    });

    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

    const failBadge = await screen.findByText('凭证无效');
    expect(failBadge).toBeInTheDocument();
  });

  it('persists form data to the store', () => {
    render(<ChannelConnectionStep />);

    fireEvent.change(screen.getByLabelText(/渠道类型/), { target: { value: 'erp' } });
    fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: 'my-key' } });

    const state = useOnboardingStore.getState();
    const data = state.stepData.channel_connection.data as Record<string, unknown>;
    expect(data.channelType).toBe('erp');
    expect(data.apiKey).toBe('my-key');
  });
});
