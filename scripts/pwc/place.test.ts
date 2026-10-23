import { describe, expect, it } from 'vitest';
import golden from './__fixtures__/places.json';
import { parsePlace } from './place';

const actual = (s: string) => {
  const r = parsePlace(s);
  return 'unresolved' in r ? 'unresolved' : r.place;
};

describe('parsePlace: golden table (every latest PwC place string)', () => {
  const entries = Object.entries(golden.places);
  it('covers the 233 distinct strings', () => expect(entries).toHaveLength(233));
  it.each(entries)('%s', (place, expected) => expect(actual(place)).toEqual(expected));
});

describe('parsePlace: forms only in older versions', () => {
  it.each([
    ['online', { format: 'virtual' }],
    ['Virtual conference', { format: 'virtual' }],
    ['Virtual', { format: 'virtual' }],
    ['Lisbon, Portugal & online', { format: 'hybrid', city: 'Lisbon', country: 'Portugal' }],
    [
      'Hybrid (Abu Dhabi, UAE)',
      { format: 'hybrid', city: 'Abu Dhabi', country: 'United Arab Emirates' },
    ],
    ['TBA', 'unresolved'],
    ['', 'unresolved'],
    ['Luxembourg', { format: 'in_person', city: 'Luxembourg', country: 'Luxembourg' }],
    ['Paris', 'unresolved'],
    ['Tbilisi, Georgia', 'unresolved'],
    ['Washington, USA', 'unresolved'],
  ])('%s', (place, expected) => expect(actual(place)).toEqual(expected));

  it('explains why a place is unresolved', () => {
    expect(parsePlace('Potsdam/Berlin, Germany')).toEqual({
      unresolved: 'several cities in "Potsdam/Berlin"',
    });
  });
});
