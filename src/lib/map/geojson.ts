// GeoJSON builders for the map's data sources (pure; unit-tested).
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { JoinedLocation } from '../data/load';

export type PinProps = {
  id: string;
  conferenceId: string;
  /** 1 = main venue, 0 = satellite (numeric so style expressions stay simple). */
  main: 0 | 1;
  /** 1 = official (filled pin), 0 = community (ring). */
  official: 0 | 1;
  /** 1 = authors only (lock badge). */
  locked: 0 | 1;
  label: string;
};

export type PinFeature = Feature<Point, PinProps>;
export type PinCollection = FeatureCollection<Point, PinProps>;
export type LinkCollection = FeatureCollection<LineString, { conferenceId: string }>;

export function pinFeatures(locations: readonly JoinedLocation[]): PinCollection {
  return {
    type: 'FeatureCollection',
    features: locations.map((l) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [l.lng, l.lat] },
      properties: {
        id: l.id,
        conferenceId: l.conferenceId,
        main: l.role === 'main' ? 1 : 0,
        official: l.official ? 1 : 0,
        locked: l.access === 'authors_only' ? 1 : 0,
        label: `${l.conference.title} ${l.conference.year}`,
      },
    })),
  };
}

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/**
 * Great-circle arc from `a` to `b` as `[lng, lat]` points. Longitudes are unwrapped (may leave
 * ±180) so the line stays continuous across the antimeridian; MapLibre draws that correctly.
 */
export function greatCircle(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  segments = 64,
): [number, number][] {
  const [φ1, λ1, φ2, λ2] = [toRad(a.lat), toRad(a.lng), toRad(b.lat), toRad(b.lng)];
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2,
      ),
    );
  if (d < 1e-9)
    return [
      [a.lng, a.lat],
      [b.lng, b.lat],
    ];
  const points: [number, number][] = [];
  let prevLng: number | undefined;
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    let lng = toDeg(Math.atan2(y, x));
    const lat = toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)));
    if (prevLng !== undefined) {
      while (lng - prevLng > 180) lng -= 360;
      while (lng - prevLng < -180) lng += 360;
    }
    prevLng = lng;
    points.push([lng, lat]);
  }
  return points;
}

/** Main ↔ satellite arcs, for conferences whose main venue and ≥1 satellite are both visible. */
export function linkFeatures(locations: readonly JoinedLocation[]): LinkCollection {
  const mains = new Map<string, JoinedLocation>();
  for (const l of locations) if (l.role === 'main') mains.set(l.conferenceId, l);
  const features: LinkCollection['features'] = [];
  for (const l of locations) {
    const main = l.role === 'satellite' ? mains.get(l.conferenceId) : undefined;
    if (!main) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: greatCircle(main, l) },
      properties: { conferenceId: l.conferenceId },
    });
  }
  return { type: 'FeatureCollection', features };
}

export type Bounds = [[number, number], [number, number]];

/**
 * Bounding box `[[west, south], [east, north]]` of points. If the points span more than 180° of
 * longitude, the box is taken across the antimeridian instead (east may exceed 180).
 */
export function boundsOf(
  points: readonly { lat: number; lng: number }[],
  allowWrap = true,
): Bounds | null {
  if (!points.length) return null;
  const lats = points.map((p) => p.lat);
  let lngs = points.map((p) => p.lng);
  if (allowWrap && Math.max(...lngs) - Math.min(...lngs) > 180) {
    lngs = lngs.map((x) => (x < 0 ? x + 360 : x));
  }
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}
