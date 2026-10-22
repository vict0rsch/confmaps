import { describe, expect, it } from 'vitest';
import { formatDateRange, formatDateRangeShort, formatInstant } from './dates';

describe('formatDateRange', () => {
  it.each([
    ['2026-12-09', '2026-12-13', 'Dec 9–13, 2026'],
    ['2025-11-30', '2025-12-05', 'Nov 30 – Dec 5, 2025'],
    ['2026-12-30', '2027-01-02', 'Dec 30, 2026 – Jan 2, 2027'],
    ['2026-12-09', '2026-12-09', 'Dec 9, 2026'],
  ])('%s → %s', (a, b, out) => expect(formatDateRange(a, b)).toBe(out));

  it('short form drops the year', () => {
    expect(formatDateRangeShort('2026-12-09', '2026-12-13')).toBe('Dec 9–13');
    expect(formatDateRangeShort('2025-11-30', '2025-12-05')).toBe('Nov 30 – Dec 5');
  });

  it('formats instants in the given zone', () => {
    expect(formatInstant('2026-10-08T11:59:59Z', 'UTC')).toBe('Oct 8, 2026, 11:59 UTC');
  });
});
