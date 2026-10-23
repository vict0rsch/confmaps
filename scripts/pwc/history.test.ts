import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  checkHead,
  normalizeEntry,
  parseVersion,
  PWC_HEAD,
  readVersions,
  unionHistory,
  type Version,
} from './history';
import { makePwcRepo } from './__fixtures__/repo';

const sha = (c: string) => c.repeat(40);

const GOOD = `- title: ICRA
  year: 2020
  id: icra2020
  date: May 31-June 4, 2020
  place: Paris, France
`;
// An unclosed quote in one entry breaks the whole file; 3dv19 only exists here.
const BROKEN = `- title: CVPR
  year: 2019
  id: cvpr19
  note: 'unclosed
  place: Long Beach, USA

- title: 3DV
  year: 2019
  id: 3dv19
  date: September 16-19, 2019
  place: Quebec City, Canada
`;

describe('parseVersion', () => {
  it('parses a whole file', () => {
    expect(parseVersion(GOOD)).toMatchObject({ chunked: false, entries: [{ id: 'icra2020' }] });
  });
  it('falls back to per-entry chunks, skipping the broken ones (recovers 3dv19)', () => {
    const { entries, chunked } = parseVersion(BROKEN);
    expect(chunked).toBe(true);
    expect(entries).toEqual([
      {
        title: '3DV',
        year: 2019,
        id: '3dv19',
        date: 'September 16-19, 2019',
        place: 'Quebec City, Canada',
      },
    ]);
  });
  it('keeps dates as strings and tolerates duplicate keys', () => {
    const { entries } = parseVersion('- id: a19\n  start: 2019-06-10\n  place: X\n  place: Y\n');
    expect(entries).toEqual([{ id: 'a19', start: '2019-06-10', place: 'Y' }]);
  });
});

describe('normalizeEntry', () => {
  it('normalizes key variants and sub', () => {
    expect(
      normalizeEntry({
        name: 'UAI',
        Id: 'uai17',
        year: 2017,
        data: 'Aug 11-15, 2017',
        long: ' X ',
        sub: 'ML',
      }),
    ).toEqual({
      id: 'uai17',
      title: 'UAI',
      year: 2017,
      date: 'Aug 11-15, 2017',
      full_name: 'X',
      sub: ['ML'],
    });
  });
  it('prefers the canonical keys and drops empty values', () => {
    expect(
      normalizeEntry({ title: 'A', name: 'B', id: 'a', Id: 'b', link: '', sub: ['CV', 'ML'] }),
    ).toEqual({ id: 'a', title: 'A', sub: ['CV', 'ML'] });
  });
  it('ignores non-mappings', () => {
    expect(normalizeEntry('x')).toBeUndefined();
    expect(normalizeEntry([1])).toBeUndefined();
  });
});

describe('unionHistory', () => {
  const versions: Version[] = [
    { sha: sha('1'), date: '2019-06-24', text: GOOD },
    { sha: sha('2'), date: '2019-07-01', text: BROKEN },
    {
      sha: sha('3'),
      date: '2019-10-09',
      text: GOOD.replace('icra2020', 'icra20').replace('Paris, France', 'Paris'),
    },
    { sha: sha('4'), date: '2020-09-16', text: GOOD.replace('icra2020', 'icra20') },
  ];
  const { records, chunked } = unionHistory(versions);

  it('reports the versions parsed per entry', () => expect(chunked).toEqual([sha('2')]));
  it('keeps the latest version of each id with its first and last commit', () => {
    expect(records.get('icra20')).toEqual({
      key: 'icra20',
      entry: {
        id: 'icra20',
        title: 'ICRA',
        year: 2020,
        date: 'May 31-June 4, 2020',
        place: 'Paris, France',
      },
      first_index: 2,
      first_sha: sha('3'),
      first_date: '2019-10-09',
      last_sha: sha('4'),
      last_date: '2020-09-16',
    });
    // The renamed id keeps its own (older) record.
    expect(records.get('icra2020')).toMatchObject({ first_sha: sha('1'), last_sha: sha('1') });
    expect(records.get('3dv19')).toMatchObject({ first_sha: sha('2'), last_sha: sha('2') });
  });
  it('keys an entry without id by title+year', () => {
    const r = unionHistory([
      { sha: sha('5'), date: '2024-04-14', text: '- title: KIL\n  year: 2024\n' },
    ]);
    expect([...r.records.keys()]).toEqual(['KIL+2024']);
  });
});

describe('readVersions / checkHead (local repo)', () => {
  const repo = makePwcRepo([GOOD, BROKEN]);
  afterAll(repo.cleanup);

  it('lists every version of _data/conferences.yml on gh-pages, oldest first', () => {
    const versions = readVersions(repo.gitDir);
    expect(versions.map((v) => v.text)).toEqual([GOOD, BROKEN]);
    for (const v of versions) {
      expect(v.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(v.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('warns when the tip is not the reviewed PWC_HEAD', () => {
    const warn = vi.fn();
    expect(checkHead(repo.gitDir, warn)).not.toBe(PWC_HEAD);
    expect(warn).toHaveBeenCalledOnce();
  });
});
