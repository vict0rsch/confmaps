<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { cubicIn, cubicOut } from 'svelte/easing';
  import { prefersReducedMotion } from 'svelte/motion';
  import { MediaQuery } from 'svelte/reactivity';
  import { fly } from 'svelte/transition';
  import BottomSheet, { type Snap } from './components/BottomSheet.svelte';
  import Brand from './components/Brand.svelte';
  import ConferenceList from './components/ConferenceList.svelte';
  import Detail from './components/Detail.svelte';
  import Footer from './components/Footer.svelte';
  import Icon from './components/Icon.svelte';
  import Legend from './components/Legend.svelte';
  import MapView, { type Insets } from './components/Map.svelte';
  import ThemeToggle from './components/ThemeToggle.svelte';
  import FiltersSlot from './components/slots/FiltersSlot.svelte';
  import SettingsSlot from './components/slots/SettingsSlot.svelte';
  import TimelineSlot from './components/slots/TimelineSlot.svelte';
  import { app } from './lib/state/app.svelte';

  const desktop = new MediaQuery('(min-width: 1024px)', true);

  const DRAWER_WIDTH = 384; // keep in sync with --drawer-width
  const DRAWER_GAP = 12;
  const SHEET_PEEK = 132; // keep in sync with BottomSheet
  const TIMELINE_COMPACT = 44; // --timeline-height-compact

  let sheetSnap: Snap = $state('peek');
  let sheetHeight = $state(0);
  let filtersDialog: HTMLDialogElement | undefined = $state();

  $effect.pre(() => {
    document.documentElement.dataset.theme = app.resolvedTheme;
  });

  // Mobile: opening a conference raises the sheet so the detail is readable.
  $effect(() => {
    if (app.selectedConferenceId && !desktop.current && untrack(() => sheetSnap) === 'peek') {
      sheetSnap = 'half';
    }
  });

  const insets: Insets = $derived(
    desktop.current
      ? {
          top: 0,
          right: app.selectedConference ? DRAWER_WIDTH + DRAWER_GAP * 2 : 0,
          bottom: 0,
          left: 0,
        }
      : {
          top: 0,
          right: 0,
          bottom: Math.max(sheetHeight, SHEET_PEEK + TIMELINE_COMPACT + 8),
          left: 0,
        },
  );

  const motion = (ms: number) => (prefersReducedMotion.current ? 0 : ms);

  async function closeDetail() {
    const id = app.selectedConferenceId;
    const hadFocus = document.activeElement?.closest('[data-testid="detail"]');
    app.select(null);
    await tick();
    if (hadFocus && id) {
      document.querySelector<HTMLElement>(`[data-conference-id="${CSS.escape(id)}"]`)?.focus();
    }
  }
</script>

