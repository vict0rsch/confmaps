<script lang="ts" module>
  // Loaded lazily (App.svelte): MapLibre and its CSS live in their own chunk, off the first paint.
  import 'maplibre-gl/dist/maplibre-gl.css';
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
    type PointLike,
  } from 'maplibre-gl';
  import { untrack } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import { prefersReducedMotion, Tween } from 'svelte/motion';
  import { app } from '../lib/state/app.svelte';
  import { getDates } from '../lib/state/filters.svelte';
  import { historyMode, play } from '../lib/state/timeline.svelte';
  import { animFeatures, Choreographer, liveIds, shownIds } from '../lib/map/choreography';
  import {
    boundsOf,
    greatCircle,
    linkFeatures,
    pinFeatures,
    trimLine,
    type PinCollection,
  } from '../lib/map/geojson';
  import { haversineKm } from '../lib/geo/distance';
  import { lockBadge } from '../lib/map/icons';
  import {
    ANIM_LAYERS,
    BASEMAP_URLS,
    CLUSTER_LAYERS,
    CLUSTER_MAX_ZOOM,
    COLLIDER_IMAGE,
    LAYER,
    MAP_MAX_ZOOM,
    PIN_LAYERS,
    SRC,
    animLinkOpacity,
    animOpacity,
    animRingOpacity,
    dataLayers,
    dataSources,
    fade,
    historyLabelProps,
    linkOpacity,
    lockImageId,
    pinOpacity,
    quietBasemap,
    readPalette,
  } from '../lib/map/style';
  import {
    historyFitPoints,
    historyLegs,
    mergeCloseLabels,
    pathAt,
    stopLabels,
  } from '../lib/timeline/history';
  import { motionConfig } from '../lib/timeline/motion';
  import type { ResolvedTheme } from '../lib/state/theme';
  import Icon from './Icon.svelte';

  let {
    insets = { top: 0, right: 0, bottom: 0, left: 0 },
    phone = false,
    folded = false,
  }: {
    insets?: Insets;
    /** The mobile layout: the attribution stays compact. */
    phone?: boolean;
    /** The phone's side panel is folded into its pill. It is kept across layouts and rotations. */
    folded?: boolean;
  } = $props();

  let container: HTMLDivElement;
  let map: MLMap | undefined = $state.raw();
  let styleReady = $state(false);
  /** Settled zoom: nearby history labels merge by their on-screen distance. */
  let zoom = $state(0);
  let selectionOffscreen = $state(false);
  type CoLocated = { lng: number; lat: number; x: number; y: number; ids: string[] };
  let coLocated: CoLocated | null = $state(null);
  /** The site of a selection made by clicking its pin: the camera keeps its zoom for it. */
  let clickedSite: { id: string; lngLat: [number, number] } | null = null;
  /** The conference the camera was last fitted to (double-clicking its pin zooms back out). */
  let zoomedTo: string | null = null;
  /** The selection, left inset, layout and fold the camera last followed (camera effect). */
  let followed: { id: string | null; left: number; phone: boolean; folded: boolean } = {
    id: null,
    left: 0,
    phone: false,
    folded: false,
  };
  /** The camera shows a fitted overview (or history path), not a view the viewer moved to. */
  let atOverview = true;

  const MARGIN = 48;
  /** The overview of a few nearby pins (or one) stays regional, never street level. */
  const OVERVIEW_MAX_ZOOM = 5;
  const duration = (ms: number) => (prefersReducedMotion.current ? 0 : ms);

  // ---- Source data ---------------------------------------------------------
  const pins = $derived(pinFeatures(app.mapLocations));
  const links = $derived(linkFeatures(app.mapLocations));
  const focus = $derived.by((): FeatureCollection => {
    const sel = app.selectedConferenceId;
    const hov = app.hoveredConferenceId;
    const tag = (c: PinCollection, selected: 0 | 1) =>
      c.features.map((f) => ({ ...f, properties: { ...f.properties, selected } }));
    const features = [];
    if (hov && hov !== sel) {
      features.push(...tag(pinFeatures(app.mapLocations.filter((l) => l.conferenceId === hov)), 0));
    }
    if (sel) features.push(...tag(pinFeatures(app.selectedPins), 1));
    return { type: 'FeatureCollection', features };
  });

  // Home (DESIGN §5.5): a marker, and lines to the selected conference's sites only (lines to
  // every pin would be clutter), drawn in on selection; the nearest site's line is the strongest.
  // A virtual event has no pin, hence no line.
  const homeDraw = new Tween(1, { easing: cubicOut });
  const homeLineCoords = $derived.by(() => {
    const home = app.home;
    if (!home || !app.selectedConferenceId) return [];
    const sites = app.selectedPins.map((s) => ({ s, km: haversineKm(home, s) }));
    const nearest = Math.min(...sites.map((x) => x.km));
    return sites.map(({ s, km }) => ({ coords: greatCircle(home, s), nearest: km === nearest }));
  });
  const homePoint = $derived.by((): FeatureCollection => {
    const h = app.home;
    return {
      type: 'FeatureCollection',
      features: h
        ? [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [h.lng, h.lat] },
              properties: {},
            },
          ]
        : [],
    };
  });
  const homeLines = $derived.by((): FeatureCollection => ({
    type: 'FeatureCollection',
    features: homeLineCoords.map(({ coords, nearest }) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: trimLine(coords, homeDraw.current) },
      properties: { nearest: nearest ? 1 : 0 },
    })),
  }));

  // ---- Timeline choreography (Play, history mode) ---------------------------
  // While the timeline animates, an unclustered presentation of every location replaces the
  // clustered one (per-pin fades can't be clustered); it hands back once motion settles.
  const anim = animFeatures(app.data.pinnedLocations);
  const motion = $derived(motionConfig(prefersReducedMotion.current));
  const wantAnim = $derived(play.playing || !!historyMode.series);
  let animMode = $state(false);
  /** Crossfade between the presentations: 0 = clustered, 1 = animated. */
  const blend = new Tween(0, { easing: cubicOut });
  let choreo: Choreographer | undefined;
  let raf = 0;
  /** Pins currently shown by the animated presentation (hit-testing ignores hidden ones). */
  let shownNow: ReadonlySet<string> = new Set();

  const stops = $derived(historyMode.series ? historyMode.stops : null);
  const shown = $derived(shownIds(app.mapLocations, stops, play.travelShown));
  const live = $derived(
    play.playing ? liveIds(app.mapLocations, getDates().to, stops, play.travelShown) : null,
  );
  /** Play's window, which pins dim across (not in history mode, whose travel has no window). */
  const fadeWindow = $derived(play.playing && !historyMode.series ? getDates() : null);

  // History mode: the path between editions, drawn in on entry and along with Play's travel.
  const legs = $derived(historyLegs(historyMode.stops));
  const intro = new Tween(1, { easing: cubicOut });
  const pathProgress = $derived(play.travelShown ?? intro.current * legs.length);

  // ---- Map lifecycle -------------------------------------------------------
  /**
   * The mobile layout, in either orientation: zoom may go below 0 so the first view fits every
   * upcoming pin. MapLibre's own constraint keeps the world covering the visible area (camera
   * padding), so no empty band.
   */
  const minZoom = (mobile: boolean) => (mobile ? -1 : 0.5);

  $effect(() => {
    // Untracked: crossing 1024 px must not rebuild the map (the effect below moves the floor).
    const m = new MLMap({
      container,
      style: { version: 8, sources: {}, layers: [] },
      maxZoom: MAP_MAX_ZOOM,
      minZoom: minZoom(untrack(() => phone)),
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: { compact: true },
    });
    m.touchZoomRotate.disableRotation();
    m.keyboard.disableRotation();
    m.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
    // Zoom and attribution are glass capsules (the .glass class owns the blur, see base.css).
    m.getContainer()
      .querySelectorAll('.maplibregl-ctrl-group, .maplibregl-ctrl-attrib')
      .forEach((el) => el.classList.add('glass'));
    m.once('load', fitAttribution);

    m.on('style.load', () => (styleReady = true));
    m.setMissingStyleImageResolver((id) => {
      if (id === COLLIDER_IMAGE) {
        if (!m.hasImage(id)) m.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
        return;
      }
      const theme = id.replace('lock-badge-', '') as ResolvedTheme;
      if (id !== lockImageId(theme) || m.hasImage(id)) return;
      const p = readPalette();
      const { image, options } = lockBadge(p.selected, p.pinHalo);
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
    // A click on a pin selects without moving the camera; a double-click zooms to the
    // conference, and a second one back out to the overview.
    m.on('click', (e) => {
      const { pin, cluster } = hitAt(e.point);
      if (pin) {
        coLocated = null;
        const id = pin.properties.conferenceId;
        if (id !== app.selectedConferenceId) clickedSite = { id, lngLat: pinLngLat(pin) };
        app.select(id);
      } else if (cluster) {
        void openCluster(cluster);
      } else {
        coLocated = null;
      }
    });
    m.on('dblclick', (e) => {
      const { pin } = hitAt(e.point);
      if (!pin) return; // elsewhere: MapLibre's double-click zoom
      e.preventDefault();
      const id = pin.properties.conferenceId;
      const lngLat = pinLngLat(pin);
      // Next frame: MapLibre stops camera moves started while it handles the prevented event.
      requestAnimationFrame(() => {
        if (zoomedTo === id) {
          clickedSite = { id, lngLat };
          zoomedTo = null;
          fitOverview(duration(800));
        } else {
          clickedSite = null;
          app.select(id);
          fitSelection();
        }
      });
    });
    m.on('move', () => {
      if (coLocated) {
        const p = m.project([coLocated.lng, coLocated.lat]);
        coLocated = { ...coLocated, x: p.x, y: p.y };
      }
    });
    m.on('zoomstart', (e) => {
      coLocated = null;
      if (e.originalEvent) zoomedTo = null; // the viewer zoomed: no longer the fitted view
    });
    m.on('movestart', (e) => {
      if (e.originalEvent) atOverview = false;
    });
    m.on('moveend', updateOffscreen);
    m.on('zoomend', () => (zoom = m.getZoom()));
    // A drag released over an overlay (drawer, legend) never reaches MapLibre and leaves the map
    // stuck panning; while dragging, everything but the canvas ignores the pointer (base.css).
    const root = document.documentElement;
    m.on('dragstart', () => root.toggleAttribute('data-map-dragging', true));
    m.on('dragend', () => root.toggleAttribute('data-map-dragging', false));

    const ro = new ResizeObserver(() => {
      m.resize();
      fitAttribution();
    });
    ro.observe(container);
    // Overlays (drawer, sheet) are camera padding, so "centre" means the visible area's centre.
    // Initial overview: no antimeridian wrap, so a world-wide set centres on the Atlantic.
    // Untracked: camera calls fire map events synchronously, and their handlers read state.
    untrack(() => {
      m.setPadding(camPad);
      const initial = boundsOf(app.mapLocations, false);
      if (initial)
        m.fitBounds(initial, {
          padding: overviewMargins(),
          maxZoom: OVERVIEW_MAX_ZOOM,
          duration: 0,
        });
      zoom = m.getZoom();
    });
    choreo = new Choreographer(
      m,
      app.data.pinnedLocations,
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

  // The zoom floor follows the layout; MapLibre clamps a zoom below the new floor.
  $effect(() => {
    map?.setMinZoom(minZoom(phone));
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
          sources: {
            ...base.sources,
            ...dataSources({ pins, focus, links, anim, home: homePoint, homeLines }),
          },
          layers: [
            ...base.layers,
            ...dataLayers(
              p,
              theme,
              { selectedId: app.selectedConferenceId, hoveredId: app.hoveredConferenceId },
              animMode,
              !!historyMode.series,
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

  // Hand over between the clustered and the animated presentation: a short crossfade (instant
  // with reduced motion); each one is hidden once fully faded out.
  $effect(() => {
    void blend.set(animMode ? 1 : 0, { duration: duration(300) });
  });
  const animVisible = $derived(blend.current > 0.001);
  const clusterVisible = $derived(blend.current < 0.999);
  $effect(() => {
    const [a, c] = [animVisible, clusterVisible];
    if (!styleReady || !map) return;
    for (const id of ANIM_LAYERS) map.setLayoutProperty(id, 'visibility', a ? 'visible' : 'none');
    for (const id of CLUSTER_LAYERS)
      map.setLayoutProperty(id, 'visibility', c ? 'visible' : 'none');
  });

  $effect(() => {
    if (!styleReady) return;
    source(SRC.home)?.setData(homePoint);
    source(SRC.homeLines)?.setData(homeLines);
  });

  // A new selection (with a home set) draws its home lines in.
  $effect(() => {
    if (!app.selectedConferenceId || !app.home) return;
    untrack(() => {
      void homeDraw.set(0, { duration: 0 });
      void homeDraw.set(1, { duration: duration(600), delay: duration(200) });
    });
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

  // Play: pins dim as they cross the window. On pause the dimmed pins crossfade out as they are,
  // so they are reset only when history mode takes over the animated presentation.
  $effect(() => {
    const w = fadeWindow;
    if (!styleReady || !choreo) return;
    untrack(() => {
      if (!w && !historyMode.series) return;
      choreo!.setWindow(w);
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
      features: mergeCloseLabels(labels, zoom).map(({ lng, lat, rows }) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: historyLabelProps(rows),
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
        else if (!app.selectedConferenceId) fitOverview(duration(800));
      });
    });
  });

  $effect(() => {
    if (!styleReady) return;
    source(SRC.focus)?.setData(focus);
  });

  // Emphasis (selection dims the rest) × the presentations' crossfade.
  $effect(() => {
    if (!styleReady || !map) return;
    const sel = app.selectedConferenceId;
    const emphasis = { selectedId: sel, hoveredId: app.hoveredConferenceId };
    const [ka, kc] = [blend.current, 1 - blend.current];
    const paint = map.setPaintProperty.bind(map);
    const op = fade(pinOpacity(sel), kc);
    paint(LAYER.pin, 'circle-opacity', op);
    paint(LAYER.pin, 'circle-stroke-opacity', op);
    paint(LAYER.pinHalo, 'circle-opacity', op);
    paint(LAYER.pinDot, 'circle-opacity', op);
    paint(LAYER.pinLock, 'icon-opacity', op);
    paint(LAYER.links, 'line-opacity', fade(linkOpacity(emphasis), kc));
    const aop = fade(animOpacity(sel), ka);
    paint(LAYER.animPin, 'circle-opacity', aop);
    paint(LAYER.animPin, 'circle-stroke-opacity', aop);
    paint(LAYER.animHalo, 'circle-opacity', aop);
    paint(LAYER.animDot, 'circle-opacity', aop);
    paint(LAYER.animLock, 'icon-opacity', aop);
    paint(LAYER.animRing, 'circle-stroke-opacity', fade(animRingOpacity(sel), ka));
    paint(
      LAYER.animLinks,
      'line-opacity',
      fade(animLinkOpacity(emphasis, !!historyMode.series), ka),
    );
    const clusterOp = (sel ? 0.6 : 1) * kc;
    paint(LAYER.clusters, 'circle-opacity', clusterOp);
    paint(LAYER.clusters, 'circle-stroke-opacity', clusterOp);
    paint(LAYER.clusterCount, 'text-opacity', clusterOp);
  });

  // On select, or when overlays resize: fit the selection into the visible area. A selection
  // clicked on the map keeps the zoom, only kept clear of the overlays. Closing the selection keeps
  // the map still. Otherwise, without a selection, just follow the overlays (the visible centre
  // stays put).
  $effect(() => {
    const id = app.selectedConferenceId;
    const pad = camPad;
    const m = map;
    if (!m) return;
    untrack(() => {
      // A window resize moves the panels before the ResizeObserver resizes the map: resize first,
      // so a fit uses the new size.
      const c = m.getCanvas();
      if (c.clientWidth !== container.clientWidth || c.clientHeight !== container.clientHeight)
        m.resize();
      if (clickedSite && clickedSite.id !== id) clickedSite = null;
      // A new left inset in the same layout: the desktop sidebar was toggled, or the phone's side
      // panel was folded. With a selection, keep the zoom and re-pad only. A side panel that
      // resized or appeared, or a crossing of the desktop breakpoint, fits again.
      const toggled =
        phone === followed.phone &&
        pad.left !== followed.left &&
        (!phone || folded !== followed.folded);
      if (clickedSite) keepInView(clickedSite.lngLat);
      else if (id && (id !== followed.id || !toggled)) fitSelection();
      // On phones, a fold with no selection fits the overview (or the editions' path) to the new
      // free area: the zoom fitted beside the panel would show the world twice once folded. A
      // view the viewer moved to is kept.
      else if (!id && phone && toggled && atOverview) {
        if (historyMode.series) fitHistory(duration(900));
        else fitOverview(duration(800));
      } else if (deferredFit && !noRoom()) deferredFit();
      // Closing the detail keeps the map still, however it was opened.
      else if (!id && followed.id) {
        const right = container.clientWidth - pad.right;
        const bottom = container.clientHeight - pad.bottom;
        m.jumpTo({ padding: pad, center: m.unproject([(pad.left + right) / 2, bottom / 2]) });
      } else m.easeTo({ padding: pad, duration: duration(250) });
      followed = { id, left: pad.left, phone, folded };
    });
  });

  $effect(() => {
    void app.selectedConferenceId;
    selectionOffscreen = false;
  });

  // ---- Helpers -------------------------------------------------------------
  /** The pin (if any) and the cluster (if any) under a point. */
  function hitAt(point: PointLike) {
    const hit = map!.queryRenderedFeatures(point, { layers: [...PIN_LAYERS, LAYER.clusters] });
    const cluster = hit.find((f) => f.layer.id === LAYER.clusters);
    // A hover highlight drawn over a cluster must not hide the cluster's other events.
    const pin = hit.find(
      (f) =>
        f.layer.id === LAYER.pin ||
        (f.layer.id === LAYER.animPin && isTarget(f)) ||
        (f.layer.id === LAYER.focusPin && (f.properties.selected === 1 || !cluster)),
    );
    return { pin, cluster };
  }

  const pinLngLat = (f: MapGeoJSONFeature) => (f.geometry as Point).coordinates as [number, number];

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
    const sites = app.mapLocations;
    const single = historyMode.stops.length < 2;
    const pts = historyFitPoints(historyMode.stops, legs, single ? sites : []);
    const b = boundsOf(pts.length ? pts : sites, false);
    if (!map || !roomFor(() => fitHistory(ms)) || !b) return;
    // A short map (a phone held sideways) would spend most of its height on the margins.
    const h = container.clientHeight - insets.top - insets.bottom;
    const m = margins(h < 400 ? 48 : 96);
    map.setPadding(camPad);
    map.fitBounds(b, { padding: { ...m, top: m.top + 24 }, maxZoom: 4.5, duration: ms });
    atOverview = true;
  }

  /**
   * The map spans the window under the panels, so MapLibre's width-based compact switch never
   * fires. Show the attribution in full when the free area (between the stage insets) is wide
   * enough, otherwise collapse it to its (i) toggle, which still expands on click. On phones it
   * is always compact, and collapsed from the start.
   */
  const ATTRIBUTION_MIN_FREE_WIDTH = 560;
  function fitAttribution() {
    const el = map?.getContainer().querySelector<HTMLDetailsElement>('.maplibregl-ctrl-attrib');
    if (!el || !container) return;
    const cs = getComputedStyle(container);
    const inset = (side: string) => parseFloat(cs.getPropertyValue(`--stage-inset-${side}`)) || 0;
    const free = container.clientWidth - inset('left') - inset('right');
    const wide = !phone && free >= ATTRIBUTION_MIN_FREE_WIDTH;
    if (el.classList.contains('maplibregl-compact') === wide) {
      el.classList.toggle('maplibregl-compact', !wide);
      el.classList.remove('maplibregl-compact-show');
      el.open = wide;
    }
  }
  // The drawer opening or closing changes the free width (after the stage props update); crossing
  // into the mobile layout changes the rule.
  const insetLR = $derived(insets.left + insets.right);
  $effect(() => {
    void insetLR;
    void phone;
    requestAnimationFrame(fitAttribution);
  });

  /**
   * Camera padding. The top is left out: the top bar is translucent, so the world renders behind
   * it (its height is added to the fitBounds margins instead, see margins()).
   */
  const camPad = $derived({ ...insets, top: 0 });

  /** fitBounds margins inside the camera padding, shrunk when the visible area is small. */
  function margins(max = MARGIN) {
    const w = (container?.clientWidth ?? 0) - insets.left - insets.right;
    const h = (container?.clientHeight ?? 0) - insets.top - insets.bottom;
    const x = Math.max(0, Math.min(max, (w - 80) / 2));
    const y = Math.max(0, Math.min(max, (h - 80) / 2));
    return { top: y + insets.top, bottom: y, left: x, right: x };
  }

  /** The panels cover the whole height (a full phone sheet): fitBounds would compute NaN. */
  const noRoom = () => (container?.clientHeight ?? 0) - insets.top - insets.bottom <= 0;

  /** A fit skipped for lack of room, run once the panels free the map again. */
  let deferredFit: (() => void) | null = null;
  /** False when there is no room: `fit` then waits for room. Any fit replaces a waiting one. */
  function roomFor(fit: () => void) {
    deferredFit = noRoom() ? fit : null;
    return !deferredFit;
  }

  /** The world overview: on a phone every pixel of width counts, but edge pins keep their halo. */
  function overviewMargins() {
    return margins((container?.clientWidth ?? 0) < 640 ? 24 : MARGIN);
  }

  /** No pins (a virtual event): no camera move. */
  function fitSelection() {
    const b = boundsOf(app.selectedPins);
    if (!map || !roomFor(fitSelection) || !b) return;
    zoomedTo = app.selectedConferenceId;
    atOverview = false;
    map.setPadding(camPad);
    map.fitBounds(b, { padding: margins(), maxZoom: 6, duration: duration(800) });
  }

  /** Every visible pin (no antimeridian wrap, so a world-wide set centres on the Atlantic). */
  function fitOverview(ms: number) {
    const b = boundsOf(app.mapLocations, false);
    if (!map || !roomFor(() => fitOverview(ms))) return;
    map.setPadding(camPad);
    if (b)
      map.fitBounds(b, { padding: overviewMargins(), maxZoom: OVERVIEW_MAX_ZOOM, duration: ms });
    atOverview = true;
  }

  /**
   * Adopt the overlays' padding at the same zoom. The map stays still while the clicked site is
   * in the visible area; otherwise it pans to centre the site.
   */
  function keepInView(lngLat: [number, number]) {
    if (!map) return;
    const pad = camPad;
    const right = container.clientWidth - pad.right;
    const bottom = container.clientHeight - pad.bottom;
    const p = map.project(lngLat);
    const inView =
      p.x >= pad.left + MARGIN &&
      p.x <= right - MARGIN &&
      p.y >= insets.top + MARGIN &&
      p.y <= bottom - MARGIN;
    const center = inView ? map.unproject([(pad.left + right) / 2, bottom / 2]) : lngLat;
    map.easeTo({ padding: pad, center, duration: duration(250) });
  }

  function updateOffscreen() {
    if (!map || !app.selectedPins.length) return (selectionOffscreen = false);
    const w = container.clientWidth - insets.right;
    const h = container.clientHeight - insets.bottom;
    selectionOffscreen = !app.selectedPins.some((s) => {
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
          {@const site = app.mapLocations.find((l) => l.conferenceId === id)}
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

  /* Keep MapLibre controls above the timeline and bottom sheet, in the window's right corner:
     the drawer stops above them (App.svelte). One row, bottom-aligned: the attribution, then zoom
     (MapLibre puts the last control added first). The insets already include the gap to the
     neighbouring panel on desktop. */
  .map-wrap :global(.maplibregl-ctrl-bottom-right) {
    bottom: var(--stage-inset-bottom, var(--panel-gap));
    right: var(--panel-gap);
    display: flex;
    flex-direction: row-reverse;
    align-items: flex-end;
    gap: var(--space-2);
  }
  .map-wrap :global(.maplibregl-ctrl-bottom-right .maplibregl-ctrl) {
    margin: 0;
  }
  .map-wrap :global(.maplibregl-ctrl-bottom-left) {
    bottom: var(--inset-bottom);
  }
  @media (max-width: 1023px) {
    .map-wrap :global(.maplibregl-ctrl-bottom-right) {
      bottom: calc(var(--stage-inset-bottom, var(--inset-bottom)) + var(--space-2));
      right: var(--stage-inset-right);
    }
  }

  /* MapLibre's own stylesheet sets a white background at the same specificity as .glass and loads
     later, so restate the glass fill here (and its reduced-transparency fallback). */
  .map-wrap :global(.maplibregl-ctrl.glass) {
    background: var(--glass-fill);
  }
  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
    .map-wrap :global(.maplibregl-ctrl.glass) {
      background: var(--glass-fill-solid);
    }
  }

  /* Zoom: a small vertical capsule. Fill, border, shadow and blur come from .glass. */
  .map-wrap :global(.maplibregl-ctrl-group) {
    border-radius: var(--radius-full);
    overflow: hidden;
  }
  .map-wrap :global(.maplibregl-ctrl-group button) {
    width: 36px;
    height: 36px;
    background-color: transparent;
    transition: background-color var(--duration-fast) var(--ease-out);
  }
  .map-wrap :global(.maplibregl-ctrl-group button:hover) {
    background-color: var(--glass-tint-hover);
  }
  .map-wrap :global(.maplibregl-ctrl-group button:active) {
    background-color: var(--glass-tint-press);
  }
  .map-wrap :global(.maplibregl-ctrl-group button + button) {
    border-top: 1px solid var(--hairline);
  }
  .map-wrap :global(.maplibregl-ctrl-group button:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--focus);
  }
  :global(:root[data-theme='dark']) .map-wrap :global(.maplibregl-ctrl-icon) {
    filter: invert(1) brightness(0.9);
  }

  /* Attribution: a small capsule that stays readable (text is --ink-muted over glass). */
  .map-wrap :global(.maplibregl-ctrl-attrib) {
    color: var(--ink-muted);
    font-size: var(--text-xs);
    border-radius: var(--radius-full);
  }
  .map-wrap :global(.maplibregl-ctrl-attrib.maplibregl-compact) {
    min-height: 28px;
  }
  .map-wrap :global(.maplibregl-ctrl-attrib a) {
    color: var(--ink-muted);
  }
  .map-wrap :global(.maplibregl-ctrl-attrib-inner) {
    padding: 0 var(--space-2);
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
