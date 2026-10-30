<script lang="ts">
  import { linkFeatures } from '../lib/map/geojson';
  import { app } from '../lib/state/app.svelte';
  import SiteMarker from './SiteMarker.svelte';

  /** The dashed main ↔ satellite line is explained only while the map draws one. */
  const showLink = $derived(linkFeatures(app.mapLocations).features.length > 0);
  const uid = $props.id();
</script>

<ul class="legend" role="list" aria-label="Map legend">
  <li><SiteMarker official main /> Main venue</li>
  <li>
    <span id="{uid}-satellites">Satellites:</span>
    <ul class="group" role="list" aria-labelledby="{uid}-satellites">
      <li><SiteMarker official main={false} /> official</li>
      <li><SiteMarker official={false} main={false} /> community</li>
    </ul>
  </li>
  <li><SiteMarker official main={false} locked /> Authors only</li>
  {#if showLink}
    <li><span class="link" aria-hidden="true"></span> Satellite link</li>
  {/if}
  {#if app.home}
    <li><span class="home" aria-hidden="true"></span> Your city</li>
  {/if}
</ul>

<style>
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    color: var(--ink-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
  }

  li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }

  /* "Satellites:" and its two kinds stay on one line, a little tighter than the legend's items. */
  .group {
    display: inline-flex;
    gap: var(--space-3);
  }

  /* The map's dashed main ↔ satellite line in miniature (style.ts). */
  .link {
    flex: none;
    width: 16px;
    border-top: 1.5px dashed var(--pin-link);
  }

  /* The map's home dot in miniature (style.ts): an 8 px dot in a 2 px halo. */
  .home {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--pin-home);
    box-shadow: 0 0 0 2px var(--pin-halo);
  }
</style>
