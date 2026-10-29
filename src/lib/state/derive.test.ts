import { describe, expect, it } from 'vitest';
import { joinData, trackName, type JoinedLocation } from '../data/load';
import type { Conference, DataFile, EventLocation } from '../data/types';
import {
  addMonthsISO,
  deadlineSummary,
  foldTracks,
  groupByConference,
  inWindow,
  planWindow,
  todayISO,
  windowPredicate,
} from './derive';

const conf = (id: string, over: Partial<Conference> = {}): Conference => ({
  id,
  series: id.replace(/\d+$/, ''),
  title: id.toUpperCase(),
  year: 2026,
  link: `https://${id}.example`,
  tags: [],
  deadlines: [],
  start: '2026-12-01',
  end: '2026-12-05',
  source: 'hf',
  ...over,
});

const loc = (conferenceId: string, over: Partial<EventLocation> = {}): EventLocation => ({
  id: `${conferenceId}@main`,
  conferenceId,
  role: 'main',
  name: conferenceId,
  city: 'Paris',
  country: 'France',
  lat: 48.85,
  lng: 2.35,
  start: '2026-12-01',
  end: '2026-12-05',
  official: true,
  presentsPapers: true,
  access: 'registration',
  link: 'https://x.example',
  ...over,
});

/** A virtual main edition: no city or coordinates. */
const virtual = (conferenceId: string, over: Partial<EventLocation> = {}): EventLocation =>
  ({
    id: `${conferenceId}@main`,
    conferenceId,
    role: 'main',
    format: 'virtual',
    name: conferenceId,
    start: '2026-12-01',
    end: '2026-12-05',
    official: true,
    presentsPapers: true,
    access: 'registration',
    link: 'https://x.example',
    ...over,
  }) as EventLocation;

const file = (conferences: Conference[], locations: EventLocation[]): DataFile => ({
  generatedAt: '2026-10-22T00:00:00.000Z',
  conferences,
  locations,
});

describe('joinData', () => {
  it('joins locations to conferences, main first, and drops orphans', () => {
    const d = joinData(
      file(
        [conf('a26')],
        [
          loc('a26', { id: 'a26-sat', role: 'satellite', start: '2026-11-01' }),
          loc('a26'),
          loc('missing26'),
        ],
      ),
    );
    expect(d.locations).toHaveLength(2);
    expect(d.locations[0].conference.id).toBe('a26');
    expect(d.locationsByConference.get('a26')!.map((l) => l.id)).toEqual(['a26@main', 'a26-sat']);
    expect(d.conferenceById.get('a26')?.title).toBe('A26');
  });

  it('keeps virtual locations (listed), but only pinned ones are pins', () => {
    const d = joinData(file([conf('a26'), conf('v20')], [loc('a26'), virtual('v20')]));
    expect(d.locations.map((l) => l.id)).toEqual(['a26@main', 'v20@main']);
    expect(d.pinnedLocations.map((l) => l.id)).toEqual(['a26@main']);
    expect(d.locationsByConference.get('v20')).toHaveLength(1);
  });
});

