// Dataset validation (DESIGN.md §9, data tier). Shared by `data:build` and `data:validate`.
import type { z } from 'zod';
import {
  DataFileSchema,
  type ArchiveFile,
  type DataFile,
  type Geocache,
  type Overrides,
  type Satellite,
} from '../schema';
import { archiveIds, type ArchiveIds } from './archive';
import { canonicalCountry } from './countries';
import { geocacheKey } from './geocode';

export interface ValidationInput {
  data: unknown;
  satellites: Satellite[];
  overrides: Overrides;
  geocache: Geocache;
  /** The archive as it is after the build (on disk for `data:validate`). */
  archive: ArchiveFile;
  /** An earlier archive that must be a subset of `archive` ("archive never shrinks"). */
  previousArchive?: { ids: ArchiveIds; label: string };
}

/** Zod issues → readable lines, naming the record id when the path points into a list. */
export function formatIssues(prefix: string, error: z.ZodError, root?: unknown): string[] {
  return error.issues.map((i) => {
    let where = i.path.join('.');
    const [list, index] = i.path;
    const rec = (root as Record<string, unknown> | undefined)?.[list as string];
    if (Array.isArray(rec) && typeof index === 'number') {
      const id = (rec[index] as { id?: unknown } | undefined)?.id;
      if (typeof id === 'string') where = `${String(list)}[${id}].${i.path.slice(2).join('.')}`;
    }
    return `${prefix}: ${where}: ${i.message}`;
  });
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  return [...new Set(ids.filter((id) => seen.has(id) || !seen.add(id)))];
}

export function validateDataset(input: ValidationInput): string[] {
  const errors: string[] = [];
  const parsed = DataFileSchema.safeParse(input.data);
  if (!parsed.success) return formatIssues('data.json', parsed.error, input.data);
  const data: DataFile = parsed.data;

  // Unique ids
  for (const id of duplicates(data.conferences.map((c) => c.id)))
    errors.push(`duplicate conference id "${id}"`);
  for (const id of duplicates(data.locations.map((l) => l.id)))
    errors.push(`duplicate location id "${id}"`);
  for (const id of duplicates(input.satellites.map((s) => s.id)))
    errors.push(`satellites.yml: duplicate id "${id}"`);

  const confIds = new Set(data.conferences.map((c) => c.id));
  const locIds = new Set(data.locations.map((l) => l.id));

  // Dates
  for (const c of data.conferences) {
    if (c.start > c.end) errors.push(`conference ${c.id}: start ${c.start} > end ${c.end}`);
  }
  for (const l of data.locations) {
    if (l.start > l.end) errors.push(`location ${l.id}: start ${l.start} > end ${l.end}`);
    if (!confIds.has(l.conferenceId))
      errors.push(`location ${l.id}: unknown conference "${l.conferenceId}"`);
    if (!Number.isFinite(l.lat) || !Number.isFinite(l.lng) || (l.lat === 0 && l.lng === 0)) {
      errors.push(`location ${l.id}: not geocoded (${l.lat}, ${l.lng})`);
    }
  }

  // Satellites (also checked here so a PR editing only satellites.yml is validated)
  for (const s of input.satellites) {
    if (!confIds.has(s.parent))
      errors.push(`satellites.yml: ${s.id}: parent "${s.parent}" does not exist`);
    if (s.start > s.end) errors.push(`satellites.yml: ${s.id}: start ${s.start} > end ${s.end}`);
    const o = input.overrides[s.id];
    if (o?.lat !== undefined) continue;
    const country = canonicalCountry(o?.country ?? s.country);
    const key = country && geocacheKey(o?.city ?? s.city, country);
    if (!key || !input.geocache[key]) {
      errors.push(
        `satellites.yml: ${s.id}: "${s.city}, ${s.country}" is not geocoded (run pnpm data:build)`,
      );
    }
  }

  // Overrides must target a known location
  const satIds = new Set(input.satellites.map((s) => s.id));
  for (const id of Object.keys(input.overrides)) {
    if (!locIds.has(id) && !satIds.has(id))
      errors.push(`overrides.yml: "${id}" matches no location`);
  }

  // Archive ⊆ data.json, and archive never shrinks
  for (const c of input.archive.conferences) {
    if (!confIds.has(c.id)) errors.push(`archived conference "${c.id}" is missing from data.json`);
  }
  for (const l of input.archive.locations) {
    if (!locIds.has(l.id)) errors.push(`archived location "${l.id}" is missing from data.json`);
  }
  if (input.previousArchive) {
    const now = archiveIds(input.archive);
    const { ids, label } = input.previousArchive;
    for (const id of ids.conferences) {
      if (!now.conferences.has(id))
        errors.push(`archive shrank: conference "${id}" (archived in ${label}) was removed`);
    }
    for (const id of ids.locations) {
      if (!now.locations.has(id))
        errors.push(`archive shrank: location "${id}" (archived in ${label}) was removed`);
    }
  }
  return errors;
}
