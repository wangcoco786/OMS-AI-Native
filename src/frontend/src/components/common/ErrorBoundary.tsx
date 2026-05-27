import { Component, type ErrorInfo, type ReactNode } from 'react';
import styles from './ErrorBoundary.module.css';

export interface ErrorBoundaryProps {
  /** Child components to render */
  children: ReactNode;
  /** Optional custom fallback UI */
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className={styles.container} role="alert">
          <span className={styles.icon} aria-hidden="true">
            ⚠️
          </span>
          <h2 className={styles.title}>出现了一些问题</h2>
          <p className={styles.message}>
            {this.state.error?.message || '页面渲染时发生了未知错误，请尝试重新加载。'}
          </p>
          <button type="button" className={styles.retryButton} onClick={this.handleRetry}>
            重试
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
