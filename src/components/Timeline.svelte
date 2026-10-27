<script lang="ts">
  // Timeline / scrubber (DESIGN §5.4). The window IS the `dates` filter: read and written only
  // through getDates() / setDates(), so the filter panel's month inputs stay in sync.
  // The histogram counts events per month passing every other filter (dates aside), so it shows
  // what moving the window would reveal; recomputed on filter changes only (~130 locations).
  import { app } from '../lib/state/app.svelte';
  import type { DateWindow } from '../lib/state/derive';
  import { getDates, setDates } from '../lib/state/filters.svelte';
  import { historyMode, play, scope } from '../lib/state/timeline.svelte';
  import {
    axisTicks,
    coverDomain,
    dataSpan,
    dayNumber,
    histogram,
    toDay,
    toX,
    type Domain,
  } from '../lib/timeline/scale';
  import {
    axisSpan,
    centerWindow,
    datePresets,
    dayLabel,
    dragHandle,
    moveWindow,
    nudge,
    sameWindow,
    toDomainEdge,
    windowLabel,
    type Part,
  } from '../lib/timeline/window';
  import Icon from './Icon.svelte';

  let { compact = false }: { compact?: boolean } = $props();
  const uid = $props.id();

  const dates = $derived(getDates());
  const inHistory = $derived(!!historyMode.series);

  let trackEl: HTMLDivElement | undefined = $state();
  let width = $state(0);

  // The axis only ever grows (sticky), so it never rescales under a dragged handle or Play. It
  // starts at most 5 years back ("Since <year>" or history mode reach further).
  let extent: Domain | undefined;
  const domain: Domain = $derived.by(
    () =>
      (extent = coverDomain(
        extent,
        axisSpan(scope.span, app.today),
        dates,
        { from: app.today, to: app.today },
        inHistory ? dataSpan(app.visibleLocations) : null,
      )),
  );
  const x = (day: number) => toX(day, domain, width);

  const BARS_H = $derived(compact ? 16 : 22);
  const bins = $derived(histogram(scope.candidates, domain));
  const maxCount = $derived(Math.max(1, ...bins.map((b) => b.count)));
  const gap = $derived(width / Math.max(1, bins.length) > 8 ? 2 : 1);
  // A histogram bar with rounded top corners only (the bottom sits on the baseline).
  function barPath(x0: number, w: number, h: number): string {
    const r = Math.min(2, w / 2, h);
    const y = BARS_H - h;
    return `M${x0},${BARS_H}V${y + r}Q${x0},${y} ${x0 + r},${y}H${x0 + w - r}Q${x0 + w},${y} ${x0 + w},${y + r}V${BARS_H}Z`;
  }
  const ticks = $derived(axisTicks(domain, width));
  const todayX = $derived(x(dayNumber(app.today)));
  // "Today" label owns the axis around it. Year labels start at their tick and run right, so one
  // just before today needs more room.
  const visibleTicks = $derived(
    ticks.filter((t) => {
      const d = x(t.day) - todayX;
      return t.kind === 'year' && d < 0 ? d < -46 : Math.abs(d) > 34;
    }),
  );

  const win = $derived({ x0: x(dayNumber(dates.from)), x1: x(dayNumber(dates.to) + 1) });
  const presets = $derived(datePresets(app.today, scope.span.from));

  // ---- History mode: stops on the axis, progress along them ----------------
  const stopXs = $derived(historyMode.stops.map((s) => x(dayNumber(s.start))));
  const travelled = $derived(play.travelShown ?? Math.max(0, historyMode.stops.length - 1));
  const progressX = $derived.by(() => {
    if (!stopXs.length) return 0;
    const i = Math.min(Math.floor(travelled), stopXs.length - 1);
    const f = travelled - i;
    return stopXs[i] + (i + 1 < stopXs.length ? (stopXs[i + 1] - stopXs[i]) * f : 0);
  });
  const yearsText = $derived.by(() => {
    const ys = historyMode.years;
    if (!ys.length) return '';
    return ys.length === 1 ? String(ys[0]) : `${ys[0]}–${ys[ys.length - 1]}`;
  });
  const editionsText = $derived.by(() => {
    const n = historyMode.years.length;
    if (!n) return 'No editions match the current filters';
    return n === 1 ? `1 edition · ${yearsText}` : `${n} editions · ${yearsText}`;
  });

  const playLabel = $derived(
    play.playing ? 'Pause' : inHistory ? 'Play through the editions' : 'Play timeline',
  );
  const playTitle = $derived(
    play.canPlay
      ? playLabel
      : inHistory
        ? 'Only one edition on record so far'
        : 'The window already covers all events',
  );

  // ---- Pointer: drag a handle, drag the window, or press the bare track --------
  let drag: { part: Part; grab: number } | null = $state(null);

  function dayAt(e: PointerEvent): number {
    const r = trackEl!.getBoundingClientRect();
    return toDay(e.clientX - r.left, domain, r.width);
  }

  function onpointerdown(e: PointerEvent) {
    if (inHistory || e.button !== 0 || !trackEl) return;
    const target = (e.target as Element).closest<HTMLElement>('[data-part]');
    let part = (target?.dataset.part ?? 'track') as Part | 'track';
    play.pause();
    e.preventDefault();
    const day = dayAt(e);
    let w = getDates();
    if (part === 'track') {
      // Press on the bare track: centre the window there, then keep dragging it.
      w = centerWindow(w, day, domain);
      set(w);
      part = 'window';
    }
    (target ?? trackEl.querySelector<HTMLElement>('[data-part="window"]'))?.focus({
      preventScroll: true,
    });
    drag = { part, grab: day - dayNumber(w.from) };
    trackEl.setPointerCapture(e.pointerId);
  }

  function onpointermove(e: PointerEvent) {
    if (!drag) return;
    const day = dayAt(e);
    const w = getDates();
    set(
      drag.part === 'window'
        ? moveWindow(w, day - drag.grab, domain)
        : dragHandle(w, drag.part, day, domain),
    );
  }

  function onpointerup(e: PointerEvent) {
    if (!drag) return;
    drag = null;
    if (trackEl?.hasPointerCapture(e.pointerId)) trackEl.releasePointerCapture(e.pointerId);
  }

  function set(w: DateWindow) {
    if (!sameWindow(w, getDates())) setDates(w);
  }

  // ---- Keyboard: arrows = 1 month, Shift / PageUp / PageDown = 1 year, Home / End ----------
  function onkeydown(e: KeyboardEvent, part: Part) {
    const year = e.shiftKey || e.key === 'PageUp' || e.key === 'PageDown';
    const step = year ? 12 : 1;
    const w = getDates();
    let next: DateWindow;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
      case 'PageDown':
        next = nudge(w, part, -step, domain);
        break;
      case 'ArrowRight':
      case 'ArrowUp':
      case 'PageUp':
        next = nudge(w, part, step, domain);
        break;
      case 'Home':
        next = toDomainEdge(w, part, 'start', domain);
        break;
      case 'End':
        next = toDomainEdge(w, part, 'end', domain);
        break;
      default:
        return;
    }
    e.preventDefault();
    play.pause();
    set(next);
  }

  function applyPreset(w: DateWindow) {
    play.pause();
    set(w);
  }

  const offset = (iso: string) => dayNumber(iso) - domain.start;
  const maxOffset = $derived(domain.end - domain.start - 1);
