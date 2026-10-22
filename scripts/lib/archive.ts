// Archive-and-freeze (DESIGN.md §3.4). `data/archive/<year>.json` holds every event that has ended,
// grouped by its conference's current `year`. The pipeline adds and updates records but never
// removes one from the archive, and never deletes a file; if upstream corrects a `year`, the
// record moves to the new year file (and leaves the old one).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ArchiveFileSchema,
  type ArchiveFile,
  type Conference,
  type EventLocation,
} from '../schema';
import { byId, stableStringify } from './json';

const FILE_RE = /^\d{4}\.json$/;

export const archiveIds = (a: ArchiveFile) => ({
  conferences: new Set(a.conferences.map((c) => c.id)),
  locations: new Set(a.locations.map((l) => l.id)),
});
export type ArchiveIds = ReturnType<typeof archiveIds>;

/**
 * Parse archive files (name → JSON text) into one merged archive. `duplicates` lists ids found
 * more than once (e.g. in two year files); the build heals them, `data:validate` rejects them.
 */
export function parseArchive(files: Record<string, string>): {
  archive: ArchiveFile;
  errors: string[];
  duplicates: string[];
} {
  const archive: ArchiveFile = { conferences: [], locations: [] };
  const errors: string[] = [];
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  const note = (kind: string, id: string, name: string) => {
    const k = `${kind} "${id}"`;
    const first = seen.get(k);
    if (first) duplicates.push(`archive: ${k} is in both archive/${first} and archive/${name}`);
    else seen.set(k, name);
  };
  for (const name of Object.keys(files).sort()) {
    if (!FILE_RE.test(name)) continue;
    let json: unknown;
    try {
      json = JSON.parse(files[name]);
    } catch (e) {
      errors.push(`archive/${name}: invalid JSON: ${(e as Error).message}`);
      continue;
    }
    const parsed = ArchiveFileSchema.safeParse(json);
    if (!parsed.success) {
      for (const i of parsed.error.issues)
        errors.push(`archive/${name}: ${i.path.join('.')}: ${i.message}`);
      continue;
    }
    for (const c of parsed.data.conferences) note('conference', c.id, name);
    for (const l of parsed.data.locations) note('location', l.id, name);
    archive.conferences.push(...parsed.data.conferences);
    archive.locations.push(...parsed.data.locations);
  }
  return { archive, errors, duplicates };
}

export function readArchiveDir(dir: string): ReturnType<typeof parseArchive> {
  if (!existsSync(dir)) return parseArchive({});
  const files: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    if (FILE_RE.test(name)) files[name] = readFileSync(join(dir, name), 'utf8');
  }
  return parseArchive(files);
}

/**
 * The archive after this build: every previously archived record (updated to its current state)
 * plus every record whose `end` is before `today`, grouped by conference year.
 */
export function freeze(
  conferences: Conference[],
  locations: EventLocation[],
  previous: ArchiveIds,
  today: string,
): Map<number, ArchiveFile> {
  const year = new Map(conferences.map((c) => [c.id, c.year]));
  const files = new Map<number, ArchiveFile>();
  const file = (y: number) => {
    if (!files.has(y)) files.set(y, { conferences: [], locations: [] });
    return files.get(y)!;
  };
  for (const c of conferences) {
    if (previous.conferences.has(c.id) || c.end < today) file(c.year).conferences.push(c);
  }
  for (const l of locations) {
    if (previous.locations.has(l.id) || l.end < today) {
      file(year.get(l.conferenceId) ?? Number(l.start.slice(0, 4))).locations.push(l);
    }
  }
  for (const f of files.values()) {
    f.conferences.sort(byId);
    f.locations.sort(byId);
  }
  return files;
}

export function mergeArchiveFiles(files: Map<number, ArchiveFile>): ArchiveFile {
  const out: ArchiveFile = { conferences: [], locations: [] };
  for (const f of files.values()) {
    out.conferences.push(...f.conferences);
    out.locations.push(...f.locations);
  }
  return out;
}

/**
 * Make `dir` hold exactly `files`: write year files whose content changed, and empty an existing
 * year file that no longer has records (a moved record must not linger as a stale copy). Never
 * deletes a file. Throws, without writing, if a record on disk would leave the archive.
 * Returns written file names.
 */
export function writeArchiveDir(dir: string, files: Map<number, ArchiveFile>): string[] {
  mkdirSync(dir, { recursive: true });
  const onDisk = readArchiveDir(dir);
  const after = archiveIds(mergeArchiveFiles(files));
  const lost = [
    ...onDisk.archive.conferences.filter((c) => !after.conferences.has(c.id)),
    ...onDisk.archive.locations.filter((l) => !after.locations.has(l.id)),
  ];
  if (lost.length) {
    throw new Error(`refusing to drop archived records: ${lost.map((r) => r.id).join(', ')}`);
  }
  const all = new Map(files);
  for (const name of readdirSync(dir)) {
    const y = Number(name.slice(0, 4));
    if (FILE_RE.test(name) && !all.has(y)) all.set(y, { conferences: [], locations: [] });
  }
  const written: string[] = [];
  for (const [y, content] of [...all].sort(([a], [b]) => a - b)) {
    const path = join(dir, `${y}.json`);
    const text = stableStringify(content);
    if (existsSync(path) && readFileSync(path, 'utf8') === text) continue;
    writeFileSync(path, text);
    written.push(`${y}.json`);
  }
  return written;
}
