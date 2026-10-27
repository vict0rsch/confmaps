<script lang="ts">
  // SLOT: filter panel (DESIGN §6.3). `sidebar` (desktop): chips with trays; `dialog`: the filters
  // panel on phones, every filter stacked open, multi-selects as fields.
  import FilterPanel from '../filters/FilterPanel.svelte';

  let { layout = 'sidebar' }: { layout?: 'sidebar' | 'dialog' } = $props();
</script>

<FilterPanel {layout} />
