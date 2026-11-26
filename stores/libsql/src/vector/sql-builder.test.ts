import { describe, it, expect } from 'vitest';
import { buildFilterQuery } from './sql-builder';

describe('buildFilterQuery $size operator', () => {
  it('binds $size with an anonymous placeholder and the filter value', () => {
    const { sql, values } = buildFilterQuery({ tags: { $size: 2 } });

    // The previous implementation misused the filter value as a parameter
    // index, emitting a named reference ($2) that never matched the
    // positional bindings.
    expect(sql).not.toMatch(/\$\d/);
    expect(sql).toContain('json_array_length');
    expect(sql).toContain('= ?');
    expect(values).toEqual([2]);
  });

  it('does not collide with other parameters for non-trivial $size values', () => {
    const { sql, values } = buildFilterQuery({ tags: { $size: 5 }, category: 'tools' });

    expect(sql).not.toMatch(/\$\d/);
    // $size value first, then the equality value with its json_type guard.
    expect(values).toEqual([5, 'tools', 'text']);
    expect((sql.match(/\?/g) ?? []).length).toBe(values.length);
  });

  it('handles $size nested in $and', () => {
    const { sql, values } = buildFilterQuery({ $and: [{ tags: { $size: 3 } }] });

    expect(sql).not.toMatch(/\$\d/);
    expect(sql).toContain('json_array_length');
    expect(values).toEqual([3]);
  });
});

describe('buildFilterQuery multi-key branches inside logical operators', () => {
  // Each object in an $or/$nor array is one branch, and the keys of a branch
  // are an implicit AND (same as at the top level of a filter).
  it('ANDs the keys of one $or branch', () => {
    const { sql, values } = buildFilterQuery({ $or: [{ category: 'electronics', available: true }, { price: 5 }] });

    expect(sql).toBe(
      `WHERE (((json_extract(metadata, '$.category') = ? AND json_type(json_extract(metadata, '$.category')) = ?) AND (json_extract(metadata, '$.available') = ? AND json_type(json_extract(metadata, '$.available')) = ?)) OR (json_extract(metadata, '$.price') = ? AND json_type(json_extract(metadata, '$.price')) = ?))`,
    );
    expect(values).toEqual(['electronics', 'text', true, 'true', 5, 'integer']);
  });

  it('negates the whole branch for $nor', () => {
    const { sql, values } = buildFilterQuery({ $nor: [{ status: 'archived', pinned: false }] });

    expect(sql).toBe(
      `WHERE NOT ((json_extract(metadata, '$.status') = ? AND json_type(json_extract(metadata, '$.status')) = ?) AND (json_extract(metadata, '$.pinned') = ? AND json_type(json_extract(metadata, '$.pinned')) = ?))`,
    );
    expect(values).toEqual(['archived', 'text', false, 'false']);
  });

  it('ANDs field keys with a nested logical operator in the same branch', () => {
    const { sql, values } = buildFilterQuery({ $or: [{ $and: [{ a: 1 }], c: 2 }, { d: 3 }] });

    expect(sql).toBe(
      `WHERE (((json_extract(metadata, '$.a') = ? AND json_type(json_extract(metadata, '$.a')) = ?)) AND (json_extract(metadata, '$.c') = ? AND json_type(json_extract(metadata, '$.c')) = ?) OR (json_extract(metadata, '$.d') = ? AND json_type(json_extract(metadata, '$.d')) = ?))`,
    );
    expect(values).toEqual([1, 'integer', 2, 'integer', 3, 'integer']);
  });
});

describe('type-exact equality and range guards (#31591)', () => {
  it('guards shorthand equality with json_type', () => {
    const { sql, values } = buildFilterQuery({ stage: false });
    expect(sql).toBe(
      `WHERE (json_extract(metadata, '$.stage') = ? AND json_type(json_extract(metadata, '$.stage')) = ?)`,
    );
    expect(values).toEqual([false, 'false']);
  });

  it('guards explicit $eq with json_type', () => {
    const { sql, values } = buildFilterQuery({ stage: { $eq: 0 } });
    expect(sql).toContain(`json_type(json_extract(metadata, '$.stage')) = ?`);
    expect(values).toEqual([0, 'integer']);
  });

  it('guards explicit $ne with a value-OR-type inequality', () => {
    const { sql, values } = buildFilterQuery({ stage: { $ne: false } });
    expect(sql).toContain(`json_extract(metadata, '$.stage') != ?`);
    expect(sql).toContain(`json_type(json_extract(metadata, '$.stage')) != ?`);
    expect(values).toEqual([false, 'false']);
  });

  it('restricts numeric ranges to stored numbers', () => {
    const { sql, values } = buildFilterQuery({ score: { $gt: 0 } });
    expect(sql).toContain(`json_type(json_extract(metadata, '$.score')) IN ('integer', 'real')`);
    expect(values).toEqual([0]);
  });

  it('matches shorthand null only against an explicit JSON null', () => {
    const { sql, values } = buildFilterQuery({ stage: null });
    expect(sql).toBe(`WHERE json_type(json_extract(metadata, '$.stage')) = 'null'`);
    expect(values).toEqual([]);
  });

  it('matches $eq null only against an explicit JSON null', () => {
    const { sql, values } = buildFilterQuery({ stage: { $eq: null } });
    expect(sql).toContain(`json_type(json_extract(metadata, '$.stage')) = 'null'`);
    expect(values).toEqual([]);
  });

  it('keeps $ne null matching present non-null values only', () => {
    const { sql, values } = buildFilterQuery({ stage: { $ne: null } });
    expect(sql).toContain(`json_extract(metadata, '$.stage') IS NOT NULL`);
    expect(values).toEqual([]);
  });
});
