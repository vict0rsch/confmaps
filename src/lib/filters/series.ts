// `series`: one conference series (e.g. `neurips`), all its editions. Conference-level. "View
// history" sets it, with the dates window over the series' editions (`seriesWindow`).
import SeriesControl from '../../components/filters/SeriesControl.svelte';
import type { JoinedLocation } from '../data/load';
import type { Conference } from '../data/types';
import { dataSpan } from '../timeline/scale';
import { monthEnd, monthStart, type DateWindow } from './dates';
import { param, readParam, type Filter } from './types';

/** Whether any conference belongs to series `s`. */
export const isSeries = (conferences: readonly Conference[], s: string): boolean =>
  conferences.some((c) => c.series === s);

/** Display name of a series, from its latest edition (e.g. "NeurIPS"). */
export function seriesTitle(conferences: readonly Conference[], s: string): string {
  const latest = conferences.filter((c) => c.series === s).sort((a, b) => b.year - a.year)[0];
  return latest?.title ?? s;
}

/**
 * Whole months from the series' first start to its last end, over every location (satellites
 * included; the last edition may be in the future).
 */
export function seriesWindow(locations: readonly JoinedLocation[], s: string): DateWindow {
  const { from, to } = dataSpan(locations.filter((l) => l.conference.series === s))!;
  return { from: monthStart(from), to: monthEnd(to) };
}

export const seriesFilter: Filter<string | null> = {
  id: 'series',
  label: 'Series',
  defaultState: null,
  isActive: (s) => s !== null,
  test: (loc, _ctx, s) => loc.conference.series === s,
  Control: SeriesControl,
  params: ['series'],
  toURL: (s) => param('series', s ?? ''),
  fromURL: (v) => {
    const s = readParam(v, 'series');
    return s && /^[a-z0-9-]{1,40}$/.test(s) ? s : null;
  },
};
