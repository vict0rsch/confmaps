// Offline check that data.json is what the committed inputs produce (`pnpm data:validate`).
//
// Without the network the upstream entries are not available, so this re-derives everything that
// does NOT depend on them and diffs it against data.json:
//   - satellites: each `satellites.yml` entry (+ its override, canonical country, coordinates from
//     the override or geocache) must equal its data.json location field for field;
//   - past editions: each `past_conferences.yml` entry not shadowed by an `hf` conference (+ its
//     `@main` override, canonical country, coordinates) must equal its data.json conference and
//     location field for field, and every `pwc`/`curated` conference must be in that file or
//     the archive;
//   - archive: each archived conference/location must equal its data.json record, and every
//     `source: archive` conference / satellite location not in `satellites.yml` must be archived;
//   - overrides: every overridden field (incl. `@main` start/end/deadlines on the conference) must
//     hold its override value in data.json;
//   - all locations: canonical country names, coordinates equal to the geocache entry for their
//     city (unless overridden), `@main` defaults (id, name, link, dates = the conference's, and
//     official/presentsPapers/access);
//   - all conferences: `series` derived from `title`.
// Not covered (needs upstream): the upstream-derived fields of non-archived conferences and their
// main locations (title, dates, deadlines, city, venue, …) beyond the rules above.
import {
  isVirtual,
  type ArchiveFile,
  type Conference,
  type DataFile,
  type EventLocation,
  type Geocache,
  type Overrides,
  type PastConference,
  type Satellite,
} from '../schema';
import { canonicalCountry } from './countries';
import { geocacheKey } from './geocode';
import { stableStringify } from './json';
import {
  applyOverrides,
  convertDeadlines,
  mainLocationId,
  satelliteToLocation,
  seriesOf,
  type PendingLocation,
} from './normalize';
import { pastToConference, pastToLocation } from './past';

export interface ConsistencyInput {
  data: DataFile;
  satellites: Satellite[];
  past: PastConference[];
  overrides: Overrides;
  geocache: Geocache;
  archive: ArchiveFile;
}

/** Field-level differences between an expected and an actual record. */
function diff(id: string, what: string, expected: object, actual: object | undefined): string[] {
  if (!actual) return [`${what} ${id} is missing from data.json`];
  const e = expected as Record<string, unknown>;
  const a = actual as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(e), ...Object.keys(a)])].sort();
  const out: string[] = [];
  for (const k of keys) {
    if (stableStringify(e[k]) !== stableStringify(a[k])) {
      out.push(
        `data.json is out of date: ${what} ${id}.${k} is ${JSON.stringify(a[k])}, ` +
          `inputs give ${JSON.stringify(e[k])} (run pnpm data:build)`,
      );
    }
  }
  return out;
}

