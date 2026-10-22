<script lang="ts">
  import SiteMarker from './SiteMarker.svelte';
</script>

<ul class="legend" role="list" aria-label="Map legend">
  <li><SiteMarker official main={false} /> Official</li>
  <li><SiteMarker official={false} main={false} /> Community</li>
  <li><SiteMarker official main /> Main venue</li>
  <li><SiteMarker official main={false} locked /> Authors only</li>
</ul>

<style>
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    color: var(--ink-muted);
    font-size: var(--text-xs);
  }

  li {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
</style>
