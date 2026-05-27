import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ConfidenceBadge } from './ConfidenceBadge';

describe('ConfidenceBadge', () => {
  it('renders high confidence badge with green styling', () => {
    render(<ConfidenceBadge confidence={92} matchType="high_confidence" />);

    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('高置信度');
    expect(badge).toHaveTextContent('92%');
    expect(badge).toHaveAttribute('aria-label', '高置信度 - 92%');
  });

  it('renders needs review badge with yellow styling', () => {
    render(<ConfidenceBadge confidence={65} matchType="needs_review" />);

    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('需确认');
    expect(badge).toHaveTextContent('65%');
    expect(badge).toHaveAttribute('aria-label', '需确认 - 65%');
  });

  it('renders no match badge with red styling', () => {
    render(<ConfidenceBadge confidence={0} matchType="no_match" />);

    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('无匹配');
    expect(badge).toHaveTextContent('0%');
    expect(badge).toHaveAttribute('aria-label', '无匹配 - 0%');
  });

  it('renders confidence at boundary (85) as high confidence', () => {
    render(<ConfidenceBadge confidence={85} matchType="high_confidence" />);

    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('高置信度');
    expect(badge).toHaveTextContent('85%');
  });

  it('renders confidence just below boundary (84) as needs review', () => {
    render(<ConfidenceBadge confidence={84} matchType="needs_review" />);

    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('需确认');
    expect(badge).toHaveTextContent('84%');
  });
});
