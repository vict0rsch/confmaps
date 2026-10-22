// Shared test fixtures for the data pipeline.
import { fileURLToPath } from 'node:url';
import type { Geocache, Satellite } from '../schema';

export const UPSTREAM_DIR = fileURLToPath(new URL('./upstream', import.meta.url));

export const geocache = (): Geocache => ({
  'vienna|austria': { lat: 48.2, lng: 16.37, display_name: 'Vienna, Austria' },
  'paris|france': { lat: 48.85, lng: 2.35, display_name: 'Paris, France' },
  'nashville|united states': { lat: 36.16, lng: -86.77, display_name: 'Nashville, United States' },
  'copenhagen|denmark': { lat: 55.69, lng: 12.57, display_name: 'Copenhagen, Denmark' },
});

export const satellite = (over: Partial<Satellite> = {}): Satellite => ({
  id: 'alpha25-copenhagen',
  parent: 'alpha25',
  name: 'Alpha 2025 Copenhagen',
  link: 'https://alpha.example/cph',
  city: 'Copenhagen',
  country: 'Denmark',
  start: '2025-06-02',
  end: '2025-06-06',
  official: false,
  presents_papers: true,
  access: 'open',
  ...over,
});
