<script lang="ts">
  // SLOT: timeline / scrubber (DESIGN §5.4). The container has a fixed height
  // (--timeline-height[-compact]).
  import Timeline from '../Timeline.svelte';

  let { compact = false }: { compact?: boolean } = $props();
</script>

<Timeline {compact} />
