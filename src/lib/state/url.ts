// URL state (DESIGN §6.6), pure part: parse a query string into app state and build one back.
// Example: `?c=neurips26&sub=ML,CV&radius=1000&co2=300&from=2026-11&to=2027-10`.
//
// Owned params: each registered filter's `params`, plus `c` (selection), `mode`, `thr`, `units`,
// and `h` (history mode) when the caller passes it. Every other param (including the reserved
// `home`, owned by a later phase) is left as is.
// Parsing never throws: invalid values fall back to defaults.
import type { ModeSetting } from '../co2/model';
import type { AnyFilter, Units } from '../filters/types';
import { DEFAULT_TRAVEL, isMode, isThreshold, isUnits, type TravelValues } from './travel.svelte';

export const SELECTION_PARAM = 'c';
export const TRAVEL_PARAMS = { mode: 'mode', threshold: 'thr', units: 'units' } as const;
/** `h` = history mode (§6.4), `home` = opt-in shared city (§6.5). */
export const RESERVED_PARAMS: readonly string[] = ['h', 'home'];
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
  return { filters: states, selection: c && isConference(c) ? c : null, travel };
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
 * Order: selection, history, active filters (registry order), non-default travel, the rest.
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
  if (t.mode !== DEFAULT_TRAVEL.mode) entries.push([TRAVEL_PARAMS.mode, t.mode]);
  if (t.threshold !== DEFAULT_TRAVEL.threshold) {
    entries.push([TRAVEL_PARAMS.threshold, String(t.threshold)]);
  }
  if (t.units !== DEFAULT_TRAVEL.units) entries.push([TRAVEL_PARAMS.units, t.units]);
  const owned = new Set(ownedParams(inputs.filters));
  if (inputs.history !== undefined) owned.add(HISTORY_PARAM);
  for (const [k, v] of params(current)) if (!owned.has(k)) entries.push([k, v]);
  return entries.map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
}
