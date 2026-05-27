import { type ReactNode } from 'react';
import styles from './StepProgress.module.css';

export interface StepProgressProps {
  /** Array of step labels */
  steps: string[];
  /** Current active step index (0-based) */
  currentStep: number;
  /** Array of completed step indices */
  completedSteps?: number[];
  /** Callback when a completed step is clicked for navigation */
  onStepClick?: (stepIndex: number) => void;
}

export function StepProgress({
  steps,
  currentStep,
  completedSteps = [],
  onStepClick,
}: StepProgressProps): ReactNode {
  return (
    <nav className={styles.container} aria-label="Progress">
      <ol className={styles.stepList} role="list">
        {steps.map((label, index) => {
          const isCompleted = completedSteps.includes(index);
          const isCurrent = index === currentStep;
          const isClickable = isCompleted && !isCurrent && !!onStepClick;
          const status = isCompleted ? 'completed' : isCurrent ? 'current' : 'upcoming';

          return (
            <li
              key={index}
              className={`${styles.step} ${styles[status]} ${isClickable ? styles.clickable : ''}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <button
                type="button"
                className={styles.indicator}
                onClick={() => isClickable && onStepClick(index)}
                disabled={!isClickable}
                aria-label={`${isCompleted ? '已完成' : isCurrent ? '当前' : '未开始'}: ${label}${isClickable ? '，点击跳转' : ''}`}
                tabIndex={isClickable ? 0 : -1}
              >
                <span className={styles.number} aria-hidden="true">
                  {isCompleted ? '✓' : index + 1}
                </span>
              </button>
              {index < steps.length - 1 && (
                <div
                  className={`${styles.connector} ${isCompleted ? styles.connectorCompleted : ''}`}
                  aria-hidden="true"
                />
              )}
              <span className={styles.label}>
                <span className="sr-only">
                  {isCompleted ? 'Completed: ' : isCurrent ? 'Current: ' : 'Upcoming: '}
                </span>
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
