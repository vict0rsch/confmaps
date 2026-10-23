<script lang="ts">
  // A site held online: icon + text (never colour alone). Stands in for the pin marker of a
  // virtual edition; `format="hybrid"` marks an in-person site that can also be attended online.
  import { FORMAT_LABEL, type Format } from '../lib/format/labels';
  import Icon from './Icon.svelte';

  let { format = 'virtual' }: { format?: Format } = $props();
</script>

<span class="badge" data-testid="format-badge">
  <Icon name="monitor" size={12} />
  {FORMAT_LABEL[format]}
</span>

<style>
  .badge {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 20px;
    padding: 0 7px;
    border-radius: var(--radius-full);
    background: var(--accent-soft);
    color: var(--accent);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    white-space: nowrap;
  }
</style>
