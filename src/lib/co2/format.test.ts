import { describe, expect, it } from 'vitest';
import { compareTrips, formatCo2, formatDistance, modeIcon } from './format';

describe('formatCo2', () => {
  it('rounds to 2 significant figures with a ~ prefix', () => {
    expect(formatCo2(49.7)).toBe('~50 kg');
    expect(formatCo2(65.115)).toBe('~65 kg');
    expect(formatCo2(220.7)).toBe('~220 kg');
    expect(formatCo2(5.25)).toBe('~5.3 kg');
    expect(formatCo2(0)).toBe('~0 kg');
  });

  it('switches to tonnes at 1000 kg (after rounding)', () => {
    expect(formatCo2(994)).toBe('~990 kg');
    expect(formatCo2(996)).toBe('~1.0 t'); // 996 → 1000 at 2 s.f.
    expect(formatCo2(1400)).toBe('~1.4 t');
    expect(formatCo2(3767.4)).toBe('~3.8 t');
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
    // Berlin→Paris rail 65.115 kg vs Berlin→Sydney flight 3767.4 kg: 57.86 → "58×"
    expect(compareTrips({ kgCO2e: 65.115 }, { kgCO2e: 3767.4 })).toBe('roughly 58× less');
    expect(compareTrips({ kgCO2e: 3767.4 }, { kgCO2e: 65.115 })).toBe('roughly 58× more');
    expect(compareTrips({ kgCO2e: 100 }, { kgCO2e: 2500 })).toBe('roughly 25× less');
    expect(compareTrips({ kgCO2e: 65 }, { kgCO2e: 220 })).toBe('roughly 3.4× less');
  });

  it('treats near-equal and zero cases', () => {
    expect(compareTrips({ kgCO2e: 100 }, { kgCO2e: 110 })).toBe('about the same');
    expect(compareTrips({ kgCO2e: 0 }, { kgCO2e: 0 })).toBe('about the same');
    expect(compareTrips({ kgCO2e: 0 }, { kgCO2e: 50 })).toBe('far less');
  });
});
