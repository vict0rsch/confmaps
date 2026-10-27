// Home location (DESIGN §6.5).
//
// Privacy rules enforced here:
// - Only a city is ever stored (GeoNames id, name, country, the city's own lat/lng), never the
//   user's coordinates: geolocation results are snapped to the nearest city and dropped.
// - Persisted in localStorage (`confmaps:home`) only; every storage call is guarded.
// - A city from a shared link (`home=<id>`) is used for this visit only and never persisted.
//
// API: `home.city` (reactive, the city in use), `home.saved`, `home.shared`, `home.set(city)`,
// `home.clear()`, `home.locate()`, `home.applyShared(id)`, `home.useMine()`, `home.load()`.
// The store keeps `app.home` (what the filters and distances read) in sync.
import { safeStorage } from '../state/storage';
import type { LatLng } from '../geo/distance';
import { app } from '../state/app.svelte';
import { loadCities, nearestCity, type IndexedCity } from './cities';
import type { City } from './types';

export const HOME_STORAGE_KEY = 'confmaps:home';

/** What is persisted: the city only. */
export type StoredCity = Pick<City, 'id' | 'name' | 'region' | 'cc' | 'country' | 'lat' | 'lng'>;

const str = (v: unknown, max = 120): v is string => typeof v === 'string' && v.length <= max;

/** A valid StoredCity from untrusted JSON, else undefined. */
export function validStoredCity(v: unknown): StoredCity | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const { id, name, region, cc, country, lat, lng } = o;
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return undefined;
  if (!str(name) || !name || !str(country) || !str(cc, 2) || !str(region)) return undefined;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || Math.abs(lat) > 90) return undefined;
  if (typeof lng !== 'number' || !Number.isFinite(lng) || Math.abs(lng) > 180) return undefined;
  return { id, name, region, cc, country, lat, lng };
}

export function readHome(
  storage: Pick<Storage, 'getItem'> | undefined = safeStorage(),
): StoredCity | undefined {
  try {
    const raw = storage?.getItem(HOME_STORAGE_KEY);
    return raw ? validStoredCity(JSON.parse(raw)) : undefined;
  } catch {
    return undefined;
  }
}

export function writeHome(
  city: StoredCity | undefined,
  storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = safeStorage(),
): void {
  try {
    if (city) storage?.setItem(HOME_STORAGE_KEY, JSON.stringify(city));
    else storage?.removeItem(HOME_STORAGE_KEY);
  } catch {
    // The app works without persistence.
  }
}

export type LocateError = 'unsupported' | 'denied' | 'unavailable';

/** The user's position, held only long enough to snap it to a city. */
function currentPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    const geo = globalThis.navigator?.geolocation;
    if (!geo) return reject('unsupported' satisfies LocateError);
    geo.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject((e.code === 1 ? 'denied' : 'unavailable') satisfies LocateError),
      { timeout: 10_000, maximumAge: 600_000 },
    );
  });
}

export type HomeTarget = { home: LatLng | undefined };

export class HomeStore {
  readonly #storage: Storage | undefined;
  readonly #target: HomeTarget;

  /** The saved home (localStorage). */
  saved: StoredCity | undefined = $state(undefined);
  /** A city from a shared link, used for this visit only. */
  shared: StoredCity | undefined = $state(undefined);
  /** City list, once loaded (first focus of the search or geolocation). */
  cities: IndexedCity[] | undefined = $state.raw(undefined);
  loading = $state(false);
  loadFailed = $state(false);

  /** The city in use: the shared one if any, else the saved one. */
  readonly city: StoredCity | undefined = $derived(this.shared ?? this.saved);

  constructor(storage: Storage | undefined = safeStorage(), target: HomeTarget = app) {
    this.#storage = storage;
    this.#target = target;
    this.saved = readHome(storage);
    this.#sync();
  }

  #sync(): void {
    const c = this.shared ?? this.saved;
    this.#target.home = c ? { lat: c.lat, lng: c.lng } : undefined;
  }

  /** Make `city` the home: use it now and save it. Ends a shared-link view. */
  set(city: StoredCity): void {
    const stored = validStoredCity(city); // also drops fields beyond the stored city
    if (!stored) return;
    this.saved = stored;
    this.shared = undefined;
    writeHome(stored, this.#storage);
    this.#sync();
  }

  /** Forget the home (saved and shared). */
  clear(): void {
    this.saved = undefined;
    this.shared = undefined;
    writeHome(undefined, this.#storage);
    this.#sync();
  }

  /** Fetch the city list once. Resolves to undefined when it cannot be loaded. */
  async load(): Promise<IndexedCity[] | undefined> {
    if (this.cities) return this.cities;
    this.loading = true;
    this.loadFailed = false;
    try {
      this.cities = await loadCities();
      return this.cities;
    } catch {
      this.loadFailed = true;
      return undefined;
    } finally {
      this.loading = false;
    }
  }

  /**
   * Browser geolocation, snapped to the nearest city on-device. The coordinates never leave this
   * function: only the city is stored. Resolves to an error code, or undefined on success.
   */
  async locate(): Promise<LocateError | 'no-cities' | undefined> {
    let position: LatLng;
    try {
      position = await currentPosition();
    } catch (e) {
      return e === 'denied' || e === 'unsupported' ? e : 'unavailable';
    }
    const cities = await this.load();
    if (!cities) return 'no-cities';
    const city = nearestCity(cities, position);
    if (!city) return 'no-cities';
    this.set(city);
    return undefined;
  }

  /** `home=<id>` from a shared link: use that city for this visit, without saving it. A link with
   *  the viewer's own saved city is not a shared home. */
  async applyShared(id: number): Promise<boolean> {
    if (id === this.saved?.id) return false;
    const cities = await this.load();
    const city = validStoredCity(cities?.find((c) => c.id === id));
    if (!city) return false;
    this.shared = city;
    this.#sync();
    return true;
  }

  /** Leave the shared-link view: back to the saved home (or none). */
  useMine(): void {
    this.shared = undefined;
    this.#sync();
  }
}

export const home = new HomeStore();
