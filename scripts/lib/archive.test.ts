import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { geocache, satellite, UPSTREAM_DIR } from '../__fixtures__';
import type { ArchiveFile } from '../schema';
import { mergeArchiveFiles, parseArchive, readArchiveDir, writeArchiveDir } from './archive';
import { stableStringify } from './json';
import { buildDataset } from './pipeline';
import { readUpstreamDir } from './upstream';

const upstream = readUpstreamDir(UPSTREAM_DIR).entries;
const build = (archive: ArchiveFile, up = upstream) =>
  buildDataset({
    upstream: up,
    satellites: [satellite()],
    overrides: {},
    archive,
    geocache: geocache(),
    today: '2025-10-01',
  });

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'confmaps-archive-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('archive year files', () => {
  it('reports ids present in two year files', async () => {
    const a = (await build({ conferences: [], locations: [] })).archive.get(2025)!;
    const text = stableStringify(a);
    const { duplicates } = parseArchive({ '2025.json': text, '2026.json': text });
    expect(duplicates).toContain(
      'archive: conference "alpha25" is in both archive/2025.json and archive/2026.json',
    );
    expect(duplicates).toContain(
      'archive: location "alpha25@main" is in both archive/2025.json and archive/2026.json',
    );
  });

  it('moves a record whose year upstream corrects, leaving no stale copy', async () => {
    // Archive beta25 alone under 2024 (as if upstream first said year: 2024).
    const first = await build({ conferences: [], locations: [] });
    const beta = (a: ArchiveFile): ArchiveFile => ({
      conferences: a.conferences
        .filter((c) => c.id === 'beta25')
        .map((c) => ({ ...c, year: 2024 })),
      locations: a.locations.filter((l) => l.conferenceId === 'beta25'),
    });
    const others = (a: ArchiveFile): ArchiveFile => ({
      conferences: a.conferences.filter((c) => c.id !== 'beta25'),
      locations: a.locations.filter((l) => l.conferenceId !== 'beta25'),
    });
    const a2025 = first.archive.get(2025)!;
    writeArchiveDir(
      dir,
      new Map([
        [2024, beta(a2025)],
        [2025, others(a2025)],
      ]),
    );

    const second = await build(readArchiveDir(dir).archive);
    expect([...second.archive.keys()]).toEqual([2025]);
    expect(writeArchiveDir(dir, second.archive)).toEqual(['2024.json', '2025.json']);

    const after = readArchiveDir(dir);
    expect(after.duplicates).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, '2024.json'), 'utf8'))).toEqual({
      conferences: [],
      locations: [],
    });
    expect(after.archive.conferences.map((c) => c.id).sort()).toEqual(['alpha25', 'beta25']);
  });

  it('heals a stale duplicate already on disk', async () => {
    const a = (await build({ conferences: [], locations: [] })).archive;
    writeFileSync(join(dir, '2024.json'), stableStringify(a.get(2025)!));
    writeFileSync(join(dir, '2025.json'), stableStringify(a.get(2025)!));
    const onDisk = readArchiveDir(dir);
    expect(onDisk.duplicates.length).toBeGreaterThan(0);
    const r = await build(onDisk.archive);
    writeArchiveDir(dir, r.archive);
    expect(readArchiveDir(dir).duplicates).toEqual([]);
  });

  it('refuses to write if a record on disk would leave the archive', async () => {
    const a = (await build({ conferences: [], locations: [] })).archive;
    writeArchiveDir(dir, a);
    const before = readFileSync(join(dir, '2025.json'), 'utf8');
    const merged = mergeArchiveFiles(a);
    const shrunk = new Map([
      [2025, { conferences: merged.conferences.slice(1), locations: merged.locations }],
    ]);
    expect(() => writeArchiveDir(dir, shrunk)).toThrow(
      /refusing to drop archived records: alpha25/,
    );
    expect(readFileSync(join(dir, '2025.json'), 'utf8')).toBe(before);
  });
});
