import { describe, expect, it } from 'vitest';
import {
  easeIn,
  easeOut,
  linkAt,
  motionConfig,
  pulseAt,
  pulseEnd,
  retarget,
  settled,
  staggerDelays,
  trackAt,
} from './motion';

const full = motionConfig(false);
const reduced = motionConfig(true);

describe('motionConfig (reduced-motion branch)', () => {
  it('full motion: sliding play, scale-in, stagger, pulse, line drawing', () => {
    expect(full).toMatchObject({ stepped: false, pulse: true, drawLines: true });
    expect(full.scaleFrom).toBeLessThan(1);
    expect(full.staggerMs).toBeGreaterThan(0);
  });

  it('reduced motion: month steps and crossfades only', () => {
    expect(reduced).toMatchObject({
      stepped: true,
      scaleFrom: 1,
      scaleExit: 1,
      staggerMs: 0,
      pulse: false,
      drawLines: false,
    });
    expect(reduced.enterMs).toBeGreaterThan(0); // still a crossfade, not a cut
  });

  it('durations stay within the motion tokens (150–250 ms)', () => {
    for (const c of [full, reduced]) {
      for (const ms of [c.enterMs, c.exitMs]) expect(ms >= 150 && ms <= 250).toBe(true);
    }
  });
});

describe('easing', () => {
  it('ease-out starts fast, ease-in starts slow; both 0 → 1 without overshoot', () => {
    expect(easeOut(0.2)).toBeGreaterThan(0.5);
    expect(easeIn(0.2)).toBeLessThan(0.05);
    for (let t = 0; t <= 1; t += 0.05) {
      expect(easeOut(t)).toBeLessThanOrEqual(1);
      expect(easeIn(t)).toBeGreaterThanOrEqual(0);
    }
    expect([easeOut(1), easeIn(1), easeOut(2), easeIn(-1)]).toEqual([1, 1, 1, 0]);
  });
});

describe('pin tracks', () => {
  it('enter: fade + scale in after the stagger delay', () => {
    const tr = retarget({ o: 0, s: 1 }, true, 1000, 100, full);
    expect(tr.from.s).toBe(full.scaleFrom);
    expect(trackAt(tr, 1050, full)).toMatchObject({ o: 0, done: false }); // still delayed
    const mid = trackAt(tr, 1100 + full.enterMs / 2, full);
    expect(mid.o).toBeGreaterThan(0.5);
    expect(mid.s).toBeGreaterThan(full.scaleFrom);
    expect(trackAt(tr, 1100 + full.enterMs, full)).toEqual({ o: 1, s: 1, done: true });
  });

  it('exit: fades out from wherever it is (no jump on reversal)', () => {
    const half = { o: 0.6, s: 0.8 };
    const tr = retarget(half, false, 0, 50, full);
    expect(tr.delay).toBe(0);
    expect(trackAt(tr, 0, full)).toMatchObject(half);
    expect(trackAt(tr, full.exitMs, full)).toMatchObject({ o: 0, done: true });
    const back = retarget(half, true, 0, 0, full);
    expect(back.from).toEqual(half);
  });

  it('reduced motion never scales', () => {
    const tr = retarget({ o: 0, s: 1 }, true, 0, 0, reduced);
    for (const t of [0, 100, 250]) expect(trackAt(tr, t, reduced).s).toBe(1);
  });

  it('settled tracks are done', () => {
    expect(trackAt(settled(true), 0, full)).toEqual({ o: 1, s: 1, done: true });
    expect(trackAt(settled(false), 0, full)).toMatchObject({ o: 0, done: true });
  });
});

describe('stagger', () => {
  it('spaces simultaneous entries, capping the burst', () => {
    expect(staggerDelays(3, full)).toEqual([0, 45, 90]);
    const many = staggerDelays(20, full);
    expect(many.at(-1)).toBeCloseTo(full.staggerMaxMs);
    expect(staggerDelays(5, reduced)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('pulse', () => {
  it('ripples once per period and finishes its cycle', () => {
    expect(pulseAt(0, 0, full).ro).toBeGreaterThan(0.4);
    expect(pulseAt(0, full.pulseMs * 0.99, full).ro).toBeLessThan(0.01);
    expect(pulseEnd(0, 100, full)).toBe(full.pulseMs);
    expect(pulseEnd(0, full.pulseMs * 1.5, full)).toBe(full.pulseMs * 2);
    expect(pulseAt(0, 500, reduced)).toEqual({ ro: 0, rs: 0 });
  });
});

describe('links', () => {
  const tr = { shown: true, t0: 0, delay: 100, from: { o: 0, s: 0 } };

  it('draw in after their delay (full motion)', () => {
    expect(linkAt(tr, 50, full)).toMatchObject({ o: 0, s: 0 });
    const mid = linkAt(tr, 100 + full.lineMs / 2, full);
    expect(mid.o).toBe(1);
    expect(mid.s).toBeGreaterThan(0.5);
    expect(linkAt(tr, 100 + full.lineMs, full)).toEqual({ o: 1, s: 1, done: true });
  });

  it('crossfade in whole under reduced motion', () => {
    const mid = linkAt(tr, 100 + reduced.enterMs / 2, reduced);
    expect(mid.s).toBe(1);
    expect(mid.o).toBeGreaterThan(0);
    expect(mid.o).toBeLessThan(1);
  });
});
