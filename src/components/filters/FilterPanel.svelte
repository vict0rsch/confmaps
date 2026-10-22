<script lang="ts">
  // Registered filters as collapsible sections (DESIGN §6.3), plus "Reset all".
  import { filterState } from '../../lib/state/filters.svelte';
  import Icon from '../Icon.svelte';

  // Sections start collapsed, except filters already active on load (e.g. from a shared link).
  const initiallyOpen = new Set(filterState.activeIds);
</script>

<div class="filter-panel">
  {#each filterState.filters as f (f.id)}
    {@const active = filterState.isActive(f.id)}
    <details class="section" open={initiallyOpen.has(f.id)} data-filter={f.id}>
      <summary>
        <Icon name="chevron" size={12} />
        <span class="label">{f.label}</span>
        {#if active}
          <span class="dot" aria-hidden="true"></span>
          <span class="visually-hidden">(active)</span>
        {/if}
      </summary>
      <div class="body">
        <f.Control
          state={filterState.get(f.id)}
          set={(s: unknown) => filterState.set(f.id, s)}
          ctx={filterState.ctx}
        />
      </div>
    </details>
  {/each}
  <div class="footer">
    <span class="status tabular" aria-live="polite">
      {filterState.activeCount ? `${filterState.activeCount} active` : 'No filters active'}
    </span>
    <button
      class="button"
      type="button"
      disabled={!filterState.activeCount}
      onclick={() => filterState.resetAll()}>Reset all</button
    >
  </div>
</div>

<style>
  .filter-panel {
    display: flex;
    flex-direction: column;
  }

  .section {
    border-bottom: 1px solid var(--border);
  }

  .section:first-child {
    border-top: 1px solid var(--border);
  }

  summary {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 36px;
    padding: 0 var(--space-1);
    font-size: var(--text-sm);
    cursor: pointer;
    list-style: none;
    user-select: none;
    border-radius: var(--radius-sm);
  }

  summary::-webkit-details-marker {
    display: none;
  }

  summary:hover {
    background: var(--surface-hover);
  }

  summary:focus-visible {
    outline-offset: -2px;
  }

  summary :global(.icon) {
    color: var(--ink-muted);
    transition: transform var(--duration-fast) var(--ease-out);
  }

  .section[open] summary :global(.icon) {
    transform: rotate(90deg);
  }

  .label {
    font-weight: var(--weight-medium);
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--accent);
  }

  .body {
    padding: var(--space-1) var(--space-1) var(--space-4) 24px;
  }

  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding-top: var(--space-3);
  }

  .status {
    color: var(--ink-muted);
    font-size: var(--text-xs);
  }
</style>
