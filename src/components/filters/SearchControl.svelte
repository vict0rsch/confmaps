<script lang="ts">
  import { untrack } from 'svelte';
  import { cleanQuery, SEARCH_MAX_LENGTH } from '../../lib/filters/search';
  import type { ControlProps } from '../../lib/filters/types';
  import Icon from '../Icon.svelte';

  let { state: value, set }: ControlProps<string> = $props();

  const DEBOUNCE_MS = 200;
  let text = $state('');
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Follow outside changes (Clear all, URL) unless they are just this input's own echo.
  $effect.pre(() => {
    const s = value;
    untrack(() => {
      if (cleanQuery(text) !== s) text = s;
    });
  });

  function oninput() {
    clearTimeout(timer);
    timer = setTimeout(() => set(cleanQuery(text)), DEBOUNCE_MS);
  }

  $effect(() => () => clearTimeout(timer));
</script>

<div class="search">
  <label class="visually-hidden" for="filter-search">Search conferences</label>
  <Icon name="search" size={14} />
  <input
    id="filter-search"
    class="input"
    type="search"
    placeholder="Search, e.g. NeurIPS, ICML"
    autocomplete="off"
    spellcheck="false"
    maxlength={SEARCH_MAX_LENGTH}
    bind:value={text}
    {oninput}
  />
</div>

<style>
  .search {
    position: relative;
    display: flex;
    align-items: center;
  }

  .search :global(.icon) {
    position: absolute;
    left: 13px;
    color: var(--ink-faint);
    pointer-events: none;
  }

  .input {
    width: 100%;
    padding-left: 34px;
  }
</style>
