import { describe, expect, it } from 'vitest';
import type { PwcRecord } from './history';
import { compareCandidates, groupEditions, type Candidate } from './ids';

const cand = (
  key: string,
  last_date: string,
  extra: Partial<PwcRecord['entry']> = {},
  series = 'corl',
  year = 2020,
): Candidate => ({
  series,
  year,
  record: {
    key,
    entry: { id: key, ...extra },
    first_index: 0,
    first_sha: 'a'.repeat(40),
    first_date: '2020-01-01',
    last_sha: 'b'.repeat(40),
    last_date,
  },
});

describe('compareCandidates', () => {
  it('prefers the latest last_date (corl20 Online beats corl2020 Cambridge)', () => {
    const [a, b] = [cand('corl2020', '2020-03-02'), cand('corl20', '2021-04-02')];
    expect([a, b].sort(compareCandidates).map((c) => c.record.key)).toEqual(['corl20', 'corl2020']);
  });
  it('then start/end, then the shorter id, then the id', () => {
    const se = { start: '2020-11-16', end: '2020-11-18' };
    const all = [
      cand('corl20b', '2021-04-02'),
      cand('corl2020', '2021-04-02', se),
      cand('corl20a', '2021-04-02'),
      cand('corl20', '2021-04-02'),
    ];
    expect(all.sort(compareCandidates).map((c) => c.record.key)).toEqual([
      'corl2020',
      'corl20',
      'corl20a',
      'corl20b',
    ]);
  });
});

describe('groupEditions', () => {
  it('groups by series|year, best first, groups in key order', () => {
    const groups = groupEditions([
      cand('icra21', '2021-06-09', {}, 'icra', 2021),
      cand('icra2020', '2019-10-09', {}, 'icra', 2020),
      cand('icra20', '2020-09-16', {}, 'icra', 2020),
      cand('acl20', '2020-10-10', {}, 'acl', 2020),
      cand('naacl20', '2019-08-21', {}, 'acl', 2020),
    ]);
    expect(groups.map((g) => g.map((c) => c.record.key))).toEqual([
      ['acl20', 'naacl20'],
      ['icra20', 'icra2020'],
      ['icra21'],
    ]);
  });
});
