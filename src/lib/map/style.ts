// Map styling: a quiet basemap derived from OpenFreeMap styles, plus the app's data layers.
import type {
  ExpressionSpecification,
  LayerSpecification,
  SourceSpecification,
  StyleSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { ResolvedTheme } from '../state/theme';

/** OpenFreeMap styles (https://openfreemap.org): no API key, no quota. */
export const BASEMAP_URLS: Record<ResolvedTheme, string> = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

export type MapPalette = {
  land: string;
  water: string;
  boundary: string;
  road: string;
  label: string;
  labelStrong: string;
  labelHalo: string;
  pinOfficial: string;
  pinCommunity: string;
  pinHalo: string;
  link: string;
  selected: string;
  clusterFill: string;
  clusterRing: string;
  clusterInk: string;
};

const TOKENS: Record<keyof MapPalette, string> = {
  land: '--map-land',
  water: '--map-water',
  boundary: '--map-boundary',
  road: '--map-road',
  label: '--map-label',
  labelStrong: '--map-label-strong',
  labelHalo: '--map-label-halo',
  pinOfficial: '--pin-official',
  pinCommunity: '--pin-community',
  pinHalo: '--pin-halo',
  link: '--pin-link',
  selected: '--pin-selected',
  clusterFill: '--cluster-fill',
  clusterRing: '--cluster-ring',
  clusterInk: '--cluster-ink',
};

/** Read the palette from the CSS tokens currently applied to `el` (src/styles/tokens.css). */
export function readPalette(el: Element = document.documentElement): MapPalette {
  const cs = getComputedStyle(el);
  const out = {} as MapPalette;
  for (const [k, v] of Object.entries(TOKENS))
    out[k as keyof MapPalette] = cs.getPropertyValue(v).trim();
  return out;
}

type Kind = 'background' | 'water' | 'boundary' | 'road' | 'country-label' | 'city-label';

/**
 * Which basemap layers survive, by role. Everything else (POIs, buildings, landuse, parks,
 * minor/most roads, rail, aeroways, road names and shields, water names, state/town/village
 * labels, state boundaries) is dropped. Works on both the Positron and Dark layer ids.
 */
export function classifyLayer(layer: LayerSpecification): Kind | null {
  if (layer.type === 'background') return 'background';
  const sl = 'source-layer' in layer ? layer['source-layer'] : undefined;
  if (sl === 'water' && layer.type === 'fill') return 'water';
  if (/^boundary_(2|country)/.test(layer.id)) return 'boundary';
  if (/^highway_motorway_inner$/.test(layer.id)) return 'road';
  if (sl === 'place' && layer.type === 'symbol') {
    if (/country/.test(layer.id)) return 'country-label';
    if (/city/.test(layer.id)) return 'city-label';
  }
  return null;
}

const halo = (p: MapPalette) => ({
  'text-halo-color': p.labelHalo,
  'text-halo-width': 1.25,
  'text-halo-blur': 0.5,
});

function restyle(layer: LayerSpecification, kind: Kind, p: MapPalette): LayerSpecification {
  switch (kind) {
    case 'background':
      return { id: layer.id, type: 'background', paint: { 'background-color': p.land } };
    case 'water':
      return {
        ...layer,
        paint: { 'fill-color': p.water, 'fill-antialias': false },
      } as LayerSpecification;
    case 'boundary':
      return {
        ...layer,
        paint: {
          'line-color': p.boundary,
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.6, 5, 1, 10, 1.5],
        },
      } as LayerSpecification;
    case 'road':
      return {
        ...layer,
        minzoom: Math.max(layer.minzoom ?? 0, 6),
        paint: {
          'line-color': p.road,
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 10, 1.5, 14, 3],
        },
      } as LayerSpecification;
    case 'country-label':
    case 'city-label': {
      const sym = layer as SymbolLayerSpecification;
      const layout = { ...sym.layout };
      // No city dots: the only marks on the map are ours.
      delete layout['icon-image'];
      delete layout['icon-size'];
      delete layout['icon-optional'];
      delete layout['icon-allow-overlap'];
      const country = kind === 'country-label';
      // Latin names only (the base styles add a second, non-Latin line).
      layout['text-field'] = [
        'coalesce',
        ['get', 'name:en'],
        ['get', 'name_en'],
        ['get', 'name:latin'],
        ['get', 'name'],
      ];
      return {
        ...sym,
        layout: {
          ...layout,
          'text-font': ['Noto Sans Regular'],
          ...(country
            ? {
                'text-transform': 'uppercase',
                'text-letter-spacing': 0.08,
                'text-size': ['interpolate', ['linear'], ['zoom'], 1, 9, 4, 11, 6, 12],
              }
            : { 'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 8, 12, 12, 14] }),
        },
        paint: { 'text-color': country ? p.label : p.labelStrong, ...halo(p) },
      } as LayerSpecification;
    }
  }
}

/** Strip a fetched OpenFreeMap style down to a muted grayscale basemap in `p`'s colours. */
export function quietBasemap(style: StyleSpecification, p: MapPalette): StyleSpecification {
  const layers = style.layers.flatMap((l) => {
    const kind = classifyLayer(l);
    return kind ? [restyle(l, kind, p)] : [];
  });
  return { ...style, layers };
}

// ---------------------------------------------------------------------------
// Data layers
// ---------------------------------------------------------------------------

export const SRC = {
  pins: 'pins',
  focus: 'focus',
  links: 'links',
  // Timeline choreography (Play, history mode): unclustered, animated through feature-state.
  anim: 'anim',
  animLinks: 'anim-links',
  historyPath: 'history-path',
  historyHead: 'history-head',
  historyLabels: 'history-labels',
  // Home (DESIGN §6.5): its marker, and lines to the selected conference's sites.
  home: 'home',
  homeLines: 'home-lines',
} as const;

export const LAYER = {
  links: 'links',
  clusters: 'clusters',
  clusterCount: 'cluster-count',
  pinHalo: 'pin-halo',
  pin: 'pin',
  pinLock: 'pin-lock',
  focusRing: 'focus-ring',
  focusHalo: 'focus-halo',
  focusPin: 'focus-pin',
  focusLock: 'focus-lock',
  animLinks: 'anim-links',
  animRing: 'anim-ring',
  animHalo: 'anim-halo',
  animPin: 'anim-pin',
  animLock: 'anim-lock',
  historyCasing: 'history-casing',
  historyPath: 'history-path',
  historyHead: 'history-head',
  historyLabels: 'history-labels',
  homeLines: 'home-lines',
  home: 'home',
  collide: 'collide',
  focusCollide: 'focus-collide',
} as const;

/** Layers that represent a single location (hover/click targets). */
export const PIN_LAYERS = [LAYER.pin, LAYER.focusPin, LAYER.animPin];

/** The resting (clustered) presentation, swapped out while the timeline animates. */
export const CLUSTER_LAYERS = [
  LAYER.links,
  LAYER.clusters,
  LAYER.clusterCount,
  LAYER.pinHalo,
  LAYER.pin,
  LAYER.pinLock,
];
/** The animated presentation (Play, history mode): every location, one pin each, no clusters. */
export const ANIM_LAYERS = [
  LAYER.animLinks,
  LAYER.animRing,
  LAYER.animHalo,
  LAYER.animPin,
  LAYER.animLock,
];

export const CLUSTER_MAX_ZOOM = 12;
export const MAP_MAX_ZOOM = 12;
const CLUSTER_RADIUS = 36;

/** Pin radii (px): main venue larger than satellites. */
const R_MAIN = 7;
const R_SAT = 5;
const radius: ExpressionSpecification = ['case', ['==', ['get', 'main'], 1], R_MAIN, R_SAT];
const plus = (n: number): ExpressionSpecification => ['+', radius, n];

export const lockImageId = (theme: ResolvedTheme) => `lock-badge-${theme}`;
/** A transparent 1×1 image: `collide` scales it to each pin's / cluster's footprint. */
export const COLLIDER_IMAGE = 'collider';

/** Animated pins (Play, history mode) are drawn a little smaller: crowded areas stay legible. */
const ANIM_SCALE = 0.85;

export type Emphasis = { selectedId: string | null; hoveredId: string | null };

/** Opacity of regular pins: others dim while a conference is selected. */
export function pinOpacity(selectedId: string | null): ExpressionSpecification | number {
  if (!selectedId) return 1;
  return ['case', ['==', ['get', 'conferenceId'], selectedId], 1, 0.4];
}

/** A feature-state number (set by the choreographer), with a default. */
const fs = (key: string, fallback: number): ExpressionSpecification => [
  'coalesce',
  ['feature-state', key],
  fallback,
];

/** Animated pins: the choreographer's opacity (`o`) × the selection dimming. */
export function animOpacity(selectedId: string | null): ExpressionSpecification {
  return ['*', fs('o', 0), pinOpacity(selectedId)];
}

/** The live ripple ring: its own opacity (`ro`) × the selection dimming. */
export function animRingOpacity(selectedId: string | null): ExpressionSpecification {
  return ['*', fs('ro', 0), pinOpacity(selectedId)];
}

/**
 * Animated links: their own fade (`o` property) × the usual emphasis. In history mode the path is
 * the subject: satellite links (which can run far off-screen) stay faint.
 */
export function animLinkOpacity(e: Emphasis, history = false): ExpressionSpecification {
  return ['*', ['get', 'o'], linkOpacity(e), history ? 0.3 : 1];
}

/** `v` (a number or an opacity expression) × `k`, for the clustered ↔ animated crossfade. */
export function fade(
  v: ExpressionSpecification | number,
  k: number,
): ExpressionSpecification | number {
  if (k === 1) return v;
  return typeof v === 'number' ? v * k : ['*', v, k];
}

export function linkOpacity(e: Emphasis): ExpressionSpecification | number {
  const ids = [e.selectedId, e.hoveredId].filter((x): x is string => !!x);
  if (!ids.length) return 0.5;
  return [
    'case',
    ['in', ['get', 'conferenceId'], ['literal', ids]],
    0.9,
    e.selectedId ? 0.15 : 0.5,
  ];
}

const pinColor = (p: MapPalette): ExpressionSpecification => [
  'case',
  ['==', ['get', 'official'], 1],
  p.pinOfficial,
  p.pinCommunity,
];

function pinPaint(p: MapPalette, r: ExpressionSpecification = radius) {
  const color = pinColor(p);
  return {
    // Official = filled; community = ring (hollow centre). Never colour alone.
    'circle-radius': r,
    'circle-color': [
      'case',
      ['==', ['get', 'official'], 1],
      color,
      p.pinHalo,
    ] as ExpressionSpecification,
    'circle-stroke-color': color,
    'circle-stroke-width': [
      'case',
      ['==', ['get', 'official'], 1],
      0,
      2.25,
    ] as ExpressionSpecification,
    'circle-pitch-alignment': 'map' as const,
  };
}

function lockLayout(theme: ResolvedTheme) {
  return {
    'icon-image': lockImageId(theme),
    'icon-allow-overlap': true,
    'icon-ignore-placement': true,
    // Badge sits on the pin's upper-right edge.
    'icon-offset': ['case', ['==', ['get', 'main'], 1], ['literal', [7, -7]], ['literal', [5, -5]]],
  } as SymbolLayerSpecification['layout'];
}

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

export type DataSources = {
  pins: FeatureCollection;
  focus: FeatureCollection;
  links: FeatureCollection;
  anim: FeatureCollection;
  animLinks: FeatureCollection;
  historyPath: FeatureCollection;
  historyHead: FeatureCollection;
  historyLabels: FeatureCollection;
  home: FeatureCollection;
  homeLines: FeatureCollection;
};

export function dataSources(d: Partial<DataSources> = {}): Record<string, SourceSpecification> {
  return {
    [SRC.anim]: { type: 'geojson', data: d.anim ?? empty },
    [SRC.animLinks]: { type: 'geojson', data: d.animLinks ?? empty },
    [SRC.historyPath]: { type: 'geojson', data: d.historyPath ?? empty },
    [SRC.historyHead]: { type: 'geojson', data: d.historyHead ?? empty },
    [SRC.historyLabels]: { type: 'geojson', data: d.historyLabels ?? empty },
    [SRC.links]: { type: 'geojson', data: d.links ?? empty },
    [SRC.pins]: {
      type: 'geojson',
      data: d.pins ?? empty,
      cluster: true,
      clusterRadius: CLUSTER_RADIUS,
      clusterMaxZoom: CLUSTER_MAX_ZOOM,
    },
    [SRC.focus]: { type: 'geojson', data: d.focus ?? empty },
    [SRC.home]: { type: 'geojson', data: d.home ?? empty },
    [SRC.homeLines]: { type: 'geojson', data: d.homeLines ?? empty },
  };
}

/**
 * The app's layers, bottom to top. `animated` picks which presentation is visible: the resting
 * clustered one, or the timeline's animated one (see CLUSTER_LAYERS / ANIM_LAYERS).
 */
export function dataLayers(
  p: MapPalette,
  theme: ResolvedTheme,
  e: Emphasis,
  animated = false,
  history = false,
): LayerSpecification[] {
  const unclustered: ExpressionSpecification = ['!', ['has', 'point_count']];
  const resting = { visibility: animated ? 'none' : 'visible' } as const;
  const anim = { visibility: animated ? 'visible' : 'none' } as const;
  const scaled = (r: ExpressionSpecification): ExpressionSpecification => [
    '*',
    r,
    fs('s', 1),
    ANIM_SCALE,
  ];
  const lineLayout = { 'line-cap': 'round', 'line-join': 'round' } as const;
  return [
    {
      id: LAYER.links,
      type: 'line',
      source: SRC.links,
      layout: { ...lineLayout, ...resting },
      paint: {
        'line-color': p.link,
        'line-width': 1.5,
        'line-dasharray': [2, 2],
        'line-opacity': linkOpacity(e),
      },
    },
    // Home → the selected conference's sites: solid and quiet, the nearest one stronger.
    {
      id: LAYER.homeLines,
      type: 'line',
      source: SRC.homeLines,
      layout: lineLayout,
      paint: {
        'line-color': p.selected,
        'line-width': ['case', ['==', ['get', 'nearest'], 1], 1.75, 1.25],
        'line-opacity': ['case', ['==', ['get', 'nearest'], 1], 0.7, 0.3],
      },
    },
    // History mode: the editions' path, on a halo so it reads over borders.
    {
      id: LAYER.historyCasing,
      type: 'line',
      source: SRC.historyPath,
      layout: lineLayout,
      paint: { 'line-color': p.pinHalo, 'line-width': 5, 'line-opacity': 0.6 },
    },
    {
      id: LAYER.historyPath,
      type: 'line',
      source: SRC.historyPath,
      layout: lineLayout,
      paint: { 'line-color': p.link, 'line-width': 2, 'line-opacity': 0.85 },
    },
    {
      id: LAYER.animLinks,
      type: 'line',
      source: SRC.animLinks,
      layout: { ...lineLayout, ...anim },
      paint: {
        'line-color': p.link,
        'line-width': 1.5,
        'line-dasharray': [2, 2],
        'line-opacity': animLinkOpacity(e, history),
      },
    },
    {
      id: LAYER.clusters,
      type: 'circle',
      source: SRC.pins,
      filter: ['has', 'point_count'],
      layout: resting,
      paint: {
        'circle-color': p.clusterFill,
        'circle-radius': ['step', ['get', 'point_count'], 13, 5, 16, 15, 20],
        'circle-stroke-color': p.clusterRing,
        'circle-stroke-width': 2,
        'circle-opacity': e.selectedId ? 0.6 : 1,
        'circle-stroke-opacity': e.selectedId ? 0.6 : 1,
      },
    },
    {
      id: LAYER.clusterCount,
      type: 'symbol',
      source: SRC.pins,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 12,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        ...resting,
      },
      paint: { 'text-color': p.clusterInk, 'text-opacity': e.selectedId ? 0.6 : 1 },
    },
    {
      id: LAYER.pinHalo,
      type: 'circle',
      source: SRC.pins,
      filter: unclustered,
      layout: resting,
      paint: {
        'circle-radius': plus(2.5),
        'circle-color': p.pinHalo,
        'circle-opacity': pinOpacity(e.selectedId),
      },
    },
    {
      id: LAYER.pin,
      type: 'circle',
      source: SRC.pins,
      filter: unclustered,
      layout: resting,
      paint: {
        ...pinPaint(p),
        'circle-opacity': pinOpacity(e.selectedId),
        'circle-stroke-opacity': pinOpacity(e.selectedId),
      },
    },
    {
      id: LAYER.pinLock,
      type: 'symbol',
      source: SRC.pins,
      filter: ['all', unclustered, ['==', ['get', 'locked'], 1]],
      layout: { ...lockLayout(theme), ...resting },
      paint: { 'icon-opacity': pinOpacity(e.selectedId) },
    },
    // Animated pins (timeline): opacity/scale/ripple from feature-state, positions never change.
    {
      id: LAYER.animRing,
      type: 'circle',
      source: SRC.anim,
      layout: anim,
      paint: {
        'circle-radius': ['+', ['*', radius, ANIM_SCALE], 1, ['*', fs('rs', 0), 12]],
        'circle-opacity': 0,
        'circle-stroke-color': pinColor(p),
        'circle-stroke-width': 1.5,
        'circle-stroke-opacity': animRingOpacity(e.selectedId),
        'circle-pitch-alignment': 'map',
      },
    },
    {
      id: LAYER.animHalo,
      type: 'circle',
      source: SRC.anim,
      layout: anim,
      paint: {
        'circle-radius': scaled(plus(1.5)),
        'circle-color': p.pinHalo,
        'circle-opacity': animOpacity(e.selectedId),
      },
    },
    {
      id: LAYER.animPin,
      type: 'circle',
      source: SRC.anim,
      layout: anim,
      paint: {
        ...pinPaint(p, scaled(radius)),
        'circle-opacity': animOpacity(e.selectedId),
        'circle-stroke-opacity': animOpacity(e.selectedId),
      },
    },
    {
      id: LAYER.animLock,
      type: 'symbol',
      source: SRC.anim,
      filter: ['==', ['get', 'locked'], 1],
      layout: { ...lockLayout(theme), ...anim },
      paint: { 'icon-opacity': animOpacity(e.selectedId) },
    },
    // Home: a small neutral dot (not a pin: it is not an event).
    {
      id: LAYER.home,
      type: 'circle',
      source: SRC.home,
      paint: {
        'circle-radius': 4,
        'circle-color': p.labelStrong,
        'circle-stroke-color': p.pinHalo,
        'circle-stroke-width': 2,
        'circle-pitch-alignment': 'map',
      },
    },
    // Invisible footprints of pins and clusters: basemap labels that would sit under the data
    // give way to it (symbols in higher layers are placed first).
    {
      id: LAYER.collide,
      type: 'symbol',
      source: SRC.pins,
      layout: {
        'icon-image': COLLIDER_IMAGE,
        'icon-size': [
          'case',
          ['has', 'point_count'],
          ['step', ['get', 'point_count'], 32, 5, 38, 15, 46],
          ['case', ['==', ['get', 'main'], 1], 20, 16],
        ],
        'icon-allow-overlap': true,
        'icon-ignore-placement': false,
        'icon-padding': 4,
      },
      paint: { 'icon-opacity': 0 },
    },
    {
      id: LAYER.focusCollide,
      type: 'symbol',
      source: SRC.focus,
      layout: {
        'icon-image': COLLIDER_IMAGE,
        'icon-size': ['case', ['==', ['get', 'main'], 1], 28, 24],
        'icon-allow-overlap': true,
        'icon-ignore-placement': false,
        'icon-padding': 4,
      },
      paint: { 'icon-opacity': 0 },
    },
    {
      id: LAYER.historyHead,
      type: 'circle',
      source: SRC.historyHead,
      paint: {
        'circle-radius': 4,
        'circle-color': p.link,
        'circle-stroke-color': p.pinHalo,
        'circle-stroke-width': 2,
      },
    },
    {
      id: LAYER.historyLabels,
      type: 'symbol',
      source: SRC.historyLabels,
      layout: {
        'text-field': [
          'format',
          ['get', 'years'],
          { 'text-font': ['literal', ['Noto Sans Bold']] },
          '\n',
          {},
          ['get', 'city'],
          { 'font-scale': 0.85, 'text-font': ['literal', ['Noto Sans Regular']] },
        ],
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
        'text-line-height': 1.15,
        'text-anchor': 'bottom',
        'text-offset': [0, -1],
        // Always shown, and basemap labels give way to them.
        'text-allow-overlap': true,
        'text-ignore-placement': false,
      },
      paint: {
        'text-color': p.selected,
        'text-halo-color': p.pinHalo,
        'text-halo-width': 1.5,
        'text-opacity': ['coalesce', ['get', 'o'], 1],
      },
    },
    // Focus = hovered + selected conference's sites, drawn above clusters so they stay visible.
    {
      id: LAYER.focusRing,
      type: 'circle',
      source: SRC.focus,
      paint: {
        'circle-radius': plus(6),
        'circle-color': p.pinHalo,
        'circle-opacity': 0.85,
        'circle-stroke-color': p.selected,
        'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 2, 1.25],
        'circle-stroke-opacity': ['case', ['==', ['get', 'selected'], 1], 1, 0.6],
      },
    },
    {
      id: LAYER.focusPin,
      type: 'circle',
      source: SRC.focus,
      paint: pinPaint(p),
    },
    {
      id: LAYER.focusLock,
      type: 'symbol',
      source: SRC.focus,
      filter: ['==', ['get', 'locked'], 1],
      layout: lockLayout(theme),
    },
  ];
}
