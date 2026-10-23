// Timeline choreography on the map (DESIGN §6.4): pins fade + scale in as they enter the window,
// ripple while live and fade out as they leave; main↔satellite lines draw in once both ends show.
// Pins never move.
//
// Every location sits in one unclustered GeoJSON source (`SRC.anim`), set once per style; each
// frame only writes feature-state (`o` opacity, `s` scale, `ro`/`rs` ripple) for the pins that
// changed, which paint expressions read (style.ts). Links are a tiny source re-set only while one
// of them animates. Timing is pure (../timeline/motion.ts); this class only applies it.
import type { FeatureCollection, LineString } from 'geojson';
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import type { JoinedLocation, PinnedJoined } from '../data/load';
import { stopIndexOf, type Stop } from '../timeline/history';
import {
  linkAt,
  pulseAt,
  pulseEnd,
  retarget,
  settled,
  staggerDelays,
  trackAt,
  type MotionConfig,
  type Track,
  type Visual,
} from '../timeline/motion';
import { greatCircle, pinFeatures, trimLine, type PinCollection } from './geojson';
import { SRC } from './style';

/** Every pin as an animation feature; the numeric id (its index) keys its feature-state. */
export function animFeatures(locs: readonly PinnedJoined[]): PinCollection {
  const pins = pinFeatures(locs);
  return { ...pins, features: pins.features.map((f, i) => ({ ...f, id: i })) };
}

/**
 * Which locations the animated map shows: the visible ones; while travelling a history path
 * (`travel` = displayed progress), only those of the stops reached so far.
 */
export function shownIds(
  visible: readonly JoinedLocation[],
  stops: readonly Stop[] | null,
  travel: number | null,
): Set<string> {
  if (!stops || travel === null) return new Set(visible.map((l) => l.id));
  const reached = Math.floor(travel + 1e-6);
  return new Set(
    visible.filter((l) => stopIndexOf(stops, l.conference) <= reached).map((l) => l.id),
  );
}

/**
 * Live pins (they ripple). Play: events under the playhead, `start ≤ t ≤ end` with t = the
 * window's start (`from`, which is "today" in Plan mode, so Play moves a simulated today).
 * History travel: the editions at the stop just reached.
 */
export function liveIds(
  visible: readonly JoinedLocation[],
  t: string | null,
  stops: readonly Stop[] | null,
  travel: number | null,
): Set<string> {
  if (stops && travel !== null) {
    const at = Math.floor(travel + 1e-6);
    return new Set(visible.filter((l) => stopIndexOf(stops, l.conference) === at).map((l) => l.id));
  }
  if (!t) return new Set();
  return new Set(visible.filter((l) => l.start <= t && t <= l.end).map((l) => l.id));
}

type Pin = {
  loc: PinnedJoined;
  track: Track;
  cur: Visual;
  /** Active ripple: started at `t0`, may stop at `until` (Infinity while live). */
  pulse: { t0: number; until: number } | null;
  live: boolean;
  /** Last feature-state written, to skip unchanged pins. */
  written: string;
};

type Link = {
  a: number;
  b: number;
  conferenceId: string;
  coords: [number, number][];
  track: Track;
  cur: Visual;
};

const key = (o: number, s: number, ro: number, rs: number) =>
  `${o.toFixed(3)}|${s.toFixed(3)}|${ro.toFixed(3)}|${rs.toFixed(3)}`;

export class Choreographer {
  readonly #map: MLMap;
  readonly #pins: Pin[];
  readonly #links: Link[];
  #cfg: MotionConfig;
  #linksDirty = true;

