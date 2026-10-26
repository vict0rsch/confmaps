import { describe, expect, it } from 'vitest';
import {
  HOME_STORAGE_KEY,
  HomeStore,
  readHome,
  validStoredCity,
  writeHome,
  type HomeTarget,
  type StoredCity,
} from './store.svelte';

const berlin: StoredCity = {
  id: 2950159,
  name: 'Berlin',
  region: 'Berlin',
  cc: 'DE',
  country: 'Germany',
  lat: 52.524,
  lng: 13.411,
};

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

const throwingStorage = (): Storage =>
  new Proxy({} as Storage, {
    get: () => () => {
      throw new Error('SecurityError');
    },
  });

const target = (): HomeTarget => ({ home: undefined });

describe('home persistence', () => {
  it('saves only the city and restores it', () => {
    const storage = memoryStorage();
    const t = target();
    const store = new HomeStore(storage, t);
    expect(t.home).toBeUndefined();
    store.set({ ...berlin, pop: 3426000 } as StoredCity);
    expect(t.home).toEqual({ lat: 52.524, lng: 13.411 });
    // No `pop`, nothing beyond the city.
    expect(JSON.parse(storage.getItem(HOME_STORAGE_KEY)!)).toEqual(berlin);

    expect(new HomeStore(storage, target()).city).toEqual(berlin);
  });

  it('applies the stored city to the app on construction', () => {
    const t = target();
    new HomeStore(memoryStorage({ [HOME_STORAGE_KEY]: JSON.stringify(berlin) }), t);
    expect(t.home).toEqual({ lat: 52.524, lng: 13.411 });
  });

  it('clear() forgets it', () => {
    const storage = memoryStorage();
    const t = target();
    const store = new HomeStore(storage, t);
    store.set(berlin);
    store.clear();
    expect(t.home).toBeUndefined();
    expect(storage.getItem(HOME_STORAGE_KEY)).toBeNull();
  });

  it('works when storage throws', () => {
    const t = target();
    const store = new HomeStore(throwingStorage(), t);
    expect(store.city).toBeUndefined();
    expect(() => store.set(berlin)).not.toThrow();
    expect(t.home).toEqual({ lat: 52.524, lng: 13.411 });
    expect(() => store.clear()).not.toThrow();
    expect(readHome(throwingStorage())).toBeUndefined();
    expect(() => writeHome(berlin, throwingStorage())).not.toThrow();
  });

  it('works without any storage', () => {
    const t = target();
    const store = new HomeStore(undefined, t);
    store.set(berlin);
    expect(t.home).toBeDefined();
  });

  it('ignores corrupt or hostile stored values', () => {
    const bad = [
      'not json',
      '{}',
      '[]',
      'null',
      JSON.stringify({ ...berlin, lat: 91 }),
      JSON.stringify({ ...berlin, id: -1 }),
      JSON.stringify({ ...berlin, name: 5 }),
    ];
    for (const raw of bad) {
      expect(readHome(memoryStorage({ [HOME_STORAGE_KEY]: raw }))).toBeUndefined();
    }
    expect(validStoredCity(berlin)).toEqual(berlin);
  });

  it('a shared city is used for this visit only; useMine() restores the saved one', () => {
    const storage = memoryStorage();
    const t = target();
    const store = new HomeStore(storage, t);
    store.set(berlin);
    // What applyShared() does once the city list is loaded.
    store.shared = { ...berlin, id: 2988507, name: 'Paris', lat: 48.853, lng: 2.349 };
    expect(store.city?.name).toBe('Paris');
    expect(JSON.parse(storage.getItem(HOME_STORAGE_KEY)!).name).toBe('Berlin');
    store.useMine();
    expect(store.city?.name).toBe('Berlin');
    expect(t.home).toEqual({ lat: 52.524, lng: 13.411 });
  });

  it('a link with the saved city is not a shared home', async () => {
    const store = new HomeStore(memoryStorage(), target());
    store.set(berlin);
    expect(await store.applyShared(berlin.id)).toBe(false);
    expect(store.shared).toBeUndefined();
  });
});
