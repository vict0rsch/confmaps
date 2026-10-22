<script lang="ts">
  // SLOT: home location / units / travel mode (DESIGN §6.5, phase 7).
  // Replace this placeholder with <HomeSettings {compact} />. `compact` = mobile top bar.
  import Icon from '../Icon.svelte';

  let { compact = false }: { compact?: boolean } = $props();
</script>

<div class="settings-slot" class:compact data-slot="settings">
  <Icon name="pin" size={15} />
  <span>{compact ? 'Location' : 'Your location: not set'}</span>
</div>

<style>
  .settings-slot {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 36px;
    padding: 0 var(--space-3);
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-md);
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }

  .compact {
    min-height: 32px;
    white-space: nowrap;
  }
</style>
