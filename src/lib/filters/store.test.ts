import { flushSync } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppState } from '../state/app.svelte';
import { ctx, LONDON, location, PARIS } from './fixtures';
import { createFilters } from './index';
import { composePredicate, FilterStore } from './store.svelte';
import type { Ctx } from './types';

const track = vi.hoisted(() => vi.fn());
vi.mock('../analytics', () => ({ track }));

const today = '2026-10-22';

describe('composePredicate', () => {
  const filters = createFilters(today);
  const defaults = Object.fromEntries(filters.map((f) => [f.id, f.defaultState]));
  const paris = location({ lat: PARIS.lat, lng: PARIS.lng, access: 'open', official: false });

  it('applies the default dates window even though it is inactive', () => {
    const p = composePredicate(filters, defaults, ctx());
    expect(p(location({ start: '2026-12-01', end: '2026-12-03' }))).toBe(true);
    expect(p(location({ start: '2025-12-01', end: '2025-12-03' }))).toBe(false);
  });

  it('ANDs the active filters', () => {
    const c = ctx({ home: LONDON });
    const states = { ...defaults, access: ['open'], kind: 'community', radius: 500 };
    expect(composePredicate(filters, states, c)(paris)).toBe(true);
    expect(composePredicate(filters, { ...states, radius: 100 }, c)(paris)).toBe(false);
    expect(composePredicate(filters, { ...states, kind: 'official' }, c)(paris)).toBe(false);
    // Needs-home filters are ignored without home.
    expect(composePredicate(filters, { ...states, radius: 100 }, ctx())(paris)).toBe(true);
  });
});

describe('FilterStore', () => {
  beforeEach(() => track.mockClear());

  function setup() {
    let home: Ctx['home'];
    const store = new FilterStore(createFilters(today), () => ctx({ home }));
    return { store, setHome: (h: Ctx['home']) => (home = h) };
  }

  it('starts at defaults with nothing active', () => {
    const { store } = setup();
    expect(store.activeCount).toBe(0);
    expect(store.get('dates')).toEqual({ from: '2026-10-22', to: '2027-10-22' });
  });

  it('counts active filters, resets one or all', () => {
    const { store } = setup();
    store.set('subject', ['CV']);
    store.set('open', true);
    store.set('dates', { from: '2026-10-22', to: '2027-10-22' }); // default: not active
    expect(store.activeIds).toEqual(['subject', 'open']);
    store.reset('subject');
    expect(store.activeIds).toEqual(['open']);
    store.set('nope', 1); // unknown ids are ignored
    store.resetAll();
    expect(store.activeCount).toBe(0);
  });

  it('tracks filter_used:<id> once per filter, on first activation only', () => {
    const { store } = setup();
    store.set('subject', []); // inactive: not a use
    expect(track).not.toHaveBeenCalled();
    store.set('subject', ['CV']);
    store.set('subject', ['CV', 'ML']);
    store.reset('subject');
    store.set('subject', ['NLP']);
    store.set('open', true);
    expect(track.mock.calls).toEqual([['filter_used:subject'], ['filter_used:open']]);
  });

  it('hydrate sets states without analytics', () => {
    const { store } = setup();
    store.hydrate({ subject: ['CV'], bogus: 1 });
    expect(store.get('subject')).toEqual(['CV']);
    expect(store.activeCount).toBe(1);
    expect(track).not.toHaveBeenCalled();
  });

  it('drives the app predicate reactively (list = conferences with ≥1 passing location)', () => {
    const app = new AppState({ now: new Date(2026, 9, 22, 12) });
    const store = new FilterStore(createFilters(app.today), () => ctx());
    app.predicate = (loc) => store.predicate(loc);
    const all = app.visibleLocations.length;
    expect(all).toBeGreaterThan(0);

    store.set('search', 'neurips');
    flushSync();
    expect(app.visibleLocations.length).toBeGreaterThan(0);
    expect(app.visibleLocations.length).toBeLessThan(all);
    expect(app.visibleLocations.every((l) => l.conference.title === 'NeurIPS')).toBe(true);
    const ids = new Set(app.visibleLocations.map((l) => l.conferenceId));
    expect(app.listItems.map((i) => i.conference.id).sort()).toEqual([...ids].sort());

    store.resetAll();
    flushSync();
    expect(app.visibleLocations.length).toBe(all);
  });

  it('re-derives when ctx inputs change', () => {
    const app = new AppState({ now: new Date(2026, 9, 22, 12) });
    const store = new FilterStore(createFilters(app.today), () => ctx({ home: app.home }));
    app.predicate = (loc) => store.predicate(loc);
    const all = app.visibleLocations.length;
    store.set('radius', 500);
    flushSync();
    expect(app.visibleLocations.length).toBe(all); // no home: no effect
    app.home = PARIS;
    flushSync();
    expect(app.visibleLocations.length).toBeLessThan(all);
  });
});
