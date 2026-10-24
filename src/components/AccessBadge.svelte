<script lang="ts">
  import { ACCESS_ICON, ACCESS_LABEL, type Access } from '../lib/format/labels';
  import Icon from './Icon.svelte';

  let { access }: { access: Access } = $props();
</script>

<span class="badge" class:restricted={access === 'authors_only'}>
  <Icon name={ACCESS_ICON[access]} size={12} />
  {ACCESS_LABEL[access]}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 20px;
    padding: 0 8px;
    border-radius: var(--radius-full);
    box-shadow: inset 0 0 0 1px var(--hairline);
    color: var(--ink-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    white-space: nowrap;
  }
  .restricted {
    box-shadow: inset 0 0 0 1px var(--border-strong);
    color: var(--ink);
  }
</style>
