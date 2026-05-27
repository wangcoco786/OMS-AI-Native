import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { LoadingSpinner } from './LoadingSpinner';

describe('LoadingSpinner', () => {
  it('renders with role="status"', () => {
    render(<LoadingSpinner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows message when provided', () => {
    render(<LoadingSpinner message="加载中..." />);
    const message = screen.getByText('加载中...');
    expect(message).toBeInTheDocument();
    expect(message).toBeVisible();
  });

  it('provides accessible text for screen readers when no message', () => {
    render(<LoadingSpinner />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('uses custom message as visible text when provided', () => {
    render(<LoadingSpinner message="正在获取数据" />);
    expect(screen.getByText('正在获取数据')).toBeInTheDocument();
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });

  it('renders different sizes without error', () => {
    const sizes = ['sm', 'md', 'lg'] as const;
    sizes.forEach((size) => {
      const { unmount } = render(<LoadingSpinner size={size} />);
      expect(screen.getByRole('status')).toBeInTheDocument();
      unmount();
    });
  });
});
