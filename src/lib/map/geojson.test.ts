import { describe, expect, it } from 'vitest';
import { joinData } from '../data/load';
import type { DataFile } from '../data/types';
import { boundsOf, greatCircle, linkFeatures, pinFeatures } from './geojson';

const base = {
  name: 'x',
  country: 'X',
  start: '2026-12-01',
  end: '2026-12-05',
  presentsPapers: true,
  link: 'https://x.example',
} as const;

const data = joinData({
  generatedAt: '2026-10-22T00:00:00.000Z',
  conferences: [
    {
      id: 'n26',
      series: 'n',
      title: 'N',
      year: 2026,
      link: 'https://n.example',
      tags: [],
      deadlines: [],
      start: '2026-12-01',
      end: '2026-12-05',
      source: 'hf',
    },
  ],
  locations: [
    {
      ...base,
      id: 'n26@main',
      conferenceId: 'n26',
      role: 'main',
      city: 'Sydney',
      lat: -33.87,
      lng: 151.21,
      official: true,
      access: 'registration',
    },
    {
      ...base,
      id: 'n26-paris',
      conferenceId: 'n26',
      role: 'satellite',
      city: 'Paris',
      lat: 48.85,
      lng: 2.35,
      official: false,
      access: 'authors_only',
    },
  ],
} satisfies DataFile);

describe('pinFeatures', () => {
  it('encodes role, kind and access as numeric props', () => {
    const fc = pinFeatures(data.pinnedLocations);
    expect(fc.features.map((f) => f.properties)).toMatchObject([
      { id: 'n26@main', main: 1, official: 1, locked: 0, label: 'N 2026' },
      { id: 'n26-paris', main: 0, official: 0, locked: 1 },
    ]);
    expect(fc.features[0].geometry.coordinates).toEqual([151.21, -33.87]);
  });
});

describe('linkFeatures', () => {
  it('links satellites to a visible main venue only', () => {
    expect(linkFeatures(data.pinnedLocations).features).toHaveLength(1);
    expect(
      linkFeatures(data.pinnedLocations.filter((l) => l.role === 'satellite')).features,
    ).toHaveLength(0);
  });
});

describe('greatCircle', () => {
  it('starts and ends at the endpoints', () => {
    const pts = greatCircle({ lat: 48.85, lng: 2.35 }, { lat: -33.87, lng: 151.21 }, 16);
    expect(pts).toHaveLength(17);
    expect(pts[0][0]).toBeCloseTo(2.35);
    expect(pts[16][1]).toBeCloseTo(-33.87);
  });

  it('stays continuous across the antimeridian', () => {
    const pts = greatCircle({ lat: -33.87, lng: 151.21 }, { lat: 21.3, lng: -157.86 }, 32);
    for (let i = 1; i < pts.length; i++)
      expect(Math.abs(pts[i][0] - pts[i - 1][0])).toBeLessThan(20);
    expect(pts.at(-1)![0]).toBeCloseTo(-157.86 + 360);
  });
});

describe('boundsOf', () => {
  it('returns null for no points and a box otherwise', () => {
    expect(boundsOf([])).toBeNull();
    expect(
      boundsOf([
        { lat: 1, lng: 2 },
        { lat: -3, lng: 10 },
      ]),
    ).toEqual([
      [2, -3],
      [10, 1],
    ]);
  });

  it('wraps across the antimeridian when shorter', () => {
    expect(
      boundsOf([
        { lat: -33.87, lng: 151.21 },
        { lat: 21.3, lng: -157.86 },
      ]),
    ).toEqual([
      [151.21, -33.87],
      [202.14, 21.3],
    ]);
  });
});
