// Timeline state (DESIGN §5.4): Play and the tour.
//
// - `scope`: every filter except `dates` (the timeline histogram), and the span the timeline
//   covers (its start follows those filters).
// - `tour`: the visible editions (every filter, the dates window included) as a path, stop by
//   stop. Any change of the filters or of what is visible ends it. "View history" sets the
//   `series` filter and a dates window over the series' editions, then starts a tour.
// - `play`: Play. Outside a tour it slides the `dates` window forward (through
//   `getDates()` / `setDates()`, the filter's single source of truth); in a tour it travels the
//   path stop by stop (`play.travel`).
import { untrack } from 'svelte';
import { prefersReducedMotion } from 'svelte/motion';
import { track } from '../analytics';
import type { JoinedLocation } from '../data/load';
import { isSeries, seriesTitle, seriesWindow } from '../filters/series';
import { composePredicate, type FilterStates } from '../filters/store.svelte';
import { historyStops, LEG_MS, onlineYears, travelDisplay, type Stop } from '../timeline/history';
import { easeInOut } from '../timeline/motion';
import { dataSpan } from '../timeline/scale';
import {
  advanceMonths,
  canPlay,
  clampAtEnd,
  nextSpeed,
  playOrigin,
  playWindow,
  sameWindow,
  type Speed,
} from '../timeline/window';
import { app } from './app.svelte';
import type { DateWindow } from './derive';
import { filterState, getDates, setDates } from './filters.svelte';

class Scope {
  /** AND of every filter except `dates`. */
  readonly othersPredicate = $derived.by(() =>
    composePredicate(
      filterState.filters.filter((f) => f.id !== 'dates'),
      filterState.states,
      filterState.ctx,
    ),
  );
  /** Locations passing every filter except `dates` (what the window may reveal). */
  readonly candidates: JoinedLocation[] = $derived(
    app.data.locations.filter((l) => this.othersPredicate(l)),
  );
  readonly #all: DateWindow = dataSpan(app.data.locations) ?? { from: app.today, to: app.today };
  /**
   * First candidate's start (all data when none passes) → last event end of all data: the start
   * follows the filters, the end does not.
   */
  readonly span: DateWindow = $derived({
    from: dataSpan(this.candidates)?.from ?? this.#all.from,
    to: this.#all.to,
  });
}

export const scope = new Scope();

/** A tour visits at most this many conferences (list rows). */
export const TOUR_MAX = 200;

export class TourState {
  /** What is visible, as a string: the minute clock tick re-derives the list, not this. */
  readonly #visibleKey: string = $derived(app.visibleLocations.map((l) => l.id).join('|'));
  /** The filters and what was visible when the tour started (raw: compared by identity). */
  #key: { states: FilterStates; visible: string } | null = $state.raw(null);
  /** Counts tour starts (the map refits on each). */
  session = $state(0);
  /** Selection to restore on exit. */
  #returnTo: string | null = null;

