// Filter state (Svelte 5 runes): one immutable state value per registered filter, and the AND of
// the applied filters as a single per-location predicate.
import { track } from '../analytics';
import type { LocationPredicate } from '../state/derive';
import type { AnyFilter, Ctx } from './types';

export type FilterStates = Readonly<Record<string, unknown>>;

/** AND of every filter that is active (or `appliesWhenInactive`), evaluated per location. */
export function composePredicate(
  filters: readonly AnyFilter[],
  states: FilterStates,
  ctx: Ctx,
): LocationPredicate {
  const applied = filters.filter((f) => f.appliesWhenInactive || f.isActive(states[f.id]));
  return (loc) => applied.every((f) => f.test(loc, ctx, states[f.id]));
}

export class FilterStore {
  readonly filters: readonly AnyFilter[];
  readonly #byId: ReadonlyMap<string, AnyFilter>;
  readonly #getCtx: () => Ctx;
  /** Filters already reported as used (analytics fires once per filter per page load). */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, not reactive state
  readonly #reported = new Set<string>();

  /** Replaced on every change (never mutated), so reads are cheap and comparisons trivial. */
  states: FilterStates = $state.raw({});

  /** Reads reactive app/travel state through `getCtx`, so it re-derives when they change. */
  readonly ctx: Ctx = $derived.by(() => this.#getCtx());

  /** Ids of active filters, in registry order. */
  readonly activeIds: string[] = $derived.by(() =>
    this.filters.filter((f) => f.isActive(this.states[f.id])).map((f) => f.id),
  );
  readonly activeCount: number = $derived(this.activeIds.length);

  /** The combined per-location predicate (assign `(loc) => store.predicate(loc)` to the app). */
  readonly predicate: LocationPredicate = $derived.by(() =>
    composePredicate(this.filters, this.states, this.ctx),
  );

  constructor(filters: readonly AnyFilter[], getCtx: () => Ctx) {
    this.filters = filters;
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built once, never mutated
    this.#byId = new Map(filters.map((f) => [f.id, f]));
    this.#getCtx = getCtx;
    this.states = this.defaults();
  }

  defaults(): FilterStates {
    return Object.fromEntries(this.filters.map((f) => [f.id, f.defaultState]));
  }

  filter(id: string): AnyFilter | undefined {
    return this.#byId.get(id);
  }

  get<S>(id: string): S {
    return this.states[id] as S;
  }

  isActive(id: string): boolean {
    const f = this.#byId.get(id);
    return !!f && f.isActive(this.states[id]);
  }

  /** A user change. Unknown ids are ignored. Fires `filter_used:<id>` on first activation. */
  set<S>(id: string, state: S): void {
    const f = this.#byId.get(id);
    if (!f) return;
    this.states = { ...this.states, [id]: state };
    if (f.isActive(state) && !this.#reported.has(id)) {
      this.#reported.add(id);
      track(`filter_used:${id}`);
    }
  }

  /** Replace several states at once without analytics (URL hydration). Unknown ids ignored. */
  hydrate(states: FilterStates): void {
    const next = { ...this.states };
    for (const [id, s] of Object.entries(states)) if (this.#byId.has(id)) next[id] = s;
    this.states = next;
  }

  reset(id: string): void {
    const f = this.#byId.get(id);
    if (f) this.states = { ...this.states, [id]: f.defaultState };
  }

  resetAll(): void {
    this.states = this.defaults();
  }
}
