<script lang="ts">
  import { app } from '../lib/state/app.svelte';
  import type { ListItem } from '../lib/state/derive';
  import { formatDateRangeShort } from '../lib/format/dates';
  import { placeLabel } from '../lib/format/labels';
  import AccessBadge from './AccessBadge.svelte';
  import SiteMarker from './SiteMarker.svelte';

  let listEl: HTMLUListElement | undefined = $state();

  const items = $derived(app.listItems);

  function span(item: ListItem) {
    const start = item.sites.reduce((m, s) => (s.start < m ? s.start : m), item.sites[0].start);
    const end = item.sites.reduce((m, s) => (s.end > m ? s.end : m), item.sites[0].end);
    return formatDateRangeShort(start, end);
  }

  /** One access badge on the first site, or one per site when their access levels differ. */
  const mixedAccess = (item: ListItem) => new Set(item.sites.map((s) => s.access)).size > 1;

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
      List <span class="count tabular">({items.length})</span>
    </h2>
  </header>

  {#if items.length}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <ul role="list" bind:this={listEl} onkeydown={onKeydown}>
      {#each items as item (item.conference.id)}
        {@const c = item.conference}
        {@const selected = app.selectedConferenceId === c.id}
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
                  <SiteMarker
                    official={s.official}
                    main={s.role === 'main'}
                    locked={s.access === 'authors_only'}
                  />
                  <span class="place">{placeLabel(s)}</span>
                  {#if s.role === 'satellite'}<span class="tag">Satellite</span>{/if}
                  {#if i === 0 || mixedAccess(item)}
                    <span class="badge-slot"><AccessBadge access={s.access} /></span>
                  {/if}
                </span>
              {/each}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="empty">No conferences match the current view.</p>
  {/if}
</section>

<style>
  .list {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: var(--space-4) var(--space-4) var(--space-2);
  }

  h2 {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-muted);
  }

  .count {
    font-weight: var(--weight-medium);
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 var(--space-2) var(--space-4);
  }

  .row {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    padding: var(--space-3);
    border: 0;
    border-radius: var(--radius-lg);
    background: transparent;
    text-align: left;
    transition: background-color var(--duration-fast) var(--ease-out);
  }

  .row:hover,
  .row.hovered {
    background: var(--surface-hover);
  }

  .row.selected {
    background: var(--surface-selected);
  }

  .row.selected::before {
    content: '';
    position: absolute;
    left: 0;
    top: 12px;
    bottom: 12px;
    width: 3px;
    border-radius: var(--radius-full);
    background: var(--accent);
  }

  .row:focus-visible {
    outline-offset: -2px;
    border-radius: var(--radius-lg);
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
    gap: 4px;
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

  .site :global(.marker:not(.main)) {
    margin-inline: 4px;
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

  .badge-slot {
    flex: none;
    margin-left: auto;
    padding-left: var(--space-2);
  }

  .empty {
    padding: var(--space-4);
    color: var(--ink-muted);
  }
</style>
