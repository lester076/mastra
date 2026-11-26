import { describe, it, expect } from 'vitest';
import { buildFilterClause } from './filter-builder';

describe('type-exact metadata filters (#31590)', () => {
  it('guards shorthand equality against cross-type stored values', () => {
    const { clause } = buildFilterClause({ stage: false });
    expect(clause).toContain(`json_type(json_extract(metadata, '$.stage')) = 'BOOLEAN'`);
    expect(clause).toContain(`json_extract_string(metadata, '$.stage') = false`);
  });

  it('guards numeric equality so a stored boolean never coerces', () => {
    const { clause } = buildFilterClause({ stage: 0 });
    expect(clause).toContain(`json_type(json_extract(metadata, '$.stage')) = 'BIGINT'`);
    expect(clause).toContain(`json_extract_string(metadata, '$.stage') = 0`);
  });

  it('treats cross-type values as unequal for $ne', () => {
    const { clause } = buildFilterClause({ stage: { $ne: false } });
    expect(clause).toContain(`json_type(json_extract(metadata, '$.stage')) = 'BOOLEAN'`);
    expect(clause).toContain(`json_extract_string(metadata, '$.stage') != false`);
    expect(clause).toContain('ELSE TRUE END');
  });

  it('restricts numeric ranges to stored numbers and avoids hard casts', () => {
    const { clause } = buildFilterClause({ score: { $lt: 0 } });
    expect(clause).toContain(`json_type(json_extract(metadata, '$.score')) IN ('BIGINT', 'DOUBLE')`);
    expect(clause).toContain(`TRY_CAST(json_extract_string(metadata, '$.score') AS DOUBLE) < 0`);
    expect(clause).toContain('ELSE FALSE END');
  });

  it('keeps null equality on the extraction path', () => {
    const { clause } = buildFilterClause({ stage: null });
    expect(clause).toContain(`json_extract_string(metadata, '$.stage') IS NULL`);
  });
});
