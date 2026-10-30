<script lang="ts">
  // Registered filters (DESIGN §5.3) as a filter bar: the `search` filter's field always visible,
  // every other filter a chip that opens its Control in a tray (one at a time), plus "Clear all".
  // `layout="dialog"` (mobile) stacks every Control open instead of trays; multi-select Controls
  // show as fields there.
  import { setContext, tick } from 'svelte';
  import type { AnyFilter } from '../../lib/filters';
  import { filterState } from '../../lib/state/filters.svelte';
  import { scope } from '../../lib/state/timeline.svelte';
  import Icon from '../Icon.svelte';
  import { DATA_FROM_CONTEXT } from './DatesControl.svelte';
  import { FIELD_CONTEXT } from './MultiSelect.svelte';

  let { layout = 'sidebar' }: { layout?: 'sidebar' | 'dialog' } = $props();
  setContext(FIELD_CONTEXT, () => layout === 'dialog');
  setContext(DATA_FROM_CONTEXT, () => scope.span.from);

  const uid = $props.id();
  const trayId = (id: string) => `${uid}-tray-${id}`;
  const chipId = (id: string) => `${uid}-chip-${id}`;

  const search = $derived(filterState.filters.find((f) => f.id === 'search'));
  const others = $derived(filterState.filters.filter((f) => f.id !== 'search'));

  /** The filter whose tray is open (sidebar layout). */
  let openId = $state<string | null>(null);

  function toggle(id: string) {
    openId = openId === id ? null : id;
  }

  /** The button unmounts: move focus to the search field (sidebar). */
  async function clearAll() {
    filterState.resetAll();
    await tick();
    document.getElementById('filter-search')?.focus();
  }

  async function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !openId) return;
    e.preventDefault();
    e.stopPropagation();
    const id = openId;
    openId = null;
    await tick();
    document.getElementById(chipId(id))?.focus();
  }
</script>

{#snippet control(f: AnyFilter)}
  <f.Control
    state={filterState.get(f.id)}
    set={(s: unknown) => filterState.set(f.id, s)}
    ctx={filterState.ctx}
  />
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="filter-panel" onkeydown={layout === 'sidebar' ? onKeydown : undefined}>
  {#if search}
    <div>{@render control(search)}</div>
  {/if}
  <p class="visually-hidden" aria-live="polite">
    {filterState.activeCount
      ? `${filterState.activeCount} ${filterState.activeCount === 1 ? 'filter' : 'filters'} active`
      : ''}
  </p>

  {#if layout === 'sidebar'}
    <div class="chip-row">
      {#each others as f (f.id)}
        {@const active = filterState.isActive(f.id)}
        <button
          id={chipId(f.id)}
          class="chip"
          class:active
          type="button"
          aria-expanded={openId === f.id}
          aria-controls={trayId(f.id)}
          data-filter={f.id}
          onclick={() => toggle(f.id)}
        >
          {#if active}<span class="dot" aria-hidden="true"></span>{/if}
          <span>{f.label}</span>
          {#if active}<span class="visually-hidden">(active)</span>{/if}
          <Icon name="chevron" size={12} />
        </button>
      {/each}
      {#if filterState.activeCount}
        <button class="clear-all" type="button" onclick={clearAll}>
          Clear all
          <span class="count tabular" data-testid="filters-badge">
            {filterState.activeCount}<span class="visually-hidden">&nbsp;active</span>
          </span>
        </button>
      {/if}
    </div>
    {#each others as f (f.id)}
      <!-- Every tray stays mounted (hidden when closed), so aria-controls always resolves. -->
      <div
        id={trayId(f.id)}
        class="tray glass-thick"
        role="region"
        aria-labelledby={chipId(f.id)}
        data-filter-tray={f.id}
        hidden={openId !== f.id}
      >
        {@render control(f)}
      </div>
    {/each}
  {:else}
    {#each others as f (f.id)}
      {@const active = filterState.isActive(f.id)}
      <section class="stacked" data-filter={f.id} aria-labelledby="{uid}-heading-{f.id}">
        <h3 id="{uid}-heading-{f.id}">
          {f.label}
          {#if active}
            <span class="dot" aria-hidden="true"></span>
            <span class="visually-hidden">(active)</span>
          {/if}
        </h3>
        {@render control(f)}
      </section>
    {/each}
  {/if}
</div>

<style>
  .filter-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  /* Capsule chip. Active = dot + soft accent fill + "(active)" for screen readers. */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 10px 0 12px;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-full);
    background: var(--control-fill);
    color: var(--ink);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    white-space: nowrap;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      transform var(--duration-press) var(--ease-out);
  }

  .chip:hover {
    background: var(--control-fill-hover);
  }

  .chip:active {
    transform: scale(0.97);
  }

  .chip.active {
    border-color: transparent;
    background: var(--accent-soft);
    color: var(--accent);
  }

  .chip :global(.icon) {
    color: var(--ink-muted);
    transform: rotate(90deg);
    transition: transform var(--duration-fast) var(--ease-out);
  }

  .chip.active :global(.icon) {
    color: var(--accent);
  }

  .chip[aria-expanded='true'] :global(.icon) {
    transform: rotate(-90deg);
  }

  .dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--accent);
  }

  .clear-all {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 6px 0 10px;
    border: 0;
    border-radius: var(--radius-full);
    background: none;
    color: var(--accent);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
  }

  .clear-all:hover {
    background: var(--glass-tint-hover);
  }

  .count {
    display: inline-grid;
    place-items: center;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: var(--radius-full);
    background: var(--accent);
    color: var(--accent-ink);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
  }

  /* Positioned: the controls' visually hidden inputs (position: absolute) stay inside the tray's
     scroll box instead of extending the sidebar's scroll height. */
  .tray {
    position: relative;
    max-height: min(270px, 40vh);
    padding: var(--space-4);
    overflow-y: auto;
    overscroll-behavior: contain;
    border-radius: var(--radius-card);
    animation: tray-in var(--duration-base) var(--ease-out);
  }

  .tray[hidden] {
    display: none;
  }

  /* ---- Dialog layout: every Control stacked open ---- */
  .stacked {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--hairline);
  }

  .stacked h3 {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--ink-muted);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
  }

  @keyframes tray-in {
    from {
      transform: translateY(-4px);
      opacity: 0;
    }
  }
</style>
