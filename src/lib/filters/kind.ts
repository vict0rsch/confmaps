// `kind`: official locations (the conference itself, official satellites) or community ones.
import KindControl from '../../components/filters/KindControl.svelte';
import { param, readParam, type Filter } from './types';

export type KindState = 'official' | 'community' | null;

export const kindFilter: Filter<KindState> = {
  id: 'kind',
  label: 'Organizer',
  defaultState: null,
  isActive: (s) => s !== null,
  test: (loc, _ctx, s) => (s === 'official') === loc.official,
  Control: KindControl,
  params: ['kind'],
  toURL: (s) => param('kind', s ?? ''),
  fromURL: (v) => {
    const k = readParam(v, 'kind');
    return k === 'official' || k === 'community' ? k : null;
  },
};
