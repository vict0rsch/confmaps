import { describe, expect, it, vi } from 'vitest';
import * as model from '../co2/model';
import { estimateTrip } from '../co2/model';
import { hybridLocation, location, virtualLocation } from '../filters/fixtures';
import { formatCo2, formatDistance, modeIcon } from '../co2/format';
import { cityLabel, indexCities, nearestCity, normalize, searchCities } from './cities';
import { comparisonLine, nearestOption, nearestSite, safeTrip } from './footprint';
import { MYCLIMATE_URL, myclimateUrl } from './myclimate';
import type { CitiesFile } from './types';

const file: CitiesFile = {
  v: 1,
  source: 'test',
  minPopulation: 50000,
  countries: {
    DE: 'Germany',
    FR: 'France',
    US: 'United States',
    CH: 'Switzerland',
    AU: 'Australia',
    CN: 'China',
  },
  regions: [
    '',
    'Berlin',
    'Texas',
    'Île-de-France',
    'Zurich',
    'New South Wales',
    'Bavaria',
    'North Rhine-Westphalia',
    'Shanghai',
  ],
  cities: [
    [1796236, '上海', 'Shanghai', 'CN', 8, 31.222, 121.458, 24875],
    [2950159, 'Berlin', '', 'DE', 1, 52.524, 13.411, 3426],
    [2988507, 'Paris', '', 'FR', 3, 48.853, 2.349, 2138],
    [2147714, 'Sydney', '', 'AU', 5, -33.868, 151.209, 4627],
    [2867714, 'Munich', '', 'DE', 6, 48.137, 11.575, 1260],
    [2886242, 'Köln', 'Koln', 'DE', 7, 50.938, 6.96, 1000],
    [2657896, 'Zürich', 'Zurich', 'CH', 4, 47.377, 8.541, 341],
    [2988500, 'Parisot', '', 'FR', 3, 44.0, 1.0, 60],
    [4717560, 'Paris', '', 'US', 2, 33.661, -95.556, 25],
    [3000000, 'Port-Paris Heights', '', 'FR', 3, 45.0, 3.0, 80],
  ],
};
const cities = indexCities(file);
const ids = (q: string) => searchCities(cities, q).map((c) => c.id);

describe('normalize', () => {
  it('folds case, diacritics and punctuation', () => {
    expect(normalize('  Zürich-Nord ')).toBe('zurich nord');
    expect(normalize('São Paulo')).toBe('sao paulo');
    expect(normalize('Straße')).toBe('strasse');
    expect(normalize('Île-de-France')).toBe('ile de france');
  });
});

describe('searchCities', () => {
  it('ignores case and diacritics, both ways', () => {
    expect(ids('zurich')).toEqual([2657896]);
    expect(ids('ZÜRICH')).toEqual([2657896]);
    expect(ids('koln')).toEqual([2886242]);
    expect(ids('köln')).toEqual([2886242]);
  });

  it('matches the ASCII name of non-Latin names', () => {
    expect(ids('shang')).toEqual([1796236]);
    expect(ids('上海')).toEqual([1796236]);
  });

  it('ranks exact, then prefix, then word matches; population breaks ties', () => {
    // exact: both Parises (the list is population-ordered, so France first), then the prefix
    // match "Parisot", then the word match "Port-Paris Heights".
    expect(ids('paris')).toEqual([2988507, 4717560, 2988500, 3000000]);
  });

  it('matches any word of the name by prefix', () => {
    expect(ids('heights')).toEqual([3000000]);
    expect(ids('heights port')).toEqual([3000000]);
  });

  it('qualifies with region or country', () => {
    expect(ids('paris texas')).toEqual([4717560]);
    expect(ids('paris united')).toEqual([4717560]);
  });

  it('returns nothing for blank or unmatched queries, and respects the limit', () => {
    expect(ids('')).toEqual([]);
    expect(ids('  ')).toEqual([]);
    expect(ids('zzzz')).toEqual([]);
    expect(searchCities(cities, 'p', 2)).toHaveLength(2);
  });
});

describe('cityLabel', () => {
  it('shows City, Region, Country and drops a region equal to the name', () => {
    expect(cityLabel(cities[8])).toBe('Paris, Texas, United States');
    expect(cityLabel(cities[1])).toBe('Berlin, Germany');
    expect(cityLabel(cities[2])).toBe('Paris, Île-de-France, France');
  });
});

