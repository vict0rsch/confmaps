// `dates`: the {from, to} window. Same state as the timeline/scrubber (DESIGN §5.4).
import DatesControl from '../../components/filters/DatesControl.svelte';
import { inWindow, planWindow, type DateWindow } from '../state/derive';
import { param, readParam, type Filter } from './types';

export type { DateWindow };

const pad = (n: number) => String(n).padStart(2, '0');

/** Days in a month (`month` 1–12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** First / last day of the month of an ISO date or `YYYY-MM`. */
export const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
export function monthEnd(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return `${iso.slice(0, 7)}-${pad(daysInMonth(y, m))}`;
}

/**
 * Parse `YYYY-MM-DD` or `YYYY-MM` (expanded to the month's first or last day, per `edge`).
 * Returns `undefined` for anything else, including impossible dates.
 */
export function parseDay(v: string | null, edge: 'start' | 'end'): string | undefined {
  const m = v?.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!m) return undefined;
  const [y, mo] = [Number(m[1]), Number(m[2])];
  if (y < 1900 || y > 2199 || mo < 1 || mo > 12) return undefined;
  if (m[3] === undefined) return edge === 'start' ? `${m[1]}-${m[2]}-01` : monthEnd(v!);
  const d = Number(m[3]);
  return d >= 1 && d <= daysInMonth(y, mo) ? v! : undefined;
}

/** Whole months are written as `YYYY-MM` (`from=2026-11&to=2027-10`), other days in full. */
const encodeFrom = (iso: string) => (iso === monthStart(iso) ? iso.slice(0, 7) : iso);
const encodeTo = (iso: string) => (iso === monthEnd(iso) ? iso.slice(0, 7) : iso);

export const isValidWindow = (w: DateWindow) =>
  parseDay(w.from, 'start') === w.from && parseDay(w.to, 'end') === w.to && w.from <= w.to;

/**
 * The dates filter for a given `today`: its default is the Plan window (today → +12 months).
 * Pass a function to make the default follow the clock (a tab left open past midnight).
 */
export function createDatesFilter(today: string | (() => string)): Filter<DateWindow> {
  const defaultNow = () => planWindow(typeof today === 'function' ? today() : today);
  return {
    id: 'dates',
    label: 'Dates',
    get defaultState() {
      return defaultNow();
    },
    isActive: (s) => {
      const d = defaultNow();
      return s.from !== d.from || s.to !== d.to;
    },
    appliesWhenInactive: true,
    test: (loc, _ctx, s) => inWindow(loc, s),
    Control: DatesControl,
    params: ['from', 'to'],
    toURL: (s) =>
      [param('from', encodeFrom(s.from)), param('to', encodeTo(s.to))].filter(Boolean).join('&'),
    fromURL: (v) => {
      const defaultState = defaultNow();
      const w = {
        from: parseDay(readParam(v, 'from'), 'start') ?? defaultState.from,
        to: parseDay(readParam(v, 'to'), 'end') ?? defaultState.to,
      };
      return w.from <= w.to ? w : defaultState;
    },
  };
}
