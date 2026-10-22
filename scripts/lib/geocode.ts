// City-level geocoding (DESIGN.md §3.3): override lat/lng > data/geocache.json > Nominatim.
import type { Geocache, GeocacheEntry } from '../schema';
import { countryCode } from './countries';
import type { PendingLocation } from './normalize';

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
export const USER_AGENT = 'confmaps.org data build (+https://confmaps.org)';

const norm = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Cache key: normalized `"city|country"` (lowercase, no diacritics, single spaces). */
export const geocacheKey = (city: string, country: string) => `${norm(city)}|${norm(country)}`;

/** Look up one city. `code` is the expected ISO 3166-1 alpha-2 country code (lowercase). */
export type Geocoder = (
  city: string,
  country: string,
  code: string,
) => Promise<GeocacheEntry | undefined>;

/** Nominatim client: sequential, at most one request per `minIntervalMs` (policy: ≤ 1 req/s). */
export function nominatimGeocoder(fetchImpl: typeof fetch = fetch, minIntervalMs = 1100): Geocoder {
  let last = 0;
  return async (city, country, code) => {
    const wait = last + minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const params = new URLSearchParams({
      q: `${city}, ${country}`,
      countrycodes: code,
      format: 'jsonv2',
      limit: '1',
      addressdetails: '1',
      'accept-language': 'en',
    });
    const res = await fetchImpl(`${NOMINATIM_URL}?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status} for "${city}, ${country}"`);
    const [hit] = (await res.json()) as {
      lat: string;
      lon: string;
      display_name: string;
      address?: { country_code?: string };
    }[];
    if (!hit) return undefined;
    // Sanity check: the result must be in the expected country.
    if (hit.address?.country_code !== code) return undefined;
    return { lat: Number(hit.lat), lng: Number(hit.lon), display_name: hit.display_name };
  };
}

/**
 * Fill `lat`/`lng` on every location in place, adding new cache entries to `geocache`. Locations
 * that already carry coordinates (from an override) are left alone. Without a `geocoder`
 * (offline), a cache miss is an error. Returns errors for unresolved locations.
 */
export async function resolveCoordinates(
  locations: PendingLocation[],
  geocache: Geocache,
  geocoder: Geocoder | undefined,
  log: (msg: string) => void = () => {},
): Promise<string[]> {
  const errors: string[] = [];
  for (const loc of [...locations].sort((a, b) => a.id.localeCompare(b.id))) {
    if (loc.lat !== undefined && loc.lng !== undefined) continue;
    const key = geocacheKey(loc.city, loc.country);
    let hit: GeocacheEntry | undefined = geocache[key];
    if (!hit && geocoder) {
      const code = countryCode(loc.country);
      if (!code) {
        errors.push(`${loc.id}: no country code for "${loc.country}"`);
        continue;
      }
      hit = await geocoder(loc.city, loc.country, code);
      if (hit) {
        geocache[key] = hit;
        log(`geocoded ${key} → ${hit.lat}, ${hit.lng} (${hit.display_name})`);
      }
    }
    if (!hit) {
      errors.push(
        `${loc.id}: unresolved location "${loc.city}, ${loc.country}" (key "${key}"` +
          `${geocoder ? '' : ', offline'}); add lat/lng in data/overrides.yml or fix the city`,
      );
      continue;
    }
    loc.lat = hit.lat;
    loc.lng = hit.lng;
  }
  return errors;
}
