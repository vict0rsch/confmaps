// Test fixtures for filters (not imported by app code).
import { co2Model } from '../co2/model';
import type { JoinedLocation } from '../data/load';
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

export function location(
  over: Partial<JoinedLocation> = {},
  conf: Partial<Conference> = {},
): JoinedLocation {
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
