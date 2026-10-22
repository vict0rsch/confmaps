import { describe, expect, it } from 'vitest';
import { createFilters } from '../filters';
import { DEFAULT_TRAVEL } from './travel.svelte';
import { buildQuery, ownedParams, parseQuery, type URLInputs } from './url';

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

  it('keeps params it does not own (h, home, others) and replaces its own', () => {
    const q = buildQuery('?h=icml&sub=NLP&utm=x&home=Paris&c=old', inputs());
    expect(q).toBe('h=icml&utm=x&home=Paris');
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
