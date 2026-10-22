import { describe, expect, it } from 'vitest';
import { canonicalCountry, countryCode } from './countries';

describe('countries', () => {
  it.each([
    ['USA', 'United States', 'us'],
    ['Tennessee', 'United States', 'us'],
    ['the netherlands', 'Netherlands', 'nl'],
    ['Tuscany', 'Italy', 'it'],
    // Pinned names win over Intl's (they are in geocache keys and data.json).
    ['Czechia', 'Czech Republic', 'cz'],
    ['Türkiye', 'Turkey', 'tr'],
    ['Hong Kong SAR China', 'Hong Kong', 'cn'],
    ['Macau', 'Macao', 'cn'],
    // Countries not in the table come from Intl.DisplayNames.
    ['Kenya', 'Kenya', 'ke'],
    ['  saudi   arabia ', 'Saudi Arabia', 'sa'],
    ['Cote d’Ivoire', 'Côte d’Ivoire', 'ci'],
    ['Bosnia', 'Bosnia & Herzegovina', 'ba'],
  ])('%j → %s (%s)', (raw, name, code) => {
    expect(canonicalCountry(raw)).toBe(name);
    expect(countryCode(name)).toBe(code);
  });

  it.each(['Atlantis', 'European Union', 'Unknown Region', ''])('rejects %j', (raw) => {
    expect(canonicalCountry(raw)).toBeUndefined();
  });
});
