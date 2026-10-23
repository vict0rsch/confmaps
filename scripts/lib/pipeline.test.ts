import { describe, expect, it, vi } from 'vitest';
import { geocache, satellite, UPSTREAM_DIR } from '../__fixtures__';
import type { ArchiveFile, Overrides, Satellite } from '../schema';
import { mergeArchiveFiles } from './archive';
import type { Geocoder } from './geocode';
import { buildDataset, type BuildInputs } from './pipeline';
import { readUpstreamDir } from './upstream';

const upstream = readUpstreamDir(UPSTREAM_DIR).entries;
const EMPTY: ArchiveFile = { conferences: [], locations: [] };

const build = (over: Partial<BuildInputs> = {}) =>
  buildDataset({
    upstream,
    satellites: [satellite()],
    overrides: {},
    archive: EMPTY,
    geocache: geocache(),
    today: '2025-10-01',
    ...over,
  });

describe('archive-and-freeze', () => {
  it('freezes events that ended before today, grouped by conference year', async () => {
    const r = await build();
    expect(r.errors).toEqual([]);
    expect([...r.archive.keys()]).toEqual([2025]);
    const a = r.archive.get(2025)!;
    expect(a.conferences.map((c) => c.id)).toEqual(['alpha25', 'beta25']);
    expect(a.locations.map((l) => l.id)).toEqual([
      'alpha25-copenhagen',
      'alpha25@main',
      'beta25@main',
    ]);
  });

  it('uses the UTC date boundary: an event ending today is not frozen yet', async () => {
    expect((await build({ today: '2025-06-05' })).archive.size).toBe(0);
    const r = await build({ today: '2025-06-06' });
    expect(r.archive.get(2025)?.conferences.map((c) => c.id)).toEqual(['alpha25']);
  });

  it('keeps archived events when upstream and satellites.yml drop them', async () => {
    const first = await build();
    const archive = mergeArchiveFiles(first.archive);
    const second = await build({
      upstream: upstream.filter((e) => e.id !== 'alpha25'),
      satellites: [],
      archive,
    });
    expect(second.errors).toEqual([]);
    const alpha = second.conferences.find((c) => c.id === 'alpha25');
    expect(alpha?.source).toBe('archive');
    expect(second.locations.map((l) => l.id)).toContain('alpha25-copenhagen');
    expect(second.locations.map((l) => l.id)).toContain('alpha25@main');
    const ids = mergeArchiveFiles(second.archive);
    expect(ids.conferences.map((c) => c.id)).toEqual(['alpha25', 'beta25']);
    expect(ids.locations).toHaveLength(3);
  });

  it('lets upstream update an archived event while it still has it', async () => {
    const archive = mergeArchiveFiles((await build()).archive);
    const renamed = upstream.map((e) => (e.id === 'alpha25' ? { ...e, venue: 'New Hall' } : e));
    const r = await build({ upstream: renamed, archive });
    const frozen = r.archive.get(2025)!.locations.find((l) => l.id === 'alpha25@main');
    expect(frozen).toMatchObject({ venue: 'New Hall' });
    expect(r.conferences.find((c) => c.id === 'alpha25')?.source).toBe('hf');
  });

  it('keeps previously archived records even if their dates move into the future', async () => {
    const archive = mergeArchiveFiles((await build()).archive);
    const sats: Satellite[] = [satellite({ start: '2030-01-01', end: '2030-01-02' })];
    const r = await build({ satellites: sats, archive });
    expect(r.archive.get(2025)!.locations.map((l) => l.id)).toContain('alpha25-copenhagen');
  });
});

describe('overrides', () => {
  it('take precedence over upstream, satellites and the geocache', async () => {
    const overrides: Overrides = {
      'alpha25@main': { venue: 'Fixed Venue', lat: 1.5, lng: 2.5 },
      'alpha25-copenhagen': { access: 'authors_only', presents_papers: false },
      'beta25@main': { start: '2025-07-01', end: '2025-07-03', reason: 'typo upstream' },
    };
    const r = await build({ overrides });
    expect(r.errors).toEqual([]);
    const loc = (id: string) => r.locations.find((l) => l.id === id)!;
    expect(loc('alpha25@main')).toMatchObject({ venue: 'Fixed Venue', lat: 1.5, lng: 2.5 });
    expect(loc('alpha25-copenhagen')).toMatchObject({
      access: 'authors_only',
      presentsPapers: false,
    });
    expect(loc('beta25@main')).toMatchObject({ start: '2025-07-01', end: '2025-07-03' });
    expect(r.conferences.find((c) => c.id === 'beta25')).toMatchObject({
      start: '2025-07-01',
      end: '2025-07-03',
    });
    expect(loc('beta25@main')).not.toHaveProperty('reason');
  });

  it('apply to archive-only records too', async () => {
    const archive = mergeArchiveFiles((await build()).archive);
    const r = await build({
      upstream: [],
      satellites: [],
      archive,
      overrides: { 'alpha25@main': { venue: 'Later fix' } },
    });
    expect(r.locations.find((l) => l.id === 'alpha25@main')).toMatchObject({ venue: 'Later fix' });
  });

  it('report unknown location ids', async () => {
    const r = await build({ overrides: { 'nope@main': { venue: 'x' } } });
    expect(r.errors).toEqual(['overrides.yml: "nope@main" matches no location']);
  });
});

