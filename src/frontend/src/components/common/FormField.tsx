import { type ReactNode } from 'react';
import styles from './FormField.module.css';

export interface FormFieldProps {
  /** Field label text */
  label: string;
  /** Field name for accessibility linking */
  name: string;
  /** Error message to display */
  error?: string;
  /** Whether the field is required */
  required?: boolean;
  /** The form input element(s) */
  children: ReactNode;
}

export function FormField({ label, name, error, required = false, children }: FormFieldProps): ReactNode {
  const errorId = `${name}-error`;

  return (
    <div className={`${styles.field} ${error ? styles.error : ''}`}>
      <div className={styles.labelRow}>
        <label htmlFor={name} className={styles.label}>
          {label}
        </label>
        {required && (
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        )}
      </div>
      <div className={styles.content} aria-describedby={error ? errorId : undefined}>
        {children}
      </div>
      {error && (
        <span id={errorId} className={styles.errorMessage} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
