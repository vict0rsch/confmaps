import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../analytics', () => ({ track: vi.fn() }));

import { track } from '../analytics';
import { isSeries, seriesWindow } from '../filters/series';
import { home } from '../home/store.svelte';
import { liveIds, shownIds } from '../map/choreography';
import { historyStops, LEG_MS } from '../timeline/history';
import { addDays, dataSpan, windowDays } from '../timeline/scale';
import { app } from './app.svelte';
import { defaultDates, filterState, getDates, setDates } from './filters.svelte';
import { AUTOPLAY_MS, GLIDE_MS, play, PlayState, scope, tour, TOUR_MAX } from './timeline.svelte';
import { buildQuery, parseHistory, type URLInputs } from './url';
import { hydrateFromURL } from './url-sync.svelte';
import { DEFAULT_TRAVEL } from './travel.svelte';

const spring = { from: '2025-03-01', to: '2025-08-31' };

/** A series' editions as a link opens them (`?h=`): the filter and its window, no autoplay. */
function openHistory(series: string) {
  filterState.hydrate({ series, dates: seriesWindow(app.data.locations, series) });
  tour.enter({ fromURL: true });
}

beforeEach(() => {
  tour.exit();
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

describe('tour', () => {
  it('plays only the editions inside the dates window', () => {
    filterState.set('search', 'icml');
    setDates({ from: '2024-01-01', to: '2025-12-31' });
    expect(tour.canStart).toBe(true);
    tour.enter({ fromURL: true });
    expect(tour.active).toBe(true);
    expect(tour.canStart).toBe(false);
    expect(tour.stops.map((s) => s.years)).toEqual([[2024], [2025]]);
    expect(tour.series).toBe('icml');
    expect(tour.named).toBe(false);
    expect(getDates()).toEqual({ from: '2024-01-01', to: '2025-12-31' }); // not mutated
  });

  it(`does nothing above ${TOUR_MAX} conferences`, () => {
    setDates({ from: '2000-01-01', to: '2026-12-31' });
    expect(app.listItems.length).toBeGreaterThan(TOUR_MAX);
    expect(tour.canStart).toBe(false);
    tour.enter();
    expect(tour.active).toBe(false);
    expect(tour.stops).toEqual([]);
  });

  it('a filter change ends the tour and pauses Play; reverting it does not resume', () => {
    openHistory('icml');
    const p = new PlayState({ reducedMotion: () => false });
    p.play();
    p.step(LEG_MS);
    expect(p.playing).toBe(true);
    filterState.set('kind', 'official');
    expect(tour.active).toBe(false);
    expect(tour.stops).toEqual([]);
    p.step(16);
    expect(p.playing).toBe(false);
    expect(p.travel).toBeNull();
    filterState.set('kind', null);
    expect(tour.active).toBe(false);
  });

  it('View history: the series filter, a window over its editions, and a tour', () => {
    setDates({ from: '2026-01-01', to: '2026-01-31' });
    tour.viewHistory('neurips');
    expect(filterState.get('series')).toBe('neurips');
    expect(getDates()).toEqual(seriesWindow(app.data.locations, 'neurips'));
    expect(tour.active).toBe(true);
    expect(tour.series).toBe('neurips');
    expect(tour.named).toBe(false);
    // However far back the data goes (past editions may be imported).
    const editions = app.data.conferences.filter((c) => c.series === 'neurips');
    const confs = new Set(app.visibleLocations.map((l) => l.conferenceId));
    expect([...confs].sort()).toEqual(editions.map((c) => c.id).sort());
    expect(tour.stops.slice(-2).map((s) => s.city)).toEqual(['San Diego', 'Sydney']);
    expect(tour.years.slice(-2)).toEqual([2025, 2026]);
    expect(tour.years).toHaveLength(new Set(editions.map((c) => c.year)).size);
    expect(vi.mocked(track).mock.calls).toEqual([['history_mode_opened']]);
  });

  it('closes the open conference on entry and restores it on exit, keeping the filters', () => {
    app.select('icml26');
    tour.viewHistory('icml');
    expect(app.selectedConferenceId).toBeNull();
    tour.exit();
    expect(tour.active).toBe(false);
    expect(app.selectedConferenceId).toBe('icml26');
    expect(filterState.get('series')).toBe('icml');
  });

  it('from a URL: keeps the selection', () => {
    app.select('icml26');
    openHistory('icml');
    expect(tour.active).toBe(true);
    expect(app.selectedConferenceId).toBe('icml26');
  });

  it('ignores unknown series', () => {
    tour.viewHistory('nope');
    expect(tour.active).toBe(false);
    expect(filterState.get('series')).toBeNull();
  });

  it('Play travels the stops, revealing editions as it reaches them', () => {
    openHistory('iclr');
    const p = new PlayState({ reducedMotion: () => false });
    p.play();
    expect(p.travel).toBe(0);
    const stops = tour.stops;
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
    filterState.hydrate({ series: single, dates: seriesWindow(app.data.locations, single) });
    expect(tour.canStart).toBe(false);
    tour.enter({ fromURL: true });
    expect(tour.stops).toHaveLength(1);
    expect(play.canPlay).toBe(false);
  });

  it('names the stops when they mix series', () => {
    filterState.set('search', 'neurips, icml');
    setDates({ from: '2015-01-01', to: '2026-12-31' });
    tour.enter({ fromURL: true });
    expect(tour.active).toBe(true);
    expect(tour.series).toBeNull();
    expect(tour.named).toBe(true);
    expect(tour.title).toBe('');
    expect(tour.years).toEqual([]);
  });
});

describe('tour autoplay', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('from the button, Play starts after a short wait', () => {
    tour.viewHistory('icml');
    vi.advanceTimersByTime(AUTOPLAY_MS - 1);
    expect(play.playing).toBe(false);
    vi.advanceTimersByTime(1);
    expect(play.playing).toBe(true);
    expect(play.travel).toBe(0);
  });

  it('not from a URL', () => {
    openHistory('icml');
    vi.advanceTimersByTime(AUTOPLAY_MS);
    expect(play.playing).toBe(false);
  });

  it.each([
    ['exit', () => tour.exit()],
    ['a filter change', () => filterState.set('kind', 'official')],
    ['Play then Pause', () => (play.toggle(), play.toggle())],
    ['a scrub (any pause)', () => play.pause()],
  ])('is cancelled by %s', (_, cancel) => {
    tour.viewHistory('icml');
    vi.advanceTimersByTime(AUTOPLAY_MS / 2);
    cancel();
    vi.advanceTimersByTime(AUTOPLAY_MS);
    expect(play.playing).toBe(false);
  });
});

describe('tour stops (goTo)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // No rAF in Node: frames every 16 ms on the fake clock.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 16),
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    openHistory('icml');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const last = () => tour.stops.length - 1;

  it('pauses Play at the stop; Play continues from there', () => {
    const p = new PlayState({ reducedMotion: () => false });
    p.play();
    p.step(LEG_MS * 5.5);
    p.goTo(3);
    expect(p.playing).toBe(false);
    expect(p.travel).toBe(3);
    expect(p.stopIndex).toBe(3);
    p.play();
    expect(p.travel).toBe(3);
    p.step(LEG_MS);
    expect(p.travel).toBe(4);
    p.pause();
  });

  it('the first stop restarts the path; the last shows it complete, and Play starts over', () => {
    const p = new PlayState({ reducedMotion: () => false });
    p.goTo(0);
    vi.advanceTimersByTime(GLIDE_MS + 50);
    expect(p.travelShown).toBe(0);
    const firsts = tour.stops[0].conferenceIds.map((id) => `${id}@main`);
    expect([...shownIds(app.visibleLocations, tour.stops, p.travelShown)]).toEqual(firsts);
    p.goTo(last());
    expect(p.travel).toBeNull();
    expect(p.stopIndex).toBe(last());
    vi.advanceTimersByTime(GLIDE_MS + 50);
    expect(p.travelShown).toBeNull();
    p.play();
    expect(p.travel).toBe(0);
    p.pause();
  });

  it('glides through the stops in between, without stalling at each (dwell)', () => {
    const p = new PlayState({ reducedMotion: () => false });
    p.goTo(0); // from the whole path
    expect(p.travelShown).toBe(last());
    const seen: number[] = [];
    for (let t = 0; t < GLIDE_MS; t += 16) {
      vi.advanceTimersByTime(16);
      seen.push(p.travelShown!);
    }
    expect(seen.some((v) => v > 0 && v < last() && !Number.isInteger(v))).toBe(true);
    expect(seen.every((v, i) => i === 0 || v <= seen[i - 1])).toBe(true);
    // A new click mid-way retargets from where the path is drawn, without a jump.
    p.goTo(last());
    vi.advanceTimersByTime(GLIDE_MS / 2);
    const mid = p.travelShown!;
    expect(mid > 0 && mid < last()).toBe(true);
    p.goTo(2);
    expect(p.travelShown).toBe(mid);
    vi.advanceTimersByTime(GLIDE_MS + 50);
    expect(p.travelShown).toBe(2);
  });

  it('Play during a glide starts from its target', () => {
    const p = new PlayState({ reducedMotion: () => false });
    p.goTo(5);
    vi.advanceTimersByTime(GLIDE_MS / 2);
    p.play();
    expect(p.travel).toBe(5);
    expect(p.travelShown).toBe(5);
    p.pause();
  });

  it('jumps under reduced motion', () => {
    const p = new PlayState({ reducedMotion: () => true });
    p.goTo(4);
    expect(p.travelShown).toBe(4);
    p.goTo(last());
    expect(p.travelShown).toBeNull();
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
  const inputs: URLInputs = {
    filters: filterState.filters,
    states: filterState.defaults(),
    selection: null,
    travel: { ...DEFAULT_TRAVEL },
  };
  const known = (s: string) => isSeries(app.data.conferences, s);

  it('is dropped from the address bar, other params kept', () => {
    expect(buildQuery('h=icml&x=1', inputs)).toBe('x=1');
    expect(parseHistory('h=icml', known)).toBe('icml');
    expect(parseHistory('h=bogus', known)).toBeNull();
    expect(parseHistory('', known)).toBeNull();
  });

  it("opens the series' editions (filter and window, over the link's dates), not playing", () => {
    vi.useFakeTimers();
    hydrateFromURL('h=neurips&from=2026-01');
    expect(filterState.get('series')).toBe('neurips');
    expect(getDates()).toEqual(seriesWindow(app.data.locations, 'neurips'));
    expect(tour.active).toBe(true);
    vi.advanceTimersByTime(AUTOPLAY_MS);
    expect(play.playing).toBe(false);
    vi.useRealTimers();
  });

  describe('with a shared city', () => {
    // The city list arrives late: the city (Paris) then narrows what `radius` keeps.
    let arrive: () => void;
    beforeEach(() => {
      vi.spyOn(home, 'applyShared').mockImplementation(
        () =>
          new Promise((resolve) => {
            arrive = () => {
              app.home = { lat: 48.86, lng: 2.35 };
              resolve(true);
            };
          }),
      );
    });
    afterEach(() => {
      vi.restoreAllMocks();
      app.home = undefined;
    });
    const settle = () => new Promise((r) => setTimeout(r, 0));

    it('starts the tour once the city is in place', async () => {
      hydrateFromURL('h=icml&radius=2000&home=2988507');
      expect(tour.active).toBe(false);
      arrive();
      await settle();
      expect(tour.active).toBe(true);
      expect(tour.stops.length).toBeGreaterThan(1);
    });

    it('not when a filter changed meanwhile', async () => {
      hydrateFromURL('h=icml&radius=2000&home=2988507');
      filterState.set('kind', 'official');
      arrive();
      await settle();
      expect(tour.active).toBe(false);
    });
  });
});
