// Timeline state (DESIGN §5.4): Play and history mode, layered over the filters.
//
// - `scope`: every filter except `dates` (the timeline histogram, history mode), and the data span.
// - `historyMode`: history mode for one conference series (`?h=<series>`). While on, the app's
//   visibility hook shows that series' editions (all years) passing the other filters; the dates
//   window is ignored but untouched, so exiting restores the previous view.
// - `play`: Play. Outside history mode it slides the `dates` window forward (through
//   `getDates()` / `setDates()`, the filter's single source of truth); in history mode it travels
//   the series' path stop by stop (`play.travel`).
import { prefersReducedMotion } from 'svelte/motion';
import { track } from '../analytics';
import type { JoinedLocation } from '../data/load';
import { composePredicate } from '../filters/store.svelte';
import { historyStops, LEG_MS, onlineYears, travelDisplay, type Stop } from '../timeline/history';
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
  /** All data, first event start → last event end. */
  readonly span: DateWindow = dataSpan(app.data.locations) ?? { from: app.today, to: app.today };
}

export const scope = new Scope();

export class HistoryState {
  /** The series in history mode, or `null`. */
  series: string | null = $state(null);
  /** Selection to restore on exit. */
  #returnTo: string | null = null;

  /** Visible editions' main venues as chronological stops (the path). */
  readonly stops: Stop[] = $derived(this.series ? historyStops(app.visibleLocations) : []);
  /** Distinct edition years visible. */
  readonly years: number[] = $derived.by(() => {
    if (!this.series) return [];
    const ys = app.visibleLocations.map((l) => l.conference.year).sort((a, b) => a - b);
    return ys.filter((y, i) => y !== ys[i - 1]);
  });
  /** Years of the visible virtual editions, which have no stop on the path. */
  readonly onlineYears: number[] = $derived(this.series ? onlineYears(app.visibleLocations) : []);
  /** Display name, from the latest edition (e.g. "NeurIPS"). */
  readonly title: string = $derived.by(() => {
    const s = this.series;
    if (!s) return '';
    const latest = app.data.conferences
      .filter((c) => c.series === s)
      .sort((a, b) => b.year - a.year)[0];
    return latest?.title ?? s;
  });

  isSeries(series: string): boolean {
    return app.data.conferences.some((c) => c.series === series);
  }

  /**
   * Enter history mode. From the UI, the open conference closes (its pins would dim the
   * others) and is restored on exit. From a URL, selection is left as the link says.
   */
  enter(series: string, opts: { fromURL?: boolean } = {}): void {
    if (!this.isSeries(series)) return;
    play.pause();
    play.travel = null;
    if (!opts.fromURL) {
      if (this.series !== series) track('history_mode_opened');
      if (app.selectedConferenceId) this.#returnTo = app.selectedConferenceId;
      app.select(null);
    }
    this.series = series;
  }

  exit(): void {
    if (!this.series) return;
    play.pause();
    play.travel = null;
    this.series = null;
    const back = this.#returnTo;
    this.#returnTo = null;
    if (back) app.select(back);
  }
}

export const historyMode = new HistoryState();

// The visibility hook, layered: in history mode, the series' editions passing every filter but
// `dates`; otherwise the filters as they are. Filter state is never mutated.
app.predicate = (loc) =>
  historyMode.series
    ? loc.conference.series === historyMode.series && scope.othersPredicate(loc)
    : filterState.predicate(loc);

export type PlayOptions = { reducedMotion?: () => boolean };

export class PlayState {
  playing = $state(false);
  speed: Speed = $state(1);
  /**
   * History travel: raw (linear) progress along `historyMode.stops` while travelling or paused
   * mid-way, else `null` (the whole path shown). See `travelDisplay` for what is drawn.
   */
  travel: number | null = $state(null);

  readonly #reduced: () => boolean;
  #raf = 0;
  #last: number | undefined;
  #origin: DateWindow = { from: '', to: '' };
  #months = 0;
  #lastSet: DateWindow | null = null;
  #reported = false;

  constructor(opts: PlayOptions = {}) {
    this.#reduced = opts.reducedMotion ?? (() => prefersReducedMotion.current);
  }

  get reduced(): boolean {
    return this.#reduced();
  }

  /** Whether Play can do anything: a window narrower than the data, or ≥ 2 history stops. */
  get canPlay(): boolean {
    return historyMode.series ? historyMode.stops.length > 1 : canPlay(getDates(), scope.span);
  }

  /** Displayed history progress (eased, or stepped under reduced motion); `null` = complete. */
  get travelShown(): number | null {
    return this.travel === null ? null : travelDisplay(this.travel, this.#reduced());
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  play(): void {
    if (this.playing || !this.canPlay) return;
    if (!this.#reported) {
      this.#reported = true;
      track('play_pressed');
    }
    if (historyMode.series) {
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
    if (historyMode.series) {
      const end = historyMode.stops.length - 1;
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
