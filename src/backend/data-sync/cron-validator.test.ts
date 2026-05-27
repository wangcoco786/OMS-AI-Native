/**
 * Tests for Cron Expression Validator
 */

import { describe, it, expect } from 'vitest';
import { validateCronExpression } from './cron-validator.js';

describe('validateCronExpression', () => {
  describe('valid expressions within [5min, 24h] range', () => {
    it('accepts every 5 minutes (*/5 * * * *)', () => {
      const result = validateCronExpression('*/5 * * * *');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts every 10 minutes (*/10 * * * *)', () => {
      const result = validateCronExpression('*/10 * * * *');
      expect(result.valid).toBe(true);
    });

    it('accepts every 15 minutes (*/15 * * * *)', () => {
      const result = validateCronExpression('*/15 * * * *');
      expect(result.valid).toBe(true);
    });

    it('accepts every 30 minutes (*/30 * * * *)', () => {
      const result = validateCronExpression('*/30 * * * *');
      expect(result.valid).toBe(true);
    });

    it('accepts every hour (0 * * * *)', () => {
      const result = validateCronExpression('0 * * * *');
      expect(result.valid).toBe(true);
    });

    it('accepts every 2 hours (0 */2 * * *)', () => {
      const result = validateCronExpression('0 */2 * * *');
      expect(result.valid).toBe(true);
    });

    it('accepts every 6 hours (0 */6 * * *)', () => {
      const result = validateCronExpression('0 */6 * * *');
      expect(result.valid).toBe(true);
    });

    it('accepts every 12 hours (0 */12 * * *)', () => {
      const result = validateCronExpression('0 */12 * * *');
      expect(result.valid).toBe(true);
    });

    it('accepts once daily at midnight (0 0 * * *)', () => {
      const result = validateCronExpression('0 0 * * *');
      expect(result.valid).toBe(true);
    });

    it('accepts specific times twice daily (0 8,20 * * *)', () => {
      const result = validateCronExpression('0 8,20 * * *');
      expect(result.valid).toBe(true);
    });
  });

  describe('rejects intervals less than 5 minutes', () => {
    it('rejects every minute (* * * * *)', () => {
      const result = validateCronExpression('* * * * *');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('less than the minimum');
    });

    it('rejects every 2 minutes (*/2 * * * *)', () => {
      const result = validateCronExpression('*/2 * * * *');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('less than the minimum');
    });

    it('rejects every 3 minutes (*/3 * * * *)', () => {
      const result = validateCronExpression('*/3 * * * *');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('less than the minimum');
    });

    it('rejects every 4 minutes (*/4 * * * *)', () => {
      const result = validateCronExpression('*/4 * * * *');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('less than the minimum');
    });
  });

  describe('rejects intervals greater than 24 hours', () => {
    it('rejects weekly schedule (0 0 * * 1)', () => {
      const result = validateCronExpression('0 0 * * 1');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds the maximum');
    });

    it('rejects every other day by day-of-week (0 0 * * 1,3,5)', () => {
      // Mon, Wed, Fri - minimum gap is 2 days = 2880 minutes
      const result = validateCronExpression('0 0 * * 1,3,5');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds the maximum');
    });
  });

  describe('invalid syntax', () => {
    it('rejects empty string', () => {
      const result = validateCronExpression('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('non-empty string');
    });

    it('rejects expression with wrong number of fields', () => {
      const result = validateCronExpression('* * *');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('5 fields');
    });

    it('rejects expression with 6 fields', () => {
      const result = validateCronExpression('0 */5 * * * *');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('5 fields');
    });

    it('rejects invalid minute value (60)', () => {
      const result = validateCronExpression('60 * * * *');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('minute');
    });

    it('rejects invalid hour value (25)', () => {
      const result = validateCronExpression('0 25 * * *');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('hour');
    });

    it('rejects invalid day-of-month value (32)', () => {
      const result = validateCronExpression('0 0 32 * *');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('day-of-month');
    });

    it('rejects invalid month value (13)', () => {
      const result = validateCronExpression('0 0 * 13 *');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('month');
    });

    it('rejects invalid day-of-week value (8)', () => {
      const result = validateCronExpression('0 0 * * 8');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('day-of-week');
    });

    it('rejects non-string input', () => {
      const result = validateCronExpression(null as unknown as string);
      expect(result.valid).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('accepts exactly 5 minutes interval (*/5 * * * *)', () => {
      const result = validateCronExpression('*/5 * * * *');
      expect(result.valid).toBe(true);
    });

    it('accepts exactly 24 hours interval (0 0 * * *)', () => {
      const result = validateCronExpression('0 0 * * *');
      expect(result.valid).toBe(true);
    });

    it('handles extra whitespace', () => {
      const result = validateCronExpression('  */5  *  *  *  *  ');
      expect(result.valid).toBe(true);
    });

    it('accepts range in minute field (0,5,10,15,20,25,30,35,40,45,50,55 * * * *)', () => {
      const result = validateCronExpression('0,5,10,15,20,25,30,35,40,45,50,55 * * * *');
      expect(result.valid).toBe(true);
    });
  });
});
