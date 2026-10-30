import { describe, expect, it } from 'vitest';
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { classifyLayer, dataLayers, fade, quietBasemap, type MapPalette } from './style';

const p = Object.fromEntries(
  [
    'land',
    'water',
    'boundary',
    'road',
    'label',
    'labelStrong',
    'labelHalo',
    'pinOfficial',
    'pinCommunity',
    'pinHalo',
    'link',
    'selected',
    'home',
    'clusterFill',
    'clusterRing',
    'clusterInk',
  ].map((k) => [k, `#${k.length.toString(16).padStart(6, '0')}`]),
) as MapPalette;

const l = (id: string, type: string, sourceLayer?: string, extra = {}) =>
  ({
    id,
    type,
    source: 'openmaptiles',
    ...(sourceLayer ? { 'source-layer': sourceLayer } : {}),
    ...extra,
  }) as LayerSpecification;

describe('quietBasemap', () => {
  const style: StyleSpecification = {
    version: 8,
    sources: {},
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': 'red' } },
      l('water', 'fill', 'water'),
      l('park', 'fill', 'park'),
      l('building', 'fill', 'building'),
      l('highway_minor', 'line', 'transportation'),
      l('highway_motorway_inner', 'line', 'transportation', { minzoom: 4 }),
      l('boundary_2', 'line', 'boundary'),
      l('boundary_3', 'line', 'boundary'),
      l('poi', 'symbol', 'poi'),
      l('label_village', 'symbol', 'place'),
      l('label_city', 'symbol', 'place', {
        layout: { 'icon-image': 'dot', 'text-field': '{name}' },
      }),
      l('place_country_major', 'symbol', 'place'),
      l('highway-name-major', 'symbol', 'transportation_name'),
    ],
  };

  it('keeps only the quiet layers', () => {
    expect(quietBasemap(style, p).layers.map((x) => x.id)).toEqual([
      'background',
      'water',
      'highway_motorway_inner',
      'boundary_2',
      'label_city',
      'place_country_major',
    ]);
  });

  it('recolours and strips label icons', () => {
    const out = quietBasemap(style, p).layers;
    expect(out[0]).toMatchObject({ paint: { 'background-color': p.land } });
    const city = out.find((x) => x.id === 'label_city') as Extract<
      LayerSpecification,
      { type: 'symbol' }
    >;
    expect(city.layout?.['icon-image']).toBeUndefined();
    expect(city.paint?.['text-color']).toBe(p.labelStrong);
    expect(out.find((x) => x.id === 'highway_motorway_inner')?.minzoom).toBe(6);
  });

  it('classifies dark-style ids too', () => {
    expect(classifyLayer(l('boundary_country_z5-', 'line', 'boundary'))).toBe('boundary');
    expect(classifyLayer(l('place_city_large', 'symbol', 'place'))).toBe('city-label');
    expect(classifyLayer(l('place_town', 'symbol', 'place'))).toBeNull();
  });
});

describe('dataLayers', () => {
  it('has unique ids and dims non-selected pins only when selected', () => {
    const none = dataLayers(p, 'light', { selectedId: null, hoveredId: null });
    expect(new Set(none.map((x) => x.id)).size).toBe(none.length);
    const pin = (ls: LayerSpecification[]) =>
      ls.find((x) => x.id === 'pin') as Extract<LayerSpecification, { type: 'circle' }>;
    expect(pin(none).paint?.['circle-opacity']).toBe(1);
    const sel = dataLayers(p, 'dark', { selectedId: 'n26', hoveredId: null });
    expect(pin(sel).paint?.['circle-opacity']).toEqual([
      'case',
      ['==', ['get', 'conferenceId'], 'n26'],
      1,
      0.4,
    ]);
  });

  it('makes basemap labels give way to pins and clusters (an invisible collider on top)', () => {
    const ls = dataLayers(p, 'light', { selectedId: null, hoveredId: null });
    const ids = ls.map((x) => x.id);
    for (const id of ['collide', 'focus-collide']) {
      const c = ls.find((x) => x.id === id) as Extract<LayerSpecification, { type: 'symbol' }>;
      expect(c.layout?.['icon-allow-overlap']).toBe(true);
      expect(c.layout?.['icon-ignore-placement']).toBe(false);
      expect(c.paint?.['icon-opacity']).toBe(0);
    }
    // Home lines sit under the pins; the home marker over them.
    expect(ids.indexOf('home-lines')).toBeLessThan(ids.indexOf('clusters'));
    expect(ids.indexOf('home')).toBeGreaterThan(ids.indexOf('pin'));
  });

  it('draws home as a dot in its own colour', () => {
    const ls = dataLayers(p, 'light', { selectedId: null, hoveredId: null });
    const home = ls.find((x) => x.id === 'home') as Extract<LayerSpecification, { type: 'circle' }>;
    expect(home.paint?.['circle-color']).toBe(p.home);
  });
});

describe('fade', () => {
  it('scales numbers and wraps expressions, leaving full opacity untouched', () => {
    expect(fade(0.6, 0.5)).toBe(0.3);
    expect(fade(['get', 'o'], 1)).toEqual(['get', 'o']);
    expect(fade(['get', 'o'], 0.25)).toEqual(['*', ['get', 'o'], 0.25]);
  });
});
