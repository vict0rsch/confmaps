import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../analytics', () => ({ track: vi.fn() }));

import { track } from '../analytics';
import { liveIds, shownIds } from '../map/choreography';
import { historyStops } from '../timeline/history';
import { addDays, dataSpan, windowDays } from '../timeline/scale';
import { app } from './app.svelte';
import { defaultDates, filterState, getDates, setDates } from './filters.svelte';
import { historyMode, play, PlayState, scope } from './timeline.svelte';
import { buildQuery, parseHistory, type URLInputs } from './url';
import { DEFAULT_TRAVEL } from './travel.svelte';

const spring = { from: '2025-03-01', to: '2025-08-31' };

beforeEach(() => {
  historyMode.exit();
  play.pause();
  filterState.resetAll();
  app.select(null);
  vi.mocked(track).mockClear();
});

describe('PlayState', () => {
  it('slides the dates window one month per second at 1×, keeping its width', () => {
    const p = new PlayState({ reducedMotion: () => false });
    setDates(spring);
    p.play();
    expect(p.playing).toBe(true);
    p.step(1000);
    expect(getDates().from).toBe('2025-03-31');
    expect(windowDays(getDates())).toBe(windowDays(spring));
    p.speed = 2;
    p.step(1000);
    expect(getDates().from).toBe('2025-05-31');
    p.pause();
  });

  it('reduced motion steps whole months', () => {
    const p = new PlayState({ reducedMotion: () => true });
    setDates(spring);
    p.play();
    p.step(900);
    expect(getDates()).toEqual(spring);
    p.step(200);
    expect(getDates()).toEqual({ from: '2025-04-01', to: '2025-09-30' });
    p.pause();
  });

  it('stops at the data end, and rewinds to the data start when played again', () => {
    const p = new PlayState({ reducedMotion: () => false });
    setDates(spring);
    p.play();
    for (let i = 0; i < 60 && p.playing; i++) p.step(1000);
    expect(p.playing).toBe(false);
    expect(getDates().to).toBe(scope.span.to);
    p.play();
    expect(getDates().from).toBe(`${scope.span.from.slice(0, 7)}-01`);
    p.pause();
  });

  it('pauses on any outside change of the window (drag, preset, filter panel)', () => {
    const p = new PlayState({ reducedMotion: () => false });
    setDates(spring);
    p.play();
    p.step(500);
    setDates(defaultDates());
    p.step(500);
    expect(p.playing).toBe(false);
    expect(getDates()).toEqual(defaultDates());
  });

  it('reports play_pressed once per page load', () => {
    const p = new PlayState({ reducedMotion: () => false });
    setDates(spring);
    p.play();
    p.pause();
    p.play();
    p.pause();
    expect(vi.mocked(track).mock.calls.filter(([n]) => n === 'play_pressed')).toHaveLength(1);
  });

  it('cannot play a window wider than the data', () => {
    setDates({ from: addDays(scope.span.from, -1), to: addDays(scope.span.to, 1) });
    expect(play.canPlay).toBe(false);
  });
});

describe('scope.span', () => {
  const all = dataSpan(app.data.locations)!;

  it('covers all data when no filter is applied', () => {
    expect(scope.span).toEqual(all);
  });

  it('starts at the first event passing the filters; the end stays at the data end', () => {
    filterState.set('search', 'iclr');
    const from = scope.candidates.map((l) => l.start).sort()[0];
    expect(from > all.from).toBe(true);
    expect(scope.span).toEqual({ from, to: all.to });
    // Play rewinds to that start.
    setDates({ from: '2026-01-01', to: all.to });
    play.play();
    expect(getDates().from).toBe(`${from.slice(0, 7)}-01`);
    play.pause();
  });

  it('falls back to all data when nothing passes the filters', () => {
    filterState.set('search', 'zzzz-no-match');
    expect(scope.candidates).toHaveLength(0);
    expect(scope.span).toEqual(all);
  });
});

