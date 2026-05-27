/**
 * Anomaly Detector
 *
 * Detects anomalous data points in a time series using a sliding window
 * approach based on moving average and standard deviation.
 *
 * A data point is marked as anomalous when it deviates from the moving
 * average by more than 2 standard deviations (configurable).
 */

import type pino from 'pino';

/** Configuration for the anomaly detector */
export interface AnomalyDetectorConfig {
  /** Number of data points in the sliding window (default: 7) */
  windowSize?: number;
  /** Number of standard deviations for anomaly threshold (default: 2) */
  stdDevThreshold?: number;
}

/** Default configuration */
const DEFAULTS: Required<AnomalyDetectorConfig> = {
  windowSize: 7,
  stdDevThreshold: 2,
};

/**
 * AnomalyDetector uses a sliding window of recent data points to compute
 * a moving average and standard deviation. Points that deviate beyond
 * the configured threshold are flagged as anomalies.
 */
export class AnomalyDetector {
  private readonly windowSize: number;
  private readonly stdDevThreshold: number;

  constructor(config?: AnomalyDetectorConfig, _logger?: pino.Logger) {
    this.windowSize = config?.windowSize ?? DEFAULTS.windowSize;
    this.stdDevThreshold = config?.stdDevThreshold ?? DEFAULTS.stdDevThreshold;
  }

  /**
   * Detect anomalies in a series of values.
   *
   * Returns an array of booleans where true indicates the corresponding
   * data point is anomalous (deviates > threshold × σ from the moving average).
   *
   * For the first `windowSize` points, we use all available preceding data
   * to compute the baseline. If fewer than 2 data points are available for
   * the window, the point is not marked as anomalous.
   */
  detect(values: number[]): boolean[] {
    if (values.length === 0) return [];

    const results: boolean[] = new Array(values.length).fill(false);

    for (let i = 0; i < values.length; i++) {
      // Determine the window: use up to `windowSize` preceding points
      const windowStart = Math.max(0, i - this.windowSize);
      const window = values.slice(windowStart, i);

      // Need at least 2 points to compute meaningful statistics
      if (window.length < 2) {
        results[i] = false;
        continue;
      }

      const mean = this.computeMean(window);
      const stdDev = this.computeStdDev(window, mean);

      // If standard deviation is 0 (all values identical), any different value is anomalous
      if (stdDev === 0) {
        results[i] = values[i] !== mean;
        continue;
      }

      const deviation = Math.abs(values[i] - mean);
      results[i] = deviation > this.stdDevThreshold * stdDev;
    }

    return results;
  }

  /**
   * Check if a single value is anomalous given a window of recent values.
   */
  isAnomaly(value: number, recentValues: number[]): boolean {
    if (recentValues.length < 2) return false;

    const mean = this.computeMean(recentValues);
    const stdDev = this.computeStdDev(recentValues, mean);

    if (stdDev === 0) {
      return value !== mean;
    }

    const deviation = Math.abs(value - mean);
    return deviation > this.stdDevThreshold * stdDev;
  }

  /**
   * Compute the arithmetic mean of an array of numbers.
   */
  computeMean(values: number[]): number {
    if (values.length === 0) return 0;
    const sum = values.reduce((acc, v) => acc + v, 0);
    return sum / values.length;
  }

  /**
   * Compute the population standard deviation of an array of numbers.
   */
  computeStdDev(values: number[], mean?: number): number {
    if (values.length === 0) return 0;
    const avg = mean ?? this.computeMean(values);
    const squaredDiffs = values.map((v) => (v - avg) ** 2);
    const variance = squaredDiffs.reduce((acc, v) => acc + v, 0) / values.length;
    return Math.sqrt(variance);
  }
}
