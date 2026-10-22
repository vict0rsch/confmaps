// The app's filter state, wired into the app's visibility hook (DESIGN §6.3).
//
// - `filterState`: get/set/reset each filter's state, `activeCount` for badges, `ctx`.
// - `getDates()` / `setDates()`: the `dates` window, shared with the timeline (§6.4).
import { co2Model } from '../co2/model';
import { createFilters } from '../filters';
import type { DateWindow } from '../filters/dates';
import { FilterStore } from '../filters/store.svelte';
import type { Ctx } from '../filters/types';
import { app } from './app.svelte';
import { travel } from './travel.svelte';

export function appCtx(): Ctx {
  return {
    home: app.home,
    units: travel.units,
    mode: travel.mode,
    threshold: travel.threshold,
    co2: co2Model,
    today: app.today,
    now: app.now,
  };
}

export const filterState = new FilterStore(createFilters(app.today), appCtx);

// The closure reads `filterState.predicate` (derived) on each call, so `app.visibleLocations`
// tracks every filter state and ctx value it depends on.
app.predicate = (loc) => filterState.predicate(loc);

/** The `dates` window (`YYYY-MM-DD` bounds, inclusive). */
export const getDates = (): DateWindow => filterState.get<DateWindow>('dates');
/** Set the `dates` window (a user change: counts as filter use when it differs from default). */
export const setDates = (w: DateWindow): void => filterState.set('dates', w);
/** The Plan default (today → +12 months). */
export const defaultDates = (): DateWindow => filterState.filter('dates')!.defaultState;
