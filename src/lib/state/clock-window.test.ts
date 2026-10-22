import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from './app.svelte';
import { defaultDates, filterState, getDates } from './filters.svelte';

describe('the dates window across midnight', () => {
  afterEach(() => {
    vi.useRealTimers();
    filterState.resetAll();
  });

  it('the default window follows a new day; a chosen window does not', () => {
    const d0 = app.today;
    const next = new Date(app.now);
    next.setDate(next.getDate() + 1);
    expect(getDates()).toEqual(defaultDates());
    app.refreshClock(next);
    expect(app.today).not.toBe(d0);
    expect(getDates().from).toBe(app.today);
    expect(filterState.isActive('dates')).toBe(false);

    filterState.hydrate({ dates: { from: '2026-11-01', to: '2027-03-31' } });
    const after = new Date(next);
    after.setDate(after.getDate() + 1);
    app.refreshClock(after);
    expect(getDates()).toEqual({ from: '2026-11-01', to: '2027-03-31' });
    expect(filterState.isActive('dates')).toBe(true);
  });
});
