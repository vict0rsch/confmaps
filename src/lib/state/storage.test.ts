import { afterEach, describe, expect, it, vi } from 'vitest';
import { readHome } from '../home/store.svelte';
import { readTheme } from './theme';
import { readTravel, DEFAULT_TRAVEL, TravelSettings } from './travel.svelte';
import { AppState } from './app.svelte';
import { safeStorage } from './storage';

afterEach(() => vi.restoreAllMocks());

describe('safeStorage', () => {
  it('returns undefined when the localStorage getter throws, and everything still works', () => {
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(safeStorage()).toBeUndefined();
    expect(readTheme()).toBe('system');
    expect(readTravel()).toEqual(DEFAULT_TRAVEL);
    expect(readHome()).toBeUndefined();
    expect(new TravelSettings().values).toEqual(DEFAULT_TRAVEL);
    expect(() => new AppState()).not.toThrow();
  });

  it('returns the storage when available', () => {
    expect(safeStorage()).toBe(globalThis.localStorage);
  });
});
