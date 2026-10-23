// End-to-end, offline: CLI on a temp data dir with fixture upstream.
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';
import {
  geocache,
  PAST_FILE,
  pastEntries,
  pastEntry,
  satellite,
  UPSTREAM_DIR,
} from './__fixtures__';
import { main as build, massDropError } from './build-data';
import { stableStringify } from './lib/json';
import { main as validate } from './validate-data';

let dir: string;
const read = (p: string) => readFileSync(join(dir, p), 'utf8');
const run = (today: string, now: string) =>
  build(
    ['--upstream', UPSTREAM_DIR, '--offline', '--today', today, '--data-dir', dir],
    new Date(now),
  );

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'confmaps-data-'));
  writeFileSync(join(dir, 'satellites.yml'), stringify([satellite()]));
  writeFileSync(join(dir, 'overrides.yml'), '');
  writeFileSync(join(dir, 'geocache.json'), JSON.stringify(geocache()));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('data:build CLI', () => {
  it('writes deterministic outputs and keeps generatedAt when nothing changed', async () => {
    expect(await run('2025-10-01', '2025-10-01T05:00:00Z')).toBe(0);
    expect(readdirSync(join(dir, 'archive'))).toEqual(['2025.json']);
    const first = {
      data: read('build/data.json'),
      archive: read('archive/2025.json'),
      cache: read('geocache.json'),
    };
    expect(JSON.parse(first.data).generatedAt).toBe('2025-10-01T05:00:00.000Z');
    expect(Object.keys(JSON.parse(first.cache))).toEqual(Object.keys(geocache()).sort());

    expect(await run('2025-10-02', '2025-10-02T05:00:00Z')).toBe(0);
    expect(read('build/data.json')).toBe(first.data);
    expect(read('archive/2025.json')).toBe(first.archive);
    expect(read('geocache.json')).toBe(first.cache);

    // A real change bumps generatedAt.
    writeFileSync(join(dir, 'overrides.yml'), stringify({ 'alpha26@main': { venue: 'Hall B' } }));
    expect(await run('2025-10-03', '2025-10-03T05:00:00Z')).toBe(0);
    expect(JSON.parse(read('build/data.json')).generatedAt).toBe('2025-10-03T05:00:00.000Z');

    expect(validate(['--data-dir', dir])).toBe(0);
  });

  it('never drops archived events and fails without writing on errors', async () => {
    expect(await run('2025-10-01', '2025-10-01T05:00:00Z')).toBe(0);
    writeFileSync(join(dir, 'satellites.yml'), '[]');
    expect(await run('2025-10-02', '2025-10-02T05:00:00Z')).toBe(0);
    expect(
      JSON.parse(read('archive/2025.json')).locations.map((l: { id: string }) => l.id),
    ).toContain('alpha25-copenhagen');

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = read('build/data.json');
    writeFileSync(join(dir, 'satellites.yml'), stringify([satellite({ id: 'x', parent: 'nope' })]));
    expect(await run('2025-10-03', '2025-10-03T05:00:00Z')).toBe(1);
    expect(read('build/data.json')).toBe(before);
  });

  it('flushes successful geocache lookups even when the build throws', async () => {
    const cache = geocache();
    delete cache['paris|france'];
    delete cache['vienna|austria'];
    writeFileSync(join(dir, 'geocache.json'), JSON.stringify(cache));
    // alpha25@main (Vienna) is geocoded before alpha26@main (Paris); Paris then fails hard.
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes('Vienna')
        ? new Response(
            JSON.stringify([
              {
                lat: '48.2',
                lon: '16.37',
                display_name: 'Vienna',
                addresstype: 'city',
                address: { country_code: 'at' },
              },
            ]),
          )
        : new Response('', { status: 403 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(
        build(['--upstream', UPSTREAM_DIR, '--today', '2025-10-01', '--data-dir', dir]),
      ).rejects.toThrow(/HTTP 403/);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(JSON.parse(read('geocache.json'))['vienna|austria']).toEqual({
      lat: 48.2,
      lng: 16.37,
      display_name: 'Vienna',
    });
  });

  it('refuses a mass drop of upstream conferences unless allowed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run('2025-01-01', '2025-01-01T05:00:00Z')).toBe(0); // 3 upstream conferences
    const partial = join(dir, 'partial');
    mkdirSync(partial);
    copyFileSync(join(UPSTREAM_DIR, 'alpha.yml'), join(partial, 'alpha.yml')); // 2 of 3
    const args = ['--upstream', partial, '--offline', '--today', '2025-01-01', '--data-dir', dir];
    const before = read('build/data.json');
    expect(await build(args)).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('upstream conferences dropped from 3 to 2'),
    );
    expect(read('build/data.json')).toBe(before);
    expect(await build([...args, '--allow-mass-drop'])).toBe(0);
  });

  it('massDropError tolerates up to 20%', () => {
    expect(massDropError(0, 0)).toBeUndefined();
    expect(massDropError(100, 80)).toBeUndefined();
    expect(massDropError(100, 79)).toMatch(/dropped from 100 to 79/);
  });
});

