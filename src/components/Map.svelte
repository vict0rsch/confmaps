<script lang="ts" module>
  import { setWorkerUrl } from 'maplibre-gl';
  // MapLibre 6 loads its (self-contained) worker from a URL next to its own module; with Vite
  // bundling that file is not emitted, so ship it as a hashed asset and point MapLibre at it.
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

  setWorkerUrl(workerUrl);

  export type Insets = { top: number; right: number; bottom: number; left: number };
</script>

<script lang="ts">
  import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
  import {
    Map as MLMap,
    NavigationControl,
    type GeoJSONSource,
    type MapGeoJSONFeature,
  } from 'maplibre-gl';
  import { untrack } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import { prefersReducedMotion, Tween } from 'svelte/motion';
  import { app } from '../lib/state/app.svelte';
  import { getDates } from '../lib/state/filters.svelte';
  import { historyMode, play } from '../lib/state/timeline.svelte';
  import { animFeatures, Choreographer, liveIds, shownIds } from '../lib/map/choreography';
  import { boundsOf, linkFeatures, pinFeatures, type PinCollection } from '../lib/map/geojson';
  import { lockBadge } from '../lib/map/icons';
  import {
    ANIM_LAYERS,
    BASEMAP_URLS,
    CLUSTER_LAYERS,
    CLUSTER_MAX_ZOOM,
    LAYER,
    MAP_MAX_ZOOM,
    PIN_LAYERS,
    SRC,
    animLinkOpacity,
    animOpacity,
    animRingOpacity,
    dataLayers,
    dataSources,
    linkOpacity,
    lockImageId,
    pinOpacity,
    quietBasemap,
    readPalette,
  } from '../lib/map/style';
  import { historyFitPoints, historyLegs, pathAt, stopLabels } from '../lib/timeline/history';
  import { motionConfig } from '../lib/timeline/motion';
  import type { ResolvedTheme } from '../lib/state/theme';
  import Icon from './Icon.svelte';

  let { insets = { top: 0, right: 0, bottom: 0, left: 0 } }: { insets?: Insets } = $props();

  let container: HTMLDivElement;
  let map: MLMap | undefined = $state.raw();
  let styleReady = $state(false);
  let selectionOffscreen = $state(false);
  type CoLocated = { lng: number; lat: number; x: number; y: number; ids: string[] };
  let coLocated: CoLocated | null = $state(null);

  const MARGIN = 48;
  const duration = (ms: number) => (prefersReducedMotion.current ? 0 : ms);

  // ---- Source data ---------------------------------------------------------
  const pins = $derived(pinFeatures(app.visibleLocations));
  const links = $derived(linkFeatures(app.visibleLocations));
  const focus = $derived.by((): FeatureCollection => {
    const sel = app.selectedConferenceId;
    const hov = app.hoveredConferenceId;
    const tag = (c: PinCollection, selected: 0 | 1) =>
      c.features.map((f) => ({ ...f, properties: { ...f.properties, selected } }));
    const features = [];
    if (hov && hov !== sel) {
      features.push(
        ...tag(pinFeatures(app.visibleLocations.filter((l) => l.conferenceId === hov)), 0),
      );
    }
    if (sel) features.push(...tag(pinFeatures(app.selectedSites), 1));
    return { type: 'FeatureCollection', features };
  });

  // ---- Timeline choreography (Play, history mode) ---------------------------
  // While the timeline animates, an unclustered presentation of every location replaces the
  // clustered one (per-pin fades can't be clustered); it hands back once motion settles.
  const anim = animFeatures(app.data.locations);
  const motion = $derived(motionConfig(prefersReducedMotion.current));
  const wantAnim = $derived(play.playing || !!historyMode.series);
  let animMode = $state(false);
  let choreo: Choreographer | undefined;
  let raf = 0;
  /** Pins currently shown by the animated presentation (hit-testing ignores hidden ones). */
  let shownNow: ReadonlySet<string> = new Set();

  const stops = $derived(historyMode.series ? historyMode.stops : null);
  const shown = $derived(shownIds(app.visibleLocations, stops, play.travelShown));
  const live = $derived(
    play.playing ? liveIds(app.visibleLocations, getDates().from, stops, play.travelShown) : null,
  );

  // History mode: the path between editions, drawn in on entry and along with Play's travel.
  const legs = $derived(historyLegs(historyMode.stops));
  const intro = new Tween(1, { easing: cubicOut });
  const pathProgress = $derived(play.travelShown ?? intro.current * legs.length);

  // ---- Map lifecycle -------------------------------------------------------
  $effect(() => {
    const m = new MLMap({
      container,
      style: { version: 8, sources: {}, layers: [] },
      maxZoom: MAP_MAX_ZOOM,
      minZoom: 0.5,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: { compact: true },
    });
    m.touchZoomRotate.disableRotation();
    m.keyboard.disableRotation();
    m.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');

    m.on('style.load', () => (styleReady = true));
    m.setMissingStyleImageResolver((id) => {
      const theme = id.replace('lock-badge-', '') as ResolvedTheme;
      if (id !== lockImageId(theme) || m.hasImage(id)) return;
      const p = readPalette();
      const { image, options } = lockBadge(p.selected, p.pinHalo, p.pinHalo);
      m.addImage(id, image, options);
    });

    m.on('mousemove', PIN_LAYERS, (e) => {
      const f = e.features?.find(isTarget);
      m.getCanvas().style.cursor = f ? 'pointer' : '';
      const id = f?.properties?.conferenceId;
      if (id && app.hoveredConferenceId !== id) app.hover(id);
      else if (!f && app.hoveredConferenceId) app.hover(null);
    });
    m.on('mouseleave', PIN_LAYERS, () => {
      m.getCanvas().style.cursor = '';
      app.hover(null);
    });
    m.on('mouseenter', LAYER.clusters, () => (m.getCanvas().style.cursor = 'pointer'));
    m.on('mouseleave', LAYER.clusters, () => (m.getCanvas().style.cursor = ''));
    m.on('click', (e) => {
      const hit = m.queryRenderedFeatures(e.point, { layers: [...PIN_LAYERS, LAYER.clusters] });
      const onCluster = hit.some((f) => f.layer.id === LAYER.clusters);
      // A hover highlight drawn over a cluster must not hide the cluster's other events.
      const pin = hit.find(
        (f) =>
          f.layer.id === LAYER.pin ||
          (f.layer.id === LAYER.animPin && isTarget(f)) ||
          (f.layer.id === LAYER.focusPin && (f.properties.selected === 1 || !onCluster)),
      );
      if (pin) {
        coLocated = null;
        app.select(pin.properties.conferenceId);
      } else if (onCluster) {
        void openCluster(hit.find((f) => f.layer.id === LAYER.clusters)!);
      } else {
        coLocated = null;
      }
    });
    m.on('move', () => {
      if (coLocated) {
        const p = m.project([coLocated.lng, coLocated.lat]);
        coLocated = { ...coLocated, x: p.x, y: p.y };
      }
    });
    m.on('zoomstart', () => (coLocated = null));
    m.on('moveend', updateOffscreen);
    // A drag released over an overlay (drawer, legend) never reaches MapLibre and leaves the map
    // stuck panning; while dragging, everything but the canvas ignores the pointer (base.css).
    const root = document.documentElement;
    m.on('dragstart', () => root.toggleAttribute('data-map-dragging', true));
    m.on('dragend', () => root.toggleAttribute('data-map-dragging', false));

    const ro = new ResizeObserver(() => m.resize());
    ro.observe(container);
    // Overlays (drawer, sheet) are camera padding, so "centre" means the visible area's centre.
    // Initial overview: no antimeridian wrap, so a world-wide set centres on the Atlantic.
    // Untracked: camera calls fire map events synchronously, and their handlers read state.
    untrack(() => {
      m.setPadding(insets);
      const initial = boundsOf(app.visibleLocations, false);
      if (initial) m.fitBounds(initial, { padding: margins(), duration: 0 });
    });
    choreo = new Choreographer(
      m,
      app.data.locations,
      untrack(() => motion),
    );
    map = m;
    return () => {
      root.toggleAttribute('data-map-dragging', false);
      ro.disconnect();
      cancelAnimationFrame(raf);
      raf = 0;
      choreo = undefined;
      m.remove();
      map = undefined;
    };
  });

  // Basemap (and theme) swap: rebuild the whole style; data layers are re-added with current data.
  $effect(() => {
    const m = map;
    const theme = app.resolvedTheme;
    if (!m) return;
    styleReady = false;
    m.setStyle(BASEMAP_URLS[theme], {
      diff: false,
      transformStyle: (_prev, next) => {
        const p = readPalette();
        const base = quietBasemap(next, p);
        return {
          ...base,
          sources: { ...base.sources, ...dataSources({ pins, focus, links, anim }) },
          layers: [
            ...base.layers,
            ...dataLayers(
              p,
              theme,
              { selectedId: app.selectedConferenceId, hoveredId: app.hoveredConferenceId },
              animMode,
            ),
          ],
        };
      },
    });
  });

  const source = (id: string) => map?.getSource(id) as GeoJSONSource | undefined;

  // The clustered source is hidden while Play runs: don't re-cluster on every frame.
  $effect(() => {
    if (!styleReady || (animMode && play.playing)) return;
    source(SRC.pins)?.setData(pins);
    source(SRC.links)?.setData(links);
  });

  // Hand over between the clustered and the animated presentation.
  $effect(() => {
    const on = animMode;
    if (!styleReady || !map) return;
    for (const id of ANIM_LAYERS) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    for (const id of CLUSTER_LAYERS)
      map.setLayoutProperty(id, 'visibility', on ? 'none' : 'visible');
  });

  // Feed the choreographer. Entering history mode starts from an empty map so its editions
  // arrive one after the other; starting Play keeps what is on screen.
  $effect(() => {
    const [want, s, l, cfg] = [wantAnim, shown, live, motion];
    if (!styleReady || !choreo) return;
    untrack(() => {
      if (want && !animMode) {
        choreo!.reset(historyMode.series && !play.playing ? new Set() : s, cfg);
        animMode = true;
      }
      shownNow = s;
      if (!animMode) return;
      choreo!.setTargets(s, l ?? new Set(), performance.now(), cfg);
      kick();
    });
  });

  // A style reload (theme switch) drops feature-state: re-send it.
  $effect(() => {
    if (!styleReady || !choreo) return;
    untrack(() => {
      if (!animMode) return;
      choreo!.reapply();
      kick();
    });
  });

  function kick() {
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function loop(now: number) {
    raf = 0;
    if (!choreo || !map) return;
    if (choreo.frame(now)) return kick();
    // Settled. Still animating (Play, history mode): the next change kicks the loop again.
    // Otherwise back to clusters, once their source has caught up (no stale frame).
    if (wantAnim) return;
    if (map.isSourceLoaded(SRC.pins)) animMode = false;
    else kick();
  }

  // History layers: path (trimmed to the progress), travelling head, year labels.
  $effect(() => {
    if (!styleReady) return;
    const on = !!historyMode.series;
    const { lines, head } = on ? pathAt(legs, pathProgress) : { lines: [], head: null };
    const labels = on ? stopLabels(historyMode.stops, Math.floor(pathProgress + 1e-6)) : [];
    source(SRC.historyPath)?.setData({
      type: 'FeatureCollection',
      features: lines.map((coordinates): Feature<LineString> => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates },
        properties: {},
      })),
    });
    source(SRC.historyHead)?.setData({
      type: 'FeatureCollection',
      features:
        head && play.travel !== null
          ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: head }, properties: {} }]
          : [],
    });
    source(SRC.historyLabels)?.setData({
      type: 'FeatureCollection',
      features: labels.map(({ lng, lat, years, city }) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: { years, city },
      })),
    });
  });

  // Entering history mode: draw the path in, and fit the camera to the editions. Exiting
  // without a selection to restore: back to the overview.
  let lastSeries: string | null | undefined;
  $effect(() => {
    const series = historyMode.series;
    const m = map;
    if (!m) return;
    untrack(() => {
      const first = lastSeries === undefined;
      const prev = lastSeries;
      lastSeries = series;
      if (series === prev || (first && !series)) return;
      if (series) {
        void intro.set(0, { duration: 0 });
        void intro.set(1, { duration: motion.drawLines ? 700 : 0, delay: first ? 0 : 300 });
      }
      // Next frame: entering closes the detail, whose camera follow-up (easeTo) would cancel it.
      requestAnimationFrame(() => {
        if (map !== m || historyMode.series !== series) return;
        if (series) fitHistory(first ? 0 : duration(900));
        else if (!app.selectedConferenceId) {
          const b = boundsOf(app.visibleLocations, false);
          m.setPadding(insets);
          if (b) m.fitBounds(b, { padding: margins(), duration: duration(800) });
        }
      });
    });
  });

  $effect(() => {
    if (!styleReady || !map) return;
    source(SRC.focus)?.setData(focus);
    const sel = app.selectedConferenceId;
    const emphasis = { selectedId: sel, hoveredId: app.hoveredConferenceId };
    const op = pinOpacity(sel);
    map.setPaintProperty(LAYER.pin, 'circle-opacity', op);
    map.setPaintProperty(LAYER.pin, 'circle-stroke-opacity', op);
    map.setPaintProperty(LAYER.pinHalo, 'circle-opacity', op);
    map.setPaintProperty(LAYER.pinLock, 'icon-opacity', op);
    map.setPaintProperty(LAYER.links, 'line-opacity', linkOpacity(emphasis));
    const aop = animOpacity(sel);
    map.setPaintProperty(LAYER.animPin, 'circle-opacity', aop);
    map.setPaintProperty(LAYER.animPin, 'circle-stroke-opacity', aop);
    map.setPaintProperty(LAYER.animHalo, 'circle-opacity', aop);
    map.setPaintProperty(LAYER.animLock, 'icon-opacity', aop);
    map.setPaintProperty(LAYER.animRing, 'circle-stroke-opacity', animRingOpacity(sel));
    map.setPaintProperty(LAYER.animLinks, 'line-opacity', animLinkOpacity(emphasis));
    const clusterOp = sel ? 0.6 : 1;
    map.setPaintProperty(LAYER.clusters, 'circle-opacity', clusterOp);
    map.setPaintProperty(LAYER.clusters, 'circle-stroke-opacity', clusterOp);
    map.setPaintProperty(LAYER.clusterCount, 'text-opacity', clusterOp);
  });

  // On select, or when overlays resize: fit the selection into the visible area. Without a
  // selection, just follow the overlays (the visible centre stays put).
  $effect(() => {
    const id = app.selectedConferenceId;
    const pad = insets;
    const m = map;
    if (!m) return;
    untrack(() => {
      if (id) fitSelection();
      else m.easeTo({ padding: pad, duration: duration(250) });
    });
  });

  $effect(() => {
    void app.selectedConferenceId;
    selectionOffscreen = false;
  });

  // ---- Helpers -------------------------------------------------------------
  /** Hidden animated pins are still hit-tested by MapLibre: ignore them. */
  function isTarget(f: MapGeoJSONFeature) {
    return f.layer.id !== LAYER.animPin || shownNow.has(f.properties.id);
  }

  /**
   * Fit the editions' path (with room for its year labels). Satellites widen the box only for a
   * single-stop series; otherwise the path is the subject (NeurIPS's satellites would make it
   * world-wide and unfittable on a phone).
   */
  function fitHistory(ms: number) {
    const sites = app.visibleLocations;
    const single = historyMode.stops.length < 2;
    const pts = historyFitPoints(historyMode.stops, legs, single ? sites : []);
    const b = boundsOf(pts.length ? pts : sites, false);
    if (!map || !b) return;
    const m = margins(96);
    map.setPadding(insets);
    map.fitBounds(b, { padding: { ...m, top: m.top + 24 }, maxZoom: 4.5, duration: ms });
  }

  /** fitBounds margins inside the camera padding, shrunk when the visible area is small. */
  function margins(max = MARGIN) {
    const w = (container?.clientWidth ?? 0) - insets.left - insets.right;
    const h = (container?.clientHeight ?? 0) - insets.top - insets.bottom;
    const x = Math.max(0, Math.min(max, (w - 80) / 2));
    const y = Math.max(0, Math.min(max, (h - 80) / 2));
    return { top: y, bottom: y, left: x, right: x };
  }

  function fitSelection() {
    const b = boundsOf(app.selectedSites);
    if (!map || !b) return;
    map.setPadding(insets);
    map.fitBounds(b, { padding: margins(), maxZoom: 6, duration: duration(800) });
  }

  function updateOffscreen() {
    if (!map || !app.selectedConferenceId) return (selectionOffscreen = false);
    const w = container.clientWidth - insets.right;
    const h = container.clientHeight - insets.bottom;
    selectionOffscreen = !app.selectedSites.some((s) => {
      const p = map!.project([s.lng, s.lat]);
      return p.x >= insets.left && p.x <= w && p.y >= insets.top && p.y <= h;
    });
  }

  async function openCluster(feature: MapGeoJSONFeature) {
    const src = source(SRC.pins);
    if (!map || !src || feature.geometry.type !== 'Point') return;
    const clusterId = feature.properties.cluster_id as number;
    const [lng, lat] = feature.geometry.coordinates;
    const leaves = await src.getClusterLeaves(clusterId, 50, 0);
    const coords = leaves.map((l) => (l.geometry as Point).coordinates);
    const sameSpot = coords.every(
      ([x, y]) => Math.abs(x - coords[0][0]) < 1e-3 && Math.abs(y - coords[0][1]) < 1e-3,
    );
    const zoom = await src.getClusterExpansionZoom(clusterId);
    if (sameSpot || zoom > CLUSTER_MAX_ZOOM || map.getZoom() >= MAP_MAX_ZOOM) {
      const ids = [...new Set(leaves.map((l) => l.properties?.conferenceId as string))];
      const p = map.project([lng, lat]);
      coLocated = { lng, lat, x: p.x, y: p.y, ids };
    } else {
      map.easeTo({ center: [lng, lat], zoom, duration: duration(500) });
    }
  }

  function chooseCoLocated(id: string) {
    coLocated = null;
    app.select(id);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && coLocated) {
      coLocated = null;
      e.stopPropagation();
    }
  }

  const selectionLabel = $derived(
    app.selectedConference ? `${app.selectedConference.title} ${app.selectedConference.year}` : '',
  );
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="map-wrap"
  style:--inset-top="{insets.top}px"
  style:--inset-right="{insets.right}px"
  style:--inset-bottom="{insets.bottom}px"
  style:--inset-left="{insets.left}px"
  onkeydown={onKeydown}
