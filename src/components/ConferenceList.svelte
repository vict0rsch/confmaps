<script lang="ts">
  import { formatCo2, formatDistance, modeIcon } from '../lib/co2/format';
  import { isVirtual } from '../lib/data/types';
  import { nearestOption } from '../lib/home/footprint';
  import { app } from '../lib/state/app.svelte';
  import { travel } from '../lib/state/travel.svelte';
  import type { ListItem } from '../lib/state/derive';
  import { formatDateRangeShort } from '../lib/format/dates';
  import { placeLabel } from '../lib/format/labels';
  import AccessBadge from './AccessBadge.svelte';
  import SiteMarker from './SiteMarker.svelte';
  import VirtualBadge from './VirtualBadge.svelte';

  let listEl: HTMLUListElement | undefined = $state();

  let nearestFirst = $state(false);

  // With a home set, each conference gets its nearest visible site and the estimated trip there,
  // or "Online · ~0 kg" for a virtual edition (sorted first by "Nearest first", at distance 0).
  const near = $derived.by(() => {
    const home = app.home;
    const opts = { mode: travel.mode, thresholdKm: travel.threshold };
    return new Map(
      home ? app.listItems.map((i) => [i.conference.id, nearestOption(home, i.sites, opts)]) : [],
    );
  });
  const distance = (id: string) => {
    const n = near.get(id);
    return !n ? Infinity : n.kind === 'online' ? 0 : n.trip.distanceKm;
  };
  const items = $derived(
    nearestFirst && app.home
      ? app.listItems.toSorted((a, b) => distance(a.conference.id) - distance(b.conference.id))
      : app.listItems,
  );

  function span(item: ListItem) {
    const start = item.sites.reduce((m, s) => (s.start < m ? s.start : m), item.sites[0].start);
    const end = item.sites.reduce((m, s) => (s.end > m ? s.end : m), item.sites[0].end);
    return formatDateRangeShort(start, end);
  }

  /** One access badge on the first site, or one per site when their access levels differ. */
  const mixedAccess = (item: ListItem) => new Set(item.sites.map((s) => s.access)).size > 1;
  /** "Registration" is the common case: only "Open to all" and "Authors only" get a badge here. */
  const showAccess = (item: ListItem, i: number) =>
    item.sites[i].access !== 'registration' && (i === 0 || mixedAccess(item));

  // Keep the selected row in view when selection comes from the map.
  $effect(() => {
    const id = app.selectedConferenceId;
    if (!id || !listEl) return;
    listEl
      .querySelector<HTMLElement>(`[data-conference-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = [...(listEl?.querySelectorAll<HTMLButtonElement>('button.row') ?? [])];
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  }
</script>

<section class="list" aria-labelledby="list-heading">
  <header>
    <h2 id="list-heading">
      <span class="count tabular">{items.length || 'No'}</span>
      {items.length === 1 ? 'conference' : items.length ? 'conferences' : 'conferences match'}
    </h2>
    {#if app.home}
      <button
        class="sort"
        type="button"
        aria-pressed={nearestFirst}
        onclick={() => (nearestFirst = !nearestFirst)}
      >
        Nearest first
      </button>
    {/if}
  </header>

  {#if items.length}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <ul role="list" bind:this={listEl} onkeydown={onKeydown}>
      {#each items as item (item.conference.id)}
        {@const c = item.conference}
        {@const selected =
          app.selectedConferenceId === c.id ||
          item.tracks.some((t) => t.id === app.selectedConferenceId)}
        <li>
          <button
            type="button"
            class="row"
            class:selected
            class:hovered={app.hoveredConferenceId === c.id}
            data-conference-id={c.id}
            aria-current={selected ? 'true' : undefined}
            onclick={() => app.select(c.id)}
            onmouseenter={() => app.hover(c.id)}
            onmouseleave={() => app.hover(null)}
            onfocus={() => app.hover(c.id)}
            onblur={() => app.hover(null)}
          >
            <span class="top">
              <span class="title">{c.title} {c.year}</span>
              <span class="dates tabular">{span(item)}</span>
            </span>
            <span class="sites">
              {#each item.sites as s, i (s.id)}
                <span class="site">
                  {#if isVirtual(s)}
                    <VirtualBadge />
                  {:else}
                    <SiteMarker
                      official={s.official}
                      main={s.role === 'main'}
                      locked={s.access === 'authors_only'}
                    />
                  {/if}
                  <span class="place">{placeLabel(s)}</span>
                  {#if s.format === 'hybrid'}<span class="tag">Hybrid</span>{/if}
                  {#if s.role === 'satellite'}<span class="tag">Satellite</span>{/if}
                  {#if showAccess(item, i)}
                    <span class="badge-slot"><AccessBadge access={s.access} /></span>
                  {/if}
                </span>
              {/each}
            </span>
            {#if item.tracks.length}
              <span class="tracks" title={item.tracks.map((t) => t.title).join(', ')}>
                +{item.tracks.length}
                {item.tracks.length === 1 ? 'track' : 'tracks'}
              </span>
            {/if}
            {#if near.get(c.id)}
              {@const n = near.get(c.id)!}
              <span class="near tabular" data-testid="row-footprint">
                {#if n.kind === 'online'}
                  <span>
                    Online · {formatCo2(0)}
                    <span class="visually-hidden">attend online, estimated</span>
                  </span>
                {:else}
                  {#if item.sites.length > 1}<span class="near-place">{n.site.city}</span>{/if}
                  <span>{formatDistance(n.trip.distanceKm, travel.units)}</span>
                  <span>
                    {formatCo2(n.trip.kgCO2e)}
                    <span aria-hidden="true">{modeIcon(n.trip.mode)}</span>
                    <span class="visually-hidden">
                      estimated, {n.trip.mode === 'rail' ? 'by train' : 'by plane'}
                    </span>
                  </span>
                {/if}
              </span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="empty">Try clearing a filter or widening the dates on the timeline.</p>
  {/if}
</section>

<style>
  /* Transparent: the sidebar / bottom sheet around this list is the glass panel. */
  .list {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: 44px;
    padding: var(--space-2) var(--space-4);
  }

  h2 {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    color: var(--ink-muted);
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: 0 var(--space-2) var(--space-4);
  }

  .row {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
    border: 0;
    border-radius: var(--radius-card);
    background: transparent;
    text-align: left;
    transition: background-color var(--duration-fast) var(--ease-out);
  }

  .row:hover,
  .row.hovered {
    background: var(--glass-tint-hover);
  }

  .row.selected {
    background: var(--accent-soft);
  }

  /* Shape cue for the selected row, so selection does not rely on the tint alone. */
  .row.selected::before {
    content: '';
    position: absolute;
    left: 5px;
    top: 14px;
    bottom: 14px;
    width: 3px;
    border-radius: var(--radius-full);
    background: var(--accent);
  }

  .row:focus-visible {
    outline-offset: -2px;
    border-radius: var(--radius-card);
  }

  .top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .title {
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-tight);
  }

  .dates {
    flex: none;
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }

  .sites {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .site {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--ink);
  }

  .site :global(.marker) {
    margin-inline: 2px;
  }

  .place {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tag {
    flex: none;
    color: var(--ink-muted);
    font-size: var(--text-xs);
  }

  .tracks {
    color: var(--ink-muted);
    font-size: var(--text-xs);
  }

  .badge-slot {
    flex: none;
    margin-left: auto;
    padding-left: var(--space-2);
  }

  .sort {
    height: 28px;
    padding: 0 var(--space-3);
    border: 0;
    border-radius: var(--radius-full);
    background: var(--control-fill);
    box-shadow: inset 0 0 0 1px var(--hairline);
    color: var(--ink-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    transition:
      background-color var(--duration-fast) var(--ease-out),
      transform var(--duration-press) var(--ease-out);
  }

  .sort:hover {
    background: var(--control-fill-hover);
    color: var(--ink);
  }

  .sort:active {
    transform: scale(0.97);
  }

  .sort[aria-pressed='true'] {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
    color: var(--accent);
  }

  .near {
    display: flex;
    flex-wrap: wrap;
    gap: 2px var(--space-3);
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }

  .near-place {
    color: var(--ink);
  }

  .empty {
    padding: var(--space-2) var(--space-4) var(--space-4);
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }
</style>
