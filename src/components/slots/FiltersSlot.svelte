<script lang="ts">
  // SLOT: filter panel (DESIGN §6.3). `sidebar` (desktop): chips with trays; `dialog`: the
  // full-screen filters sheet (mobile), every filter stacked open.
  import FilterPanel from '../filters/FilterPanel.svelte';

  let { layout = 'sidebar' }: { layout?: 'sidebar' | 'dialog' } = $props();
</script>

<FilterPanel {layout} />
