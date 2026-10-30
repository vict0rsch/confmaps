<script module lang="ts">
  /**
   * Set by FilterPanel: a getter of the timeline's span start (`scope.span.from`), so "Since
   * <year>" matches the timeline. Through context: importing the timeline state here would be an
   * import cycle (it imports the filters, which import this control).
   */
  export const DATA_FROM_CONTEXT = Symbol('dates data start');
</script>

<script lang="ts">
  import { getContext } from 'svelte';
  import { monthEnd, parseDay, type DateWindow } from '../../lib/filters/dates';
  import type { ControlProps } from '../../lib/filters/types';
  import { datePresets, sameWindow as same } from '../../lib/timeline/window';

  let { state, set, ctx }: ControlProps<DateWindow> = $props();

  const dataFrom = getContext<() => string>(DATA_FROM_CONTEXT);
  const presets = $derived(datePresets(ctx.today, dataFrom()));

  // Month inputs: "from" snaps to the month's first day, "to" to its last; the other bound moves
  // if needed to keep from ≤ to.
  function setFrom(v: string) {
    const from = parseDay(v, 'start');
    if (from) set({ from, to: state.to < from ? monthEnd(from) : state.to });
  }
  function setTo(v: string) {
    const to = parseDay(v, 'end');
    if (to) set({ from: state.from > to ? `${to.slice(0, 7)}-01` : state.from, to });
  }
</script>

<div class="dates">
  <div class="months">
    <label for="filter-dates-from">From</label>
    <input
      id="filter-dates-from"
      class="input tabular"
      type="month"
      min="1900-01"
      max="2199-12"
      placeholder="YYYY-MM"
      value={state.from.slice(0, 7)}
      onchange={(e) => setFrom(e.currentTarget.value)}
    />
    <label for="filter-dates-to">To</label>
    <input
      id="filter-dates-to"
      class="input tabular"
      type="month"
      min="1900-01"
      max="2199-12"
      placeholder="YYYY-MM"
      value={state.to.slice(0, 7)}
      onchange={(e) => setTo(e.currentTarget.value)}
    />
  </div>
  <div class="presets" role="group" aria-label="Date presets">
    {#each presets as p (p.label)}
      <button type="button" class="preset" aria-pressed={same(state, p.w)} onclick={() => set(p.w)}
        >{p.label}</button
      >
    {/each}
  </div>
</div>

<style>
  .dates {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .months {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
  }

  .months label {
    color: var(--ink-muted);
  }

  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .preset {
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-full);
    background: var(--control-fill);
    color: var(--ink);
    font-size: var(--text-sm);
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .preset:hover {
    background: var(--control-fill-hover);
  }

  .preset[aria-pressed='true'] {
    border-color: transparent;
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: var(--weight-medium);
  }
</style>
