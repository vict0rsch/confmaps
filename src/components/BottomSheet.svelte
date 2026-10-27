<script lang="ts" module>
  export type Snap = 'peek' | 'half' | 'full';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { on } from 'svelte/events';

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
  // A finger pressed on the content at its top, at half or full, until its first move decides if
  // it pulls the sheet down (`ontouchmove`).
  let pull: PointerEvent | null = null;

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

  // The heading under the grip (`data-sheet-handle`) drags the sheet too, and at peek the whole
  // content does, for the first finger only. Any other press only starts a new tap, or a pull.
  function oncontentdown(e: PointerEvent) {
    const handle = e.target instanceof Element && e.target.closest('[data-sheet-handle]');
    if (e.isPrimary && (snap === 'peek' || handle)) onpointerdown(e);
    else if (!drag) {
      moved = false;
      pull = e.pointerType === 'touch' && e.isPrimary && contentEl!.scrollTop <= 0 ? e : null;
    }
  }

  // Only a `touchmove` can keep the content from scrolling. A pull's first move away from the
  // press decides: mostly downwards, the sheet follows the finger, moved by the pointer events as
  // from the grip; upwards or sideways, the content scrolls. A move that is not cancelable is
  // already a scroll. A second finger cancels the pull.
  function ontouchmove(e: TouchEvent) {
    if (e.touches.length > 1) pull = null;
    if (pull && !drag) {
      // One finger on the screen: the one that pressed.
      const { clientX, clientY } = e.touches[0];
      const dx = clientX - pull.clientX;
      const dy = clientY - pull.clientY;
      if (Math.hypot(dx, dy) <= 4) return;
      if (dy > Math.abs(dx) && e.cancelable) {
        onpointerdown(pull);
        // Its pointermove came before the drag started: apply this move here, or a pull of one
        // single move is lost. An accepted pull has moved.
        onpointermove({ pointerId: pull.pointerId, clientY, timeStamp: e.timeStamp });
        moved = true;
      }
      pull = null;
    }
    // Once the sheet has moved, the content never scrolls. Before, a wobble must stay a tap.
    if (drag && moved) e.preventDefault();
  }

  // Move and release are followed on the window: a mouse that leaves the sheet still ends the drag.
  function onpointermove(e: Pick<PointerEvent, 'pointerId' | 'clientY' | 'timeStamp'>) {
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
    if (e.pointerId === pull?.pointerId) pull = null; // ended, or cancelled by a scroll
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
      {@attach (el) => on(el, 'touchmove', ontouchmove, { passive: false })}
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

  /* The heading drags the sheet: a finger on it never scrolls the content. */
  .content :global([data-sheet-handle]) {
    touch-action: none;
  }
</style>
