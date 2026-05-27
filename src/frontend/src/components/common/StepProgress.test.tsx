import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StepProgress } from './StepProgress';

describe('StepProgress', () => {
  const steps = ['渠道连接', '基础配置', 'SKU 映射', '规则设置', '验证'];

  it('renders all step labels', () => {
    render(<StepProgress steps={steps} currentStep={0} />);
    steps.forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  it('marks the current step with aria-current', () => {
    render(<StepProgress steps={steps} currentStep={2} />);
    const items = screen.getAllByRole('listitem');
    expect(items[2]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).not.toHaveAttribute('aria-current');
  });

  it('shows checkmark for completed steps', () => {
    render(<StepProgress steps={steps} currentStep={3} completedSteps={[0, 1, 2]} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('✓');
    expect(items[1]).toHaveTextContent('✓');
    expect(items[2]).toHaveTextContent('✓');
    expect(items[3]).not.toHaveTextContent('✓');
  });

  it('shows step numbers for non-completed steps', () => {
    render(<StepProgress steps={steps} currentStep={1} completedSteps={[0]} />);
    const items = screen.getAllByRole('listitem');
    expect(items[1]).toHaveTextContent('2');
    expect(items[2]).toHaveTextContent('3');
  });

  it('renders as a navigation landmark', () => {
    render(<StepProgress steps={steps} currentStep={0} />);
    expect(screen.getByRole('navigation', { name: 'Progress' })).toBeInTheDocument();
  });
});
