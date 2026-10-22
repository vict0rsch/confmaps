import { describe, expect, it } from 'vitest';
import { createFilters } from '../filters';
import { DEFAULT_TRAVEL } from './travel.svelte';
import { buildQuery, ownedParams, parseQuery, withHomeParam, type URLInputs } from './url';

const filters = createFilters('2026-10-22');
const defaults = Object.fromEntries(filters.map((f) => [f.id, f.defaultState]));
const isConference = (id: string) => id === 'neurips26' || id === 'icml27';

const inputs = (over: Partial<URLInputs> = {}): URLInputs => ({
  filters,
  states: defaults,
  selection: null,
  travel: { ...DEFAULT_TRAVEL },
  ...over,
});

describe('buildQuery', () => {
  it('is empty at defaults', () => {
    expect(buildQuery('', inputs())).toBe('');
  });

  it('writes selection, active filters, non-default travel; commas literal', () => {
    const q = buildQuery(
      '',
      inputs({
        selection: 'neurips26',
        states: {
          ...defaults,
          subject: ['CV', 'ML'],
          radius: 1000,
          co2: 300,
          dates: { from: '2026-11-01', to: '2027-10-31' },
        },
        travel: { units: 'mi', mode: 'fly', threshold: 700 },
      }),
    );
    expect(q).toBe(
      'c=neurips26&from=2026-11&to=2027-10&sub=CV,ML&radius=1000&co2=300&mode=fly&thr=700&units=mi',
    );
  });

  it('keeps params it does not own (h, others) and replaces its own', () => {
    const q = buildQuery('?h=icml&sub=NLP&utm=x&c=old', inputs());
    expect(q).toBe('h=icml&utm=x');
  });

  it('never writes home from state (home is not an input)', () => {
    expect(ownedParams(filters)).not.toContain('home');
    expect(ownedParams(filters)).not.toContain('h');
  });

  it('encodes search text safely', () => {
    const q = buildQuery('', inputs({ states: { ...defaults, search: 'a&b=c d,é' } }));
    expect(q).toBe('q=a%26b%3Dc%20d,%C3%A9');
    expect(parseQuery(q, filters, isConference).filters.search).toBe('a&b=c d,é');
  });
});

describe('parseQuery', () => {
  it('parses the DESIGN example', () => {
    const p = parseQuery(
      '?c=neurips26&sub=ML,CV&radius=1000&co2=300&from=2026-11&to=2027-10',
      filters,
      isConference,
    );
    expect(p.selection).toBe('neurips26');
    expect(p.filters).toMatchObject({
      subject: ['CV', 'ML'],
      radius: 1000,
      co2: 300,
      dates: { from: '2026-11-01', to: '2027-10-31' },
      search: '',
      open: false,
    });
    expect(p.travel).toEqual({});
  });

  it('ignores malformed params safely', () => {
    const junk = [
      '?c=unknown&mode=walk&thr=-1&units=furlong&radius=abc&co2=&from=2026-99&sub=%%%',
      '?%E0%A4%A',
      '?c&mode&thr=1e3&units',
      '?thr=99999999',
      '?' + 'x=1&'.repeat(1000),
    ];
    for (const q of junk) {
      const p = parseQuery(q, filters, isConference);
      expect(p.selection).toBeNull();
      expect(p.travel).toEqual({});
      for (const f of filters) {
        if (f.id !== 'subject') expect(p.filters[f.id], f.id).toEqual(f.defaultState);
      }
    }
  });

  it('reads valid travel settings', () => {
    expect(parseQuery('mode=fly&thr=0&units=mi', filters, isConference).travel).toEqual({
      mode: 'fly',
      threshold: 0,
      units: 'mi',
    });
  });

  it('round-trips the whole state', () => {
    const state = inputs({
      selection: 'icml27',
      states: {
        ...defaults,
        search: 'learning',
        dates: { from: '2021-10-22', to: '2026-10-22' },
        subject: ['NLP', 'RO'],
        radius: 2500,
        co2: 750,
        open: true,
        access: ['open', 'authors_only'],
        kind: 'community',
      },
      travel: { units: 'mi', mode: 'auto', threshold: 650 },
    });
    const p = parseQuery(buildQuery('', state), filters, isConference);
    expect(p.selection).toBe(state.selection);
    expect(p.filters).toEqual(state.states);
    expect({ ...DEFAULT_TRAVEL, ...p.travel }).toEqual(state.travel);
  });
});

describe('shared home (opt-in)', () => {
  it('parses home=<geonameid> and ignores anything else', () => {
    expect(parseQuery('home=2950159', filters, isConference).home).toBe(2950159);
    const bad = ['home=Paris', 'home=0', 'home=-5', 'home=12.5', 'home=', 'home=1234567890', ''];
    for (const q of bad) expect(parseQuery(q, filters, isConference).home).toBeNull();
  });

  it('the live URL never carries home: buildQuery drops it', () => {
    expect(buildQuery('?home=2950159&utm=x', inputs())).toBe('utm=x');
    expect(buildQuery('', inputs({ selection: 'neurips26' }))).not.toContain('home');
  });

  it('withHomeParam adds the id only when given, keeping other params, and removes it otherwise', () => {
    const base = 'https://confmaps.org/?c=neurips26&radius=1000';
    expect(withHomeParam(base, null)).toBe(base);
    expect(withHomeParam(base, 2950159)).toBe(`${base}&home=2950159`);
    expect(withHomeParam(`${base}&home=1`, 2950159)).toBe(`${base}&home=2950159`);
    expect(withHomeParam(`${base}&home=1`, null)).toBe(base);
  });

  it('round-trips through parseQuery', () => {
    const url = withHomeParam('https://confmaps.org/?c=neurips26', 2950159);
    const parsed = parseQuery(new URL(url).search, filters, isConference);
    expect(parsed.home).toBe(2950159);
    expect(parsed.selection).toBe('neurips26');
  });
});
