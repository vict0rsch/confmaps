<script lang="ts">
  // Distance and estimated footprint for one site of the open conference (DESIGN §5, §6.7).
  // Rendered by Detail through its `siteFootprint` snippet, only when a home is set.
  import { track } from '../lib/analytics';
  import { formatCo2, formatDistance, modeIcon } from '../lib/co2/format';
  import type { TravelMode } from '../lib/co2/model';
  import { isPinned, type JoinedLocation, type PinnedJoined } from '../lib/data/load';
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
  /** Nearest and the comparison only consider sites one can travel to. */
  const pinned = $derived(sites.filter(isPinned));
  /** The site as a place to travel to; undefined for a virtual edition (attended online). */
  const pin = $derived(isPinned(site) ? site : undefined);
  const settings = $derived({ mode: travel.mode, thresholdKm: travel.threshold });

  const estimate = (s: PinnedJoined, override?: TravelMode) =>
    app.home ? safeTrip(app.home, s, { ...settings, override }) : undefined;

  const autoMode = $derived(pin && estimate(pin)?.mode);
  const trip = $derived(pin && estimate(pin, tripOverrides.get(pin.id)));
  const isNearest = $derived(
    !!pin && pinned.length > 1 && !!app.home && nearestSite(app.home, pinned)?.id === pin.id,
  );
  const isFirst = $derived(sites[0]?.id === site.id);

  /**
   * "Paris: roughly 54× less than flying to Sydney", on the nearest site when it is a satellite
   * (needs a pinned main venue).
   */
  const comparison = $derived.by(() => {
    const main = pinned.find((s) => s.role === 'main');
    if (!isNearest || !pin || pin.role !== 'satellite' || !main || !trip) return undefined;
    const mainTrip = estimate(main, tripOverrides.get(main.id));
    return mainTrip
      ? comparisonLine({ site: pin, trip }, { site: main, trip: mainTrip })
      : undefined;
  });

  function setMode(mode: TravelMode) {
    if (mode === autoMode) tripOverrides.delete(site.id);
    else tripOverrides.set(site.id, mode);
  }
</script>

{#if !pin}
  <div class="footprint" data-testid="site-footprint">
    <div class="figures">
      <span class="co2 tabular">
        Online · {formatCo2(0)}<span class="visually-hidden">, estimated</span>
      </span>
    </div>
    <p class="caption">Attending online: no travel</p>
    {#if isFirst}
      <div class="footnote">
        <a class="how" href={METHODOLOGY_URL}>How is this estimated?</a>
      </div>
    {/if}
  </div>
{:else if trip}
  <div class="footprint" data-testid="site-footprint">
    <div class="figures">
      <span class="co2 tabular">
        {formatCo2(trip.kgCO2e)}
        <span aria-hidden="true">{modeIcon(trip.mode)}</span>
        <span class="visually-hidden">{trip.mode === 'rail' ? 'by train' : 'by plane'}</span>
      </span>
      <span class="distance tabular">{formatDistance(trip.distanceKm, travel.units)}</span>
      {#if isNearest}<span class="nearest">Nearest</span>{/if}
    </div>
    <p class="caption">
      Estimated CO₂e, round trip{trip.mode === 'flight' ? ', nonstop flights' : ''}
    </p>
    {#if pin.format === 'hybrid'}<p class="also">Also online ({formatCo2(0)})</p>{/if}

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

    <!-- Method notes: one small footnote block, below the figures they qualify. -->
    {#if trip.mode === 'flight' || isFirst}
      <div class="footnote">
        {#if trip.mode === 'flight'}
          <a
            href={myclimateUrl()}
            target="_blank"
            rel="noopener noreferrer"
            onclick={() => track('myclimate_clicked')}
          >
            Cross-check this flight on myclimate <Icon name="external" size={11} />
          </a>
          <p>Different methods give different figures — same order of magnitude is expected.</p>
        {/if}
        {#if isFirst}
          <a class="how" href={METHODOLOGY_URL}>How is this estimated?</a>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .footprint {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--hairline);
  }

  .figures {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
  }

  .co2 {
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-tight);
    letter-spacing: -0.01em;
  }

  .distance {
    color: var(--ink);
    font-size: var(--text-md);
    font-weight: var(--weight-medium);
  }

  .nearest {
    align-self: center;
    margin-left: auto;
    padding: 2px 10px;
    border-radius: var(--radius-full);
    background: var(--accent-soft);
    color: var(--accent);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
  }

  .caption {
    color: var(--ink-muted);
    font-size: var(--text-xs);
  }

  .also {
    font-size: var(--text-sm);
  }

  .mode-toggle {
    align-self: flex-start;
    min-width: 200px;
    margin-top: var(--space-2);
  }

  .comparison {
    margin-top: var(--space-2);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
  }

  .footnote {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    margin-top: var(--space-3);
    color: var(--ink-muted);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
  }

  .footnote a {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .how {
    color: var(--ink-muted);
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
  }
</style>
