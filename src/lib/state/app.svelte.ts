// App state (Svelte 5 runes). One instance, `app`, is shared by all components.
//
// Integration points for later phases:
// - Filters/timeline (DESIGN §6.3–6.4): assign `app.predicate = (loc) => …`. Everything visible
//   (map pins, lines, list, counts) derives from it through `visibleLocations`.
//   `app.resetPredicate()` restores the Plan default (today → +12 months).
// - Home location (§6.5): set `app.home = { lat, lng }`; the detail panel's distance/CO₂ slot keys
//   off it.
import { safeStorage } from './storage';
import { MediaQuery } from 'svelte/reactivity';
import { loadData, type AppData, type JoinedLocation } from '../data/load';
import type { Conference } from '../data/types';
import type { LatLng } from '../geo/distance';
import {
  foldTracks,
  groupByConference,
  planWindow,
  todayISO,
  windowPredicate,
  type ListItem,
  type LocationPredicate,
} from './derive';
import { readTheme, resolveTheme, writeTheme, type ResolvedTheme, type Theme } from './theme';

export const CLOCK_TICK_MS = 60_000;

export type AppStateOptions = {
  data?: AppData;
  /** Clock, injectable for tests. */
  now?: Date;
  storage?: Storage;
};

export class AppState {
  readonly data: AppData;
  readonly #storage: Storage | undefined;
  readonly #newDay: ((prev: string, today: string) => void)[] = [];
  readonly #systemDark = new MediaQuery('(prefers-color-scheme: dark)', false);

  /** Local calendar date, `YYYY-MM-DD`. */
  today: string = $state('');
  /** Current instant, for deadline status. Replaced, never mutated (hence not a SvelteDate). */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  now: Date = $state.raw(new Date());

  selectedConferenceId: string | null = $state(null);
  hoveredConferenceId: string | null = $state(null);
  theme: Theme = $state('system');
  /** Home location; unset until the HomeSettings phase adds the UI. */
  home: LatLng | undefined = $state(undefined);

  /**
   * THE visibility hook: the single per-location predicate behind `visibleLocations`.
   * Replace it wholesale (`app.predicate = …`); it is stored raw (not deeply reactive), so any
   * reactive state it reads inside is tracked when `visibleLocations` re-derives.
   */
  predicate: LocationPredicate = $state.raw(() => true);

  /** Locations passing `predicate`. */
  readonly visibleLocations: JoinedLocation[] = $derived.by(() =>
    this.data.locations.filter((loc) => this.predicate(loc)),
  );
  /** Conferences with ≥1 visible location, sorted by start date; an event's tracks share a row. */
  readonly listItems: ListItem[] = $derived.by(() =>
    foldTracks(groupByConference(this.visibleLocations), this.data.trackGroups),
  );
  /** What the map draws: visible locations, without those of tracks folded into another row. */
  readonly mapLocations: JoinedLocation[] = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, rebuilt on each derive
    const folded = new Set(this.listItems.flatMap((i) => i.tracks.map((t) => t.id)));
    return folded.size
      ? this.visibleLocations.filter((l) => !folded.has(l.conferenceId))
      : this.visibleLocations;
  });

  readonly selectedConference: Conference | null = $derived.by(() =>
    this.selectedConferenceId
      ? (this.data.conferenceById.get(this.selectedConferenceId) ?? null)
      : null,
  );
  /** The selected conference's visible sites (all its sites if none is visible). */
  readonly selectedSites: JoinedLocation[] = $derived.by(() => {
    const id = this.selectedConferenceId;
    if (!id) return [];
    const visible = this.visibleLocations.filter((l) => l.conferenceId === id);
    return visible.length ? visible : (this.data.locationsByConference.get(id) ?? []);
  });

  readonly resolvedTheme: ResolvedTheme = $derived(
    resolveTheme(this.theme, this.#systemDark.current),
  );

  constructor(opts: AppStateOptions = {}) {
    this.data = opts.data ?? loadData();
    this.#storage = opts.storage ?? safeStorage();
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const now = opts.now ?? new Date();
    this.now = now;
    this.today = todayISO(now);
    this.theme = readTheme(this.#storage);
    this.predicate = this.defaultPredicate();
  }

  /** Plan default: locations with `end ≥ today` and `start ≤ today + 12 months`. */
  defaultPredicate(): LocationPredicate {
    return windowPredicate(planWindow(this.today));
  }

  /** Refresh `now` (and `today` once the local date has changed). */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- default argument, not state
  refreshClock(date: Date = new Date()): void {
    this.now = date;
    const t = todayISO(date);
    if (t === this.today) return;
    const prev = this.today;
    this.today = t;
    for (const fn of this.#newDay) fn(prev, t);
  }

  /** Call `fn(previousToday, today)` when the local date changes. */
  onNewDay(fn: (prev: string, today: string) => void): void {
    this.#newDay.push(fn);
  }

  /**
   * Keep the clock current in a long-lived tab: every minute, and when the tab becomes visible
   * again (timers are throttled in the background). Returns a stop function.
   */
  startClock(): () => void {
    const tick = () => this.refreshClock();
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    const timer = setInterval(tick, CLOCK_TICK_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }

  resetPredicate(): void {
    this.predicate = this.defaultPredicate();
  }

  select(conferenceId: string | null): void {
    this.selectedConferenceId = conferenceId;
  }

  hover(conferenceId: string | null): void {
    this.hoveredConferenceId = conferenceId;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    writeTheme(theme, this.#storage);
  }
}

export const app = new AppState();
