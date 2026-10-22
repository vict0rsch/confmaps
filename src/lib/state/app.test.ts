import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { AppState } from './app.svelte';

describe('AppState', () => {
  // Real data, fixed clock: 2026-10-22 local.
  const now = new Date(2026, 9, 22, 12);

  it('defaults to the Plan window and lists conferences with visible sites', () => {
    const app = new AppState({ now });
    expect(app.today).toBe('2026-10-22');
    expect(app.visibleLocations.length).toBeGreaterThan(0);
    for (const l of app.visibleLocations) {
      expect(l.end >= '2026-10-22' && l.start <= '2027-10-22').toBe(true);
    }
    // Every visible conference is listed, an event's tracks folded into one row.
    const ids = new Set(app.visibleLocations.map((l) => l.conferenceId));
    const listed = app.listItems.flatMap((i) => [i.conference.id, ...i.tracks.map((t) => t.id)]);
    expect(listed.sort()).toEqual([...ids].sort());
    const emnlp = app.listItems.find((i) => i.conference.id === 'emnlp26')!;
    expect(emnlp.tracks.map((t) => t.id)).toEqual(['emnlp26ind', 'emnlp26sys']);
    // The map draws one pin for the event, not one per track.
    expect(app.mapLocations.some((l) => l.conferenceId === 'emnlp26ind')).toBe(false);
  });

  it('re-derives through the replaceable predicate hook', () => {
    const app = new AppState({ now });
    app.predicate = (l) => l.role === 'satellite';
    flushSync();
    expect(app.visibleLocations.every((l) => l.role === 'satellite')).toBe(true);
    app.predicate = () => false;
    expect(app.listItems).toEqual([]);
    app.resetPredicate();
    expect(app.visibleLocations.length).toBeGreaterThan(0);
  });

  it('selection exposes the conference and its visible sites', () => {
    const app = new AppState({ now });
    const first = app.listItems[0];
    app.select(first.conference.id);
    expect(app.selectedConference?.id).toBe(first.conference.id);
    expect(app.selectedSites.map((s) => s.id)).toEqual(first.sites.map((s) => s.id));
    app.select(null);
    expect(app.selectedSites).toEqual([]);
  });
});

describe('clock', () => {
  const listeners = new Map<string, () => void>();
  beforeEach(() => {
    // Node has no `document`: a minimal stand-in for the visibility listener.
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: (t: string, f: () => void) => listeners.set(t, f),
      removeEventListener: (t: string) => listeners.delete(t),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('refreshes now every minute and rolls today at midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 22, 23, 59, 30));
    const app = new AppState({ now: new Date() });
    const stop = app.startClock();
    expect(app.today).toBe('2026-10-22');
    vi.advanceTimersByTime(60_000);
    expect(app.now.getTime()).toBe(Date.now());
    expect(app.today).toBe('2026-10-23');
    stop();
    vi.advanceTimersByTime(120_000);
    expect(app.now.getTime()).toBeLessThan(Date.now());
  });

  it('refreshes when the tab becomes visible again', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 22, 12));
    const app = new AppState({ now: new Date() });
    const stop = app.startClock();
    vi.setSystemTime(new Date(2026, 9, 22, 12, 0, 20));
    listeners.get('visibilitychange')!();
    expect(app.now.getTime()).toBe(Date.now());
    stop();
  });
});
