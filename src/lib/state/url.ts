// URL state (DESIGN §6.6), pure part: parse a query string into app state and build one back.
// Example: `?c=neurips26&sub=ML,CV&radius=1000&co2=300&from=2026-11&to=2027-10`.
//
// Owned params: each registered filter's `params`, plus `c` (selection), `mode`, `thr`, `units`,
// and `h` (history mode) when the caller passes it. `home` (a shared GeoNames city id, §6.5) is read
// but never kept: the address bar never carries it, only the share dialog adds it (`withHomeParam`).
// Every other param is left as is.
// Parsing never throws: invalid values fall back to defaults.
import type { ModeSetting } from '../co2/model';
import type { AnyFilter, Units } from '../filters/types';
import { DEFAULT_TRAVEL, isMode, isThreshold, isUnits, type TravelValues } from './travel.svelte';

export const SELECTION_PARAM = 'c';
export const TRAVEL_PARAMS = { mode: 'mode', threshold: 'thr', units: 'units' } as const;
/**
 * Filters whose result depends on the travel settings (CO₂ estimate: mode and threshold). A link
 * with one active carries all travel settings, defaults included, so it does not depend on the
 * recipient's saved ones. (`radius` is great-circle km: units only change its display.)
 */
export const TRAVEL_DEPENDENT_FILTERS: readonly string[] = ['co2'];
export const HOME_PARAM = 'home';
/** `h` = history mode (§6.4), `home` = opt-in shared city (§6.5). */
export const RESERVED_PARAMS: readonly string[] = ['h', HOME_PARAM];
export const HISTORY_PARAM = 'h';

/** The `h` param (a conference series), if present and known. */
export function parseHistory(query: string, isSeries: (s: string) => boolean): string | null {
  const h = params(query).get(HISTORY_PARAM);
  return h && isSeries(h) ? h : null;
}

export function ownedParams(filters: readonly AnyFilter[]): string[] {
  return [SELECTION_PARAM, ...filters.flatMap((f) => f.params), ...Object.values(TRAVEL_PARAMS)];
}

export type ParsedURL = {
  /** Every filter's state (defaults where absent or invalid). */
  filters: Record<string, unknown>;
  selection: string | null;
  /** Only the travel values present and valid in the URL. */
  travel: Partial<TravelValues>;
  /** GeoNames id from an opt-in shared link (`home=<id>`), else null. */
  home: number | null;
};

function params(query: string): URLSearchParams {
  try {
    return new URLSearchParams(query);
  } catch {
    return new URLSearchParams();
  }
}

export function parseQuery(
  query: string,
  filters: readonly AnyFilter[],
  isConference: (id: string) => boolean,
): ParsedURL {
  const p = params(query);
  const states: Record<string, unknown> = {};
  for (const f of filters) {
    try {
      states[f.id] = f.fromURL(query);
    } catch {
      states[f.id] = f.defaultState;
    }
  }
  const c = p.get(SELECTION_PARAM);
  const travel: Partial<TravelValues> = {};
  const mode = p.get(TRAVEL_PARAMS.mode);
  if (isMode(mode)) travel.mode = mode;
  const units = p.get(TRAVEL_PARAMS.units);
  if (isUnits(units)) travel.units = units;
  const thr = p.get(TRAVEL_PARAMS.threshold);
  if (thr && /^\d{1,5}$/.test(thr) && isThreshold(Number(thr))) travel.threshold = Number(thr);
  const h = p.get(HOME_PARAM);
  const home = h && /^\d{1,9}$/.test(h) && Number(h) > 0 ? Number(h) : null;
  return { filters: states, selection: c && isConference(c) ? c : null, travel, home };
}

export type URLInputs = {
  filters: readonly AnyFilter[];
  states: Readonly<Record<string, unknown>>;
  selection: string | null;
  travel: { units: Units; mode: ModeSetting; threshold: number };
  /** History mode series (`h`); `undefined` leaves `h` as it is in `current`. */
  history?: string | null;
};

/** Commas stay literal (`sub=ML,CV`); everything else is percent-encoded. */
const enc = (s: string) => encodeURIComponent(s).replace(/%2C/gi, ',');

/**
 * The query string (no `?`) for `inputs`, keeping `current`'s params this module does not own.
 * Order: selection, history, active filters (registry order), travel (non-default, or all when a CO₂ filter is active), the rest.
 */
export function buildQuery(current: string, inputs: URLInputs): string {
  const entries: [string, string][] = [];
  if (inputs.selection) entries.push([SELECTION_PARAM, inputs.selection]);
  if (inputs.history) entries.push([HISTORY_PARAM, inputs.history]);
  for (const f of inputs.filters) {
    const s = inputs.states[f.id];
    if (f.isActive(s)) entries.push(...new URLSearchParams(f.toURL(s)));
  }
  const t = inputs.travel;
  const all = inputs.filters.some(
    (f) => TRAVEL_DEPENDENT_FILTERS.includes(f.id) && f.isActive(inputs.states[f.id]),
  );
  if (all || t.mode !== DEFAULT_TRAVEL.mode) entries.push([TRAVEL_PARAMS.mode, t.mode]);
  if (all || t.threshold !== DEFAULT_TRAVEL.threshold) {
    entries.push([TRAVEL_PARAMS.threshold, String(t.threshold)]);
  }
  if (all || t.units !== DEFAULT_TRAVEL.units) entries.push([TRAVEL_PARAMS.units, t.units]);
  const owned = new Set(ownedParams(inputs.filters));
  if (inputs.history !== undefined) owned.add(HISTORY_PARAM);
  for (const [k, v] of params(current)) {
    if (!owned.has(k) && k !== HOME_PARAM) entries.push([k, v]);
  }
  return entries.map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
}

/** `url` with `home=<city id>` added (opt-in share), or with any `home` removed when `id` is null. */
export function withHomeParam(url: string, id: number | null): string {
  const u = new URL(url);
  u.searchParams.delete(HOME_PARAM);
  if (id !== null) u.searchParams.set(HOME_PARAM, String(id));
  return u.toString();
}