export function checkConsistency(input: ConsistencyInput): string[] {
  const { data, satellites, overrides, geocache, archive } = input;
  const errors: string[] = [];
  const confs = new Map(data.conferences.map((c) => [c.id, c]));
  const locs = new Map(data.locations.map((l) => [l.id, l]));
  const archivedConfs = new Set(archive.conferences.map((c) => c.id));
  const archivedLocs = new Set(archive.locations.map((l) => l.id));
  const satIds = new Set(satellites.map((s) => s.id));

  // Archive records are written by the same build as data.json: they must be identical.
  for (const c of archive.conferences)
    errors.push(...diff(c.id, 'archived conference', c, confs.get(c.id)));
  for (const l of archive.locations)
    errors.push(...diff(l.id, 'archived location', l, locs.get(l.id)));

  /** `loc` after its own override, canonical country and coordinates; undefined if not geocoded. */
  const resolve = (loc: PendingLocation, conf?: Conference): PendingLocation | undefined => {
    const pending = new Map([[loc.id, loc]]);
    const own = overrides[loc.id] ? { [loc.id]: overrides[loc.id] } : {};
    applyOverrides(new Map(conf ? [[conf.id, conf]] : []), pending, own);
    if (isVirtual(loc)) return loc;
    loc.country = canonicalCountry(loc.country) ?? loc.country;
    if (loc.lat === undefined) {
      const hit = geocache[geocacheKey(loc.city, loc.country)];
      if (!hit) return undefined; // reported by validateDataset
      Object.assign(loc, { lat: hit.lat, lng: hit.lng });
    }
    return loc;
  };

  // Satellites: fully re-derivable from satellites.yml + overrides + geocache.
  for (const s of satellites) {
    const loc = resolve(satelliteToLocation(s));
    if (loc) errors.push(...diff(s.id, 'satellite', loc, locs.get(s.id)));
  }

  // Past editions: likewise, unless upstream has the same id (it wins).
  const pastIds = new Set(input.past.map((e) => e.id));
  for (const e of input.past) {
    if (confs.get(e.id)?.source === 'hf') continue;
    const conf = pastToConference(e);
    const loc = resolve(pastToLocation(e), conf);
    errors.push(...diff(e.id, 'past conference', conf, confs.get(e.id)));
    if (loc) errors.push(...diff(loc.id, 'past location', loc, locs.get(loc.id)));
  }

  for (const c of data.conferences) {
    if (c.source === 'archive' && !archivedConfs.has(c.id))
      errors.push(`conference ${c.id} has source "archive" but is not in data/archive/`);
    if (
      (c.source === 'pwc' || c.source === 'curated') &&
      !pastIds.has(c.id) &&
      !archivedConfs.has(c.id)
    )
      errors.push(
        `conference ${c.id} has source "${c.source}" but is in neither past_conferences.yml nor data/archive/`,
      );
    if (c.series !== seriesOf(c.title))
      errors.push(`conference ${c.id}: series "${c.series}", title gives "${seriesOf(c.title)}"`);
  }

  for (const l of data.locations) {
    const o = overrides[l.id] ?? {};
    if (l.role === 'satellite' && !satIds.has(l.id) && !archivedLocs.has(l.id))
      errors.push(`location ${l.id}: satellite in neither satellites.yml nor the archive`);
    if (!isVirtual(l) && canonicalCountry(l.country) !== l.country)
      errors.push(`location ${l.id}: country "${l.country}" is not a canonical name`);
    if (!isVirtual(l) && o.lat === undefined) {
      const hit = geocache[geocacheKey(l.city, l.country)];
      if (hit && (hit.lat !== l.lat || hit.lng !== l.lng))
        errors.push(
          `location ${l.id}: (${l.lat}, ${l.lng}) differs from geocache "${geocacheKey(l.city, l.country)}" ` +
            `(${hit.lat}, ${hit.lng}) (run pnpm data:build)`,
        );
    }
    for (const [k, v] of Object.entries(o)) {
      if (k === 'reason' || k === 'deadlines') continue;
      const field = (k === 'presents_papers' ? 'presentsPapers' : k) as keyof EventLocation;
      if (stableStringify(l[field]) !== stableStringify(v))
        errors.push(
          `location ${l.id}: ${field} is ${JSON.stringify(l[field])}, override says ${JSON.stringify(v)}`,
        );
    }
    if (l.role !== 'main') continue;
    const c = confs.get(l.conferenceId);
    if (!c) continue; // reported by validateDataset
    if (l.id !== mainLocationId(c.id))
      errors.push(`location ${l.id}: main location id must be "${mainLocationId(c.id)}"`);
    const expected = {
      start: c.start,
      end: c.end,
      name: o.name ?? `${c.title} ${c.year}`,
      link: o.link ?? c.link,
      official: o.official ?? true,
      presentsPapers: o.presents_papers ?? true,
      access: o.access ?? 'registration',
    };
    for (const [k, v] of Object.entries(expected)) {
      const actual = l[k as keyof EventLocation];
      if (actual !== v)
        errors.push(
          `location ${l.id}: ${k} is ${JSON.stringify(actual)}, expected ${JSON.stringify(v)}`,
        );
    }
    if (o.deadlines) {
      const want = convertDeadlines(o.deadlines, `overrides.yml: ${l.id}`, errors);
      if (stableStringify(want) !== stableStringify(c.deadlines))
        errors.push(
          `conference ${c.id}: deadlines differ from the "${l.id}" override (run pnpm data:build)`,
        );
    }
  }
  return errors;
}