describe('dates', () => {
  it('formats local today', () => {
    expect(todayISO(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('adds months with day clamping', () => {
    expect(addMonthsISO('2026-10-22', 12)).toBe('2027-10-22');
    expect(addMonthsISO('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonthsISO('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsISO('2026-11-30', 3)).toBe('2027-02-28');
  });

  it('Plan default window is today → +12 months', () => {
    expect(planWindow('2026-10-22')).toEqual({ from: '2026-10-22', to: '2027-10-22' });
  });
});

describe('visible predicate (Plan default)', () => {
  const w = planWindow('2026-10-22');
  it.each([
    ['ended yesterday', '2026-10-01', '2026-10-21', false],
    ['ends today', '2026-10-18', '2026-10-22', true],
    ['ongoing', '2026-10-20', '2026-10-25', true],
    ['starts on the last day', '2027-10-22', '2027-10-25', true],
    ['starts after the window', '2027-10-23', '2027-10-25', false],
  ])('%s', (_name, start, end, expected) => {
    expect(inWindow({ start, end }, w)).toBe(expected);
  });

  it('tests each location on its own dates', () => {
    const d = joinData(
      file(
        [conf('a26', { start: '2026-09-01', end: '2026-09-05' })],
        [
          loc('a26', { start: '2026-09-01', end: '2026-09-05' }),
          loc('a26', { id: 'a26-sat', role: 'satellite', start: '2026-11-01', end: '2026-11-02' }),
        ],
      ),
    );
    expect(d.locations.filter(windowPredicate(w)).map((l) => l.id)).toEqual(['a26-sat']);
  });
});

const today = '2026-10-22';

describe('groupByConference', () => {
  it('lists conferences with ≥1 visible site, sorted by earliest visible start', () => {
    const d = joinData(
      file(
        [
          conf('late26', { start: '2027-03-01' }),
          conf('early26', { start: '2026-11-01' }),
          conf('b26'),
        ],
        [
          loc('late26', { start: '2027-03-01', end: '2027-03-03' }),
          loc('early26', { start: '2026-11-01', end: '2026-11-03' }),
          loc('b26', { id: 'b26-sat', role: 'satellite', start: '2026-10-30', end: '2026-10-31' }),
          loc('b26', { start: '2026-12-01' }),
        ],
      ),
    );
    const items = groupByConference(d.locations as JoinedLocation[], today);
    expect(items.map((i) => i.conference.id)).toEqual(['b26', 'early26', 'late26']);
    expect(items[0].sites.map((s) => s.role)).toEqual(['main', 'satellite']);
  });

  it('breaks ties by title', () => {
    const d = joinData(file([conf('zz26'), conf('aa26')], [loc('zz26'), loc('aa26')]));
    expect(groupByConference(d.locations, today).map((i) => i.conference.id)).toEqual([
      'aa26',
      'zz26',
    ]);
  });

  it('lists upcoming rows soonest first, then finished rows most recent first', () => {
    const at = (id: string, start: string, end: string) => loc(id, { start, end });
    const d = joinData(
      file(
        ['old25', 'past26', 'yday26', 'endstoday26', 'next26', 'later27'].map((id) => conf(id)),
        [
          at('later27', '2027-02-01', '2027-02-03'),
          at('old25', '2025-06-01', '2025-06-03'),
          at('next26', '2026-12-01', '2026-12-05'),
          at('past26', '2026-03-01', '2026-03-03'),
          at('endstoday26', '2026-10-18', '2026-10-22'),
          at('yday26', '2026-10-19', '2026-10-21'),
        ],
      ),
    );
    expect(groupByConference(d.locations, today).map((i) => i.conference.id)).toEqual([
      'endstoday26',
      'next26',
      'later27',
      'yday26',
      'past26',
      'old25',
    ]);
  });

  it('keeps a row upcoming while one visible site has not ended', () => {
    const d = joinData(
      file(
        [conf('sat26'), conf('yday26')],
        [
          loc('sat26', { start: '2026-09-01', end: '2026-09-05' }),
          loc('sat26', {
            id: 'sat26-sat',
            role: 'satellite',
            start: '2026-11-01',
            end: '2026-11-02',
          }),
          loc('yday26', { start: '2026-10-19', end: '2026-10-21' }),
        ],
      ),
    );
    expect(groupByConference(d.locations, today).map((i) => i.conference.id)).toEqual([
      'sat26',
      'yday26',
    ]);
  });
});

describe('tracks of one event', () => {
  const tracks = () =>
    joinData(
      file(
        [
          conf('emnlp26sys', { series: 'emnlp', title: 'EMNLP (System Demonstrations Track)' }),
          conf('emnlp26ind', { series: 'emnlp', title: 'EMNLP (Industry Track)' }),
          conf('emnlp26', { series: 'emnlp', title: 'EMNLP' }),
          // Same series and year, elsewhere or another time: not a track.
          conf('emnlp26x', { series: 'emnlp', title: 'EMNLP (Other)', start: '2027-01-01' }),
          conf('emnlp26y', { series: 'emnlp', title: 'EMNLP (Away)' }),
        ],
        [
          loc('emnlp26sys'),
          loc('emnlp26ind'),
          loc('emnlp26'),
          loc('emnlp26x', { start: '2027-01-01', end: '2027-01-03' }),
          loc('emnlp26y', { city: 'Rome' }),
        ],
      ),
    );

  it('groups same series + year + city + overlapping dates, main event first', () => {
    const d = tracks();
    expect(d.trackGroups.get('emnlp26ind')!.map((c) => c.id)).toEqual([
      'emnlp26',
      'emnlp26ind',
      'emnlp26sys',
    ]);
    expect(d.trackGroups.has('emnlp26x')).toBe(false);
    expect(d.trackGroups.has('emnlp26y')).toBe(false);
    expect(trackName(d.conferenceById.get('emnlp26ind')!)).toBe('Industry Track');
    expect(trackName(d.conferenceById.get('emnlp26')!)).toBeNull();
  });

  it('never groups virtual editions (no city to match)', () => {
    const d = joinData(
      file(
        [
          conf('emnlp20', { series: 'emnlp', title: 'EMNLP' }),
          conf('emnlp20ind', { series: 'emnlp', title: 'EMNLP (Industry Track)' }),
        ],
        [virtual('emnlp20'), virtual('emnlp20ind')],
      ),
    );
    expect(d.trackGroups.size).toBe(0);
  });

  it('folds tracks into one list row, led by the highest-ranked visible member', () => {
    const d = tracks();
    const rows = foldTracks(groupByConference(d.locations, today), d.trackGroups);
    const emnlp = rows.filter((r) => r.conference.id.startsWith('emnlp26'));
    expect(emnlp.map((r) => [r.conference.id, r.tracks.map((t) => t.id)])).toEqual([
      ['emnlp26', ['emnlp26ind', 'emnlp26sys']],
      ['emnlp26y', []],
      ['emnlp26x', []],
    ]);
    // Main event filtered out: the next track leads.
    const partial = foldTracks(
      groupByConference(
        d.locations.filter((l) => l.conferenceId !== 'emnlp26'),
        today,
      ),
      d.trackGroups,
    );
    const row = partial.find((r) => r.tracks.length)!;
    expect(row.conference.id).toBe('emnlp26ind');
    expect(row.tracks.map((t) => t.id)).toEqual(['emnlp26sys']);
  });
});

describe('deadlineSummary', () => {
  const deadlines = [
    { type: 'abstract', label: 'Abstract', date: '2026-10-01T11:59:59Z', timezone: 'AoE' },
    { type: 'paper', label: 'Paper', date: '2026-10-08T11:59:59Z', timezone: 'AoE' },
    { type: 'notification', label: 'Notification', date: '2027-01-15T00:00:00Z', timezone: 'UTC' },
  ];
  const c = conf('a26', { deadlines });

  it('paper deadline passed, next is the notification', () => {
    const s = deadlineSummary(c, new Date('2026-10-22T00:00:00Z'));
    expect(s.paper).toEqual({ deadline: deadlines[1], passed: true });
    expect(s.next).toBe(deadlines[2]);
  });

  it('upcoming paper deadline, compared as UTC instants', () => {
    const s = deadlineSummary(c, new Date('2026-10-08T11:59:58Z'));
    expect(s.paper).toEqual({ deadline: deadlines[1], passed: false });
    expect(s.next).toBe(deadlines[1]);
    expect(deadlineSummary(c, new Date('2026-10-08T11:59:59Z')).paper?.passed).toBe(true);
  });

  it('treats `submission` as the paper deadline and prefers the next of several', () => {
    const multi = conf('b26', {
      deadlines: [
        { type: 'submission', label: 'Cycle 1', date: '2026-08-01T00:00:00Z', timezone: 'UTC' },
        { type: 'submission', label: 'Cycle 2', date: '2026-12-01T00:00:00Z', timezone: 'UTC' },
      ],
    });
    expect(deadlineSummary(multi, new Date('2026-10-22T00:00:00Z')).paper?.deadline.label).toBe(
      'Cycle 2',
    );
  });

  it('no deadlines', () => {
    expect(deadlineSummary(conf('c26'), new Date())).toEqual({ paper: undefined, next: undefined });
  });
});
