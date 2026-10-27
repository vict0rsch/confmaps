// `co2`: "Estimated footprint under ~X kg" — round-trip estimate from home with the global travel
// mode and threshold (DESIGN §4). Needs home: without it (or if the estimate cannot be computed)
// the filter has no effect. A virtual edition counts as ~0 kg (attending online, no travel); a
// hybrid one is estimated to its city.
import Co2Control from '../../components/filters/Co2Control.svelte';
import { param, parsePositiveInt, readParam, type Ctx, type Filter } from './types';
import type { JoinedLocation } from '../data/load';
import { isVirtual } from '../data/types';

/** Slider stops, kg CO₂e (≤ 2 significant figures, so "~X kg" reads exactly). */
export const CO2_STOPS: readonly number[] = [
  25, 50, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000,
];
export const CO2_MAX_KG = 100_000;

export type Co2State = number | null;

/**
 * Round-trip kg CO₂e from home (`0` for a virtual edition), or `undefined` without home / on
 * invalid input.
 */
export function tripKg(loc: JoinedLocation, ctx: Ctx): number | undefined {
  if (!ctx.home) return undefined;
  if (isVirtual(loc)) return 0;
  try {
    return ctx.co2.estimateTrip(ctx.home, loc, { mode: ctx.mode, thresholdKm: ctx.threshold })
      .kgCO2e;
  } catch {
    return undefined; // RangeError on non-finite coordinates or threshold
  }
}

export const co2Filter: Filter<Co2State> = {
  id: 'co2',
  label: 'Estimated footprint',
  defaultState: null,
  isActive: (s) => s !== null,
  test: (loc, ctx, s) => {
    if (s === null) return true;
    const kg = tripKg(loc, ctx);
    return kg === undefined || kg <= s;
  },
  Control: Co2Control,
  params: ['co2'],
  toURL: (s) => param('co2', s === null ? '' : String(s)),
  fromURL: (v) => parsePositiveInt(readParam(v, 'co2'), CO2_MAX_KG) ?? null,
};
