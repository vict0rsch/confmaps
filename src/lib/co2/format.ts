import { kmToMi } from '../geo/distance';
import type { TravelMode } from './model';

// All copy here is deliberately approximate (DESIGN §5.1): `~` prefix, 2 significant figures.

const sig2 = (x: number): number => (x === 0 ? 0 : Number(x.toPrecision(2)));
const num = (x: number): string => x.toLocaleString('en-US', { maximumFractionDigits: 20 });

/** "~50 kg", "~1.4 t", "~16 t". */
export function formatCo2(kg: number): string {
  const r = sig2(kg);
  if (r < 1000) return `~${num(r)} kg`;
  const t = sig2(r / 1000);
  return `~${t < 10 ? t.toFixed(1) : num(t)} t`;
}

/** "~880 km" / "~550 mi". */
export function formatDistance(km: number, units: 'km' | 'mi'): string {
  const v = units === 'mi' ? kmToMi(km) : km;
  return `~${num(sig2(v))} ${units}`;
}

export function modeIcon(mode: TravelMode): string {
  return mode === 'rail' ? '🚆' : '✈️';
}

/**
 * How trip `a` compares to trip `b`, e.g. "roughly 58× less" (a is the cheaper one) or
 * "roughly 3.1× more". Ratios under 1.25 read "about the same".
 */
export function compareTrips(a: { kgCO2e: number }, b: { kgCO2e: number }): string {
  const lo = Math.min(a.kgCO2e, b.kgCO2e);
  const hi = Math.max(a.kgCO2e, b.kgCO2e);
  const word = a.kgCO2e < b.kgCO2e ? 'less' : 'more';
  if (hi === 0 || hi / lo < 1.25) return 'about the same';
  if (lo === 0) return `far ${word}`;
  return `roughly ${num(sig2(hi / lo))}× ${word}`;
}
