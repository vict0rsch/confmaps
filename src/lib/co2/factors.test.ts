import { describe, expect, it } from 'vitest';
import factorsData from '../../../data/co2-factors.json';

// Frozen copy of the DESNZ 2026 values. A yearly factor update MUST fail here: review the new
// values, update METHODOLOGY.md and the golden values in model.test.ts, then update this table.
const EXPECTED_YEAR = 2026;
const EXPECTED: Record<string, number> = {
  'flight-short-haul-economy-rf': 0.12576,
  'flight-short-haul-economy-no-rf': 0.07435,
  'flight-long-haul-economy-rf': 0.11704,
  'flight-long-haul-economy-no-rf': 0.06926,
  'flight-international-economy-rf': 0.10916,
  'flight-international-economy-no-rf': 0.06449,
  'flight-domestic-average-rf': 0.22928,
  'flight-domestic-average-no-rf': 0.13552,
  'rail-national': 0.03092,
  'rail-international': 0.01135,
};

describe('data/co2-factors.json', () => {
  it(`is the DESNZ ${EXPECTED_YEAR} set`, () => {
    expect(factorsData.source.year).toBe(EXPECTED_YEAR);
    expect(factorsData.unit).toBe('kg CO2e per passenger.km');
  });

  it('has exactly the frozen factor ids and values', () => {
    const actual = Object.fromEntries(
      Object.entries(factorsData.factors).map(([id, f]) => [id, f.value]),
    );
    expect(actual).toEqual(EXPECTED);
  });

  it('marks only the model defaults as used', () => {
    const used = Object.entries(factorsData.factors)
      .filter(([, f]) => f.usedByDefault)
      .map(([id]) => id)
      .sort();
    expect(used).toEqual([
      'flight-long-haul-economy-rf',
      'flight-short-haul-economy-rf',
      'rail-national',
    ]);
  });
});
