<script lang="ts">
  // SLOT: timeline / scrubber (DESIGN §5.4). The container has a fixed height
  // (--timeline-height[-compact]).
  import Timeline from '../Timeline.svelte';

  let { compact = false, onViewHistory }: { compact?: boolean; onViewHistory?: () => void } =
    $props();
</script>

<Timeline {compact} {onViewHistory} />
