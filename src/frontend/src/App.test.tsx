import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import App from './App';

// Mock the api-client to prevent actual API calls
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue(null),
    post: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(null),
  },
}));

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>,
  );
}

describe('App', () => {
  it('renders the header with app name', () => {
    renderApp();
    expect(screen.getByText('OMS AI Native')).toBeInTheDocument();
  });

  it('renders sidebar navigation items', () => {
    renderApp();
    expect(screen.getAllByText('Dashboard').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('店铺接入')).toBeInTheDocument();
    expect(screen.getByText('SKU 映射')).toBeInTheDocument();
    expect(screen.getByText('数据同步')).toBeInTheDocument();
  });

  it('renders the dashboard route by default', () => {
    window.history.pushState({}, '', '/dashboard');
    renderApp();
    // Dashboard page shows loading spinner initially while fetching data
    const dashboardPage = screen.queryByTestId('dashboard-page');
    const loadingIndicator = screen.queryByRole('status');
    expect(dashboardPage || loadingIndicator).toBeTruthy();
  });
});
