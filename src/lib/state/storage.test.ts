import { afterEach, describe, expect, it, vi } from 'vitest';
import { readHome } from '../home/store.svelte';
import { readTheme } from './theme';
import { readTravel, DEFAULT_TRAVEL, TravelSettings } from './travel.svelte';
import { AppState } from './app.svelte';
import { safeStorage } from './storage';

// Node 24 has no global localStorage (Node 25 does), so define it rather than spy on it.
const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterEach(() => {
  vi.restoreAllMocks();
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('safeStorage', () => {
  it('returns undefined when the localStorage getter throws, and everything still works', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    expect(safeStorage()).toBeUndefined();
    expect(readTheme()).toBe('system');
    expect(readTravel()).toEqual(DEFAULT_TRAVEL);
    expect(readHome()).toBeUndefined();
    expect(new TravelSettings().values).toEqual(DEFAULT_TRAVEL);
    expect(() => new AppState()).not.toThrow();
  });

  it('returns the storage when available', () => {
    const storage = {} as Storage;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    expect(safeStorage()).toBe(storage);
  });
});
