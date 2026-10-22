import { describe, expect, it } from 'vitest';
import { geocache, satellite, UPSTREAM_DIR } from '../__fixtures__';
import type { ArchiveFile, DataFile, Overrides } from '../schema';
import { archiveIds, mergeArchiveFiles } from './archive';
import { buildDataset } from './pipeline';
import { readUpstreamDir } from './upstream';
import { sanityCheck, validateDataset, type ValidationInput } from './validate';

const result = await buildDataset({
  upstream: readUpstreamDir(UPSTREAM_DIR).entries,
  satellites: [satellite()],
  overrides: {},
  archive: { conferences: [], locations: [] },
  geocache: geocache(),
  today: '2025-10-01',
});
const archive: ArchiveFile = mergeArchiveFiles(result.archive);
const data = (): DataFile =>
  structuredClone({
    generatedAt: '2025-10-01T00:00:00.000Z',
    conferences: result.conferences,
    locations: result.locations,
  });

const validate = (over: Partial<ValidationInput> = {}) =>
  validateDataset({
    data: data(),
    satellites: [satellite()],
    overrides: {},
    geocache: geocache(),
    archive,
    ...over,
  });

describe('validateDataset', () => {
  it('accepts a consistent dataset', () => {
    expect(result.errors).toEqual([]);
    expect(validate({ previousArchive: { ids: archiveIds(archive), label: 'HEAD' } })).toEqual([]);
  });

  it('rejects a satellite whose parent does not exist', () => {
    expect(validate({ satellites: [satellite({ parent: 'gamma25' })] })).toEqual([
      'satellites.yml: alpha25-copenhagen: parent "gamma25" does not exist',
    ]);
  });

  it('rejects start > end', () => {
    const d = data();
    d.conferences[0].end = '2025-05-01';
    d.locations.find((l) => l.id === 'beta25@main')!.start = '2025-08-01';
    expect(validate({ data: d, satellites: [satellite({ start: '2025-07-01' })] })).toEqual([
      'conference alpha25: start 2025-06-01 > end 2025-05-01',
      'location beta25@main: start 2025-08-01 > end 2025-07-04',
      'satellites.yml: alpha25-copenhagen: start 2025-07-01 > end 2025-06-06',
    ]);
  });

  it('rejects unresolved locations', () => {
    const d = data();
    Object.assign(d.locations[0], { lat: 0, lng: 0 });
    const gc = geocache();
    delete gc['copenhagen|denmark'];
    expect(validate({ data: d, geocache: gc })).toEqual([
      `location ${d.locations[0].id}: not geocoded (0, 0)`,
      'satellites.yml: alpha25-copenhagen: "Copenhagen, Denmark" is not geocoded (run pnpm data:build)',
    ]);
    const missing = data() as unknown as { locations: Record<string, unknown>[] };
    delete missing.locations[1].lat;
    expect(validate({ data: missing })).toEqual([
      `data.json: locations[${result.locations[1].id}].lat: Invalid input: expected number, received undefined`,
    ]);
  });

  it('rejects an archive that shrank', () => {
    const shrunk: ArchiveFile = {
      conferences: archive.conferences.filter((c) => c.id !== 'beta25'),
      locations: archive.locations.filter((l) => l.id !== 'alpha25-copenhagen'),
    };
    expect(
      validate({ archive: shrunk, previousArchive: { ids: archiveIds(archive), label: 'HEAD^1' } }),
    ).toEqual([
      'archive shrank: conference "beta25" (archived in HEAD^1) was removed',
      'archive shrank: location "alpha25-copenhagen" (archived in HEAD^1) was removed',
    ]);
  });

  it('rejects archived records missing from data.json', () => {
    const d = data();
    d.conferences = d.conferences.filter((c) => c.id !== 'beta25');
    d.locations = d.locations.filter((l) => l.conferenceId !== 'beta25');
    expect(validate({ data: d })).toEqual([
      'archived conference "beta25" is missing from data.json',
      'archived location "beta25@main" is missing from data.json',
    ]);
  });

  it('rejects duplicate ids and stale overrides', () => {
    const d = data();
    d.locations.push({ ...d.locations[0] });
    expect(
      validate({
        data: d,
        satellites: [satellite(), satellite()],
        overrides: { 'old@main': { venue: 'x' } },
      }),
    ).toEqual([
      `duplicate location id "${d.locations[0].id}"`,
      'satellites.yml: duplicate id "alpha25-copenhagen"',
      'overrides.yml: "old@main" matches no location',
    ]);
  });
});

describe('sanityCheck', () => {
  const sane = (d: DataFile = data(), over: Overrides = {}) => sanityCheck(d, over, geocache());

  it('is quiet on the fixtures', () => {
    expect(sane()).toEqual({ errors: [], warnings: [] });
  });

  it('errors on a deadline after the conference ends (one day of AoE slack)', () => {
    const d = data();
    const c = d.conferences.find((x) => x.id === 'alpha25')!; // ends 2025-06-05
    c.deadlines = [
      { type: 'ok', label: 'ok', date: '2025-06-06T11:59:59Z', timezone: 'AoE' },
      { type: 'bad', label: 'bad', date: '2025-09-18T06:59:59Z', timezone: 'GMT+02' },
    ];
    expect(sane(d).errors).toEqual([
      expect.stringMatching(
        /^conference alpha25: deadline "bad" \(2025-09-18T06:59:59Z\) is after the conference ends \(2025-06-05\)/,
      ),
    ]);
  });

  it('warns on deadlines far from the year, year/start mismatch, duplicate editions', () => {
    const d = data();
    const c = d.conferences.find((x) => x.id === 'alpha25')!;
    c.deadlines = [{ type: 'old', label: 'old', date: '2022-12-31T00:00:00Z', timezone: 'UTC' }];
    d.conferences.find((x) => x.id === 'alpha26')!.year = 2025;
    expect(sane(d).warnings).toEqual([
      'conference alpha25: deadline "old" (2022-12-31T00:00:00Z) is far from 2025',
      'conference alpha26: year 2025 but starts 2026-07-01 (upstream typo?)',
      'conference alpha26: deadline "paper" (2026-06-01T11:00:00Z) is far from 2025',
      'conferences alpha25, alpha26 are the same edition (alpha 2025)',
    ]);
  });

  it('warns on a satellite far outside its parent window', () => {
    const d = data();
    const s = d.locations.find((l) => l.id === 'alpha25-copenhagen')!;
    s.start = '2025-07-06'; // parent ends 2025-06-05
    s.end = '2025-07-07';
    expect(sane(d).warnings).toEqual([
      'satellite alpha25-copenhagen: 2025-07-06–2025-07-07 is more than 30 days from alpha25 (2025-06-01–2025-06-05)',
    ]);
  });

  it('warns on override coordinates far from every geocoded place in the country', () => {
    const ok = { 'alpha25@main': { lat: 47.07, lng: 15.44 } }; // Graz, Austria
    expect(sane(data(), ok).warnings).toEqual([]);
    const swapped = { 'alpha25@main': { lat: 16.37, lng: 48.2 } };
    expect(sane(data(), swapped).warnings).toEqual([
      expect.stringMatching(
        /^overrides\.yml: alpha25@main: \(16\.37, 48\.2\) is over 1500 km from every geocoded place in Austria/,
      ),
    ]);
  });
});
