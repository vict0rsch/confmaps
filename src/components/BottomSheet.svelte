<script lang="ts" module>
  export type Snap = 'peek' | 'half' | 'full';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    snap = $bindable('peek'),
    onheightchange,
    label,
    children,
  }: {
    snap?: Snap;
    /** Settled height of the sheet on screen (px), for map insets. */
    onheightchange?: (height: number) => void;
    label: string;
    children: Snippet;
  } = $props();

  const PEEK = 68; // grip (24) + list heading (44), or the detail's title
  const ORDER: Snap[] = ['peek', 'half', 'full'];

  let containerHeight = $state(0);
  let gripHeight = $state(0);
  // env(safe-area-inset-bottom), measured: peek stays clear of the home indicator.
  let safeBottom = $state(0);
  let contentEl: HTMLDivElement | undefined = $state();
  // One gesture at a time, followed by its pointer id (a second finger is ignored).
  let drag: {
    id: number;
    startY: number;
    startH: number;
    lastY: number;
    lastT: number;
    v: number;
  } | null = $state(null);
  let dragHeight = $state(0);
  let moved = false;

  const peek = $derived(PEEK + safeBottom);
  const heightOf = (s: Snap) =>
    s === 'peek' ? peek : s === 'half' ? Math.round(containerHeight * 0.5) : containerHeight;
  const height = $derived(drag ? dragHeight : heightOf(snap));

  $effect(() => {
    onheightchange?.(drag ? heightOf(snap) : height);
  });

  // Peek locks the content: show its top, not wherever it was scrolled (e.g. "View history").
  $effect(() => {
    if (snap === 'peek' && !drag) contentEl?.scrollTo({ top: 0 });
  });

  function onpointerdown(e: PointerEvent) {
    if (e.button !== 0 || drag) return;
    moved = false;
    // Before `drag`: once it is set, `height` reads `dragHeight`.
    dragHeight = height;
    drag = {
      id: e.pointerId,
      startY: e.clientY,
      startH: height,
      lastY: e.clientY,
      lastT: e.timeStamp,
      v: 0,
    };
  }

  // At peek the visible heading drags the sheet too. A press elsewhere only starts a new tap.
  function oncontentdown(e: PointerEvent) {
    if (snap === 'peek') onpointerdown(e);
    else if (!drag) moved = false;
  }

  // Move and release are followed on the window: a mouse that leaves the sheet still ends the drag.
  function onpointermove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dy) > 4) moved = true;
    const dt = Math.max(1, e.timeStamp - drag.lastT);
    drag.v = (e.clientY - drag.lastY) / dt; // px/ms, positive = downwards
    drag.lastY = e.clientY;
    drag.lastT = e.timeStamp;
    dragHeight = Math.max(peek * 0.6, Math.min(containerHeight, drag.startH - dy));
  }

  function onpointerup(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
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

  // A keyboard click (detail 0) always cycles; a click ending a drag does not.
  function cycle(e: MouseEvent) {
    if (moved && e.detail) return;
    snap = snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'peek';
  }
</script>

<svelte:window {onpointermove} {onpointerup} onpointercancel={onpointerup} />

<div class="sheet-area" bind:clientHeight={containerHeight}>
  <div class="safe-probe" aria-hidden="true" bind:clientHeight={safeBottom}></div>
  <section
    class="sheet glass"
    class:dragging={!!drag}
    aria-label={label}
    style:transform="translateY({containerHeight - height}px)"
  >
    <!-- Captured on press, by the button itself: Chromium sends the click to the capturing element,
         and a press during the snap transition (the sheet jumps) still ends on the grip. -->
    <button
      class="grip"
      type="button"
      aria-label={snap === 'full' ? 'Collapse panel' : 'Expand panel'}
      bind:clientHeight={gripHeight}
      onpointerdown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onpointerdown(e);
      }}
      onclick={cycle}
    >
      <span aria-hidden="true"></span>
    </button>
    <!-- A click ending a drag selects nothing. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      data-scroll
      bind:this={contentEl}
      class="content"
      class:locked={snap === 'peek' && !drag}
      style:height="{Math.max(0, height - gripHeight)}px"
      onpointerdown={oncontentdown}
      onclickcapture={(e) => {
        if (moved && e.detail) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
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
    /* Not `hidden`: that is still a scroll container, and the translated sheet overflows it, so
       focus or scroll-into-view inside the sheet (mid-transition) scrolled it, leaving a blank band.
       `clip` can't scroll; only the inner `.content` does. */
    overflow: clip;
  }

  .sheet {
    position: absolute;
    inset: 0 0 auto;
    height: 100%;
    display: flex;
    flex-direction: column;
    /* Surface from .glass (base.css); open at the bottom edge of the screen. */
    border-bottom: 0;
    border-radius: var(--radius-panel) var(--radius-panel) 0 0;
    pointer-events: auto;
    transition: transform var(--duration-slow) var(--ease-out);
    will-change: transform;
  }

  .sheet.dragging {
    transition: none;
  }

  .safe-probe {
    position: absolute;
    width: 0;
    height: env(safe-area-inset-bottom, 0px);
    visibility: hidden;
    pointer-events: none;
  }

  .grip {
    flex: none;
    display: grid;
    place-items: center;
    width: 100%;
    height: 24px;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: grab;
    touch-action: none;
  }

  .grip span {
    width: 36px;
    height: 5px;
    border-radius: var(--radius-full);
    background: var(--ink-faint);
    opacity: 0.55;
  }

  .grip:focus-visible {
    outline-offset: -4px;
  }

  .content {
    flex: none;
    max-height: 100%;
    padding-bottom: env(safe-area-inset-bottom);
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }

  .content.locked {
    overflow: hidden;
    touch-action: none;
  }
</style>
