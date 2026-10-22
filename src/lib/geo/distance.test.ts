import { describe, expect, it } from 'vitest';
import { EARTH_RADIUS_KM, haversineKm, kmToMi, miToKm } from './distance';

describe('haversineKm', () => {
  it('is 0 for the same point', () => {
    expect(haversineKm({ lat: 48.8566, lng: 2.3522 }, { lat: 48.8566, lng: 2.3522 })).toBe(0);
  });

  it('matches the Rosetta Code reference (Nashville BNA → LAX)', () => {
    // Reference: rosettacode.org/wiki/Haversine_formula gives 2887.2599506071106 km for
    // (36.12, -86.67) → (33.94, -118.40) with R = 6372.8 km. Distance scales linearly with R,
    // so with our R = 6371 km: 2887.2599506071106 × 6371 / 6372.8 = 2886.4444 km.
    const d = haversineKm({ lat: 36.12, lng: -86.67 }, { lat: 33.94, lng: -118.4 });
    expect(d).toBeCloseTo((2887.2599506071106 * 6371) / 6372.8, 6);
  });

  it('gives a quarter meridian of π·R/2', () => {
    // Equator → North Pole along a meridian: π × 6371 / 2 = 10007.543 km.
    const d = haversineKm({ lat: 0, lng: 0 }, { lat: 90, lng: 0 });
    expect(d).toBeCloseTo((Math.PI * EARTH_RADIUS_KM) / 2, 6);
    expect(d).toBeCloseTo(10007.543, 3);
  });

  it('is symmetric and handles the antimeridian', () => {
    const a = { lat: -33.8688, lng: 151.2093 };
    const b = { lat: 52.52, lng: 13.405 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
    // 1° of longitude across ±180 on the equator = π × 6371 / 180 = 111.195 km.
    expect(haversineKm({ lat: 0, lng: 179.5 }, { lat: 0, lng: -179.5 })).toBeCloseTo(111.195, 3);
  });
});

describe('km ↔ mi', () => {
  it('uses the international mile (1.609344 km)', () => {
    expect(kmToMi(1.609344)).toBeCloseTo(1, 12);
    expect(miToKm(100)).toBeCloseTo(160.9344, 9);
    expect(miToKm(kmToMi(880))).toBeCloseTo(880, 9);
  });
});
