// The timeline's time axis (DESIGN §6.4), pure: day numbers, the axis domain, the events-per-month
// histogram and sparse axis ticks. Dates are calendar dates (`YYYY-MM-DD`), handled in UTC.
import type { DateWindow } from '../state/derive';

const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Days since 1970-01-01 of a `YYYY-MM-DD` date. */
export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export const isoFromDay = (day: number): string =>
  new Date(Math.round(day) * DAY_MS).toISOString().slice(0, 10);

export const addDays = (iso: string, n: number): string => isoFromDay(dayNumber(iso) + n);

/** Length of a window in days, both ends inclusive. */
export const windowDays = (w: DateWindow): number => dayNumber(w.to) - dayNumber(w.from) + 1;

/** Months since year 0: `2026-10-…` → 2026 × 12 + 9. */
export const monthIndex = (iso: string): number =>
  Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;

/** `YYYY-MM` of a month index. */
export const monthKey = (i: number): string =>
  `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;

/** Day number of the first day of a month index. */
export const monthFirstDay = (i: number): number => dayNumber(`${monthKey(i)}-01`);

/** The axis: whole months, as day numbers `[start, end)`. */
export type Domain = { start: number; end: number };

/** Month-aligned window covering every location's dates (`null` when there are none). */
export function dataSpan(locs: readonly { start: string; end: string }[]): DateWindow | null {
  if (!locs.length) return null;
  let from = locs[0].start;
  let to = locs[0].end;
  for (const l of locs) {
    if (l.start < from) from = l.start;
    if (l.end > to) to = l.end;
  }
  return { from, to };
}

/**
 * Smallest month-aligned domain covering `prev` and every window. Never smaller than `prev`, so
 * the axis stays put while a handle is dragged or Play slides the window (it only ever grows).
 */
export function coverDomain(
  prev: Domain | undefined,
  ...windows: (DateWindow | null | undefined)[]
): Domain {
  let start = prev?.start ?? Infinity;
  let end = prev?.end ?? -Infinity;
  for (const w of windows) {
    if (!w) continue;
    start = Math.min(start, monthFirstDay(monthIndex(w.from)));
    end = Math.max(end, monthFirstDay(monthIndex(w.to) + 1));
  }
  if (!Number.isFinite(start)) throw new Error('coverDomain: nothing to cover');
  return { start, end };
}

/** x (px) of a day number on a `width`-px axis. */
export const toX = (day: number, d: Domain, width: number): number =>
  ((day - d.start) / (d.end - d.start)) * width;

/** Day number (fractional) under x (px). */
export const toDay = (x: number, d: Domain, width: number): number =>
  d.start + (x / Math.max(1, width)) * (d.end - d.start);

export type Bin = { month: string; start: number; end: number; count: number };

/**
 * Events per month over the domain: each location counts once in every month its dates overlap
 * (most events are a few days long, so almost always in exactly one month).
 */
export function histogram(locs: readonly { start: string; end: string }[], d: Domain): Bin[] {
  const first = monthIndex(isoFromDay(d.start));
  const last = monthIndex(isoFromDay(d.end - 1));
  const counts = new Array<number>(last - first + 1).fill(0);
  for (const l of locs) {
    const a = Math.max(first, monthIndex(l.start));
    const b = Math.min(last, monthIndex(l.end));
    for (let i = a; i <= b; i++) counts[i - first]++;
  }
  return counts.map((count, k) => ({
    month: monthKey(first + k),
    start: monthFirstDay(first + k),
    end: monthFirstDay(first + k + 1),
    count,
  }));
}

export type Tick = { day: number; label: string; kind: 'year' | 'month' };

/** Years are labelled every 1, 2, 5 or 10 years: the first step that keeps labels this far apart. */
const YEAR_LABEL_PX = 32;
const YEAR_STEPS = [1, 2, 5, 10];

/**
 * Sparse axis labels: every January as the year (every 2nd, 5th or 10th year when years are too
 * narrow, e.g. on a phone or over many years); quarters (Apr/Jul/Oct) when months are ≥ 16 px
 * wide; every month when ≥ 40 px. A leading partial year is labelled at the domain start when it
 * has room (≥ 3 months and ≥ 36 px, so it does not run into the next year's label).
 */
export function axisTicks(d: Domain, width: number): Tick[] {
  const first = monthIndex(isoFromDay(d.start));
  const last = monthIndex(isoFromDay(d.end - 1));
  const monthPx = width / (last - first + 1);
  const step = YEAR_STEPS.find((n) => n * 12 * monthPx >= YEAR_LABEL_PX) ?? 10;
  const ticks: Tick[] = [];
  for (let i = first; i <= last; i++) {
    const m = i % 12;
    const day = monthFirstDay(i);
    if (m === 0) {
      if ((i / 12) % step === 0) ticks.push({ day, label: String(i / 12), kind: 'year' });
    } else if (i === first && step === 1 && 12 - m >= 3 && (12 - m) * monthPx >= 36) {
      ticks.push({ day, label: String(Math.floor(i / 12)), kind: 'year' });
    } else if (monthPx >= 40 || (monthPx >= 16 && m % 3 === 0)) {
      ticks.push({ day, label: MONTHS[m], kind: 'month' });
    }
  }
  return ticks;
}
