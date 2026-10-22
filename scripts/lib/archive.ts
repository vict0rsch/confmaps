// Archive-and-freeze (DESIGN.md §3.4). `data/archive/<year>.json` holds every event that has ended,
// grouped by its conference's `year` (an event never changes file). The pipeline adds and updates
// records but never removes one, and never deletes a file.
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

/** Parse archive files (name → JSON text) into one merged archive. */
export function parseArchive(files: Record<string, string>): {
  archive: ArchiveFile;
  errors: string[];
} {
  const archive: ArchiveFile = { conferences: [], locations: [] };
  const errors: string[] = [];
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
    archive.conferences.push(...parsed.data.conferences);
    archive.locations.push(...parsed.data.locations);
  }
  return { archive, errors };
}

export function readArchiveDir(dir: string): { archive: ArchiveFile; errors: string[] } {
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

/** Write year files whose content changed. Never deletes a file. Returns written file names. */
export function writeArchiveDir(dir: string, files: Map<number, ArchiveFile>): string[] {
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const [y, content] of [...files].sort(([a], [b]) => a - b)) {
    const path = join(dir, `${y}.json`);
    const text = stableStringify(content);
    if (existsSync(path) && readFileSync(path, 'utf8') === text) continue;
    writeFileSync(path, text);
    written.push(`${y}.json`);
  }
  return written;
}
