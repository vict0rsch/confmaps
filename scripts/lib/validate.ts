// Dataset validation (DESIGN.md §8, data tier). Shared by `data:build` and `data:validate`.
import type { z } from 'zod';
import {
  DataFileSchema,
  isVirtual,
  type ArchiveFile,
  type DataFile,
  type Geocache,
  type Overrides,
  type PastConference,
  type Satellite,
  type SeriesFile,
} from '../schema';
import { archiveIds, type ArchiveIds } from './archive';
import { canonicalCountry } from './countries';
import { geocacheKey, haversineKm } from './geocode';
import { mainLocationId, seriesKey, seriesOf } from './normalize';

export interface ValidationInput {
  data: unknown;
  satellites: Satellite[];
  past: PastConference[];
  overrides: Overrides;
  /** `series.yml`; omitted by callers that do not check it. */
  series?: SeriesFile;
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
    if (
      !isVirtual(l) &&
      (!Number.isFinite(l.lat) || !Number.isFinite(l.lng) || (l.lat === 0 && l.lng === 0))
    ) {
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

  // Past editions (one per id and per series|year; pinned ones geocoded, like satellites)
  const satIds = new Set(input.satellites.map((s) => s.id));
  const hfIds = new Set(data.conferences.filter((c) => c.source === 'hf').map((c) => c.id));
  for (const id of duplicates(input.past.map((e) => e.id)))
    errors.push(`past_conferences.yml: duplicate id "${id}"`);
  const editions = new Map<string, string>();
  for (const e of input.past) {
    const k = `${seriesOf(e.title)}|${e.year}`;
    const first = editions.get(k);
    if (first === undefined) editions.set(k, e.id);
    else if (first !== e.id)
      errors.push(`past_conferences.yml: "${first}" and "${e.id}" are the same edition (${k})`);
    if (satIds.has(e.id)) errors.push(`past_conferences.yml: "${e.id}" is also a satellite id`);
    if (e.format === 'virtual' || hfIds.has(e.id)) continue; // no place, or upstream wins
    const o = input.overrides[mainLocationId(e.id)];
    if (o?.lat !== undefined) continue;
    const country = canonicalCountry(o?.country ?? e.country!);
    const key = country && geocacheKey(o?.city ?? e.city!, country);
    if (!key || !input.geocache[key]) {
      errors.push(
        `past_conferences.yml: ${e.id}: "${e.city}, ${e.country}" is not geocoded (run pnpm data:build)`,
      );
    }
  }

  // Series first years: a known series, not later than its earliest edition in the dataset
  const earliest = new Map<string, number>();
  for (const c of data.conferences)
    earliest.set(c.series, Math.min(c.year, earliest.get(c.series) ?? c.year));
  for (const [key, s] of Object.entries(input.series ?? {})) {
    const first = earliest.get(key);
    if (first === undefined) errors.push(`series.yml: "${key}" is not a known series`);
    else if (s.first_year > first)
      errors.push(
        `series.yml: ${key}: first_year ${s.first_year} is later than its earliest edition (${first})`,
      );
  }

  // Overrides must target a known location
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

const DAY = 86_400_000;
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** A track title such as "EMNLP (Industry Track)" (same rule as the app's trackName). */
const TRACK_RE = /\(([^)]+)\)\s*$/;

/** Override coordinates farther than this from every geocoded place in their country warn. */
export const OVERRIDE_COUNTRY_KM = 1500;
/** Satellites starting/ending more than this many days outside their parent's dates warn. */
export const SATELLITE_WINDOW_DAYS = 30;

/**
 * Plausibility checks on the dataset (upstream typos and stale fixes). Errors block the build;
 * warnings are printed for review. Assumes `data` passed `DataFileSchema`.
 */
export function sanityCheck(
  data: Pick<DataFile, 'conferences' | 'locations'>,
  overrides: Overrides,
  geocache: Geocache,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const confs = new Map(data.conferences.map((c) => [c.id, c]));

  for (const c of data.conferences) {
    if (Number(c.start.slice(0, 4)) !== c.year)
      warnings.push(`conference ${c.id}: year ${c.year} but starts ${c.start} (upstream typo?)`);
    for (const d of c.deadlines) {
      // An AoE deadline on the last day is the next day in UTC: allow one day of slack.
      if (d.date.slice(0, 10) > addDays(c.end, 1)) {
        errors.push(
          `conference ${c.id}: deadline "${d.type}" (${d.date}) is after the conference ends ` +
            `(${c.end}); fix it with "deadlines" under "${c.id}@main" in data/overrides.yml`,
        );
      }
      const y = Number(d.date.slice(0, 4));
      if (y < c.year - 2 || y > c.year)
        warnings.push(`conference ${c.id}: deadline "${d.type}" (${d.date}) is far from ${c.year}`);
    }
  }

  // Keyed on the series (NIPS 2018 = NeurIPS 2018); a track keeps its own title, so EMNLP and its
  // Industry Track are not reported.
  const byEdition = new Map<string, string[]>();
  for (const c of data.conferences) {
    const k = `${TRACK_RE.test(c.title) ? seriesKey(c.title) : c.series} ${c.year}`;
    byEdition.set(k, [...(byEdition.get(k) ?? []), c.id]);
  }
  for (const [k, ids] of byEdition) {
    if (ids.length > 1) warnings.push(`conferences ${ids.join(', ')} are the same edition (${k})`);
  }

  for (const l of data.locations) {
    const parent = confs.get(l.conferenceId);
    if (l.role === 'satellite' && parent) {
      const early = l.start < addDays(parent.start, -SATELLITE_WINDOW_DAYS);
      const late = l.end > addDays(parent.end, SATELLITE_WINDOW_DAYS);
      if (early || late)
        warnings.push(
          `satellite ${l.id}: ${l.start}–${l.end} is more than ${SATELLITE_WINDOW_DAYS} days ` +
            `from ${parent.id} (${parent.start}–${parent.end})`,
        );
    }
    const o = overrides[l.id];
    if (o?.lat !== undefined && o.lng !== undefined && !isVirtual(l)) {
      const country = geocacheKey('', l.country);
      const refs = Object.entries(geocache)
        .filter(([key]) => key.endsWith(country))
        .map(([, e]) => haversineKm(e, { lat: o.lat!, lng: o.lng! }));
      if (refs.length && Math.min(...refs) > OVERRIDE_COUNTRY_KM)
        warnings.push(
          `overrides.yml: ${l.id}: (${o.lat}, ${o.lng}) is over ${OVERRIDE_COUNTRY_KM} km from ` +
            `every geocoded place in ${l.country} (swapped or wrong-signed lat/lng?)`,
        );
    }
  }
  return { errors, warnings };
}
