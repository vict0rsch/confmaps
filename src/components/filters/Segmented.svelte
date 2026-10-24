<script lang="ts" generics="V extends string">
  // Single choice as a segmented control: native radios (keyboard: arrow keys).
  let {
    legend,
    name,
    options,
    value,
    onchange,
  }: {
    legend: string;
    name: string;
    options: readonly { value: V; label: string }[];
    value: V;
    onchange(v: V): void;
  } = $props();
</script>

<fieldset class="segmented">
  <legend class="visually-hidden">{legend}</legend>
  {#each options as o (o.value)}
    <label>
      <input
        class="visually-hidden"
        type="radio"
        {name}
        value={o.value}
        checked={value === o.value}
        onchange={() => onchange(o.value)}
      />
      <span>{o.label}</span>
    </label>
  {/each}
</fieldset>

<style>
  .segmented {
    display: flex;
    gap: 2px;
    margin: 0;
    padding: 2px;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--glass-tint-press);
  }

  label {
    flex: 1;
    display: grid;
    place-items: center;
    height: 28px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-full);
    color: var(--ink-muted);
    font-size: var(--text-sm);
    white-space: nowrap;
    cursor: pointer;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  label:hover {
    color: var(--ink);
  }

  label:has(input:checked) {
    background: var(--control-fill-hover);
    color: var(--ink);
    font-weight: var(--weight-medium);
    box-shadow:
      var(--shadow-sm),
      0 0 0 0.5px var(--hairline);
  }

  label:has(input:focus-visible) {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
  }
</style>
