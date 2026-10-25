import { describe, expect, it } from 'vitest';
import { compareTrips, formatCo2, formatCo2Range, formatDistance, modeIcon } from './format';

describe('formatCo2', () => {
  it('rounds to 2 significant figures with a ~ prefix', () => {
    expect(formatCo2(49.7)).toBe('~50 kg');
    expect(formatCo2(65.115)).toBe('~65 kg');
    expect(formatCo2(220.7)).toBe('~220 kg');
    expect(formatCo2(84.0048)).toBe('~84 kg'); // golden: Berlin → Paris rail
    expect(formatCo2(260.1679)).toBe('~260 kg'); // golden: Berlin → Paris flight
    expect(formatCo2(101.8644)).toBe('~100 kg'); // golden: Paris → London flight
    expect(formatCo2(5.25)).toBe('~5.3 kg');
    expect(formatCo2(0)).toBe('~0 kg');
  });

  it('switches to tonnes at 1000 kg (after rounding)', () => {
    expect(formatCo2(994)).toBe('~990 kg');
    expect(formatCo2(996)).toBe('~1.0 t'); // 996 → 1000 at 2 s.f.
    expect(formatCo2(1400)).toBe('~1.4 t');
    expect(formatCo2(3767.4)).toBe('~3.8 t');
    expect(formatCo2(4559.572)).toBe('~4.6 t'); // golden: Berlin → Sydney flight
    expect(formatCo2(16_349)).toBe('~16 t');
    expect(formatCo2(123_456)).toBe('~120 t');
  });

  it('never shows more than 2 significant figures', () => {
    for (const kg of [1.234, 12.34, 123.4, 1234, 12_345, 123_456]) {
      const digits = formatCo2(kg)
        .replace(/[^0-9]/g, '')
        .replace(/^0+/, '')
        .replace(/0+$/, '');
      expect(digits.length).toBeLessThanOrEqual(2);
    }
  });
});

describe('formatCo2Range', () => {
  it('shares the unit when both ends use it', () => {
    expect(formatCo2Range(4559.572, 5015.53)).toBe('~4.6–5.0 t'); // golden: Berlin → Sydney
    expect(formatCo2Range(260.1679, 312.2)).toBe('~260–310 kg'); // golden: Berlin → Paris flight
  });
  it('spells both units across the kg/t switch, and collapses equal ends', () => {
    expect(formatCo2Range(880, 1056)).toBe('~880 kg–1.1 t');
    expect(formatCo2Range(0, 0)).toBe('~0 kg');
    expect(formatCo2Range(NaN, 5)).toBe('—');
  });
});

describe('invalid input', () => {
  it('formatCo2 and formatDistance return a placeholder', () => {
    for (const x of [NaN, Infinity, -Infinity, -5]) {
      expect(formatCo2(x)).toBe('—');
      expect(formatDistance(x, 'km')).toBe('—');
      expect(formatDistance(x, 'mi')).toBe('—');
    }
  });
});

describe('formatDistance', () => {
  it('formats km with ~ and 2 significant figures', () => {
    expect(formatDistance(877.46, 'km')).toBe('~880 km');
    expect(formatDistance(343.56, 'km')).toBe('~340 km');
    expect(formatDistance(16_094.5, 'km')).toBe('~16,000 km');
  });

  it('converts to miles', () => {
    // 877.46 km / 1.609344 = 545.2 mi → ~550 mi
    expect(formatDistance(877.46, 'mi')).toBe('~550 mi');
    // 16094.5 / 1.609344 = 10000.6 mi → ~10,000 mi
    expect(formatDistance(16_094.5, 'mi')).toBe('~10,000 mi');
  });
});

describe('modeIcon', () => {
  it('maps modes to icons', () => {
    expect(modeIcon('rail')).toBe('🚆');
    expect(modeIcon('flight')).toBe('✈️');
  });
});

describe('compareTrips', () => {
  it('phrases scale differences', () => {
    // Current golden values: Berlin→Paris rail 84.0048 kg vs Berlin→Sydney flight 4559.572 kg:
    // 4559.572 / 84.0048 = 54.28 → "54×"
    expect(compareTrips({ kgCO2e: 84.0048 }, { kgCO2e: 4559.572 })).toBe('roughly 54× less');
    // Direct-only figures (before WTT was added): 3767.4 / 65.115 = 57.86 → "58×"
    expect(compareTrips({ kgCO2e: 65.115 }, { kgCO2e: 3767.4 })).toBe('roughly 58× less');
    expect(compareTrips({ kgCO2e: 3767.4 }, { kgCO2e: 65.115 })).toBe('roughly 58× more');
    expect(compareTrips({ kgCO2e: 100 }, { kgCO2e: 2500 })).toBe('roughly 25× less');
    expect(compareTrips({ kgCO2e: 65 }, { kgCO2e: 220 })).toBe('~3× less');
    expect(compareTrips({ kgCO2e: 300 }, { kgCO2e: 100 })).toBe('~3× more');
    expect(compareTrips({ kgCO2e: 100 }, { kgCO2e: 150 })).toBe('~2× less'); // 1.5 boundary
    expect(compareTrips({ kgCO2e: 100 }, { kgCO2e: 1000 })).toBe('roughly 10× less'); // 10 boundary
  });

  it('treats near-equal and zero cases', () => {
    expect(compareTrips({ kgCO2e: 100 }, { kgCO2e: 110 })).toBe('about the same');
    expect(compareTrips({ kgCO2e: 100 }, { kgCO2e: 149 })).toBe('about the same');
    expect(compareTrips({ kgCO2e: 0 }, { kgCO2e: 0 })).toBe('about the same');
    expect(compareTrips({ kgCO2e: 0 }, { kgCO2e: 50 })).toBe('far less');
    expect(compareTrips({ kgCO2e: 50 }, { kgCO2e: 0 })).toBe('far more');
  });
});
