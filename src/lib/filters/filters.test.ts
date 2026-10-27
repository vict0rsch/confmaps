import { describe, expect, it, vi } from 'vitest';
import { co2Model } from '../co2/model';
import { haversineKm } from '../geo/distance';
import { accessFilter } from './access';
import { co2Filter, tripKg } from './co2';
import { createDatesFilter, parseDay } from './dates';
import { ctx, hybridLocation, LONDON, location, PARIS, virtualLocation } from './fixtures';
import { createFilters } from './index';
import { kindFilter } from './kind';
import { openFilter, submissionOpen } from './open';
import { radiusFilter } from './radius';
import { cleanQuery, fold, matchesQuery, searchFilter } from './search';
import { normalizeTag, subjectCatalog, subjectFilter, subjectOfTag, SUBJECTS } from './subject';
import { RESERVED_PARAMS, SELECTION_PARAM, TRAVEL_PARAMS } from '../state/url';
import type { AnyFilter } from './types';

const today = '2026-10-22';
const dates = createDatesFilter(today);

/** fromURL(toURL(s)) ≡ s for every listed state. */
function roundTrips(f: AnyFilter, states: unknown[]) {
  for (const s of states) expect(f.fromURL(f.toURL(s)), JSON.stringify(s)).toEqual(s);
}

describe('registry', () => {
  const filters = createFilters(today);

  it('lists the 8 filters with unique ids and non-colliding URL params', () => {
    expect(filters.map((f) => f.id)).toEqual([
      'search',
      'dates',
      'subject',
      'radius',
      'co2',
      'open',
      'access',
      'kind',
    ]);
    const params = filters.flatMap((f) => f.params);
    const shell = [SELECTION_PARAM, ...Object.values(TRAVEL_PARAMS), ...RESERVED_PARAMS];
    expect(new Set([...params, ...shell]).size).toBe(params.length + shell.length);
  });

  it('defaults are inactive (except via appliesWhenInactive) and round-trip to themselves', () => {
    for (const f of filters) {
      expect(f.isActive(f.defaultState), f.id).toBe(false);
      expect(f.fromURL(''), f.id).toEqual(f.defaultState);
    }
    expect(filters.filter((f) => f.appliesWhenInactive).map((f) => f.id)).toEqual(['dates']);
  });

  it('fromURL never throws on junk and falls back to defaults', () => {
    const junk = [
      '%',
      '%E0%A4%A',
      'from=2026-13&to=abc',
      'sub=,,,&radius=-5&co2=1e3&access=all&kind=both&open=yes&q=',
      'radius=99999999999&co2=0',
      '&&&=&',
    ];
    for (const f of filters) {
      for (const q of junk) expect(() => f.fromURL(q)).not.toThrow();
    }
    const q = 'from=2026-13&to=abc&radius=-5&co2=1e3&access=all&kind=both&open=yes&q=&sub=,,';
    for (const f of filters) expect(f.fromURL(q), f.id).toEqual(f.defaultState);
  });
});

