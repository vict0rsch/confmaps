<script lang="ts" module>
  export type Snap = 'peek' | 'half' | 'full';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    snap = $bindable('peek'),
    onheightchange,
    label,
    header,
    children,
  }: {
    snap?: Snap;
    /** Settled height of the sheet on screen (px), for map insets. */
    onheightchange?: (height: number) => void;
    label: string;
    header?: Snippet;
    children: Snippet;
  } = $props();

  const PEEK = 176; // grip + docked timeline + list heading and a row
  const ORDER: Snap[] = ['peek', 'half', 'full'];

  let containerHeight = $state(0);
  let gripHeight = $state(0);
  let drag: { startY: number; startH: number; lastY: number; lastT: number; v: number } | null =
    $state(null);
  let dragHeight = $state(0);
  let moved = false;

  const heightOf = (s: Snap) =>
    s === 'peek' ? PEEK : s === 'half' ? Math.round(containerHeight * 0.5) : containerHeight;
  const height = $derived(drag ? dragHeight : heightOf(snap));

  $effect(() => {
    onheightchange?.(drag ? heightOf(snap) : height);
  });

  function onpointerdown(e: PointerEvent) {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    moved = false;
    drag = { startY: e.clientY, startH: height, lastY: e.clientY, lastT: e.timeStamp, v: 0 };
    dragHeight = height;
  }

  function onpointermove(e: PointerEvent) {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dy) > 4) moved = true;
    const dt = Math.max(1, e.timeStamp - drag.lastT);
    drag.v = (e.clientY - drag.lastY) / dt; // px/ms, positive = downwards
    drag.lastY = e.clientY;
    drag.lastT = e.timeStamp;
    dragHeight = Math.max(PEEK * 0.6, Math.min(containerHeight, drag.startH - dy));
  }

  function onpointerup() {
    if (!drag) return;
    const { v } = drag;
    drag = null;
    if (!moved) return;
    const current = dragHeight;
    let target = ORDER.reduce((best, s) =>
      Math.abs(heightOf(s) - current) < Math.abs(heightOf(best) - current) ? s : best,
    );
    // A flick moves one step in its direction.
    if (Math.abs(v) > 0.5) {
      const above = ORDER.filter((s) => heightOf(s) > current);
      const below = ORDER.filter((s) => heightOf(s) < current);
      target = v < 0 ? (above[0] ?? 'full') : (below.at(-1) ?? 'peek');
    }
    snap = target;
  }

  function cycle() {
    if (moved) return;
    snap = snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'peek';
  }
</script>

<div class="sheet-area" bind:clientHeight={containerHeight}>
  <section
    class="sheet"
    class:dragging={!!drag}
    aria-label={label}
    style:transform="translateY({containerHeight - height}px)"
  >
    <div
      class="grip-zone"
      role="presentation"
      bind:clientHeight={gripHeight}
      {onpointerdown}
      {onpointermove}
      {onpointerup}
      onpointercancel={onpointerup}
    >
      <button
        class="grip"
        type="button"
        aria-label={snap === 'full' ? 'Collapse panel' : 'Expand panel'}
        onclick={cycle}
      >
        <span aria-hidden="true"></span>
      </button>
      {@render header?.()}
    </div>
    <div
      data-scroll
      class="content"
      class:locked={snap === 'peek' && !drag}
      style:height="{Math.max(0, height - gripHeight)}px"
    >
      {@render children()}
    </div>
  </section>
</div>

<style>
  .sheet-area {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  }

  .sheet {
    position: absolute;
    inset: 0 0 auto;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    box-shadow: var(--shadow-lg);
    pointer-events: auto;
    transition: transform var(--duration-slow) var(--ease-out);
    will-change: transform;
  }

  .sheet.dragging {
    transition: none;
  }

  .grip-zone {
    flex: none;
    touch-action: none;
  }

  .grip {
    display: grid;
    place-items: center;
    width: 100%;
    height: 22px;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: grab;
  }

  .grip span {
    width: 36px;
    height: 4px;
    border-radius: var(--radius-full);
    background: var(--border-strong);
  }

  .grip:focus-visible {
    outline-offset: -4px;
  }

  .content {
    flex: none;
    max-height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }

  .content.locked {
    overflow: hidden;
  }
</style>
