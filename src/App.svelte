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
  import type { Insets } from './components/Map.svelte';
  import DocDialog from './components/DocDialog.svelte';
  import ShareDialog from './components/ShareDialog.svelte';
  import SiteFootprint from './components/SiteFootprint.svelte';
  import ThemeToggle from './components/ThemeToggle.svelte';
  import FiltersSlot from './components/slots/FiltersSlot.svelte';
  import SettingsSlot from './components/slots/SettingsSlot.svelte';
  import TimelineSlot from './components/slots/TimelineSlot.svelte';
  import type { JoinedLocation } from './lib/data/load';
  import { app } from './lib/state/app.svelte';
  import { filterState } from './lib/state/filters.svelte';
  import { historyMode } from './lib/state/timeline.svelte';

  const desktop = new MediaQuery('(min-width: 1024px)', true);

  // MapLibre is most of the JS: load it in its own chunk, started now, so the shell paints first.
  const mapView = import('./components/Map.svelte');

  const DRAWER_WIDTH = 384; // keep in sync with --drawer-width
  const DRAWER_GAP = 12;
  const SHEET_PEEK = 132; // keep in sync with BottomSheet
  const TIMELINE_COMPACT = 44; // --timeline-height-compact

  // Phones open at half: the map above is roughly square, the shape of the world overview.
  let sheetSnap: Snap = $state('half');
  let sheetHeight = $state(0);
  let filtersDialog: HTMLDialogElement | undefined = $state();

  $effect.pre(() => {
    document.documentElement.dataset.theme = app.resolvedTheme;
  });

  // Mobile: history mode lowers the sheet so the editions' path is in view.
  $effect(() => {
    if (historyMode.series && !desktop.current && !untrack(() => app.selectedConferenceId)) {
      sheetSnap = 'peek';
    }
  });

  function viewHistory() {
    if (app.selectedConference) historyMode.enter(app.selectedConference.series);
  }

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

{#snippet siteFootprint(site: JoinedLocation)}
  <SiteFootprint {site} />
{/snippet}

<DocDialog hash="methodology" title="Methodology" load={() => import('../METHODOLOGY.md?raw')} />
<DocDialog hash="privacy" title="Privacy" load={() => import('../PRIVACY.md?raw')} />

<div class="app" class:desktop={desktop.current} class:mobile={!desktop.current}>
  {#if desktop.current}
    <aside class="sidebar">
      <header class="sidebar-header">
        <div class="header-row">
          <Brand />
          <div class="header-actions">
            <ShareDialog />
            <ThemeToggle />
          </div>
        </div>
        <p class="tagline">
          <span>AI conferences and their satellites.</span> <span>Attend closer, fly less.</span>
        </p>
      </header>
      <div class="sidebar-settings">
        <SettingsSlot />
      </div>
      <!-- Scrolls on its own (summary pinned) so the list below keeps a usable height. -->
      <div class="filters-scroll">
        <details class="filters">
          <summary>
            <Icon name="chevron" size={14} />
            <span>Filters</span>
            {#if filterState.activeCount}
              <span class="badge tabular" data-testid="filters-badge">
                {filterState.activeCount}<span class="visually-hidden"> active</span>
              </span>
            {/if}
          </summary>
          <div class="filters-body"><FiltersSlot /></div>
        </details>
      </div>
      <div class="sidebar-list">
        <ConferenceList />
      </div>
      <div class="sidebar-footer">
        <Footer />
      </div>
    </aside>
  {:else}
    <header class="topbar">
      <Brand />
      <div class="topbar-actions">
        <SettingsSlot compact />
        <button class="button" type="button" onclick={() => filtersDialog?.showModal()}>
          <Icon name="filter" size={14} /> Filters
          {#if filterState.activeCount}
            <span class="badge tabular" data-testid="filters-badge">
              {filterState.activeCount}<span class="visually-hidden"> active</span>
            </span>
          {/if}
        </button>
      </div>
    </header>
  {/if}

  <main class="stage">
    {#await mapView}
      <div class="map-placeholder"></div>
    {:then { default: MapView }}
      <MapView {insets} />
    {/await}

    {#if desktop.current}
      <div class="legend-chip"><Legend /></div>
      {#if app.selectedConference}
        <div
          data-scroll
          class="drawer"
          in:fly={{ x: 24, duration: motion(200), easing: cubicOut }}
          out:fly={{ x: 24, duration: motion(150), easing: cubicIn }}
        >
          <Detail
            conference={app.selectedConference}
            onclose={closeDetail}
            onViewHistory={viewHistory}
            {siteFootprint}
          />
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
          <Detail
            conference={app.selectedConference}
            onclose={closeDetail}
            onViewHistory={viewHistory}
            {siteFootprint}
          />
        {:else}
          <ConferenceList />
          <div class="sheet-footer">
            <p class="tagline">AI conferences and their satellites. Attend closer, fly less.</p>
            <Legend />
            <div class="sheet-footer-row">
              <span>Theme</span>
              <ThemeToggle />
            </div>
            <div class="sheet-footer-row">
              <span>Share this view</span>
              <ShareDialog />
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
    <div class="filters-dialog-body"><FiltersSlot /></div>
    <footer>
      <button class="show-results" type="button" onclick={() => filtersDialog?.close()}>
        Show {app.listItems.length}
        {app.listItems.length === 1 ? 'result' : 'results'}
      </button>
    </footer>
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
    padding: var(--space-4) var(--space-4) var(--space-3);
  }

  .header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: 36px;
  }

  .sidebar-header .tagline {
    margin-top: var(--space-1);
    line-height: var(--leading-tight);
  }

  /* Break between the two sentences, not inside one. */
  .sidebar-header .tagline span {
    display: inline-block;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .sidebar-settings {
    padding: 0 var(--space-4) var(--space-3);
  }

  .filters-scroll {
    flex: 0 1 auto;
    min-height: 45px;
    overflow-y: auto;
    overscroll-behavior: contain;
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

  .filters > summary {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--surface);
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

  .sidebar-list {
    flex: 1 1 0;
    /* With the filters open, the list keeps ~3 rows; the filter panel scrolls instead. */
    min-height: 240px;
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

  .map-placeholder {
    position: absolute;
    inset: 0;
    background: var(--map-land);
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
    padding: var(--space-4) var(--space-4) 0;
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

  .filters-dialog[open] {
    display: flex;
    flex-direction: column;
  }

  .filters-dialog-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .filters-dialog footer {
    padding: var(--space-3) 0 calc(var(--space-3) + env(safe-area-inset-bottom));
    border-top: 1px solid var(--border);
  }

  .show-results {
    width: 100%;
    height: 44px;
    border: 0;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: var(--accent-ink);
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
    font-variant-numeric: tabular-nums;
  }

  .show-results:hover {
    filter: brightness(1.08);
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
