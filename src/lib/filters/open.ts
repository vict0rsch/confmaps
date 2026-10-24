// `open`: "Submission still open" — the conference has an upstream abstract or paper deadline
// after now. Conference-level.
import OpenControl from '../../components/filters/OpenControl.svelte';
import type { Conference } from '../data/types';
import { PAPER_DEADLINE_TYPES } from '../state/derive';
import { readParam, type Filter } from './types';

/** Upstream `deadlines[].type` values that close submissions (`submission` = paper upstream). */
export const SUBMISSION_DEADLINE_TYPES: readonly string[] = ['abstract', ...PAPER_DEADLINE_TYPES];

export function submissionOpen(c: Pick<Conference, 'deadlines'>, now: Date): boolean {
  const t = now.getTime();
  return c.deadlines.some(
    (d) => SUBMISSION_DEADLINE_TYPES.includes(d.type) && Date.parse(d.date) > t,
  );
}

export const openFilter: Filter<boolean> = {
  id: 'open',
  label: 'Open for papers',
  defaultState: false,
  isActive: (s) => s,
  test: (loc, ctx) => submissionOpen(loc.conference, ctx.now),
  Control: OpenControl,
  params: ['open'],
  toURL: (s) => (s ? 'open=1' : ''),
  fromURL: (v) => readParam(v, 'open') === '1',
};
