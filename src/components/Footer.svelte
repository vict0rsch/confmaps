<script lang="ts" module>
  // Placeholders until METHODOLOGY / PRIVACY pages are published (finalized in a later phase).
  export const METHODOLOGY_URL = '#methodology';
  export const PRIVACY_URL = '#privacy';
</script>

<footer class="footer">
  <p>
    Conference data:
    <a href="https://github.com/huggingface/ai-deadlines" target="_blank" rel="noopener noreferrer"
      >huggingface/ai-deadlines</a
    >
    (MIT). Map:
    <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>
    ©
    <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer"
      >OpenStreetMap</a
    >
    contributors. Cities:
    <a href="https://www.geonames.org" target="_blank" rel="noopener noreferrer">GeoNames</a>
    (CC BY 4.0).
  </p>
  <p class="links">
    <a href={METHODOLOGY_URL}>Methodology</a>
    <span aria-hidden="true">·</span>
    <a href={PRIVACY_URL}>Privacy</a>
  </p>
</footer>

<style>
  .footer {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    color: var(--ink-muted);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
  }

  .footer a {
    color: var(--ink-muted);
    text-decoration: underline;
    text-decoration-color: var(--border-strong);
  }

  .footer a:hover {
    color: var(--ink);
  }

  .links {
    display: flex;
    gap: var(--space-2);
  }
</style>
