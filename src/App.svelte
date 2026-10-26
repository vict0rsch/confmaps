<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { cubicIn, cubicOut } from 'svelte/easing';
  import { prefersReducedMotion } from 'svelte/motion';
  import { MediaQuery } from 'svelte/reactivity';
  import { fly } from 'svelte/transition';
  import BottomSheet, { type Snap } from './components/BottomSheet.svelte';
  import Brand from './components/Brand.svelte';
  import BrandMenu from './components/BrandMenu.svelte';
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
  const SHEET_PEEK = 68; // keep in sync with BottomSheet

  // Phones open at half: the map above is roughly square, the shape of the world overview.
  let sheetSnap: Snap = $state('half');
  let sheetHeight = $state(0);
  // Mobile: the floating top bar, safe-area padding included.
  let topbarHeight = $state(0);
  let filtersDialog: HTMLDialogElement | undefined = $state();
  // Desktop: the sidebar folds into a pill at its top-left corner. Not persisted: every visit opens it.
  let sidebarOpen = $state(true);
  let collapseButton: HTMLButtonElement | undefined = $state();
  let pill: HTMLButtonElement | undefined = $state();
  let pillWidth = $state(0);

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
          left: sidebarOpen ? SIDEBAR_WIDTH + PANEL_GAP * 2 : 0,
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

  async function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    await tick();
    (sidebarOpen ? collapseButton : pill)?.focus();
  }

  async function closeDetail() {
    const id = app.selectedConferenceId;
    const hadFocus = document.activeElement?.closest('[data-testid="detail"]');
    app.select(null);
    await tick();
    if (hadFocus && id) {
      // The list is inert while the desktop sidebar is collapsed: the pill takes the focus.
      if (desktop.current && !sidebarOpen) pill?.focus();
      // A peek sheet is locked at its top: focusing the row must not scroll the heading away.
      else
        document
          .querySelector<HTMLElement>(`[data-conference-id="${CSS.escape(id)}"]`)
          ?.focus({ preventScroll: !desktop.current && sheetSnap === 'peek' });
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

<div
  class="app"
  class:desktop={desktop.current}
  class:mobile={!desktop.current}
  class:sidebar-collapsed={desktop.current && !sidebarOpen}
  style:--pill-width="{pillWidth}px"
>
  {#if desktop.current}
    <!-- Floating glass panel. Only the list scrolls; header, home pill and filters stay put.
         Collapsed, it stays mounted (search, filters and scroll survive) but inert and hidden. -->
    <aside id="sidebar" class="sidebar glass" class:collapsed={!sidebarOpen} inert={!sidebarOpen}>
      <header class="sidebar-header">
        <div class="header-row">
          <Brand />
          <div class="header-actions">
            <ShareDialog />
            <ThemeToggle />
            <button
              class="icon-button"
              type="button"
              aria-label="Hide sidebar"
              title="Hide sidebar"
              aria-expanded="true"
              aria-controls="sidebar"
              bind:this={collapseButton}
              onclick={toggleSidebar}
            >
              <Icon name="menu" size={17} />
            </button>
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
    <!-- The collapsed sidebar: its brand row, as one button. -->
    <button
      class="sidebar-pill glass"
      class:shown={!sidebarOpen}
      type="button"
      title="Show sidebar"
      aria-expanded="false"
      aria-controls="sidebar"
      inert={sidebarOpen}
      bind:this={pill}
      bind:offsetWidth={pillWidth}
      onclick={toggleSidebar}
    >
      <Brand heading={false} />
      <span class="visually-hidden">Show sidebar</span>
      <Icon name="menu" size={16} />
    </button>
  {:else}
    <!-- Floating glass capsules over the full-bleed map. -->
    <header class="topbar" bind:offsetHeight={topbarHeight}>
      <BrandMenu />
      <div class="topbar-actions glass">
        <button class="button" type="button" onclick={() => filtersDialog?.showModal()}>
          <Icon name="filter" size={14} /> Filters
          {#if filterState.activeCount}
            <span class="badge tabular" data-testid="filters-badge">
              {filterState.activeCount}<span class="visually-hidden">&nbsp;active</span>
            </span>
          {/if}
        </button>
      </div>
      <div class="topbar-timeline glass"><TimelineSlot compact /></div>
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
      <MapView {insets} phone={!desktop.current} />
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
          {#if app.selectedConference}
            <Detail
              conference={app.selectedConference}
              onclose={closeDetail}
              onViewHistory={viewHistory}
              {siteFootprint}
            />
          {:else}
            <ConferenceList />
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
    /* Folds toward the pill at its top-left corner. The two never show at once, and the legend and
       timeline never slide over it. Collapse: the sidebar fades, then the pill fades in while the
       legend and timeline slide left. Expand: the pill goes at once, the legend and timeline slide
       right, then the sidebar fades in. */
    transform-origin: top left;
    transition:
      opacity var(--duration-fast) var(--ease-out) var(--duration-fast),
      transform var(--duration-fast) var(--ease-out) var(--duration-fast);
  }

  .sidebar.collapsed {
    visibility: hidden;
    opacity: 0;
    transform: scale(0.96);
    transition:
      opacity var(--duration-fast) var(--ease-in),
      transform var(--duration-fast) var(--ease-in),
      visibility 0s var(--duration-fast);
  }

  /* Top-left, where the sidebar's brand row was. As tall as the legend chip beside it: one line of
     its text, its 6 px padding and the border. */
  .sidebar-pill {
    position: absolute;
    top: var(--panel-gap);
    left: var(--panel-gap);
    z-index: 1;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: calc(var(--text-xs) * var(--leading-normal) + 14px);
    padding: 0 var(--space-3);
    border-radius: var(--radius-full);
    color: var(--ink);
    visibility: hidden;
    opacity: 0;
    /* Hidden, it sits over the sidebar's brand row, so the wordmark slides up into the pill. */
    transform: translate(var(--space-1), var(--space-5));
  }

  .sidebar-pill.shown {
    visibility: visible;
    opacity: 1;
    transform: none;
    transition:
      opacity var(--duration-fast) var(--ease-out) var(--duration-fast),
      transform var(--duration-fast) var(--ease-out) var(--duration-fast);
  }

  .sidebar-pill :global(.icon) {
    color: var(--ink-muted);
    transition: color var(--duration-fast) var(--ease-out);
  }

  .sidebar-pill:hover :global(.icon) {
    color: var(--ink);
  }

  .sidebar-pill.shown:active {
    transform: scale(0.97);
    transition: transform var(--duration-press) var(--ease-out);
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

  /* Top-left of the free map area: right of the sidebar, or of the pill when it is collapsed. */
  .desktop {
    --left-panel-width: var(--sidebar-width);
  }

  .sidebar-collapsed {
    --left-panel-width: var(--pill-width);
  }

  .legend-chip {
    position: absolute;
    top: var(--panel-gap);
    left: calc(var(--left-panel-width) + 2 * var(--panel-gap));
    max-width: calc(100% - var(--left-panel-width) - 3 * var(--panel-gap));
    padding: 6px var(--space-4);
    /* A capsule on one line; stays rounded if it wraps beside the drawer. */
    border-radius: var(--radius-card);
    transition: left var(--duration-fast) var(--ease-out);
  }

  .legend-chip.beside-drawer {
    max-width: calc(100% - var(--left-panel-width) - var(--drawer-width) - 4 * var(--panel-gap));
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

  /* Bottom, from the sidebar's right edge (the window's left gap when it is collapsed) to the
     window's right gap. */
  .timeline {
    position: absolute;
    right: var(--panel-gap);
    bottom: var(--panel-gap);
    left: calc(var(--sidebar-width) + 2 * var(--panel-gap));
    z-index: 1;
    height: var(--timeline-height);
    border-radius: var(--radius-panel);
    transition: left var(--duration-fast) var(--ease-out);
  }

  .sidebar-collapsed .timeline {
    left: var(--panel-gap);
  }

  /* Collapse: they slide left once the sidebar has faded. */
  .sidebar-collapsed .legend-chip,
  .sidebar-collapsed .timeline {
    transition-delay: var(--duration-fast);
  }

  /* The global reduced-motion rule shortens durations, not delays. */
  @media (prefers-reduced-motion: reduce) {
    .sidebar,
    .sidebar-pill,
    .legend-chip,
    .timeline {
      transition-delay: 0s !important;
    }
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
    /* A grid, not a wrapping flex row: when the row is tight, the actions shrink instead of
       wrapping under the logo. */
    display: grid;
    grid-template-columns: auto minmax(0, max-content);
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

  /* The Filters capsule. */
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

  /* Its own row under the logo and actions, so Play stays in view at every snap. The round Play
     button sits concentric in the capsule. */
  .topbar-timeline {
    grid-column: 1 / -1;
    min-width: 0;
    height: var(--timeline-height-compact);
    border-radius: var(--radius-full);
  }

  /* Wide enough: the timeline joins the first row and takes the width left after Filters. */
  @media (min-width: 640px) {
    .topbar {
      grid-template-columns: auto minmax(0, max-content) minmax(0, 1fr);
      justify-content: normal;
    }

    .topbar-timeline {
      grid-column: auto;
    }
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

  /* The detail's title and close button fit the 44 px a peek sheet shows under its grip. */
  .mobile .sheet-dock :global(.detail) {
    padding-top: var(--space-3);
  }

  .tagline {
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
