<script lang="ts">
  import { seriesTitle } from '../../lib/filters/series';
  import type { ControlProps } from '../../lib/filters/types';
  import { app } from '../../lib/state/app.svelte';

  let { state, set }: ControlProps<string | null> = $props();

  const options = [...new Set(app.data.conferences.map((c) => c.series))]
    .map((value) => ({ value, label: seriesTitle(app.data.conferences, value) }))
    .sort((a, b) => a.label.localeCompare(b.label));
</script>

<select
  class="input"
  aria-label="Conference series"
  value={state ?? ''}
  onchange={(e) => set(e.currentTarget.value || null)}
>
  <option value="">Any series</option>
  {#each options as o (o.value)}
    <option value={o.value}>{o.label}</option>
  {/each}
</select>

<style>
  select {
    width: 100%;
  }
</style>