describe('dates', () => {
  const loc = (start: string, end: string) => location({ start, end });

  it('defaults to the Plan window and is not active there', () => {
    expect(dates.defaultState).toEqual({ from: '2026-10-22', to: '2027-10-22' });
    expect(dates.isActive(dates.defaultState)).toBe(false);
    expect(dates.isActive({ from: '2026-10-22', to: '2027-04-22' })).toBe(true);
  });

  it('tests overlap inclusively: end ≥ from && start ≤ to', () => {
    const w = { from: '2026-11-01', to: '2026-11-30' };
    const c = ctx();
    expect(dates.test(loc('2026-10-25', '2026-11-01'), c, w)).toBe(true); // ends on `from`
    expect(dates.test(loc('2026-11-30', '2026-12-02'), c, w)).toBe(true); // starts on `to`
    expect(dates.test(loc('2026-10-01', '2027-01-01'), c, w)).toBe(true); // spans the window
    expect(dates.test(loc('2026-10-25', '2026-10-31'), c, w)).toBe(false);
    expect(dates.test(loc('2026-12-01', '2026-12-03'), c, w)).toBe(false);
  });

  it('encodes whole months as YYYY-MM and other days in full', () => {
    expect(dates.toURL({ from: '2026-11-01', to: '2027-10-31' })).toBe('from=2026-11&to=2027-10');
    expect(dates.toURL({ from: '2026-10-22', to: '2027-02-28' })).toBe(
      'from=2026-10-22&to=2027-02',
    );
    expect(dates.fromURL('from=2026-11&to=2027-10')).toEqual({
      from: '2026-11-01',
      to: '2027-10-31',
    });
  });

  it('round-trips', () => {
    roundTrips(dates, [
      { from: '2026-11-01', to: '2027-10-31' },
      { from: '2026-10-22', to: '2027-10-22' },
      { from: '2021-10-22', to: '2026-10-22' },
      { from: '2024-02-29', to: '2024-02-29' },
      { from: '2026-01-15', to: '2026-02-01' },
    ]);
  });

  it('parses partial and invalid params safely', () => {
    expect(dates.fromURL('from=2027-01')).toEqual({ from: '2027-01-01', to: '2027-10-22' });
    expect(dates.fromURL('to=2026-12')).toEqual({ from: '2026-10-22', to: '2026-12-31' });
    expect(dates.fromURL('from=2028-01&to=2027-01')).toEqual(dates.defaultState); // inverted
    expect(dates.fromURL('from=2028-01')).toEqual(dates.defaultState); // past the default `to`
    expect(parseDay('2026-02-30', 'start')).toBeUndefined();
    expect(parseDay('2025-02', 'end')).toBe('2025-02-28');
    expect(parseDay('1800-01', 'start')).toBeUndefined();
    expect(parseDay('2026-1-1', 'start')).toBeUndefined();
  });
});

