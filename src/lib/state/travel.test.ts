import { describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { DEFAULT_TRAVEL, readTravel, TRAVEL_STORAGE_KEY, TravelSettings } from './travel.svelte';

function memoryStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

describe('travel settings', () => {
  it('defaults to km / auto / 1000 km', () => {
    expect(new TravelSettings(memoryStorage()).values).toEqual(DEFAULT_TRAVEL);
    expect(DEFAULT_TRAVEL).toEqual({ units: 'km', mode: 'auto', threshold: 1000 });
  });

  it('persists setters and reads them back', () => {
    const storage = memoryStorage();
    const t = new TravelSettings(storage);
    t.setUnits('mi');
    t.setMode('fly');
    t.setThreshold(700.4);
    flushSync();
    expect(t.values).toEqual({ units: 'mi', mode: 'fly', threshold: 700 });
    expect(new TravelSettings(storage).values).toEqual(t.values);
  });

  it('ignores invalid values', () => {
    const t = new TravelSettings(memoryStorage());
    t.setThreshold(NaN);
    t.setThreshold(-5);
    t.setThreshold(1e9);
    // @ts-expect-error invalid on purpose
    t.setUnits('furlong');
    // @ts-expect-error invalid on purpose
    t.setMode('walk');
    expect(t.values).toEqual(DEFAULT_TRAVEL);
  });

  it('apply() changes values without persisting', () => {
    const storage = memoryStorage();
    const t = new TravelSettings(storage);
    t.apply({ units: 'mi' });
    expect(t.units).toBe('mi');
    expect(storage.getItem(TRAVEL_STORAGE_KEY)).toBeNull();
  });

  it('survives corrupt or throwing storage', () => {
    expect(readTravel(memoryStorage({ [TRAVEL_STORAGE_KEY]: '{not json' }))).toEqual(
      DEFAULT_TRAVEL,
    );
    expect(
      readTravel(memoryStorage({ [TRAVEL_STORAGE_KEY]: '{"units":"mi","threshold":"x"}' })),
    ).toEqual({ ...DEFAULT_TRAVEL, units: 'mi' });
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    const t = new TravelSettings(throwing);
    expect(() => t.setUnits('mi')).not.toThrow();
    expect(t.units).toBe('mi');
  });
});
