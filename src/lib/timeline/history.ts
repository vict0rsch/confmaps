// History mode geometry (DESIGN §6.4), pure: a series' editions as chronological stops (main
// venues), the curved path linking them, its year labels, and travel progress for Play.
import { isPinned, type JoinedLocation, type PinnedJoined } from '../data/load';
import { trimLine } from '../map/geojson';
import { easeInOut } from './motion';

type LngLat = { lng: number; lat: number };
export type Coord = [number, number];

export type Stop = {
  lat: number;
  /** Unwrapped along the path (may leave ±180) so every leg takes the short way round. */
  lng: number;
  city: string;
  /** Edition years held here (consecutive editions at the same place share a stop). */
  years: number[];
  conferenceIds: string[];
  /** Start date of the first edition here. */
  start: string;
};

const samePlace = (a: LngLat, b: LngLat) =>
  Math.abs(a.lat - b.lat) < 1e-3 && Math.abs(a.lng - b.lng) < 1e-3;

/**
 * Chronological stops of a series from its visible locations: one per edition's main venue
 * (ordered by start date, then id). Consecutive editions at the same place merge into one stop,
 * e.g. EMNLP's main conference and its industry track. Virtual editions have no place: the path
 * skips them (the leg joins the neighbouring stops); hybrid ones are stops at their city.
 */
export function historyStops(visible: readonly JoinedLocation[]): Stop[] {
  const mains = visible
    .filter((l): l is PinnedJoined => l.role === 'main' && isPinned(l))
    .sort((a, b) => a.start.localeCompare(b.start) || a.conferenceId.localeCompare(b.conferenceId));
  const stops: Stop[] = [];
  let prevLng: number | undefined;
  for (const m of mains) {
    let lng = m.lng;
    if (prevLng !== undefined) {
      while (lng - prevLng > 180) lng -= 360;
      while (lng - prevLng < -180) lng += 360;
    }
    prevLng = lng;
    const last = stops.at(-1);
    if (last && samePlace(last, { lat: m.lat, lng })) {
      if (!last.years.includes(m.conference.year)) last.years.push(m.conference.year);
      last.conferenceIds.push(m.conferenceId);
      continue;
    }
    stops.push({
      lat: m.lat,
      lng,
      city: m.city,
      years: [m.conference.year],
      conferenceIds: [m.conferenceId],
      start: m.start,
    });
  }
  return stops;
}

/** Distinct years of the visible virtual main editions (off the path), ascending. */
export function onlineYears(visible: readonly JoinedLocation[]): number[] {
  const ys = visible
    .filter((l) => l.role === 'main' && !isPinned(l))
    .map((l) => l.conference.year)
    .sort((a, b) => a - b);
  return ys.filter((y, i) => y !== ys[i - 1]);
}

/**
 * The stop a conference belongs to: the one holding its main venue, else (main venue filtered
 * out) the latest stop that started on or before it.
 */
export function stopIndexOf(stops: readonly Stop[], c: { id: string; start: string }): number {
  const own = stops.findIndex((s) => s.conferenceIds.includes(c.id));
  if (own >= 0) return own;
  let idx = 0;
  stops.forEach((s, i) => {
    if (s.start <= c.start) idx = i;
  });
  return idx;
}

const RAD = Math.PI / 180;
const MAX_LAT = 85;
const mercY = (lat: number) =>
  Math.log(Math.tan(Math.PI / 4 + (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * RAD) / 2));
const latOf = (y: number) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / RAD;

/**
 * A gentle arc from `a` to `b`: a quadratic Bézier in Web Mercator, bowed to the left of the
 * direction of travel by `bend` × the leg's length (so a return leg bows the other way).
 */
export function curve(a: LngLat, b: LngLat, bend = 0.18, segments = 48): Coord[] {
  const [ax, ay, bx, by] = [a.lng * RAD, mercY(a.lat), b.lng * RAD, mercY(b.lat)];
  const [dx, dy] = [bx - ax, by - ay];
  const cx = (ax + bx) / 2 - dy * bend;
  const cy = (ay + by) / 2 + dx * bend;
  const out: Coord[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const [p, q, r] = [(1 - t) ** 2, 2 * (1 - t) * t, t ** 2];
    out.push([(p * ax + q * cx + r * bx) / RAD, latOf(p * ay + q * cy + r * by)]);
  }
  return out;
}

/** One arc per leg between consecutive stops. */
export const historyLegs = (stops: readonly Stop[]): Coord[][] =>
  stops.slice(1).map((s, i) => curve(stops[i], s));

/** Fraction of each leg spent dwelling at its starting stop before travelling on. */
export const DWELL = 0.3;
/** One leg (dwell + travel) per this many ms at 1×. */
export const LEG_MS = 1800;

/**
 * Displayed progress along the stops for raw (linear) progress: dwell at each stop, then ease to
 * the next. Stepped (reduced motion): stop to stop, no travel in between.
 */
export function travelDisplay(raw: number, stepped: boolean): number {
  const i = Math.floor(raw);
  if (stepped) return i;
  return i + easeInOut((raw - i - DWELL) / (1 - DWELL));
}

/** The path drawn up to `progress` (0 = first stop … legs.length = complete), and its head. */
export function pathAt(
  legs: readonly Coord[][],
  progress: number,
): { lines: Coord[][]; head: Coord | null } {
  const lines: Coord[][] = [];
  let head: Coord | null = null;
  legs.forEach((leg, i) => {
    const f = Math.max(0, Math.min(1, progress - i));
    if (f <= 0) return;
    const line = f >= 1 ? leg : trimLine(leg, f);
    lines.push(line);
    if (f < 1) head = line[line.length - 1];
  });
  return { lines, head };
}

export type StopLabel = { lng: number; lat: number; years: string; city: string };

/**
 * Year labels for the stops revealed so far (index ≤ `upTo`). Stops at the same place (a series
 * returning to a city) share one label: "2025 · 2027".
 */
export function stopLabels(stops: readonly Stop[], upTo: number): StopLabel[] {
  const out: (StopLabel & { list: number[] })[] = [];
  stops.forEach((s, i) => {
    if (i > upTo) return;
    const wrapped = { lat: s.lat, lng: ((((s.lng + 180) % 360) + 360) % 360) - 180 };
    const same = out.find((l) =>
      samePlace({ lat: l.lat, lng: ((((l.lng + 180) % 360) + 360) % 360) - 180 }, wrapped),
    );
    if (same) same.list.push(...s.years.filter((y) => !same.list.includes(y)));
    else out.push({ lng: s.lng, lat: s.lat, years: '', city: s.city, list: [...s.years] });
  });
  return out.map(({ list, ...l }) => ({ ...l, years: list.sort().join(' · ') }));
}

/**
 * Points to fit the camera to: the stops, their arcs (which bow out) and other locations (e.g.
 * satellites), unwrapped next to the path so the box takes the short way round.
 */
export function historyFitPoints(
  stops: readonly Stop[],
  legs: readonly Coord[][],
  others: readonly LngLat[],
): LngLat[] {
  const pts: LngLat[] = [
    ...stops,
    ...legs.flatMap((leg) => leg.map(([lng, lat]) => ({ lng, lat }))),
  ];
  const ref = stops.length ? stops.reduce((m, s) => m + s.lng, 0) / stops.length : undefined;
  for (const o of others) {
    let lng = o.lng;
    if (ref !== undefined) {
      while (lng - ref > 180) lng -= 360;
      while (lng - ref < -180) lng += 360;
    }
    pts.push({ lng, lat: o.lat });
  }
  return pts;
}
