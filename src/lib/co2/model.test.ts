import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THRESHOLD_KM,
  RAIL_DETOUR_FACTOR,
  SHORT_HAUL_MAX_KM,
  estimateTrip,
  type EstimateOptions,
} from './model';
import { haversineKm, type LatLng } from '../geo/distance';

// Golden values, hand-computed from the official DESNZ 2026 factors (data/co2-factors.json).
// Each mode uses direct + well-to-tank (WTT), kg CO2e / passenger.km:
//   rail   = rail-national 0.03092                + rail-national-wtt 0.00897             = 0.03989
//   short  = flight-short-haul-economy-rf 0.12576 + flight-short-haul-economy-wtt 0.02249 = 0.14825
//            (great-circle < 3,700 km)
//   long   = flight-long-haul-economy-rf 0.11704  + flight-long-haul-economy-wtt 0.02461  = 0.14165
//            (great-circle ≥ 3,700 km)
// Model: rail = d × 1.2 (detour) × 2 (round trip) × 0.03989; flight = d × 2 × (short | long)
// (DESNZ's 8% routing uplift is already inside the flight factors).
// Great-circle distances d were computed independently (Python, haversine, R = 6371 km).

const BERLIN: LatLng = { lat: 52.52, lng: 13.405 };
const PARIS: LatLng = { lat: 48.8566, lng: 2.3522 };
const LONDON: LatLng = { lat: 51.5074, lng: -0.1278 };
const SYDNEY: LatLng = { lat: -33.8688, lng: 151.2093 };

/** Point due north of (0, 0) at exactly `km` great-circle km (1° = π·6371/180 km). */
const northOfNullIsland = (km: number): LatLng => ({
  lat: km / ((Math.PI * 6371) / 180),
  lng: 0,
});
const ORIGIN: LatLng = { lat: 0, lng: 0 };

const auto: EstimateOptions = { mode: 'auto', thresholdKm: DEFAULT_THRESHOLD_KM };

describe('model constants', () => {
  it('match METHODOLOGY.md', () => {
    expect(DEFAULT_THRESHOLD_KM).toBe(1000);
    expect(SHORT_HAUL_MAX_KM).toBe(3700);
    expect(RAIL_DETOUR_FACTOR).toBe(1.2);
  });
});

describe('estimateTrip golden values', () => {
  it('Berlin → Paris is rail under the defaults (877 km < 1,000 km)', () => {
    // d = 877.4633 km < 1000 → rail
    // 877.4633 × 1.2 × 2 × 0.03989 = 2105.912 × 0.03989 = 84.005 kg
    const t = estimateTrip(BERLIN, PARIS, auto);
    expect(t.mode).toBe('rail');
    expect(t.factorId).toBe('rail-national');
    expect(t.roundTrip).toBe(true);
    expect(t.distanceKm).toBeCloseTo(877.4633, 3);
    expect(t.kgCO2e).toBeCloseTo(84.0048, 3);
  });

  it('Berlin → Paris flies when the user lowers the threshold to 700 km', () => {
    // 877.4633 ≥ 700 → short-haul flight
    // 877.4633 × 2 × 0.14825 = 1754.9267 × 0.14825 = 260.168 kg
    const t = estimateTrip(BERLIN, PARIS, { mode: 'auto', thresholdKm: 700 });
    expect(t.mode).toBe('flight');
    expect(t.factorId).toBe('flight-short-haul-economy-rf');
    expect(t.kgCO2e).toBeCloseTo(260.1679, 3);
  });

  it('Berlin → Sydney is a long-haul flight', () => {
    // d = 16094.4999 km ≥ 3700 → long-haul
    // 16094.4999 × 2 × 0.14165 = 32188.9999 × 0.14165 = 4559.572 kg
    const t = estimateTrip(BERLIN, SYDNEY, auto);
    expect(t.mode).toBe('flight');
    expect(t.factorId).toBe('flight-long-haul-economy-rf');
    expect(t.distanceKm).toBeCloseTo(16094.5, 1);
    expect(t.kgCO2e).toBeCloseTo(4559.572, 2);
  });

  it('just under the 1,000 km threshold → rail', () => {
    // 999 × 1.2 × 2 × 0.03989 = 2397.6 × 0.03989 = 95.640 kg
    const t = estimateTrip(ORIGIN, northOfNullIsland(999), auto);
    expect(t.distanceKm).toBeCloseTo(999, 6);
    expect(t.mode).toBe('rail');
    expect(t.kgCO2e).toBeCloseTo(95.6403, 3);
  });

  it('just over the 1,000 km threshold → short-haul flight', () => {
    // 1001 × 2 × 0.14825 = 2002 × 0.14825 = 296.797 kg
    const t = estimateTrip(ORIGIN, northOfNullIsland(1001), auto);
    expect(t.mode).toBe('flight');
    expect(t.factorId).toBe('flight-short-haul-economy-rf');
    expect(t.kgCO2e).toBeCloseTo(296.7965, 3);
  });

  it('exactly at the threshold → flight (rail only strictly below)', () => {
    const p = northOfNullIsland(1000);
    const t = estimateTrip(ORIGIN, p, { mode: 'auto', thresholdKm: haversineKm(ORIGIN, p) });
    expect(t.mode).toBe('flight');
  });

  it('switches haul band at 3,700 km', () => {
    // 3699 × 2 × 0.14825 = 7398 × 0.14825 = 1096.754 kg (short-haul)
    const short = estimateTrip(ORIGIN, northOfNullIsland(3699), auto);
    expect(short.factorId).toBe('flight-short-haul-economy-rf');
    expect(short.kgCO2e).toBeCloseTo(1096.7535, 3);
    // 3701 × 2 × 0.14165 = 7402 × 0.14165 = 1048.493 kg (long-haul)
    const long = estimateTrip(ORIGIN, northOfNullIsland(3701), auto);
    expect(long.factorId).toBe('flight-long-haul-economy-rf');
    expect(long.kgCO2e).toBeCloseTo(1048.4933, 3);
  });

  it('`fly` mode forces a flight on a short trip (Paris → London)', () => {
    // d = 343.5561 km; auto would pick rail:
    //   343.5561 × 1.2 × 2 × 0.03989 = 824.5346 × 0.03989 = 32.891 kg
    // fly: 343.5561 × 2 × 0.14825 = 687.1122 × 0.14825 = 101.864 kg
    const railTrip = estimateTrip(PARIS, LONDON, auto);
    expect(railTrip.mode).toBe('rail');
    expect(railTrip.kgCO2e).toBeCloseTo(32.8907, 3);
    const flyTrip = estimateTrip(PARIS, LONDON, { mode: 'fly', thresholdKm: DEFAULT_THRESHOLD_KM });
    expect(flyTrip.mode).toBe('flight');
    expect(flyTrip.factorId).toBe('flight-short-haul-economy-rf');
    expect(flyTrip.kgCO2e).toBeCloseTo(101.8644, 3);
  });
});

