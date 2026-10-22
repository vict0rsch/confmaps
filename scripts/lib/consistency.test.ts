import { describe, expect, it } from 'vitest';
import { geocache, satellite, UPSTREAM_DIR } from '../__fixtures__';
import type { DataFile, Overrides } from '../schema';
import { mergeArchiveFiles } from './archive';
import { checkConsistency, type ConsistencyInput } from './consistency';
import { buildDataset } from './pipeline';
import { readUpstreamDir } from './upstream';

const overrides: Overrides = {
  'alpha26@main': { venue: 'Hall B', start: '2026-07-02' },
  'alpha25-copenhagen': { access: 'authors_only', lat: 55.6, lng: 12.6 },
  'beta25@main': {
    deadlines: [{ type: 'paper', date: '2024-10-01 23:59:59', timezone: 'AoE' }],
  },
};
const result = await buildDataset({
  upstream: readUpstreamDir(UPSTREAM_DIR).entries,
  satellites: [satellite()],
  overrides,
  archive: { conferences: [], locations: [] },
  geocache: geocache(),
  today: '2025-10-01',
});
const archive = mergeArchiveFiles(result.archive);
const data = (): DataFile =>
  structuredClone({
    generatedAt: '2025-10-01T00:00:00.000Z',
    conferences: result.conferences,
    locations: result.locations,
  });
const check = (over: Partial<ConsistencyInput> = {}) =>
  checkConsistency({
    data: data(),
    satellites: [satellite()],
    overrides,
    geocache: geocache(),
    archive,
    ...over,
  });
const loc = (d: DataFile, id: string) => d.locations.find((l) => l.id === id)!;
const conf = (d: DataFile, id: string) => d.conferences.find((c) => c.id === id)!;

describe('checkConsistency', () => {
  it('accepts what the build produced', () => {
    expect(result.errors).toEqual([]);
    expect(check()).toEqual([]);
  });

  it('catches a satellite that differs from satellites.yml', () => {
    const errors = check({ satellites: [satellite({ name: 'Renamed' })] });
    expect(errors).toEqual([
      'data.json is out of date: satellite alpha25-copenhagen.name is "Alpha 2025 Copenhagen", ' +
        'inputs give "Renamed" (run pnpm data:build)',
    ]);
    // Override and geocache changes reach satellites too.
    expect(
      check({ overrides: { ...overrides, 'alpha25-copenhagen': { access: 'open' } } }),
    ).toEqual([
      expect.stringContaining(
        'satellite alpha25-copenhagen.access is "authors_only", inputs give "open"',
      ),
      expect.stringContaining('satellite alpha25-copenhagen.lat is 55.6, inputs give 55.69'),
      expect.stringContaining('satellite alpha25-copenhagen.lng is 12.6, inputs give 12.57'),
      expect.stringContaining('location alpha25-copenhagen: (55.6, 12.6) differs from geocache'),
      'location alpha25-copenhagen: access is "authors_only", override says "open"',
    ]);
  });

  it('catches an archived record edited in data.json', () => {
    const d = data();
    loc(d, 'beta25@main').venue = 'Somewhere';
    expect(check({ data: d })).toEqual([
      expect.stringContaining('archived location beta25@main.venue is "Somewhere"'),
    ]);
  });

  it('catches a hand-edited coordinate, series, override field, and deadlines', () => {
    const d = data();
    loc(d, 'alpha26@main').lat = 1;
    loc(d, 'alpha26@main').venue = 'Hall C';
    conf(d, 'alpha26').series = 'other';
    const errors = check({ data: d });
    expect(errors).toEqual([
      'conference alpha26: series "other", title gives "alpha"',
      expect.stringContaining(
        'location alpha26@main: (1, 2.35) differs from geocache "paris|france"',
      ),
      'location alpha26@main: venue is "Hall C", override says "Hall B"',
    ]);
    const e = data();
    conf(e, 'alpha26').start = '2026-07-01';
    expect(check({ data: e })).toEqual([
      'location alpha26@main: start is "2026-07-02", expected "2026-07-01"',
    ]);
  });

  it('catches beta25 deadlines that ignore the override', () => {
    const d = data();
    conf(d, 'beta25').deadlines = [];
    expect(check({ data: d })).toEqual(
      expect.arrayContaining([
        'conference beta25: deadlines differ from the "beta25@main" override (run pnpm data:build)',
      ]),
    );
  });

  it('catches records no input produces', () => {
    const d = data();
    d.locations.push({ ...loc(d, 'alpha25-copenhagen'), id: 'ghost', notes: 'x' });
    conf(d, 'alpha26').source = 'archive';
    loc(d, 'alpha26@main').country = 'France ';
    expect(check({ data: d })).toEqual([
      'conference alpha26 has source "archive" but is not in data/archive/',
      'location alpha26@main: country "France " is not a canonical name',
      'location ghost: satellite in neither satellites.yml nor the archive',
      expect.stringContaining('location ghost: (55.6, 12.6) differs from geocache'),
    ]);
  });
});
