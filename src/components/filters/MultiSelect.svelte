<script module lang="ts">
  /** Set by FilterPanel: a getter, true where a multi-select shows as a field (the phone layout). */
  export const FIELD_CONTEXT = Symbol('multi-select field');
</script>

<script lang="ts" generics="V extends string">
  // Multi-select (DESIGN §6.3): native checkboxes in a fieldset (keyboard: Tab + Space), with
  // optional group headings. In a desktop tray it is the checklist itself; in the phone layout it
  // is a field that shows the choice and opens the checklist under it.
  import { getContext, tick } from 'svelte';
  import Icon, { type IconName } from '../Icon.svelte';

  type Option = { value: V; label: string; icon?: IconName };
  let {
    legend,
    emptyLabel,
    hint,
    groups,
    selected,
    onchange,
  }: {
    /** Names the checklist and starts the field's accessible name ("Topics: …"). */
    legend: string;
    /** Field text when nothing is selected ("Any topic"). */
    emptyLabel: string;
    /** How the choices combine ("Any of the selected topics."). */
    hint: string;
    /** A group without a name has no heading. */
    groups: readonly { name?: string; options: readonly Option[] }[];
    selected: readonly V[];
    onchange(next: V[]): void;
  } = $props();

  const uid = $props.id();
  const fieldContext = getContext<(() => boolean) | undefined>(FIELD_CONTEXT);
  const asField = $derived(fieldContext?.() ?? false);
  let open = $state(false);
  let list: HTMLFieldSetElement | undefined = $state();

  const options = $derived(groups.flatMap((g) => g.options));
  const chosen = $derived(options.filter((o) => selected.includes(o.value)));

  function toggle(v: V, on: boolean) {
    onchange(options.map((o) => o.value).filter((x) => (x === v ? on : selected.includes(x))));
  }

  /** The Clear button disappears: keep focus in the list. */
  async function clear() {
    onchange([]);
    await tick();
    list?.querySelector('input')?.focus();
  }
</script>

{#snippet rows(opts: readonly Option[])}
  {#each opts as o (o.value)}
    <label class="option">
      <input
        type="checkbox"
        checked={selected.includes(o.value)}
        onchange={(e) => toggle(o.value, e.currentTarget.checked)}
      />
      {#if o.icon}<Icon name={o.icon} size={14} />{/if}
      <span>{o.label}</span>
    </label>
  {/each}
{/snippet}

<div class="multi-select">
  {#if asField}
    <button
      type="button"
      class="input field"
      class:empty={!chosen.length}
      aria-expanded={open}
      aria-controls="{uid}-list"
      onclick={() => (open = !open)}
    >
      <span class="visually-hidden">{legend}: </span>
      <span class="labels"
        >{chosen.length
          ? chosen
              .slice(0, 2)
              .map((o) => o.label)
              .join(', ')
          : emptyLabel}</span
      >
      {#if chosen.length > 2}
        <span class="more tabular"
          >+{chosen.length - 2}<span class="visually-hidden"> more</span></span
        >
      {/if}
      <Icon name="chevron" size={14} />
    </button>
  {/if}
  <fieldset
    id="{uid}-list"
    class="checklist"
    class:under={asField}
    hidden={asField && !open}
    aria-describedby="{uid}-hint"
    bind:this={list}
  >
    <legend class="visually-hidden">{legend}</legend>
    <div class="head">
      <p class="hint" id="{uid}-hint">{hint}</p>
      {#if chosen.length}
        <button class="clear" type="button" onclick={clear}>
          Clear<span class="visually-hidden"> {legend}</span>
        </button>
      {/if}
    </div>
    {#each groups as g, i (g.name ?? i)}
      {#if g.name}
        <fieldset class="group">
          <legend class="group-name">{g.name}</legend>
          {@render rows(g.options)}
        </fieldset>
      {:else}
        {@render rows(g.options)}
      {/if}
    {/each}
  </fieldset>
</div>

<style>
  .field {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    text-align: left;
    cursor: pointer;
  }

  .labels {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .field.empty .labels,
  .more {
    color: var(--ink-muted);
  }

  .more {
    flex: none;
  }

  .field :global(.icon) {
    flex: none;
    margin-left: auto;
    color: var(--ink-muted);
    transform: rotate(90deg);
    transition: transform var(--duration-fast) var(--ease-out);
  }

  .field[aria-expanded='true'] :global(.icon) {
    transform: rotate(-90deg);
  }

  .checklist {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .checklist.under {
    padding: var(--space-3) var(--space-1) 0;
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: 20px;
    margin-bottom: var(--space-1);
  }

  .hint {
    color: var(--ink-muted);
    font-size: var(--text-xs);
  }

  /* Same as StepSlider's Clear. */
  .clear {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
  }

  .clear:hover {
    text-decoration: underline;
  }

  .group {
    min-width: 0;
    margin: var(--space-2) 0 0;
    padding: 0;
    border: 0;
  }

  .group-name {
    padding: 0;
    margin-bottom: 2px;
    color: var(--ink-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
  }

  .option {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 32px;
    margin: 0 calc(-1 * var(--space-2));
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-out);
  }

  .option:hover {
    background: var(--glass-tint-hover);
  }

  .option input {
    flex: none;
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--accent);
  }

  .option :global(.icon) {
    flex: none;
    color: var(--ink-muted);
  }

  @media (pointer: coarse) {
    .option {
      min-height: 40px;
    }
  }
</style>
