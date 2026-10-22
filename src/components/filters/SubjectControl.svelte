<script lang="ts">
  import {
    normalizeCodes,
    SUBJECT_GROUPS,
    subjectCatalog,
    type SubjectState,
  } from '../../lib/filters/subject';
  import type { ControlProps } from '../../lib/filters/types';
  import { app } from '../../lib/state/app.svelte';
  import Chips from './Chips.svelte';

  let { state, set }: ControlProps<SubjectState> = $props();

  const catalog = subjectCatalog(app.data.conferences);
  const groups = SUBJECT_GROUPS.map((name) => ({
    name,
    options: catalog
      .filter((s) => s.group === name)
      .map((s) => ({ value: s.code, label: s.label })),
  })).filter((g) => g.options.length);

  /** Replace this group's selection, keeping the other groups'. */
  function setGroup(codes: readonly string[], next: string[]) {
    set(normalizeCodes([...state.filter((c) => !codes.includes(c)), ...next]));
  }
</script>

<div class="subjects">
  <p class="hint">Any of the selected subjects.</p>
  {#each groups as g (g.name)}
    {@const codes = g.options.map((o) => o.value)}
    <div class="group">
      <p class="group-name" aria-hidden="true">{g.name}</p>
      <Chips
        legend={g.name}
        options={g.options}
        selected={state.filter((c) => codes.includes(c))}
        onchange={(next) => setGroup(codes, next)}
      />
    </div>
  {/each}
</div>

<style>
  .subjects {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .hint {
    color: var(--ink-muted);
    font-size: var(--text-xs);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .group-name {
    color: var(--ink-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
</style>
