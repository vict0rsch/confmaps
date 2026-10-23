import { describe, expect, it } from 'vitest';
import {
  addDays,
  axisTicks,
  coverDomain,
  dataSpan,
  dayNumber,
  histogram,
  isoFromDay,
  toDay,
  toX,
  windowDays,
} from './scale';

const loc = (start: string, end = start) => ({ start, end });

describe('day arithmetic', () => {
  it('round-trips and adds across months and leap years', () => {
    expect(isoFromDay(dayNumber('2028-02-29'))).toBe('2028-02-29');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(windowDays({ from: '2026-10-22', to: '2026-10-22' })).toBe(1);
    expect(windowDays({ from: '2026-01-01', to: '2026-12-31' })).toBe(365);
  });
});

describe('coverDomain', () => {
  it('is month-aligned and covers every window', () => {
    const d = coverDomain(undefined, { from: '2025-01-19', to: '2027-08-18' });
    expect(isoFromDay(d.start)).toBe('2025-01-01');
    expect(isoFromDay(d.end)).toBe('2027-09-01'); // exclusive
  });

  it('only ever grows (sticky while dragging / playing)', () => {
    const a = coverDomain(undefined, { from: '2025-01-19', to: '2027-08-18' });
    const b = coverDomain(a, { from: '2021-10-22', to: '2026-10-22' });
    expect(isoFromDay(b.start)).toBe('2021-10-01');
    const c = coverDomain(b, { from: '2026-01-01', to: '2026-02-01' });
    expect(c).toEqual(b);
  });

  it('maps x ↔ day linearly', () => {
    const d = coverDomain(undefined, { from: '2026-01-01', to: '2026-12-31' });
    expect(toX(d.start, d, 730)).toBe(0);
    expect(toX(d.end, d, 730)).toBe(730);
    expect(toDay(365, d, 730)).toBeCloseTo(d.start + 182.5);
  });
});

describe('histogram', () => {
  const d = coverDomain(undefined, { from: '2026-01-01', to: '2026-04-30' });

  it('bins events per month over the whole domain, zeros included', () => {
    const bins = histogram([loc('2026-01-05'), loc('2026-01-20'), loc('2026-03-10')], d);
    expect(bins.map((b) => [b.month, b.count])).toEqual([
      ['2026-01', 2],
      ['2026-02', 0],
      ['2026-03', 1],
      ['2026-04', 0],
    ]);
    expect(bins[0].end).toBe(bins[1].start);
  });

  it('counts virtual editions too (events, not pins)', () => {
    const online = { start: '2026-02-10', end: '2026-02-12', format: 'virtual' as const };
    expect(histogram([online], d).map((b) => b.count)).toEqual([0, 1, 0, 0]);
  });

  it('counts an event in every month it overlaps, clipped to the domain', () => {
    const bins = histogram([loc('2026-01-30', '2026-02-02'), loc('2025-12-30', '2026-01-02')], d);
    expect(bins.map((b) => b.count)).toEqual([2, 1, 0, 0]);
    expect(histogram([loc('2027-01-01')], d).every((b) => b.count === 0)).toBe(true);
  });
});

describe('dataSpan', () => {
  it('spans first start → last end', () => {
    expect(dataSpan([loc('2026-03-01', '2026-03-05'), loc('2025-07-01', '2027-01-02')])).toEqual({
      from: '2025-07-01',
      to: '2027-01-02',
    });
    expect(dataSpan([])).toBeNull();
  });
});

describe('axisTicks', () => {
  const d = coverDomain(undefined, { from: '2025-01-01', to: '2027-12-31' });

  it('labels years; quarters when months are wide enough; months when wider', () => {
    const years = axisTicks(d, 300).map((t) => t.label);
    expect(years).toEqual(['2025', '2026', '2027']);
    const quarters = axisTicks(d, 900).map((t) => t.label);
    expect(quarters.slice(0, 4)).toEqual(['2025', 'Apr', 'Jul', 'Oct']);
    expect(axisTicks(d, 36 * 45).length).toBe(36);
  });

  it('thins year labels when years are narrow (phones, many years)', () => {
    const decade = coverDomain(undefined, { from: '2016-01-01', to: '2027-12-31' });
    expect(axisTicks(decade, 12 * 40).map((t) => t.label)).toHaveLength(12);
    expect(axisTicks(decade, 12 * 20).map((t) => t.label)).toEqual([
      '2016',
      '2018',
      '2020',
      '2022',
      '2024',
      '2026',
    ]);
    expect(axisTicks(decade, 12 * 8).map((t) => t.label)).toEqual(['2020', '2025']);
  });

  it('labels a leading partial year when it has room', () => {
    const late = coverDomain(undefined, { from: '2024-10-01', to: '2025-12-31' });
    expect(axisTicks(late, 200)[0]).toMatchObject({ label: '2024', kind: 'year' });
    const tooLate = coverDomain(undefined, { from: '2024-11-01', to: '2025-12-31' });
    expect(axisTicks(tooLate, 200)[0].label).toBe('2025');
    // Three months, but too narrow for a label (would run into the next year's).
    expect(axisTicks(late, 150)[0].label).toBe('2025');
  });
});
