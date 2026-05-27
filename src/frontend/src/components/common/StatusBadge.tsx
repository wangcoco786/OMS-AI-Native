import { type ReactNode } from 'react';
import styles from './StatusBadge.module.css';

export type StatusBadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'default';

export interface StatusBadgeProps {
  /** Status text to display */
  status: string;
  /** Color variant */
  variant?: StatusBadgeVariant;
}

export function StatusBadge({ status, variant = 'default' }: StatusBadgeProps): ReactNode {
  return (
    <span className={`${styles.badge} ${styles[variant]}`} role="status">
      {status}
    </span>
  );
}
