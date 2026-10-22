<script lang="ts">
  let { tagline = true }: { tagline?: boolean } = $props();
</script>

<div class="brand">
  <h1>
    <svg class="mark" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="6" cy="11" r="4.5" fill="var(--pin-official)" />
      <circle
        cx="13"
        cy="5.5"
        r="2.75"
        fill="none"
        stroke="var(--pin-official)"
        stroke-width="1.75"
      />
    </svg>
    confmaps
  </h1>
  {#if tagline}
    <p class="tagline">AI conferences and their satellites. Attend closer, fly less.</p>
  {/if}
</div>

<style>
  h1 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
    letter-spacing: -0.015em;
    line-height: 1;
  }

  .mark {
    flex: none;
  }

  .tagline {
    margin-top: 6px;
    color: var(--ink-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-tight);
  }
</style>
