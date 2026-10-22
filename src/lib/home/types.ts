/**
 * Compact city row in `public/cities.json`:
 * [geonameid, name, asciiName ('' if same as name), country code, region index, lat, lng, population in thousands].
 */
export type CityRow = [
  id: number,
  name: string,
  ascii: string,
  cc: string,
  region: number,
  lat: number,
  lng: number,
  popK: number,
];

export type CitiesFile = {
  v: 1;
  source: string;
  /** Every city with at least this many inhabitants is included. */
  minPopulation: number;
  /** ISO 3166-1 alpha-2 -> English name. */
  countries: Record<string, string>;
  /** Admin-1 names (states, provinces); index 0 is "" (none). */
  regions: string[];
  /** Sorted by population, descending. */
  cities: CityRow[];
};

/** A city as the app uses it. */
export type City = {
  /** GeoNames id: stable, and the only thing a shared link carries. */
  id: number;
  name: string;
  ascii: string;
  cc: string;
  country: string;
  region: string;
  lat: number;
  lng: number;
  /** Inhabitants, rounded to thousands. */
  pop: number;
};
