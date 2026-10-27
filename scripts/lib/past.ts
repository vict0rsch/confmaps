// `data/past_conferences.yml` entries → normalized records (DESIGN.md §2.4).
import type { Conference, PastConference } from '../schema';
import { mainLocationId, seriesOf, type PendingLocation } from './normalize';

/** A past edition as a conference: no deadlines (deliberately not represented), source kept. */
export function pastToConference(e: PastConference): Conference {
  return {
    id: e.id,
    series: seriesOf(e.title),
    title: e.title,
    year: e.year,
    ...(e.full_name ? { fullName: e.full_name } : {}),
    link: e.link,
    tags: [...e.tags],
    deadlines: [],
    start: e.start,
    end: e.end,
    source: e.source,
  };
}

/** A past edition's `@main` location: virtual ones have no place, hybrid ones keep their city. */
export function pastToLocation(e: PastConference): PendingLocation {
  const base = {
    id: mainLocationId(e.id),
    conferenceId: e.id,
    role: 'main' as const,
    name: `${e.title} ${e.year}`,
    start: e.start,
    end: e.end,
    official: true,
    presentsPapers: true,
    access: 'registration' as const,
    link: e.link,
    ...(e.notes ? { notes: e.notes } : {}),
  };
  if (e.format === 'virtual') return { ...base, format: 'virtual' };
  return {
    ...base,
    ...(e.format === 'hybrid' ? { format: 'hybrid' as const } : {}),
    city: e.city!,
    country: e.country!,
    ...(e.venue ? { venue: e.venue } : {}),
  };
}
