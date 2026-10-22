<script lang="ts">
  // SLOT: timeline / scrubber (DESIGN §6.4, phase 6). Replace the placeholder with
  // <Timeline {compact} />; the container has a fixed height (--timeline-height[-compact]).
  import { formatDateRange } from '../../lib/format/dates';
  import { app } from '../../lib/state/app.svelte';
  import { planWindow } from '../../lib/state/derive';
  import Icon from '../Icon.svelte';

  let { compact = false }: { compact?: boolean } = $props();

  const w = $derived(planWindow(app.today));
</script>

<div class="timeline-slot" class:compact data-slot="timeline">
  <Icon name="calendar" size={15} />
  <span class="label">Next 12 months</span>
  <span class="range tabular">{formatDateRange(w.from, w.to)}</span>
</div>

<style>
  .timeline-slot {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 100%;
    padding: 0 var(--space-4);
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }

  .label {
    color: var(--ink);
    font-weight: var(--weight-medium);
  }

  .compact {
    padding: 0 var(--space-3);
    font-size: var(--text-xs);
  }
</style>
