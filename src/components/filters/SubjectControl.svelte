<script lang="ts">
  import {
    normalizeCodes,
    SUBJECT_GROUPS,
    subjectCatalog,
    type SubjectState,
  } from '../../lib/filters/subject';
  import type { ControlProps } from '../../lib/filters/types';
  import { app } from '../../lib/state/app.svelte';
  import MultiSelect from './MultiSelect.svelte';

  let { state, set }: ControlProps<SubjectState> = $props();

  const catalog = subjectCatalog(app.data.conferences);
  const known = new Set(catalog.map((s) => s.code));
  const groups = SUBJECT_GROUPS.map((name) => ({
    name,
    options: catalog
      .filter((s) => s.group === name)
      .map((s) => ({ value: s.code, label: s.label })),
  })).filter((g) => g.options.length);
</script>

<MultiSelect
  legend="Topics"
  emptyLabel="Any topic"
  hint="Any of the selected topics."
  {groups}
  selected={state}
  onchange={(next) => set(normalizeCodes([...state.filter((c) => !known.has(c)), ...next]))}
/>
