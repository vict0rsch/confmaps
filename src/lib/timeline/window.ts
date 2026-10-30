// Window math for the timeline (DESIGN §5.4), pure: presets, dragging, keyboard nudges and Play
// stepping. A window is the `dates` filter state: `{from, to}`, inclusive `YYYY-MM-DD`.
import { monthEnd, monthStart } from '../filters/dates';
import { formatDateRange } from '../format/dates';
import { addMonthsISO, planWindow, type DateWindow } from '../state/derive';
import {
  addDays,
  dayNumber,
  isoFromDay,
  monthFirstDay,
  monthIndex,
  windowDays,
  type Domain,
} from './scale';

export type PresetId = '6m' | '12m' | '5y' | 'all';
/** `short`: the label in the narrow timeline (the full one stays the accessible name). */
export type Preset = { id: PresetId; label: string; short: string; w: DateWindow };

/** How far back the timeline axis reaches by default (the "Since <year>" preset reaches the rest). */
export const AXIS_PAST_MONTHS = 60;

/**
 * Shared by the timeline and the filter panel's Dates control, in time order like the axis (past,
 * then future), each label saying which side of today it covers. `dataFrom` (the first event's
 * start) adds "Since <year>": from it to today.
 */
export function datePresets(today: string, dataFrom?: string): Preset[] {
  const presets: Preset[] = [
    {
      id: '5y',
      label: 'Past 5 years',
      short: 'Past 5 years',
      w: { from: addMonthsISO(today, -60), to: today },
    },
    { id: '6m', label: 'Next 6 months', short: 'Next 6 mo', w: planWindow(today, 6) },
    { id: '12m', label: 'Next 12 months', short: 'Next 12 mo', w: planWindow(today, 12) },
  ];
  if (dataFrom && dataFrom < today) {
    const label = `Since ${dataFrom.slice(0, 4)}`;
    presets.unshift({ id: 'all', label, short: label, w: { from: dataFrom, to: today } });
  }
  return presets;
}

/**
 * The window once the span start moves from `prevFrom` to `from`: an active "Since <year>"
 * (`prevFrom` → today) follows to the new start; any other window stays (`null`).
 */
export function followSince(
  w: DateWindow,
  prevFrom: string,
  from: string,
  today: string,
): DateWindow | null {
  if (from === prevFrom || from >= today || w.from !== prevFrom || w.to !== today) return null;
  return { from, to: today };
}

/**
 * The span the axis covers by default: the data, but no further back than the last
 * `AXIS_PAST_MONTHS` months (whole months), so decades of history don't squeeze the months ahead.
 */
export function axisSpan(span: DateWindow, today: string): DateWindow {
  const recent = monthStart(addMonthsISO(today, -AXIS_PAST_MONTHS));
  return { from: span.from > recent ? span.from : recent, to: span.to };
}

export const sameWindow = (a: DateWindow, b: DateWindow): boolean =>
  a.from === b.from && a.to === b.to;

const domainFrom = (d: Domain) => isoFromDay(d.start);
const domainTo = (d: Domain) => isoFromDay(d.end - 1);
const clampISO = (v: string, lo: string, hi: string) => (v < lo ? lo : v > hi ? hi : v);

/** Day number of the month boundary (a month's first day) nearest to a fractional day. */
export function nearestBoundary(day: number): number {
  const i = monthIndex(isoFromDay(Math.floor(day)));
  const a = monthFirstDay(i);
  const b = monthFirstDay(i + 1);
  return day - a < b - day ? a : b;
}

/**
 * Drag one handle to a (fractional) day. Handles snap to month boundaries: `from` to a month's
 * first day, `to` to a month's last day. The window never inverts (a handle stops at the month of
 * the other one) and stays inside the domain.
 */
export function dragHandle(w: DateWindow, edge: 'from' | 'to', day: number, d: Domain): DateWindow {
  const b = nearestBoundary(day);
  if (edge === 'from') {
    const from = clampISO(isoFromDay(b), domainFrom(d), monthStart(w.to));
    return { from, to: w.to };
  }
  const to = clampISO(isoFromDay(b - 1), monthEnd(w.from), domainTo(d));
  return { from: w.from, to };
}

/** Move the whole window so it starts on `fromDay` (rounded to a day), keeping its width. */
export function moveWindow(w: DateWindow, fromDay: number, d: Domain): DateWindow {
  const width = windowDays(w);
  const start = Math.min(Math.max(Math.round(fromDay), d.start), d.end - width);
  return { from: isoFromDay(start), to: isoFromDay(start + width - 1) };
}

/** Centre the window on a day, keeping its width (click on the bare track). */
export const centerWindow = (w: DateWindow, day: number, d: Domain): DateWindow =>
  moveWindow(w, day - windowDays(w) / 2, d);

