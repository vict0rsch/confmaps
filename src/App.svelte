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
  const SIDEBAR_WIDTH = 368; // keep in sync with --sidebar-width
  const TIMELINE_HEIGHT = 56; // keep in sync with --timeline-height
  const PANEL_GAP = 16; // keep in sync with --panel-gap
  const MOBILE_GAP = 12; // keep in sync with .mobile --shell-gap
  const SHEET_PEEK = 176; // keep in sync with BottomSheet

  // Phones open at half: the map above is roughly square, the shape of the world overview.
  let sheetSnap: Snap = $state('half');
  let sheetHeight = $state(0);
  // Mobile: the floating top bar, safe-area padding included.
  let topbarHeight = $state(0);
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

  // The map fills the window; these are the floating panels it must keep pins clear of.
  const insets: Insets = $derived(
    desktop.current
      ? {
          top: 0,
          right: app.selectedConference ? DRAWER_WIDTH + PANEL_GAP * 2 : 0,
          bottom: TIMELINE_HEIGHT + PANEL_GAP * 2,
          left: SIDEBAR_WIDTH + PANEL_GAP * 2,
        }
      : {
          top: topbarHeight + MOBILE_GAP,
          right: 0,
          bottom: Math.max(sheetHeight, SHEET_PEEK),
          left: 0,
        },
  );

  // Edges of the free map area, gap included, for overlays inside the stage (map controls).
  const shellGap = $derived(desktop.current ? PANEL_GAP : MOBILE_GAP);

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
<DocDialog
  hash="credits"
  title="Third-party notices"
  load={() => import('../THIRD_PARTY_NOTICES.md?raw')}
/>