>
  <div class="map" bind:this={container} data-testid="map"></div>

  {#if selectionOffscreen && app.selectedConference}
    <button class="back button" type="button" onclick={fitSelection}>
      <Icon name="target" size={14} />
      Back to {selectionLabel}
    </button>
  {/if}

  {#if coLocated}
    <div
      class="colocated"
      role="dialog"
      aria-label="Events at this location"
      style:left="{coLocated.x}px"
      style:top="{coLocated.y}px"
    >
      <p class="colocated-title">{coLocated.ids.length} events here</p>
      <ul role="list">
        {#each coLocated.ids as id (id)}
          {@const conf = app.data.conferenceById.get(id)}
          {@const site = app.visibleLocations.find((l) => l.conferenceId === id)}
          {#if conf}
            <li>
              <button type="button" onclick={() => chooseCoLocated(id)}>
                <span class="name">{conf.title} {conf.year}</span>
                {#if site}<span class="meta">{site.city}</span>{/if}
              </button>
            </li>
          {/if}
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .map-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--map-land);
  }

  .map {
    position: absolute;
    inset: 0;
  }

  /* Keep MapLibre controls clear of overlays (drawer, bottom sheet). */
  .map-wrap :global(.maplibregl-ctrl-bottom-right) {
    bottom: var(--inset-bottom);
    right: var(--inset-right);
    transition: right var(--duration-base) var(--ease-out);
  }
  .map-wrap :global(.maplibregl-ctrl-bottom-left) {
    bottom: var(--inset-bottom);
  }

  .map-wrap :global(.maplibregl-ctrl-group) {
    background: var(--surface-raised);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    overflow: hidden;
  }
  .map-wrap :global(.maplibregl-ctrl-group button) {
    width: 32px;
    height: 32px;
  }
  .map-wrap :global(.maplibregl-ctrl-group button + button) {
    border-top: 1px solid var(--border);
  }
  .map-wrap :global(.maplibregl-ctrl-group button:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--focus);
  }
  :global(:root[data-theme='dark']) .map-wrap :global(.maplibregl-ctrl-icon) {
    filter: invert(1) brightness(0.9);
  }
  .map-wrap :global(.maplibregl-ctrl-attrib) {
    background: color-mix(in srgb, var(--surface) 82%, transparent);
    color: var(--ink-muted);
    font-size: var(--text-xs);
  }
  .map-wrap :global(.maplibregl-ctrl-attrib a) {
    color: var(--ink-muted);
  }
  .map-wrap :global(.maplibregl-ctrl-attrib.maplibregl-compact) {
    border-radius: var(--radius-full);
  }
  :global(:root[data-theme='dark']) .map-wrap :global(.maplibregl-ctrl-attrib-button) {
    filter: invert(1);
  }

  .back {
    position: absolute;
    top: calc(var(--inset-top) + var(--space-3));
    left: calc((100% - var(--inset-right) + var(--inset-left)) / 2);
    transform: translateX(-50%);
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-md);
    animation: rise var(--duration-base) var(--ease-out);
    white-space: nowrap;
    max-width: calc(100% - var(--inset-left) - var(--inset-right) - 32px);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .colocated {
    position: absolute;
    transform: translate(-50%, calc(-100% - 22px));
    min-width: 200px;
    max-width: 280px;
    padding: var(--space-2);
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    animation: rise var(--duration-fast) var(--ease-out);
  }
  .colocated-title {
    padding: var(--space-1) var(--space-2) var(--space-2);
    color: var(--ink-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
  }
  .colocated button {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    text-align: left;
  }
  .colocated button:hover {
    background: var(--surface-hover);
  }
  .colocated .name {
    font-weight: var(--weight-medium);
  }
  .colocated .meta {
    color: var(--ink-muted);
  }

  @keyframes rise {
    from {
      opacity: 0;
    }
  }
</style>