<div class="app" class:desktop={desktop.current} class:mobile={!desktop.current}>
  {#if desktop.current}
    <aside class="sidebar">
      <header class="sidebar-header">
        <Brand />
        <ThemeToggle />
      </header>
      <div class="sidebar-settings">
        <SettingsSlot />
      </div>
      <details class="filters">
        <summary>
          <Icon name="chevron" size={14} />
          <span>Filters</span>
        </summary>
        <div class="filters-body"><FiltersSlot /></div>
      </details>
      <div class="sidebar-list">
        <ConferenceList />
      </div>
      <div class="sidebar-footer">
        <Footer />
      </div>
    </aside>
  {:else}
    <header class="topbar">
      <Brand tagline={false} />
      <div class="topbar-actions">
        <SettingsSlot compact />
        <button class="button" type="button" onclick={() => filtersDialog?.showModal()}>
          <Icon name="filter" size={14} /> Filters
        </button>
      </div>
    </header>
  {/if}

  <main class="stage">
    <MapView {insets} />

    {#if desktop.current}
      <div class="legend-chip"><Legend /></div>
      {#if app.selectedConference}
        <div
          data-scroll
          class="drawer"
          in:fly={{ x: 24, duration: motion(200), easing: cubicOut }}
          out:fly={{ x: 24, duration: motion(150), easing: cubicIn }}
        >
          <Detail conference={app.selectedConference} onclose={closeDetail} />
        </div>
      {/if}
    {:else}
      <div class="timeline-compact" style:bottom="{SHEET_PEEK + 8}px">
        <TimelineSlot compact />
      </div>
      <BottomSheet
        bind:snap={sheetSnap}
        onheightchange={(h) => (sheetHeight = h)}
        label={app.selectedConference ? 'Conference details' : 'Conference list'}
      >
        {#if app.selectedConference}
          <Detail conference={app.selectedConference} onclose={closeDetail} />
        {:else}
          <ConferenceList />
          <div class="sheet-footer">
            <p class="tagline">AI conferences and their satellites. Attend closer, fly less.</p>
            <Legend />
            <div class="sheet-footer-row">
              <span>Theme</span>
              <ThemeToggle />
            </div>
            <Footer />
          </div>
        {/if}
      </BottomSheet>
    {/if}
  </main>

  {#if desktop.current}
    <div class="timeline"><TimelineSlot /></div>
  {/if}
</div>

{#if !desktop.current}
  <dialog class="filters-dialog" bind:this={filtersDialog} aria-labelledby="filters-title">
    <header>
      <h2 id="filters-title">Filters</h2>
      <button
        class="icon-button"
        type="button"
        aria-label="Close filters"
        onclick={() => filtersDialog?.close()}
      >
        <Icon name="close" size={18} />
      </button>
    </header>
    <FiltersSlot />
  </dialog>
{/if}

<style>
  .app {
    display: grid;
    height: 100vh;
    height: 100dvh;
    background: var(--canvas);
  }

  /* ---- Desktop ---- */
  .desktop {
    grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) var(--timeline-height);
  }

  .sidebar {
    grid-row: 1;
    grid-column: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface);
    border-right: 1px solid var(--border);
  }

  .sidebar-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-5) var(--space-4) var(--space-4);
  }

  .sidebar-settings {
    padding: 0 var(--space-4) var(--space-3);
  }

  .filters {
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }

  .filters summary {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 44px;
    padding: 0 var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    cursor: pointer;
    list-style: none;
    user-select: none;
  }

  .filters summary::-webkit-details-marker {
    display: none;
  }

  .filters summary :global(.icon) {
    color: var(--ink-muted);
    transition: transform var(--duration-fast) var(--ease-out);
  }

  .filters[open] summary :global(.icon) {
    transform: rotate(90deg);
  }

  .filters summary:hover {
    background: var(--surface-hover);
  }

  .filters summary:focus-visible {
    outline-offset: -2px;
  }

  .filters-body {
    padding: 0 var(--space-4) var(--space-4);
  }

  .sidebar-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .sidebar-footer {
    padding: var(--space-3) var(--space-4) var(--space-4);
    border-top: 1px solid var(--border);
  }

  .stage {
    position: relative;
    min-width: 0;
    min-height: 0;
  }

  .desktop .stage {
    grid-row: 1;
    grid-column: 2;
  }

  .legend-chip {
    position: absolute;
    left: var(--space-3);
    top: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: color-mix(in srgb, var(--surface-raised) 92%, transparent);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    backdrop-filter: blur(8px);
  }

  .drawer {
    position: absolute;
    top: 12px;
    right: 12px;
    width: var(--drawer-width);
    max-height: calc(100% - 24px);
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-lg);
  }

  .timeline {
    grid-row: 2;
    grid-column: 1 / -1;
    background: var(--surface);
    border-top: 1px solid var(--border);
  }

  /* ---- Mobile ---- */
  .mobile {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: var(--topbar-height) minmax(0, 1fr);
  }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: 0 var(--space-4);
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    z-index: 2;
  }

  .topbar-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  /* Pinch-zoom on phones; the zoom buttons would sit under the sheet. */
  .mobile :global(.maplibregl-ctrl-group) {
    display: none;
  }

  .timeline-compact {
    position: absolute;
    left: var(--space-3);
    right: var(--space-3);
    height: var(--timeline-height-compact);
    background: color-mix(in srgb, var(--surface-raised) 94%, transparent);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);
    backdrop-filter: blur(8px);
  }

  .sheet-footer {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: 0 var(--space-4);
    padding: var(--space-4) 0 var(--space-8);
    border-top: 1px solid var(--border);
  }

  .tagline {
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }

  .sheet-footer-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }

  .filters-dialog {
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    margin: 0;
    padding: var(--space-4);
    border: 0;
    background: var(--surface);
    color: var(--ink);
  }

  .filters-dialog[open] {
    animation: sheet-in var(--duration-slow) var(--ease-out);
  }

  .filters-dialog::backdrop {
    background: var(--scrim);
  }

  .filters-dialog header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-4);
  }

  .filters-dialog h2 {
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
  }

  @keyframes sheet-in {
    from {
      transform: translateY(16px);
      opacity: 0;
    }
  }
</style>
