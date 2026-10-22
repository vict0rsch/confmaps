// City list helpers (DESIGN §6.5): load `public/cities.json`, search it, snap a point to the
// nearest city. All on-device; nothing here talks to a server except the one static fetch.
import { haversineKm, type LatLng } from '../geo/distance';
import type { CitiesFile, City } from './types';

/** Lowercase, strip diacritics, keep letters and digits only, single spaces. "Zürich-Nord" -> "zurich nord". */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/đ/g, 'd')
    .replace(/ł/g, 'l')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export type IndexedCity = City & {
  /** Normalized name, plus the normalized ASCII name when that differs (e.g. "上海", "shanghai"). */
  nameKeys: string[];
  /** Normalized region and country, for qualified queries like "paris texas". */
  placeKey: string;
};

/** Expand the compact file. Order is kept (population, descending). */
export function indexCities(file: CitiesFile): IndexedCity[] {
  return file.cities.map(([id, name, ascii, cc, ri, lat, lng, popK]) => {
    const region = file.regions[ri] ?? '';
    const country = file.countries[cc] ?? cc;
    const asciiName = ascii || name;
    const nameKey = normalize(name);
    const asciiKey = normalize(asciiName);
    const nameKeys = asciiKey && asciiKey !== nameKey ? [nameKey, asciiKey] : [nameKey];
    return {
      id,
      name,
      ascii: asciiName,
      cc,
      country,
      region,
      lat,
      lng,
      pop: popK * 1000,
      nameKeys,
      placeKey: normalize(`${region} ${country}`),
    };
  });
}

/** "Paris, Texas, United States"; the region is left out when empty or the same as the name. */
export function cityLabel(c: Pick<City, 'name' | 'region' | 'country'>): string {
  const region = c.region && c.region !== c.name ? `${c.region}, ` : '';
  return `${c.name}, ${region}${c.country}`;
}

/** "Berlin, Germany". */
export function cityShortLabel(c: Pick<City, 'name' | 'country'>): string {
  return `${c.name}, ${c.country}`;
}

/**
 * Cities matching `query`, best first. Matching ignores case and diacritics ("zurich" finds
 * "Zürich"). Tiers: exact name, name prefix, every query word a word-prefix of the name, then
 * words may also match the region or country ("paris texas"). Within a tier: population.
 */
export function searchCities<C extends IndexedCity>(
  cities: readonly C[],
  query: string,
  limit = 8,
): C[] {
  const q = normalize(query);
  if (!q) return [];
  const tokens = q.split(' ');
  const hits: [tier: number, city: C][] = [];
  for (const c of cities) {
    const tier = rank(c, q, tokens);
    if (tier >= 0) hits.push([tier, c]);
  }
  // Array.prototype.sort is stable: equal tiers keep the population order of `cities`.
  hits.sort((a, b) => a[0] - b[0]);
  return hits.slice(0, limit).map(([, c]) => c);
}

function rank(c: IndexedCity, q: string, tokens: string[]): number {
  let best = -1;
  const place = c.placeKey.split(' ');
  for (const key of c.nameKeys) {
    const words = key.split(' ');
    const t =
      key === q
        ? 0
        : key.startsWith(q)
          ? 1
          : tokens.every((t) => words.some((w) => w.startsWith(t)))
            ? 2
            : tokens.every((t) => [...words, ...place].some((w) => w.startsWith(t)))
              ? 3
              : -1;
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

/** The city closest to `p` (great-circle), or undefined for an empty list. */
export function nearestCity<C extends City>(cities: readonly C[], p: LatLng): C | undefined {
  let best: C | undefined;
  let bestKm = Infinity;
  for (const c of cities) {
    const km = haversineKm(p, c);
    if (km < bestKm) {
      bestKm = km;
      best = c;
    }
  }
  return best;
}

let loading: Promise<IndexedCity[]> | undefined;

/** Fetch and index `cities.json` once. A failed fetch is not cached, so the next call retries. */
export function loadCities(url = `${import.meta.env.BASE_URL}cities.json`): Promise<IndexedCity[]> {
  loading ??= fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`cities.json: HTTP ${res.status}`);
      return res.json() as Promise<CitiesFile>;
    })
    .then(indexCities)
    .catch((e) => {
      loading = undefined;
      throw e;
    });
  return loading;
}
