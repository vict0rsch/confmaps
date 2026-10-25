<script lang="ts">
  // The map's pin encoding in miniature (legend, list, detail): official = filled,
  // community = ring, main venue = larger, authors only = dot badge.
  let {
    official,
    main,
    locked = false,
  }: { official: boolean; main: boolean; locked?: boolean } = $props();
</script>

<span
  class="marker"
  class:official
  class:community={!official}
  class:main
  class:locked
  aria-hidden="true"
></span>

<style>
  .marker {
    position: relative;
    flex: none;
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--surface);
  }
  .main {
    width: 12px;
    height: 12px;
  }
  .official {
    background: var(--pin-official);
  }
  .community {
    background: var(--surface);
    border: 2px solid var(--pin-community);
  }
  .main.community {
    border-width: 2.5px;
  }
  .locked::after {
    content: '';
    position: absolute;
    top: -4px;
    right: -5px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ink);
    box-shadow: 0 0 0 1.5px var(--surface);
  }
</style>