  /**
   * On while the filters and what is visible are as they were at the start: any change ends the
   * tour for good (see the constructor).
   */
  readonly active: boolean = $derived(
    this.#key !== null &&
      this.#key.states === filterState.states &&
      this.#key.visible === this.#visibleKey,
  );
  /** The stops a tour would visit now (none above `TOUR_MAX` conferences). */
  readonly #next: Stop[] = $derived(
    app.listItems.length <= TOUR_MAX ? historyStops(app.visibleLocations) : [],
  );
  /** Visible editions' main venues as chronological stops (the path). */
  readonly stops: Stop[] = $derived(this.active ? this.#next : []);
  /** The series of every visible main venue when there is only one, else `null`. */
  readonly series: string | null = $derived.by(() => {
    if (!this.active) return null;
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, rebuilt on each derive
    const all = new Set(
      app.visibleLocations.filter((l) => l.role === 'main').map((l) => l.conference.series),
    );
    return all.size === 1 ? [...all][0] : null;
  });
  /** The stops mix series: they are labelled by edition name ("NeurIPS 2011"), not by year. */
  readonly named: boolean = $derived(this.active && this.series === null);
  /** Distinct edition years visible (one series only). */
  readonly years: number[] = $derived.by(() => {
    if (!this.series) return [];
    const ys = app.visibleLocations.map((l) => l.conference.year).sort((a, b) => a - b);
    return ys.filter((y, i) => y !== ys[i - 1]);
  });
  /** Years of the visible virtual editions, which have no stop on the path (one series only). */
  readonly onlineYears: number[] = $derived(this.series ? onlineYears(app.visibleLocations) : []);
  /** Display name of the series (e.g. "NeurIPS"). */
  readonly title: string = $derived(
    this.series ? seriesTitle(app.data.conferences, this.series) : '',
  );

  constructor() {
    // The first time the tour is not `active`, it ends: a change that is later undone (a home
    // moved and moved back, same filter state) does not bring it back, and a pending autoplay is
    // cancelled. An effect, because `active` is derived and cannot clear its own key.
    $effect.root(() => {
      $effect(() => {
        if (this.#key && !this.active) untrack(() => this.#end());
      });
    });
  }

  /** Whether the Tour button can start one: ≤ `TOUR_MAX` conferences and ≥ 2 stops. */
  get canStart(): boolean {
    return !this.active && app.listItems.length <= TOUR_MAX && this.#next.length >= 2;
  }

  /**
   * Start a tour of what is visible. From the UI, the open conference closes (its pins would dim
   * the others) and is restored on exit, and Play starts once the entry has settled. From a URL,
   * selection is left as the link says, and nothing plays.
   */
  enter(opts: { fromURL?: boolean } = {}): void {
    if (app.listItems.length > TOUR_MAX) return;
    play.pause();
    play.travel = null;
    if (!opts.fromURL) {
      this.#returnTo = app.selectedConferenceId;
      app.select(null);
    }
    this.#key = { states: filterState.states, visible: this.#visibleKey };
    this.session++;
    if (!opts.fromURL) play.playSoon();
  }

  /** "View history": every edition of `series` (the filter, its whole dates window), toured. */
  viewHistory(series: string): void {
    if (!isSeries(app.data.conferences, series)) return;
    track('history_mode_opened');
    filterState.hydrate({ series, dates: seriesWindow(app.data.locations, series) });
    this.enter();
  }

  exit(): void {
    if (!this.#key) return;
    this.#end();
    const back = this.#returnTo;
    this.#returnTo = null;
    if (back) app.select(back);
  }

  #end(): void {
    play.pause();
    play.travel = null;
    this.#key = null;
  }
}

export const tour = new TourState();

export type PlayOptions = { reducedMotion?: () => boolean };

/**
 * Wait before a tour plays on its own: the entry intro (path drawn in over 300 + 700 ms, camera
 * fit in 900 ms; Map.svelte) settles first.
 */
export const AUTOPLAY_MS = 1000;

/** A click on a tour stop glides the path there in this many ms (eased like the travel). */
export const GLIDE_MS = 400;

export class PlayState {
  playing = $state(false);
  speed: Speed = $state(1);
  /**
   * Tour travel: raw (linear) progress along `tour.stops` while travelling or paused mid-way,
   * else `null` (the whole path shown). See `travelDisplay` for what is drawn.
   */
  travel: number | null = $state(null);

  readonly #reduced: () => boolean;
  #raf = 0;
  #last: number | undefined;
  #origin: DateWindow = { from: '', to: '' };
  #months = 0;
  #lastSet: DateWindow | null = null;
  #reported = false;
  #soon: ReturnType<typeof setTimeout> | undefined;
  /** This Play travels a tour (it stops when the tour ends). */
  #touring = false;
  /** `goTo`'s glide, in displayed progress (so the dwell does not stall it); `t0` = first frame. */
  #glide: { from: number; to: number; t0?: number } | null = null;
  #glideRaf = 0;
  /** Displayed progress while gliding, which `travelShown` returns; else `null`. */
  #glideAt: number | null = $state(null);

  constructor(opts: PlayOptions = {}) {
    this.#reduced = opts.reducedMotion ?? (() => prefersReducedMotion.current);
  }

  get reduced(): boolean {
    return this.#reduced();
  }

  /** Whether Play can do anything: a window narrower than the data, or ≥ 2 tour stops. */
  get canPlay(): boolean {
    return tour.active ? tour.stops.length > 1 : canPlay(getDates(), scope.span);
  }

  /** Displayed tour progress (eased, or stepped under reduced motion); `null` = complete. */
  get travelShown(): number | null {
    if (this.#glideAt !== null) return this.#glideAt;
    return this.travel === null ? null : travelDisplay(this.travel, this.#reduced());
  }

  /**
   * The stop reached (index into `tour.stops`): the last one when the path is complete.
   */
  get stopIndex(): number {
    const last = tour.stops.length - 1;
    return this.travel === null
      ? last
      : Math.max(0, Math.min(last, Math.floor(this.travel + 1e-6)));
  }

  /**
   * Go to tour stop `i`, pausing Play there (Play then continues from it): the first stop
   * restarts the path, the last shows it complete. Glides over `GLIDE_MS`; jumps under reduced
   * motion.
   */
  goTo(i: number): void {
    const last = tour.stops.length - 1;
    const from = this.travelShown ?? last;
    this.pause();
    this.travel = i >= last ? null : i;
    if (this.#reduced() || from === i || typeof requestAnimationFrame === 'undefined') return;
    this.#glide = { from, to: i };
    this.#glideAt = from;
    this.#glideRaf = requestAnimationFrame(this.#glideFrame);
  }

  #glideFrame = (t: number): void => {
    const g = this.#glide;
    if (!g) return;
    g.t0 ??= t;
    const u = (t - g.t0) / GLIDE_MS;
    if (u >= 1) return this.#endGlide();
    this.#glideAt = g.from + (g.to - g.from) * easeInOut(u);
    this.#glideRaf = requestAnimationFrame(this.#glideFrame);
  };

  /** Stop a glide where it is headed (`travel` already holds its target). */
  #endGlide(): void {
    if (this.#glideRaf) cancelAnimationFrame(this.#glideRaf);
    this.#glideRaf = 0;
    this.#glide = null;
    this.#glideAt = null;
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  /**
   * Play the tour after `AUTOPLAY_MS`, unless Play or Pause (any pause: exit, scrub, …) comes
   * first, or the tour has ended.
   */
  playSoon(): void {
    clearTimeout(this.#soon);
    this.#soon = setTimeout(() => {
      if (tour.active) this.play();
    }, AUTOPLAY_MS);
  }

  play(): void {
    clearTimeout(this.#soon);
    this.#endGlide();
    if (this.playing || !this.canPlay) return;
    if (!this.#reported) {
      this.#reported = true;
      track('play_pressed');
    }
    this.#touring = tour.active;
    if (this.#touring) {
      if (this.travel === null) this.travel = 0;
    } else {
      // Resume from the current window; from the data start if it is already at the end.
      this.#origin = playOrigin(getDates(), scope.span);
      this.#months = 0;
      this.#apply(this.#origin);
    }
    this.playing = true;
    this.#last = undefined;
    this.#schedule();
  }

  pause(): void {
    clearTimeout(this.#soon);
    this.#endGlide();
    this.playing = false;
    this.#lastSet = null;
    if (this.#raf) cancelAnimationFrame(this.#raf);
    this.#raf = 0;
  }

  cycleSpeed(): void {
    this.speed = nextSpeed(this.speed);
  }

  /** Advance by `dtMs` of wall time (called per animation frame; public for tests). */
  step(dtMs: number): void {
    if (!this.playing) return;
    if (this.#touring) {
      if (!tour.active) {
        this.travel = null;
        return this.pause();
      }
      const end = tour.stops.length - 1;
      const next = (this.travel ?? 0) + (dtMs / LEG_MS) * this.speed;
      if (next >= end) {
        this.travel = null;
        this.pause();
      } else {
        this.travel = next;
      }
      return;
    }
    // Any outside change of the window (drag, preset, filter panel) pauses.
    if (this.#lastSet && !sameWindow(getDates(), this.#lastSet)) return this.pause();
    this.#months = advanceMonths(this.#months, dtMs, this.speed);
    const { w, ended } = clampAtEnd(
      playWindow(this.#origin, this.#months, this.#reduced()),
      scope.span.to,
    );
    this.#apply(w);
    if (ended) this.pause();
  }

  #apply(w: DateWindow): void {
    if (!sameWindow(w, getDates())) setDates(w);
    this.#lastSet = w;
  }

  #schedule(): void {
    if (this.#raf || typeof requestAnimationFrame === 'undefined') return;
    this.#raf = requestAnimationFrame(this.#frame);
  }

  #frame = (t: number): void => {
    this.#raf = 0;
    if (!this.playing) return;
    // Capped so a backgrounded tab resumes where it was instead of jumping.
    const dt = this.#last === undefined ? 0 : Math.min(100, t - this.#last);
    this.#last = t;
    this.step(dt);
    if (this.playing) this.#schedule();
  };
}

export const play = new PlayState();
