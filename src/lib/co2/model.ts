import factorsData from '../../../data/co2-factors.json';
import { haversineKm, type LatLng } from '../geo/distance';

export type TravelMode = 'rail' | 'flight';
export type ModeSetting = 'auto' | 'fly';

export type TripEstimate = {
  mode: TravelMode;
  /** One-way great-circle distance, km (what the UI shows). */
  distanceKm: number;
  /** Round-trip estimate, kg CO2e. */
  kgCO2e: number;
  roundTrip: true;
  /** Key into data/co2-factors.json `factors`. */
  factorId: string;
};

export type EstimateOptions = {
  mode: ModeSetting;
  thresholdKm: number;
  /** Per-trip toggle from the detail panel; wins over `mode`. */
  override?: TravelMode;
};

/** Default `auto` threshold: rail below this great-circle distance, flight at or above. */
export const DEFAULT_THRESHOLD_KM = 700;

/**
 * Great-circle distance at which flights switch from the DESNZ short-haul to the long-haul
 * factor. DESNZ methodology §8.8 (the earlier "<3,700 km = short-haul" rule). See METHODOLOGY.md.
 */
export const SHORT_HAUL_MAX_KM = 3700;

/**
 * Rail route length relative to great-circle distance. Our assumption, not a DESNZ value.
 * See METHODOLOGY.md. No uplift is applied to flights: DESNZ's 8% great-circle uplift is
 * already included in the flight factors (methodology §8.38).
 */
export const RAIL_DETOUR_FACTOR = 1.2;

export const RAIL_FACTOR_ID = 'rail-national';
export const SHORT_HAUL_FACTOR_ID = 'flight-short-haul-economy-rf';
export const LONG_HAUL_FACTOR_ID = 'flight-long-haul-economy-rf';

export const CO2_FACTORS_SOURCE = factorsData.source;

const factors: Record<string, { value: number }> = factorsData.factors;

function factorValue(id: string): number {
  const f = factors[id];
  if (!f) throw new Error(`Unknown CO2 factor: ${id}`);
  return f.value;
}

/** Order-of-magnitude round-trip estimate for one traveller, economy class, RF included. */
export function estimateTrip(from: LatLng, to: LatLng, opts: EstimateOptions): TripEstimate {
  const distanceKm = haversineKm(from, to);
  const mode: TravelMode =
    opts.override ?? (opts.mode === 'auto' && distanceKm < opts.thresholdKm ? 'rail' : 'flight');

  if (mode === 'rail') {
    const factorId = RAIL_FACTOR_ID;
    const kgCO2e = distanceKm * RAIL_DETOUR_FACTOR * 2 * factorValue(factorId);
    return { mode, distanceKm, kgCO2e, roundTrip: true, factorId };
  }
  const factorId = distanceKm < SHORT_HAUL_MAX_KM ? SHORT_HAUL_FACTOR_ID : LONG_HAUL_FACTOR_ID;
  const kgCO2e = distanceKm * 2 * factorValue(factorId);
  return { mode, distanceKm, kgCO2e, roundTrip: true, factorId };
}

/** Shape passed to filters as `ctx.co2` (DESIGN §6.3). */
export type Co2Model = { estimateTrip: typeof estimateTrip };
export const co2Model: Co2Model = { estimateTrip };
