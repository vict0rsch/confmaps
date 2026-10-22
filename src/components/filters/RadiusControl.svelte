<script lang="ts">
  import { RADIUS_MAX_KM, RADIUS_STOPS, type RadiusState } from '../../lib/filters/radius';
  import type { ControlProps } from '../../lib/filters/types';
  import { kmToMi, miToKm } from '../../lib/geo/distance';
  import NeedsHome from './NeedsHome.svelte';
  import StepSlider from './StepSlider.svelte';

  let { state, set, ctx }: ControlProps<RadiusState> = $props();

  // State is km; the control works in the display unit.
  const mi = $derived(ctx.units === 'mi');
  const toUnit = (km: number) => (mi ? Math.round(kmToMi(km)) : km);
  const toKm = (v: number) => (mi ? Math.round(miToKm(v)) : v);
  const shown = $derived(state === null ? null : toUnit(state));
</script>

<div class="control">
  {#if !ctx.home}<NeedsHome id="filter-radius-hint" />{/if}
  <StepSlider
    id="filter-radius"
    caption={shown === null
      ? 'Any distance'
      : `Within ${shown.toLocaleString('en-US')} ${ctx.units} of your location`}
    inputLabel="Maximum distance in {ctx.units}"
    unit={ctx.units}
    stops={RADIUS_STOPS}
    value={shown}
    defaultStop={1000}
    max={toUnit(RADIUS_MAX_KM)}
    disabled={!ctx.home}
    describedby={ctx.home ? undefined : 'filter-radius-hint'}
    onchange={(v) => set(v === null ? null : Math.min(RADIUS_MAX_KM, Math.max(1, toKm(v))))}
  />
</div>

<style>
  .control {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
</style>
