<script lang="ts">
  import { ACCESS_LEVELS, type AccessState } from '../../lib/filters/access';
  import type { ControlProps } from '../../lib/filters/types';
  import { ACCESS_ICON, ACCESS_LABEL } from '../../lib/format/labels';
  import MultiSelect from './MultiSelect.svelte';

  let { state, set }: ControlProps<AccessState> = $props();

  const options = ACCESS_LEVELS.map((a) => ({
    value: a,
    label: ACCESS_LABEL[a],
    icon: ACCESS_ICON[a],
  }));
</script>

<MultiSelect
  legend="Access"
  emptyLabel="Any access level"
  hint="Any of the selected access levels."
  groups={[{ options }]}
  selected={state}
  onchange={set}
/>
