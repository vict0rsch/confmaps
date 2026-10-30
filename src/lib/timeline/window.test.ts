import { describe, expect, it } from 'vitest';
import { coverDomain, dayNumber, isoFromDay, windowDays } from './scale';
import {
  advanceMonths,
  axisSpan,
  canPlay,
  centerWindow,
  clampAtEnd,
  datePresets,
  dragHandle,
  followSince,
  monthVariants,
  moveWindow,
  nearestBoundary,
  nextSpeed,
  nudge,
  playOrigin,
  playWindow,
  toDomainEdge,
  windowLabel,
} from './window';

const d = coverDomain(undefined, { from: '2025-01-01', to: '2027-12-31' });
const plan = { from: '2026-10-22', to: '2027-10-22' };

describe('presets', () => {
  it('in time order: the past 5 years, then 6 / 12 months from today', () => {
    expect(datePresets('2026-10-22').map((p) => [p.id, p.label, p.short, p.w])).toEqual([
      ['5y', 'Past 5 years', 'Past 5 years', { from: '2021-10-22', to: '2026-10-22' }],
      ['6m', 'Next 6 months', 'Next 6 mo', { from: '2026-10-22', to: '2027-04-22' }],
      ['12m', 'Next 12 months', 'Next 12 mo', plan],
    ]);
  });

  it('"Since <year>" comes first and reaches back to the first event', () => {
    const all = datePresets('2026-10-22', '2016-12-05')[0];
    expect(all).toEqual({
      id: 'all',
      label: 'Since 2016',
      short: 'Since 2016',
      w: { from: '2016-12-05', to: '2026-10-22' },
    });
    expect(datePresets('2026-10-22', '2026-12-01').map((p) => p.id)).not.toContain('all');
  });

  it('an active "Since <year>" follows the span start, both ways; other windows stay', () => {
    const today = '2026-10-22';
    const old = { from: '1963-08-25', to: today };
    expect(followSince(old, '1963-08-25', '1985-06-24', today)).toEqual({
      from: '1985-06-24',
      to: today,
    });
    expect(
      followSince({ from: '1985-06-24', to: today }, '1985-06-24', '1963-08-25', today),
    ).toEqual(old);
    expect(followSince(old, '1963-08-25', '1963-08-25', today)).toBeNull(); // start unchanged
    expect(followSince(plan, '1963-08-25', '1985-06-24', today)).toBeNull();
    expect(
      followSince({ from: '1963-08-25', to: '2026-10-21' }, '1963-08-25', '1985-06-24', today),
    ).toBeNull();
    // A start after today has no "Since <year>" preset.
    expect(followSince(old, '1963-08-25', '2026-12-01', today)).toBeNull();
  });
});

describe('axis span', () => {
  it('starts at most 5 years back (whole months), the data end unchanged', () => {
    const span = { from: '2016-12-05', to: '2027-12-12' };
    expect(axisSpan(span, '2026-10-22')).toEqual({ from: '2021-10-01', to: '2027-12-12' });
    // Younger data keeps its own start.
    const recent = { from: '2025-01-13', to: '2027-12-12' };
    expect(axisSpan(recent, '2026-10-22')).toEqual(recent);
  });

  it('the "Since <year>" window grows the axis back to the data start', () => {
    const today = '2026-10-22';
    const span = { from: '2016-12-05', to: '2027-12-12' };
    const base = coverDomain(undefined, axisSpan(span, today));
    expect(isoFromDay(base.start)).toBe('2021-10-01');
    const all = datePresets(today, span.from).find((p) => p.id === 'all')!.w;
    expect(isoFromDay(coverDomain(base, all).start)).toBe('2016-12-01');
  });
});

describe('dragging', () => {
  it('snaps handles to the nearest month boundary', () => {
    expect(nearestBoundary(dayNumber('2026-03-10'))).toBe(dayNumber('2026-03-01'));
    expect(nearestBoundary(dayNumber('2026-03-20'))).toBe(dayNumber('2026-04-01'));
    expect(dragHandle(plan, 'from', dayNumber('2026-12-27'), d)).toEqual({
      from: '2027-01-01',
      to: plan.to,
    });
    expect(dragHandle(plan, 'to', dayNumber('2027-06-03'), d)).toEqual({
      from: plan.from,
      to: '2027-05-31',
    });
  });

  it('never inverts the window and stays in the domain', () => {
    const w = { from: '2026-03-01', to: '2026-06-30' };
    expect(dragHandle(w, 'from', dayNumber('2026-09-01'), d).from).toBe('2026-06-01');
    expect(dragHandle(w, 'to', dayNumber('2025-06-01'), d).to).toBe('2026-03-31');
    expect(dragHandle(w, 'from', dayNumber('2020-01-01'), d).from).toBe('2025-01-01');
    expect(dragHandle(w, 'to', dayNumber('2030-01-01'), d).to).toBe('2027-12-31');
  });

  it('moves the body preserving its width, clamped at both ends', () => {
    const width = windowDays(plan);
    const later = moveWindow(plan, dayNumber('2026-12-01'), d);
    expect(later.from).toBe('2026-12-01');
    expect(windowDays(later)).toBe(width);
    const end = moveWindow(plan, dayNumber('2027-09-01'), d);
    expect(end.to).toBe('2027-12-31');
    expect(windowDays(end)).toBe(width);
    expect(moveWindow(plan, dayNumber('2010-01-01'), d).from).toBe('2025-01-01');
    expect(windowDays(centerWindow(plan, dayNumber('2026-01-01'), d))).toBe(width);
  });
});

