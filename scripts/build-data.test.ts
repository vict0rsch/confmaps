// End-to-end, offline: CLI on a temp data dir with fixture upstream.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';
import { geocache, satellite, UPSTREAM_DIR } from './__fixtures__';
import { main as build } from './build-data';
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
});