</script>

<section
  class="timeline"
  class:compact
  class:history={inHistory}
  class:dragging={!!drag}
  aria-label="Timeline"
  data-testid="timeline"
>
  <!-- Speed shows while playing, or while this group is hovered or holds focus (it stays in the
       DOM and in the tab order). -->
  <div class="controls" class:playing={play.playing}>
    <button
      class="play"
      type="button"
      aria-label={playLabel}
      title={playTitle}
      disabled={!play.canPlay}
      onclick={() => play.toggle()}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        {#if play.playing}
          <rect x="3.5" y="3" width="3" height="10" rx="1" fill="currentColor" />
          <rect x="9.5" y="3" width="3" height="10" rx="1" fill="currentColor" />
        {:else}
          <path
            d="M5 3.6v8.8a.6.6 0 0 0 .9.5l7-4.4a.6.6 0 0 0 0-1L5.9 3.1a.6.6 0 0 0-.9.5z"
            fill="currentColor"
          />
        {/if}
      </svg>
    </button>
    {#if !(compact && inHistory)}
      <button
        class="speed tabular"
        type="button"
        aria-label="Playback speed {play.speed}×"
        title="Playback speed"
        onclick={() => play.cycleSpeed()}>{play.speed}×</button
      >
    {/if}
  </div>

  {#if inHistory}
    <div class="history-label">
      <span class="history-title">
        <Icon name="history" size={14} />
        {historyMode.title}{compact ? '' : ' history'}
        <!-- Compact bar: no room; the list marks those editions Virtual. -->
        {#if historyMode.onlineYears.length && !compact}
          <span class="history-online tabular" data-testid="history-online">
            Online: {historyMode.onlineYears.join(' · ')}
          </span>
        {/if}
      </span>
      <span class="history-meta tabular" data-testid="history-meta">
        {compact ? yearsText : editionsText}
      </span>
    </div>
  {/if}

  {#if !(compact && inHistory)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="track"
      bind:this={trackEl}
      bind:clientWidth={width}
      style:--bars-h="{BARS_H}px"
      {onpointerdown}
      {onpointermove}
      {onpointerup}
      onpointercancel={onpointerup}
    >
      {#if width > 0}
        {#if !inHistory}
          <!-- The selection sits under the bars; the bars ignore the pointer, so presses reach it. -->
          <div
            class="window"
            data-part="window"
            style:left="{win.x0}px"
            style:width="{Math.max(2, win.x1 - win.x0)}px"
            role="slider"
            tabindex="0"
            aria-label="Date window"
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={maxOffset}
            aria-valuenow={offset(dates.from)}
            aria-valuetext={windowLabel(dates)}
            onkeydown={(e) => onkeydown(e, 'window')}
          ></div>
        {/if}
        <svg class="bars" {width} height={BARS_H} aria-hidden="true">
          <defs>
            <clipPath id="{uid}-win">
              <rect x={win.x0} y="0" width={Math.max(0, win.x1 - win.x0)} height={BARS_H} />
            </clipPath>
          </defs>
          {#each ticks as t (t.day)}
            {#if t.kind === 'year'}
              <line class="grid" x1={x(t.day)} x2={x(t.day)} y1="0" y2={BARS_H} />
            {/if}
          {/each}
          <line class="baseline" x1="0" x2={width} y1={BARS_H - 0.5} y2={BARS_H - 0.5} />
          {#snippet barsOf(cls: string)}
            <g class={cls}>
              {#each bins as b (b.month)}
                {#if b.count}
                  {@const h = Math.max(2, (b.count / maxCount) * (BARS_H - 2))}
                  <path
                    d={barPath(x(b.start) + gap / 2, Math.max(1, x(b.end) - x(b.start) - gap), h)}
                  />
                {/if}
              {/each}
            </g>
          {/snippet}
          {#if inHistory}
            {@render barsOf('bar-muted')}
          {:else}
            {@render barsOf('bar-muted')}
            <g clip-path="url(#{uid}-win)">{@render barsOf('bar-in')}</g>
          {/if}
        </svg>

        {#if inHistory && stopXs.length}
          <svg class="stops" {width} height={BARS_H} aria-hidden="true">
            <line
              class="stops-line"
              x1={stopXs[0]}
              x2={stopXs[stopXs.length - 1]}
              y1={BARS_H / 2}
              y2={BARS_H / 2}
            />
            <line
              class="stops-progress"
              x1={stopXs[0]}
              x2={progressX}
              y1={BARS_H / 2}
              y2={BARS_H / 2}
            />
            {#each stopXs as sx, i (i)}
              <circle
                class="stop"
                class:reached={i <= Math.floor(travelled + 1e-6)}
                cx={sx}
                cy={BARS_H / 2}
                r="4"
              />
            {/each}
          </svg>
        {/if}

        <div class="today" style:left="{todayX}px" aria-hidden="true"></div>

        {#if !inHistory}
          <div
            class="handle"
            data-part="from"
            style:left="{win.x0}px"
            role="slider"
            tabindex="0"
            aria-label="Window start"
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={offset(dates.to)}
            aria-valuenow={offset(dates.from)}
            aria-valuetext="From {dayLabel(dates.from)}"
            onkeydown={(e) => onkeydown(e, 'from')}
          ></div>
          <div
            class="handle"
            data-part="to"
            style:left="{win.x1}px"
            role="slider"
            tabindex="0"
            aria-label="Window end"
            aria-orientation="horizontal"
            aria-valuemin={offset(dates.from)}
            aria-valuemax={maxOffset}
            aria-valuenow={offset(dates.to)}
            aria-valuetext="To {dayLabel(dates.to)}"
            onkeydown={(e) => onkeydown(e, 'to')}
          ></div>
        {/if}

        <div class="axis" aria-hidden="true">
          {#each visibleTicks as t (t.day)}
            <span class="tick" class:year={t.kind === 'year'} style:left="{x(t.day)}px"
              >{t.label}</span
            >
          {/each}
          <span class="tick today-label" style:left="{todayX}px">Today</span>
        </div>
      {/if}
    </div>
  {/if}

  <div class="aside">
    {#if inHistory}
      <button class="button exit" type="button" onclick={() => historyMode.exit()}>
        <Icon name="close" size={14} />
        {compact ? 'Exit' : 'Exit history'}
      </button>
    {:else}
      {#if !compact}
        <div class="presets" role="group" aria-label="Date presets">
          {#each presets as p (p.id)}
            <button
              type="button"
              class="preset"
              aria-pressed={sameWindow(dates, p.w)}
              onclick={() => applyPreset(p.w)}
              ><span class="full">{p.label}</span><span class="short" aria-hidden="true"
                >{p.short}</span
              ></button
            >
          {/each}
        </div>
      {/if}
      <span class="range tabular" data-testid="timeline-range">{windowLabel(dates, compact)}</span>
    {/if}
  </div>
</section>

<style>
  .timeline {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    height: 100%;
    /* Transparent: the container (glass panel / sheet) owns the surface. The round Play button
       sits about as far from the left edge as from the top. */
    padding: 0 var(--space-4) 0 10px;
    font-size: var(--text-sm);
    user-select: none;
    -webkit-user-select: none;
    /* The desktop panel can be narrow (608 px at a 1024 px window): see the query below. */
    container: timeline / inline-size;
  }

  .compact {
    gap: var(--space-2);
    padding: 0 var(--space-2) 0 6px;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
  }

  .play {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--accent);
    color: var(--accent-ink);
    box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 35%, transparent);
    transition:
      filter var(--duration-fast) var(--ease-out),
      transform var(--duration-press) var(--ease-out),
      opacity var(--duration-fast) var(--ease-out);
  }

  .compact .play {
    width: 32px;
    height: 32px;
  }

  .play:active:not(:disabled) {
    transform: scale(0.94);
  }

  .play svg {
    /* The play triangle's optical centre sits right of its box centre. */
    transform: translateX(0.5px);
  }

  .play:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .play:disabled {
    background: var(--control-fill);
    color: var(--ink-faint);
    box-shadow: none;
    cursor: default;
  }

  /* Hidden at rest but keeps its slot (no layout shift under the track) and stays focusable:
     opacity only, never display/visibility. Hover or focus in the group, or Play, reveals it. */
  .speed {
    min-width: 36px;
    height: 26px;
    padding: 0 6px;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-full);
    background: var(--control-fill);
    color: var(--ink-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    opacity: 0;
    pointer-events: none;
    transition:
      opacity var(--duration-base) var(--ease-out),
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .controls:hover .speed,
  .controls:focus-within .speed,
  .controls.playing .speed {
    opacity: 1;
    pointer-events: auto;
  }

  .compact .speed {
    min-width: 32px;
    padding: 0 4px;
  }

  /* Compact bar: too narrow for an empty slot, so the hidden button collapses (still focusable). */
  .compact .controls:not(.playing, :hover, :focus-within) .speed {
    width: 0;
    min-width: 0;
    margin-left: -6px;
    padding: 0;
    border-width: 0;
  }

  .speed:hover {
    background: var(--control-fill-hover);
    color: var(--ink);
  }

  /* ---- Track ---- */
  .track {
    position: relative;
    flex: 1;
    min-width: 0;
    height: calc(var(--bars-h) + 18px);
    touch-action: none;
    cursor: pointer;
  }

  .compact .track {
    height: calc(var(--bars-h) + 15px);
  }

  .history .track {
    cursor: default;
  }

  .bars,
  .stops {
    position: absolute;
    top: 2px;
    left: 0;
    overflow: visible;
    /* Presses go through to the selection or the bare track below. */
    pointer-events: none;
  }

  .grid {
    stroke: var(--hairline);
    stroke-width: 1;
  }

  .baseline {
    stroke: var(--hairline);
    stroke-width: 1;
  }

  /* Decorative (aria-hidden): soft accent bars, stronger inside the window. */
  .bar-muted path {
    fill: var(--accent);
    opacity: 0.2;
  }

  .bar-in path {
    fill: var(--accent);
    opacity: 0.72;
  }

  .stops-line {
    stroke: var(--border-strong);
    stroke-width: 2;
    stroke-linecap: round;
  }

  .stops-progress {
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linecap: round;
  }

  .stop {
    fill: var(--glass-fill-solid);
    stroke: var(--border-strong);
    stroke-width: 1.5;
    transition:
      fill var(--duration-base) var(--ease-out),
      stroke var(--duration-base) var(--ease-out);
  }

  .stop.reached {
    fill: var(--accent);
    stroke: var(--glass-fill-solid);
  }

  .today {
    position: absolute;
    top: 0;
    width: 1.5px;
    height: calc(var(--bars-h) + 4px);
    margin-left: -0.75px;
    border-radius: 1px;
    background: var(--ink);
    opacity: 0.45;
    pointer-events: none;
  }

  /* The selection: a raised, denser-glass rounded tile under the bars. Its accent handles mark
     the edges (3:1 against the panel); the tile itself is a soft cue. */
  .window {
    position: absolute;
    top: -2px;
    height: calc(var(--bars-h) + 8px);
    border: 1px solid var(--glass-stroke);
    border-radius: var(--radius-md);
    background: linear-gradient(var(--accent-soft), var(--accent-soft)), var(--glass-fill-thick);
    box-shadow:
      var(--glass-highlight),
      0 1px 4px rgb(0 0 0 / 0.1);
    cursor: grab;
  }

  .dragging .window,
  .dragging .track {
    cursor: grabbing;
  }

  .window:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  /* Handles: a slim capsule on each edge, with a wider invisible hit area. */
  .handle {
    position: absolute;
    top: calc(var(--bars-h) / 2 + 2px);
    width: 20px;
    height: calc(var(--bars-h) + 16px);
    transform: translate(-50%, -50%);
    cursor: ew-resize;
    border-radius: var(--radius-sm);
  }

  .handle::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 6px;
    height: calc(var(--bars-h) + 2px);
    transform: translate(-50%, -50%);
    border-radius: var(--radius-full);
    background: var(--accent);
    box-shadow:
      0 0 0 2px var(--glass-fill-solid),
      0 1px 3px rgb(0 0 0 / 0.18);
    transition:
      width var(--duration-fast) var(--ease-out),
      height var(--duration-fast) var(--ease-out);
  }

  .handle:hover::after,
  .handle:focus-visible::after {
    width: 8px;
    height: calc(var(--bars-h) + 6px);
  }

  .compact .handle::after {
    width: 4px;
  }

  .compact .handle:focus-visible::after {
    width: 6px;
  }

  .handle:focus-visible {
    outline: none;
  }

  .handle:focus-visible::after {
    box-shadow:
      0 0 0 2px var(--glass-fill-solid),
      0 0 0 4px var(--focus);
  }

  .axis {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 12px;
    pointer-events: none;
  }

  .tick {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    color: var(--ink-muted);
    font-size: 10.5px;
    line-height: 12px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .tick.year {
    /* Years label the start of their year. */
    transform: translateX(3px);
    color: var(--ink-muted);
    font-weight: var(--weight-medium);
  }

  .today-label {
    color: var(--ink);
    font-weight: var(--weight-medium);
  }

  .compact .tick {
    font-size: 10px;
  }

  /* ---- Right side ---- */
  .aside {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex: none;
  }

  .compact .aside {
    gap: var(--space-2);
  }

  /* One segmented capsule; the active preset is a raised tile with accent text. */
  .presets {
    display: flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-full);
    background: var(--glass-tint-press);
  }

  .preset {
    height: 28px;
    padding: 0 12px;
    border: 0;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--ink-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    white-space: nowrap;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .preset .short {
    display: none;
  }

  .preset:hover {
    background: var(--glass-tint-hover);
    color: var(--ink);
  }

  .preset[aria-pressed='true'] {
    background: var(--glass-fill-thick);
    color: var(--accent);
    font-weight: var(--weight-semibold);
    box-shadow:
      var(--glass-highlight),
      0 1px 3px rgb(0 0 0 / 0.12);
  }

  .range {
    min-width: 13.5em;
    color: var(--ink);
    font-weight: var(--weight-medium);
    text-align: right;
    white-space: nowrap;
  }

  .compact .range {
    min-width: 0;
    font-size: var(--text-xs);
  }

  /* Narrow desktop panel: the range label stacks above the presets, so the track keeps its room
     and the right column keeps a constant width (the axis never rescales when the label changes). */
  @container timeline (max-width: 900px) {
    .timeline:not(.compact) .aside:has(.presets) {
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
    }

    .timeline:not(.compact) .aside:has(.presets) .range {
      order: -1;
      min-width: 0;
      padding-right: var(--space-2);
      font-size: var(--text-xs);
      line-height: 14px;
    }

    .preset {
      height: 24px;
      padding: 0 8px;
      position: relative;
    }

    /* The full label stays in the accessible name (WCAG 2.5.3: it contains the visible text). */
    .preset .full {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
    }

    .preset .short {
      display: inline;
    }
  }

  /* ---- History mode ---- */
  .history-label {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: none;
    min-width: 0;
    line-height: var(--leading-tight);
  }

  .history-title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--ink);
    font-weight: var(--weight-semibold);
  }

  .history-title :global(.icon) {
    color: var(--accent);
  }

  .history-meta {
    color: var(--ink-muted);
    font-size: var(--text-xs);
  }
  .history-online {
    color: var(--ink-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    white-space: nowrap;
  }

  .compact .history-label {
    flex: 1;
    flex-direction: row;
    /* Not baseline: the title's leading icon would set it and drop the text below the meta. */
    align-items: center;
    gap: var(--space-2);
  }

  .exit {
    height: 32px;
    white-space: nowrap;
  }
</style>
