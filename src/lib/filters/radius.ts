// `radius`: within X km/mi of home (great-circle). Needs home: without it the filter has no
// effect and its control is disabled. State is in km (integer) whatever the display units.
// Virtual editions always pass (attending online is no distance); hybrid ones use their city.
import RadiusControl from '../../components/filters/RadiusControl.svelte';
import { isVirtual } from '../data/types';
import { haversineKm } from '../geo/distance';
import { param, parsePositiveInt, readParam, type Filter } from './types';

/** Slider stops, in the display unit (km or mi). */
export const RADIUS_STOPS: readonly number[] = [
  50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 8000, 12000,
];
/** Half the Earth's circumference: every point is within this. */
export const RADIUS_MAX_KM = 20040;

export type RadiusState = number | null;

export const radiusFilter: Filter<RadiusState> = {
  id: 'radius',
  label: 'Distance',
  defaultState: null,
  isActive: (s) => s !== null,
  test: (loc, ctx, s) => {
    if (s === null || !ctx.home) return true;
    if (isVirtual(loc)) return true;
    const d = haversineKm(ctx.home, loc);
    return !Number.isFinite(d) || d <= s;
  },
  Control: RadiusControl,
  params: ['radius'],
  toURL: (s) => param('radius', s === null ? '' : String(s)),
  fromURL: (v) => parsePositiveInt(readParam(v, 'radius'), RADIUS_MAX_KM) ?? null,
};
