<script lang="ts">
  import Icon from '../Icon.svelte';

  let { id }: { id?: string } = $props();
</script>

<p class="needs-home" {id}>
  <Icon name="pin" size={13} />
  Set your location to use this
</p>

<style>
  .needs-home {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--ink-muted);
    font-size: var(--text-xs);
  }
</style>
