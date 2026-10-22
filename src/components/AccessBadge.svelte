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
    padding: 0 7px;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    color: var(--ink-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    white-space: nowrap;
  }
  .restricted {
    border-color: var(--border-strong);
    color: var(--ink);
  }
</style>
