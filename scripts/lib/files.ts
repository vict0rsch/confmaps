// Reading and writing the files under `data/`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import {
  GeocacheSchema,
  OverridesFileSchema,
  PastConferencesFileSchema,
  SatellitesFileSchema,
  type ArchiveFile,
  type Conference,
  type EventLocation,
  type Geocache,
  type Overrides,
  type PastConference,
  type Satellite,
  type UpstreamRef,
} from '../schema';
import { readArchiveDir } from './archive';
import { stableStringify } from './json';
import { formatIssues } from './validate';

export const dataPaths = (dataDir: string) => ({
  satellites: join(dataDir, 'satellites.yml'),
  past: join(dataDir, 'past_conferences.yml'),
  overrides: join(dataDir, 'overrides.yml'),
  geocache: join(dataDir, 'geocache.json'),
  archive: join(dataDir, 'archive'),
  output: join(dataDir, 'build', 'data.json'),
});

export interface Inputs {
  satellites: Satellite[];
  /** `[]` when `past_conferences.yml` is missing or empty. */
  past: PastConference[];
  overrides: Overrides;
  geocache: Geocache;
  archive: ArchiveFile;
  /** Ids present in more than one archive file (see parseArchive). */
  archiveDuplicates: string[];
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

  const pastRaw = readYaml(p.past) ?? [];
  const past = PastConferencesFileSchema.safeParse(pastRaw);
  if (!past.success) errors.push(...formatIssues('past_conferences.yml', past.error));

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
    past: past.data ?? [],
    overrides: ov.data ?? {},
    geocache: gc.data ?? {},
    archive: ar.archive,
    archiveDuplicates: ar.duplicates,
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

/** The previous `data.json`, or `undefined` if missing or unreadable. */
export function readPreviousData(
  path: string,
):
  | { generatedAt?: unknown; upstream?: unknown; conferences?: unknown; locations?: unknown }
  | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Write `data.json`. `generatedAt` and `upstream` (the upstream commit) are only updated when
 * conferences/locations change, so an unchanged dataset produces a byte-identical file (no daily
 * no-op commits).
 */
export function writeDataJson(
  path: string,
  conferences: Conference[],
  locations: EventLocation[],
  now: Date,
  upstream?: UpstreamRef,
): boolean {
  const body = stableStringify({ conferences, locations });
  let generatedAt = now.toISOString();
  let ref = upstream;
  const prev = readPreviousData(path);
  if (
    prev &&
    stableStringify({ conferences: prev.conferences, locations: prev.locations }) === body
  ) {
    if (typeof prev.generatedAt === 'string') generatedAt = prev.generatedAt;
    ref = prev.upstream as UpstreamRef | undefined;
  }
  return writeIfChanged(
    path,
    stableStringify({ generatedAt, ...(ref ? { upstream: ref } : {}), conferences, locations }),
  );
}
