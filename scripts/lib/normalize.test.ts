import { describe, expect, it } from 'vitest';
import { UPSTREAM_DIR } from '../__fixtures__';
import { normalizeUpstream, parseDateText, seriesKey } from './normalize';
import { readUpstreamDir } from './upstream';

describe('seriesKey', () => {
  it.each([
    ['ICML', 'icml'],
    ['ECML PKDD', 'ecml-pkdd'],
    ['EMNLP (Industry Track)', 'emnlp-industry-track'],
    ['IJCNLP & AACL', 'ijcnlp-aacl'],
    ['RuleML+RR', 'ruleml-rr'],
    ['Béta', 'beta'],
  ])('%s → %s', (title, key) => expect(seriesKey(title)).toBe(key));
});

describe('parseDateText', () => {
  it.each([
    ['June 10-17, 2025', '2025-06-10', '2025-06-17'],
    ['May 19 - 23, 2025', '2025-05-19', '2025-05-23'],
    ['June 30 - July 4, 2025', '2025-06-30', '2025-07-04'],
    ['April 29-May 4, 2025', '2025-04-29', '2025-05-04'],
    ['May 4, 2025', '2025-05-04', '2025-05-04'],
  ])('%s', (text, start, end) => expect(parseDateText(text)).toEqual({ start, end }));

  it.each(['TBA', 'December 30 - January 2, 2026', 'February 30-31, 2025', '2025-06-01'])(
    'rejects %j',
    (text) => expect(parseDateText(text)).toBeUndefined(),
  );
});

describe('normalizeUpstream', () => {
  const { entries, errors: readErrors } = readUpstreamDir(UPSTREAM_DIR);
  const { conferences, locations, errors } = normalizeUpstream(entries);
  const conf = (id: string) => conferences.find((c) => c.id === id)!;
  const loc = (id: string) => locations.find((l) => l.id === id)!;

  it('reads fixtures without errors', () => {
    expect(readErrors).toEqual([]);
    expect(errors).toEqual([]);
    expect(conferences.map((c) => c.id)).toEqual(['alpha25', 'alpha26', 'beta25']);
  });

  it('builds the conference record', () => {
    expect(conf('alpha25')).toEqual({
      id: 'alpha25',
      series: 'alpha',
      title: 'Alpha',
      year: 2025,
      fullName: 'Alpha Conference on Learning',
      link: 'https://alpha.example/2025',
      tags: ['machine-learning'],
      deadlines: [
        {
          type: 'abstract',
          label: 'Abstract deadline',
          date: '2025-01-11T11:59:59Z',
          timezone: 'AoE',
        },
        {
          type: 'paper',
          label: 'Paper deadline',
          date: '2025-01-15T21:59:59Z',
          timezone: 'UTC+02',
        },
      ],
      start: '2025-06-01',
      end: '2025-06-05',
      source: 'hf',
    });
    expect(conf('alpha26').deadlines[0].date).toBe('2026-06-01T11:00:00Z');
    expect(conf('alpha26').fullName).toBeUndefined();
    expect(conf('alpha26').tags).toEqual([]);
  });

  it('builds the main location with defaults', () => {
    expect(loc('alpha25@main')).toEqual({
      id: 'alpha25@main',
      conferenceId: 'alpha25',
      role: 'main',
      name: 'Alpha 2025',
      city: 'Vienna',
      country: 'Austria',
      venue: 'Messe Wien',
      start: '2025-06-01',
      end: '2025-06-05',
      official: true,
      presentsPapers: true,
      access: 'registration',
      link: 'https://alpha.example/2025',
    });
  });

  it('handles legacy deadline fields and free-text dates', () => {
    const b = conf('beta25');
    expect(b.series).toBe('beta-conf-industry-track');
    expect([b.start, b.end]).toEqual(['2025-06-30', '2025-07-04']);
    expect(b.deadlines).toEqual([
      {
        type: 'abstract',
        label: 'Abstract submission deadline',
        date: '2024-09-25T07:59:59Z',
        timezone: 'UTC-8',
      },
      {
        type: 'paper',
        label: 'Paper submission deadline',
        date: '2024-10-01T17:59:59Z',
        timezone: 'UTC-8',
      },
    ]);
  });

  it('fails loudly on an unknown or missing timezone', () => {
    const base = entries[0];
    const r = normalizeUpstream([
      {
        ...base,
        id: 'x1',
        deadlines: [{ type: 'paper', date: '2025-01-01 00:00:00', timezone: 'Moon/Base' }],
      },
      { ...base, id: 'x2', deadlines: [{ type: 'paper', date: '2025-01-01 00:00:00' }] },
    ]);
    expect(r.errors).toEqual([
      'upstream x1: deadline "paper": unknown timezone "Moon/Base"',
      'upstream x2: deadline "paper" has no timezone',
    ]);
  });
});
