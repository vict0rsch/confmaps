import { describe, expect, it } from 'vitest';
import { geocache, pastEntries, pastEntry, satellite, UPSTREAM_DIR } from '../__fixtures__';
import type { DataFile, Overrides, PinnedLocation } from '../schema';
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
  past: [],
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
    past: [],
    overrides,
    geocache: geocache(),
    archive,
    ...over,
  });
const loc = (d: DataFile, id: string) => d.locations.find((l) => l.id === id) as PinnedLocation;
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

const past = pastEntries();
const pastOverrides: Overrides = {
  'alpha18@main': { venue: 'Messe', start: '2018-06-05' },
  'alpha19@main': { lat: 48.9, lng: 2.4 },
};
const built = await buildDataset({
  upstream: readUpstreamDir(UPSTREAM_DIR).entries,
  satellites: [],
  past,
  overrides: pastOverrides,
  archive: { conferences: [], locations: [] },
  geocache: geocache(),
  today: '2025-10-01',
});
const pastArchive = mergeArchiveFiles(built.archive);
const pastData = (): DataFile =>
  structuredClone({
    generatedAt: '2025-10-01T00:00:00.000Z',
    conferences: built.conferences,
    locations: built.locations,
  });
const checkPast = (over: Partial<ConsistencyInput> = {}) =>
  checkConsistency({
    data: pastData(),
    satellites: [],
    past,
    overrides: pastOverrides,
    geocache: geocache(),
    archive: pastArchive,
    ...over,
  });

describe('checkConsistency on past editions', () => {
  it('accepts what the build produced', () => {
    expect(built.errors).toEqual([]);
    expect(checkPast()).toEqual([]);
  });

  it('catches past_conferences.yml edited without a rebuild', () => {
    const edited = past.map((e) =>
      e.id === 'alpha18' ? { ...e, full_name: 'Renamed', city: 'Paris', country: 'France' } : e,
    );
    expect(checkPast({ past: edited })).toEqual([
      'data.json is out of date: past conference alpha18.fullName is "Alpha Conference on Learning", ' +
        'inputs give "Renamed" (run pnpm data:build)',
      expect.stringContaining('past location alpha18@main.city is "Vienna", inputs give "Paris"'),
      expect.stringContaining(
        'past location alpha18@main.country is "Austria", inputs give "France"',
      ),
      expect.stringContaining('past location alpha18@main.lat is 48.2, inputs give 48.85'),
      expect.stringContaining('past location alpha18@main.lng is 16.37, inputs give 2.35'),
    ]);
    const online = past.map((e) =>
      e.id === 'alpha19'
        ? { ...e, format: 'virtual' as const, city: undefined, country: undefined }
        : e,
    );
    expect(checkPast({ past: online })).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'past location alpha19@main.format is "hybrid", inputs give "virtual"',
        ),
        expect.stringContaining('past location alpha19@main.lat is 48.9, inputs give undefined'),
      ]),
    );
  });

  it('checks the @main defaults of a virtual location, not its place', () => {
    const d = pastData();
    const v = d.locations.find((l) => l.id === 'alpha20@main')!;
    v.official = false;
    expect(checkPast({ data: d, archive: { conferences: [], locations: [] } })).toEqual([
      expect.stringContaining('past location alpha20@main.official is false, inputs give true'),
      'location alpha20@main: official is false, expected true',
    ]);
  });

  it('skips entries shadowed by upstream', () => {
    const clash = pastEntry('alpha18', { id: 'alpha25', year: 2025, title: 'Other' });
    expect(checkPast({ past: [...past, clash] })).toEqual([]);
  });

  it('catches a pwc/curated conference in neither past_conferences.yml nor the archive', () => {
    const d = pastData();
    conf(d, 'alpha26').source = 'curated';
    expect(checkPast({ data: d })).toEqual([
      'conference alpha26 has source "curated" but is in neither past_conferences.yml nor data/archive/',
    ]);
    // Archived pwc entries no longer in the file are fine (the archive keeps them).
    expect(checkPast({ past: [] })).toEqual([]);
    expect(checkPast({ past: [], archive: { conferences: [], locations: [] } })).toEqual([
      'conference alpha18 has source "pwc" but is in neither past_conferences.yml nor data/archive/',
      'conference alpha19 has source "pwc" but is in neither past_conferences.yml nor data/archive/',
      'conference alpha20 has source "curated" but is in neither past_conferences.yml nor data/archive/',
    ]);
  });
});