describe('subject', () => {
  it('normalizes upstream tag variants into one subject', () => {
    expect(normalizeTag(' Machine learning ')).toBe('machine-learning');
    expect(subjectOfTag('machine learning').code).toBe('ML');
    expect(subjectOfTag('computer vision').code).toBe('CV');
    expect(subjectOfTag('image processing').code).toBe('CV');
    expect(subjectOfTag('semantics and knowledge').code).toBe('KR');
    expect(subjectOfTag('automated-planning').code).toBe('KR'); // PwC's "AP"
  });

  it('labels unknown tags HF-style in the Other group', () => {
    expect(subjectOfTag('quantum-computing')).toEqual({
      code: 'quantum-computing',
      label: 'Quantum Computing',
      group: 'Other',
      tags: ['quantum-computing'],
    });
  });

  it('has unique codes and tags', () => {
    expect(new Set(SUBJECTS.map((s) => s.code)).size).toBe(SUBJECTS.length);
    const tags = SUBJECTS.flatMap((s) => s.tags);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('matches if any of the conference tags is in any selected subject', () => {
    const cv = location({}, { tags: ['computer-vision', 'machine-learning'] });
    const nlp = location({}, { tags: ['natural-language-processing'] });
    const none = location({}, { tags: [] });
    const c = ctx();
    expect(subjectFilter.test(cv, c, ['CV'])).toBe(true);
    expect(subjectFilter.test(cv, c, ['NLP', 'ML'])).toBe(true);
    expect(subjectFilter.test(nlp, c, ['CV'])).toBe(false);
    expect(subjectFilter.test(none, c, ['CV'])).toBe(false);
    expect(subjectFilter.isActive([])).toBe(false);
    expect(subjectFilter.isActive(['CV'])).toBe(true);
  });

  it('URL: literal codes, case-insensitive, tag slugs mapped, junk dropped', () => {
    expect(subjectFilter.toURL(['CV', 'ML'])).toBe('sub=CV%2CML');
    expect(subjectFilter.fromURL('sub=ml,CV,cv')).toEqual(['CV', 'ML']);
    expect(subjectFilter.fromURL('sub=robotics,quantum-computing')).toEqual([
      'RO',
      'quantum-computing',
    ]);
    expect(subjectFilter.fromURL('sub=<script>,,%20')).toEqual([]);
    roundTrips(subjectFilter, [[], ['ML'], ['CV', 'ML', 'NLP'], ['quantum-computing']]);
  });

  it('catalogs the subjects present in the data, known ones first', () => {
    const cat = subjectCatalog([
      { tags: ['zzz-new', 'computer-vision'] },
      { tags: ['machine learning', 'machine-learning'] },
    ]);
    expect(cat.map((s) => [s.code, s.count])).toEqual([
      ['ML', 1],
      ['CV', 1],
      ['zzz-new', 1],
    ]);
  });
});

describe('search', () => {
  const c = ctx();
  const icml = location(
    {},
    {
      title: 'ICML',
      series: 'icml',
      year: 2027,
      fullName: 'International Conference on Machine Learning',
    },
  );
  const montreal = location({}, { title: 'Réseaux', fullName: 'Journées Montréal', series: 'res' });

  it('matches title, full name and series, case- and diacritic-insensitively', () => {
    expect(searchFilter.test(icml, c, 'icml')).toBe(true);
    expect(searchFilter.test(icml, c, 'machine LEARNING')).toBe(true);
    expect(searchFilter.test(icml, c, 'icml 2027')).toBe(true);
    expect(searchFilter.test(icml, c, 'learning icml')).toBe(true); // all words, any order
    expect(searchFilter.test(icml, c, 'vision')).toBe(false);
    expect(searchFilter.test(montreal, c, 'reseaux montreal')).toBe(true);
    expect(matchesQuery(montreal.conference, 'RÉSEAUX')).toBe(true);
    expect(fold('Montréal')).toBe('montreal');
  });

  it('is inactive when empty; URL round-trips and cleans input', () => {
    expect(searchFilter.isActive('')).toBe(false);
    expect(searchFilter.isActive('icml')).toBe(true);
    roundTrips(searchFilter, ['', 'icml', 'machine learning', 'Montréal & co, 100%']);
    expect(searchFilter.fromURL('q=%20%20neur%20%20ips%20')).toBe('neur ips');
    expect(searchFilter.fromURL(`q=${'a'.repeat(500)}`)).toHaveLength(100);
  });

  it('matches any comma-separated part, every word within a part', () => {
    expect(searchFilter.test(icml, c, 'neurips, icml')).toBe(true);
    expect(searchFilter.test(montreal, c, 'neurips, icml')).toBe(false);
    expect(searchFilter.test(icml, c, 'neurips, icml 2026')).toBe(false); // all words of a part
    expect(searchFilter.test(icml, c, 'icml 2027, neurips')).toBe(true);
    expect(searchFilter.test(montreal, c, 'reseaux,')).toBe(true);
    expect(searchFilter.test(icml, c, 'reseaux,')).toBe(false); // the empty part matches nothing
  });

  it('cleans comma spacing; a query of only commas is inactive', () => {
    expect(cleanQuery('neurips ,icml')).toBe('neurips, icml');
    expect(cleanQuery(', neurips,, icml ,')).toBe('neurips, icml');
    expect(searchFilter.fromURL('q=%2C%20%2C')).toBe('');
    expect(searchFilter.isActive(cleanQuery(' , ,'))).toBe(false);
    expect(cleanQuery(`${'a'.repeat(98)},b`)).toBe('a'.repeat(98)); // the cap leaves no ", "
    for (const q of ['neurips ,icml', ', a,,b ,', ' , ', `${'a'.repeat(99)},b`, 'Montréal & co'])
      expect(cleanQuery(cleanQuery(q)), q).toBe(cleanQuery(q));
  });
});

describe('radius', () => {
  const paris = location({ lat: PARIS.lat, lng: PARIS.lng });
  const d = haversineKm(LONDON, PARIS); // ~344 km

  it('keeps locations within X km of home (inclusive)', () => {
    const c = ctx({ home: LONDON });
    expect(radiusFilter.test(paris, c, 400)).toBe(true);
    expect(radiusFilter.test(paris, c, 300)).toBe(false);
    expect(radiusFilter.test(paris, c, Math.ceil(d))).toBe(true);
  });

  it('virtual editions always pass; hybrid ones are measured to their city', () => {
    const c = ctx({ home: LONDON });
    expect(radiusFilter.test(virtualLocation(), c, 1)).toBe(true);
    expect(radiusFilter.test(virtualLocation(), ctx(), 1)).toBe(true);
    const hybridParis = hybridLocation({ lat: PARIS.lat, lng: PARIS.lng });
    expect(radiusFilter.test(hybridParis, c, 400)).toBe(true);
    expect(radiusFilter.test(hybridParis, c, 300)).toBe(false);
    expect(radiusFilter.test(hybridLocation(), c, 50)).toBe(false); // New Orleans
  });

  it('has no effect without home, or with an unusable home', () => {
    expect(radiusFilter.test(paris, ctx(), 1)).toBe(true);
    expect(radiusFilter.test(paris, ctx({ home: { lat: NaN, lng: 0 } }), 1)).toBe(true);
  });

  it('is active when set; URL is integer km', () => {
    expect(radiusFilter.isActive(null)).toBe(false);
    expect(radiusFilter.isActive(1000)).toBe(true);
    roundTrips(radiusFilter, [null, 1, 1000, 20040]);
    expect(radiusFilter.fromURL('radius=1000')).toBe(1000);
    for (const bad of ['0', '-5', '1.5', '1e3', 'abc', '20041', '']) {
      expect(radiusFilter.fromURL(`radius=${bad}`)).toBeNull();
    }
  });
});

describe('co2', () => {
  const paris = location({ lat: PARIS.lat, lng: PARIS.lng });

  it('uses the global mode and threshold', () => {
    const rail = tripKg(paris, ctx({ home: LONDON }))!;
    const fly = tripKg(paris, ctx({ home: LONDON, mode: 'fly' }))!;
    const flyByThreshold = tripKg(paris, ctx({ home: LONDON, threshold: 100 }))!;
    expect(rail).toBeLessThan(fly);
    expect(flyByThreshold).toBeCloseTo(fly);
    const between = Math.round((rail + fly) / 2);
    expect(co2Filter.test(paris, ctx({ home: LONDON }), between)).toBe(true);
    expect(co2Filter.test(paris, ctx({ home: LONDON, mode: 'fly' }), between)).toBe(false);
  });

  it('has no effect without home', () => {
    expect(co2Filter.test(paris, ctx(), 1)).toBe(true);
    expect(tripKg(paris, ctx())).toBeUndefined();
    expect(tripKg(virtualLocation(), ctx())).toBeUndefined();
  });

  it('a virtual edition is ~0 kg: passes any limit, never estimated', () => {
    const estimateTrip = vi.fn(co2Model.estimateTrip);
    const c = ctx({ home: LONDON, co2: { estimateTrip } });
    expect(tripKg(virtualLocation(), c)).toBe(0);
    expect(co2Filter.test(virtualLocation(), c, 1)).toBe(true);
    expect(estimateTrip).not.toHaveBeenCalled();
  });

  it('a hybrid edition is estimated to its city', () => {
    const hybridParis = hybridLocation({ lat: PARIS.lat, lng: PARIS.lng });
    expect(tripKg(hybridParis, ctx({ home: LONDON }))).toBeCloseTo(
      tripKg(paris, ctx({ home: LONDON }))!,
    );
    expect(co2Filter.test(hybridLocation(), ctx({ home: LONDON }), 25)).toBe(false);
  });

  it('guards estimateTrip RangeErrors (invalid home or threshold): no effect, no throw', () => {
    const badHome = ctx({ home: { lat: Infinity, lng: 0 } });
    const badThreshold = ctx({ home: LONDON, threshold: -1 });
    const nanThreshold = ctx({ home: LONDON, threshold: NaN });
    for (const c of [badHome, badThreshold, nanThreshold]) {
      expect(() => co2Filter.test(paris, c, 1)).not.toThrow();
      expect(co2Filter.test(paris, c, 1)).toBe(true);
    }
  });

  it('is active when set; URL round-trips and rejects junk', () => {
    expect(co2Filter.isActive(null)).toBe(false);
    expect(co2Filter.isActive(300)).toBe(true);
    roundTrips(co2Filter, [null, 25, 300, 5000, 100000]);
    for (const bad of ['0', '-1', '3.5', 'Infinity', '100001']) {
      expect(co2Filter.fromURL(`co2=${bad}`)).toBeNull();
    }
  });
});

describe('access', () => {
  it('keeps locations whose access level is selected', () => {
    const c = ctx();
    const open = location({ access: 'open' });
    const authors = location({ access: 'authors_only' });
    expect(accessFilter.test(open, c, ['open', 'registration'])).toBe(true);
    expect(accessFilter.test(authors, c, ['open', 'registration'])).toBe(false);
    expect(accessFilter.test(authors, c, ['authors_only'])).toBe(true);
  });

  it('URL: canonical order, unknown values dropped', () => {
    expect(accessFilter.isActive([])).toBe(false);
    expect(accessFilter.fromURL('access=authors_only,open,bogus,open')).toEqual([
      'open',
      'authors_only',
    ]);
    roundTrips(accessFilter, [[], ['open'], ['open', 'registration', 'authors_only']]);
  });
});

describe('kind', () => {
  it('official vs community', () => {
    const c = ctx();
    const official = location({ official: true });
    const community = location({ official: false, role: 'satellite' });
    expect(kindFilter.test(official, c, 'official')).toBe(true);
    expect(kindFilter.test(community, c, 'official')).toBe(false);
    expect(kindFilter.test(community, c, 'community')).toBe(true);
    expect(kindFilter.test(official, c, 'community')).toBe(false);
  });

  it('URL round-trips', () => {
    expect(kindFilter.isActive(null)).toBe(false);
    roundTrips(kindFilter, [null, 'official', 'community']);
    expect(kindFilter.fromURL('kind=Official')).toBeNull();
  });
});

describe('open', () => {
  const now = new Date('2026-10-22T10:00:00Z');
  const dl = (type: string, date: string) => ({ type, label: type, date, timezone: 'AoE' });

  it('passes when an abstract or paper deadline is after now', () => {
    const at = (type: string, date: string) => location({}, { deadlines: [dl(type, date)] });
    const c = ctx({ now });
    expect(openFilter.test(at('abstract', '2026-10-23T00:00:00Z'), c, true)).toBe(true);
    expect(openFilter.test(at('paper', '2026-11-01T00:00:00Z'), c, true)).toBe(true);
    expect(openFilter.test(at('submission', '2026-11-01T00:00:00Z'), c, true)).toBe(true);
    expect(openFilter.test(at('paper', '2026-10-22T10:00:00Z'), c, true)).toBe(false); // = now
    expect(openFilter.test(at('paper', '2026-10-01T00:00:00Z'), c, true)).toBe(false);
    expect(openFilter.test(at('camera_ready', '2026-12-01T00:00:00Z'), c, true)).toBe(false);
    expect(openFilter.test(location({}, { deadlines: [] }), c, true)).toBe(false);
  });

  it('mixed deadlines: any upcoming submission deadline counts', () => {
    const conf = {
      deadlines: [dl('abstract', '2026-09-01T00:00:00Z'), dl('paper', '2026-11-15T00:00:00Z')],
    };
    expect(submissionOpen(conf, now)).toBe(true);
    expect(submissionOpen(conf, new Date('2026-11-16T00:00:00Z'))).toBe(false);
  });

  it('URL round-trips', () => {
    expect(openFilter.isActive(false)).toBe(false);
    roundTrips(openFilter, [false, true]);
    expect(openFilter.fromURL('open=true')).toBe(false);
  });
});
