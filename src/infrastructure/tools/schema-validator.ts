/**
 * Schema Validator
 *
 * Validates tool input against JSON Schema using ajv.
 * Maps validation errors to a structured format with field paths
 * and human-readable messages.
 *
 * Requirements: 3.2
 */

import Ajv from 'ajv';

import type { ValidationResult, ValidationError } from './types.js';

/** JSON Schema type (subset used for tool definitions) */
export type JSONSchema = Record<string, unknown>;

/**
 * SchemaValidator uses ajv to validate input data against JSON Schema definitions.
 * It provides structured error reporting with field paths and readable messages.
 */
export class SchemaValidator {
  private readonly ajv: Ajv;

  constructor() {
    this.ajv = new Ajv({
      allErrors: true,
      verbose: true,
    });
  }

  /**
   * Validate input against a JSON Schema.
   *
   * @param schema - JSON Schema to validate against
   * @param input - The input data to validate
   * @returns ValidationResult with valid flag and any errors
   */
  validate(schema: JSONSchema, input: unknown): ValidationResult {
    // Handle null/undefined input
    if (input === null || input === undefined) {
      return {
        valid: false,
        errors: [
          {
            field: '',
            message: 'Input must not be null or undefined',
          },
        ],
      };
    }

    // Handle empty schema - treat as valid (no constraints)
    if (!schema || Object.keys(schema).length === 0) {
      return { valid: true };
    }

    // Compile and validate
    let validateFn: ReturnType<Ajv['compile']>;
    try {
      validateFn = this.ajv.compile(schema);
    } catch {
      return {
        valid: false,
        errors: [
          {
            field: '',
            message: 'Invalid schema: failed to compile JSON Schema',
          },
        ],
      };
    }

    const valid = validateFn(input);

    if (valid) {
      return { valid: true };
    }

    const errors: ValidationError[] = (validateFn.errors ?? []).map((err) => ({
      field: this.formatFieldPath(err.instancePath, err.params),
      message: this.formatMessage(err),
    }));

    return {
      valid: false,
      errors: errors.length > 0 ? errors : [{ field: '', message: 'Validation failed' }],
    };
  }

  /**
   * Format the field path from ajv error.
   * Converts JSON Pointer format (e.g., "/foo/bar") to dot notation (e.g., "foo.bar").
   * For 'required' errors, appends the missing property name.
   */
  private formatFieldPath(
    instancePath: string,
    params: Record<string, unknown> | undefined,
  ): string {
    let path = instancePath
      .replace(/^\//, '') // Remove leading slash
      .replace(/\//g, '.'); // Convert slashes to dots

    // For required errors, append the missing property name
    if (params && 'missingProperty' in params) {
      const missing = params.missingProperty as string;
      path = path ? `${path}.${missing}` : missing;
    }

    return path;
  }

  /**
   * Format a human-readable error message from an ajv error.
   */
  private formatMessage(err: { keyword: string; message?: string; params?: Record<string, unknown> }): string {
    if (err.message) {
      return err.message;
    }

    // Fallback messages for common keywords
    switch (err.keyword) {
      case 'required':
        return `Missing required property: ${(err.params as Record<string, unknown>)?.missingProperty}`;
      case 'type':
        return `Invalid type: expected ${(err.params as Record<string, unknown>)?.type}`;
      case 'additionalProperties':
        return `Unexpected property: ${(err.params as Record<string, unknown>)?.additionalProperty}`;
      default:
        return 'Validation failed';
    }
  }
}
