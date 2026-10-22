<script lang="ts">
  import type { KindState } from '../../lib/filters/kind';
  import type { ControlProps } from '../../lib/filters/types';
  import Segmented from './Segmented.svelte';

  let { state, set }: ControlProps<KindState> = $props();

  type Choice = 'all' | 'official' | 'community';
  const options: { value: Choice; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'official', label: 'Official' },
    { value: 'community', label: 'Community' },
  ];
</script>

<Segmented
  legend="Organizer"
  name="filter-kind"
  {options}
  value={state ?? 'all'}
  onchange={(v) => set(v === 'all' ? null : v)}
/>
