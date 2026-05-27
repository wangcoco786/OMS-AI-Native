import { describe, it, expect } from 'vitest';
import { SchemaValidator } from './schema-validator.js';

describe('SchemaValidator', () => {
  const validator = new SchemaValidator();

  describe('validate - valid inputs', () => {
    it('should return valid for input matching schema', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      };

      const result = validator.validate(schema, { name: 'Alice', age: 30 });

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should return valid for empty schema (no constraints)', () => {
      const result = validator.validate({}, { anything: 'goes' });

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should return valid when optional properties are omitted', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['name'],
      };

      const result = validator.validate(schema, { name: 'Bob' });

      expect(result.valid).toBe(true);
    });
  });

  describe('validate - invalid inputs', () => {
    it('should return errors for missing required properties', () => {
      const schema = {
        type: 'object',
        properties: {
          orderNo: { type: 'string' },
          customerId: { type: 'string' },
        },
        required: ['orderNo', 'customerId'],
      };

      const result = validator.validate(schema, { orderNo: 'ORD-001' });

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
      expect(result.errors![0].field).toBe('customerId');
      expect(result.errors![0].message).toContain('required');
    });

    it('should return errors for wrong type', () => {
      const schema = {
        type: 'object',
        properties: {
          count: { type: 'number' },
        },
        required: ['count'],
      };

      const result = validator.validate(schema, { count: 'not-a-number' });

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
      expect(result.errors![0].field).toBe('count');
      expect(result.errors![0].message).toContain('number');
    });

    it('should return errors for additional properties when not allowed', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        additionalProperties: false,
      };

      const result = validator.validate(schema, { name: 'Alice', extra: 'field' });

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.some((e) => e.message.includes('additional'))).toBe(true);
    });

    it('should report multiple errors with allErrors mode', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      };

      const result = validator.validate(schema, {});

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBe(2);
    });

    it('should handle nested property validation errors', () => {
      const schema = {
        type: 'object',
        properties: {
          address: {
            type: 'object',
            properties: {
              city: { type: 'string' },
              zip: { type: 'string' },
            },
            required: ['city'],
          },
        },
        required: ['address'],
      };

      const result = validator.validate(schema, { address: { zip: '12345' } });

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].field).toBe('address.city');
    });
  });

  describe('validate - edge cases', () => {
    it('should return error for null input', () => {
      const schema = { type: 'object' };

      const result = validator.validate(schema, null);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].message).toContain('null or undefined');
    });

    it('should return error for undefined input', () => {
      const schema = { type: 'object' };

      const result = validator.validate(schema, undefined);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].message).toContain('null or undefined');
    });

    it('should return valid for null schema (no constraints)', () => {
      const result = validator.validate(null as unknown as Record<string, unknown>, { data: 1 });

      expect(result.valid).toBe(true);
    });

    it('should return error for invalid schema that cannot be compiled', () => {
      const invalidSchema = {
        type: 'object',
        properties: {
          x: { type: 'invalid-type-that-does-not-exist' },
        },
      };

      const result = validator.validate(invalidSchema, { x: 1 });

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].message).toContain('Invalid schema');
    });

    it('should validate primitive types at root level', () => {
      const schema = { type: 'string' };

      const validResult = validator.validate(schema, 'hello');
      expect(validResult.valid).toBe(true);

      const invalidResult = validator.validate(schema, 42);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors![0].message).toContain('string');
    });

    it('should validate arrays', () => {
      const schema = {
        type: 'array',
        items: { type: 'number' },
      };

      const validResult = validator.validate(schema, [1, 2, 3]);
      expect(validResult.valid).toBe(true);

      const invalidResult = validator.validate(schema, [1, 'two', 3]);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors![0].field).toBe('1');
    });
  });
});
