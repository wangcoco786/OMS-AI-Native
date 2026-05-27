/**
 * Tests for ConflictResolver
 *
 * Tests the "channel data wins" conflict resolution strategy:
 * - Remote values override local values for conflicting fields
 * - Conflict records are created with full details
 * - Non-conflicting fields are preserved
 * - Fields only in remote are added
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { ConflictResolver } from './conflict-resolver.js';

describe('ConflictResolver', () => {
  let resolver: ConflictResolver;

  beforeEach(() => {
    resolver = new ConflictResolver();
  });

  describe('resolve - basic conflict resolution', () => {
    it('resolves conflicts with remote values winning', () => {
      const local = { name: 'Local Name', price: 100, status: 'active' };
      const remote = { name: 'Remote Name', price: 200, status: 'active' };

      const { resolved, conflicts } = resolver.resolve(local, remote, 'record-1');

      expect(resolved.name).toBe('Remote Name');
      expect(resolved.price).toBe(200);
      expect(resolved.status).toBe('active');
      expect(conflicts).toHaveLength(2);
    });

    it('records conflict details correctly', () => {
      const local = { name: 'Old Name', quantity: 10 };
      const remote = { name: 'New Name', quantity: 25 };

      const { conflicts } = resolver.resolve(local, remote, 'rec-123');

      expect(conflicts).toHaveLength(2);

      const nameConflict = conflicts.find((c) => c.field === 'name');
      expect(nameConflict).toEqual({
        recordId: 'rec-123',
        field: 'name',
        localValue: 'Old Name',
        remoteValue: 'New Name',
        resolution: 'remote_wins',
      });

      const qtyConflict = conflicts.find((c) => c.field === 'quantity');
      expect(qtyConflict).toEqual({
        recordId: 'rec-123',
        field: 'quantity',
        localValue: 10,
        remoteValue: 25,
        resolution: 'remote_wins',
      });
    });

    it('returns no conflicts when records are identical', () => {
      const local = { name: 'Same', price: 100, active: true };
      const remote = { name: 'Same', price: 100, active: true };

      const { resolved, conflicts } = resolver.resolve(local, remote);

      expect(conflicts).toHaveLength(0);
      expect(resolved).toEqual(local);
    });

    it('preserves fields only in local record', () => {
      const local = { name: 'Test', localOnly: 'preserved', extra: 42 };
      const remote = { name: 'Test' };

      const { resolved, conflicts } = resolver.resolve(local, remote);

      expect(conflicts).toHaveLength(0);
      expect(resolved.localOnly).toBe('preserved');
      expect(resolved.extra).toBe(42);
      expect(resolved.name).toBe('Test');
    });

    it('adds fields only in remote record (no conflict)', () => {
      const local = { name: 'Test' };
      const remote = { name: 'Test', newField: 'added', count: 5 };

      const { resolved, conflicts } = resolver.resolve(local, remote);

      expect(conflicts).toHaveLength(0);
      expect(resolved.name).toBe('Test');
      expect(resolved.newField).toBe('added');
      expect(resolved.count).toBe(5);
    });
  });

  describe('resolve - edge cases', () => {
    it('handles empty local record', () => {
      const local = {};
      const remote = { name: 'New', price: 100 };

      const { resolved, conflicts } = resolver.resolve(local, remote);

      expect(conflicts).toHaveLength(0);
      expect(resolved).toEqual({ name: 'New', price: 100 });
    });

    it('handles empty remote record', () => {
      const local = { name: 'Existing', price: 50 };
      const remote = {};

      const { resolved, conflicts } = resolver.resolve(local, remote);

      expect(conflicts).toHaveLength(0);
      expect(resolved).toEqual({ name: 'Existing', price: 50 });
    });

    it('handles both empty records', () => {
      const { resolved, conflicts } = resolver.resolve({}, {});

      expect(conflicts).toHaveLength(0);
      expect(resolved).toEqual({});
    });

    it('handles null vs value as a conflict', () => {
      const local = { name: 'Test', value: null };
      const remote = { name: 'Test', value: 'not null' };

      const { resolved, conflicts } = resolver.resolve(local, remote);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].field).toBe('value');
      expect(conflicts[0].localValue).toBeNull();
      expect(conflicts[0].remoteValue).toBe('not null');
      expect(resolved.value).toBe('not null');
    });

    it('handles value vs null as a conflict', () => {
      const local = { name: 'Test', value: 'something' };
      const remote = { name: 'Test', value: null };

      const { resolved, conflicts } = resolver.resolve(local, remote);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].localValue).toBe('something');
      expect(conflicts[0].remoteValue).toBeNull();
      expect(resolved.value).toBeNull();
    });

    it('handles nested objects - detects difference', () => {
      const local = { config: { key: 'old' } };
      const remote = { config: { key: 'new' } };

      const { resolved, conflicts } = resolver.resolve(local, remote);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].field).toBe('config');
      expect(conflicts[0].localValue).toEqual({ key: 'old' });
      expect(conflicts[0].remoteValue).toEqual({ key: 'new' });
      expect(resolved.config).toEqual({ key: 'new' });
    });

    it('handles arrays - detects difference', () => {
      const local = { tags: ['a', 'b'] };
      const remote = { tags: ['a', 'b', 'c'] };

      const { resolved, conflicts } = resolver.resolve(local, remote);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].field).toBe('tags');
      expect(resolved.tags).toEqual(['a', 'b', 'c']);
    });

    it('treats identical nested objects as equal (no conflict)', () => {
      const local = { config: { key: 'same', nested: { deep: true } } };
      const remote = { config: { key: 'same', nested: { deep: true } } };

      const { conflicts } = resolver.resolve(local, remote);

      expect(conflicts).toHaveLength(0);
    });

    it('uses empty string as recordId when not provided', () => {
      const local = { name: 'A' };
      const remote = { name: 'B' };

      const { conflicts } = resolver.resolve(local, remote);

      expect(conflicts[0].recordId).toBe('');
    });

    it('all conflicts have resolution set to remote_wins', () => {
      const local = { a: 1, b: 2, c: 3 };
      const remote = { a: 10, b: 20, c: 30 };

      const { conflicts } = resolver.resolve(local, remote, 'test-id');

      expect(conflicts).toHaveLength(3);
      for (const conflict of conflicts) {
        expect(conflict.resolution).toBe('remote_wins');
        expect(conflict.recordId).toBe('test-id');
      }
    });
  });
});
