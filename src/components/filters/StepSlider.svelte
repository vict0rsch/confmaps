<script lang="ts">
  // A value picked on stepped stops (range input over stop indexes) or typed exactly (number
  // input). `null` = off; moving the slider or typing a number turns it on, Clear turns it off.
  let {
    id,
    caption,
    inputLabel,
    unit,
    stops,
    value,
    defaultStop,
    max,
    disabled = false,
    describedby,
    onchange,
  }: {
    id: string;
    /** Visible caption describing the current value; also labels the slider. */
    caption: string;
    /** Accessible label of the number input. */
    inputLabel: string;
    unit: string;
    stops: readonly number[];
    value: number | null;
    /** Stop shown while off. */
    defaultStop: number;
    max: number;
    disabled?: boolean;
    describedby?: string;
    onchange(v: number | null): void;
  } = $props();

  const nearest = (v: number) =>
    stops.reduce((best, s, i) => (Math.abs(s - v) < Math.abs(stops[best] - v) ? i : best), 0);

  const index = $derived(nearest(value ?? defaultStop));
  const fmt = (n: number) => n.toLocaleString('en-US');

  function onNumber(e: Event & { currentTarget: HTMLInputElement }) {
    const n = Math.round(Number(e.currentTarget.value));
    if (e.currentTarget.value === '' || !Number.isFinite(n) || n < 1) onchange(null);
    else onchange(Math.min(n, max));
  }
</script>

<div class="step-slider" class:off={value === null}>
  <div class="head">
    <label for="{id}-range" class="caption">{caption}</label>
    {#if value !== null && !disabled}
      <button class="clear" type="button" onclick={() => onchange(null)}>
        Clear<span class="visually-hidden"> {inputLabel}</span>
      </button>
    {/if}
  </div>
  <div class="controls">
    <input
      id="{id}-range"
      class="range"
      type="range"
      min="0"
      max={stops.length - 1}
      step="1"
      value={index}
      style:--pct="{(index / (stops.length - 1)) * 100}%"
      {disabled}
      aria-describedby={describedby}
      aria-valuetext={value === null ? 'Off' : `${fmt(stops[index])} ${unit}`}
      oninput={(e) => onchange(stops[Number(e.currentTarget.value)])}
    />
    <span class="number">
      <label class="visually-hidden" for="{id}-number">{inputLabel}</label>
      <input
        id="{id}-number"
        class="input tabular"
        type="number"
        inputmode="numeric"
        min="1"
        {max}
        step="1"
        placeholder="Any"
        value={value ?? ''}
        {disabled}
        aria-describedby={describedby}
        onchange={onNumber}
      />
      <span class="unit" aria-hidden="true">{unit}</span>
    </span>
  </div>
</div>

<style>
  .step-slider {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: 20px;
  }

  .caption {
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  .off .caption {
    color: var(--ink-muted);
  }

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

  .controls {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  /* Thin track, filled up to the thumb; muted while off, flat while disabled. */
  .range {
    --fill: var(--accent);
    flex: 1;
    min-width: 0;
    height: 20px;
    margin: 0;
    background: transparent;
    appearance: none;
    cursor: pointer;
  }

  .off .range {
    --fill: var(--ink-faint);
  }

  .range:disabled {
    --fill: var(--border-strong);
    cursor: default;
  }

  .range::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: var(--radius-full);
    background: linear-gradient(to right, var(--fill) var(--pct), var(--border-strong) var(--pct));
  }

  .range::-moz-range-track {
    height: 4px;
    border-radius: var(--radius-full);
    background: var(--border-strong);
  }

  .range::-moz-range-progress {
    height: 4px;
    border-radius: var(--radius-full);
    background: var(--fill);
  }

  .range::-webkit-slider-thumb {
    width: 16px;
    height: 16px;
    margin-top: -6px;
    border: 2px solid var(--fill);
    border-radius: var(--radius-full);
    background: var(--surface-raised);
    box-shadow: var(--shadow-sm);
    appearance: none;
  }

  .range::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border: 2px solid var(--fill);
    border-radius: var(--radius-full);
    background: var(--surface-raised);
    box-shadow: var(--shadow-sm);
  }

  .range:focus-visible {
    outline: none;
  }

  .range:focus-visible::-webkit-slider-thumb {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .range:focus-visible::-moz-range-thumb {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .number {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .number .input {
    width: 76px;
    text-align: right;
  }

  .unit {
    min-width: 2ch;
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }
</style>
