// Pure build core (no file or network IO besides the injected geocoder):
// normalize → merge archive → apply overrides → canonicalize countries → geocode → freeze.
import type {
  ArchiveFile,
  Conference,
  EventLocation,
  Geocache,
  Overrides,
  Satellite,
  UpstreamConference,
} from '../schema';
import { archiveIds, freeze, type ArchiveIds } from './archive';
import { resolveCoordinates, type Geocoder } from './geocode';
import { byId } from './json';
import {
  applyOverrides,
  canonicalizeCountries,
  normalizeUpstream,
  satelliteToLocation,
  type PendingLocation,
} from './normalize';

export interface BuildInputs {
  upstream: UpstreamConference[];
  satellites: Satellite[];
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

  // Current records win over archived ones; archived ones are kept when upstream drops them.
  const conferences = new Map<string, Conference>();
  for (const c of inp.archive.conferences) {
    conferences.set(c.id, { ...c, source: c.source === 'hf' ? 'archive' : c.source });
  }
  for (const c of norm.conferences) conferences.set(c.id, c);

  const locations = new Map<string, PendingLocation>();
  for (const l of inp.archive.locations) {
    const { lat, lng, ...rest } = l; // re-resolved below, so geocache/override fixes apply
    void lat;
    void lng;
    locations.set(l.id, rest);
  }
  for (const l of norm.locations) locations.set(l.id, l);
  for (const s of inp.satellites) locations.set(s.id, satelliteToLocation(s));

  errors.push(...applyOverrides(conferences, locations, inp.overrides));
  errors.push(...canonicalizeCountries(locations.values()));

  for (const c of conferences.values()) {
    if (!c.start || !c.end) {
      errors.push(
        `conference ${c.id}: no start/end upstream and its free-text date could not be parsed; ` +
          `add start/end under "${c.id}@main" in data/overrides.yml`,
      );
    } else if (Number(c.start.slice(0, 4)) !== c.year) {
      warnings.push(`conference ${c.id}: year ${c.year} but starts ${c.start} (upstream typo?)`);
    }
  }

  errors.push(
    ...(await resolveCoordinates([...locations.values()], inp.geocache, inp.geocoder, inp.log)),
  );

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
