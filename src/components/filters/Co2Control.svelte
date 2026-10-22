<script lang="ts">
  import { formatCo2 } from '../../lib/co2/format';
  import { CO2_MAX_KG, CO2_STOPS, type Co2State } from '../../lib/filters/co2';
  import type { ControlProps } from '../../lib/filters/types';
  import { kmToMi } from '../../lib/geo/distance';
  import NeedsHome from './NeedsHome.svelte';
  import StepSlider from './StepSlider.svelte';

  let { state, set, ctx }: ControlProps<Co2State> = $props();

  const threshold = $derived(
    `${Math.round(ctx.units === 'mi' ? kmToMi(ctx.threshold) : ctx.threshold).toLocaleString('en-US')} ${ctx.units}`,
  );
</script>

<div class="control">
  {#if !ctx.home}<NeedsHome id="filter-co2-hint" />{/if}
  <StepSlider
    id="filter-co2"
    caption={state === null
      ? 'Any estimated footprint'
      : `Estimated footprint under ${formatCo2(state)}`}
    inputLabel="Maximum estimated footprint in kg CO₂e"
    unit="kg"
    stops={CO2_STOPS}
    value={state}
    defaultStop={300}
    max={CO2_MAX_KG}
    disabled={!ctx.home}
    describedby={ctx.home ? 'filter-co2-method' : 'filter-co2-hint filter-co2-method'}
    onchange={set}
  />
  <p class="method" id="filter-co2-method">
    Rough round-trip estimate from your location, CO₂e per traveller:
    {ctx.mode === 'fly' ? 'always flying' : `rail under ${threshold}, flight beyond`}.
  </p>
</div>

<style>
  .control {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .method {
    color: var(--ink-muted);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
  }
</style>
