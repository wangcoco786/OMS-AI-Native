import { type ReactNode } from 'react';
import styles from './LoadingSpinner.module.css';

export type SpinnerSize = 'sm' | 'md' | 'lg';

export interface LoadingSpinnerProps {
  /** Optional loading message */
  message?: string;
  /** Spinner size */
  size?: SpinnerSize;
}

export function LoadingSpinner({ message, size = 'md' }: LoadingSpinnerProps): ReactNode {
  return (
    <div className={styles.container} role="status" aria-live="polite">
      <div className={`${styles.spinner} ${styles[size]}`} aria-hidden="true" />
      {message ? (
        <span className={styles.message}>{message}</span>
      ) : (
        <span className="sr-only">Loading...</span>
      )}
    </div>
  );
}
