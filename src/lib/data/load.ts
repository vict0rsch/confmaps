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
};

const roleOrder = (l: EventLocation) => (l.role === 'main' ? 0 : 1);

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
  return {
    generatedAt: file.generatedAt,
    conferences: file.conferences,
    locations,
    conferenceById,
    locationsByConference,
  };
}

export function loadData(): AppData {
  return joinData(raw as DataFile);
}
