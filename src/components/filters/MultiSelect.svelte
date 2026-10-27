<script module lang="ts">
  /** Set by FilterPanel: a getter, true where a multi-select shows as a field (the phone layout). */
  export const FIELD_CONTEXT = Symbol('multi-select field');
</script>

<script lang="ts" generics="V extends string">
  // Multi-select (DESIGN §5.3): native checkboxes in a fieldset (keyboard: Tab + Space), with
  // optional group headings. In a desktop tray it is the checklist itself; in the phone layout it
  // is a field that shows the choice and opens the checklist in a dropdown under it: a small modal
  // dialog over the filters panel, like Share over the logo panel.
  import { getContext, tick } from 'svelte';
  import { lightDismiss } from '../../lib/dialog';
  import Icon, { type IconName } from '../Icon.svelte';

  type Option = { value: V; label: string; icon?: IconName };
  let {
    legend,
    emptyLabel,
    hint,
    groups,
    selected,
    onchange,
    onclear,
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
    /** Clear: by default, `onchange([])`. */
    onclear?: () => void;
  } = $props();

  const uid = $props.id();
  const fieldContext = getContext<(() => boolean) | undefined>(FIELD_CONTEXT);
  const asField = $derived(fieldContext?.() ?? false);
  let open = $state(false);
  let list: HTMLFieldSetElement | undefined = $state();
  let field: HTMLButtonElement | undefined = $state();
  let dropdown: HTMLDialogElement | undefined = $state();
  let place = $state({ up: false, top: 0, bottom: 0, left: 0, width: 0, max: 0 });

  const OFFSET = 4; // between the field and the dropdown
  const INSET = 8; // the dropdown stays this far inside the filters panel
  const MIN = 200; // with less room on both sides, the panel first scrolls the field to its top

  const options = $derived(groups.flatMap((g) => g.options));
  const chosen = $derived(options.filter((o) => selected.includes(o.value)));

  function toggle(v: V, on: boolean) {
    onchange(options.map((o) => o.value).filter((x) => (x === v ? on : selected.includes(x))));
  }

  /** The Clear button disappears: keep focus in the list. */
  async function clear() {
    if (onclear) onclear();
    else onchange([]);
    await tick();
    list?.querySelector('input')?.focus();
  }

  /** Room below and above the field, inside the filters panel (the dialog around the field). */
  function measure() {
    const panel = field!.closest('dialog')!.getBoundingClientRect();
    const r = field!.getBoundingClientRect();
    return {
      r,
      below: panel.bottom - INSET - r.bottom - OFFSET,
      above: r.top - OFFSET - panel.top - INSET,
    };
  }

  /** Under the field, or above it when there is little room below and more above (DESIGN §5.3). */
  async function show() {
    let m = measure();
    if (Math.max(m.below, m.above) < MIN) {
      field!.scrollIntoView({ block: 'start' });
      m = measure();
    }
    const up = m.below < MIN && m.above > m.below;
    place = {
      up,
      left: m.r.left,
      width: m.r.width,
      top: m.r.bottom + OFFSET,
      bottom: innerHeight - m.r.top + OFFSET,
      max: up ? m.above : m.below,
    };
    await tick(); // the new place first: focus would scroll a list sized by the last one
    dropdown!.showModal();
    open = true;
    dropdown!.querySelector('input')?.focus(); // a checkbox: no keyboard opens
  }
</script>

<svelte:window onresize={() => open && dropdown?.close()} />

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

{#snippet checklist()}
  <fieldset class="checklist" aria-describedby="{uid}-hint" bind:this={list}>
    <legend class="visually-hidden">{legend}</legend>
    <div class="head">
      <p class="hint" id="{uid}-hint">{hint}</p>
      {#if selected.length}
        <button class="clear" type="button" onclick={clear}>
          Clear<span class="visually-hidden"> {legend}</span>
        </button>
      {/if}
      {#if asField}
        <button class="done" type="button" onclick={() => dropdown?.close()}>Done</button>
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
{/snippet}

<div class="multi-select">
  {#if asField}
    <button
      bind:this={field}
      type="button"
      class="input field"
      class:empty={!chosen.length}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls="{uid}-dropdown"
      onclick={show}
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
    <dialog
      id="{uid}-dropdown"
      class="dropdown glass-thick"
      aria-label={legend}
      bind:this={dropdown}
      {@attach lightDismiss}
      style:--drop-left="{place.left}px"
      style:--drop-width="{place.width}px"
      style:--drop-max="{place.max}px"
      style:--drop-top={place.up ? undefined : `${place.top}px`}
      style:--drop-bottom={place.up ? `${place.bottom}px` : undefined}
      onclose={() => {
        open = false;
        field?.focus();
      }}
    >
      {@render checklist()}
    </dialog>
  {:else}
    {@render checklist()}
  {/if}
</div>

<style>
  .field {
    scroll-margin-top: var(--space-2);
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

  .dropdown {
    position: fixed;
    inset: var(--drop-top, auto) auto var(--drop-bottom, auto) var(--drop-left);
    width: var(--drop-width);
    max-width: none;
    max-height: var(--drop-max);
    margin: 0;
    padding: 0 var(--space-4) var(--space-3);
    overflow-y: auto;
    overscroll-behavior: contain;
    border-radius: var(--radius-card);
    color: var(--ink);
  }

  .dropdown[open] {
    animation: panel-in var(--duration-base) var(--ease-out); /* global keyframes in base.css */
  }

  .dropdown::backdrop {
    background: transparent;
  }

  /* The sticky head inherits the dropdown's fill through the fieldset. */
  .dropdown > .checklist {
    background: inherit;
  }

  /* Hint, Clear and Done stay put while the list scrolls. */
  .dropdown .head {
    position: sticky;
    top: 0;
    z-index: 1;
    align-items: center;
    margin: 0;
    padding: var(--space-3) 0 var(--space-2);
    background: inherit; /* the dropdown's opaque fill, in every transparency mode */
  }

  .dropdown .hint {
    flex: 1;
  }

  .dropdown .group:first-of-type {
    margin-top: 0;
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

  .done {
    height: 32px;
    margin-right: calc(-1 * var(--space-2));
    padding: 0 var(--space-3);
    border: 0;
    border-radius: var(--radius-full);
    background: none;
    color: var(--accent);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
  }

  .done:hover {
    background: var(--glass-tint-hover);
  }

  @media (pointer: coarse) {
    .clear {
      padding: 8px;
      margin: -8px;
    }
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
