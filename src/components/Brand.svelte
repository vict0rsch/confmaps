<script lang="ts">
  // `heading={false}` inside a button, where a heading is not allowed.
  let { heading = true }: { heading?: boolean } = $props();
</script>

<svelte:element this={heading ? 'h1' : 'span'} class="brand">
  <svg class="mark" width="20" height="20" viewBox="0 0 18 18" aria-hidden="true">
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
</svelte:element>

<style>
  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 1.0625rem;
    font-weight: var(--weight-semibold);
    letter-spacing: -0.02em;
    line-height: 1;
  }

  .mark {
    flex: none;
  }
</style>
