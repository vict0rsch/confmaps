<script lang="ts">
  // Mobile top bar (DESIGN §6.7): the Filters capsule opens the filters panel, anchored under it.
  // Right-aligned with the capsule, or left-aligned when that does not fit (phones held sideways,
  // wide screens). A modal dialog, like the logo panel: the browser handles Escape, the focus
  // trap and stacking, and a tap outside lands on its transparent backdrop.
  import { lightDismiss } from '../lib/dialog';
  import { app } from '../lib/state/app.svelte';
  import { filterState } from '../lib/state/filters.svelte';
  import Icon from './Icon.svelte';
  import FiltersSlot from './slots/FiltersSlot.svelte';

  const GAP = 12; // keep in sync with App's MOBILE_GAP

  const uid = $props.id();
  let open = $state(false);
  let top = $state(0);
  let left = $state(0);
  let capsule: HTMLDivElement | undefined = $state();
  let button: HTMLButtonElement | undefined = $state();
  let closeButton: HTMLButtonElement | undefined = $state();
  let dialog: HTMLDialogElement | undefined = $state();
  const count = $derived(app.listItems.length);

  /** Under the capsule; again on resize (rotation moves the capsule). */
  function place() {
    if (!capsule || !dialog) return;
    const r = capsule.getBoundingClientRect();
    const rightAligned = r.right - dialog.offsetWidth;
    top = r.bottom + 8;
    left = rightAligned >= GAP ? rightAligned : r.left;
  }

  function show() {
    dialog?.showModal();
    place(); // after showModal: the dialog needs a width
    open = true;
    closeButton?.focus(); // a button, so the keyboard does not open
  }
</script>

<svelte:window onresize={() => open && place()} />

<div class="capsule glass" bind:this={capsule}>
  <button
    bind:this={button}
    class="button"
    type="button"
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-controls="{uid}-panel"
    onclick={show}
  >
    <Icon name="filter" size={14} /> Filters
    {#if filterState.activeCount}
      <span class="badge tabular" data-testid="filters-badge">
        {filterState.activeCount}<span class="visually-hidden">&nbsp;active</span>
      </span>
    {/if}
  </button>
</div>

<dialog
  id="{uid}-panel"
  class="panel anchored-panel glass-thick"
  aria-labelledby="{uid}-title"
  bind:this={dialog}
  {@attach lightDismiss}
  style:--panel-top="{top}px"
  style:--panel-left="{left}px"
  onclose={() => {
    open = false;
    button?.focus();
  }}
>
  <div class="head">
    <div class="title">
      <h2 id="{uid}-title">Filters</h2>
      <p class="count tabular">{count || 'No'} {count === 1 ? 'conference' : 'conferences'}</p>
    </div>
    {#if filterState.activeCount}
      <button
        class="clear-all"
        type="button"
        onclick={() => {
          filterState.resetAll();
          closeButton?.focus();
        }}>Clear all</button
      >
    {/if}
    <button
      bind:this={closeButton}
      class="icon-button"
      type="button"
      aria-label="Close filters"
      onclick={() => dialog?.close()}
    >
      <Icon name="close" size={18} />
    </button>
  </div>
  <div class="body"><FiltersSlot layout="dialog" /></div>
</dialog>

<style>
  /* The Filters capsule. The top bar lets presses through to the map; App's `.topbar > *` cannot
     reach this element. */
  .capsule {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    padding: 3px;
    border-radius: var(--radius-full);
    pointer-events: auto;
  }

  .capsule .button {
    flex: none;
    padding: 0 var(--space-3);
    border: 0;
    background: transparent;
    box-shadow: none;
  }

  .badge {
    display: inline-grid;
    place-items: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: var(--radius-full);
    background: var(--accent);
    color: var(--accent-ink);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    line-height: 1;
  }

  /* The header stays put; only the body scrolls. */
  .panel[open] {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-3) var(--space-2) var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--hairline);
  }

  .title {
    flex: 1;
    min-width: 0;
  }

  h2 {
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
  }

  .count {
    color: var(--ink-muted);
    font-size: var(--text-xs);
  }

  .clear-all {
    height: 32px;
    padding: 0 var(--space-3);
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

  .body {
    flex: 1;
    min-height: 0;
    padding: var(--space-3) var(--space-4) var(--space-4);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
</style>
