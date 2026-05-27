import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('renders status text', () => {
    render(<StatusBadge status="已完成" />);
    expect(screen.getByText('已完成')).toBeInTheDocument();
  });

  it('has role="status" for accessibility', () => {
    render(<StatusBadge status="处理中" />);
    expect(screen.getByRole('status')).toHaveTextContent('处理中');
  });

  it('applies default variant class when no variant specified', () => {
    const { container } = render(<StatusBadge status="默认" />);
    const badge = container.querySelector('[role="status"]');
    expect(badge?.className).toContain('default');
  });

  it('applies the correct variant class', () => {
    const { container } = render(<StatusBadge status="成功" variant="success" />);
    const badge = container.querySelector('[role="status"]');
    expect(badge?.className).toContain('success');
  });

  it('renders all variant types without error', () => {
    const variants = ['success', 'warning', 'error', 'info', 'default'] as const;
    variants.forEach((variant) => {
      const { unmount } = render(<StatusBadge status={variant} variant={variant} />);
      expect(screen.getByRole('status')).toBeInTheDocument();
      unmount();
    });
  });
});
