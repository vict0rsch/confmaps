<script lang="ts" module>
  // Both documents are rendered in-app (DocDialog) from the repo's markdown files.
  export const METHODOLOGY_URL = '#methodology';
  export const PRIVACY_URL = '#privacy';
</script>

<footer class="footer">
  <p>
    Data:
    <a href="https://github.com/huggingface/ai-deadlines" target="_blank" rel="noopener noreferrer"
      >huggingface/ai-deadlines</a
    >
    (MIT). Map:
    <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>
    ©
    <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer"
      >OpenStreetMap contributors</a
    >. Cities:
    <a href="https://www.geonames.org" target="_blank" rel="noopener noreferrer">GeoNames</a>
    (CC BY 4.0). Geocoding:
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
    >).
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
