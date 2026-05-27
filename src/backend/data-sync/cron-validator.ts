/**
 * Cron Expression Validator
 *
 * Validates cron expressions and ensures the execution interval
 * is between 5 minutes and 24 hours as per requirement 9.2.
 */

import pino from 'pino';

const logger = pino({ name: 'cron-validator' });

/** Validation result for a cron expression */
export interface CronValidationResult {
  valid: boolean;
  error?: string;
}

/** Minimum allowed interval in minutes */
const MIN_INTERVAL_MINUTES = 5;

/** Maximum allowed interval in minutes (24 hours) */
const MAX_INTERVAL_MINUTES = 24 * 60;

/**
 * Parse a cron field into its numeric values.
 * Supports: *, numbers, ranges (1-5), steps (asterisk/5), and lists (1,3,5).
 */
function parseCronField(field: string, min: number, max: number): number[] | null {
  const values: Set<number> = new Set();

  const parts = field.split(',');
  for (const part of parts) {
    // Handle step values: */5 or 1-10/2
    if (part.includes('/')) {
      const [range, stepStr] = part.split('/');
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) return null;

      let start = min;
      let end = max;

      if (range !== '*') {
        if (range.includes('-')) {
          const [s, e] = range.split('-').map(Number);
          if (isNaN(s) || isNaN(e)) return null;
          start = s;
          end = e;
        } else {
          start = parseInt(range, 10);
          if (isNaN(start)) return null;
        }
      }

      if (start < min || end > max || start > end) return null;

      for (let i = start; i <= end; i += step) {
        values.add(i);
      }
    } else if (part === '*') {
      // All values
      for (let i = min; i <= max; i++) {
        values.add(i);
      }
    } else if (part.includes('-')) {
      // Range: 1-5
      const [startStr, endStr] = part.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (isNaN(start) || isNaN(end) || start < min || end > max || start > end) return null;
      for (let i = start; i <= end; i++) {
        values.add(i);
      }
    } else {
      // Single value
      const val = parseInt(part, 10);
      if (isNaN(val) || val < min || val > max) return null;
      values.add(val);
    }
  }

  return Array.from(values).sort((a, b) => a - b);
}

/**
 * Calculate the minimum interval in minutes for a cron expression.
 *
 * Strategy: Parse the minute and hour fields to determine the minimum
 * gap between consecutive executions.
 */
function calculateMinIntervalMinutes(cronExpression: string): number | null {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] = parts;

  // Parse each field
  const minutes = parseCronField(minuteField, 0, 59);
  const hours = parseCronField(hourField, 0, 23);
  const daysOfMonth = parseCronField(dayOfMonthField, 1, 31);
  const months = parseCronField(monthField, 1, 12);
  const daysOfWeek = parseCronField(dayOfWeekField, 0, 6);

  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return null;

  // If not running every day (restricted days of month or days of week),
  // the interval is at least 24 hours
  const runsEveryDay =
    daysOfMonth.length === 31 && months.length === 12 && daysOfWeek.length === 7;

  if (!runsEveryDay) {
    // Check if it runs at least once per day when it does run
    // The max interval could be multiple days, which exceeds 24h
    // For day-restricted crons, calculate the minimum gap between run days
    if (daysOfWeek.length < 7 && daysOfMonth.length === 31) {
      // Day of week restriction
      const minDayGap = calculateMinGapInSortedValues(daysOfWeek, 7);
      if (minDayGap > 1) {
        return minDayGap * 24 * 60;
      }
    } else if (daysOfMonth.length < 31) {
      // Day of month restriction
      const minDayGap = calculateMinGapInSortedValues(daysOfMonth, 31);
      if (minDayGap > 1) {
        return minDayGap * 24 * 60;
      }
    }
  }

  // Calculate all execution times within a day (in minutes from midnight)
  const executionTimes: number[] = [];
  for (const hour of hours) {
    for (const minute of minutes) {
      executionTimes.push(hour * 60 + minute);
    }
  }
  executionTimes.sort((a, b) => a - b);

  if (executionTimes.length === 0) return null;

  if (executionTimes.length === 1) {
    // Only runs once per day → interval is 24 hours
    return 24 * 60;
  }

  // Find minimum gap between consecutive execution times
  let minGap = Infinity;
  for (let i = 1; i < executionTimes.length; i++) {
    const gap = executionTimes[i] - executionTimes[i - 1];
    if (gap < minGap) minGap = gap;
  }

  // Also consider the wrap-around gap (last execution to first execution next day)
  const wrapGap = 24 * 60 - executionTimes[executionTimes.length - 1] + executionTimes[0];
  if (wrapGap < minGap) minGap = wrapGap;

  return minGap;
}

/**
 * Calculate the minimum gap between consecutive values in a sorted array,
 * considering wrap-around.
 */
function calculateMinGapInSortedValues(values: number[], wrapAt: number): number {
  if (values.length <= 1) return wrapAt;

  let minGap = Infinity;
  for (let i = 1; i < values.length; i++) {
    const gap = values[i] - values[i - 1];
    if (gap < minGap) minGap = gap;
  }

  // Wrap-around gap
  const wrapGap = wrapAt - values[values.length - 1] + values[0];
  if (wrapGap < minGap) minGap = wrapGap;

  return minGap;
}

/**
 * Validate a cron expression.
 *
 * Checks:
 * 1. Syntactic validity (5 fields, valid ranges)
 * 2. Interval constraint: minimum interval ≥ 5 minutes, maximum interval ≤ 24 hours
 */
export function validateCronExpression(expr: string): CronValidationResult {
  if (!expr || typeof expr !== 'string') {
    return { valid: false, error: 'Cron expression must be a non-empty string' };
  }

  const trimmed = expr.trim();
  const parts = trimmed.split(/\s+/);

  if (parts.length !== 5) {
    return {
      valid: false,
      error: `Cron expression must have exactly 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}`,
    };
  }

  // Validate each field can be parsed
  const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] = parts;

  if (!parseCronField(minuteField, 0, 59)) {
    return { valid: false, error: `Invalid minute field: "${minuteField}"` };
  }
  if (!parseCronField(hourField, 0, 23)) {
    return { valid: false, error: `Invalid hour field: "${hourField}"` };
  }
  if (!parseCronField(dayOfMonthField, 1, 31)) {
    return { valid: false, error: `Invalid day-of-month field: "${dayOfMonthField}"` };
  }
  if (!parseCronField(monthField, 1, 12)) {
    return { valid: false, error: `Invalid month field: "${monthField}"` };
  }
  if (!parseCronField(dayOfWeekField, 0, 6)) {
    return { valid: false, error: `Invalid day-of-week field: "${dayOfWeekField}"` };
  }

  // Calculate interval
  const intervalMinutes = calculateMinIntervalMinutes(trimmed);
  if (intervalMinutes === null) {
    return { valid: false, error: 'Unable to calculate execution interval from cron expression' };
  }

  if (intervalMinutes < MIN_INTERVAL_MINUTES) {
    return {
      valid: false,
      error: `Cron interval (${intervalMinutes} minutes) is less than the minimum allowed (${MIN_INTERVAL_MINUTES} minutes)`,
    };
  }

  if (intervalMinutes > MAX_INTERVAL_MINUTES) {
    return {
      valid: false,
      error: `Cron interval (${intervalMinutes} minutes) exceeds the maximum allowed (${MAX_INTERVAL_MINUTES} minutes / 24 hours)`,
    };
  }

  logger.debug({ cronExpression: trimmed, intervalMinutes }, 'Cron expression validated');

  return { valid: true };
}
