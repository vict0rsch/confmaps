import { safeStorage } from './storage';

export type Theme = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

/** localStorage key; also read by the pre-paint script in index.html (keep in sync). */
export const THEME_STORAGE_KEY = 'confmaps:theme';

const isTheme = (v: unknown): v is Theme => v === 'system' || v === 'light' || v === 'dark';

/** Stored theme, or `system`. Storage may be unavailable (private mode, blocked): never throws. */
export function readTheme(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Theme {
  try {
    const v = storage?.getItem(THEME_STORAGE_KEY);
    return isTheme(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

export function writeTheme(
  theme: Theme,
  storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = safeStorage(),
): void {
  try {
    if (theme === 'system') storage?.removeItem(THEME_STORAGE_KEY);
    else storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The app works without persistence.
  }
}

export function resolveTheme(theme: Theme, systemPrefersDark: boolean): ResolvedTheme {
  if (theme === 'system') return systemPrefersDark ? 'dark' : 'light';
  return theme;
}
