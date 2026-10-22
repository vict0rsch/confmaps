// Reading and writing the files under `data/`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import {
  GeocacheSchema,
  OverridesFileSchema,
  SatellitesFileSchema,
  type ArchiveFile,
  type Conference,
  type EventLocation,
  type Geocache,
  type Overrides,
  type Satellite,
} from '../schema';
import { readArchiveDir } from './archive';
import { stableStringify } from './json';
import { formatIssues } from './validate';

export const dataPaths = (dataDir: string) => ({
  satellites: join(dataDir, 'satellites.yml'),
  overrides: join(dataDir, 'overrides.yml'),
  geocache: join(dataDir, 'geocache.json'),
  archive: join(dataDir, 'archive'),
  output: join(dataDir, 'build', 'data.json'),
});

export interface Inputs {
  satellites: Satellite[];
  overrides: Overrides;
  geocache: Geocache;
  archive: ArchiveFile;
  errors: string[];
}

function readYaml(path: string): unknown {
  return existsSync(path) ? parse(readFileSync(path, 'utf8')) : null;
}

export function loadInputs(dataDir: string): Inputs {
  const p = dataPaths(dataDir);
  const errors: string[] = [];

  const satRaw = readYaml(p.satellites) ?? [];
  const sat = SatellitesFileSchema.safeParse(satRaw);
  if (!sat.success) errors.push(...formatIssues('satellites.yml', sat.error));

  const ovRaw = readYaml(p.overrides) ?? {};
  const ov = OverridesFileSchema.safeParse(ovRaw);
  if (!ov.success) errors.push(...formatIssues('overrides.yml', ov.error));

  const gcRaw = existsSync(p.geocache) ? JSON.parse(readFileSync(p.geocache, 'utf8')) : {};
  const gc = GeocacheSchema.safeParse(gcRaw);
  if (!gc.success) errors.push(...formatIssues('geocache.json', gc.error));

  const ar = readArchiveDir(p.archive);
  errors.push(...ar.errors);

  return {
    satellites: sat.data ?? [],
    overrides: ov.data ?? {},
    geocache: gc.data ?? {},
    archive: ar.archive,
    errors,
  };
}

/** Write `path` only if its text changes. Returns whether it was written. */
export function writeIfChanged(path: string, text: string): boolean {
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return true;
}

/**
 * Write `data.json`. `generatedAt` is only bumped when conferences/locations change, so an
 * unchanged dataset produces a byte-identical file (no daily no-op commits).
 */
export function writeDataJson(
  path: string,
  conferences: Conference[],
  locations: EventLocation[],
  now: Date,
): boolean {
  const body = stableStringify({ conferences, locations });
  let generatedAt = now.toISOString();
  if (existsSync(path)) {
    try {
      const prev = JSON.parse(readFileSync(path, 'utf8'));
      const same =
        stableStringify({ conferences: prev.conferences, locations: prev.locations }) === body;
      if (same && typeof prev.generatedAt === 'string') generatedAt = prev.generatedAt;
    } catch {
      // unreadable previous file: overwrite
    }
  }
  return writeIfChanged(path, stableStringify({ generatedAt, conferences, locations }));
}
