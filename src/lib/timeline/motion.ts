// Map choreography timing (DESIGN §6.4, §6.8), pure: motion config per reduced-motion preference,
// easing, per-pin enter/exit tracks, stagger and the live pulse.

export type MotionConfig = {
  /** Play steps month by month instead of sliding (reduced motion). */
  stepped: boolean;
  enterMs: number;
  exitMs: number;
  /** Pin scale when it starts entering (1 = no scaling) and when it finishes leaving. */
  scaleFrom: number;
  scaleExit: number;
  /** Delay between simultaneous entries, and the cap on a burst's total spread. */
  staggerMs: number;
  staggerMaxMs: number;
  /** Ripple on live pins. */
  pulse: boolean;
  pulseMs: number;
  /** Main↔satellite lines (and the history path) draw in, rather than fade in. */
  drawLines: boolean;
  lineMs: number;
};

/**
 * Durations follow the motion tokens (tokens.css: 150–250 ms, ease-out on enter, ease-in on exit,
 * no bounce). Reduced motion keeps only crossfades: no scaling, stagger, pulsing or line drawing.
 */
export function motionConfig(reduced: boolean): MotionConfig {
  return reduced
    ? {
        stepped: true,
        enterMs: 250,
        exitMs: 250,
        scaleFrom: 1,
        scaleExit: 1,
        staggerMs: 0,
        staggerMaxMs: 0,
        pulse: false,
        pulseMs: 0,
        drawLines: false,
        lineMs: 0,
      }
    : {
        stepped: false,
        enterMs: 250,
        exitMs: 200,
        scaleFrom: 0.4,
        scaleExit: 0.85,
        staggerMs: 45,
        staggerMaxMs: 360,
        pulse: true,
        pulseMs: 1600,
        drawLines: true,
        lineMs: 450,
      };
}

const clamp01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t);
/** ≈ `--ease-out` (cubic-bezier(0.22, 1, 0.36, 1), i.e. easeOutQuint). */
export const easeOut = (t: number): number => 1 - (1 - clamp01(t)) ** 5;
/** ≈ `--ease-in` (cubic-bezier(0.55, 0, 1, 0.45), i.e. easeInCirc). */
export const easeIn = (t: number): number => 1 - Math.sqrt(1 - clamp01(t) ** 2);
/** Symmetric ease for travel between history editions. */
export const easeInOut = (t: number): number => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
};

/** What a pin looks like: opacity and scale. */
export type Visual = { o: number; s: number };
export const HIDDEN: Visual = { o: 0, s: 1 };
export const SHOWN: Visual = { o: 1, s: 1 };

/** An enter or exit in progress (or finished): where it started, when, towards which state. */
export type Track = { shown: boolean; t0: number; delay: number; from: Visual };

/** A settled track (no animation). */
export const settled = (shown: boolean): Track => ({
  shown,
  t0: -Infinity,
  delay: 0,
  from: shown ? SHOWN : HIDDEN,
});

/**
 * Retarget a pin from its current look. A fresh entry (from fully hidden) starts small; an
 * interrupted one continues from where it is, so reversals never jump.
 */
export function retarget(
  current: Visual,
  shown: boolean,
  now: number,
  delay: number,
  cfg: MotionConfig,
): Track {
  const from = shown && current.o === 0 ? { o: 0, s: cfg.scaleFrom } : current;
  return { shown, t0: now, delay: shown ? delay : 0, from };
}

/** A track's look at `now`, and whether it has finished. */
export function trackAt(tr: Track, now: number, cfg: MotionConfig): Visual & { done: boolean } {
  if (tr.shown) {
    const u = cfg.enterMs ? (now - tr.t0 - tr.delay) / cfg.enterMs : 1;
    const e = easeOut(u);
    return { o: tr.from.o + (1 - tr.from.o) * e, s: tr.from.s + (1 - tr.from.s) * e, done: u >= 1 };
  }
  const u = cfg.exitMs ? (now - tr.t0) / cfg.exitMs : 1;
  const e = easeIn(u);
  return {
    o: tr.from.o * (1 - e),
    s: u >= 1 ? 1 : tr.from.s + (cfg.scaleExit - tr.from.s) * e,
    done: u >= 1,
  };
}

/** Per-pin delays for `n` simultaneous entries: `staggerMs` apart, at most `staggerMaxMs` total. */
export function staggerDelays(n: number, cfg: MotionConfig): number[] {
  const step = n > 1 ? Math.min(cfg.staggerMs, cfg.staggerMaxMs / (n - 1)) : 0;
  return Array.from({ length: n }, (_, i) => i * step);
}

/**
 * Live ripple: a ring that expands and fades, once per `pulseMs`, from `t0` (when the pin went
 * live). `ro` = ring opacity, `rs` = ring spread (0–1).
 */
export function pulseAt(t0: number, now: number, cfg: MotionConfig): { ro: number; rs: number } {
  if (!cfg.pulse || !cfg.pulseMs) return { ro: 0, rs: 0 };
  const u = (Math.max(0, now - t0) % cfg.pulseMs) / cfg.pulseMs;
  return { ro: 0.45 * (1 - u) ** 2, rs: easeOut(u) };
}

/**
 * When a ripple that started at `t0` may stop, if its pin stops being live at `now`: at the end of
 * the current cycle (a pin always ripples at least once), so ripples finish instead of cutting.
 */
export function pulseEnd(t0: number, now: number, cfg: MotionConfig): number {
  if (!cfg.pulse || !cfg.pulseMs) return now;
  return t0 + Math.max(1, Math.ceil((now - t0) / cfg.pulseMs)) * cfg.pulseMs;
}

/**
 * A main↔satellite line's look: `o` opacity and `s` draw progress (0–1). Entering, it draws in
 * after its delay (or crossfades in, without line drawing); leaving, it fades out where it is.
 */
export function linkAt(tr: Track, now: number, cfg: MotionConfig): Visual & { done: boolean } {
  if (tr.shown) {
    const ms = cfg.drawLines ? cfg.lineMs : cfg.enterMs;
    const u = ms ? (now - tr.t0 - tr.delay) / ms : 1;
    const e = easeOut(u);
    if (!cfg.drawLines) return { o: tr.from.o + (1 - tr.from.o) * e, s: 1, done: u >= 1 };
    return { o: u > 0 ? 1 : tr.from.o, s: tr.from.s + (1 - tr.from.s) * e, done: u >= 1 };
  }
  const u = cfg.exitMs ? (now - tr.t0) / cfg.exitMs : 1;
  return { o: tr.from.o * (1 - easeIn(u)), s: tr.from.s, done: u >= 1 };
}