describe('keyboard', () => {
  it('nudges handles by months, clamped', () => {
    expect(nudge(plan, 'from', 1, d)).toEqual({ from: '2026-11-22', to: plan.to });
    expect(nudge(plan, 'to', -12, d)).toEqual({ from: plan.from, to: '2026-10-22' });
    expect(nudge(plan, 'from', 24, d).from).toBe(plan.to); // stops at the other handle
    expect(nudge(plan, 'to', 12, d).to).toBe('2027-12-31');
  });

  it('nudges the whole window keeping its width', () => {
    const w = nudge(plan, 'window', -12, d);
    expect(w.from).toBe('2025-10-22');
    expect(windowDays(w)).toBe(windowDays(plan));
  });

  it('Home / End go to the domain edges', () => {
    expect(toDomainEdge(plan, 'from', 'start', d).from).toBe('2025-01-01');
    expect(toDomainEdge(plan, 'to', 'end', d).to).toBe('2027-12-31');
    expect(toDomainEdge(plan, 'window', 'start', d).from).toBe('2025-01-01');
    expect(toDomainEdge(plan, 'window', 'end', d).to).toBe('2027-12-31');
  });
});

describe('play stepping', () => {
  const origin = { from: '2026-01-01', to: '2026-06-30' };

  it('advances one month per second at 1×, scaled by speed', () => {
    expect(advanceMonths(0, 1000, 1)).toBe(1);
    expect(advanceMonths(0, 1000, 2)).toBe(2);
    expect(advanceMonths(0, 1000, 4)).toBe(4);
    expect(advanceMonths(1, 500, 0.5)).toBe(1.25);
    expect([0.5, 1, 2, 4].map((s) => nextSpeed(s as 0.5 | 1 | 2 | 4))).toEqual([1, 2, 4, 0.5]);
  });

  it('continuous: day-granular slide, width preserved', () => {
    const w = playWindow(origin, 1, false);
    expect(w.from).toBe('2026-01-31');
    expect(windowDays(w)).toBe(windowDays(origin));
    expect(playWindow(origin, 0.5, false).from).toBe('2026-01-16');
  });

  it('stepped (reduced motion): whole months only, width preserved', () => {
    const days = { from: '2026-01-10', to: '2026-07-09' };
    expect(playWindow(days, 0.9, true)).toEqual(days);
    const w = playWindow(days, 1.2, true);
    expect(w.from).toBe('2026-02-10');
    expect(windowDays(w)).toBe(windowDays(days));
    // A whole-month window stays whole months (6 months here).
    expect(playWindow(origin, 1, true)).toEqual({ from: '2026-02-01', to: '2026-07-31' });
    expect(playWindow(origin, 2, true)).toEqual({ from: '2026-03-01', to: '2026-08-31' });
  });

  it('stops at the data end without changing width', () => {
    const span = { from: '2025-01-19', to: '2027-08-18' };
    const { w, ended } = clampAtEnd({ from: '2027-05-01', to: '2027-10-31' }, span.to);
    expect(ended).toBe(true);
    expect(w.to).toBe(span.to);
    expect(windowDays(w)).toBe(windowDays({ from: '2027-05-01', to: '2027-10-31' }));
    expect(clampAtEnd(origin, span.to).ended).toBe(false);
  });

  it('rewinds to the data start when already at the end; refuses a window wider than data', () => {
    const span = { from: '2025-01-19', to: '2027-08-18' };
    expect(playOrigin(origin, span)).toBe(origin);
    const back = playOrigin(plan, span); // Plan reaches past the last event
    expect(back.from).toBe('2025-01-01');
    expect(windowDays(back)).toBe(windowDays(plan));
    expect(canPlay(plan, span)).toBe(true);
    expect(canPlay({ from: '2021-10-22', to: '2026-10-22' }, span)).toBe(false);
  });
});

describe('windowLabel', () => {
  it('reads whole months as months, other windows as days; short in compact', () => {
    expect(windowLabel({ from: '2026-11-01', to: '2027-10-31' })).toBe('Nov 2026 – Oct 2027');
    expect(windowLabel({ from: '2026-11-01', to: '2026-11-30' })).toBe('Nov 2026');
    expect(windowLabel(plan)).toBe('Oct 22, 2026 – Oct 22, 2027');
    expect(windowLabel(plan, true)).toBe('Oct ’26 – Oct ’27');
  });

  it('has one variant per month name, for the widest-month width', () => {
    const v = monthVariants('Oct \u20072, 2026 – Nov 11, 2027');
    expect(v).toHaveLength(12);
    expect(v[4]).toBe('May \u20072, 2026 – May 11, 2027');
  });

  it('pads single-digit days to the width of two digits', () => {
    expect(windowLabel({ from: '2026-10-02', to: '2027-10-11' })).toBe(
      'Oct \u20072, 2026 – Oct 11, 2027',
    );
  });
});
