<script lang="ts">
  import { monthEnd, parseDay, type DateWindow } from '../../lib/filters/dates';
  import type { ControlProps } from '../../lib/filters/types';
  import { addMonthsISO, planWindow } from '../../lib/state/derive';

  let { state, set, ctx }: ControlProps<DateWindow> = $props();

  const presets = $derived([
    { label: '6 months', w: planWindow(ctx.today, 6) },
    { label: '12 months', w: planWindow(ctx.today, 12) },
    { label: 'Past 5 years', w: { from: addMonthsISO(ctx.today, -60), to: ctx.today } },
  ]);
  const same = (a: DateWindow, b: DateWindow) => a.from === b.from && a.to === b.to;

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
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-full);
    background: var(--surface);
    color: var(--ink-muted);
    font-size: var(--text-sm);
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .preset:hover {
    background: var(--surface-hover);
    color: var(--ink);
  }

  .preset[aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: var(--weight-medium);
  }
</style>
