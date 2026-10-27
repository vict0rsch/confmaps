// `search`: text match on title, full name and series (case- and diacritic-insensitive). Commas
// separate alternatives (any may match); within one, every whitespace-separated word must match.
import SearchControl from '../../components/filters/SearchControl.svelte';
import type { Conference } from '../data/types';
import { param, readParam, type Filter } from './types';

export const SEARCH_MAX_LENGTH = 100;

/** Lowercase, strip diacritics ("Montréal" → "montreal"). */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const haystack = (c: Conference) =>
  fold([c.title, `${c.title} ${c.year}`, c.fullName ?? '', c.series].join(' '));

/** The query as stored: whitespace collapsed, non-empty comma parts joined by ", ", capped. */
export const cleanQuery = (q: string) =>
  q
    .replace(/\s+/g, ' ')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ')
    .slice(0, SEARCH_MAX_LENGTH)
    .replace(/[\s,]+$/, '');

export function matchesQuery(c: Conference, q: string): boolean {
  const text = haystack(c);
  return fold(q)
    .split(',')
    .map((part) => part.split(' ').filter(Boolean))
    .filter((words) => words.length > 0)
    .some((words) => words.every((w) => text.includes(w)));
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
