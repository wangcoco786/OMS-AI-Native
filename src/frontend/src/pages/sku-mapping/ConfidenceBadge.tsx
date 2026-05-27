import { type ReactNode } from 'react';
import styles from './ConfidenceBadge.module.css';
import type { MatchType } from './types';

export interface ConfidenceBadgeProps {
  confidence: number;
  matchType: MatchType;
}

function getLabel(matchType: MatchType): string {
  switch (matchType) {
    case 'high_confidence':
      return '高置信度';
    case 'needs_review':
      return '需确认';
    case 'no_match':
      return '无匹配';
  }
}

export function ConfidenceBadge({ confidence, matchType }: ConfidenceBadgeProps): ReactNode {
  const label = getLabel(matchType);

  return (
    <span
      className={`${styles.badge} ${styles[matchType]}`}
      role="status"
      aria-label={`${label} - ${confidence}%`}
    >
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.label}>{label}</span>
      <span className={styles.score}>{confidence}%</span>
    </span>
  );
}
