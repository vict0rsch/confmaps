<script lang="ts">
  // The map's pin encoding in miniature (legend, list, detail): main venue = filled, satellite =
  // ring, official satellite = ring with a centre dot; indigo = official, orange = community;
  // authors only = dot badge.
  let {
    official,
    main,
    locked = false,
  }: { official: boolean; main: boolean; locked?: boolean } = $props();
</script>

<span
  class="marker"
  class:official
  class:main
  class:satellite={!main}
  class:locked
  aria-hidden="true"
></span>

<style>
  .marker {
    position: relative;
    flex: none;
    display: inline-block;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--surface);
    color: var(--pin-community);
  }
  .official {
    color: var(--pin-official);
  }
  .main {
    background: currentColor;
  }
  .satellite {
    background: var(--surface);
    border: 2px solid;
  }
  .satellite.official::before {
    content: '';
    position: absolute;
    inset: 2px;
    border-radius: 50%;
    background: currentColor;
  }
  /* The badge sits on the upper-right edge, sized and placed like the map's (icons.ts,
     lockLayout): it clears the centre dot and stays off the text. Offsets count from inside the
     ring's border. */
  .locked::after {
    content: '';
    position: absolute;
    top: -4px;
    right: -4px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ink);
    box-shadow: 0 0 0 1px var(--surface);
  }
  .main.locked::after {
    top: -3px;
    right: -3px;
  }
</style>
