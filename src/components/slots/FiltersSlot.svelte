<script lang="ts">
  // SLOT: filter panel (DESIGN §6.3, phase 5). Replace the placeholder body with <FilterPanel />.
  // Rendered inside the collapsible "Filters" section (desktop) or the full-screen filters
  // sheet (mobile); it only needs to render the controls.
</script>

<div class="filters-slot" data-slot="filters">
  <p>Filters by subject, distance, estimated footprint and access will appear here.</p>
</div>

<style>
  .filters-slot {
    padding: var(--space-3);
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-md);
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }
</style>
