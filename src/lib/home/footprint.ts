// Per-site distance and estimated footprint from home (DESIGN §5, §6.5, §6.7). Pure helpers over
// the CO2 model; wording stays order-of-magnitude (`~`, "roughly").
import {
  estimateTrip,
  type EstimateOptions,
  type TravelMode,
  type TripEstimate,
} from '../co2/model';
import { compareTrips } from '../co2/format';
import { isPinned, type JoinedLocation, type PinnedJoined } from '../data/load';
import { haversineKm, type LatLng } from '../geo/distance';

type Site = LatLng & { id: string; city: string };

/** `estimateTrip`, but invalid coordinates or settings give undefined instead of throwing. */
export function safeTrip(
  from: LatLng,
  to: LatLng,
  opts: EstimateOptions,
): TripEstimate | undefined {
  try {
    return estimateTrip(from, to, opts);
  } catch {
    return undefined;
  }
}

/** The site closest to `home` (great-circle). Ties go to the earlier site. */
export function nearestSite<S extends LatLng>(home: LatLng, sites: readonly S[]): S | undefined {
  let best: S | undefined;
  let bestKm = Infinity;
  for (const s of sites) {
    const km = haversineKm(home, s);
    if (km < bestKm) {
      bestKm = km;
      best = s;
    }
  }
  return best;
}

/** How to attend a conference from home: travel to its nearest site, or attend online. */
export type SiteOption<S> =
  { kind: 'trip'; site: S & PinnedJoined; trip: TripEstimate } | { kind: 'online'; site: S };

/**
 * The best option among a conference's sites (global mode, no per-trip override): online if any
 * site is virtual (no trip is estimated), else the nearest pinned site with its trip estimate.
 */
export function nearestOption<S extends JoinedLocation>(
  home: LatLng,
  sites: readonly S[],
  opts: Omit<EstimateOptions, 'override'>,
): SiteOption<S> | undefined {
  const online = sites.find((s) => !isPinned(s));
  if (online) return { kind: 'online', site: online };
  const site = nearestSite(
    home,
    sites.filter((s): s is S & PinnedJoined => isPinned(s)),
  );
  const trip = site && safeTrip(home, site, opts);
  return site && trip ? { kind: 'trip', site, trip } : undefined;
}

export const tripVerb = (mode: TravelMode): string =>
  mode === 'rail' ? 'taking the train' : 'flying';

/**
 * "Paris: roughly 54× less than flying to Sydney". `near` is the nearer satellite, `far` the site
 * it is compared with (the main venue).
 */
export function comparisonLine(
  near: { site: Pick<Site, 'city'>; trip: TripEstimate },
  far: { site: Pick<Site, 'city'>; trip: TripEstimate },
): string {
  const verdict = compareTrips(near.trip, far.trip);
  const joiner = verdict === 'about the same' ? 'as' : 'than';
  return `${near.site.city}: ${verdict} ${joiner} ${tripVerb(far.trip.mode)} to ${far.site.city}`;
}
