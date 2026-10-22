import { describe, expect, it } from 'vitest';
import { readTheme, resolveTheme, THEME_STORAGE_KEY, writeTheme } from './theme';

const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
};

const throwing = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('theme persistence', () => {
  it('round-trips and clears on system', () => {
    const s = memory();
    expect(readTheme(s)).toBe('system');
    writeTheme('dark', s);
    expect(s.m.get(THEME_STORAGE_KEY)).toBe('dark');
    expect(readTheme(s)).toBe('dark');
    writeTheme('system', s);
    expect(s.m.has(THEME_STORAGE_KEY)).toBe(false);
  });

  it('ignores junk and survives blocked or missing storage', () => {
    const s = memory();
    s.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(readTheme(s)).toBe('system');
    expect(readTheme(throwing)).toBe('system');
    expect(readTheme(undefined)).toBe('system');
    expect(() => writeTheme('light', throwing)).not.toThrow();
  });

  it('resolves system against the OS preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });
});
