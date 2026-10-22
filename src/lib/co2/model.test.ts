import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THRESHOLD_KM,
  RAIL_DETOUR_FACTOR,
  SHORT_HAUL_MAX_KM,
  estimateTrip,
  type EstimateOptions,
} from './model';
import { haversineKm, type LatLng } from '../geo/distance';

// Golden values, hand-computed from the official DESNZ 2026 factors (data/co2-factors.json):
//   rail-national                 0.03092 kg CO2e / passenger.km
//   flight-short-haul-economy-rf  0.12576 kg CO2e / passenger.km  (great-circle < 3,700 km)
//   flight-long-haul-economy-rf   0.11704 kg CO2e / passenger.km  (great-circle ≥ 3,700 km)
// Model: rail = d × 1.2 (detour) × 2 (round trip) × factor; flight = d × 2 × factor
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
    expect(DEFAULT_THRESHOLD_KM).toBe(700);
    expect(SHORT_HAUL_MAX_KM).toBe(3700);
    expect(RAIL_DETOUR_FACTOR).toBe(1.2);
  });
});

describe('estimateTrip golden values', () => {
  it('Berlin → Paris by rail (auto, threshold above the 877 km distance)', () => {
    // d = 877.4633 km < 1000 → rail
    // 877.4633 × 1.2 × 2 × 0.03092 = 2105.912 × 0.03092 = 65.115 kg
    const t = estimateTrip(BERLIN, PARIS, { mode: 'auto', thresholdKm: 1000 });
    expect(t.mode).toBe('rail');
    expect(t.factorId).toBe('rail-national');
    expect(t.roundTrip).toBe(true);
    expect(t.distanceKm).toBeCloseTo(877.4633, 3);
    expect(t.kgCO2e).toBeCloseTo(65.115, 2);
  });

  it('Berlin → Paris flies with the default 700 km threshold (877 km ≥ 700)', () => {
    // 877.4633 × 2 × 0.12576 = 1754.9267 × 0.12576 = 220.700 kg
    const t = estimateTrip(BERLIN, PARIS, auto);
    expect(t.mode).toBe('flight');
    expect(t.factorId).toBe('flight-short-haul-economy-rf');
    expect(t.kgCO2e).toBeCloseTo(220.7, 1);
  });

  it('Berlin → Sydney is a long-haul flight', () => {
    // d = 16094.4999 km ≥ 3700 → long-haul
    // 16094.4999 × 2 × 0.11704 = 32188.9999 × 0.11704 = 3767.401 kg
    const t = estimateTrip(BERLIN, SYDNEY, auto);
    expect(t.mode).toBe('flight');
    expect(t.factorId).toBe('flight-long-haul-economy-rf');
    expect(t.distanceKm).toBeCloseTo(16094.5, 1);
    expect(t.kgCO2e).toBeCloseTo(3767.4, 1);
  });

  it('just under the 700 km threshold → rail', () => {
    // 699 × 1.2 × 2 × 0.03092 = 1677.6 × 0.03092 = 51.871 kg
    const t = estimateTrip(ORIGIN, northOfNullIsland(699), auto);
    expect(t.distanceKm).toBeCloseTo(699, 6);
    expect(t.mode).toBe('rail');
    expect(t.kgCO2e).toBeCloseTo(51.8714, 3);
  });

  it('just over the 700 km threshold → short-haul flight', () => {
    // 701 × 2 × 0.12576 = 1402 × 0.12576 = 176.316 kg
    const t = estimateTrip(ORIGIN, northOfNullIsland(701), auto);
    expect(t.mode).toBe('flight');
    expect(t.factorId).toBe('flight-short-haul-economy-rf');
    expect(t.kgCO2e).toBeCloseTo(176.3155, 3);
  });

  it('exactly at the threshold → flight (rail only strictly below)', () => {
    const p = northOfNullIsland(700);
    const t = estimateTrip(ORIGIN, p, { mode: 'auto', thresholdKm: haversineKm(ORIGIN, p) });
    expect(t.mode).toBe('flight');
  });

  it('switches haul band at 3,700 km', () => {
    // 3699 × 2 × 0.12576 = 930.373 kg (short-haul)
    const short = estimateTrip(ORIGIN, northOfNullIsland(3699), auto);
    expect(short.factorId).toBe('flight-short-haul-economy-rf');
    expect(short.kgCO2e).toBeCloseTo(930.3725, 3);
    // 3701 × 2 × 0.11704 = 866.330 kg (long-haul)
    const long = estimateTrip(ORIGIN, northOfNullIsland(3701), auto);
    expect(long.factorId).toBe('flight-long-haul-economy-rf');
    expect(long.kgCO2e).toBeCloseTo(866.3301, 3);
  });

  it('`fly` mode forces a flight on a short trip (Paris → London)', () => {
    // d = 343.5561 km; auto would pick rail:
    //   343.5561 × 1.2 × 2 × 0.03092 = 25.495 kg
    // fly: 343.5561 × 2 × 0.12576 = 86.411 kg
    const railTrip = estimateTrip(PARIS, LONDON, auto);
    expect(railTrip.mode).toBe('rail');
    expect(railTrip.kgCO2e).toBeCloseTo(25.4946, 3);
    const flyTrip = estimateTrip(PARIS, LONDON, { mode: 'fly', thresholdKm: 700 });
    expect(flyTrip.mode).toBe('flight');
    expect(flyTrip.factorId).toBe('flight-short-haul-economy-rf');
    expect(flyTrip.kgCO2e).toBeCloseTo(86.4112, 3);
  });
});

describe('estimateTrip override (detail-panel per-trip toggle)', () => {
  it('wins over auto in both directions', () => {
    // Berlin → Paris, auto 700 would fly; override rail → 65.115 kg (see above)
    const r = estimateTrip(BERLIN, PARIS, { ...auto, override: 'rail' });
    expect(r.mode).toBe('rail');
    expect(r.kgCO2e).toBeCloseTo(65.115, 2);
    // Paris → London, auto would take rail; override flight → 86.411 kg
    const f = estimateTrip(PARIS, LONDON, { ...auto, override: 'flight' });
    expect(f.mode).toBe('flight');
    expect(f.kgCO2e).toBeCloseTo(86.4112, 3);
  });

  it('wins over `fly` mode', () => {
    const r = estimateTrip(PARIS, LONDON, { mode: 'fly', thresholdKm: 700, override: 'rail' });
    expect(r.mode).toBe('rail');
    expect(r.kgCO2e).toBeCloseTo(25.4946, 3);
  });

  it('does not change the reported great-circle distance', () => {
    const a = estimateTrip(BERLIN, PARIS, auto);
    const b = estimateTrip(BERLIN, PARIS, { ...auto, override: 'rail' });
    expect(b.distanceKm).toBe(a.distanceKm);
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