  constructor(map: MLMap, locs: readonly PinnedJoined[], cfg: MotionConfig) {
    this.#map = map;
    this.#cfg = cfg;
    this.#pins = locs.map((loc) => ({
      loc,
      track: settled(false),
      cur: { o: 0, s: 1 },
      pulse: null,
      live: false,
      written: '',
    }));
    const mains = new Map<string, number>();
    locs.forEach((l, i) => l.role === 'main' && mains.set(l.conferenceId, i));
    this.#links = locs.flatMap((l, b) => {
      const a = l.role === 'satellite' ? mains.get(l.conferenceId) : undefined;
      if (a === undefined) return [];
      return [
        {
          a,
          b,
          conferenceId: l.conferenceId,
          coords: greatCircle(locs[a], l),
          track: settled(false),
          cur: { o: 0, s: 0 },
        },
      ];
    });
  }

  /** Jump to `shown` without animating (the animated presentation taking over). */
  reset(shown: ReadonlySet<string>, cfg: MotionConfig): void {
    this.#cfg = cfg;
    for (const p of this.#pins) {
      p.track = settled(shown.has(p.loc.id));
      p.cur = { ...p.track.from };
      p.pulse = null;
      p.live = false;
    }
    for (const l of this.#links) {
      const on = this.#pins[l.a].track.shown && this.#pins[l.b].track.shown;
      l.track = settled(on);
      l.cur = { o: on ? 1 : 0, s: on ? 1 : 0 };
    }
    this.#linksDirty = true;
    this.frame(performance.now());
  }

  /**
   * New targets. Leaving pins fade out at once; entering ones are staggered (by start date, then
   * west → east) so simultaneous arrivals can be followed. A line enters after both its pins.
   */
  setTargets(
    shown: ReadonlySet<string>,
    live: ReadonlySet<string>,
    now: number,
    cfg: MotionConfig,
  ): void {
    this.#cfg = cfg;
    const entering: number[] = [];
    this.#pins.forEach((p, i) => {
      const want = shown.has(p.loc.id);
      if (want === p.track.shown) return;
      if (want) entering.push(i);
      else p.track = retarget(p.cur, false, now, 0, cfg);
    });
    entering.sort((i, j) => {
      const [a, b] = [this.#pins[i].loc, this.#pins[j].loc];
      return a.start.localeCompare(b.start) || a.lng - b.lng;
    });
    const delays = staggerDelays(entering.length, cfg);
    entering.forEach((i, k) => {
      this.#pins[i].track = retarget(this.#pins[i].cur, true, now, delays[k], cfg);
    });

    for (const p of this.#pins) {
      const isLive = cfg.pulse && live.has(p.loc.id) && p.track.shown;
      if (isLive && !p.live) {
        const ongoing = p.pulse && now < p.pulse.until;
        p.pulse = { t0: ongoing ? p.pulse!.t0 : now + p.track.delay, until: Infinity };
      } else if (!isLive && p.live && p.pulse) {
        p.pulse.until = pulseEnd(p.pulse.t0, now, cfg);
      }
      p.live = isLive;
    }

    for (const l of this.#links) {
      const [a, b] = [this.#pins[l.a].track, this.#pins[l.b].track];
      const want = a.shown && b.shown;
      if (want === l.track.shown) continue;
      const fresh = l.cur.o === 0;
      l.track = {
        shown: want,
        t0: now,
        delay: want ? Math.max(a.delay, b.delay) + cfg.enterMs * 0.6 : 0,
        from: want && fresh ? { o: 0, s: 0 } : { ...l.cur },
      };
      this.#linksDirty = true;
    }
  }

  /** Apply the state at `now`. Returns whether anything is still moving (keep the loop going). */
  frame(now: number): boolean {
    const cfg = this.#cfg;
    let busy = false;
    this.#pins.forEach((p, id) => {
      const v = trackAt(p.track, now, cfg);
      if (!v.done) busy = true;
      p.cur = { o: v.o, s: v.s };
      let ro = 0;
      let rs = 0;
      if (p.pulse) {
        if (now >= p.pulse.until) p.pulse = null;
        else {
          busy = true;
          if (now >= p.pulse.t0) ({ ro, rs } = pulseAt(p.pulse.t0, now, cfg));
        }
      }
      const k = key(v.o, v.s, ro, rs);
      if (k === p.written) return;
      p.written = k;
      this.#map.setFeatureState({ source: SRC.anim, id }, { o: v.o, s: v.s, ro, rs });
    });

    for (const l of this.#links) {
      const v = linkAt(l.track, now, cfg);
      if (!v.done) busy = true;
      if (v.o !== l.cur.o || v.s !== l.cur.s) this.#linksDirty = true;
      l.cur = { o: v.o, s: v.s };
    }
    if (this.#linksDirty) {
      this.#linksDirty = false;
      (this.#map.getSource(SRC.animLinks) as GeoJSONSource | undefined)?.setData(this.#linkData());
    }
    return busy;
  }

  /** Re-send everything (a style reload drops sources and their feature-state). */
  reapply(): void {
    for (const p of this.#pins) p.written = '';
    this.#linksDirty = true;
    this.frame(performance.now());
  }

  #linkData(): FeatureCollection<LineString, { conferenceId: string; o: number }> {
    return {
      type: 'FeatureCollection',
      features: this.#links
        .filter((l) => l.cur.o > 0.001 && l.cur.s > 0)
        .map((l) => ({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: trimLine(l.coords, l.cur.s) },
          properties: { conferenceId: l.conferenceId, o: l.cur.o },
        })),
    };
  }
}