export type Part = 'from' | 'to' | 'window';

/** Keyboard: move a handle (or the whole window) by whole months, clamped to the domain. */
export function nudge(w: DateWindow, part: Part, months: number, d: Domain): DateWindow {
  if (part === 'from') {
    return { from: clampISO(addMonthsISO(w.from, months), domainFrom(d), w.to), to: w.to };
  }
  if (part === 'to') {
    return { from: w.from, to: clampISO(addMonthsISO(w.to, months), w.from, domainTo(d)) };
  }
  return moveWindow(w, dayNumber(addMonthsISO(w.from, months)), d);
}

/** Keyboard Home/End: a handle (or the whole window) to the start or end of the domain. */
export function toDomainEdge(w: DateWindow, part: Part, edge: 'start' | 'end', d: Domain) {
  if (part === 'from') return { from: edge === 'start' ? domainFrom(d) : w.to, to: w.to };
  if (part === 'to') return { from: w.from, to: edge === 'end' ? domainTo(d) : w.from };
  return moveWindow(w, edge === 'start' ? d.start : d.end, d);
}

// ---------------------------------------------------------------------------
// Play
// ---------------------------------------------------------------------------

export const SPEEDS = [0.5, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];
export const nextSpeed = (s: Speed): Speed => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length];

/** At 1×, Play moves the window by one month per second. */
export const MONTH_MS = 1000;
export const AVG_MONTH_DAYS = 365.2425 / 12;

/** Months elapsed after `dtMs` more of playing at `speed`. */
export const advanceMonths = (months: number, dtMs: number, speed: Speed): number =>
  months + (dtMs / MONTH_MS) * speed;

/**
 * The window `months` after `origin`, same width in days. Continuous: day-granular (smooth).
 * Stepped (reduced motion): whole calendar months only; a whole-month window stays whole months
 * (same number of months).
 */
export function playWindow(origin: DateWindow, months: number, stepped: boolean): DateWindow {
  const width = windowDays(origin);
  const k = Math.floor(months);
  if (stepped && origin.from === monthStart(origin.from) && origin.to === monthEnd(origin.to)) {
    return {
      from: addMonthsISO(origin.from, k),
      to: monthEnd(addMonthsISO(monthStart(origin.to), k)),
    };
  }
  const from = stepped
    ? addMonthsISO(origin.from, k)
    : addDays(origin.from, Math.round(months * AVG_MONTH_DAYS));
  return { from, to: addDays(from, width - 1) };
}

/** Clamp a played window at the data end (`to` = last event end); `ended` once it gets there. */
export function clampAtEnd(w: DateWindow, end: string): { w: DateWindow; ended: boolean } {
  if (w.to < end) return { w, ended: false };
  return { w: { from: addDays(end, 1 - windowDays(w)), to: end }, ended: true };
}

/** Play can slide the window only if it is narrower than the data span. */
export const canPlay = (w: DateWindow, span: DateWindow): boolean =>
  windowDays(w) < windowDays(span);

/** Where Play starts: the current window, or back at the data start if already at the end. */
export function playOrigin(w: DateWindow, span: DateWindow): DateWindow {
  if (w.to < span.to) return w;
  const from = monthStart(span.from);
  return { from, to: addDays(from, windowDays(w) - 1) };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const month = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1];

/**
 * The window as text. Whole months read as months ("Nov 2026 – Oct 2027"), other windows as
 * days ("Oct 22, 2026 – Oct 22, 2027"). `short` (compact bar): months only, "Oct ’26 – Oct ’27".
 * A single-digit day gets a leading figure space (as wide as a digit), so the label keeps its
 * width while Play steps through the days.
 */
export function windowLabel(w: DateWindow, short = false): string {
  const yy = (iso: string) => `’${iso.slice(2, 4)}`;
  if (short) {
    const [a, b] = [`${month(w.from)} ${yy(w.from)}`, `${month(w.to)} ${yy(w.to)}`];
    return a === b ? a : `${a} – ${b}`;
  }
  if (w.from === monthStart(w.from) && w.to === monthEnd(w.to)) {
    const [a, b] = [`${month(w.from)} ${w.from.slice(0, 4)}`, `${month(w.to)} ${w.to.slice(0, 4)}`];
    return a === b ? a : `${a} – ${b}`;
  }
  return formatDateRange(w.from, w.to).replace(/\b(\d)\b/g, '\u2007$1');
}

/**
 * `label` once with each month name. Stacked invisibly behind the label, they give it the widest
 * month's width, so it does not change width from month to month.
 */
export const monthVariants = (label: string): string[] =>
  MONTHS.map((m) => label.replace(/[A-Z][a-z]{2}/g, m));

/** One day as text: "Oct 22, 2026". */
export const dayLabel = (iso: string): string => formatDateRange(iso, iso);
