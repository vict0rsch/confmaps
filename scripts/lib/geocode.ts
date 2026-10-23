// City-level geocoding (DESIGN.md §3.3): override lat/lng > data/geocache.json > Nominatim.
import { isVirtual, type Geocache, type GeocacheEntry } from '../schema';
import { countryCode } from './countries';
import type { PendingLocation } from './normalize';

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
export const USER_AGENT = 'confmaps.org data build (+https://confmaps.org)';

const norm = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Cache key: normalized `"city|country"` (lowercase, no diacritics, single spaces). */
export const geocacheKey = (city: string, country: string) => `${norm(city)}|${norm(country)}`;

/** A geocoding result; `warning` flags a doubtful hit (reported, not cached). */
export type GeocodeHit = GeocacheEntry & { warning?: string };

/** Look up one city. `code` is the expected ISO 3166-1 alpha-2 country code (lowercase). */
export type Geocoder = (
  city: string,
  country: string,
  code: string,
) => Promise<GeocodeHit | undefined>;

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  addresstype?: string;
  type?: string;
  place_rank?: number;
  address?: { country_code?: string };
}

/** Result kinds that are a city/town centroid (not a county, state or airport). */
const SETTLEMENT = new Set(['city', 'town', 'village', 'hamlet', 'municipality']);
/** A settlement hit this far from Nominatim's top hit is suspicious (another place, same name). */
const DIVERGENCE_KM = 50;

/** Great-circle distance in km. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
const isSettlement = (r: NominatimResult) =>
  SETTLEMENT.has(r.addresstype ?? '') || SETTLEMENT.has(r.type ?? '');

/**
 * Pick the best of Nominatim's results (already in its relevance order): the first one in the
 * expected country that is a settlement, else the first one in the country. Warns when only
 * non-settlement hits exist, or when the settlement is far from the top hit.
 */
export function pickHit(results: NominatimResult[], code: string): GeocodeHit | undefined {
  const inCountry = results.filter((r) => r.address?.country_code === code);
  const best = inCountry.find(isSettlement) ?? inCountry[0];
  if (!best) return undefined;
  const hit: GeocodeHit = {
    lat: Number(best.lat),
    lng: Number(best.lon),
    display_name: best.display_name,
  };
  const check = 'Check it, or set lat/lng in data/overrides.yml';
  if (!isSettlement(best)) {
    const kinds = inCountry.map((r) => `${r.addresstype ?? r.type}/${r.place_rank}`).join(', ');
    hit.warning = `no settlement among the hits (${kinds}); using "${best.display_name}". ${check}`;
  } else {
    const top = { lat: Number(inCountry[0].lat), lng: Number(inCountry[0].lon) };
    const km = Math.round(haversineKm(top, hit));
    if (km > DIVERGENCE_KM)
      hit.warning =
        `using settlement "${best.display_name}", ${km} km from the top hit ` +
        `"${inCountry[0].display_name}". ${check}`;
  }
  return hit;
}

export interface NominatimOptions {
  fetchImpl?: typeof fetch;
  /** Minimum gap between requests, retries included (policy: ≤ 1 req/s). */
  minIntervalMs?: number;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Attempts per lookup on HTTP 429/5xx or a network error/timeout. */
  maxAttempts?: number;
  /** Cap on a server-requested `Retry-After`. */
  maxRetryAfterMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** `Retry-After` (seconds or HTTP date) in ms, or `undefined`. */
export function retryAfterMs(header: string | null, now: number): number | undefined {
  if (!header) return undefined;
  if (/^\d+$/.test(header.trim())) return Number(header.trim()) * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** Nominatim client: sequential, rate-limited, with timeout and backoff on 429/5xx. */
export function nominatimGeocoder(opts: NominatimOptions = {}): Geocoder {
  const {
    fetchImpl = fetch,
    minIntervalMs = 1100,
    timeoutMs = 20_000,
    maxAttempts = 4,
    maxRetryAfterMs = 120_000,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = Date.now,
  } = opts;
  let last = -Infinity;
  const request = async (url: string) => {
    const wait = last + minIntervalMs - now();
    if (wait > 0) await sleep(wait);
    last = now();
    return fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
  };
  return async (city, country, code) => {
    const params = new URLSearchParams({
      q: `${city}, ${country}`,
      countrycodes: code,
      format: 'jsonv2',
      limit: '5',
      addressdetails: '1',
      'accept-language': 'en',
    });
    const url = `${NOMINATIM_URL}?${params}`;
    const what = `Nominatim lookup of "${city}, ${country}"`;
    for (let attempt = 1; ; attempt++) {
      let res: Response | undefined;
      let failure: string;
      try {
        res = await request(url);
        if (res.ok) return pickHit((await res.json()) as NominatimResult[], code);
        failure = `HTTP ${res.status}`;
        if (res.status !== 429 && res.status < 500) throw new Error(`${what}: ${failure}`);
      } catch (e) {
        if (res) throw e; // a non-retryable HTTP status, or an unreadable body
        failure = (e as Error).message;
      }
      if (attempt >= maxAttempts) throw new Error(`${what} failed ${attempt}×: ${failure}`);
      const backoff = 2000 * 2 ** (attempt - 1);
      const asked = res ? retryAfterMs(res.headers.get('retry-after'), now()) : undefined;
      await sleep(Math.min(asked ?? backoff, maxRetryAfterMs));
    }
  };
}

/**
 * Fill `lat`/`lng` on every location in place, adding new cache entries to `geocache`. Locations
 * that already carry coordinates (from an override) and virtual ones are left alone. Without a `geocoder`
 * (offline), a cache miss is an error. Returns errors for unresolved locations and warnings for
 * doubtful new hits.
 */
export async function resolveCoordinates(
  locations: PendingLocation[],
  geocache: Geocache,
  geocoder: Geocoder | undefined,
  log: (msg: string) => void = () => {},
): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const loc of [...locations].sort((a, b) => a.id.localeCompare(b.id))) {
    if (isVirtual(loc) || (loc.lat !== undefined && loc.lng !== undefined)) continue;
    const key = geocacheKey(loc.city, loc.country);
    let hit: GeocacheEntry | undefined = geocache[key];
    if (!hit && geocoder) {
      const code = countryCode(loc.country);
      if (!code) {
        errors.push(`${loc.id}: no country code for "${loc.country}"`);
        continue;
      }
      const found = await geocoder(loc.city, loc.country, code);
      if (found) {
        const { warning, ...entry } = found;
        hit = geocache[key] = entry;
        log(`geocoded ${key} → ${hit.lat}, ${hit.lng} (${hit.display_name})`);
        if (warning) warnings.push(`${loc.id}: geocoding "${key}": ${warning}`);
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
  return { errors, warnings };
}
