<script lang="ts">
  // Distance and estimated footprint for one site of the open conference (DESIGN §5, §6.7).
  // Rendered by Detail through its `siteFootprint` snippet, only when a home is set.
  import { track } from '../lib/analytics';
  import { formatCo2, formatDistance, modeIcon } from '../lib/co2/format';
  import type { TravelMode } from '../lib/co2/model';
  import type { JoinedLocation } from '../lib/data/load';
  import { comparisonLine, nearestSite, safeTrip } from '../lib/home/footprint';
  import { myclimateUrl } from '../lib/home/myclimate';
  import { tripOverrides } from '../lib/home/overrides.svelte';
  import { app } from '../lib/state/app.svelte';
  import { travel } from '../lib/state/travel.svelte';
  import Segmented from './filters/Segmented.svelte';
  import { METHODOLOGY_URL } from './Footer.svelte';
  import Icon from './Icon.svelte';

  let { site }: { site: JoinedLocation } = $props();

  const sites = $derived(app.data.locationsByConference.get(site.conferenceId) ?? [site]);
  const settings = $derived({ mode: travel.mode, thresholdKm: travel.threshold });

  const estimate = (s: JoinedLocation, override?: TravelMode) =>
    app.home ? safeTrip(app.home, s, { ...settings, override }) : undefined;

  const autoMode = $derived(estimate(site)?.mode);
  const trip = $derived(estimate(site, tripOverrides.get(site.id)));
  const isNearest = $derived(
    sites.length > 1 && !!app.home && nearestSite(app.home, sites)?.id === site.id,
  );
  const isFirst = $derived(sites[0]?.id === site.id);

  /** "Paris: roughly 54× less than flying to Sydney", on the nearest site when it is a satellite. */
  const comparison = $derived.by(() => {
    const main = sites.find((s) => s.role === 'main');
    if (!isNearest || site.role !== 'satellite' || !main || !trip) return undefined;
    const mainTrip = estimate(main, tripOverrides.get(main.id));
    return mainTrip ? comparisonLine({ site, trip }, { site: main, trip: mainTrip }) : undefined;
  });

  function setMode(mode: TravelMode) {
    if (mode === autoMode) tripOverrides.delete(site.id);
    else tripOverrides.set(site.id, mode);
  }
</script>

{#if trip}
  <div class="footprint" data-testid="site-footprint">
    <div class="figures">
      <span class="distance tabular">{formatDistance(trip.distanceKm, travel.units)}</span>
      <span class="co2 tabular">
        {formatCo2(trip.kgCO2e)}
        <span aria-hidden="true">{modeIcon(trip.mode)}</span>
        <span class="visually-hidden">{trip.mode === 'rail' ? 'by train' : 'by plane'}</span>
      </span>
      {#if isNearest}<span class="nearest">Nearest</span>{/if}
    </div>
    <p class="caption">Estimated CO₂e, round trip</p>

    <div class="mode-toggle">
      <Segmented
        legend="Travel mode for this trip"
        name="trip-mode-{site.id}"
        options={[
          { value: 'rail', label: '🚆 Train' },
          { value: 'flight', label: '✈️ Flight' },
        ]}
        value={trip.mode}
        onchange={setMode}
      />
    </div>

    {#if comparison}<p class="comparison">{comparison}</p>{/if}

    {#if trip.mode === 'flight'}
      <a
        class="myclimate"
        href={myclimateUrl()}
        target="_blank"
        rel="noopener noreferrer"
        onclick={() => track('myclimate_clicked')}
      >
        Cross-check this flight on myclimate <Icon name="external" size={12} />
      </a>
      <p class="note">
        Different methods give different figures — same order of magnitude is expected.
      </p>
    {/if}

    {#if isFirst}
      <a class="how" href={METHODOLOGY_URL}>How is this estimated?</a>
    {/if}
  </div>
{/if}

<style>
  .footprint {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-top: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px dashed var(--border-strong);
  }

  .figures {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-3);
  }

  .distance {
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }

  .co2 {
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
  }

  .nearest {
    margin-left: auto;
    padding: 1px 8px;
    border-radius: var(--radius-full);
    background: var(--accent-soft);
    color: var(--accent);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent);
  }

  .caption,
  .note {
    color: var(--ink-muted);
    font-size: var(--text-xs);
  }

  .mode-toggle {
    margin-top: var(--space-1);
  }

  .comparison {
    margin-top: var(--space-1);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
  }

  .myclimate {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: 4px;
    margin-top: var(--space-1);
    font-size: var(--text-sm);
  }

  .how {
    align-self: flex-start;
    margin-top: var(--space-1);
    color: var(--ink-muted);
    font-size: var(--text-xs);
    text-decoration: underline;
    text-decoration-color: var(--border-strong);
  }
</style>