<div class="app" class:desktop={desktop.current} class:mobile={!desktop.current}>
  {#if desktop.current}
    <!-- Floating glass panel. Only the list scrolls; header, home pill and filters stay put. -->
    <aside class="sidebar glass">
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
      <div class="sidebar-filters">
        <FiltersSlot />
      </div>
      <div class="sidebar-list">
        <ConferenceList />
      </div>
      <div class="sidebar-footer">
        <Footer />
      </div>
    </aside>
  {:else}
    <!-- Floating glass capsules over the full-bleed map. -->
    <header class="topbar" bind:offsetHeight={topbarHeight}>
      <div class="topbar-brand glass"><Brand /></div>
      <div class="topbar-actions glass">
        <SettingsSlot compact />
        <button class="button" type="button" onclick={() => filtersDialog?.showModal()}>
          <Icon name="filter" size={14} /> Filters
          {#if filterState.activeCount}
            <span class="badge tabular" data-testid="filters-badge">
              {filterState.activeCount}<span class="visually-hidden">&nbsp;active</span>
            </span>
          {/if}
        </button>
      </div>
    </header>
  {/if}

  <main
    class="stage"
    class:sheet-full={!desktop.current && sheetSnap === 'full'}
    style:--stage-inset-top="{Math.max(insets.top, shellGap)}px"
    style:--stage-inset-right="{Math.max(insets.right, shellGap)}px"
    style:--stage-inset-bottom="{Math.max(insets.bottom, shellGap)}px"
    style:--stage-inset-left="{Math.max(insets.left, shellGap)}px"
  >
    {#await mapView}
      <div class="map-placeholder"></div>
    {:then { default: MapView }}
      <MapView {insets} />
    {/await}

    {#if desktop.current}
      <div class="legend-chip glass" class:beside-drawer={!!app.selectedConference}>
        <Legend />
      </div>
      {#if app.selectedConference}
        <div
          data-scroll
          class="drawer glass"
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
      <!-- The sheet slides up to the top bar, never under it. -->
      <div class="sheet-dock" style:top="{topbarHeight + MOBILE_GAP}px">
        <BottomSheet
          bind:snap={sheetSnap}
          onheightchange={(h) => (sheetHeight = h)}
          label={app.selectedConference ? 'Conference details' : 'Conference list'}
        >
          {#snippet header()}
            <!-- Docked under the grip so Play stays in view at every snap. Its presses scrub the
                 timeline, never drag the sheet. -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="sheet-timeline" onpointerdown={(e) => e.stopPropagation()}>
              <TimelineSlot compact />
            </div>
          {/snippet}
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
      </div>
    {/if}
  </main>

  {#if desktop.current}
    <div class="timeline glass"><TimelineSlot /></div>
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
    <div class="filters-dialog-body"><FiltersSlot layout="dialog" /></div>
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
    position: relative;
    height: 100vh;
    height: 100dvh;
    background: var(--canvas);
  }

  /* The map fills the window; every other part of the shell floats above it. */
  .stage {
    position: absolute;
    inset: 0;
    /* Own stacking context: map controls and overlays stay under the floating panels. */
    z-index: 0;
  }

  .map-placeholder {
    position: absolute;
    inset: 0;
    background: var(--map-land);
  }

  /* ---- Desktop ---- */
  .sidebar {
    position: absolute;
    top: var(--panel-gap);
    bottom: var(--panel-gap);
    left: var(--panel-gap);
    z-index: 1;
    display: flex;
    flex-direction: column;
    width: var(--sidebar-width);
    /* Only the list scrolls. The expanded credits can exceed a short window: then the panel scrolls. */
    overflow-y: auto;
    overscroll-behavior: contain;
    border-radius: var(--radius-panel);
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
    gap: var(--space-1);
  }

  .sidebar-settings,
  .sidebar-filters {
    flex: none;
    padding: 0 var(--space-4) var(--space-3);
  }

  .sidebar-list {
    flex: 1 1 0;
    /* Shrinks while a filter tray is open, so the panel itself rarely has to scroll. */
    min-height: 120px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .sidebar-footer {
    flex: none;
    margin: 0 var(--space-4);
    padding: var(--space-3) 0 var(--space-4);
    border-top: 1px solid var(--hairline);
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

  /* Top-left of the free map area, right of the sidebar. */
  .legend-chip {
    position: absolute;
    top: var(--panel-gap);
    left: calc(var(--sidebar-width) + 2 * var(--panel-gap));
    max-width: calc(100% - var(--sidebar-width) - 3 * var(--panel-gap));
    padding: 6px var(--space-4);
    /* A capsule on one line; stays rounded if it wraps beside the drawer. */
    border-radius: var(--radius-card);
  }

  .legend-chip.beside-drawer {
    max-width: calc(100% - var(--sidebar-width) - var(--drawer-width) - 4 * var(--panel-gap));
  }

  /* Under ~1280 px the map between sidebar and drawer is too narrow for the legend: it would
     wrap into a box over the pins. It comes back when the drawer closes. */
  @media (max-width: 1279px) {
    .legend-chip.beside-drawer {
      display: none;
    }
  }

  /* Right, from the top gap down to the timeline (fits its content, never taller). */
  .drawer {
    position: absolute;
    top: var(--panel-gap);
    right: var(--panel-gap);
    width: var(--drawer-width);
    max-height: calc(100% - 3 * var(--panel-gap) - var(--timeline-height));
    overflow-y: auto;
    overscroll-behavior: contain;
    border-radius: var(--radius-panel);
  }

  /* Bottom, from the sidebar's right edge to the window's right gap. */
  .timeline {
    position: absolute;
    right: var(--panel-gap);
    bottom: var(--panel-gap);
    left: calc(var(--sidebar-width) + 2 * var(--panel-gap));
    z-index: 1;
    height: var(--timeline-height);
    border-radius: var(--radius-panel);
  }

  /* ---- Mobile ---- */
  .mobile {
    --shell-gap: var(--space-3); /* keep in sync with MOBILE_GAP */
  }

  .topbar {
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
    z-index: 2;
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    gap: var(--space-2);
    padding: max(env(safe-area-inset-top), var(--shell-gap))
      max(env(safe-area-inset-right), var(--shell-gap)) 0
      max(env(safe-area-inset-left), var(--shell-gap));
    /* Only the capsules take presses; the map between them stays draggable. */
    pointer-events: none;
  }

  .topbar > * {
    pointer-events: auto;
  }

  .topbar-brand {
    display: flex;
    flex: none;
    align-items: center;
    padding: 0 var(--space-3);
    border-radius: var(--radius-full);
  }

  /* Tight on a 390 px phone: the home pill shrinks first, Filters keeps its size. */
  .topbar-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    padding: 3px;
    border-radius: var(--radius-full);
  }

  .topbar-actions .button {
    flex: none;
    padding: 0 var(--space-3);
  }

  /* Pinch-zoom on phones; the zoom buttons would sit under the sheet. */
  .mobile :global(.maplibregl-ctrl-group) {
    display: none;
  }

  /* A full sheet covers the map: its attribution would float up under the top bar. */
  .sheet-full :global(.maplibregl-ctrl-bottom-right) {
    visibility: hidden;
  }

  .sheet-dock {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    pointer-events: none;
  }

  .sheet-timeline {
    height: var(--timeline-height-compact);
    padding: 0 var(--space-3) 0 var(--space-2);
    border-bottom: 1px solid var(--hairline);
  }

  .sheet-footer {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: 0 var(--space-4);
    padding: var(--space-4) 0 var(--space-8);
    border-top: 1px solid var(--hairline);
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

  /* Full-screen and opaque: the solid glass fallback, no blur. */
  .filters-dialog {
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    margin: 0;
    padding: var(--space-4) var(--space-4) 0;
    border: 0;
    background: var(--glass-fill-solid);
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
    border-top: 1px solid var(--hairline);
  }

  .show-results {
    width: 100%;
    height: 44px;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--accent);
    color: var(--accent-ink);
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
    font-variant-numeric: tabular-nums;
    transition: transform var(--duration-press) var(--ease-out);
  }

  .show-results:hover {
    filter: brightness(1.08);
  }

  .show-results:active {
    transform: scale(0.97);
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