describe('data:validate CLI', () => {
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });

  it('--require-against fails when the ref is missing; --against only warns', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run('2025-10-01', '2025-10-01T05:00:00Z')).toBe(0);
    expect(validate(['--data-dir', dir, '--against', 'nope'])).toBe(0);
    expect(validate(['--data-dir', dir, '--require-against', 'nope'])).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('archive-shrink check impossible: git ref "nope" not found'),
    );
  });

  it('--require-against compares with the archive committed at the ref', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run('2025-10-01', '2025-10-01T05:00:00Z')).toBe(0);
    git('init', '-q');
    git('add', '.');
    git(
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'base',
    );
    expect(validate(['--data-dir', dir, '--require-against', 'HEAD'])).toBe(0);
    const a = JSON.parse(read('archive/2025.json'));
    a.conferences = a.conferences.filter((c: { id: string }) => c.id !== 'beta25');
    a.locations = a.locations.filter((l: { id: string }) => l.id !== 'beta25@main');
    writeFileSync(join(dir, 'archive/2025.json'), JSON.stringify(a));
    expect(validate(['--data-dir', dir, '--require-against', 'HEAD'])).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('archive shrank: conference "beta25" (archived in HEAD) was removed'),
    );
  });

  it('rejects an id in two archive year files and a stale data.json', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run('2025-10-01', '2025-10-01T05:00:00Z')).toBe(0);
    writeFileSync(join(dir, 'archive/2024.json'), read('archive/2025.json'));
    expect(validate(['--data-dir', dir])).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'archive: conference "alpha25" is in both archive/2024.json and archive/2025.json',
      ),
    );
    // The next build heals the stale copy.
    expect(await run('2025-10-02', '2025-10-02T05:00:00Z')).toBe(0);
    expect(validate(['--data-dir', dir])).toBe(0);

    // data.json hand-edited away from satellites.yml → out of date.
    const d = JSON.parse(read('build/data.json'));
    d.locations.find((l: { id: string }) => l.id === 'alpha25-copenhagen').name = 'Edited';
    writeFileSync(join(dir, 'build/data.json'), JSON.stringify(d));
    expect(validate(['--data-dir', dir])).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('satellite alpha25-copenhagen.name is "Edited"'),
    );
  });
});

describe('past editions end to end', () => {
  it('builds, freezes and validates data/past_conferences.yml offline', async () => {
    copyFileSync(PAST_FILE, join(dir, 'past_conferences.yml'));
    expect(await run('2025-10-01', '2025-10-01T05:00:00Z')).toBe(0);
    const files = readdirSync(join(dir, 'archive'));
    expect(files).toEqual(['2018.json', '2019.json', '2020.json', '2025.json']);
    expect(read('build/data.json')).toMatchSnapshot('data.json');
    for (const f of files) expect(read(`archive/${f}`)).toMatchSnapshot(`archive/${f}`);
    expect(read('geocache.json')).toBe(stableStringify(geocache()));
    expect(validate(['--data-dir', dir])).toBe(0);

    // Rebuilding is a no-op.
    const before = read('build/data.json');
    expect(await run('2025-10-02', '2025-10-02T05:00:00Z')).toBe(0);
    expect(read('build/data.json')).toBe(before);
  });

  it('data:validate fails while a "# review:" comment is left', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const path = join(dir, 'past_conferences.yml');
    copyFileSync(PAST_FILE, path);
    expect(await run('2025-10-01', '2025-10-01T05:00:00Z')).toBe(0);
    const text = read('past_conferences.yml');
    writeFileSync(
      path,
      text
        .replace('- id: alpha19', '- id: alpha19 #  Review: covid')
        .replace('format: virtual', 'format: virtual # review: stale'),
    );
    expect(await run('2025-10-01', '2025-10-01T05:00:00Z')).toBe(0); // the build does not care
    expect(validate(['--data-dir', dir])).toBe(1);
    const at = (s: string) => text.split('\n').findIndex((l) => l.includes(s)) + 1;
    expect(console.error).toHaveBeenCalledWith(
      `  ✗ past_conferences.yml: 2 unresolved "# review:" comment(s) (line ${at('- id: alpha19')}, ` +
        `${at('format: virtual')}); resolve each one and delete the comment before merging`,
    );
    writeFileSync(path, text);
    expect(validate(['--data-dir', dir])).toBe(0);
  });

  it('warns, without failing, when upstream has the same id (HF wins)', async () => {
    const clash = { ...pastEntry('alpha18'), id: 'alpha25', year: 2025 };
    Object.assign(clash, { start: '2025-05-01', end: '2025-05-02' });
    writeFileSync(join(dir, 'past_conferences.yml'), stringify([...pastEntries(), clash]));
    expect(await run('2025-10-01', '2025-10-01T05:00:00Z')).toBe(0);
    expect(console.warn).toHaveBeenCalledWith(
      '  ⚠ past_conferences.yml: "alpha25" is also upstream (HF wins); remove it',
    );
    const alpha25 = JSON.parse(read('build/data.json')).conferences.find(
      (c: { id: string }) => c.id === 'alpha25',
    );
    expect(alpha25).toMatchObject({ source: 'hf', start: '2025-06-01' });
    expect(validate(['--data-dir', dir])).toBe(0);
  });
});
