<script lang="ts" generics="V extends string">
  // Multi-select chips: native checkboxes (keyboard: Tab + Space), selected = filled + check mark.
  import Icon, { type IconName } from '../Icon.svelte';

  type Option = { value: V; label: string; icon?: IconName };
  let {
    legend,
    options,
    selected,
    onchange,
    disabled = false,
  }: {
    legend: string;
    options: readonly Option[];
    selected: readonly V[];
    onchange(next: V[]): void;
    disabled?: boolean;
  } = $props();

  function toggle(v: V, on: boolean) {
    const has = (x: V) => (x === v ? on : selected.includes(x));
    onchange(options.map((o) => o.value).filter(has));
  }
</script>

<fieldset class="chips" {disabled}>
  <legend class="visually-hidden">{legend}</legend>
  {#each options as o (o.value)}
    {@const on = selected.includes(o.value)}
    <label class="chip" class:on>
      <input
        class="visually-hidden"
        type="checkbox"
        checked={on}
        onchange={(e) => toggle(o.value, e.currentTarget.checked)}
      />
      {#if on}
        <Icon name="check" size={12} />
      {:else if o.icon}
        <Icon name={o.icon} size={12} />
      {/if}
      <span>{o.label}</span>
    </label>
  {/each}
</fieldset>

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-full);
    background: var(--surface);
    color: var(--ink-muted);
    font-size: var(--text-sm);
    line-height: 1;
    cursor: pointer;
    user-select: none;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      border-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .chip:hover {
    color: var(--ink);
    background: var(--surface-hover);
  }

  .chip.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: var(--weight-medium);
  }

  .chip:has(input:focus-visible) {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
  }
</style>
