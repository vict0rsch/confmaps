// `access`: who can attend a location (open / registration / authors only). Multi-select; a
// location passes if its access level is selected.
import AccessControl from '../../components/filters/AccessControl.svelte';
import type { Access } from '../format/labels';
import { param, readParam, type Filter } from './types';

export const ACCESS_LEVELS: readonly Access[] = ['open', 'registration', 'authors_only'];

/** Selected levels, in `ACCESS_LEVELS` order (so equal selections compare equal). */
export type AccessState = Access[];

export const normalizeAccess = (levels: Iterable<string>): AccessState => {
  const set = new Set(levels);
  return ACCESS_LEVELS.filter((a) => set.has(a));
};

export const accessFilter: Filter<AccessState> = {
  id: 'access',
  label: 'Access',
  defaultState: [],
  isActive: (s) => s.length > 0,
  test: (loc, _ctx, s) => s.includes(loc.access),
  Control: AccessControl,
  params: ['access'],
  toURL: (s) => param('access', s.join(',')),
  fromURL: (v) => normalizeAccess((readParam(v, 'access') ?? '').split(',')),
};
