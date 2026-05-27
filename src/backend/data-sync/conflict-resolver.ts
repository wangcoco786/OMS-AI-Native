/**
 * Conflict Resolver
 *
 * Implements the "channel data wins" conflict resolution strategy for data sync.
 * When local and remote records have conflicting field values, the remote (channel)
 * value takes precedence. All conflicts are recorded with full details.
 */

import pino from 'pino';

import type { ConflictRecord } from '../../shared/m2-types.js';

const defaultLogger = pino({ name: 'conflict-resolver' });

/** Result of resolving conflicts between local and remote records */
export interface ConflictResolutionResult {
  resolved: Record<string, unknown>;
  conflicts: ConflictRecord[];
}

/**
 * ConflictResolver resolves data conflicts between local and remote records
 * using the "remote wins" (channel data priority) strategy.
 *
 * For each field that differs between local and remote:
 * - The remote value is used in the resolved record
 * - A ConflictRecord is created documenting the conflict
 */
export class ConflictResolver {
  private readonly logger: pino.Logger;

  constructor(parentLogger?: pino.Logger) {
    this.logger = (parentLogger ?? defaultLogger).child({ component: 'conflict-resolver' });
  }

  /**
   * Resolve conflicts between a local record and a remote record.
   *
   * Strategy: remote (channel) data wins for all conflicting fields.
   * Fields that exist only in the remote record are added.
   * Fields that exist only in the local record are preserved.
   *
   * @param localRecord - The existing local record
   * @param remoteRecord - The incoming remote (channel) record
   * @param recordId - Optional record identifier for conflict logging
   * @returns The resolved record and a list of conflicts found
   */
  resolve(
    localRecord: Record<string, unknown>,
    remoteRecord: Record<string, unknown>,
    recordId?: string,
  ): ConflictResolutionResult {
    const conflicts: ConflictRecord[] = [];
    const resolved: Record<string, unknown> = { ...localRecord };

    // Check all fields in the remote record
    for (const field of Object.keys(remoteRecord)) {
      const remoteValue = remoteRecord[field];
      const localValue = localRecord[field];

      // If the field exists in both and values differ, it's a conflict
      if (field in localRecord && !this.valuesEqual(localValue, remoteValue)) {
        conflicts.push({
          recordId: recordId ?? '',
          field,
          localValue,
          remoteValue,
          resolution: 'remote_wins',
        });

        // Remote wins: use the remote value
        resolved[field] = remoteValue;
      } else if (!(field in localRecord)) {
        // Field only exists in remote - add it (no conflict)
        resolved[field] = remoteValue;
      }
      // If values are equal, no conflict - keep as is
    }

    if (conflicts.length > 0) {
      this.logger.info(
        { recordId, conflictCount: conflicts.length },
        'Resolved conflicts with remote-wins strategy',
      );
    }

    return { resolved, conflicts };
  }

  /**
   * Compare two values for equality.
   * Handles primitives and performs deep comparison for objects/arrays.
   */
  private valuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) {
      return true;
    }

    // Handle null/undefined
    if (a == null || b == null) {
      return a === b;
    }

    // Deep comparison for objects and arrays
    if (typeof a === 'object' && typeof b === 'object') {
      return JSON.stringify(a) === JSON.stringify(b);
    }

    return false;
  }
}
