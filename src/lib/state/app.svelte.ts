// App state (Svelte 5 runes). One instance, `app`, is shared by all components.
//
// Integration points for later phases:
// - Filters/timeline (DESIGN §6.3–6.4): assign `app.predicate = (loc) => …`. Everything visible
//   (map pins, lines, list, counts) derives from it through `visibleLocations`.
//   `app.resetPredicate()` restores the Plan default (today → +12 months).
// - Home location (§6.5): set `app.home = { lat, lng }`; the detail panel's distance/CO₂ slot keys
//   off it.
import { MediaQuery } from 'svelte/reactivity';
import { loadData, type AppData, type JoinedLocation } from '../data/load';
import type { Conference } from '../data/types';
import type { LatLng } from '../geo/distance';
import {
  groupByConference,
  planWindow,
  todayISO,
  windowPredicate,
  type ListItem,
  type LocationPredicate,
} from './derive';
import { readTheme, resolveTheme, writeTheme, type ResolvedTheme, type Theme } from './theme';

export type AppStateOptions = {
  data?: AppData;
  /** Clock, injectable for tests. */
  now?: Date;
  storage?: Storage;
};

export class AppState {
  readonly data: AppData;
  readonly #storage: Storage | undefined;
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
  /** Conferences with ≥1 visible location, sorted by start date. */
  readonly listItems: ListItem[] = $derived(groupByConference(this.visibleLocations));

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
    this.#storage = opts.storage ?? globalThis.localStorage;
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
