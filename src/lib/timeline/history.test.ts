import { describe, expect, it } from 'vitest';
import { hybridLocation, location, oldEditionLocation, virtualLocation } from '../filters/fixtures';
import { trimLine } from '../map/geojson';
import {
  ageOpacity,
  curve,
  historyFitPoints,
  historyLegs,
  historyStops,
  mergeCloseLabels,
  MIN_OPACITY,
  onlineYears,
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

describe('virtual and hybrid editions', () => {
  // NeurIPS: NIPS 2017 Long Beach, online 2020 and 2021, hybrid 2022 New Orleans.
  const nips17 = oldEditionLocation();
  const v20 = virtualLocation();
  const v21 = virtualLocation(
    {},
    { id: 'neurips21', year: 2021, start: '2021-12-06', end: '2021-12-14' },
  );
  const h22 = hybridLocation();

  it('the path skips virtual editions: the leg joins the neighbouring stops', () => {
    const stops = historyStops([h22, v21, nips17, v20]);
    expect(stops.map((s) => [s.city, s.years])).toEqual([
      ['Long Beach', [2017]],
      ['New Orleans', [2022]],
    ]);
    expect(historyLegs(stops)).toHaveLength(1);
    expect(stopLabels(stops, 1).map((l) => l.years)).toEqual(['2017', '2022']);
  });

  it('lists the online years, distinct and ascending; none without virtual editions', () => {
    const v21ind = virtualLocation(
      { id: 'neurips21ind@main', conferenceId: 'neurips21ind' },
      { id: 'neurips21ind', year: 2021 },
    );
    expect(onlineYears([h22, v21, nips17, v20, v21ind])).toEqual([2020, 2021]);
    expect(onlineYears([nips17, h22])).toEqual([]);
  });

  it('keeps the historical title on the edition (series unchanged)', () => {
    expect(`${nips17.conference.title} ${nips17.conference.year}`).toBe('NIPS 2017');
    expect(nips17.conference.series).toBe('neurips');
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

  it('keeps a path circling the globe within the world copies the map draws (±540°)', () => {
    // ICML 2013–2018 heads west round the world. Unwrapped leg by leg, the stops drift past -540°,
    // where MapLibre's GeoJSON tiles drop features: the path and labels stopped at New York 2016.
    const west = historyStops([
      edition('icml13', 2013, '2013-06-16', 'Atlanta', 33.75, -84.39),
      edition('icml14', 2014, '2014-06-21', 'Beijing', 39.91, 116.39),
      edition('icml15', 2015, '2015-07-06', 'Lille', 50.64, 3.06),
      edition('icml16', 2016, '2016-06-19', 'New York City', 40.71, -74.01),
      edition('icml17', 2017, '2017-08-06', 'Sydney', -33.87, 151.21),
      edition('icml18', 2018, '2018-07-10', 'Stockholm', 59.33, 18.07),
    ]);
    expect(west.at(-1)!.lng).toBeLessThan(-540);
    const westLegs = historyLegs(west);
    const drawn = (lng: number) => Math.abs(lng) <= 540;
    const done = pathAt(westLegs, westLegs.length);
    expect(done.lines.flat().every(([lng]) => drawn(lng))).toBe(true);
    expect(drawn(pathAt(westLegs, westLegs.length - 0.5).head![0])).toBe(true);
    expect(stopLabels(west, west.length).every((l) => drawn(l.lng))).toBe(true);
    // Moved by whole turns only: each leg still takes the short way round.
    done.lines.forEach((line, i) => {
      const turns = (line[0][0] - westLegs[i][0][0]) / 360;
      expect(turns).toBeCloseTo(Math.round(turns));
      expect(line.at(-1)![0] - line[0][0]).toBeCloseTo(westLegs[i].at(-1)![0] - westLegs[i][0][0]);
    });
  });

  it('fades editions by age: the oldest at MIN_OPACITY, the newest at 1, linear in between', () => {
    const span = { oldest: 2013, newest: 2025 };
    expect(ageOpacity(2013, span)).toBeCloseTo(MIN_OPACITY);
    expect(ageOpacity(2019, span)).toBeCloseTo((MIN_OPACITY + 1) / 2);
    expect(ageOpacity(2025, span)).toBe(1);
    expect(ageOpacity(2010, span)).toBeCloseTo(MIN_OPACITY);
    expect(ageOpacity(2026, { oldest: 2026, newest: 2026 })).toBe(1);
  });

  it('merges labels that would overlap at this zoom into one stacked label, keeping every year', () => {
    const near = [
      { lng: -117.16, lat: 32.72, years: '2025', city: 'San Diego' },
      { lng: -118.19, lat: 33.77, years: '2017', city: 'Long Beach' },
      { lng: 16.37, lat: 48.21, years: '2024', city: 'Vienna' },
    ];
    const world = mergeCloseLabels(near, 2);
    expect(world).toHaveLength(2);
    // Anchored at the northernmost stop (Long Beach), rows in year order.
    expect(world[0]).toMatchObject({ lat: 33.77, rows: [{ years: '2017' }, { years: '2025' }] });
    expect(world[1].rows).toEqual([{ years: '2024', city: 'Vienna' }]);
    expect(mergeCloseLabels(near, 9).map((g) => g.rows.length)).toEqual([1, 1, 1]);
  });

  it('merges labels either side of the antimeridian', () => {
    const across = [
      { lng: 179, lat: 10, years: '2024', city: 'Fiji' },
      { lng: -179, lat: 10, years: '2025', city: 'Samoa' },
    ];
    expect(mergeCloseLabels(across, 2)).toHaveLength(1);
    expect(mergeCloseLabels(across, 9)).toHaveLength(2);
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
