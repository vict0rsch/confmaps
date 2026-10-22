<script lang="ts">
  import { ACCESS_LEVELS, type AccessState } from '../../lib/filters/access';
  import type { ControlProps } from '../../lib/filters/types';
  import { ACCESS_ICON, ACCESS_LABEL } from '../../lib/format/labels';
  import Chips from './Chips.svelte';

  let { state, set }: ControlProps<AccessState> = $props();

  const options = ACCESS_LEVELS.map((a) => ({
    value: a,
    label: ACCESS_LABEL[a],
    icon: ACCESS_ICON[a],
  }));
</script>

<Chips legend="Access" {options} selected={state} onchange={set} />