describe('history mode', () => {
  it('shows every edition of the series, ignoring (but keeping) the dates window', () => {
    setDates({ from: '2026-01-01', to: '2026-01-31' });
    historyMode.enter('neurips');
    // However far back the data goes (past editions may be imported).
    const editions = app.data.conferences.filter((c) => c.series === 'neurips');
    const confs = new Set(app.visibleLocations.map((l) => l.conferenceId));
    expect([...confs].sort()).toEqual(editions.map((c) => c.id).sort());
    expect(getDates()).toEqual({ from: '2026-01-01', to: '2026-01-31' }); // not mutated
    expect(historyMode.stops.slice(-2).map((s) => s.city)).toEqual(['San Diego', 'Sydney']);
    expect(historyMode.years.slice(-2)).toEqual([2025, 2026]);
    expect(historyMode.years).toHaveLength(new Set(editions.map((c) => c.year)).size);
    expect(vi.mocked(track)).toHaveBeenCalledWith('history_mode_opened');
    historyMode.exit();
    expect(
      app.visibleLocations.every((l) => l.start <= '2026-01-31' && l.end >= '2026-01-01'),
    ).toBe(true);
  });

  it('still applies the other filters', () => {
    filterState.set('kind', 'community');
    historyMode.enter('neurips');
    expect(app.visibleLocations.every((l) => !l.official)).toBe(true);
    expect(historyMode.stops).toEqual([]);
  });

  it('closes the open conference on entry and restores it on exit', () => {
    app.select('icml26');
    historyMode.enter('icml');
    expect(app.selectedConferenceId).toBeNull();
    historyMode.exit();
    expect(app.selectedConferenceId).toBe('icml26');
  });

  it('from a URL: keeps the selection and does not report analytics', () => {
    app.select('icml26');
    historyMode.enter('icml', { fromURL: true });
    expect(historyMode.series).toBe('icml');
    expect(app.selectedConferenceId).toBe('icml26');
    expect(vi.mocked(track)).not.toHaveBeenCalled();
  });

  it('ignores unknown series', () => {
    historyMode.enter('nope');
    expect(historyMode.series).toBeNull();
  });

  it('Play travels the stops, revealing editions as it reaches them', () => {
    historyMode.enter('iclr');
    const p = new PlayState({ reducedMotion: () => false });
    p.play();
    expect(p.travel).toBe(0);
    const stops = historyMode.stops;
    expect(stops.slice(-3).map((s) => s.years[0])).toEqual([2025, 2026, 2027]);
    const mains = (i: number) => stops[i].conferenceIds.map((id) => `${id}@main`);
    const at = () => shownIds(app.visibleLocations, stops, p.travelShown);
    expect([...at()]).toEqual(mains(0));
    p.step(1800); // one leg at 1×
    expect([...at()].sort()).toEqual([...mains(0), ...mains(1)].sort());
    expect([...liveIds(app.visibleLocations, null, stops, p.travelShown)]).toEqual(mains(1));
    p.step(1800 * (stops.length - 1));
    expect(p.playing).toBe(false);
    expect(p.travel).toBeNull(); // complete: whole path shown
    expect(at().size).toBe(app.visibleLocations.length);
  });

  it('a single edition cannot play', () => {
    const series = [...new Set(app.data.conferences.map((c) => c.series))];
    const single = series.find(
      (s) => historyStops(app.data.locations.filter((l) => l.conference.series === s)).length === 1,
    )!;
    historyMode.enter(single);
    expect(historyMode.stops).toHaveLength(1);
    expect(play.canPlay).toBe(false);
  });
});

describe('live pins during Play', () => {
  it("are visible events under the window's leading edge", () => {
    const locs = app.data.locations.filter((l) => l.conferenceId === 'neurips26');
    const t = '2026-12-10';
    expect([...liveIds(locs, t, null, null)].sort()).toEqual([
      'neurips26-atlanta',
      'neurips26-paris',
      'neurips26@main',
    ]);
    expect(liveIds(locs, '2026-12-20', null, null).size).toBe(0);
  });
});

describe('URL h', () => {
  const inputs = (history: string | null | undefined): URLInputs => ({
    filters: filterState.filters,
    states: filterState.defaults(),
    selection: null,
    travel: { ...DEFAULT_TRAVEL },
    history,
  });
  const isSeries = (s: string) => historyMode.isSeries(s);

  it('round-trips the series', () => {
    const q = buildQuery('', inputs('icml'));
    expect(q).toBe('h=icml');
    expect(parseHistory(q, isSeries)).toBe('icml');
  });

  it('is removed on exit, kept when the caller does not own it, ignored when unknown', () => {
    expect(buildQuery('h=icml&x=1', inputs(null))).toBe('x=1');
    expect(buildQuery('h=icml&x=1', inputs(undefined))).toBe('h=icml&x=1');
    expect(parseHistory('h=bogus', isSeries)).toBeNull();
    expect(parseHistory('', isSeries)).toBeNull();
  });

  it('sits after the selection, before filters', () => {
    const q = buildQuery('', {
      ...inputs('neurips'),
      selection: 'neurips26',
      states: { ...filterState.defaults(), kind: 'official' },
    });
    expect(q).toBe('c=neurips26&h=neurips&kind=official');
  });
});
