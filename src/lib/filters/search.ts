// `search`: text match on title, full name and series (case- and diacritic-insensitive). Every
// whitespace-separated word must match somewhere.
import SearchControl from '../../components/filters/SearchControl.svelte';
import type { Conference } from '../data/types';
import { param, readParam, type Filter } from './types';

export const SEARCH_MAX_LENGTH = 100;

/** Lowercase, strip diacritics ("Montréal" → "montreal"). */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const haystack = (c: Conference) =>
  fold([c.title, `${c.title} ${c.year}`, c.fullName ?? '', c.series].join(' '));

/** The query as stored: trimmed, inner whitespace collapsed, capped. */
export const cleanQuery = (q: string) =>
  q.replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX_LENGTH).trim();

export function matchesQuery(c: Conference, q: string): boolean {
  const words = fold(q).split(' ').filter(Boolean);
  const text = haystack(c);
  return words.every((w) => text.includes(w));
}

export const searchFilter: Filter<string> = {
  id: 'search',
  label: 'Search',
  defaultState: '',
  isActive: (s) => s.length > 0,
  test: (loc, _ctx, s) => matchesQuery(loc.conference, s),
  Control: SearchControl,
  params: ['q'],
  toURL: (s) => param('q', s),
  fromURL: (v) => cleanQuery(readParam(v, 'q') ?? ''),
};