describe('nearestCity (on-device snapping)', () => {
  it('snaps a point to the closest city', () => {
    expect(nearestCity(cities, { lat: 52.5, lng: 13.4 })?.name).toBe('Berlin');
    expect(nearestCity(cities, { lat: 48.2, lng: 11.6 })?.name).toBe('Munich');
    expect(nearestCity(cities, { lat: 48.9, lng: 2.3 })?.id).toBe(2988507);
    expect(nearestCity(cities, { lat: 33.7, lng: -95.5 })?.id).toBe(4717560);
  });

  it('copes with the antimeridian and the poles', () => {
    expect(nearestCity(cities, { lat: -33.9, lng: -179.9 })?.name).toBe('Sydney');
    expect(nearestCity(cities, { lat: 90, lng: 0 })).toBeDefined();
  });

  it('returns undefined for an empty list', () => {
    expect(nearestCity([], { lat: 0, lng: 0 })).toBeUndefined();
  });
});

const berlin = { lat: 52.524, lng: 13.411 };
const paris = { id: 'neurips26@paris', city: 'Paris', lat: 48.853, lng: 2.349 };
const sydney = { id: 'neurips26@main', city: 'Sydney', lat: -33.868, lng: 151.209 };
const opts = { mode: 'auto', thresholdKm: 1000 } as const;

describe('nearest site and footprint', () => {
  it('picks the site closest to home', () => {
    expect(nearestSite(berlin, [sydney, paris])?.city).toBe('Paris');
    expect(nearestSite(berlin, [])).toBeUndefined();
  });

  const at = (s: typeof paris) => location({ id: s.id, city: s.city, lat: s.lat, lng: s.lng });

  it('formats Berlin to Paris by rail and Berlin to Sydney by air as estimates', () => {
    const near = nearestOption(berlin, [at(sydney), at(paris)], opts)!;
    if (near.kind !== 'trip') throw new Error('expected a trip');
    expect(near.site.city).toBe('Paris');
    expect(near.trip.mode).toBe('rail');
    expect(formatDistance(near.trip.distanceKm, 'km')).toBe('~880 km');
    expect(modeIcon(near.trip.mode)).toBe('🚆');
    expect(formatCo2(near.trip.kgCO2e)).toMatch(/^~\d+ kg$/);
    const far = nearestOption(berlin, [at(sydney)], opts)!;
    if (far.kind !== 'trip') throw new Error('expected a trip');
    expect(far.trip.mode).toBe('flight');
    expect(formatCo2(far.trip.kgCO2e)).toMatch(/^~\d(\.\d)? t$/);
  });

  it('honours the per-trip override', () => {
    expect(safeTrip(berlin, paris, { ...opts, override: 'flight' })!.mode).toBe('flight');
  });

  it('never throws on invalid input', () => {
    expect(safeTrip({ lat: NaN, lng: 0 }, paris, opts)).toBeUndefined();
    expect(safeTrip(berlin, paris, { mode: 'auto', thresholdKm: -1 })).toBeUndefined();
    expect(nearestOption(berlin, [location({ lat: NaN, lng: 1 })], opts)).toBeUndefined();
    expect(nearestOption(berlin, [], opts)).toBeUndefined();
  });

  it('a virtual edition is attended online: no trip is estimated', () => {
    const spy = vi.spyOn(model, 'estimateTrip');
    const online = virtualLocation();
    expect(nearestOption(berlin, [online], opts)).toEqual({ kind: 'online', site: online });
    expect(spy).not.toHaveBeenCalled();
    nearestOption(berlin, [at(paris)], opts); // the spy does see trips
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
    expect(formatCo2(0)).toBe('~0 kg');
  });

  it('a hybrid edition is a trip to its city', () => {
    const option = nearestOption(berlin, [hybridLocation()], opts)!;
    expect(option.kind).toBe('trip');
    if (option.kind === 'trip') expect(option.site.city).toBe('New Orleans');
  });
});

describe('comparisonLine', () => {
  const trip = (to: typeof paris) => estimateTrip(berlin, to, opts);
  it('compares the nearer satellite with the main venue', () => {
    const line = comparisonLine(
      { site: paris, trip: trip(paris) },
      { site: sydney, trip: trip(sydney) },
    );
    expect(line).toMatch(/^Paris: roughly \d+× less than flying to Sydney$/);
  });

  it('says "about the same as" for similar trips', () => {
    const t = trip(paris);
    expect(comparisonLine({ site: paris, trip: t }, { site: { city: 'Lyon' }, trip: t })).toBe(
      'Paris: about the same as taking the train to Lyon',
    );
  });
});

describe('myclimateUrl', () => {
  it('is the plain calculator link unless both IATA codes are valid', () => {
    expect(myclimateUrl()).toBe(MYCLIMATE_URL);
    expect(myclimateUrl('BER')).toBe(MYCLIMATE_URL);
    expect(myclimateUrl('Berlin', 'Sydney')).toBe(MYCLIMATE_URL);
    expect(myclimateUrl('BER', 'syd')).toBe(MYCLIMATE_URL);
  });

  it('prefills from/to with IATA codes', () => {
    expect(myclimateUrl('BER', 'SYD')).toBe(`${MYCLIMATE_URL}?from=BER&to=SYD`);
  });
});
