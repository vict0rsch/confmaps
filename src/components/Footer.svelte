<script lang="ts" module>
  // These documents are rendered in-app (DocDialog) from the repo's markdown files.
  export const METHODOLOGY_URL = '#methodology';
  export const PRIVACY_URL = '#privacy';
  export const CREDITS_URL = '#credits';
</script>

<script lang="ts">
  let credits = $state(false);
  const uid = $props.id();
</script>

<footer class="footer">
  <p class="links">
    <a href={METHODOLOGY_URL}>Methodology</a>
    <span aria-hidden="true">·</span>
    <a href={PRIVACY_URL}>Privacy</a>
    <span aria-hidden="true">·</span>
    <button
      class="credits-toggle"
      type="button"
      aria-expanded={credits}
      aria-controls="{uid}-credits"
      onclick={() => (credits = !credits)}
    >
      Data &amp; credits
    </button>
  </p>
  <p id="{uid}-credits" class="credits" hidden={!credits}>
    Data:
    <a href="https://github.com/huggingface/ai-deadlines" target="_blank" rel="noopener noreferrer"
      >huggingface/ai-deadlines</a
    >
    (MIT); past editions from
    <a
      href="https://github.com/paperswithcode/ai-deadlines"
      target="_blank"
      rel="noopener noreferrer">paperswithcode/ai-deadlines</a
    >
    (MIT). Map:
    <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>
    ©
    <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer"
      >OpenStreetMap contributors</a
    >. Cities:
    <a href="https://www.geonames.org" target="_blank" rel="noopener noreferrer">GeoNames</a>
    (<a
      href="https://creativecommons.org/licenses/by/4.0/"
      target="_blank"
      rel="noopener noreferrer">CC BY 4.0</a
    >; modified: filtered, rounded, see <a href={CREDITS_URL}>notices</a>). Geocoding:
    <a href="https://nominatim.org" target="_blank" rel="noopener noreferrer">Nominatim</a>
    / OSM (<a
      href="https://opendatacommons.org/licenses/odbl/"
      target="_blank"
      rel="noopener noreferrer">ODbL</a
    >). Emissions factors: UK
    <a
      href="https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2026"
      target="_blank"
      rel="noopener noreferrer">DESNZ GHG conversion factors 2026</a
    >
    (<a
      href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/"
      target="_blank"
      rel="noopener noreferrer">OGL v3.0</a
    >). Full licences: <a href={CREDITS_URL}>third-party notices</a>.
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
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
  }

  .credits-toggle {
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink-muted);
    font: inherit;
    text-decoration: underline;
    text-decoration-color: var(--border-strong);
  }

  .credits-toggle:hover,
  .credits-toggle[aria-expanded='true'] {
    color: var(--ink);
  }

  .credits[hidden] {
    display: none;
  }
</style>