describe('countries and geocoding', () => {
  it('canonicalizes country names (US state → United States)', async () => {
    const r = await build();
    expect(r.locations.find((l) => l.id === 'beta25@main')).toMatchObject({
      country: 'United States',
    });
  });

  it('uses the cache, and calls the geocoder once per missing key with the country code', async () => {
    const cache = geocache();
    delete cache['paris|france'];
    const geocoder = vi.fn<Geocoder>(async () => ({ lat: 48.8, lng: 2.3, display_name: 'Paris' }));
    const sats = [
      satellite(),
      satellite({ id: 'alpha25-paris', city: 'Paris', country: 'France' }),
    ];
    const r = await build({ geocache: cache, geocoder, satellites: sats });
    expect(r.errors).toEqual([]);
    expect(geocoder).toHaveBeenCalledTimes(1);
    expect(geocoder).toHaveBeenCalledWith('Paris', 'France', 'fr');
    expect(cache['paris|france']).toEqual({ lat: 48.8, lng: 2.3, display_name: 'Paris' });
  });

  it('fails on unresolved locations, offline or when the geocoder finds nothing', async () => {
    const cache = geocache();
    delete cache['vienna|austria'];
    const offline = await build({ geocache: { ...cache } });
    expect(offline.errors).toEqual([
      expect.stringMatching(/^alpha25@main: unresolved location "Vienna, Austria".*offline/),
    ]);
    const online = await build({ geocache: { ...cache }, geocoder: async () => undefined });
    expect(online.errors).toEqual([expect.stringMatching(/^alpha25@main: unresolved location/)]);
  });

  it('fails on an unknown country', async () => {
    const r = await build({ satellites: [satellite({ country: 'Atlantis' })] });
    expect(r.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('alpha25-copenhagen: unknown country "Atlantis"'),
      ]),
    );
  });
});

it('reports conferences whose dates cannot be determined', async () => {
  const r = await build({
    upstream: upstream.map((e) => (e.id === 'beta25' ? { ...e, date: 'TBA' } : e)),
  });
  expect(r.errors).toEqual([expect.stringContaining('conference beta25: no start/end')]);
});

describe('deadline overrides, stale overrides, series', () => {
  it('replace (or drop) a conference deadline list from its @main override', async () => {
    const r = await build({
      overrides: {
        'alpha25@main': { deadlines: [] },
        'beta25@main': {
          deadlines: [
            { type: 'paper', label: 'Paper', date: '2024-10-01 23:59:59', timezone: 'AoE' },
          ],
        },
      },
    });
    expect(r.errors).toEqual([]);
    expect(r.conferences.find((c) => c.id === 'alpha25')?.deadlines).toEqual([]);
    expect(r.conferences.find((c) => c.id === 'beta25')?.deadlines).toEqual([
      { type: 'paper', label: 'Paper', date: '2024-10-02T11:59:59Z', timezone: 'AoE' },
    ]);
  });

  it('reject deadlines on a satellite override and bad deadline timezones', async () => {
    const r = await build({
      overrides: {
        'alpha25-copenhagen': { deadlines: [] },
        'alpha25@main': {
          deadlines: [{ type: 'paper', date: '2025-01-01 00:00:00', timezone: 'Moon' }],
        },
      },
    });
    expect(r.errors).toEqual([
      'overrides.yml: alpha25-copenhagen: "deadlines" is only allowed on a "…@main" location',
      'overrides.yml: alpha25@main: deadline "paper": unknown timezone "Moon"',
    ]);
  });

  it('warn about override fields that already equal the computed value', async () => {
    const r = await build({
      overrides: {
        'alpha25@main': { venue: 'Messe Wien', city: 'Vienna', notes: 'new' },
        'alpha25-copenhagen': { access: 'open' },
      },
    });
    expect(r.warnings).toEqual([
      'overrides.yml: alpha25@main: venue, city already equal the computed value (stale override?)',
      'overrides.yml: alpha25-copenhagen: access already equal the computed value (stale override?)',
    ]);
    // Archive-only records already carry their overrides: no false "stale" warning.
    const archive = mergeArchiveFiles(r.archive);
    const later = await build({
      upstream: [],
      satellites: [],
      archive,
      overrides: { 'alpha25@main': { notes: 'new' } },
    });
    expect(later.warnings).toEqual([]);
  });

  it('recomputes the series of archived conferences (alias changes reach old editions)', async () => {
    const archive = mergeArchiveFiles((await build()).archive);
    archive.conferences = archive.conferences.map((c) => ({ ...c, series: 'old-key' }));
    const r = await build({ upstream: [], satellites: [], archive });
    expect(r.conferences.map((c) => c.series)).toEqual(['alpha', 'beta-conf-industry-track']);
  });

  it('reports geocoder warnings with the location id', async () => {
    const cache = geocache();
    delete cache['paris|france'];
    const r = await build({
      geocache: cache,
      geocoder: async () => ({ lat: 48.8, lng: 2.3, display_name: 'Paris', warning: 'doubtful' }),
    });
    expect(r.warnings).toEqual(['alpha26@main: geocoding "paris|france": doubtful']);
    expect(cache['paris|france']).toEqual({ lat: 48.8, lng: 2.3, display_name: 'Paris' });
  });
});
