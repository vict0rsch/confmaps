import { describe, expect, it } from 'vitest';
import { location } from '../filters/fixtures';
import { trimLine } from '../map/geojson';
import {
  curve,
  historyFitPoints,
  historyLegs,
  historyStops,
  pathAt,
  stopIndexOf,
  stopLabels,
  travelDisplay,
} from './history';

const edition = (id: string, year: number, start: string, city: string, lat: number, lng: number) =>
  location(
    { id: `${id}@main`, conferenceId: id, start, end: start, city, lat, lng },
    { id, year, start, end: start, series: 'icml', title: 'ICML' },
  );

const vancouver = edition('icml25', 2025, '2025-07-13', 'Vancouver', 49.28, -123.12);
const seoul = edition('icml26', 2026, '2026-07-06', 'Seoul', 37.57, 126.98);
const vienna = edition('icml24', 2024, '2024-07-21', 'Vienna', 48.21, 16.37);

describe('historyStops', () => {
  it('orders editions chronologically, whatever the input order', () => {
    const stops = historyStops([seoul, vienna, vancouver]);
    expect(stops.map((s) => s.city)).toEqual(['Vienna', 'Vancouver', 'Seoul']);
    expect(stops.map((s) => s.years)).toEqual([[2024], [2025], [2026]]);
  });

  it('ignores satellites and merges consecutive editions at one place', () => {
    const track = location(
      {
        id: 'icml25ind@main',
        conferenceId: 'icml25ind',
        start: '2025-07-13',
        lat: 49.28,
        lng: -123.12,
      },
      { id: 'icml25ind', year: 2025, series: 'icml' },
    );
    const sat = location({ id: 'icml25-paris', role: 'satellite', conferenceId: 'icml25' });
    const stops = historyStops([vancouver, track, sat]);
    expect(stops).toHaveLength(1);
    expect(stops[0].conferenceIds).toEqual(['icml25', 'icml25ind']);
    expect(stops[0].years).toEqual([2025]);
  });

  it('unwraps longitudes so each leg takes the short way (across the Pacific)', () => {
    const [a, b] = historyStops([vancouver, seoul]);
    expect(a.lng).toBeCloseTo(-123.12);
    expect(b.lng).toBeCloseTo(126.98 - 360);
  });

  it('handles one edition (no legs) and none', () => {
    expect(historyLegs(historyStops([seoul]))).toEqual([]);
    expect(historyStops([])).toEqual([]);
  });

  it('assigns conferences without a visible main venue to the latest earlier stop', () => {
    const stops = historyStops([vienna, vancouver, seoul]);
    expect(stopIndexOf(stops, { id: 'icml25', start: '2025-07-13' })).toBe(1);
    expect(stopIndexOf(stops, { id: 'x', start: '2025-12-01' })).toBe(1);
    expect(stopIndexOf(stops, { id: 'x', start: '2020-01-01' })).toBe(0);
  });
});

describe('curve', () => {
  it('runs from a to b and bows to the left of travel', () => {
    const a = { lng: 0, lat: 0 };
    const b = { lng: 40, lat: 0 };
    const pts = curve(a, b);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts.at(-1)![0]).toBeCloseTo(40);
    expect(pts.at(-1)![1]).toBeCloseTo(0);
    expect(pts[24][1]).toBeGreaterThan(1); // eastbound → bows north
    expect(curve(b, a)[24][1]).toBeLessThan(-1); // the return leg bows the other way
  });
});

describe('path progress', () => {
  const stops = historyStops([vienna, vancouver, seoul]);
  const legs = historyLegs(stops);

  it('draws legs up to the progress, with a head mid-leg', () => {
    expect(pathAt(legs, 0)).toEqual({ lines: [], head: null });
    const half = pathAt(legs, 0.5);
    expect(half.lines).toHaveLength(1);
    expect(half.head).not.toBeNull();
    const done = pathAt(legs, 2);
    expect(done.lines).toEqual(legs);
    expect(done.head).toBeNull();
  });

  it('dwells at each stop, then eases; stepped jumps stop to stop', () => {
    expect(travelDisplay(0.2, false)).toBe(0);
    expect(travelDisplay(0.65, false)).toBeCloseTo(0.5);
    expect(travelDisplay(1.0, false)).toBe(1);
    expect(travelDisplay(0.99, true)).toBe(0);
    expect(travelDisplay(1.3, true)).toBe(1);
  });

  it('labels revealed stops with their years, sharing a label on a return visit', () => {
    expect(stopLabels(stops, 0)).toEqual([
      { lng: stops[0].lng, lat: stops[0].lat, years: '2024', city: 'Vienna' },
    ]);
    const back = edition('icml27', 2027, '2027-07-01', 'Vienna', 48.21, 16.37);
    const labels = stopLabels(historyStops([vienna, seoul, back]), 2);
    expect(labels.map((l) => l.years)).toEqual(['2024 · 2027', '2026']);
  });

  it('fit points include the arcs, with others unwrapped next to the path', () => {
    const pts = historyFitPoints(stops, legs, [{ lng: 179, lat: 0 }]);
    expect(pts.length).toBe(stops.length + legs.flat().length + 1);
    expect(pts.at(-1)!.lng).toBeLessThan(0);
  });
});

describe('trimLine', () => {
  const line: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
  ];
  it('cuts by length, ending on an interpolated point', () => {
    expect(trimLine(line, 0.25)).toEqual([
      [0, 0],
      [5, 0],
    ]);
    expect(trimLine(line, 0.75)).toEqual([
      [0, 0],
      [10, 0],
      [10, 5],
    ]);
    expect(trimLine(line, 1)).toEqual(line);
    expect(trimLine(line, 0)).toHaveLength(2);
  });
});
