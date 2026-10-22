// Static import: data.json (~200 KB, ~25 KB gzipped) ships inside the hashed JS bundle, so code
// and data are always deployed atomically (no cache skew, no loading state, typed at build time).
// It only changes with the daily sync, so the cache-busting cost is negligible.
import raw from '../../../data/build/data.json';
import type { Conference, DataFile, EventLocation } from './types';

/** A location joined to its conference (filters test `loc.conference`, DESIGN §6.3). */
export type JoinedLocation = EventLocation & { conference: Conference };

export type AppData = {
  generatedAt: string;
  conferences: Conference[];
  locations: JoinedLocation[];
  conferenceById: ReadonlyMap<string, Conference>;
  /** All locations of a conference, main first. */
  locationsByConference: ReadonlyMap<string, JoinedLocation[]>;
  /**
   * Tracks of one event (e.g. EMNLP 2026 + its Industry and System Demonstrations tracks): each
   * member's id → the whole group, lead first. Only conferences that belong to a group of ≥ 2.
   */
  trackGroups: ReadonlyMap<string, readonly Conference[]>;
};

const roleOrder = (l: EventLocation) => (l.role === 'main' ? 0 : 1);

/** A track's own name, from a title like "EMNLP (Industry Track)"; null for the main event. */
export function trackName(c: Pick<Conference, 'title'>): string | null {
  return /\(([^)]+)\)\s*$/.exec(c.title)?.[1] ?? null;
}

/**
 * Group the tracks of one event: same series, year and main-venue city, overlapping dates. The
 * lead is the untitled main event if there is one, else the shortest title.
 */
export function groupTracks(
  conferences: readonly Conference[],
  mainCity: (id: string) => string | undefined,
): Map<string, readonly Conference[]> {
  const byKey = new Map<string, Conference[][]>();
  for (const c of conferences) {
    const city = mainCity(c.id);
    if (!city) continue;
    const key = `${c.series}|${c.year}|${city}`;
    const groups = byKey.get(key) ?? [];
    const g = groups.find((g) => g.some((o) => o.start <= c.end && c.start <= o.end));
    if (g) g.push(c);
    else groups.push([c]);
    byKey.set(key, groups);
  }
  const rank = (c: Conference) => (trackName(c) === null ? 0 : 1);
  const out = new Map<string, readonly Conference[]>();
  for (const groups of byKey.values()) {
    for (const g of groups) {
      if (g.length < 2) continue;
      g.sort(
        (a, b) => rank(a) - rank(b) || a.title.length - b.title.length || a.id.localeCompare(b.id),
      );
      for (const c of g) out.set(c.id, g);
    }
  }
  return out;
}

/** Join locations to conferences. Locations whose conference is missing are dropped. */
export function joinData(file: DataFile): AppData {
  const conferenceById = new Map(file.conferences.map((c) => [c.id, c]));
  const locations: JoinedLocation[] = [];
  const locationsByConference = new Map<string, JoinedLocation[]>();
  for (const loc of file.locations) {
    const conference = conferenceById.get(loc.conferenceId);
    if (!conference) continue;
    const joined = { ...loc, conference };
    locations.push(joined);
    const list = locationsByConference.get(conference.id) ?? [];
    list.push(joined);
    locationsByConference.set(conference.id, list);
  }
  for (const list of locationsByConference.values()) {
    list.sort((a, b) => roleOrder(a) - roleOrder(b) || a.start.localeCompare(b.start));
  }
  const mainCity = (id: string) =>
    locationsByConference.get(id)?.find((l) => l.role === 'main')?.city;
  return {
    generatedAt: file.generatedAt,
    conferences: file.conferences,
    locations,
    conferenceById,
    locationsByConference,
    trackGroups: groupTracks(file.conferences, mainCity),
  };
}

export function loadData(): AppData {
  return joinData(raw as DataFile);
}