describe('estimateTrip override (detail-panel per-trip toggle)', () => {
  it('wins over auto in both directions', () => {
    // Berlin → Paris, auto 1,000 would take rail; override flight → 260.168 kg (see above)
    const f = estimateTrip(BERLIN, PARIS, { ...auto, override: 'flight' });
    expect(f.mode).toBe('flight');
    expect(f.kgCO2e).toBeCloseTo(260.1679, 3);
    // Berlin → Paris, auto 700 would fly; override rail → 84.005 kg (see above)
    const r = estimateTrip(BERLIN, PARIS, { mode: 'auto', thresholdKm: 700, override: 'rail' });
    expect(r.mode).toBe('rail');
    expect(r.kgCO2e).toBeCloseTo(84.0048, 3);
  });

  it('wins over `fly` mode', () => {
    const r = estimateTrip(PARIS, LONDON, {
      mode: 'fly',
      thresholdKm: DEFAULT_THRESHOLD_KM,
      override: 'rail',
    });
    expect(r.mode).toBe('rail');
    expect(r.kgCO2e).toBeCloseTo(32.8907, 3);
  });

  it('does not change the reported great-circle distance', () => {
    const a = estimateTrip(BERLIN, PARIS, auto);
    const b = estimateTrip(BERLIN, PARIS, { ...auto, override: 'flight' });
    expect(b.distanceKm).toBe(a.distanceKm);
  });
});

describe('estimateTrip invalid input', () => {
  it('throws on non-finite coordinates', () => {
    expect(() => estimateTrip({ lat: NaN, lng: 0 }, PARIS, auto)).toThrow(RangeError);
    expect(() => estimateTrip(PARIS, { lat: 0, lng: Infinity }, auto)).toThrow(RangeError);
  });

  it('throws on non-finite or negative thresholdKm', () => {
    for (const thresholdKm of [NaN, Infinity, -1]) {
      expect(() => estimateTrip(BERLIN, PARIS, { mode: 'auto', thresholdKm })).toThrow(RangeError);
    }
  });
});

describe('estimateTrip edge cases', () => {
  it('same city → 0 kg', () => {
    const t = estimateTrip(PARIS, PARIS, auto);
    expect(t.distanceKm).toBe(0);
    expect(t.kgCO2e).toBe(0);
    expect(t.mode).toBe('rail');
  });
});
