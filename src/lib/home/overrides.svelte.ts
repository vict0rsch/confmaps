// Per-trip mode overrides from the detail panel (DESIGN §5.2): site id -> rail or flight.
// Detail-only and in-memory: never persisted, never read by filters.
import { SvelteMap } from 'svelte/reactivity';
import type { TravelMode } from '../co2/model';

export const tripOverrides = new SvelteMap<string, TravelMode>();
