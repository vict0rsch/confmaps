// Test fixtures for filters (not imported by app code).
import { co2Model } from '../co2/model';
import type { JoinedLocation, PinnedJoined } from '../data/load';
import type { Conference } from '../data/types';
import type { Ctx } from './types';

export function conference(over: Partial<Conference> = {}): Conference {
  return {
    id: 'neurips26',
    series: 'neurips',
    title: 'NeurIPS',
    year: 2026,
    fullName: 'Conference on Neural Information Processing Systems',
    link: 'https://neurips.cc',
    tags: ['machine-learning'],
    deadlines: [],
    start: '2026-12-06',
    end: '2026-12-12',
    source: 'hf',
    ...over,
  };
}

/** An in-person location (pass `format: 'hybrid'` for a hybrid one). */
export function location(
  over: Partial<PinnedJoined> = {},
  conf: Partial<Conference> = {},
): PinnedJoined {
  const c = conference(conf);
  return {
    id: `${c.id}@main`,
    conferenceId: c.id,
    role: 'main',
    name: `${c.title} ${c.year}`,
    city: 'San Diego',
    country: 'USA',
    lat: 32.7157,
    lng: -117.1611,
    start: c.start,
    end: c.end,
    official: true,
    presentsPapers: true,
    access: 'registration',
    link: c.link,
    conference: c,
    ...over,
  };
}

/** A virtual (online-only) main edition: no city, venue or coordinates. */
export function virtualLocation(
  over: Partial<Extract<JoinedLocation, { format: 'virtual' }>> = {},
  conf: Partial<Conference> = {},
): JoinedLocation {
  const c = conference({
    id: 'neurips20',
    year: 2020,
    start: '2020-12-06',
    end: '2020-12-12',
    ...conf,
  });
  return {
    id: `${c.id}@main`,
    conferenceId: c.id,
    role: 'main',
    format: 'virtual',
    name: `${c.title} ${c.year}`,
    start: c.start,
    end: c.end,
    official: true,
    presentsPapers: true,
    access: 'registration',
    link: c.link,
    conference: c,
    ...over,
  };
}

/** A hybrid main edition: held in person (its city is what distance and CO₂ use) and online. */
export const hybridLocation = (over: Partial<PinnedJoined> = {}, conf: Partial<Conference> = {}) =>
  location(
    { city: 'New Orleans', country: 'USA', lat: 29.9511, lng: -90.0715, format: 'hybrid', ...over },
    { id: 'neurips22', year: 2022, start: '2022-11-28', end: '2022-12-09', ...conf },
  );

/** An edition under its historical name ("NIPS 2017"), before the series was renamed. */
export const oldEditionLocation = (over: Partial<PinnedJoined> = {}) =>
  location(
    { city: 'Long Beach', country: 'USA', lat: 33.7701, lng: -118.1937, ...over },
    {
      id: 'neurips17',
      title: 'NIPS',
      year: 2017,
      fullName: 'Neural Information Processing Systems',
      start: '2017-12-04',
      end: '2017-12-09',
      source: 'pwc',
    },
  );

export const PARIS = { lat: 48.8566, lng: 2.3522 };
export const LONDON = { lat: 51.5074, lng: -0.1278 };

export function ctx(over: Partial<Ctx> = {}): Ctx {
  return {
    units: 'km',
    mode: 'auto',
    threshold: 1000,
    co2: co2Model,
    today: '2026-10-22',
    now: new Date('2026-10-22T10:00:00Z'),
    ...over,
  };
}
