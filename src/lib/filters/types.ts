// The filter contract (DESIGN §5.3). One file per filter; registered in ./index.ts.
import type { Component } from 'svelte';
import type { Co2Model, ModeSetting } from '../co2/model';
import type { JoinedLocation } from '../data/load';
import type { LatLng } from '../geo/distance';

export type Units = 'km' | 'mi';

/** Everything a filter may read besides its own state. */
export type Ctx = {
  home?: LatLng;
  units: Units;
  mode: ModeSetting;
  /** `auto` mode: rail below this great-circle distance (km), flight at or above. */
  threshold: number;
  co2: Co2Model;
  /** Local calendar date, `YYYY-MM-DD` (same as `app.today`). */
  today: string;
  /** Current instant, for deadline comparisons (same as `app.now`). */
  now: Date;
};

export type ControlProps<S> = { state: S; set(s: S): void; ctx: Ctx };

export interface Filter<S> {
  /** Stable id: analytics (`filter_used:<id>`), DOM ids. */
  id: string;
  label: string;
  defaultState: S;
  /**
   * Inactive (= default) → skipped by the predicate, not counted in the badge, omitted from the
   * URL. Exception: see `appliesWhenInactive`.
   */
  isActive(s: S): boolean;
  /**
   * The default state still constrains, so `test` always runs (`dates`: the default Plan window
   * hides past events, yet is not "a filter the viewer turned on").
   */
  appliesWhenInactive?: boolean;
  /** Per-location predicate; conference-level filters test `loc.conference`. */
  test(loc: JoinedLocation, ctx: Ctx, s: S): boolean;
  Control: Component<ControlProps<S>>;
  /**
   * URL encoding as a query-string fragment (`"sub=ML%2CCV"`, or `"from=…&to=…"` for filters that
   * own several params). `fromURL` receives the whole query string, reads only its own params and
   * returns `defaultState` for anything missing or invalid. It never throws.
   */
  toURL(s: S): string;
  fromURL(v: string): S;
  /** The URL params this filter owns (checked for collisions in tests). */
  params: readonly string[];
}

// The registry is heterogeneous; each filter is type-checked against its own S where defined.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFilter = Filter<any>;

/** Encode one param as a query fragment (`""` when the value is empty). */
export function param(key: string, value: string): string {
  return value ? new URLSearchParams({ [key]: value }).toString() : '';
}

/** Read one param from a query string; `null` when absent or unparsable. Never throws. */
export function readParam(query: string, key: string): string | null {
  try {
    return new URLSearchParams(query).get(key);
  } catch {
    return null;
  }
}

/** A decimal integer in `1..max`, else `undefined`. */
export function parsePositiveInt(v: string | null, max: number): number | undefined {
  if (!v || !/^\d{1,9}$/.test(v)) return undefined;
  const n = Number(v);
  return n >= 1 && n <= max ? n : undefined;
}
