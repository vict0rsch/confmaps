import { kmToMi } from '../geo/distance';
import type { TravelMode } from './model';

// All copy here is deliberately approximate (DESIGN §5.1): `~` prefix, 2 significant figures.

const sig2 = (x: number): number => (x === 0 ? 0 : Number(x.toPrecision(2)));
const num = (x: number): string => x.toLocaleString('en-US', { maximumFractionDigits: 20 });

const PLACEHOLDER = '—';
const invalid = (x: number): boolean => !Number.isFinite(x) || x < 0;

/** "~50 kg", "~1.4 t", "~16 t". Non-finite or negative input gives "—". */
export function formatCo2(kg: number): string {
  if (invalid(kg)) return PLACEHOLDER;
  const r = sig2(kg);
  if (r < 1000) return `~${num(r)} kg`;
  const t = sig2(r / 1000);
  return `~${t < 10 ? t.toFixed(1) : num(t)} t`;
}

/**
 * A range with the same rounding as `formatCo2`: "~4.6–5.1 t", "~260–310 kg", or "~880 kg–1.1 t"
 * across the kg/t switch. Ends that round alike give one figure.
 */
export function formatCo2Range(lo: number, hi: number): string {
  const [a, b] = [formatCo2(lo), formatCo2(hi)];
  if (a === PLACEHOLDER || b === PLACEHOLDER) return PLACEHOLDER;
  if (a === b) return a;
  const [aNum, aUnit] = a.split(' ');
  return aUnit === b.split(' ')[1] ? `${aNum}–${b.slice(1)}` : `${a}–${b.slice(1)}`;
}

/** "~880 km" / "~550 mi". Non-finite or negative input gives "—". */
export function formatDistance(km: number, units: 'km' | 'mi'): string {
  if (invalid(km)) return PLACEHOLDER;
  const v = units === 'mi' ? kmToMi(km) : km;
  return `~${num(sig2(v))} ${units}`;
}

export function modeIcon(mode: TravelMode): string {
  return mode === 'rail' ? '🚆' : '✈️';
}

/**
 * How trip `a` compares to trip `b`: "about the same" (ratio under 1.5), "~3× less" (1.5 to 10,
 * 1 significant figure) or "roughly 54× more" (10 and above, 2 significant figures).
 */
export function compareTrips(a: { kgCO2e: number }, b: { kgCO2e: number }): string {
  const lo = Math.min(a.kgCO2e, b.kgCO2e);
  const hi = Math.max(a.kgCO2e, b.kgCO2e);
  const word = a.kgCO2e < b.kgCO2e ? 'less' : 'more';
  if (hi === 0 || hi / lo < 1.5) return 'about the same';
  if (lo === 0) return `far ${word}`;
  const ratio = hi / lo;
  if (ratio < 10) return `~${Number(ratio.toPrecision(1))}× ${word}`;
  return `roughly ${num(sig2(ratio))}× ${word}`;
}
