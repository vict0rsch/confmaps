// Pure build core (no file or network IO besides the injected geocoder):
// normalize → merge archive, past editions, upstream, satellites → apply overrides →
// canonicalize countries → geocode → freeze.
import {
  isVirtual,
  type ArchiveFile,
  type Conference,
  type EventLocation,
  type Geocache,
  type Overrides,
  type PastConference,
  type Satellite,
  type UpstreamConference,
} from '../schema';
import { archiveIds, freeze, type ArchiveIds } from './archive';
import { resolveCoordinates, type Geocoder } from './geocode';
import { byId } from './json';
import {
  applyOverrides,
  canonicalizeCountries,
  normalizeUpstream,
  satelliteToLocation,
  seriesOf,
  type PendingLocation,
} from './normalize';
import { pastToConference, pastToLocation } from './past';

export interface BuildInputs {
  upstream: UpstreamConference[];
  satellites: Satellite[];
  /** `data/past_conferences.yml`: past main editions (upstream wins on an id clash). */
  past: PastConference[];
  overrides: Overrides;
  /** Archive as read at the start of the build (the committed one). */
  archive: ArchiveFile;
  /** Mutated: new geocoding results are added. */
  geocache: Geocache;
  /** `YYYY-MM-DD`; events with `end < today` are frozen. */
  today: string;
  /** Omit to run offline (cache misses become errors). */
  geocoder?: Geocoder;
  log?: (msg: string) => void;
}

export interface BuildResult {
  conferences: Conference[];
  locations: EventLocation[];
  archive: Map<number, ArchiveFile>;
  previousArchive: ArchiveIds;
  errors: string[];
  warnings: string[];
}

export async function buildDataset(inp: BuildInputs): Promise<BuildResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const previousArchive = archiveIds(inp.archive);

  const upstreamIds = new Set<string>();
  for (const e of inp.upstream) {
    if (upstreamIds.has(e.id)) errors.push(`upstream: duplicate id "${e.id}"`);
    upstreamIds.add(e.id);
  }
  const norm = normalizeUpstream(inp.upstream);
  errors.push(...norm.errors);

  for (const e of inp.past) {
    if (e.start > inp.today)
      errors.push(
        `past_conferences.yml: "${e.id}" starts ${e.start}, after today (${inp.today}); ` +
          `upcoming editions come from upstream`,
      );
    if (upstreamIds.has(e.id))
      warnings.push(`past_conferences.yml: "${e.id}" is also upstream (HF wins); remove it`);
  }

  // Precedence: upstream > past entry > archived copy. Archived records are kept when their
  // source drops them.
  const conferences = new Map<string, Conference>();
  for (const c of inp.archive.conferences) {
    conferences.set(c.id, {
      ...c,
      series: seriesOf(c.title), // so series alias changes reach archived editions too
      source: c.source === 'hf' ? 'archive' : c.source,
    });
  }
  for (const e of inp.past) conferences.set(e.id, pastToConference(e));
  for (const c of norm.conferences) conferences.set(c.id, c);

  const locations = new Map<string, PendingLocation>();
  for (const l of inp.archive.locations) {
    if (isVirtual(l)) {
      locations.set(l.id, l);
      continue;
    }
    const { lat, lng, ...rest } = l; // re-resolved below, so geocache/override fixes apply
    void lat;
    void lng;
    locations.set(l.id, rest);
  }
  const pastLocations = inp.past.map(pastToLocation);
  for (const l of pastLocations) locations.set(l.id, l);
  for (const l of norm.locations) locations.set(l.id, l);
  for (const s of inp.satellites) locations.set(s.id, satelliteToLocation(s));
  const fresh = new Set([
    ...pastLocations.map((l) => l.id),
    ...norm.locations.map((l) => l.id),
    ...inp.satellites.map((s) => s.id),
  ]);

  const applied = applyOverrides(conferences, locations, inp.overrides, fresh);
  errors.push(...applied.errors);
  warnings.push(...applied.warnings);
  errors.push(...canonicalizeCountries(locations.values()));

  for (const c of conferences.values()) {
    if (!c.start || !c.end) {
      errors.push(
        `conference ${c.id}: no start/end upstream and its free-text date could not be parsed; ` +
          `add start/end under "${c.id}@main" in data/overrides.yml`,
      );
    }
  }

  const geo = await resolveCoordinates(
    [...locations.values()],
    inp.geocache,
    inp.geocoder,
    inp.log,
  );
  errors.push(...geo.errors);
  warnings.push(...geo.warnings);

  const confList = [...conferences.values()].sort(byId);
  const locList = [...locations.values()].sort(byId) as EventLocation[];
  return {
    conferences: confList,
    locations: locList,
    archive: freeze(confList, locList, previousArchive, inp.today),
    previousArchive,
    errors,
    warnings,
  };
}
