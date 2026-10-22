import { describe, expect, it } from 'vitest';
import { toUtcIso } from './timezone';

describe('toUtcIso', () => {
  it.each([
    ['2025-05-15 23:59:59', 'AoE', '2025-05-16T11:59:59Z'],
    ['2025-05-15 23:59:59', 'aoe', '2025-05-16T11:59:59Z'],
    ['2025-05-15 23:59:59', 'UTC', '2025-05-15T23:59:59Z'],
    ['2025-05-15 23:59:59', 'UTC  ', '2025-05-15T23:59:59Z'],
    ['2025-05-15 23:59:59', 'UTC+0', '2025-05-15T23:59:59Z'],
    ['2025-05-15 23:59:59', 'UTC-8', '2025-05-16T07:59:59Z'],
    ['2025-05-15 23:59:59', 'UTC-08', '2025-05-16T07:59:59Z'],
    ['2025-05-15 23:59:59', 'UTC+02', '2025-05-15T21:59:59Z'],
    ['2025-05-15 23:59:59', 'UTC+05:30', '2025-05-15T18:29:59Z'],
    ['2025-05-15 23:59:59', 'GMT+02', '2025-05-15T21:59:59Z'],
    ['2025-07-15 23:59:59', 'PST', '2025-07-16T07:59:59Z'], // literal UTC−8, even in summer
    ['2025-01-31 23:59', 'UTC', '2025-01-31T23:59:00Z'],
  ])('%s %s → %s', (local, tz, expected) => {
    expect(toUtcIso(local, tz)).toBe(expected);
  });

  it('handles IANA zones with DST', () => {
    expect(toUtcIso('2026-01-15 12:00:00', 'Europe/London')).toBe('2026-01-15T12:00:00Z');
    expect(toUtcIso('2026-06-01 12:00:00', 'Europe/London')).toBe('2026-06-01T11:00:00Z');
    expect(toUtcIso('2026-06-16 23:59:59', 'Pacific/Honolulu')).toBe('2026-06-17T09:59:59Z');
  });

  it('crosses the date line for AoE at year end', () => {
    expect(toUtcIso('2025-12-31 23:59:59', 'AoE')).toBe('2026-01-01T11:59:59Z');
  });

  it.each(['CET', 'Mars/Olympus', 'UTC+25', 'EST5EDT?', ''])(
    'rejects unknown timezone %j',
    (tz) => {
      expect(() => toUtcIso('2025-05-15 23:59:59', tz)).toThrow(/unknown timezone/);
    },
  );

  it.each(['2025-05-15', '2025-02-30 10:00:00', '15/05/2025 10:00', '2025-05-15 24:00:00'])(
    'rejects malformed local time %j',
    (local) => {
      expect(() => toUtcIso(local, 'UTC')).toThrow(/local time/);
    },
  );
});
